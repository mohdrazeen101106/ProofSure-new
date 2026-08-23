/**
 * ProofSure Provider Portal — insurer control room.
 * Premium proof verification queue, policy lifecycle, hospital registry, reserve, claim settlement.
 */
import { BadgeCheck, Building2, Loader2, LockKeyhole, ShieldCheck, Vault } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import PortalSessionActions from "@/components/PortalSessionActions";
import { api } from "@/lib/api";

const logoMark = "/assets/proofsure-logo-mark.png";

export default function ProviderPortal() {
  const [queue, setQueue] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [reserve, setReserve] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // create-policy form
  const [holderWallet, setHolderWallet] = useState("");
  const [premiumEth, setPremiumEth] = useState("0.05");
  const [limitEth, setLimitEth] = useState("2");
  const [deductibleInr, setDeductibleInr] = useState("20000");
  const [copayPct, setCopayPct] = useState("10");

  const refreshAll = async () => {
    try {
      setQueue(await api.providerQueue());
      setPolicies(await api.policies());
      setClaims(await api.claims());
      setHospitals(await api.hospitals());
      setReserve(await api.reserve());
      setConfig(await api.config());
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  useEffect(() => { refreshAll(); }, []);

  const verifySubmission = async (s: any) => {
    setBusy(s.id);
    try {
      const r = await api.verifyPremium(s.id, s.predictionInr);
      if (r.ok) toast.success(`Proof ${s.id} verified`, { description: `De-scaled premium ₹${Math.round(r.descaledInr).toLocaleString("en-IN")} matches the claim.` });
      else toast.error("Verification failed", { description: JSON.stringify(r.checks) });
      refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const createPolicy = async (submissionId?: string) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(holderWallet)) return toast.error("Enter the client's wallet address.");
    if (!submissionId) {
      const pending = queue.find((q) => q.status === "verified");
      if (!pending) return toast.error("Verify a premium proof first — policy creation requires it.");
      submissionId = pending.id;
    }
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
    try {
      await api.activatePolicy(id);
      toast.success(`Policy #${id} activated`);
      refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const authorizeKey = async (h: any) => {
    setBusy(`auth-${h.hospital_id}`);
    try {
      await api.authorizeHospitalKey(h.pk_x, h.pk_y);
      toast.success(`${h.hospital_id} authorized on-chain`, { description: "Its invoices can now pass the ZK hospital check." });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const fundReserve = async () => {
    setBusy("reserve");
    try {
      const r = await api.fundReserve("5");
      toast.success("Reserve funded +5 ETH", { description: `tx ${String(r.txHash).slice(0, 16)}…` });
      refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const settleClaim = async (c: any) => {
    setBusy(c.id);
    try {
      const r = await api.settleClaim(c.id);
      toast.success(`Payout sent — ₹${(Number(r.payoutPaise) / 100).toLocaleString("en-IN")}`, { description: `tx ${r.txHash.slice(0, 16)}…` });
      refreshAll();
    } catch (e) {
      toast.error("Settlement rejected", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="client-portal-page">
      <aside className="client-sidebar">
        <div className="client-sidebar-top">
          <a className="client-brand" href="/"><img src={logoMark} alt="" /><span>PROOFSURE</span></a>
          <div className="workspace-tag"><span /> PROVIDER CONSOLE</div>
        </div>
        <div className="client-role-card">
          <div className="role-mark"><Vault size={16} /></div>
          <div><span>RESERVE</span><strong>{reserve?.eth ?? "—"} ETH</strong></div>
          <p>Verified claims are paid automatically from this reserve.</p>
        </div>
        <PortalSessionActions activeRole="provider" />
      </aside>

      <main className="client-main">
        <header className="client-topbar">
          <div className="client-breadcrumb"><span>PROVIDER</span><i /> PROOF VERIFICATION &amp; SETTLEMENT</div>
        </header>

        <div className="client-content">
          <section className="client-intro client-portal-reveal">
            <div>
              <p className="portal-eyebrow"><span /> INSURER CONTROL ROOM</p>
              <h1>Verify proofs. <em>Nothing else.</em></h1>
              <p>You never see raw health features or medical bills. Policies are created only against verified ZKML proofs; claims are settled only by on-chain verification.</p>
            </div>
            <div className="client-intro-stamp"><img src={logoMark} alt="" /><span>MODEL ID</span><strong style={{ fontSize: 11 }} className="mono">{String(config?.premiumModelId ?? "").slice(0, 10)}…</strong><i>{config?.provingSystem ?? ""}</i></div>
          </section>

          <section className="portal-lower-grid">
            <article className="proof-card client-portal-reveal portal-route-card">
              <div className="card-kicker"><span>01 / PREMIUM PROOF QUEUE</span><ShieldCheck size={17} /></div>
              {queue.length === 0 && <p>No submissions yet.</p>}
              <div className="row-list">
                {queue.map((s) => (
                  <div className="row-item" key={s.id}>
                    <div>
                      <strong>{s.id}</strong>
                      <small style={{ display: "block", opacity: 0.65 }}>₹{Math.round(s.predictionInr).toLocaleString("en-IN")} · {s.clientEmail} · {s.status}</small>
                    </div>
                    {s.status === "pending_verification" ? (
                      <button className="outline-action" disabled={busy === s.id} onClick={() => verifySubmission(s)}>
                        {busy === s.id ? <Loader2 className="animate-spin" size={13} /> : <BadgeCheck size={14} />} Verify
                      </button>
                    ) : (
                      <span className={`state-pill ${s.status === "verified" || s.status === "used" ? "ok" : "err"}`}>{s.status.toUpperCase()}</span>
                    )}
                  </div>
                ))}
              </div>

              <h3 style={{ margin: "16px 0 8px", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.7 }}>Create policy from verified proof</h3>
              <div className="flow-grid">
                <div className="flow-field" style={{ gridColumn: "1 / -1" }}><label>Client wallet</label>
                  <input value={holderWallet} onChange={(e) => setHolderWallet(e.target.value)} placeholder="0x…" /></div>
                <div className="flow-field"><label>Premium (ETH)</label><input value={premiumEth} onChange={(e) => setPremiumEth(e.target.value)} /></div>
                <div className="flow-field"><label>Coverage limit (ETH)</label><input value={limitEth} onChange={(e) => setLimitEth(e.target.value)} /></div>
                <div className="flow-field"><label>Deductible (₹)</label><input value={deductibleInr} onChange={(e) => setDeductibleInr(e.target.value)} /></div>
                <div className="flow-field"><label>Co-pay (%)</label><input value={copayPct} onChange={(e) => setCopayPct(e.target.value)} /></div>
              </div>
              <button className="dark-action" style={{ marginTop: 12 }} disabled={busy === "policy"} onClick={() => createPolicy()}>
                {busy === "policy" ? <Loader2 className="animate-spin" size={15} /> : <ShieldCheck size={15} />} Create policy
              </button>
            </article>

            <article className="coverage-card client-portal-reveal portal-route-card">
              <div className="card-kicker"><span>02 / POLICIES</span><BadgeCheck size={17} /></div>
              <div className="row-list">
                {policies.map((p) => (
                  <div className="row-item" key={p.id}>
                    <div>
                      <strong>#{p.id}</strong>
                      <small style={{ display: "block", opacity: 0.65 }} className="mono">{String(p.holderWallet).slice(0, 10)}… · {(Number(p.premiumWei) / 1e18).toFixed(3)} ETH</small>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className={`state-pill ${p.onchain?.active ? "ok" : "busy"}`}>{p.onchain?.active ? "ACTIVE" : "INACTIVE"}</span>
                      {!p.onchain?.active && (
                        <button className="text-action" style={{ display: "block", marginTop: 6 }} onClick={() => activate(p.id)}>Activate</button>
                      )}
                    </div>
                  </div>
                ))}
                {policies.length === 0 && <small style={{ opacity: 0.6 }}>No policies created.</small>}
              </div>
            </article>
          </section>

          <section className="portal-lower-grid">
            <article className="privacy-card client-portal-reveal portal-route-card">
              <div className="card-kicker"><span>03 / CLAIM SETTLEMENT</span><LockKeyhole size={17} /></div>
              <div className="row-list">
                {claims.map((c) => (
                  <div className="row-item" key={c.id}>
                    <div>
                      <strong>{c.id.slice(0, 6)}…</strong>
                      <small style={{ display: "block", opacity: 0.65 }}>policy #{c.policyId} · ₹{(Number(c.payoutPaise) / 100).toLocaleString("en-IN")} · hospital {c.hospitalId}</small>
                    </div>
                    {c.status === "submitted" ? (
                      <button className="outline-action" disabled={busy === c.id} onClick={() => settleClaim(c)}>
                        {busy === c.id ? <Loader2 className="animate-spin" size={13} /> : <Vault size={14} />} Settle
                      </button>
                    ) : (
                      <span className={`state-pill ${c.status === "settled" ? "ok" : "err"}`}>{c.status.toUpperCase()}</span>
                    )}
                  </div>
                ))}
                {claims.length === 0 && <small style={{ opacity: 0.6 }}>No incoming claims.</small>}
              </div>
            </article>

            <article className="claim-card client-portal-reveal portal-route-card">
              <div className="card-kicker"><span>04 / HOSPITALS &amp; RESERVE</span><Building2 size={17} /></div>
              <div className="row-list">
                {Object.values(hospitals).map((h: any) => (
                  <div className="row-item" key={h.hospital_id}>
                    <div><strong>{h.hospital_id}</strong>
                      <small style={{ display: "block", opacity: 0.6 }} className="mono">pk_x {String(h.pk_x).slice(0, 18)}…</small></div>
                    <button className="text-action" disabled={busy === `auth-${h.hospital_id}`} onClick={() => authorizeKey(h)}>Authorize on-chain</button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
                <strong>Reserve: {reserve?.eth ?? "—"} ETH</strong>
                <button className="outline-action" disabled={busy === "reserve"} onClick={fundReserve}>Fund +5 ETH</button>
              </div>
            </article>
          </section>
        </div>
      </main>
    </div>
  );
}
