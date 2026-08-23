// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {HealthInsurancePolicy} from "../src/HealthInsurancePolicy.sol";
import {PolicyBase} from "./PolicyBase.t.sol";
import {ReentrantHolder} from "./ReentrantHolder.sol";

contract ClaimFlowTest is PolicyBase {
    uint256 internal policyId;

    function setUp() public override {
        super.setUp();
        // 1 ETH premium, 5 ETH coverage limit
        policyId = _createActivePolicy(1 ether, 5 ether, 2000000, 1000);
    }

    function _authorizeZkHospital() internal {
        vm.prank(provider);
        policy.authorizeHospitalByKey(HOSP_PK_X, HOSP_PK_Y);
    }

    function test_ZkClaimPaysHolderAndUpdatesState() public {
        _authorizeZkHospital();

        uint256 holderBefore = client.balance;
        uint256 expectedWei = policy.paiseToWei(PAISE); // 6075000 paise -> 0.2025 ETH @300k INR/ETH

        vm.expectEmit(true, true, true, true, address(policy));
        emit HealthInsurancePolicy.ClaimPaid(0, policyId, client, expectedWei);
        vm.prank(makeAddr("relayer"));
        uint256 claimId = policy.submitClaimProof("proof", _zkInputs(policyId, 42, PAISE));

        HealthInsurancePolicy.Claim memory c = policy.getClaim(claimId);
        assertTrue(c.processed);
        assertEq(c.payoutWei, expectedWei);
        assertEq(c.nullifier, bytes32(uint256(42)));
        assertEq(client.balance, holderBefore + expectedWei);

        HealthInsurancePolicy.Policy memory p = policy.getPolicy(policyId);
        assertEq(p.coverageUsed, expectedWei);
    }

    function test_KeyRegistryAuthorizeRemoveAndQuery() public {
        assertFalse(policy.isHospitalAuthorizedByKey(HOSP_PK_X, HOSP_PK_Y));

        vm.prank(client);
        vm.expectRevert();
        policy.authorizeHospitalByKey(HOSP_PK_X, HOSP_PK_Y);

        vm.prank(provider);
        policy.authorizeHospitalByKey(HOSP_PK_X, HOSP_PK_Y);
        assertTrue(policy.isHospitalAuthorizedByKey(HOSP_PK_X, HOSP_PK_Y));

        vm.prank(provider);
        policy.removeHospitalByKey(HOSP_PK_X, HOSP_PK_Y);
        assertFalse(policy.isHospitalAuthorizedByKey(HOSP_PK_X, HOSP_PK_Y));
    }

    function test_AddressRegistryLegacyPath() public {
        vm.prank(provider);
        policy.addHospital(hospital);
        assertTrue(policy.isHospitalAuthorized(hospital));

        uint256 holderBefore = client.balance;
        vm.prank(makeAddr("relayer"));
        policy.submitClaimProof("proof", _legacyInputs(policyId, keccak256("inv1"), 1 ether));
        assertEq(client.balance, holderBefore + 1 ether);
    }

    function test_UnauthorizedKeyHospitalRejected() public {
        vm.prank(makeAddr("relayer"));
        vm.expectRevert(bytes("hospital not authorized"));
        policy.submitClaimProof("proof", _zkInputs(policyId, 42, PAISE));
    }

    function test_UnauthorizedAddressHospitalRejectedLegacy() public {
        vm.prank(makeAddr("relayer"));
        vm.expectRevert(bytes("hospital not authorized"));
        policy.submitClaimProof("proof", _legacyInputs(policyId, keccak256("x"), 1 ether));
    }

    function test_InactivePolicyRejectsClaims() public {
        _authorizeZkHospital();
        vm.prank(provider);
        uint256 id2 = policy.createPolicy(client, 1 ether, 5 ether, 0, 1000, 30 days, "");
        // never paid/activated
        vm.prank(makeAddr("relayer"));
        vm.expectRevert(bytes("policy not active"));
        policy.submitClaimProof("proof", _zkInputs(id2, 43, PAISE));
    }

    function test_ExpiredPolicyRejectsClaims() public {
        _authorizeZkHospital();
        vm.warp(block.timestamp + 366 days);
        feed.setRoundData(300000e8, block.timestamp); // refresh oracle, else StalePrice hits first
        vm.prank(makeAddr("relayer"));
        vm.expectRevert(bytes("policy expired"));
        policy.submitClaimProof("proof", _zkInputs(policyId, 44, PAISE));
    }

    function test_InvalidProofRejectedWhenVerifierSaysNo() public {
        _authorizeZkHospital();
        vm.prank(provider);
        mockVerifier.setAlwaysValid(false);
        vm.prank(makeAddr("relayer"));
        vm.expectRevert(bytes("invalid claim proof"));
        policy.submitClaimProof("bad-proof", _zkInputs(policyId, 45, PAISE));
    }

    function test_DuplicateNullifierRejected() public {
        _authorizeZkHospital();
        vm.startPrank(makeAddr("relayer"));
        policy.submitClaimProof("proof-a", _zkInputs(policyId, 777, PAISE));
        vm.expectRevert(bytes("nullifier already used"));
        policy.submitClaimProof("proof-b", _zkInputs(policyId, 777, PAISE));
        vm.stopPrank();
    }

    function test_PayoutAboveRemainingCoverageRejected() public {
        _authorizeZkHospital();
        vm.startPrank(makeAddr("relayer"));
        policy.submitClaimProof("proof", _zkInputs(policyId, 1, 100000000)); // Rs 10,00,000 ~ 3.33 ETH
        uint256[] memory big = _zkInputs(policyId, 2, 600000000); // Rs 60,00,000 > remaining
        vm.expectRevert(bytes("exceeds remaining coverage"));
        policy.submitClaimProof("proof", big);
        vm.stopPrank();
    }

    function test_MultipleClaimsAccumulateCoverageUsed() public {
        _authorizeZkHospital();
        vm.startPrank(makeAddr("relayer"));
        policy.submitClaimProof("p1", _zkInputs(policyId, 11, 8750000)); // Rs 87,500
        policy.submitClaimProof("p2", _zkInputs(policyId, 12, 6075000)); // Rs 60,750
        vm.stopPrank();

        HealthInsurancePolicy.Policy memory p = policy.getPolicy(policyId);
        uint256 used = policy.paiseToWei(8750000) + policy.paiseToWei(6075000);
        assertEq(p.coverageUsed, used);
    }

    function test_InsufficientReserveRevertsAtomically() public {
        _authorizeZkHospital();
        uint256 drained = address(policy).balance;
        vm.prank(provider);
        policy.withdrawUnusedReserve(drained);

        vm.prank(makeAddr("relayer"));
        vm.expectRevert(bytes("insufficient reserve"));
        policy.submitClaimProof("proof", _zkInputs(policyId, 99, PAISE));

        assertFalse(policy.usedNullifiers(bytes32(uint256(99))));
    }

    function test_MalformedPublicInputsRejected() public {
        uint256[] memory bad = new uint256[](3);
        vm.prank(makeAddr("relayer"));
        vm.expectRevert(bytes("malformed public inputs"));
        policy.submitClaimProof("proof", bad);
    }

    function test_ReentrancyAttackFails() public {
        ReentrantHolder holder = new ReentrantHolder(address(policy));
        vm.deal(address(holder), 2 ether);

        vm.prank(provider);
        uint256 pid = policy.createPolicy(address(holder), 1 ether, 5 ether, 0, 1000, 30 days, "");
        vm.prank(address(holder));
        holder.payPremium{value: 1 ether}(pid);
        vm.prank(provider);
        policy.activatePolicy(pid);
        vm.prank(provider);
        policy.addHospital(hospital);

        bytes32 nf = keccak256("reenter");
        holder.arm(nf);

        holder.setAttacking(true);
        vm.expectRevert(bytes("claim call failed"));
        holder.claim("proof", _legacyInputs(pid, nf, 1 ether));

        assertFalse(policy.getClaim(0).processed);

        // without attack the same claim settles fine
        holder.setAttacking(false);
        holder.claim("proof", _legacyInputs(pid, nf, 1 ether));
        assertTrue(policy.getClaim(0).processed);
    }
}
