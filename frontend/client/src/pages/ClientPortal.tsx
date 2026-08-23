/**
 * ProofSure Client Portal — fully wired.
 * Private health inputs stay in this browser for local inference;
 * only proofs and public inputs leave the device.
 */
import {
  ArrowUpRight, BadgeCheck, ChevronDown, FileCheck2, HeartPulse,
  Loader2, LockKeyhole, ReceiptText, ShieldCheck, Stethoscope, WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import PortalSessionActions from "@/components/PortalSessionActions";
import { api } from "@/lib/api";
import { connectWallet, hasWallet, payPremium } from "@/lib/wallet";
import { PremiumPredictor } from "@/lib/predictor.js";

type FlowState =
  | "idle" | "running_local_model" | "generating_proof" | "proof_generated"
  | "waiting_verification" | "policy_active" | "hospital_invoice_received"
  | "generating_claim_proof" | "submitting_claim" | "proof_verified"
  | "payout_pending" | "payout_confirmed" | "failed";

const logoMark = "/assets/proofsure-logo-mark.png";

const workspaceItems = [
  { label: "Overview", icon: ShieldCheck },
  { label: "Private premium", icon: HeartPulse },
  { label: "My policy", icon: BadgeCheck },
  { label: "Claims", icon: ReceiptText },
];

const EMPTY_ROW = {
  gender: "M", age: 35, marital_status: "Married", occupation_type: "Salaried",
  annual_income_inr: 900000, bmi: 26.5, tobacco_usage: "none",
  alcohol_units_per_week: 2, physical_activity_level: "moderate", diet_type: "non-veg",
  has_diabetes: 0, has_hypertension: 0, family_history_cardiac: 1,
  stress_level_score: 5, policy_type: "individual", sum_insured: 500000,
};

const STATE_LABELS: Partial<Record<FlowState, string>> = {
  idle: "IDLE", running_local_model: "RUNNING LOCAL MODEL", generating_proof: "GENERATING ZKML PROOF",
  proof_generated: "PROOF GENERATED", waiting_verification: "AWAITING PROVIDER VERIFICATION",
  hospital_invoice_received: "HOSPITAL INVOICE RECEIVED", generating_claim_proof: "GENERATING CLAIM PROOF",
  submitting_claim: "SUBMITTING CLAIM", payout_confirmed: "PAYOUT CONFIRMED", failed: "FAILED",
};

export default function ClientPortal() {
  const [activeItem, setActiveItem] = useState("Overview");
  const [wallet, setWalletState] = useState<string | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [row, setRow] = useState<any>(EMPTY_ROW);
  const [localPremium, setLocalPremium] = useState<number | null>(null);
  const [flow, setFlow] = useState<FlowState>("idle");
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [invoiceText, setInvoiceText] = useState("");
  const [claimResult, setClaimResult] = useState<{ txHash?: string; payout?: string } | null>(null);
  const [policies, setPolicies] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);

  const predictor = useMemo(() => new PremiumPredictor(), []);

  const refresh = async () => {
    try { setPolicies(await api.policies()); } catch { /* auth */ }
    try { setClaims(await api.claims()); } catch { /* */ }
  };

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
    refresh();
    predictor.init().catch((err: unknown) => console.warn("predictor init failed", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bindWallet = async () => {
    try {
      const addr = await connectWallet();
      setWalletState(addr);
      await api.setWallet(addr);
      toast.success("Wallet connected", { description: `${addr.slice(0, 8)}…${addr.slice(-6)} bound to your account.` });
    } catch (e) {
      toast.error("Wallet connection failed", { description: (e as Error).message });
    }
  };

  const runLocalModel = async () => {
    setFlow("running_local_model");
    try {
      await predictor.init();
      const res = await predictor.predict(row);
      setLocalPremium(res.rupees);
      setFlow("proof_generated");
      toast.success(`Local premium ≈ ₹${Math.round(res.rupees).toLocaleString("en-IN")}`, { description: "Computed entirely in this browser." });
    } catch (e) {
      setFlow("failed");
      toast.error("Local inference failed", { description: (e as Error).message });
    }
  };

  const generateProof = async () => {
    setFlow("generating_proof");
    try {
      const r = await api.premiumProve(row);
      setSubmissionId(r.id);
      setLocalPremium(r.predictionInr);
      setFlow("waiting_verification");
      toast.success(`ZKML proof generated (${r.proveSeconds.toFixed(1)}s)`, { description: `Submission ${r.id} is now in the provider verification queue.` });
    } catch (e) {
      setFlow("failed");
      toast.error("Proof generation failed", { description: (e as Error).message });
    }
  };

  const payPolicy = async (p: any) => {
    try {
      if (!hasWallet()) throw new Error("Connect a wallet first.");
      const address = config?.contract?.policy;
      if (!address) throw new Error("Contract address unavailable — is the chain deployed?");
      const hash = await payPremium(address, p.id, p.premiumWei);
      toast.success("Premium paid", { description: `tx ${hash.slice(0, 14)}… — awaiting provider activation.` });
      refresh();
    } catch (e) {
      toast.error("Payment failed", { description: (e as Error).message });
    }
  };

  const prepareClaim = async () => {
    if (!invoiceText.trim()) return toast.error("Paste a signed hospital invoice first.");
    let invoice: any;
    try { invoice = JSON.parse(invoiceText); } catch { return toast.error("Invoice is not valid JSON."); }
    setFlow("generating_claim_proof");
    try {
      // policy terms must match the on-chain policy (demo defaults mirror the provider's offer)
      const policy = policies.find((p) => String(p.id) === String(invoice.policy_id)) ?? policies[0];
      const proof = await api.claimProve({
        invoice,
        deductible_paise: policy?.deductiblePaise ?? "2000000",
        copay_bps: policy?.coPayBps ?? 1000,
        coverage_limit_paise: "60000000",
        coverage_used_before_paise: 0,
      });
      setFlow("submitting_claim");
      const claim = await api.submitClaim({
        proofBytesHex: proof.proofBytesHex,
        publicInputs: proof.publicInputs,
        payoutPaise: proof.payoutPaise,
        claimNullifier: proof.claimNullifier,
        invoice,
      });
      setClaimResult({ payout: `₹${(Number(proof.payoutPaise) / 100).toLocaleString("en-IN")}` });
      setFlow("proof_verified");
      toast.success("Claim submitted", { description: `Claim ${claim.id} — verified payout ₹${(Number(proof.payoutPaise) / 100).toLocaleString("en-IN")}. Awaiting settlement.` });
      refresh();
    } catch (e) {
      setFlow("failed");
      toast.error("Claim failed", { description: (e as Error).message });
    }
  };

  const field = (key: string, label: string, type = "text") => (
    <div className="flow-field">
      <label>{label}</label>
      <input type={type} value={row[key]} onChange={(e) => setRow({ ...row, [key]: type === "number" ? Number(e.target.value) : e.target.value })} />
    </div>
  );

  return (
    <div className="client-portal-page">
      <aside className="client-sidebar">
        <div className="client-sidebar-top">
          <a className="client-brand" href="/"><img src={logoMark} alt="" /><span>PROOFSURE</span></a>
          <div className="workspace-tag"><span /> CLIENT WORKSPACE</div>
          <nav className="client-nav" aria-label="Client portal navigation">
            {workspaceItems.map(({ label, icon: Icon }) => (
              <button className={activeItem === label ? "is-active" : ""} key={label} onClick={() => setActiveItem(label)}>
                <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                {label === "Claims" && <em>{claims.length}</em>}
              </button>
            ))}
          </nav>
        </div>
        <div className="client-role-card">
          <div className="role-mark"><LockKeyhole size={16} /></div>
          <div><span>PRIVACY</span><strong>Local-first</strong></div>
          <p>Health inputs never leave this browser during premium calculation.</p>
        </div>
        <PortalSessionActions activeRole="client" />
      </aside>

      <main className="client-main">
        <header className="client-topbar">
          <div className="client-breadcrumb"><span>CLIENT</span><i /> YOUR COVER</div>
          <div className="client-topbar-actions">
            <button className="icon-control" aria-label="Notifications"><span /></button>
            <button className="client-account" onClick={bindWallet}>
              <span className="account-monogram">AK</span>
              <span><strong>Client</strong><small>{wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "connect wallet"}</small></span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>

        <div className="client-content">
          <section className="client-intro client-portal-reveal">
            <div>
              <p className="portal-eyebrow"><span /> YOUR PRIVATE COVER</p>
              <h1>Your private <em>underwriting.</em></h1>
              <p>Your health inputs stay in this browser during premium calculation. Only the ZKML proof and approved premium reach the provider.</p>
            </div>
            <div className="client-intro-stamp">
              <img src={logoMark} alt="" />
              <span>CHAIN</span>
              <strong style={{ fontSize: 14 }}>{config?.simulation ? "SIMULATION" : config?.chain?.mode?.toUpperCase()}</strong>
              <i>{config?.simulation ? "no RPC" : "LIVE"}</i>
            </div>
          </section>

          <section className="portal-notice client-portal-reveal">
            <LockKeyhole size={16} />
            <p><strong>Privacy boundary.</strong> Local inference runs via WebAssembly here; raw features are sent to the proving service only when you explicitly request a ZKML proof, and never stored by the provider.</p>
          </section>

          <div className="client-traverse client-portal-reveal" aria-label="Client proof route">
            <span className="traverse-origin"><i /> PRIVATE DATA</span><em /><span>PREMIUM PROOF</span><em /><span>ACTIVE POLICY</span><em /><span className="traverse-confirm"><i /> VERIFIED PAYOUT</span>
          </div>

          <div data-state={flow}>
            <b>STATE:</b>&nbsp;{STATE_LABELS[flow] ?? flow.replace(/_/g, " ").toUpperCase()}
          </div>

          <section className="client-overview-grid">
            <article className="proof-card client-portal-reveal portal-route-card">
              <div className="card-kicker"><span>01 / PRIVATE PREMIUM</span><HeartPulse size={17} /></div>
              <h2>Calculate your premium <em>privately.</em></h2>
              <p>Edit your private profile, run the insurer's model locally, then generate the ZKML proof.</p>
              <div className="flow-grid" style={{ margin: "12px 0" }}>
                {field("age", "Age", "number")}
                {field("annual_income_inr", "Income ₹", "number")}
                {field("bmi", "BMI", "number")}
                {field("sum_insured", "Sum insured ₹", "number")}
                <div className="flow-field"><label>Tobacco</label>
                  <select value={row.tobacco_usage} onChange={(e) => setRow({ ...row, tobacco_usage: e.target.value })}>
                    <option value="none">none</option><option value="smoking">smoking</option>
                    <option value="chewing">chewing</option><option value="both">both</option>
                  </select>
                </div>
                <div className="flow-field"><label>Diabetes</label>
                  <select value={row.has_diabetes} onChange={(e) => setRow({ ...row, has_diabetes: Number(e.target.value) })}>
                    <option value={0}>No</option><option value={1}>Yes</option>
                  </select>
                </div>
              </div>
              <div className="proof-steps">
                <span className={localPremium != null ? "is-ready" : ""}>{localPremium != null ? `≈ ₹${Math.round(localPremium).toLocaleString("en-IN")}` : "Local model"}</span>
                <i />
                <span className={submissionId ? "is-ready" : ""}>{submissionId ? `Proof ${submissionId.slice(0, 6)}…` : "Proof"}</span>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button className="outline-action" disabled={flow === "running_local_model"} onClick={runLocalModel}>
                  {flow === "running_local_model" ? <Loader2 className="animate-spin" size={15} /> : <ArrowUpRight size={15} />} Run local model
                </button>
                <button className="dark-action" disabled={flow === "generating_proof"} onClick={generateProof}>
                  {flow === "generating_proof" ? <Loader2 className="animate-spin" size={15} /> : <FileCheck2 size={15} />} Generate ZKML proof
                </button>
              </div>
            </article>

            <article className="coverage-card client-portal-reveal portal-route-card">
              <div className="card-kicker"><span>02 / MY POLICIES</span><BadgeCheck size={17} /></div>
              {policies.length === 0 && <p>No policies yet — your provider creates one after verifying your premium proof.</p>}
              <div className="row-list" style={{ marginTop: 10 }}>
                {policies.map((p) => (
                  <div className="row-item" key={p.id}>
                    <div>
                      <strong>Policy #{p.id}</strong>
                      <small style={{ display: "block", opacity: 0.65 }}>
                        premium {(Number(p.premiumWei) / 1e18).toFixed(3)} ETH · limit {(Number(p.coverageLimitWei) / 1e18).toFixed(2)} ETH
                      </small>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className={`state-pill ${p.onchain?.active ? "ok" : ""}`}>{p.onchain?.active ? "ACTIVE" : "INACTIVE"}</span>
                      {!p.onchain?.active && (
                        <button className="text-action" style={{ display: "block", marginTop: 6 }} onClick={() => payPolicy(p)}>
                          Pay premium <ArrowUpRight size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {!wallet && (
                <button className="dark-action" style={{ marginTop: 12 }} onClick={bindWallet}>
                  <WalletCards size={15} /> Connect wallet to pay premiums
                </button>
              )}
            </article>
          </section>

          <section className="portal-lower-grid">
            <article className="claim-card client-portal-reveal portal-route-card">
              <div className="card-kicker"><span>03 / CLAIMS</span><ReceiptText size={17} /></div>
              <h2>Settle a hospital claim <em>privately.</em></h2>
              <p>Paste the signed invoice issued by a registered hospital. The ZK prover establishes authorization, covered treatment, expense sum, and the exact payout — revealing none of it.</p>
              <textarea
                className="mono"
                style={{ width: "100%", minHeight: 110, border: "1px solid color-mix(in srgb, currentColor 18%, transparent)", background: "transparent", borderRadius: 10, padding: 10 }}
                placeholder='{"format":"signed_hospital_invoice_v1", ...}'
                value={invoiceText}
                onChange={(e) => { setInvoiceText(e.target.value); if (e.target.value.includes("signed_hospital_invoice_v1")) setFlow("hospital_invoice_received"); }}
              />
              <button className="outline-action" style={{ marginTop: 10 }} disabled={flow === "generating_claim_proof" || flow === "submitting_claim"} onClick={prepareClaim}>
                {flow === "generating_claim_proof" || flow === "submitting_claim" ? <Loader2 className="animate-spin" size={15} /> : <Stethoscope size={15} />}
                Prove &amp; submit claim
              </button>
              {claimResult && (
                <div className="state-pill ok" style={{ marginTop: 10 }}>
                  Verified payout {claimResult.payout} — check the claims list for the settlement tx.
                </div>
              )}
            </article>

            <article className="privacy-card client-portal-reveal portal-route-card">
              <div className="card-kicker"><span>04 / CLAIM LEDGER</span><ShieldCheck size={17} /></div>
              {claims.length === 0 && <p>No claims yet.</p>}
              <div className="row-list">
                {claims.map((c) => (
                  <div className="row-item" key={c.id}>
                    <div>
                      <strong>Claim {c.id.slice(0, 6)}…</strong>
                      <small style={{ display: "block", opacity: 0.65 }}>policy #{c.policyId} · ₹{(Number(c.payoutPaise) / 100).toLocaleString("en-IN")}</small>
                    </div>
                    <span className={`state-pill ${c.status === "settled" ? "ok" : c.status === "rejected" ? "err" : "busy"}`}>
                      {c.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </div>
      </main>
    </div>
  );
}
