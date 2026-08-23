#!/usr/bin/env node
/**
 * Export snarkjs proof -> HealthInsurancePolicy IVerifier bytes + calldata
 *
 * Input:  test_vectors/claim_proof.json (pi_a, pi_b, pi_c) + claim_public.json
 * Output: test_vectors/claim_proof_bytes.hex  (abi.encode(a,b,c) for IVerifier)
 *         test_vectors/claim_calldata.json    (for hardhat / cast / remix)
 *         test_vectors/known_good_calldata.txt (legacy Groth16Verifier calldata)
 *
 * Public inputs order is frozen: circuits/claim.circom:159
 *   [0] policyId, [1] hospital_pk_x, [2] hospital_pk_y, [3] claim_nullifier, [4] payout_paise
 * HealthInsurancePolicy.submitClaimProof expects the same 5-element array (paise path)
 * and will convert payout paise -> wei via Chainlink inside the contract.
 *
 * Usage:
 *   node scripts/export_claim_proof.js
 *   node scripts/export_claim_proof.js --proof test_vectors/claim_proof.json --public test_vectors/claim_public.json
 */

const fs = require("fs");
const path = require("path");

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const i = a.indexOf(k);
    return i !== -1 && a[i + 1] ? a[i + 1] : d;
  };
  return {
    proof: get("--proof", path.join(__dirname, "..", "test_vectors", "claim_proof.json")),
    pub: get("--public", path.join(__dirname, "..", "test_vectors", "claim_public.json")),
    outBytes: get("--outBytes", path.join(__dirname, "..", "test_vectors", "claim_proof_bytes.hex")),
    outCalldata: get("--outCalldata", path.join(__dirname, "..", "test_vectors", "claim_calldata.json")),
  };
}

// Minimal ABI encoding for (uint[2], uint[2][2], uint[2]) without ethers — we shell out to node if ethers available
function encodeProof(proof) {
  try {
    const { ethers } = require("ethers");
    const abi = ethers.AbiCoder ? new ethers.AbiCoder() : null;
    // ethers v6
    if (abi) {
      return abi.encode(
        ["uint256[2]", "uint256[2][2]", "uint256[2]"],
        [proof.pi_a.slice(0, 2), [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]], proof.pi_c.slice(0, 2)]
      );
    }
  } catch (_) {}
  // fallback: manual — not needed for test, just instruct
  return null;
}

function main() {
  const { proof: proofPath, pub: pubPath, outBytes, outCalldata } = parseArgs();
  if (!fs.existsSync(proofPath)) {
    console.error(`proof not found: ${proofPath} — run: bash scripts/run_claim_flow.sh first`);
    process.exit(1);
  }
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  const pub = JSON.parse(fs.readFileSync(pubPath, "utf8"));

  // snarkjs proof shape: { pi_a: [x,y,1], pi_b: [[x1,x0],[y1,y0],[1,0]], pi_c: [x,y,1], protocol, curve }
  // For solidity, only first 2 elements of each are needed; pi_b needs coordinate swap (snarkjs stores [x_c1, x_c0] ...)
  // See snarkjs exportSolidityCallData
  const a = [proof.pi_a[0], proof.pi_a[1]];
  const b = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const c = [proof.pi_c[0], proof.pi_c[1]];

  console.log("Proof a:", a);
  console.log("Proof b:", b);
  console.log("Proof c:", c);
  console.log("Public (5):", pub);
  console.log("");

  // Encode for IVerifier: abi.encode(uint[2], uint[2][2], uint[2])
  function manualEncode(a, b, c) {
    const pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
    const toHex = (dec) => pad(BigInt(dec).toString(16));
    // static encoding: 8 words concatenated
    return "0x" + toHex(a[0]) + toHex(a[1]) + toHex(b[0][0]) + toHex(b[0][1]) + toHex(b[1][0]) + toHex(b[1][1]) + toHex(c[0]) + toHex(c[1]);
  }
  let encoded = null;
  try {
    const { ethers } = require("ethers");
    const coder = new ethers.AbiCoder();
    encoded = coder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [a, b, c]);
    fs.writeFileSync(outBytes, encoded);
    console.log(`Wrote IVerifier bytes -> ${path.relative(process.cwd(), outBytes)} (${encoded.length} chars) [ethers]`);
  } catch (e) {
    // also try ProofSure-main's ethers if claim-zk has none
    try {
      const { ethers } = require("/Users/aditya/Desktop/ZKML/ProofSure-main/node_modules/ethers");
      const coder = new ethers.AbiCoder();
      encoded = coder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [a, b, c]);
      fs.writeFileSync(outBytes, encoded);
      console.log(`Wrote IVerifier bytes -> ${path.relative(process.cwd(), outBytes)} (${encoded.length} chars) [ProofSure ethers]`);
    } catch (_) {
      encoded = manualEncode(a, b, c);
      fs.writeFileSync(outBytes, encoded);
      console.log(`Wrote IVerifier bytes -> ${path.relative(process.cwd(), outBytes)} (${encoded.length} chars) [manual]`);
    }
  }

  const calldata = {
    proofBytes: encoded,
    a, b, c,
    publicInputs: pub.map((x) => x.toString()),
    // for direct Groth16Verifier
    groth16Calldata: {
      a, b, c,
      pubSignals: pub,
    },
    // for HealthInsurancePolicy
    healthPolicyCall: {
      proof: encoded,
      publicInputs: pub,
      // helper: how to authorize hospital
      hospitalAuth: {
        pk_x: pub[1],
        pk_y: pub[2],
        keccakKey: "keccak256(abi.encode(pk_x, pk_y))",
        solidity: `policy.authorizeHospitalByKey(${pub[1]}, ${pub[2]})`
      },
      // preview conversion (paise->wei) — mirrors paiseToWei()
      payoutPaise: pub[4],
      previewWeiAt300k: (BigInt(pub[4]) * 10n ** 18n * 10n ** 8n / (100n * 300000n * 10n ** 8n)).toString(),
    },
    note: "HealthInsurancePolicy.submitClaimProof(proofBytes, publicInputs) — proofBytes is abi.encode(a,b,c). PublicInputs length 5 is ZK path (paise->wei via Chainlink inside contract). For legacy tests use length 4 [policyId, nullifier, payoutWei, hospitalAddress].",
  };
  fs.writeFileSync(outCalldata, JSON.stringify(calldata, null, 2));
  console.log(`Wrote HealthInsurancePolicy calldata -> ${path.relative(process.cwd(), outCalldata)}`);
  console.log("");
  console.log("Next (hardhat/Foundry):");
  console.log("  // deploy");
  console.log("  MockAggregatorV3 feed = new MockAggregatorV3(300000*1e8, 8);");
  console.log("  ClaimVerifier verifier = new ClaimVerifier();");
  console.log("  HealthInsurancePolicy policy = new HealthInsurancePolicy(address(verifier), address(feed));");
  console.log("  policy.authorizeHospitalByKey(pk_x, pk_y); // from above");
  console.log("  policy.createPolicy(holder, premiumWei, coverageLimitWei, deductible, coPayBps, duration, modelId);");
  console.log("  policy.fundReserve{value: 2 ether}();");
  console.log("  // submit");
  console.log("  policy.submitClaimProof(proofBytes, publicInputs); // pays holder in ETH at oracle price");
}

main();
