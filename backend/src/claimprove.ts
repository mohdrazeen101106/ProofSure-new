import path from "path";
import fs from "fs";
import crypto from "crypto";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import { AbiCoder } from "ethers";
import { config } from "./config";
import { store } from "./store";

/** Hospital-signed invoices + Groth16 claim proving (circuits/claim-zk artifacts).
 *
 *  NOTE (demo scope): proving runs server-side here for reliability; the circuit
 *  and its inputs are designed so this step can move into the claimant's browser
 *  (snarkjs wasm) without changing any public encoding — see interfaces/zk-interface.md.
 */

const feDec = (F: any, el: unknown) => F.toObject(el).toString(10);

const TV = path.join(config.claimZkDir, "test_vectors");
const BUILD = path.join(config.claimZkDir, "build");

const TREATMENT_NAMES: Record<number, string> = {
  1: "HOSPITALIZATION",
  2: "SURGERY",
  3: "EMERGENCY",
  4: "ICU",
};

export interface InvoiceRequest {
  hospital_id: string;
  policy_id: string | number;
  treatment_code: number;
  admission_date: number;
  discharge_date?: number;
  expenses_paise: (string | number)[];
  patient_commitment?: string;
}

export interface ClaimProveRequest extends InvoiceRequest {
  deductible_paise: string | number;
  copay_bps: number;
  coverage_limit_paise: string | number;
  coverage_used_before_paise?: string | number;
}

let eddsaCache: any = null;
let poseidonCache: any = null;
async function eddsa() {
  if (!eddsaCache) eddsaCache = await buildEddsa();
  return eddsaCache;
}
async function poseidon() {
  if (!poseidonCache) poseidonCache = await buildPoseidon();
  return poseidonCache;
}

function allKeys(): Record<string, any> {
  let base: Record<string, any> = {};
  try {
    base = JSON.parse(fs.readFileSync(path.join(TV, "hospital_keys.json"), "utf8"));
  } catch {
    /* none */
  }
  return { ...base, ...store.db.hospitalKeys };
}

export function listHospitals() {
  const keys = allKeys();
  return Object.entries(keys).map(([id, k]) => ({
    hospital_id: id,
    pk_x: String(k.pk_x ?? ""),
    pk_y: String(k.pk_y ?? ""),
    label: k.label ?? "",
    sk_hex: k.sk_hex, // demo scope only — never expose in production
  }));
}

export async function generateHospitalKey(hospitalId: string, label?: string) {
  const ed = await eddsa();
  const sk = crypto.randomBytes(32);
  const pub = ed.prv2pub(sk);
  const rec = {
    sk_hex: sk.toString("hex"),
    pk_x: feDec(ed.F, pub[0]),
    pk_y: feDec(ed.F, pub[1]),
    label: label || `Hospital ${hospitalId}`,
  };
  store.setHospitalKey(hospitalId, rec);
  return { hospital_id: hospitalId, ...rec };
}

async function keypair(hospitalId: string) {
  const keys = allKeys();
  const k = keys[hospitalId];
  if (!k) throw new Error(`Unknown hospital "${hospitalId}"`);
  const ed = await eddsa();
  const sk = Buffer.from(k.sk_hex, "hex");
  const pub = ed.prv2pub(sk);
  return { sk, pub, pk_x: feDec(ed.F, pub[0]), pk_y: feDec(ed.F, pub[1]) };
}

/** Sign an itemized invoice with the hospital's EdDSA-Poseidon key. */
export async function signInvoice(req: InvoiceRequest) {
  const ed = await eddsa();
  const P = await poseidon();
  const F = P.F;

  const { sk, pub, pk_x, pk_y } = await keypair(req.hospital_id);

  const N_EXPENSES = 8;
  const expenses = req.expenses_paise.map((e) => BigInt(e)).slice(0, N_EXPENSES);
  while (expenses.length < N_EXPENSES) expenses.push(0n);

  const totalExpense = expenses.reduce((a, b) => a + b, 0n);
  const admission = Number(req.admission_date);
  const discharge = req.discharge_date && req.discharge_date > admission ? Number(req.discharge_date) : admission + 86400;
  const patientCommitment =
    req.patient_commitment ??
    BigInt("0x" + crypto.randomBytes(30).toString("hex")).toString(10);

  // unique per invoice content for this demo deployment
  const invoiceId = 100000 + (Date.now() % 900000);

  const msgHash = P(
    [BigInt(invoiceId), BigInt(req.policy_id), BigInt(patientCommitment), BigInt(req.treatment_code), BigInt(admission), BigInt(discharge), totalExpense].map((x) => F.e(x))
  );
  const signature = ed.signPoseidon(sk, msgHash);
  if (!ed.verifyPoseidon(msgHash, signature, pub)) {
    throw new Error("JS-side signature self-check failed");
  }

  const invoiceDoc = {
    format: "signed_hospital_invoice_v1",
    encoding_note:
      "All numeric fields are integers. Amounts in PAISE. Signature is EdDSA-Poseidon (BabyJubJub) over Poseidon([invoice_id, policy_id, patient_commitment, treatment_code, admission_date, discharge_date, total_expense]).",
    hospital_id: req.hospital_id,
    hospital_pk_x: pk_x,
    hospital_pk_y: pk_y,
    invoice_id: invoiceId,
    policy_id: String(req.policy_id),
    patient_commitment: patientCommitment.toString(),
    treatment_code: req.treatment_code,
    treatment_name: TREATMENT_NAMES[req.treatment_code] || "UNKNOWN",
    admission_date: admission,
    discharge_date: discharge,
    expenses_paise: expenses.map((e) => e.toString()),
    total_expense_paise: totalExpense.toString(),
    signature_r_x: Buffer.from(signature.R8[0]).toString("hex"),
    signature_r_y: Buffer.from(signature.R8[1]).toString("hex"),
    // canonical field-element decimals used by the circuit input
    // (F.toObject on wasm-field buffers is NOT a plain byte-order reinterpretation)
    sig_r_x_dec: feDec(F, signature.R8[0]),
    sig_r_y_dec: feDec(F, signature.R8[1]),
    signature_s: signature.S.toString(10),
  };
  return invoiceDoc;
}

/** Build full circuit input from a signed invoice + private policy params. */
export async function circuitInput(invoice: any, priv: ClaimProveRequest) {
  const P = await poseidon();
  const F = P.F;

  const nullifierSecret = BigInt("0x" + crypto.randomBytes(30).toString("hex")).toString(10);
  const claimNullifier = F.toString(
    P([F.e(BigInt(invoice.policy_id)), F.e(BigInt(invoice.invoice_id)), F.e(nullifierSecret)])
  );

  const expenses = (invoice.expenses_paise as string[]).map((e) => BigInt(e));
  const totalExpense = BigInt(invoice.total_expense_paise);
  const eligible = totalExpense - BigInt(priv.deductible_paise);
  if (eligible < 0n) throw new Error("Total expense is below the policy deductible.");
  const gross = eligible * BigInt(10000 - priv.copay_bps);
  const payout = gross / 10000n;

  return {
    input: {
      policy_id: invoice.policy_id,
      hospital_pk_x: invoice.hospital_pk_x,
      hospital_pk_y: invoice.hospital_pk_y,
      claim_nullifier: claimNullifier,
      payout_amount: payout.toString(),
      sig_r_x: invoice.sig_r_x_dec,
      sig_r_y: invoice.sig_r_y_dec,
      sig_s: invoice.signature_s,
      invoice_id: invoice.invoice_id.toString(),
      patient_commitment: invoice.patient_commitment,
      treatment_code: invoice.treatment_code,
      admission_date: invoice.admission_date,
      discharge_date: invoice.discharge_date,
      expenses: expenses.map((e) => e.toString()),
      total_expense: totalExpense.toString(),
      deductible_paise: priv.deductible_paise,
      copay_bps: priv.copay_bps,
      coverage_used_before: priv.coverage_used_before_paise ?? 0,
      coverage_limit: priv.coverage_limit_paise,
      nullifier_secret: nullifierSecret,
      settlement_remainder: Number(gross % 10000n),
    },
    payoutPaise: payout.toString(),
    nullifier: claimNullifier,
  };
}

let provingQueue: Promise<unknown> = Promise.resolve();

/** Generate the Groth16 proof and export contract-ready proofBytes. */
export async function generateClaimProof(input: Record<string, unknown>) {
  const wasmPath = path.join(BUILD, "claim_js", "claim.wasm");
  const zkeyPath = path.join(BUILD, "claim_final.zkey");

  // serialize proving runs (snarkjs is not reentrant-safe in-process)
  const run = provingQueue.then(async () => {
    const wtnsBuf = { type: "mem" } as any;
    await snarkjs.wtns.calculate(input, wasmPath, wtnsBuf);
    const { proof, publicSignals } = await snarkjs.groth16.prove(zkeyPath, wtnsBuf.data as any, null as any);

    // pi_b swap for solidity convention (mirrors scripts/export_claim_proof.js)
    const abi = new AbiCoder();
    const b = [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ];
    const proofBytes = abi.encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      [[proof.pi_a[0], proof.pi_a[1]], b, [proof.pi_c[0], proof.pi_c[1]]]
    );
    return { publicSignals, proofBytes };
  });
  provingQueue = run.catch(() => undefined);
  return run as Promise<{ publicSignals: string[]; proofBytes: string }>;
}
