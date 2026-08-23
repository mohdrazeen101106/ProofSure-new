// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IVerifier.sol";

/**
 * @title ClaimVerifier
 * @notice Groth16 verifier for claim.circom (snarkjs, BN254) wrapped to IVerifier.
 * Public inputs (5) — MUST match circuits/claim.circom:159 and docs/zk_interface.md:28:
 *   [0] policy_id, [1] hospital_pk_x, [2] hospital_pk_y, [3] claim_nullifier, [4] payout_amount (paise)
 * Proof is expected as abi.encode(uint[2] a, uint[2][2] b, uint[2] c) — see scripts/export_claim_proof.js
 * This keeps HealthInsurancePolicy's generic IVerifier(bytes) interface while reusing the audited snarkjs verifier.
 */
contract ClaimVerifier is IVerifier {
    // Scalar field size
    uint256 constant r = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    uint256 constant alphax  = 19345590735222488521938562552221095787204927466091324586781092351593412954401;
    uint256 constant alphay  = 2149386176388565179336108717178566515317269076817344847408496293031466930889;
    uint256 constant betax1  = 9108445801991133926498850608731765842174916602550185155238560182031217722708;
    uint256 constant betax2  = 14818781438884321784061499534970460050654245679224525414414498764088214108256;
    uint256 constant betay1  = 8614652537510556249312084117332514533674986834004740247071849391420309212460;
    uint256 constant betay2  = 1793310289573649477545252403375660846919738375494100540178084176351610302385;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 6705268184151821718893888863832197353135931667183792402506286101904299700507;
    uint256 constant deltax2 = 15075145565917379908807061399166232799895809333833458989592564230615198333807;
    uint256 constant deltay1 = 9765165110877049886857244620689095687378666158705104083593586721976832314334;
    uint256 constant deltay2 = 10327506079811530650234727636900819033228369956785563642342042422225807553750;

    uint256 constant IC0x = 7713659498827250279719069914604356772880704532543809627856811826846966918611;
    uint256 constant IC0y = 3605598218356155129962879356117437374956511928261108062796212275209082043206;
    uint256 constant IC1x = 5083777641713105415868739165040607147970065946558348688865630874583607224306;
    uint256 constant IC1y = 7004231333925380641928322437714699133873550246321011820041629344171193564626;
    uint256 constant IC2x = 9810633747837499846044288117093350770048814434800438407298150589973311663796;
    uint256 constant IC2y = 15938981282359546127278476319590797734917410688925709460872244958093743840362;
    uint256 constant IC3x = 15864314922956427971489810049021348111978710833041815485609855655232145360120;
    uint256 constant IC3y = 3296585360692081723377891003068086018135007525051640200606220979583813798684;
    uint256 constant IC4x = 1283684192741975550743401675798649905624202134677656552586731757793431192963;
    uint256 constant IC4y = 11500178985021603039674135069672538794561637608813915604172160372304868186831;
    uint256 constant IC5x = 520817584974829581249939952553300981414381834327783001350897214940656170333;
    uint256 constant IC5y = 14167270267586825743938582075912047651882308859366493297630470009544325739943;

    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;
    uint16 constant pLastMem = 896;

    // ---- IVerifier ----

    function verifyPremiumProof(bytes calldata, uint256[] calldata) external view override returns (bool) {
        // Premium proof is handled by ZK_proof_premium/EZKL — not this circuit
        return false;
    }

    function verifyClaimProof(bytes calldata proof, uint256[] calldata pubSignals) external view override returns (bool) {
        require(pubSignals.length == 5, "ClaimVerifier: need 5 pubSignals");
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        // Route through the snarkjs-generated calldata variant — single source of
        // truth for the pairing math (a duplicated memory variant drifted).
        return this.verifyProof(a, b, c, [pubSignals[0], pubSignals[1], pubSignals[2], pubSignals[3], pubSignals[4]]);
    }

    // ---- snarkjs verifier — calldata variant (for direct calls, remix, scripts) ----
    function verifyProof(uint256[2] calldata _pA, uint256[2][2] calldata _pB, uint256[2] calldata _pC, uint256[5] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) { mstore(0, 0) return(0, 0x20) }
            }
            function g1_mulAccC(pR, x, y, s) {
                let mIn := mload(0x40)
                mstore(mIn, x) mstore(add(mIn, 32), y) mstore(add(mIn, 64), s)
                let success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)
                if iszero(success) { mstore(0, 0) return(0, 0x20) }
                mstore(add(mIn, 64), mload(pR)) mstore(add(mIn, 96), mload(add(pR, 32)))
                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)
                if iszero(success) { mstore(0, 0) return(0, 0x20) }
            }
            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)
                mstore(_pVk, IC0x) mstore(add(_pVk, 32), IC0y)
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))
                mstore(add(_pPairing, 192), alphax) mstore(add(_pPairing, 224), alphay)
                mstore(add(_pPairing, 256), betax1) mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1) mstore(add(_pPairing, 352), betay2)
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))
                mstore(add(_pPairing, 448), gammax1) mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1) mstore(add(_pPairing, 544), gammay2)
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))
                mstore(add(_pPairing, 640), deltax1) mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1) mstore(add(_pPairing, 736), deltay2)
                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)
                isOk := and(success, mload(_pPairing))
            }
            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))
            checkField(calldataload(add(_pubSignals, 0)))
            checkField(calldataload(add(_pubSignals, 32)))
            checkField(calldataload(add(_pubSignals, 64)))
            checkField(calldataload(add(_pubSignals, 96)))
            checkField(calldataload(add(_pubSignals, 128)))
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)
            mstore(0, isValid) return(0, 0x20)
        }
    }
}
