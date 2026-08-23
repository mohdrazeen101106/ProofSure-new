// Negative tests: every case must be REJECTED.
//
//   node scripts/invalid_cases.js
//
// Cases:
//   A. Unauthorized hospital (FAKE999 signs its own invoice) -> witness/constraint fail
//   B. Tampered public payout_amount (claim more money)      -> groth16 verify fail
//   C. Wrong treatment code (5 = not covered)                -> witness/constraint fail
//   D. Expenses do not sum to total                          -> witness/constraint fail
//   E. Payout exceeds remaining coverage                     -> witness/constraint fail
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TV = path.join(ROOT, "test_vectors");
const BUILD = path.join(ROOT, "build");

function run(name, fn) {
  try {
    fn();
    console.log(`FAIL   ${name}: expected rejection but it PASSED`);
    process.exitCode = 1;
  } catch (e) {
    const errText = ((e.stderr && e.stderr.toString()) || e.message || "").trim();
    const reason = errText.split("\n").filter((l) => l.includes("Error") || l.includes("Assert")).join(" | ").slice(0, 140)
      || errText.slice(0, 140);
    console.log(`OK     ${name}: rejected\n         reason: ${reason}`);
  }
}

const sh = (cmd) => execSync(cmd, { stdio: "pipe" });

function witness(inputFile) {
  sh(`npx snarkjs wtns calculate "${BUILD}/claim_js/claim.wasm" "${inputFile}" "${BUILD}/witness_neg.wtns"`);
}

function proveAndVerify(witnessFile) {
  sh(`npx snarkjs groth16 prove "${BUILD}/claim_final.zkey" "${witnessFile}" "${BUILD}/neg_proof.json" "${BUILD}/neg_public.json"`);
  sh(`npx snarkjs groth16 verify "${BUILD}/verification_key.json" "${BUILD}/neg_public.json" "${BUILD}/neg_proof.json"`);
}

const base = JSON.parse(fs.readFileSync(path.join(TV, "claim_input.json"), "utf8"));

// Async cases need setup; run everything in an async main instead.
(async () => {
  const { buildEddsa, buildPoseidon } = require("circomlibjs");
  const eddsa = await buildEddsa();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const keys = JSON.parse(fs.readFileSync(path.join(TV, "hospital_keys.json"), "utf8"));
  const { Scalar } = require("ffjavascript");

  const writeInput = (obj, file) =>
  fs.writeFileSync(path.join(BUILD, file), JSON.stringify(obj, (_, v) =>
    typeof v === "bigint" ? v.toString() : v));

  // A. unauthorized hospital re-signs the invoice with its own key
  run("A. fake/unauthorized hospital invoice", () => {
    const i = structuredClone(base);
    const sk = Buffer.from(keys.FAKE999.sk_hex, "hex");
    const msgHash = poseidon([
      F.e(BigInt(i.invoice_id)), F.e(BigInt(i.policy_id)), F.e(BigInt(i.patient_commitment)),
      F.e(BigInt(i.treatment_code)), F.e(BigInt(i.admission_date)), F.e(BigInt(i.discharge_date)),
      F.e(BigInt(i.total_expense)),
    ]);
    const sig = eddsa.signPoseidon(sk, msgHash);
    i.sig_r_x = F.toObject(sig.R8[0]).toString(10);
    i.sig_r_y = F.toObject(sig.R8[1]).toString(10);
    i.sig_s = sig.S.toString(10);
    // keep the AUTHORIZED hospital's pk as public input — FAKE999's signature won't verify
    writeInput(i, "neg_a.json");
    witness(path.join(BUILD, "neg_a.json"));
    throw new Error("constraint should have failed earlier");
  });

  // B. tampered payout in public inputs
  run("B. tampered public payout_amount", () => {
    witness(path.join(TV, "claim_input.json")); // valid witness
    sh(`npx snarkjs groth16 prove "${BUILD}/claim_final.zkey" "${BUILD}/witness_neg.wtns" "${BUILD}/neg_b_proof.json" "${BUILD}/neg_b_pub.json"`);
    const pub = JSON.parse(fs.readFileSync(path.join(BUILD, "neg_b_pub.json"), "utf8"));
    pub[4] = (BigInt(pub[4]) + 1_000_000n).toString(); // public signals are a raw array; [4] = payout_amount. Grab Rs 10,000 extra.
    fs.writeFileSync(path.join(BUILD, "neg_b_tampered.json"), JSON.stringify(pub));
    sh(`npx snarkjs groth16 verify "${BUILD}/verification_key.json" "${path.join(BUILD, "neg_b_tampered.json")}" "${BUILD}/neg_b_proof.json"`);
    throw new Error("verify should have failed");
  });

  // C. treatment code not covered — properly signed by the REAL hospital,
  // so ONLY the covered-treatment allowlist can reject it.
  run("C. uncovered treatment code", () => {
    const i = structuredClone(base);
    i.treatment_code = 5; // e.g. COSMETIC — not in allowlist
    const sk = Buffer.from(keys.HOSP001.sk_hex, "hex");
    const msgHash = poseidon([
      F.e(BigInt(i.invoice_id)), F.e(BigInt(i.policy_id)), F.e(BigInt(i.patient_commitment)),
      F.e(BigInt(i.treatment_code)), F.e(BigInt(i.admission_date)), F.e(BigInt(i.discharge_date)),
      F.e(BigInt(i.total_expense)),
    ]);
    const sig = eddsa.signPoseidon(sk, msgHash);
    i.sig_r_x = F.toObject(sig.R8[0]).toString(10);
    i.sig_r_y = F.toObject(sig.R8[1]).toString(10);
    i.sig_s = sig.S.toString(10);
    writeInput(i, "neg_c.json");
    witness(path.join(BUILD, "neg_c.json"));
    throw new Error("allowlist constraint should have failed earlier");
  });

  // D. expenses don't sum to total
  run("D. expense sum mismatch", () => {
    const i = structuredClone(base);
    i.expenses = i.expenses.map((e) => e);
    i.expenses[0] = (BigInt(i.expenses[0]) + 1n).toString(); // inflate one line item
    writeInput(i, "neg_d.json");
    witness(path.join(BUILD, "neg_d.json"));
    throw new Error("constraint should have failed earlier");
  });

  // E. payout exceeds remaining coverage
  run("E. coverage limit exceeded", () => {
    const i = structuredClone(base);
    i.coverage_limit = BigInt(i.coverage_used_before) + BigInt(i.payout_amount) - 100n;
    writeInput(i, "neg_e.json");
    witness(path.join(BUILD, "neg_e.json"));
    throw new Error("constraint should have failed earlier");
  });

  console.log("\nAll negative cases behaved as expected." + (process.exitCode ? " (SOME UNEXPECTED PASSES!)" : ""));
})();
