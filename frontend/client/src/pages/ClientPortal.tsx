/**
 * ProofSure Client Portal — routed screens: Overview, Private premium, My policy, Claims.
 * Private health inputs stay in this browser for local inference;
 * only proofs and public inputs leave the device.
 */
import {
  ArrowUpRight, BadgeCheck, FileCheck2, HeartPulse, Loader2,
  ReceiptText, ShieldCheck, Stethoscope,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import PortalLayout, { SectionHead } from "@/components/PortalLayout";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { hasWallet, payPremium } from "@/lib/wallet";
import { PremiumPredictor } from "@/lib/predictor.js";

type FlowState =
  | "idle" | "running_local_model" | "generating_proof" | "proof_generated"
  | "waiting_verification" | "hospital_invoice_received"
  | "generating_claim_proof" | "submitting_claim" | "proof_verified" | "failed";

const EMPTY_ROW: Record<string, any> = {
  gender: "M", age: 35, marital_status: "Married", occupation_type: "Salaried",
  annual_income_inr: 900000, bmi: 26.5, tobacco_usage: "none",
  alcohol_units_per_week: 2, physical_activity_level: "moderate", diet_type: "non-veg",
  has_diabetes: 0, has_hypertension: 0, family_history_cardiac: 1,
  stress_level_score: 5, policy_type: "individual", sum_insured: 500000,
};

const SECTIONS = ["overview", "premium", "policy", "claims"] as const;
type Section = (typeof SECTIONS)[number];

export default function ClientPortal() {
  const { session } = useAuth();
  const [location] = useLocation();
  const raw = location.split("/")[2] ?? "";
  const section: Section = (SECTIONS as readonly string[]).includes(raw) ? (raw as Section) : "overview";

  const [config, setConfig] = useState<any>(null);
  const [row, setRow] = useState<any>(EMPTY_ROW);
  const [localPremium, setLocalPremium] = useState<number | null>(null);
  const [flow, setFlow] = useState<FlowState>("idle");
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [invoiceText, setInvoiceText] = useState("");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [claimResult, setClaimResult] = useState<{ txHash?: string; payout?: string } | null>(null);
  const [policies, setPolicies] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);

  const predictor = useMemo(() => new PremiumPredictor(), []);

  const refresh = async () => {
    try { setPolicies(await api.policies()); } catch { /* auth */ }
    try { setClaims(await api.claims()); } catch { /* */ }
    try { setSubmissions(await api.mySubmissions()); } catch { /* */ }
    try { setInvoices(await api.myInvoices()); } catch { /* */ }
  };

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
    refresh();
    predictor.init().catch((err: unknown) => console.warn("predictor init failed", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (!session?.wallet) {
        toast.warning("Bind your wallet so the provider can create your policy", { description: "Account menu (top right) → Connect wallet. The provider needs your address to attach to the policy." });
      }
      refresh();
    } catch (e) {
      setFlow("failed");
      toast.error("Proof generation failed", { description: (e as Error).message });
    }
  };

  const payPolicy = async (p: any) => {
    try {
      if (!hasWallet()) throw new Error("Connect a wallet first (account menu, top right).");
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
      const policy = policies.find((p) => String(p.id) === String(invoice.policy_id)) ?? policies[0];
      const proof = await api.claimProve({
        invoice,
        deductible_paise: policy?.deductiblePaise ?? "2000000",
        copay_bps: policy?.coPayBps ?? 1000,
        coverage_limit_paise: policy?.coverageLimitPaise ?? "60000000",
        coverage_used_before_paise: policy?.coverageUsedPaise ?? 0,
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
      toast.success("Claim submitted", { description: `Verified payout ₹${(Number(proof.payoutPaise) / 100).toLocaleString("en-IN")}. The provider settles it on-chain next.` });
      setInvoiceText("");
      refresh();
    } catch (e) {
      setFlow("failed");
      toast.error("Claim failed", { description: (e as Error).message });
    }
  };

  const activePolicy = policies.find((p) => p.onchain?.active);

  const navItems = [
    { label: "Overview", path: "/client/overview", icon: ShieldCheck },
    { label: "Private premium", path: "/client/premium", icon: HeartPulse, badge: submissions.filter((s) => s.status === "pending_verification").length },
    { label: "My policy", path: "/client/policy", icon: BadgeCheck, badge: policies.filter((p) => !p.onchain?.active).length || undefined },
    { label: "Claims", path: "/client/claims", icon: ReceiptText, badge: claims.filter((c) => c.status === "submitted").length },
  ];

  return (
    <PortalLayout
      role="client"
      workspaceTag="CLIENT WORKSPACE"
      navItems={navItems}
      breadcrumb={{ overview: "YOUR COVER", premium: "PRIVATE PREMIUM", policy: "MY POLICY", claims: "CLAIMS" }[section]}
      roleCard={
        <div className="client-role-card">
          <div className="role-mark"><ShieldCheck size={16} /></div>
          <div><span>PRIVACY</span><strong>Local-first</strong></div>
          <p>Health inputs never leave this browser during premium calculation.</p>
        </div>
      }
    >
      {section === "overview" && (
        <>
          <section className="client-intro">
            <div>
              <p className="portal-eyebrow"><span /> YOUR PRIVATE COVER</p>
              <h1>Your private <em>underwriting.</em></h1>
              <p>Your health inputs stay in this browser during premium calculation. Only the ZKML proof and approved premium reach the provider.</p>
            </div>
            <div className="client-intro-stamp">
              <img src="/assets/proofsure-logo-mark.png" alt="" />
              <span>CHAIN</span>
              <strong style={{ fontSize: 14 }}>{config?.simulation ? "SIMULATION" : config?.chain?.mode?.toUpperCase() ?? "LIVE"}</strong>
              <i>{config?.simulation ? "no RPC" : config?.contract ? "ON-CHAIN" : "…"}</i>
            </div>
          </section>

          <section className="portal-notice">
            <Stethoscope size={16} />
            <p><strong>Privacy boundary.</strong> Local inference runs via WebAssembly here; raw features are sent to the proving service only when you explicitly request a ZKML proof, and never stored by the provider.</p>
          </section>

          <div className="stat-cards">
            <div className="stat-card lime">
              <span>LOCAL PREMIUM ESTIMATE</span>
              <strong>{localPremium != null ? `₹${Math.round(localPremium).toLocaleString("en-IN")}` : "—"}</strong>
              <small>Run the model in the premium screen to update.</small>
            </div>
            <div className="stat-card">
              <span>PROOF STATUS</span>
              <strong style={{ fontSize: "1.15rem", letterSpacing: 0 }}>{STATE_LABELS[flow] ?? flow.replace(/_/g, " ").toUpperCase()}</strong>
              <small>{submissionId ? `Submission ${submissionId.slice(0, 8)}…` : "No proof generated yet."}</small>
            </div>
            <div className="stat-card">
              <span>ACTIVE POLICY</span>
              <strong>{activePolicy ? `#${activePolicy.id}` : "NONE"}</strong>
              <small>{activePolicy ? `Limit ${(Number(activePolicy.coverageLimitWei) / 1e18).toFixed(2)} ETH` : "Create one via a verified premium proof."}</small>
            </div>
            <div className="stat-card">
              <span>CLAIMS</span>
              <strong>{claims.length}</strong>
              <small>{claims.filter((c) => c.status === "settled").length} settled · {claims.filter((c) => c.status === "submitted").length} awaiting settlement</small>
            </div>
          </div>

          <div className="event-feed">
            <h3>Your proof route</h3>
            <div className="client-traverse" aria-label="Client proof route">
              <span className={localPremium != null ? "traverse-origin done" : "traverse-origin"}><i /> PRIVATE DATA</span>
              <em />
              <span style={submissionId ? { color: "#3e4e19" } : undefined}>PREMIUM PROOF</span>
              <em />
              <span style={activePolicy ? { color: "#3e4e19" } : undefined}>ACTIVE POLICY</span>
              <em />
              <span className={claims.some((c) => c.status === "settled") ? "traverse-confirm" : "traverse-confirm muted"}><i /> VERIFIED PAYOUT</span>
            </div>
          </div>
        </>
      )}

      {section === "premium" && (
        <>
          <SectionHead kicker="STEP 01 / PRIVATE PREMIUM" title={<>Calculate your premium <em style={{ fontStyle: "italic" }}>privately.</em></>} sub="Edit your private profile, run the insurer's model locally in this browser, then generate the ZKML proof for underwriting." />
          <section className="card-grid-2">
            <article className="portal-panel dark proof-card" style={{ padding: 24 }}>
              <div className="card-kicker"><span>HEALTH PROFILE (STAYS LOCAL)</span><HeartPulse size={17} /></div>
              <div className="flow-grid" style={{ marginTop: 14 }}>
                <NumField label="Age" value={row.age} onChange={(v) => setRow({ ...row, age: v })} />
                <NumField label="Annual income ₹" value={row.annual_income_inr} onChange={(v) => setRow({ ...row, annual_income_inr: v })} />
                <NumField label="BMI" value={row.bmi} onChange={(v) => setRow({ ...row, bmi: v })} step="0.1" />
                <NumField label="Sum insured ₹" value={row.sum_insured} onChange={(v) => setRow({ ...row, sum_insured: v })} />
                <SelectField label="Gender" value={row.gender} onChange={(v) => setRow({ ...row, gender: v })} options={[["F", "Female"], ["M", "Male"]]} />
                <SelectField label="Marital status" value={row.marital_status} onChange={(v) => setRow({ ...row, marital_status: v })} options={[["Single"], ["Married"], ["Divorced"], ["Widowed"]]} />
                <SelectField label="Occupation" value={row.occupation_type} onChange={(v) => setRow({ ...row, occupation_type: v })} options={[["Salaried"], ["Self-employed"], ["Business"], ["Student"], ["Retired"], ["Unemployed"]]} />
                <SelectField label="Tobacco" value={row.tobacco_usage} onChange={(v) => setRow({ ...row, tobacco_usage: v })} options={[["none"], ["smoking"], ["chewing"], ["both"]]} />
                <SelectField label="Diet" value={row.diet_type} onChange={(v) => setRow({ ...row, diet_type: v })} options={[["veg"], ["non-veg"], ["eggetarian"], ["vegan"]]} />
                <SelectField label="Activity" value={row.physical_activity_level} onChange={(v) => setRow({ ...row, physical_activity_level: v })} options={[["low"], ["moderate"], ["high"]]} />
                <SelectField label="Policy type" value={row.policy_type} onChange={(v) => setRow({ ...row, policy_type: v })} options={[["individual"], ["family_floater"], ["senior_citizen"]]} />
                <NumField label="Alcohol units / week" value={row.alcohol_units_per_week} onChange={(v) => setRow({ ...row, alcohol_units_per_week: v })} />
                <NumField label="Stress score" value={row.stress_level_score} onChange={(v) => setRow({ ...row, stress_level_score: v })} />
                <SelectField label="Diabetes" value={row.has_diabetes} onChange={(v) => setRow({ ...row, has_diabetes: v })} options={[[0, "No"], [1, "Yes"]]} />
                <SelectField label="Hypertension" value={row.has_hypertension} onChange={(v) => setRow({ ...row, has_hypertension: v })} options={[[0, "No"], [1, "Yes"]]} />
                <SelectField label="Family cardiac history" value={row.family_history_cardiac} onChange={(v) => setRow({ ...row, family_history_cardiac: v })} options={[[0, "No"], [1, "Yes"]]} />
              </div>
            </article>

            <article className="portal-panel" style={{ padding: 24 }}>
              <div className="card-kicker" style={{ color: "#4b4f42" }}><span>RUN &amp; PROVE</span><FileCheck2 size={17} /></div>
              <p style={{ fontSize: "0.82rem", lineHeight: 1.6 }}>
                1. <strong>Run local model</strong> — ONNX inference in this browser, nothing is sent.<br />
                2. <strong>Generate ZKML proof</strong> — the prover service computes the KZG proof; you receive a submission ID for the provider queue.
              </p>
              <div className="proof-steps" style={{ margin: "14px 0" }}>
                <span className={localPremium != null ? "is-ready" : ""}>{localPremium != null ? `≈ ₹${Math.round(localPremium).toLocaleString("en-IN")}` : "Local model"}</span>
                <i />
                <span className={submissionId ? "is-ready" : ""}>{submissionId ? `Proof ${submissionId.slice(0, 6)}…` : "Proof"}</span>
                <i />
                <span className={submissions.some((s) => s.id === submissionId && s.status === "verified") ? "is-ready" : ""}>Provider verify</span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="outline-action" disabled={flow === "running_local_model"} onClick={runLocalModel}>
                  {flow === "running_local_model" ? <Loader2 className="animate-spin" size={15} /> : <ArrowUpRight size={15} />} Run local model
                </button>
                <button className="dark-action" disabled={flow === "generating_proof"} onClick={generateProof}>
                  {flow === "generating_proof" ? <Loader2 className="animate-spin" size={15} /> : <FileCheck2 size={15} />} Generate ZKML proof
                </button>
              </div>
            </article>
          </section>

          <SectionHead kicker="SUBMISSIONS" title="Your proof history" />
          <article className="portal-panel">
            {submissions.length === 0 && <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>No proofs generated yet.</p>}
            <div className="row-list" style={{ maxHeight: 260 }}>
              {submissions.map((s) => (
                <div className="row-item" key={s.id}>
                  <div>
                    <strong className="mono">{s.id}</strong>
                    <small style={{ display: "block", opacity: 0.65 }}>claimed ₹{Math.round(s.predictionInr).toLocaleString("en-IN")} · {s.createdAt && !Number.isNaN(new Date(s.createdAt).getTime()) ? new Date(s.createdAt).toLocaleString() : "just now"}</small>
                  </div>
                  <span className={`state-pill ${s.status === "verified" ? "ok" : s.status === "rejected" ? "err" : "busy"}`}>{s.status.replace(/_/g, " ").toUpperCase()}</span>
                </div>
              ))}
            </div>
          </article>
        </>
      )}

      {section === "policy" && (
        <>
          <SectionHead kicker="STEP 02 / MY POLICY" title="Coverage on-chain" sub="Once the provider verifies your premium proof they create the policy contract-side. Pay from your wallet to activate it." />
          <p style={{ fontSize: "0.78rem", opacity: 0.7 }}>Connect your MetaMask from the account menu (top right) to pay premiums on-chain.</p>
          {policies.length === 0 && <article className="portal-panel"><p>No policies yet — generate and prove your premium first.</p></article>}
          <div className="card-grid-2">
            {policies.map((p) => {
              const used = Number(p.coverageUsedWei ?? 0);
              const limit = Number(p.coverageLimitWei ?? 1);
              return (
                <article className="portal-panel" key={p.id} style={{ padding: 22 }}>
                  <div className="card-kicker" style={{ color: "#4b4f42" }}><span>POLICY #{p.id}</span><BadgeCheck size={17} /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "16px 0" }}>
                    <div><small style={{ opacity: 0.6, display: "block", fontSize: 10 }}>PREMIUM</small><strong>{(Number(p.premiumWei) / 1e18).toFixed(3)} ETH</strong></div>
                    <div><small style={{ opacity: 0.6, display: "block", fontSize: 10 }}>COVERAGE LIMIT</small><strong>{(limit / 1e18).toFixed(2)} ETH</strong></div>
                    <div><small style={{ opacity: 0.6, display: "block", fontSize: 10 }}>DEDUCTIBLE</small><strong>₹{(Number(p.deductiblePaise) / 100).toLocaleString("en-IN")}</strong></div>
                  </div>
                  <div>
                    <small style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.7 }}>
                      <span>COVERAGE USED</span><span>{(used / 1e18).toFixed(3)} / {(limit / 1e18).toFixed(2)} ETH</span>
                    </small>
                    <div className="progress-track"><i style={{ width: `${Math.min(100, (used / Math.max(limit, 1)) * 100)}%` }} /></div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
                    <span className={`state-pill ${p.onchain?.active ? "ok" : "busy"}`}>
                      {p.onchain?.active ? "ACTIVE" : p.onchain ? "PAYMENT DUE" : "SYNCING…"}
                    </span>
                    {!p.onchain?.active && (
                      <button className="text-action" onClick={() => payPolicy(p)}>
                        Pay {(Number(p.premiumWei) / 1e18).toFixed(4)} ETH from wallet <ArrowUpRight size={13} />
                      </button>
                    )}
                  </div>
                  {!p.onchain?.active && (
                    <small style={{ display: "block", marginTop: 8, opacity: 0.6 }}>
                      Paying opens MetaMask and sends the exact premium to the policy contract from your connected wallet. The provider activates coverage once the payment lands.
                    </small>
                  )}
                  <small style={{ display: "block", marginTop: 12, opacity: 0.55 }}>Model bound: <span className="mono">{String(p.premiumModelId ?? "").slice(0, 18)}…</span></small>
                </article>
              );
            })}
          </div>
        </>
      )}

      {section === "claims" && (
        <>
          <SectionHead kicker="STEP 03 / CLAIMS" title={<>Settle a hospital claim <em style={{ fontStyle: "italic" }}>privately.</em></>} sub="Paste the signed invoice issued by a registered hospital. The Groth16 prover establishes authorization, covered treatment, expense sum, and the exact payout — revealing none of the bill." />
          <div className="card-grid-2">
            <article className="portal-panel" style={{ padding: 24 }}>
              <h3>Signed hospital invoice</h3>
              {invoices.length > 0 && (
                <>
                  <p style={{ fontSize: "0.72rem", opacity: 0.7, margin: "0 0 8px" }}>Invoices delivered to you:</p>
                  <div className="row-list" style={{ maxHeight: 150, marginBottom: 12 }}>
                    {invoices.map((inv) => (
                      <div className="row-item" key={inv.invoiceId}>
                        <div>
                          <strong>#{inv.invoiceId} · policy {inv.policyId}</strong>
                          <small style={{ display: "block", opacity: 0.65 }}>
                            ₹{(Number(inv.totalExpensePaise) / 100).toLocaleString("en-IN")} · from {inv.hospitalId}
                          </small>
                        </div>
                        <button
                          className="text-action"
                          disabled={inv.status === "claimed"}
                          onClick={() => { setInvoiceText(JSON.stringify(inv.doc, null, 2)); toast.success(`Invoice #${inv.invoiceId} loaded`); }}
                        >
                          {inv.status === "claimed" ? "CLAIMED" : "USE →"}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <textarea
                className="mono"
                style={{ width: "100%", minHeight: 130, border: "1px solid color-mix(in srgb, currentColor 18%, transparent)", background: "transparent", borderRadius: 10, padding: 10 }}
                placeholder='{"format":"signed_hospital_invoice_v1", ...}'
                value={invoiceText}
                onChange={(e) => { setInvoiceText(e.target.value); if (e.target.value.includes("signed_hospital_invoice_v1")) setFlow("hospital_invoice_received"); }}
              />
              <button className="dark-action" style={{ marginTop: 12 }} disabled={flow === "generating_claim_proof" || flow === "submitting_claim"} onClick={prepareClaim}>
                {flow === "generating_claim_proof" || flow === "submitting_claim" ? <Loader2 className="animate-spin" size={15} /> : <Stethoscope size={15} />}
                Prove &amp; submit claim
              </button>
              {claimResult && (
                <div className="state-pill ok" style={{ marginTop: 12 }}>Verified payout {claimResult.payout} — settlement appears below once the provider submits on-chain.</div>
              )}
            </article>

            <article className="portal-panel" style={{ padding: 24 }}>
              <h3>Claim ledger</h3>
              {claims.length === 0 && <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>No claims yet.</p>}
              <div className="row-list" style={{ maxHeight: 320 }}>
                {claims.map((c) => (
                  <div className="row-item" key={c.id}>
                    <div>
                      <strong className="mono">{c.id.slice(0, 8)}…</strong>
                      <small style={{ display: "block", opacity: 0.65 }}>policy #{c.policyId} · ₹{(Number(c.payoutPaise) / 100).toLocaleString("en-IN")}{c.txHash ? ` · tx ${String(c.txHash).slice(0, 10)}…` : ""}</small>
                    </div>
                    <span className={`state-pill ${c.status === "settled" ? "ok" : c.status === "rejected" ? "err" : "busy"}`}>{c.status.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </>
      )}
    </PortalLayout>
  );
}

const STATE_LABELS: Partial<Record<FlowState, string>> = {
  idle: "IDLE", running_local_model: "RUNNING LOCAL MODEL", generating_proof: "GENERATING PROOF",
  proof_generated: "PROOF GENERATED", waiting_verification: "AWAITING PROVIDER VERIFICATION",
  hospital_invoice_received: "INVOICE READY", generating_claim_proof: "GENERATING CLAIM PROOF",
  submitting_claim: "SUBMITTING CLAIM", proof_verified: "PROOF VERIFIED", failed: "FAILED",
};

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: string }) {
  // Draft string lets the field be momentarily empty while typing;
  // only valid numbers are committed to the model input.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="flow-field">
      <label>{label}</label>
      <input
        type="number"
        step={step}
        value={draft ?? String(value)}
        onFocus={() => setDraft(value === 0 ? "" : String(value))}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const n = Number(raw);
          if (raw.trim() !== "" && Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: any; onChange: (v: any) => void; options: [any, ...any[][]] }) {
  return (
    <div className="flow-field">
      <label>{label}</label>
      <select value={String(value)} onChange={(e) => onChange(options.find(([v]) => String(v) === e.target.value)?.[0])}>
        {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l ?? String(v)}</option>)}
      </select>
    </div>
  );
}
