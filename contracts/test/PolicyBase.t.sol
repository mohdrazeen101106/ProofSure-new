// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {HealthInsurancePolicy} from "../src/HealthInsurancePolicy.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";
import {MockAggregatorV3} from "../mocks/MockAggregatorV3.sol";
import {ReentrantHolder} from "./ReentrantHolder.sol";

/// @notice Shared base: MockVerifier-backed policy with a mock 300,000 INR/ETH feed.
abstract contract PolicyBase is Test {
    HealthInsurancePolicy internal policy;
    MockVerifier internal mockVerifier;
    MockAggregatorV3 internal feed;

    address internal provider = makeAddr("provider");
    address internal client = makeAddr("client");
    address internal hospital = makeAddr("hospital");

    // 5-input ZK path: [policyId, pk_x, pk_y, nullifier, payoutPaise]
    uint256 constant HOSP_PK_X = 12345;
    uint256 constant HOSP_PK_Y = 67890;
    uint256 constant PAISE = 6075000; // Rs 60,750

    function setUp() public virtual {
        vm.startPrank(provider);
        mockVerifier = new MockVerifier();
        feed = new MockAggregatorV3(300000e8, 8);
        policy = new HealthInsurancePolicy(address(mockVerifier), address(feed));
        vm.stopPrank();

        // seed reserve
        vm.deal(provider, 100 ether);
        vm.prank(provider);
        policy.fundReserve{value: 50 ether}();
    }

    function _createActivePolicy(
        uint256 premiumWei,
        uint256 coverageLimitWei,
        uint256 deductiblePaise,
        uint256 coPayBps
    ) internal returns (uint256 policyId) {
        vm.deal(client, premiumWei + 1 ether);
        vm.prank(provider);
        policyId = policy.createPolicy(
            client,
            premiumWei,
            coverageLimitWei,
            deductiblePaise,
            coPayBps,
            365 days,
            bytes32("premium-model-v1")
        );
        vm.prank(client);
        policy.payPremium{value: premiumWei}(policyId);
        vm.prank(provider);
        policy.activatePolicy(policyId);
    }

    /// @dev Build 5-input public inputs for the ZK claim path.
    function _zkInputs(uint256 policyId, uint256 nullifier, uint256 payoutPaise)
        internal
        pure
        returns (uint256[] memory)
    {
        uint256[] memory inputs = new uint256[](5);
        inputs[0] = policyId;
        inputs[1] = HOSP_PK_X;
        inputs[2] = HOSP_PK_Y;
        inputs[3] = nullifier;
        inputs[4] = payoutPaise;
        return inputs;
    }

    /// @dev Legacy 4-input path: [policyId, nullifier, payoutWei, hospitalAddr]
    function _legacyInputs(uint256 policyId, bytes32 nullifier, uint256 payoutWei)
        internal
        view
        returns (uint256[] memory)
    {
        uint256[] memory inputs = new uint256[](4);
        inputs[0] = policyId;
        inputs[1] = uint256(nullifier);
        inputs[2] = payoutWei;
        inputs[3] = uint256(uint160(hospital));
        return inputs;
    }
}
