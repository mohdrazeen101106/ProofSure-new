// Debug: replicate exactly what the circuit sees and test the minimal sig circuit.
const fs = require("fs");
const path = require("path");
const { buildEddsa, buildPoseidon } = require("circomlibjs");
const { execSync } = require("child_process");

(async () => {
  const input = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test_vectors", "claim_input.json"), "utf8"));
  const eddsa = await buildEddsa();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const msgFields = [
    BigInt(input.invoice_id), BigInt(input.policy_id), BigInt(input.patient_commitment),
    BigInt(input.treatment_code), BigInt(input.admission_date), BigInt(input.discharge_date),
    BigInt(input.total_expense),
  ];
  const msgHash = poseidon(msgFields.map((x) => F.e(x)));
  console.log("JS Poseidon(7) msgHash :", F.toString(msgHash));

  // What the circuit's Poseidon(7) would compute — recompute via circomlibjs on raw bigints
  const raw = poseidon(msgFields);
  console.log("raw bigint poseidon    :", F.toString(raw), "match:", F.toString(msgHash) === F.toString(raw));

  const sigInput = {
    Ax: input.hospital_pk_x,
    Ay: input.hospital_pk_y,
    R8x: input.sig_r_x,
    R8y: input.sig_r_y,
    S: input.sig_s,
    M: F.toString(msgHash),
  };
  fs.writeFileSync(path.join(__dirname, "..", "build", "sigtest_input.json"), JSON.stringify(sigInput));
  try {
    execSync(`npx snarkjs wtns calculate build/sigtest_js/sigtest.wasm ${path.join(__dirname, "..", "build", "sigtest_input.json")} ${path.join(__dirname, "..", "build", "sigtest.wtns")}`, { stdio: "pipe" });
    console.log("minimal EdDSA circuit  : PASS (signature valid for these values)");
  } catch (e) {
    console.log("minimal EdDSA circuit  : FAIL");
    console.log(e.stderr ? e.stderr.toString().slice(0, 500) : e.message);
  }
})();
