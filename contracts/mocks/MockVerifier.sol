// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../src/interfaces/IVerifier.sol";

contract MockVerifier is IVerifier {
    bool public alwaysValid = true;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function setAlwaysValid(bool _value) external {
        require(msg.sender == owner, "not owner");
        alwaysValid = _value;
    }

    function verifyPremiumProof(
        bytes calldata,
        uint256[] calldata
    ) external view override returns (bool) {
        return alwaysValid;
    }

    function verifyClaimProof(
        bytes calldata,
        uint256[] calldata
    ) external view override returns (bool) {
        return alwaysValid;
    }
}
