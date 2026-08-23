// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Test helper: a policy holder contract that attempts to re-enter
///         submitClaimProof from its receive() hook during payout.
contract ReentrantHolder {
    address public immutable insurance;
    bytes32 public reenterNullifier;
    bool public attacking;

    constructor(address _insurance) {
        insurance = _insurance;
    }

    function payPremium(uint256 policyId) external payable {
        IInsurance(insurance).payPremium{value: msg.value}(policyId);
    }

    function arm(bytes32 nullifier) external {
        reenterNullifier = nullifier;
    }

    function setAttacking(bool value) external {
        attacking = value;
    }

    function claim(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external {
        (bool ok, ) = insurance.call(
            abi.encodeCall(IInsurance.submitClaimProof, (proof, publicInputs))
        );
        require(ok, "claim call failed");
    }

    receive() external payable {
        if (attacking) {
            IInsurance(insurance).submitClaimProof(
                "",
                new uint256[](0)
            );
        }
    }
}

interface IInsurance {
    function payPremium(uint256 policyId) external payable;

    function submitClaimProof(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external returns (uint256);
}
