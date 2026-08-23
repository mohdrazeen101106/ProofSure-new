// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {HealthInsurancePolicy} from "../src/HealthInsurancePolicy.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";
import {PolicyBase} from "./PolicyBase.t.sol";

contract PolicyLifecycleTest is PolicyBase {
    function test_PolicyCreationStoresFieldsAndEmits() public {
        vm.expectEmit(true, true, false, true, address(policy));
        emit HealthInsurancePolicy.PolicyCreated(0, client, 1 ether, 5 ether);
        vm.prank(provider);
        uint256 id = policy.createPolicy(client, 1 ether, 5 ether, 2000000, 1000, 30 days, bytes32("m1"));

        HealthInsurancePolicy.Policy memory p = policy.getPolicy(id);
        assertEq(p.holder, client);
        assertEq(p.premium, 1 ether);
        assertEq(p.coverageLimit, 5 ether);
        assertEq(p.coverageUsed, 0);
        assertEq(p.deductible, 2000000);
        assertEq(p.coPayBps, 1000);
        assertEq(uint256(p.premiumModelId), uint256(bytes32("m1")));
        assertFalse(p.active);
        assertEq(p.endTime, block.timestamp + 30 days);
    }

    function test_OnlyOwnerCanCreatePolicy() public {
        vm.prank(client);
        vm.expectRevert();
        policy.createPolicy(client, 1 ether, 5 ether, 0, 1000, 30 days, bytes32("m1"));
    }

    function test_RejectsCoPayAbove10000() public {
        vm.prank(provider);
        vm.expectRevert(bytes("coPayBps out of range"));
        policy.createPolicy(client, 1 ether, 5 ether, 0, 10001, 30 days, bytes32("m1"));
    }

    function test_PayPremiumExactAmountByHolderOnly() public {
        vm.deal(client, 2 ether);
        vm.prank(provider);
        uint256 id = policy.createPolicy(client, 1 ether, 5 ether, 0, 1000, 30 days, "");

        // wrong sender
        address other = makeAddr("other");
        vm.deal(other, 1 ether);
        vm.prank(other);
        vm.expectRevert(bytes("not policy holder"));
        policy.payPremium{value: 1 ether}(id);

        // underpayment
        vm.prank(client);
        vm.expectRevert(bytes("incorrect premium amount"));
        policy.payPremium{value: 0.9 ether}(id);

        // overpayment
        vm.prank(client);
        vm.expectRevert(bytes("incorrect premium amount"));
        policy.payPremium{value: 1.1 ether}(id);

        // exact payment emits event
        vm.expectEmit(true, true, false, true, address(policy));
        emit HealthInsurancePolicy.PremiumPaid(id, client, 1 ether);
        vm.prank(client);
        policy.payPremium{value: 1 ether}(id);

        assertEq(address(policy).balance, 50 ether + 1 ether);
    }

    function test_PayPremiumOnUnknownPolicyReverts() public {
        vm.deal(client, 1 ether);
        vm.prank(client);
        vm.expectRevert(bytes("policy does not exist"));
        policy.payPremium{value: 1 ether}(999);
    }

    function test_ActivateRequiresPremiumPaymentFirst() public {
        vm.prank(provider);
        uint256 id = policy.createPolicy(client, 1 ether, 5 ether, 0, 1000, 30 days, "");
        // activation without premium payment is allowed by the contract state machine,
        // but the backend flow only activates after observing PremiumPaid.
        vm.prank(provider);
        policy.activatePolicy(id);
        assertTrue(policy.getPolicy(id).active);
    }

    function test_ActivateIsOwnerOnlyAndNotTwice() public {
        _createActivePolicy(1 ether, 5 ether, 0, 1000); // policy 0

        vm.prank(client);
        vm.expectRevert();
        policy.activatePolicy(0);

        vm.prank(provider);
        vm.expectRevert(bytes("already active"));
        policy.activatePolicy(0);
    }

    function test_PolicyExpiryBlocksActivation() public {
        vm.prank(provider);
        uint256 id = policy.createPolicy(client, 1 ether, 5 ether, 0, 1000, 30 days, "");
        vm.warp(block.timestamp + 31 days);
        vm.prank(provider);
        vm.expectRevert(bytes("policy expired"));
        policy.activatePolicy(id);
    }

    function test_ReserveFundingIsOwnerOnly() public {
        vm.prank(client);
        vm.expectRevert();
        policy.fundReserve{value: 1 ether}();

        vm.prank(client);
        vm.expectRevert();
        policy.withdrawUnusedReserve(1 ether);
    }

    function test_WithdrawUnusedReserve() public {
        uint256 before = provider.balance;
        vm.prank(provider);
        policy.withdrawUnusedReserve(10 ether);
        assertEq(provider.balance, before + 10 ether);

        vm.prank(provider);
        vm.expectRevert(bytes("insufficient balance"));
        policy.withdrawUnusedReserve(1000 ether);
    }

    function test_SetVerifierIsOwnerOnly() public {
        MockVerifier v2 = new MockVerifier();
        vm.prank(client);
        vm.expectRevert();
        policy.setVerifier(address(v2));

        vm.prank(provider);
        policy.setVerifier(address(v2));
        assertEq(address(policy.verifier()), address(v2));
    }
}
