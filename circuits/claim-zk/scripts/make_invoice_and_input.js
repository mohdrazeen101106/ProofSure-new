const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { buildEddsa, buildPoseidon } = require("circomlibjs");
const { Scalar } = require("ffjavascript");

// Canonical decimal string of an internal (WasmField) element
const feDec = (F, el) => F.toObject(el).toString(10);

// Builds a signed hospital invoice + full circuit input (claim_input.json).
//
// Usage:
//   node scripts/make_invoice_and_input.js [config.json]
// Default config: test_vectors/claim_config.json

const DEFAULT_CONFIG = {
  hospital_id: "HOSP001",
  invoice_id: 100237,
  policy_id: 555000111,
  patient_commitment: null, // random if null
  treatment_code: 1, // 1=HOSPITALIZATION 2=SURGERY 3=EMERGENCY 4=ICU
  admission_date: 1770662400, // unix seconds
  discharge_date: 1170921600 - 3600, // placeholder, overwritten below
  expenses_paise: [
    3500000, // room charges      Rs 35,000
    2500000, // surgery           Rs 25,000
    1200000, // pharmacy          Rs 12,00,0 -> keep simple
    900000,  // diagnostics       Rs  9,000
    650000,  // consultations     Rs  6,500
    0,
    0,
    0,
  ],
  deductible_paise: 2000000, // Rs 20,000
  copay_bps: 1000, // 10%
  coverage_limit_paise: 50000000, // Rs 5,00,000
  coverage_used_before_paise: 0,
};

function decimal(B) { return B.toString(10); }

async function main() {
  const cfgPath = process.argv[2] || path.join(__dirname, "..", "test_vectors", "claim_config.json");
  const cfg = fs.existsSync(cfgPath)
    ? JSON.parse(fs.readFileSync(cfgPath, "utf8"))
    : DEFAULT_CONFIG;

  const eddsa = await buildEddsa();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const keys = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "test_vectors", "hospital_keys.json"), "utf8"));
  const registry = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "test_vectors", "hospital_registry.json"), "utf8"));

  const sk = Buffer.from(keys[cfg.hospital_id].sk_hex, "hex");
  const pub = eddsa.prv2pub(sk); // [x, y] as 32-byte LE buffers
  const entry = registry.hospitals.find((h) => h.hospital_id === cfg.hospital_id);
  if (!entry || feDec(F, pub[0]) !== entry.pk_x) {
    throw new Error(`hospital_id ${cfg.hospital_id} does not match registry pubkey`);
  }

  const N_EXPENSES = 8;
  const expenses = cfg.expenses_paise.slice(0, N_EXPENSES);
  while (expenses.length < N_EXPENSES) expenses.push(0);
  const totalExpense = expenses.reduce((a, b) => a + BigInt(b), BigInt(0));
  const discharge = cfg.discharge_date > cfg.admission_date
    ? cfg.discharge_date : Number(cfg.admission_date) + 86400;
  const patientCommitment = cfg.patient_commitment
    ?? BigInt("0x" + crypto.randomBytes(30).toString("hex")).toString(10);

  const invoiceFields = [
    BigInt(cfg.invoice_id),
    BigInt(cfg.policy_id),
    BigInt(patientCommitment),
    BigInt(cfg.treatment_code),
    BigInt(cfg.admission_date),
    BigInt(discharge),
    totalExpense,
  ];

  // Message signed by the hospital: Poseidon over the 7 canonical fields.
  const msgHash = poseidon(invoiceFields.map((x) => F.e(x)));
  const signature = eddsa.signPoseidon(sk, msgHash);
  // R8 components are 32-byte LE buffers, S is a BigInt

  // Sanity: JS-side verify before wasting a proving run.
  const ok = eddsa.verifyPoseidon(msgHash, signature, pub);
  if (!ok) throw new Error("JS-side signature self-check failed");

  const nullifierSecret = BigInt("0x" + crypto.randomBytes(30).toString("hex")).toString(10);

  // claim_nullifier = Poseidon(policy_id, invoice_id, secret)
  const nullifier = poseidon([F.e(BigInt(cfg.policy_id)), F.e(BigInt(cfg.invoice_id)), F.e(nullifierSecret)]);
  const nullifierDec = F.toString(nullifier);

  const input = {
    // public
    policy_id: cfg.policy_id.toString(),
    hospital_pk_x: feDec(F, pub[0]),
    hospital_pk_y: feDec(F, pub[1]),
    claim_nullifier: nullifierDec,
    payout_amount: null, // filled below
    // private — signature
    sig_r_x: feDec(F, signature.R8[0]),
    sig_r_y: feDec(F, signature.R8[1]),
    sig_s: signature.S.toString(10),
    // private — invoice
    invoice_id: cfg.invoice_id.toString(),
    patient_commitment: patientCommitment,
    treatment_code: cfg.treatment_code,
    admission_date: cfg.admission_date,
    discharge_date: discharge,
    expenses: expenses.map((e) => e.toString()),
    total_expense: totalExpense.toString(),
    // private — policy / coverage
    deductible_paise: cfg.deductible_paise,
    copay_bps: cfg.copay_bps,
    coverage_used_before: cfg.coverage_used_before_paise,
    coverage_limit: cfg.coverage_limit_paise,
    // private — nullifier
    nullifier_secret: nullifierSecret,
  };

  // Expected settlement per handout formula (mirrors circuit):
  // payout = floor((total - deductible) * (10000 - copay_bps) / 10000)
  const eligible = totalExpense - BigInt(cfg.deductible_paise);
  if (eligible < 0n) throw new Error("total expense below deductible — witness would fail");
  const gross = eligible * BigInt(10000 - cfg.copay_bps);
  const payout = gross / 10000n; // floor
  input.payout_amount = payout.toString();
  // private — settlement remainder (gross % 10000, proves floor division)
  input.settlement_remainder = Number(gross % 10000n);

  const outDir = path.join(__dirname, "..", "test_vectors");
  const invoiceDoc = {
    format: "signed_hospital_invoice_v1",
    encoding_note: "All numeric fields are integers. Amounts in PAISE. Signature is EdDSA-Poseidon (BabyJubJub) over Poseidon([invoice_id, policy_id, patient_commitment, treatment_code, admission_date, discharge_date, total_expense]).",
    hospital_id: cfg.hospital_id,
    invoice_id: cfg.invoice_id,
    policy_id: cfg.policy_id,
    patient_commitment: patientCommitment,
    treatment_code: cfg.treatment_code,
    treatment_name: { 1: "HOSPITALIZATION", 2: "SURGERY", 3: "EMERGENCY", 4: "ICU" }[cfg.treatment_code],
    admission_date: cfg.admission_date,
    discharge_date: discharge,
    expenses_paise: expenses.map((e) => e.toString()),
    total_expense_paise: totalExpense.toString(),
    signature_r_x: Buffer.from(signature.R8[0]).toString("hex"),
    signature_r_y: Buffer.from(signature.R8[1]).toString("hex"),
    signature_s: signature.S.toString(10),
  };

  fs.writeFileSync(path.join(outDir, "invoice_signed.json"), JSON.stringify(invoiceDoc, null, 2));
  fs.writeFileSync(path.join(outDir, "claim_input.json"), JSON.stringify(input, null, 2));

  console.log("Signed invoice  -> test_vectors/invoice_signed.json");
  console.log("Circuit input   -> test_vectors/claim_input.json");
  console.log("");
  console.log("--- PUBLIC INPUTS (exact order for contract) ---");
  console.log("[0] policy_id            =", input.policy_id);
  console.log("[1] hospital_pk_x        =", input.hospital_pk_x);
  console.log("[2] hospital_pk_y        =", input.hospital_pk_y);
  console.log("[3] claim_nullifier      =", input.claim_nullifier);
  console.log("[4] payout_amount(paise) =", input.payout_amount, `(Rs ${(Number(payout)/100).toLocaleString("en-IN")})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
