import { Router, Request, Response } from "express";
import crypto from "crypto";
import { config, deploymentInfo } from "./config";
import { authRouter, requireAuth, requireRole, User } from "./auth";
import { store, PremiumSubmission, ClaimRecord } from "./store";
import * as chain from "./chain";
import { prover, descaleInstanceToInr } from "./prover";
import {
  listHospitals,
  generateHospitalKey,
  signInvoice,
  circuitInput,
  generateClaimProof,
} from "./claimprove";

export const api = Router();

api.use("/auth", authRouter);

// ------------------------------------------------------------------
// Config / health
// ------------------------------------------------------------------

let modelCache: unknown = null;
async function modelInfo() {
  if (!modelCache) {
    try {
      modelCache = await prover.model();
    } catch (e) {
      return { error: `Prover unreachable: ${(e as Error).message}` };
    }
  }
  return modelCache;
}

async function chainStatusSafe() {
  try {
    return await chain.chainStatus();
  } catch (e) {
    return { mode: "error", note: (e as Error).message };
  }
}

function friendlyChainError(e: Error) {
  const msg = e.message || "on-chain transaction failed";
  for (const [pat, human] of [
    ["policy not active", "Policy is inactive or expired."],
    ["policy expired", "Policy is inactive or expired."],
    ["nullifier already used", "Claim has already been processed."],
    ["exceeds remaining coverage", "Payout exceeds remaining coverage."],
    ["hospital not authorized", "Hospital is not authorized."],
    ["invalid claim proof", "Claim proof is invalid."],
    ["insufficient reserve", "Insurance reserve is insufficient."],
    ["incorrect premium amount", "Premium amount does not match the policy."],
    ["not policy holder", "Only the policy holder can perform this action."],
  ] as const) {
    if (msg.includes(pat)) return human;
  }
  return msg;
}

api.get("/config", async (_req: Request, res: Response) => {
  const m = (await modelInfo()) as any;
  res.json({
    chain: await chainStatusSafe(),
    simulation: chain.simulation,
    contract: deploymentInfo(),
    premiumModelId: m?.premium_model_id_bytes32 ?? null,
    provingSystem: m?.proving_system ?? "ezkl/KZG",
    claimCircuit: {
      framework: "circom/snarkjs Groth16 BN254",
      publicInputs: ["policy_id", "hospital_pk_x", "hospital_pk_y", "claim_nullifier", "payout_amount(paise)"],
      interfaceDoc: "interfaces/zk-interface.md",
    },
  });
});

api.get("/events", requireAuth, (_req, res) => {
  res.json(store.db.events.slice(0, 50));
});

api.get("/reserve", requireRole("provider"), async (_req, res) => {
  res.json(await chain.reserveBalance());
});

// ------------------------------------------------------------------
// Premium (ZKML underwriting)
// ------------------------------------------------------------------

api.post("/premium/prove", requireRole("client"), async (req, res) => {
  const rawRow = req.body?.raw_row;
  if (!rawRow || typeof rawRow !== "object") {
    return res.status(400).json({ error: "raw_row is required." });
  }
  try {
    const result = await prover.prove(rawRow);
    const submission: PremiumSubmission = {
      id: crypto.randomUUID().slice(0, 12),
      clientEmail: req.user!.email,
      clientWallet: req.user!.wallet ?? null,
      predictionInr: result.prediction_inr,
      proof: result.proof,
      publicInputs: result.public_inputs,
      proveSeconds: result.prove_seconds,
      status: "pending_verification",
    };
    store.addPremiumSubmission(submission);
    store.addEvent("premium_proof_generated", { id: submission.id, predictionInr: Math.round(result.prediction_inr) });
    res.json({
      id: submission.id,
      predictionInr: result.prediction_inr,
      proveSeconds: result.prove_seconds,
      proof: result.proof,
    });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

api.get("/premium/submissions/mine", requireAuth, (req, res) => {
  res.json(store.premiumSubmissionsFor(req.user!.email));
});

/** Provider verifies a pending premium proof (ezkl verify + INR de-scale check). */
api.post("/provider/premium/:id/verify", requireRole("provider"), async (req, res) => {
  const sub = store.getPremiumSubmission(req.params.id);
  if (!sub) return res.status(404).json({ error: "Submission not found." });
  if (sub.status !== "pending_verification") {
    return res.status(409).json({ error: `Submission already ${sub.status}.` });
  }
  try {
    const model = (await modelInfo()) as any;
    const claimed = Number(req.body?.claimedPremiumInr ?? NaN);
    const vr = await prover.verify(sub.proof);
    let descaled = null;
    if (model?.target_scaler) descaled = descaleInstanceToInr(sub.publicInputs, model.target_scaler);

    const checks = {
      ezklVerified: vr.valid === true,
      modelBound: Boolean(model?.onnx_sha256),
      premiumMatch:
        descaled != null && Number.isFinite(claimed)
          ? Math.abs(descaled - claimed) <= 1
          : null,
    };
    const ok = checks.ezklVerified && checks.modelBound && checks.premiumMatch !== false;
    store.updatePremiumSubmission(sub.id, {
      status: ok ? "verified" : "rejected",
      verifiedAt: new Date().toISOString(),
    });
    store.addEvent(ok ? "premium_proof_verified" : "premium_proof_rejected", { id: sub.id, checks });
    res.json({ ok, checks, descaledInr: descaled, claimedInr: claimed });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

api.get("/provider/premium/queue", requireRole("provider"), async (_req, res) => {
  res.json(store.db.premiumSubmissions.filter((s) => s.status !== "used"));
});

// ------------------------------------------------------------------
// Policies
// ------------------------------------------------------------------

api.post("/provider/policies", requireRole("provider"), async (req, res) => {
  const b = req.body || {};
  const holder = String(b.holderWallet || "");
  const premiumWei = BigInt(String(b.premiumWei || "0"));
  const coverageLimitWei = BigInt(String(b.coverageLimitWei || "0"));
  const deductiblePaise = BigInt(String(b.deductiblePaise || "0"));
  const coPayBps = Number(b.coPayBps ?? 1000);
  const durationSeconds = Number(b.durationSeconds ?? 365 * 86400);
  const submissionId = b.submissionId ? String(b.submissionId) : null;

  if (!/^0x[0-9a-fA-F]{40}$/.test(holder)) {
    return res.status(400).json({ error: "holderWallet must be an Ethereum address." });
  }
  if (coverageLimitWei <= 0n || premiumWei <= 0n) {
    return res.status(400).json({ error: "Premium and coverage limit must be positive." });
  }

  // Policy creation requires a VERIFIED premium proof.
  if (!submissionId) {
    return res.status(400).json({ error: "Policy creation requires a verified premium proof (submissionId)." });
  }
  const sub = store.getPremiumSubmission(submissionId);
  if (!sub) return res.status(404).json({ error: "Premium submission not found." });
  if (sub.status !== "verified") return res.status(409).json({ error: "Premium proof has not been verified yet." });
  store.updatePremiumSubmission(sub.id, { status: "used" });

  const model = (await modelInfo()) as any;
  let premiumModelId = String(b.premiumModelId || model?.premium_model_id_bytes32 || "");
  if (premiumModelId && !premiumModelId.startsWith("0x")) premiumModelId = "0x" + premiumModelId;
  if (!/^0x[0-9a-f]{64}$/i.test(premiumModelId)) {
    return res.status(400).json({ error: "Premium proof does not match the registered model." });
  }

  try {
    const { policyId, txHash } = await chain.createPolicyTx({
      holder,
      premiumWei,
      coverageLimitWei,
      deductiblePaise,
      coPayBps,
      durationSeconds,
      premiumModelId,
    });
    store.addPolicy({
      id: policyId,
      holderWallet: holder.toLowerCase(),
      premiumWei: premiumWei.toString(),
      coverageLimitWei: coverageLimitWei.toString(),
      deductiblePaise: deductiblePaise.toString(),
      coPayBps,
      durationSeconds,
      premiumModelId,
      submissionId,
      txHash,
      createdAt: new Date().toISOString(),
    });
    store.addEvent("policy_created", { policyId, holder, txHash });
    res.json({ policyId, txHash, premiumWei: premiumWei.toString() });
  } catch (e) {
    res.status(500).json({ error: friendlyChainError(e as Error) });
  }
});

/** The HOLDER pays from their own wallet directly to the contract. */
api.post("/policies/:id/pay", requireRole("client"), async (req, res) => {
  const id = Number(req.params.id);
  const rec = store.getPolicy(id);
  if (!rec) return res.status(404).json({ error: "Policy not found." });
  const from = String(req.body?.from || req.user!.wallet || "");
  if (rec.holderWallet !== from.toLowerCase()) {
    return res.status(403).json({ error: "Only the policy holder's wallet can pay this premium." });
  }

  if (chain.simulation) {
    store.addEvent("premium_paid_simulated", { policyId: id, amountWei: rec.premiumWei });
    return res.json({ simulated: true, txHash: "0x" + crypto.randomBytes(32).toString("hex"), value: rec.premiumWei });
  }

  try {
    const { Wallet } = await import("ethers");
    void Wallet;
    // Build the payment transaction for the client's wallet to sign.
    const ifaceData =
      "0xb6b55f25" + BigInt(id).toString(16).padStart(64, "0"); // payPremium(uint256)
    res.json({
      to: config.policyAddress,
      value: rec.premiumWei,
      data: ifaceData,
      note: "Send this exact transaction from the holder wallet to activate the policy.",
    });
  } catch (e) {
    res.status(500).json({ error: friendlyChainError(e as Error) });
  }
});

api.post("/provider/policies/:id/activate", requireRole("provider"), async (req, res) => {
  const id = Number(req.params.id);
  const rec = store.getPolicy(id);
  if (!rec) return res.status(404).json({ error: "Policy not found." });
  try {
    const onchain = await chain.getPolicyOnChain(id);
    if (onchain && !onchain.active) {
      const r = await chain.activatePolicyTx(id);
      store.addEvent("policy_activated", { policyId: id, txHash: r.txHash });
      return res.json({ activated: true, txHash: r.txHash });
    }
    res.json({ activated: true, txHash: rec.txHash });
  } catch (e) {
    res.status(500).json({ error: friendlyChainError(e as Error) });
  }
});

api.get("/policies", requireAuth, async (req, res) => {
  const list =
    req.user!.role === "client"
      ? store.listPolicies(req.user!.wallet?.toLowerCase())
      : store.listPolicies();
  const enriched = [];
  for (const p of list) {
    const oc = await chain.getPolicyOnChain(p.id);
    enriched.push({
      ...p,
      onchain: oc
        ? {
            active: oc.active,
            coverageUsed: String(oc.coverageUsed),
            startTime: Number(oc.startTime),
            endTime: Number(oc.endTime),
          }
        : null,
    });
  }
  res.json(enriched);
});

// ------------------------------------------------------------------
// Hospitals + invoices
// ------------------------------------------------------------------

api.get("/hospitals", requireAuth, (_req, res) => {
  res.json(listHospitals());
});

api.post("/hospital/keys/generate", requireRole("hospital"), async (req, res) => {
  const hospitalId = String(req.body?.hospitalId || "").trim();
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(hospitalId)) {
    return res.status(400).json({ error: "hospitalId must be 3-32 alphanumeric characters." });
  }
  const key = await generateHospitalKey(hospitalId, req.user!.name);
  req.user!.hospitalId = hospitalId;
  store.addEvent("hospital_key_generated", { hospitalId });
  res.json(key);
});

api.post("/provider/hospitals/authorize-key", requireRole("provider"), async (req, res) => {
  const { pk_x, pk_y, action } = req.body || {};
  if (!pk_x || !pk_y) return res.status(400).json({ error: "pk_x and pk_y are required." });
  try {
    const r =
      action === "remove"
        ? await chain.removeHospitalKey(String(pk_x), String(pk_y))
        : await chain.authorizeHospitalKey(String(pk_x), String(pk_y));
    store.addEvent(action === "remove" ? "hospital_removed" : "hospital_authorized", { pk_x, pk_y, txHash: r.txHash });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: friendlyChainError(e as Error) });
  }
});

api.post("/hospital/invoices/sign", requireRole("hospital"), async (req, res) => {
  const b = req.body || {};
  if (!b.hospital_id || !b.policy_id || !b.treatment_code || !Array.isArray(b.expenses_paise)) {
    return res.status(400).json({ error: "hospital_id, policy_id, treatment_code and expenses_paise are required." });
  }
  if (req.user!.hospitalId && req.user!.hospitalId !== b.hospital_id) {
    return res.status(403).json({ error: "You can only sign invoices for your own hospital identity." });
  }
  try {
    const invoice = await signInvoice(b);
    store.addEvent("invoice_signed", {
      hospital_id: b.hospital_id,
      invoice_id: invoice.invoice_id,
      policy_id: String(b.policy_id),
    });
    res.json(invoice);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

api.post("/provider/reserve/fund", requireRole("provider"), async (req, res) => {
  const eth = String(req.body?.eth || "");
  if (!(Number(eth) > 0)) return res.status(400).json({ error: "Provide a positive ETH amount." });
  try {
    res.json(await chain.fundReserve(eth));
  } catch (e) {
    res.status(500).json({ error: friendlyChainError(e as Error) });
  }
});

// ------------------------------------------------------------------
// Claims — prove + submit + settle
// ------------------------------------------------------------------

/** Claimant (client) turns a signed hospital invoice + private policy params
 *  into a Groth16 proof bundle. */
api.post("/claims/prove", requireRole("client"), async (req, res) => {
  const b = req.body || {};
  const invoice = b.invoice;
  if (!invoice || invoice.format !== "signed_hospital_invoice_v1") {
    return res.status(400).json({ error: "A signed_hospital_invoice_v1 document is required." });
  }
  if (!b.deductible_paise || b.copay_bps === undefined || !b.coverage_limit_paise) {
    return res.status(400).json({ error: "deductible_paise, copay_bps and coverage_limit_paise are required." });
  }

  try {
    // replay pre-check: nullifier must be unused
    const { input, payoutPaise, nullifier } = await circuitInput(invoice, b);
    const existing = store.db.claims.find((c) => c.nullifier === nullifier);
    if (existing) {
      return res.status(409).json({ error: "Claim has already been processed." });
    }

    const { publicSignals, proofBytes } = await generateClaimProof(input);

    store.addEvent("claim_proof_generated", { policyId: String(invoice.policy_id), payoutPaise });

    res.json({
      proofBytesHex: proofBytes,
      publicInputs: publicSignals, // [policy_id, pk_x, pk_y, nullifier, payout_paise]
      payoutPaise,
      claimNullifier: nullifier,
    });
  } catch (e) {
    const msg = (e as Error).message || "";
    if (msg.includes("Assert") || msg.includes("constraint")) {
      return res.status(422).json({ error: "Claim data violates a policy rule — ZK witness generation failed.", detail: msg.slice(0, 300) });
    }
    res.status(500).json({ error: msg.slice(0, 500) });
  }
});

/** Claimant submits the generated claim for settlement. */
api.post("/claims", requireRole("client"), async (req, res) => {
  const b = req.body || {};
  const { proofBytesHex, publicInputs, payoutPaise, claimNullifier, invoice } = b;
  if (!proofBytesHex || !Array.isArray(publicInputs) || publicInputs.length !== 5 || claimNullifier === undefined) {
    return res.status(400).json({ error: "proofBytesHex, publicInputs[5], claimNullifier and invoice are required." });
  }
  const policyId = Number(publicInputs[0]);
  const rec = store.getPolicy(policyId);
  if (!rec) return res.status(404).json({ error: "Policy not found." });
  if (rec.holderWallet !== req.user!.wallet?.toLowerCase()) {
    return res.status(403).json({ error: "Claims can only be submitted by the policy holder." });
  }

  const claim: ClaimRecord = {
    id: crypto.randomUUID().slice(0, 12),
    policyId,
    clientEmail: req.user!.email,
    invoiceId: Number(invoice?.invoice_id || 0),
    hospitalId: String(invoice?.hospital_id || ""),
    payoutPaise: String(payoutPaise ?? publicInputs[4]),
    nullifier: String(claimNullifier),
    proofBytesHex: String(proofBytesHex),
    publicInputs: publicInputs.map(String),
    invoice: invoice ?? null,
    status: "submitted",
    createdAt: new Date().toISOString(),
  };
  store.addClaim(claim);
  store.addEvent("claim_submitted", { id: claim.id, policyId, payoutPaise: claim.payoutPaise });
  res.status(201).json(claim);
});

api.get("/claims", requireAuth, (req, res) => {
  res.json(
    req.user!.role === "client" ? store.listClaims(req.user!.email) : store.listClaims()
  );
});

api.get("/claims/:id", requireAuth, (req, res) => {
  const c = store.getClaim(req.params.id);
  if (!c) return res.status(404).json({ error: "Claim not found." });
  res.json(c);
});

/** Provider settles on-chain: verifyProof -> nullifier/coverage/reserve checks -> automatic payout. */
api.post("/provider/claims/:id/settle", requireRole("provider"), async (req, res) => {
  const claim = store.getClaim(req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found." });
  if (claim.status === "settled") return res.status(409).json({ error: "Claim has already been processed." });

  try {
    const preview = await chain.payoutPreview(claim.payoutPaise);
    const r = await chain.settleClaimOnChain(claim.proofBytesHex, claim.publicInputs);
    claim.status = "settled";
    claim.settlementTxHash = r.txHash;
    claim.payoutWei = r.payoutWei ?? preview.weiAmt;
    
    store.addEvent("claim_paid", {
      id: claim.id,
      policyId: claim.policyId,
      payoutPaise: claim.payoutPaise,
      payoutWei: claim.payoutWei,
      txHash: r.txHash,
    });
    res.json({
      ok: true,
      claimIdOnChain: r.claimId,
      txHash: r.txHash,
      payoutPaise: claim.payoutPaise,
      payoutWei: claim.payoutWei,
      price: preview.price,
    });
  } catch (e) {
    const human = friendlyChainError(e as Error);
    claim.status = "rejected";
    
    store.addEvent("claim_rejected", { id: claim.id, reason: human });
    res.status(400).json({ ok: false, error: human });
  }
});
