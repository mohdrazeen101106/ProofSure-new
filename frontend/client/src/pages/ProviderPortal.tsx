/**
 * ProofSure Provider Portal — insurer control room, routed screens:
 * Overview, Verification queue (+ policy creation), Policies, Claim settlement, Hospitals & reserve.
 */
import {
  BadgeCheck, Building2, CheckCircle2, FileSignature, Loader2,
  LockKeyhole, ShieldCheck, Vault,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import PortalLayout, { SectionHead } from "@/components/PortalLayout";
import { api } from "@/lib/api";

const SECTIONS = ["overview", "queue", "policies", "claims", "hospitals"] as const;
type Section = (typeof SECTIONS)[number];

export default function ProviderPortal() {
  const [location, navigate] = useLocation();
  const raw = location.split("/")[2] ?? "";
  const section: Section = (SECTIONS as readonly string[]).includes(raw) ? (raw as Section) : "overview";

  const [queue, setQueue] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [reserve, setReserve] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [rateNote, setRateNote] = useState<string>("");

  // create-policy form
  const [submissionId, setSubmissionId] = useState("");
  const [holderWallet, setHolderWallet] = useState("");
  const [premiumEth, setPremiumEth] = useState("");
  const [limitEth, setLimitEth] = useState("2");
  const [deductibleInr, setDeductibleInr] = useState("20000");
  const [copayPct, setCopayPct] = useState("10");

  const formatDate = (ts?: string) => {
    if (!ts) return "—";
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  };

  const copyText = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  };

  // Convert the proof's INR premium to ETH using the on-chain AggregatorV3 feed
  // bound to the policy contract — no hardcoded rates anywhere.
  const autofillPremiumFromProof = async (sub: any) => {
    const paise = Math.round(Number(sub.predictionInr) * 100);
    try {
      const r = await api.convertPaise(paise);
      setPremiumEth(r.eth.toFixed(6));
      setRateNote(`₹${Math.round(sub.predictionInr).toLocaleString("en-IN")} → ${r.eth.toFixed(6)} ETH @ aggregator rate ₹${Math.round(r.priceInrPerEth).toLocaleString("en-IN")}/ETH`);
    } catch (e) {
      setRateNote("");
      toast.warning("Could not fetch aggregator rate", { description: `${(e as Error).message} — enter the premium manually.` });
    }
  };

  const refreshAll = async () => {
    try {
      const [q, p, c, h, r, cfg, ev] = await Promise.all([
        api.providerQueue(), api.policies(), api.claims(), api.hospitals(),
        api.reserve(), api.config(), api.events(),
      ]);
      setQueue(q); setPolicies(p); setClaims(c); setHospitals(h);
      setReserve(r); setConfig(cfg); setEvents(ev.slice(0, 14));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  useEffect(() => { refreshAll(); }, []);

  const pending = queue.filter((s) => s.status === "pending_verification");
  const verified = queue.filter((s) => s.status === "verified");
  const openClaims = claims.filter((c) => c.status === "submitted");

  const verifySubmission = async (s: any) => {
    setBusy(s.id);
    try {
      const r = await api.verifyPremium(s.id, s.predictionInr);
      if (r.ok) toast.success(`Proof ${s.id.slice(0, 8)}… verified`, { description: `De-scaled premium ₹${Math.round(r.descaledInr).toLocaleString("en-IN")} matches the claim.` });
      else toast.error("Verification failed", { description: JSON.stringify(r.checks) });
      refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const createPolicy = async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(holderWallet)) return toast.error("Enter the client's wallet address.");
    if (!submissionId) return toast.error("Select a verified premium proof first.");
    setBusy("policy");
    try {
      const r = await api.createPolicy({
        submissionId,
        holderWallet,
        premiumWei: BigInt(Math.round(Number(premiumEth) * 1e18)).toString(),
        coverageLimitWei: BigInt(Math.round(Number(limitEth) * 1e18)).toString(),
        deductiblePaise: String(Math.round(Number(deductibleInr) * 100)),
        coPayBps: Math.round(Number(copayPct) * 100),
      });
      toast.success(`Policy #${r.policyId} created`, { description: "Client can now pay the premium to activate coverage." });
      refreshAll();
    } catch (e) {
      toast.error("Policy creation failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const activate = async (id: number) => {
    setBusy(`act-${id}`);
    try {
      await api.activatePolicy(id);
      toast.success(`Policy #${id} activated`);
      refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  const authorizeKey = async (h: any) => {
    setBusy(`auth-${h.hospital_id}`);
    try {
      await api.authorizeHospitalKey(h.pk_x, h.pk_y);
      toast.success(`${h.hospital_id} authorized on-chain`, { description: "Its invoices can now pass the ZK hospital check." });
      refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  const fundReserve = async () => {
    setBusy("reserve");
    try {
      const r = await api.fundReserve("5");
      toast.success("Reserve funded +5 ETH", { description: `tx ${String(r.txHash).slice(0, 16)}…` });
      refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  const settleClaim = async (c: any) => {
    setBusy(c.id);
    try {
      const r = await api.settleClaim(c.id);
      toast.success(`Payout sent — ₹${(Number(r.payoutPaise) / 100).toLocaleString("en-IN")}`, { description: `tx ${r.txHash.slice(0, 16)}…` });
      refreshAll();
    } catch (e) {
      toast.error("Settlement rejected", { description: (e as Error).message });
    } finally { setBusy(null); }
  };

  const navItems = [
    { label: "Overview", path: "/provider/overview", icon: ShieldCheck },
    { label: "Verification queue", path: "/provider/queue", icon: BadgeCheck, badge: pending.length },
    { label: "Policies", path: "/provider/policies", icon: FileSignature, badge: policies.filter((p) => !p.onchain?.active && p.status === "pending_payment").length || undefined },
    { label: "Claims", path: "/provider/claims", icon: LockKeyhole, badge: openClaims.length },
    { label: "Hospitals & reserve", path: "/provider/hospitals", icon: Building2 },
  ];

  return (
    <PortalLayout
      role="provider"
      workspaceTag="PROVIDER CONSOLE"
      navItems={navItems}
      breadcrumb={{ overview: "CONTROL ROOM", queue: "PROOF VERIFICATION", policies: "POLICY BOOK", claims: "CLAIM SETTLEMENT", hospitals: "REGISTRY & RESERVE" }[section]}
      roleCard={
        <div className="client-role-card">
          <div className="role-mark"><Vault size={16} /></div>
          <div><span>RESERVE</span><strong>{reserve?.eth ?? "—"} ETH</strong></div>
          <p>Verified claims are paid automatically from this reserve.</p>
        </div>
      }
    >
      {section === "overview" && (
        <>
          <section className="client-intro">
            <div>
              <p className="portal-eyebrow"><span /> INSURER CONTROL ROOM</p>
              <h1>Verify proofs. <em>Nothing else.</em></h1>
              <p>You never see raw health features or medical bills. Policies are created only against verified ZKML proofs; claims are settled only by on-chain verification.</p>
            </div>
            <div className="client-intro-stamp">
              <img src="/assets/proofsure-logo-mark.png" alt="" />
              <span>MODEL ID</span>
              <strong style={{ fontSize: 11 }} className="mono">{String(config?.premiumModelId ?? "").slice(0, 10)}…</strong>
              <i>{config?.provingSystem ?? ""}</i>
            </div>
          </section>

          <div className="stat-cards">
            <button className="stat-card lime" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => navigate("/provider/queue")}>
              <span>PENDING VERIFICATION</span>
              <strong>{pending.length}</strong>
              <small>ZKML premium proofs in queue →</small>
            </button>
            <div className="stat-card">
              <span>ACTIVE POLICIES</span>
              <strong>{policies.filter((p) => p.onchain?.active).length}<small style={{ display: "inline", fontSize: "1rem", opacity: 0.6 }}> / {policies.length}</small></strong>
              <small>{policies.filter((p) => !p.onchain?.active).length} awaiting payment/activation</small>
            </div>
            <div className="stat-card">
              <span>OPEN CLAIMS</span>
              <strong>{openClaims.length}</strong>
              <small>{claims.filter((c) => c.status === "settled").length} settled lifetime</small>
            </div>
            <div className="stat-card">
              <span>RESERVE</span>
              <strong>{reserve?.eth ?? "—"}<small style={{ display: "inline", fontSize: "1rem", opacity: 0.6 }}> ETH</small></strong>
              <small>Funds automatic claim payouts</small>
            </div>
          </div>

          <div className="event-feed portal-panel" style={{ padding: 20 }}>
            <h3>Recent network activity</h3>
            {events.length === 0 && <p className="event-feed-empty">Nothing yet. Client proofs, hospital registrations and settlements will appear here.</p>}
            {events.map((e, i) => (
              <div className="event-feed-row" key={i}>
                <em>{String(e.type).replace(/_/g, " ")}</em>
                <span>{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {section === "queue" && (
        <>
          <SectionHead kicker="STEP 01 / VERIFICATION QUEUE" title={<>Verify ZKML premium <em style={{ fontStyle: "italic" }}>proofs.</em></>} sub="Each entry is a client's KZG proof. Verify re-checks the proof against the registered model and confirms the claimed premium within ±1 INR." />
          <article className="portal-panel dark proof-card" style={{ padding: 24 }}>
            {queue.length === 0 && <p>No submissions yet — clients generate proofs from their portal.</p>}
            <div className="row-list" style={{ maxHeight: 340 }}>
              {queue.map((s) => (
                <div className="row-item" key={s.id}>
                  <div>
                    <strong className="mono">{s.id}</strong>
                    <small style={{ display: "block", opacity: 0.65 }}>
                      ₹{Math.round(s.predictionInr).toLocaleString("en-IN")} · {s.clientEmail} · {formatDate(s.createdAt)}
                    </small>
                    <small style={{ display: "block", opacity: 0.65 }}>
                      {s.clientWallet ? (
                        <>wallet <span className="mono">{String(s.clientWallet).slice(0, 10)}…{String(s.clientWallet).slice(-6)}</span>
                          <button className="text-action" style={{ marginLeft: 8, fontSize: "0.62rem" }} onClick={() => copyText(s.clientWallet, "Client wallet")}>copy</button>
                        </>
                      ) : (
                        <span style={{ opacity: 0.7 }}>no wallet bound yet</span>
                      )}
                    </small>
                  </div>
                  {s.status === "pending_verification" ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="outline-action" disabled={busy === s.id} onClick={() => verifySubmission(s)} aria-label={`Verify proof ${s.id}`}>
                        {busy === s.id ? <Loader2 className="animate-spin" size={13} /> : <BadgeCheck size={14} />} Verify
                      </button>
                      <button
                        className="dark-action"
                        disabled={busy === `pol-${s.id}`}
                        onClick={() => {
                          setSubmissionId(s.id);
                          if (s.clientWallet) setHolderWallet(s.clientWallet);
                          if (s) autofillPremiumFromProof(s);
                          toast.info("Proof attached", { description: "Premium auto-converted from the aggregator; review terms below." });
                        }}
                      >
                        Use for policy
                      </button>
                    </div>
                  ) : (
                    <span className={`state-pill ${s.status === "verified" || s.status === "used" ? "ok" : "err"}`}>{s.status.toUpperCase()}</span>
                  )}
                </div>
              ))}
            </div>
          </article>

          <SectionHead kicker="CREATE POLICY" title="Bind a verified proof to an on-chain policy" sub="The policy stores the model hash it was priced against; claims are later checked against this same binding." />
          <article className="portal-panel" style={{ padding: 24 }}>
            <div className="flow-grid">
              <div className="flow-field"><label>Verified submission</label>
                <select value={submissionId} onChange={(e) => {
                  const id = e.target.value;
                  setSubmissionId(id);
                  const sub = verified.find((s) => s.id === id);
                  if (sub?.clientWallet) {
                    setHolderWallet(sub.clientWallet);
                    toast.info("Client wallet attached", { description: `${sub.clientWallet.slice(0, 10)}…${sub.clientWallet.slice(-6)} pre-filled from the proof submission.` });
                  } else {
                    toast.warning("No wallet bound to this submission", { description: "Ask the client to connect their wallet and regenerate the proof." });
                  }
                  if (sub) autofillPremiumFromProof(sub);
                }}>
                  <option value="">— select a verified proof —</option>
                  {verified.map((s) => <option key={s.id} value={s.id}>{`${s.id.slice(0, 10)}… · ₹${Math.round(s.predictionInr).toLocaleString("en-IN")}${s.clientWallet ? " · " + s.clientWallet.slice(0, 8) + "…" : ""}`}</option>)}
                </select>
              </div>
              <div className="flow-field"><label>Client wallet</label>
                <input value={holderWallet} onChange={(e) => setHolderWallet(e.target.value)} placeholder="0x…" />
              </div>
              <div className="flow-field"><label>Premium (ETH — auto-filled from aggregator)</label><input value={premiumEth} onChange={(e) => setPremiumEth(e.target.value)} /></div>
              <div className="flow-field"><label>Coverage limit (ETH)</label><input value={limitEth} onChange={(e) => setLimitEth(e.target.value)} /></div>
              <div className="flow-field"><label>Deductible (₹)</label><input value={deductibleInr} onChange={(e) => setDeductibleInr(e.target.value)} /></div>
              <div className="flow-field"><label>Co-pay (%)</label><input value={copayPct} onChange={(e) => setCopayPct(e.target.value)} /></div>
            </div>
            {rateNote && <small style={{ display: "block", marginTop: 8, opacity: 0.7 }}>{rateNote}</small>}
            <button className="dark-action" style={{ marginTop: 14 }} disabled={busy === "policy"} onClick={createPolicy}>
              {busy === "policy" ? <Loader2 className="animate-spin" size={15} /> : <ShieldCheck size={15} />} Create policy on-chain
            </button>
          </article>
        </>
      )}

      {section === "policies" && (
        <>
          <SectionHead kicker="STEP 02 / POLICY BOOK" title="Every policy, its chain state" sub="Activate once the client's premium payment lands on-chain." />
          <article className="portal-panel">
            {policies.length === 0 && <p>No policies created yet.</p>}
            <div className="row-list" style={{ maxHeight: 420 }}>
              {policies.map((p) => {
                const used = Number(p.coverageUsedWei ?? 0);
                const limit = Number(p.coverageLimitWei ?? 1);
                return (
                  <div className="row-item" key={p.id}>
                    <div>
                      <strong>#{p.id} · {(Number(p.premiumWei) / 1e18).toFixed(3)} ETH</strong>
                      <small style={{ display: "block", opacity: 0.65 }} className="mono">
                        {String(p.holderWallet).slice(0, 12)}… · limit {(limit / 1e18).toFixed(2)} ETH · used {(used / 1e18).toFixed(3)}
                      </small>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 10 }}>
                      <span className={`state-pill ${p.onchain?.active ? "ok" : "busy"}`}>{p.onchain?.active ? "ACTIVE" : "INACTIVE"}</span>
                      {!p.onchain?.active && (
                        <button className="text-action" disabled={busy === `act-${p.id}`} onClick={() => activate(p.id)}>
                          Activate <CheckCircle2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </>
      )}

      {section === "claims" && (
        <>
          <SectionHead kicker="STEP 03 / CLAIM SETTLEMENT" title={<>Settle verified claims <em style={{ fontStyle: "italic" }}>on-chain.</em></>} sub="Settlement submits the Groth16 proof to the contract: signature, registry, nullifier, coverage and oracle conversion are all re-checked before ETH moves." />
          <article className="portal-panel dark" style={{ padding: 24 }}>
            {claims.length === 0 && <p>No incoming claims.</p>}
            <div className="row-list" style={{ maxHeight: 420 }}>
              {claims.map((c) => (
                <div className="row-item" key={c.id}>
                  <div>
                    <strong className="mono">{c.id.slice(0, 10)}…</strong>
                    <small style={{ display: "block", opacity: 0.65 }}>
                      policy #{c.policyId} · ₹{(Number(c.payoutPaise) / 100).toLocaleString("en-IN")} · hospital {c.hospitalId ?? "—"}
                    </small>
                  </div>
                  {c.status === "submitted" ? (
                    <button className="outline-action" disabled={busy === c.id} onClick={() => settleClaim(c)}>
                      {busy === c.id ? <Loader2 className="animate-spin" size={13} /> : <Vault size={14} />} Settle &amp; pay
                    </button>
                  ) : (
                    <span className={`state-pill ${c.status === "settled" ? "ok" : "err"}`}>{c.status.toUpperCase()}{c.txHash ? ` · ${String(c.txHash).slice(0, 8)}…` : ""}</span>
                  )}
                </div>
              ))}
            </div>
          </article>
        </>
      )}

      {section === "hospitals" && (
        <>
          <SectionHead kicker="STEP 04 / REGISTRY & RESERVE" title="Hospital keys and payout funds" sub="Only authorized BabyJubJub public keys can pass the claim circuit's hospital check. Keep the reserve funded so valid claims never bounce." />
          <div className="card-grid-2">
            <article className="portal-panel" style={{ padding: 24 }}>
              <h3>Hospital registry</h3>
              {Object.values(hospitals).length === 0 && <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>No hospital keys registered yet — hospitals register from their desk.</p>}
              <div className="row-list">
                {Object.values(hospitals).map((h: any) => (
                  <div className="row-item" key={h.hospital_id}>
                    <div>
                      <strong>{h.hospital_id}</strong>
                      <small style={{ display: "block", opacity: 0.6 }} className="mono">pk_x {String(h.pk_x).slice(0, 22)}…</small>
                    </div>
                    <button className="text-action" disabled={busy === `auth-${h.hospital_id}`} onClick={() => authorizeKey(h)}>
                      Authorize on-chain
                    </button>
                  </div>
                ))}
              </div>
            </article>

            <article className="portal-panel dark" style={{ padding: 24 }}>
              <h3>Reserve vault</h3>
              <strong style={{ fontSize: "clamp(2rem, 4vw, 3.4rem)", letterSpacing: "-0.06em" }}>{reserve?.eth ?? "—"}<small style={{ fontSize: "1rem", opacity: 0.7 }}> ETH</small></strong>
              <p style={{ fontSize: "0.78rem", opacity: 0.75, margin: "10px 0 16px" }}>The contract pays claims directly from this balance. If it runs dry, settlement reverts and the client waits.</p>
              <button className="outline-action" disabled={busy === "reserve"} onClick={fundReserve}>Fund +5 ETH</button>
              {reserve?.note && <small style={{ display: "block", marginTop: 10, opacity: 0.5 }}>{reserve.note}</small>}
            </article>
          </div>
        </>
      )}
    </PortalLayout>
  );
}
