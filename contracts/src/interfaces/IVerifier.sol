// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVerifier {
    function verifyPremiumProof(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool);

    function verifyClaimProof(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool);
}
