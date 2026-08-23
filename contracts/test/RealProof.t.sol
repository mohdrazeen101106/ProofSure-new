// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ClaimVerifier} from "../src/ClaimVerifier.sol";
import {Groth16Verifier} from "../src/verifier/ClaimProofVerifier.sol";

/// @notice Verifies the REAL Groth16 claim proof against the frozen test vectors in
///         circuits/claim-zk/test_vectors (docs/zk_interface.md known-good artifacts).
contract RealClaimProofTest is Test {
    ClaimVerifier internal claimVerifier;
    Groth16Verifier internal groth16;

    string constant TV = "../circuits/claim-zk/test_vectors";

    function setUp() public {
        claimVerifier = new ClaimVerifier();
        groth16 = new Groth16Verifier();
    }

    function _readTV(string memory name) internal view returns (string memory) {
        return vm.readFile(string.concat(TV, "/", name));
    }

    function _parsePubArray(string memory json) internal view returns (uint256[] memory) {
        return _pubFromStrings(vm.parseJsonStringArray(json, "$"));
    }

    function _pubFromStrings(string[] memory strs) internal pure returns (uint256[] memory) {
        uint256[] memory out = new uint256[](strs.length);
        for (uint256 i = 0; i < strs.length; i++) out[i] = vm.parseUint(strs[i]);
        return out;
    }

    function _loadGoodProofBytes() internal view returns (bytes memory) {
        string memory json = _readTV("claim_calldata.json");
        // proofBytes is "0x..." hex of abi.encode(uint[2] a, uint[2][2] b, uint[2] c)
        return vm.parseBytes(vm.parseJsonString(json, ".proofBytes"));
    }

    function _loadInvalidProofBytes() internal view returns (bytes memory) {
        string memory json = _readTV("invalid_proof.json");
        string[] memory a = vm.parseJsonStringArray(json, ".pi_a");
        string[] memory b0 = vm.parseJsonStringArray(json, ".pi_b[0]");
        string[] memory b1 = vm.parseJsonStringArray(json, ".pi_b[1]");
        string[] memory c = vm.parseJsonStringArray(json, ".pi_c");

        uint256[2] memory pa = [vm.parseUint(a[0]), vm.parseUint(a[1])];
        // snarkjs stores pi_b swapped vs solidity convention — mirror export_claim_proof.js
        uint256[2][2] memory pb = [
            [vm.parseUint(b0[1]), vm.parseUint(b0[0])],
            [vm.parseUint(b1[1]), vm.parseUint(b1[0])]
        ];
        uint256[2] memory pc = [vm.parseUint(c[0]), vm.parseUint(c[1])];
        return abi.encode(pa, pb, pc);
    }

    function _goodPubs() internal returns (uint256[] memory) {
        return _parsePubArray(_readTV("claim_public.json"));
    }

    function _invalidPubs() internal returns (uint256[] memory) {
        return _parsePubArray(_readTV("invalid_public_payout.json"));
    }

    function test_KnownGoodClaimProofVerifiesTrue() public {
        assertTrue(claimVerifier.verifyClaimProof(_loadGoodProofBytes(), _goodPubs()));
    }

    function test_TamperedPublicPayoutVerifiesFalse() public {
        // invalid_public_payout.json = same proof, payout bumped 6075000 -> 7075000 (+Rs 10,000)
        assertFalse(claimVerifier.verifyClaimProof(_loadGoodProofBytes(), _invalidPubs()));
    }

    function test_InvalidProofVerifiesFalse() public {
        assertFalse(claimVerifier.verifyClaimProof(_loadInvalidProofBytes(), _goodPubs()));
    }

    function test_RawSnarkjsVerifierDropInMatches() public {
        bytes memory proofBytes = _loadGoodProofBytes();
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            abi.decode(proofBytes, (uint256[2], uint256[2][2], uint256[2]));
        uint256[] memory pub = _goodPubs();

        assertTrue(groth16.verifyProof(a, b, c, [pub[0], pub[1], pub[2], pub[3], pub[4]]));
        assertFalse(groth16.verifyProof(a, b, c, [_invalidPubs()[0], _invalidPubs()[1], _invalidPubs()[2], _invalidPubs()[3], _invalidPubs()[4]]));
    }

    function test_PublicInputOrderIsFrozenPerZkInterface() public {
        // docs/zk_interface.md: [policy_id, hospital_pk_x, hospital_pk_y, claim_nullifier, payout_amount(paise)]
        uint256[] memory pub = _goodPubs();
        assertEq(pub.length, 5);
        assertEq(pub[0], 555000111); // policy_id
        assertLt(pub[4], 100_000_000); // payout in paise scale (Rs 60,750 -> 6075000)
        assertEq(pub[4], 6075000);
    }
}
