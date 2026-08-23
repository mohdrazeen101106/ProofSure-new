#!/usr/bin/env node
/**
 * Generate hospital auth calldata for HealthInsurancePolicy (BabyJubJub key)
 * Reads test_vectors/hospital_registry.json and claim_public.json,
 * prints the keccak key and authorize call.
 */
const fs = require("fs");
const path = require("path");
const { buildPoseidon } = require("circomlibjs");

async function main() {
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test_vectors", "hospital_registry.json"), "utf8"));
  const pub = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test_vectors", "claim_public.json"), "utf8"));
  const pk_x = pub[1]; const pk_y = pub[2];
  console.log("Registered hospitals:");
  reg.hospitals.forEach(h => console.log(`  ${h.hospital_id} pk_x=${h.pk_x.slice(0,20)}... pk_y=${h.pk_y.slice(0,20)}...`));
  console.log("");
  console.log("Current claim publicInputs pk_x/pk_y:");
  console.log(`  pk_x = ${pk_x}`);
  console.log(`  pk_y = ${pk_y}`);
  console.log("");
  // compute keccak like Solidity: keccak256(abi.encode(pk_x, pk_y))
  try {
    const { ethers } = require("ethers");
    const coder = new ethers.AbiCoder();
    const encoded = coder.encode(["uint256","uint256"], [pk_x, pk_y]);
    const key = ethers.keccak256(encoded);
    console.log(`Solidity key = keccak256(abi.encode(pk_x, pk_y)) = ${key}`);
    console.log(`Call: policy.authorizeHospitalByKey("${pk_x}", "${pk_y}")`);
    console.log(`Check: policy.isHospitalAuthorizedByKey(pk_x, pk_y) => true`);
  } catch (_) {
    console.log("Install ethers to compute keccak, or use: cast keccak $(cast abi-encode \"f(uint256,uint256)\" <pk_x> <pk_y>)");
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
