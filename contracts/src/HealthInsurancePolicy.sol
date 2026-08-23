// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IVerifier.sol";
import "./interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title HealthInsurancePolicy — unified with claim-zk
 * @notice Policy management (premium in wei) + claim settlement verified by Groth16
 *         claim.circom (5 public signals). Payout is proven in PAISE and converted
 *         to wei AFTER inference via Chainlink (INR per ETH), so the ZK stays
 *         integer-exact and price-independent.
 *
 * Public inputs — FROZEN per circuits/claim.circom:159 / docs/zk_interface.md:28
 *   [0] policyId (uint256)
 *   [1] hospital_pk_x (BabyJubJub X)
 *   [2] hospital_pk_y (BabyJubJub Y)
 *   [3] claim_nullifier (field element, stored as bytes32)
 *   [4] payout_amount (paise, 1 INR = 100 paise)
 *
 * Legacy 4-input test compatibility:
 *   If publicInputs.length == 4, falls back to ProofSure-main test encoding:
 *   [0] policyId, [1] nullifier, [2] payout (wei), [3] hospital address.
 *   In that mode no Chainlink conversion is applied — payout is taken as wei.
 */
contract HealthInsurancePolicy is Ownable, ReentrancyGuard {
    struct Policy {
        address holder;
        uint256 premium;        // wei (ETH) — payPremium requires msg.value == premium
        uint256 coverageLimit;  // wei (ETH) — remaining coverage enforced in wei after conversion
        uint256 coverageUsed;   // wei
        uint256 deductible;     // kept for reference (paise scale in circuit)
        uint256 coPayBps;       // basis points
        uint64 startTime;
        uint64 endTime;
        bool active;
        bytes32 premiumModelId;
    }

    struct Claim {
        uint256 policyId;
        uint256 payoutPaise;    // as proven (if 5-input) else 0
        uint256 payoutWei;      // actual ETH paid
        bytes32 nullifier;
        bool processed;
    }

    IVerifier public verifier;
    AggregatorV3Interface public priceFeed; // INR per ETH, 8 decimals (mock: 300k*1e8)

    uint256 public nextPolicyId;
    uint256 public nextClaimId;

    mapping(uint256 => Policy) public policies;
    mapping(uint256 => Claim) public claims;
    mapping(address => bool) public authorizedHospitals;           // legacy address registry (ProofSure tests)
    mapping(bytes32 => bool) public authorizedHospitalsByKey;      // BabyJubJub key = keccak256(abi.encode(pk_x, pk_y))
    mapping(bytes32 => bool) public usedNullifiers;

    uint256 public constant PAISE_PER_INR = 100;
    uint256 public maxStaleness = 3600; // for Chainlink freshness

    // mirror claim-zk ClaimPayoutChainlink events + policy events
    event PolicyCreated(uint256 indexed policyId, address indexed holder, uint256 premium, uint256 coverageLimit);
    event PremiumPaid(uint256 indexed policyId, address indexed holder, uint256 amount);
    event PolicyActivated(uint256 indexed policyId);
    event HospitalAuthorized(address indexed hospital);
    event HospitalRemoved(address indexed hospital);
    event HospitalAuthorizedByKey(bytes32 indexed key, uint256 pkX, uint256 pkY);
    event HospitalRemovedByKey(bytes32 indexed key);
    event PriceFeedUpdated(address indexed oldFeed, address indexed newFeed);
    event ClaimSubmitted(uint256 indexed claimId, uint256 indexed policyId);
    event ClaimPaid(uint256 indexed claimId, uint256 indexed policyId, address indexed holder, uint256 payout); // legacy 4-arg, payout = wei (converted if 5-input)
    event ClaimPaidDetailed(uint256 indexed claimId, uint256 indexed policyId, address indexed holder, uint256 payoutPaise, uint256 payoutWei, uint256 price, uint8 decimals);

    error StalePrice();
    error InvalidPrice();

    constructor(address _verifier, address _priceFeed) Ownable(msg.sender) {
        verifier = IVerifier(_verifier);
        if (_priceFeed != address(0)) priceFeed = AggregatorV3Interface(_priceFeed);
    }

    // allow legacy single-arg deployment (tests that only pass verifier)
    // via PriceFeedUpdated after deployment; maxStaleness covers zero-feed case by skipping conversion

    // ---------------------------------------------------------------
    // Policy
    // ---------------------------------------------------------------

    function createPolicy(
        address holder,
        uint256 premium,
        uint256 coverageLimit,
        uint256 deductible,
        uint256 coPayBps,
        uint64 durationSeconds,
        bytes32 premiumModelId
    ) external onlyOwner returns (uint256 policyId) {
        require(coPayBps <= 10000, "coPayBps out of range");

        policyId = nextPolicyId++;
        policies[policyId] = Policy({
            holder: holder,
            premium: premium,
            coverageLimit: coverageLimit,
            coverageUsed: 0,
            deductible: deductible,
            coPayBps: coPayBps,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp) + durationSeconds,
            active: false,
            premiumModelId: premiumModelId
        });

        emit PolicyCreated(policyId, holder, premium, coverageLimit);
    }

    function payPremium(uint256 policyId) external payable {
        Policy storage p = policies[policyId];
        require(p.holder != address(0), "policy does not exist");
        require(msg.sender == p.holder, "not policy holder");
        require(msg.value == p.premium, "incorrect premium amount");
        emit PremiumPaid(policyId, msg.sender, msg.value);
    }

    function activatePolicy(uint256 policyId) external onlyOwner {
        Policy storage p = policies[policyId];
        require(p.holder != address(0), "policy does not exist");
        require(!p.active, "already active");
        require(block.timestamp <= p.endTime, "policy expired");
        p.active = true;
        emit PolicyActivated(policyId);
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) { return policies[policyId]; }

    // ---------------------------------------------------------------
    // Hospital registry (dual: BabyJubJub key + address)
    // ---------------------------------------------------------------

    function addHospital(address hospital) external onlyOwner {
        authorizedHospitals[hospital] = true;
        emit HospitalAuthorized(hospital);
    }

    function removeHospital(address hospital) external onlyOwner {
        authorizedHospitals[hospital] = false;
        emit HospitalRemoved(hospital);
    }

    function isHospitalAuthorized(address hospital) external view returns (bool) { return authorizedHospitals[hospital]; }

    function authorizeHospitalByKey(uint256 pkX, uint256 pkY) external onlyOwner {
        bytes32 k = keccak256(abi.encode(pkX, pkY));
        authorizedHospitalsByKey[k] = true;
        emit HospitalAuthorizedByKey(k, pkX, pkY);
    }

    function removeHospitalByKey(uint256 pkX, uint256 pkY) external onlyOwner {
        bytes32 k = keccak256(abi.encode(pkX, pkY));
        authorizedHospitalsByKey[k] = false;
        emit HospitalRemovedByKey(k);
    }

    function authorizeHospitalsByKey(uint256[] calldata pkXs, uint256[] calldata pkYs) external onlyOwner {
        require(pkXs.length == pkYs.length, "len mismatch");
        for (uint256 i = 0; i < pkXs.length; i++) {
            bytes32 k = keccak256(abi.encode(pkXs[i], pkYs[i]));
            authorizedHospitalsByKey[k] = true;
            emit HospitalAuthorizedByKey(k, pkXs[i], pkYs[i]);
        }
    }

    function isHospitalAuthorizedByKey(uint256 pkX, uint256 pkY) external view returns (bool) {
        return authorizedHospitalsByKey[keccak256(abi.encode(pkX, pkY))];
    }

    // ---------------------------------------------------------------
    // Chainlink helpers — paise (circuit) => wei (settlement) AFTER inference
    // ---------------------------------------------------------------

    function setPriceFeed(address _feed) external onlyOwner {
        address old = address(priceFeed);
        priceFeed = AggregatorV3Interface(_feed);
        emit PriceFeedUpdated(old, _feed);
    }

    function setMaxStaleness(uint256 s) external onlyOwner { maxStaleness = s; }

    function _getValidatedPrice() internal view returns (uint256 price, uint8 dec, uint256 updatedAt) {
        require(address(priceFeed) != address(0), "price feed not set");
        (, int256 answer, , uint256 upd, ) = priceFeed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        if (block.timestamp > upd + maxStaleness) revert StalePrice();
        price = uint256(answer);
        dec = priceFeed.decimals();
        updatedAt = upd;
    }

    /// @notice Convert paise (public input [4]) to wei at current oracle price.
    /// formula: wei = paise * 1e18 * 10**dec / (100 * price)  (price = INR per ETH)
    function paiseToWei(uint256 paise) public view returns (uint256) {
        (uint256 price, uint8 dec, ) = _getValidatedPrice();
        return (paise * 1e18 * (10 ** dec)) / (PAISE_PER_INR * price);
    }

    /// @notice Preview without state change (after inference, before submit).
    function previewPayoutInEth(uint256 paise) external view returns (uint256 weiAmt, uint256 price, uint8 dec) {
        (price, dec, ) = _getValidatedPrice();
        weiAmt = paiseToWei(paise);
    }

    /// @notice Dual-feed helper if only ETH/USD + USD/INR feeds are available.
    function paiseToWeiDualFeed(uint256 paise, AggregatorV3Interface ethUsdFeed, AggregatorV3Interface usdInrFeed) external view returns (uint256) {
        (, int256 ethUsd,, uint256 upd1,) = ethUsdFeed.latestRoundData();
        (, int256 usdInr,, uint256 upd2,) = usdInrFeed.latestRoundData();
        if (ethUsd <= 0 || usdInr <= 0) revert InvalidPrice();
        if (block.timestamp > upd1 + maxStaleness || block.timestamp > upd2 + maxStaleness) revert StalePrice();
        uint8 d1 = ethUsdFeed.decimals(); uint8 d2 = usdInrFeed.decimals();
        return (paise * 1e18 * (10 ** (uint256(d1)+uint256(d2)))) / (PAISE_PER_INR * uint256(ethUsd) * uint256(usdInr));
    }

    // ---------------------------------------------------------------
    // Claims — unified 5-input (ZK, paise+Chainlink) and 4-input (legacy test)
    // ---------------------------------------------------------------

    function submitClaimProof(bytes calldata proof, uint256[] calldata publicInputs) external returns (uint256 claimId) {
        require(publicInputs.length == 4 || publicInputs.length == 5, "malformed public inputs");

        uint256 policyId;
        bytes32 nullifier;
        uint256 payoutPaise;
        uint256 payoutWei;
        address hospitalAddr;
        bytes32 hospitalKey;
        bool isFive = publicInputs.length == 5;

        if (isFive) {
            // ZK path: [policyId, pk_x, pk_y, nullifier, payoutPaise]
            policyId = publicInputs[0];
            uint256 pkX = publicInputs[1];
            uint256 pkY = publicInputs[2];
            nullifier = bytes32(publicInputs[3]);
            payoutPaise = publicInputs[4];
            hospitalKey = keccak256(abi.encode(pkX, pkY));
            // hospitalAddr stays zero for key-based auth; kept for event clarity
            payoutWei = address(priceFeed) != address(0) ? paiseToWei(payoutPaise) : payoutPaise; // fallback 1:1 if no feed (test)
            hospitalAddr = address(0);
        } else {
            // legacy test path: [policyId, nullifier, payoutWei, hospitalAddr]
            policyId = publicInputs[0];
            nullifier = bytes32(publicInputs[1]);
            payoutWei = publicInputs[2];
            payoutPaise = 0;
            hospitalAddr = address(uint160(publicInputs[3]));
            hospitalKey = bytes32(0);
        }

        Policy storage p = policies[policyId];
        require(p.holder != address(0), "policy does not exist");

        claimId = nextClaimId++;
        claims[claimId] = Claim({policyId: policyId, payoutPaise: payoutPaise, payoutWei: payoutWei, nullifier: nullifier, processed: false});
        emit ClaimSubmitted(claimId, policyId);

        _verifyAndPayClaim(claimId, proof, publicInputs);
    }

    function _verifyAndPayClaim(uint256 claimId, bytes calldata proof, uint256[] calldata publicInputs) internal nonReentrant {
        Claim storage c = claims[claimId];
        require(!c.processed, "claim already processed");
        Policy storage p = policies[c.policyId];
        require(p.active, "policy not active");
        require(block.timestamp >= p.startTime, "policy not started");
        require(block.timestamp <= p.endTime, "policy expired");
        require(!usedNullifiers[c.nullifier], "nullifier already used");
        require(p.coverageUsed + c.payoutWei <= p.coverageLimit, "exceeds remaining coverage");

        bool isFive = publicInputs.length == 5;
        if (isFive) {
            bytes32 k = keccak256(abi.encode(publicInputs[1], publicInputs[2]));
            require(authorizedHospitalsByKey[k], "hospital not authorized");
        } else {
            address h = address(uint160(publicInputs[3]));
            require(authorizedHospitals[h], "hospital not authorized");
        }

        bool valid = verifier.verifyClaimProof(proof, publicInputs);
        require(valid, "invalid claim proof");
        require(address(this).balance >= c.payoutWei, "insufficient reserve");

        usedNullifiers[c.nullifier] = true;
        c.processed = true;
        p.coverageUsed += c.payoutWei;

        (bool sent, ) = payable(p.holder).call{value: c.payoutWei}("");
        require(sent, "payout transfer failed");

        // emit legacy 4-arg for backward compat (tests), plus detailed for ZK flows
        emit ClaimPaid(claimId, c.policyId, p.holder, c.payoutWei);
        if (publicInputs.length == 5) {
            uint256 price = 0; uint8 dec = 0;
            if (address(priceFeed) != address(0)) (price, dec, ) = _getValidatedPrice();
            emit ClaimPaidDetailed(claimId, c.policyId, p.holder, c.payoutPaise, c.payoutWei, price, dec);
        }
    }

    // backward-compatible ClaimPaid with 4 args for old frontends/tests listening to (claimId,policyId,holder,payout)
    // new event is (claimId,policyId,holder,payoutPaise,payoutWei,price,dec) — tooling should key on claimId

    function getClaim(uint256 claimId) external view returns (Claim memory) { return claims[claimId]; }

    // ---------------------------------------------------------------
    // Admin / funding
    // ---------------------------------------------------------------

    function fundReserve() external payable onlyOwner {}
    function withdrawUnusedReserve(uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "insufficient balance");
        (bool sent, ) = payable(owner()).call{value: amount}("");
        require(sent, "withdrawal failed");
    }
    function setVerifier(address _v) external onlyOwner { verifier = IVerifier(_v); }
    receive() external payable {}
}
