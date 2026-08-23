/**
 * ProofSure Hospital Portal — invoice desk.
 * Creates itemized invoices and signs them with the hospital's
 * EdDSA-Poseidon (BabyJubJub) key held by the backend for this role.
 */
import { ArrowUpRight, BadgeCheck, FileSignature, Loader2, LockKeyhole, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import PortalSessionActions from "@/components/PortalSessionActions";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const logoMark = "/assets/proofsure-logo-mark.png";
const sourceMapImage = "/assets/proofsure-source-map.jpg";

export default function HospitalPortal() {
  const { session } = useAuth();
  const [hospitalId, setHospitalId] = useState(session?.hospitalId ?? "");
  const [policyId, setPolicyId] = useState("");
  const [treatmentCode, setTreatmentCode] = useState("1");
  const [expenses, setExpenses] = useState("35000, 25000, 12000, 9000, 6500"); // rupees
  const [signedInvoice, setSignedInvoice] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [hospitals, setHospitals] = useState<any[]>([]);

  useEffect(() => {
    api.hospitals().then(setHospitals).catch(() => {});
    if (!hospitalId && !session?.hospitalId) setHospitalId("HOSP001");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expensePaise = () =>
    expenses.split(/[,\s]+/).filter(Boolean).map((r) => String(Math.round(Number(r) * 100)));

  const sign = async () => {
    if (!hospitalId || !policyId) return toast.error("Hospital ID and policy ID are required.");
    setBusy(true);
    try {
      const invoice = await api.signInvoice({
        hospital_id: hospitalId,
        policy_id: policyId,
        treatment_code: Number(treatmentCode),
        admission_date: Math.floor(Date.now() / 1000) - 86400 * 2,
        expenses_paise: expensePaise(),
      });
      setSignedInvoice(invoice);
      toast.success(`Invoice #${invoice.invoice_id} signed`, {
        description: `Total ₹${(Number(invoice.total_expense_paise) / 100).toLocaleString("en-IN")} · EdDSA-Poseidon verified server-side.`,
      });
    } catch (e) {
      toast.error("Signing failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!signedInvoice) return;
    await navigator.clipboard.writeText(JSON.stringify(signedInvoice, null, 2));
    toast.success("Signed invoice copied", { description: "Paste it into the client portal's claim panel." });
  };

  return (
    <div className="client-portal-page">
      <aside className="client-sidebar">
        <div className="client-sidebar-top">
          <a className="client-brand" href="/"><img src={logoMark} alt="" /><span>PROOFSURE</span></a>
          <div className="workspace-tag"><span /> HOSPITAL DESK</div>
        </div>
        <div className="client-role-card">
          <div className="role-mark"><Stethoscope size={16} /></div>
          <div><span>IDENTITY</span><strong>{session?.name}</strong></div>
          <p>Invoices are signed with your hospital's registered key. Fake keys fail the ZK authorization check.</p>
        </div>
        <PortalSessionActions activeRole="hospital" />
      </aside>

      <main className="client-main">
        <header className="client-topbar">
          <div className="client-breadcrumb"><span>HOSPITAL</span><i /> INVOICE DESK</div>
        </header>

        <div className="client-content">
          <section className="client-intro client-portal-reveal">
            <div>
              <p className="portal-eyebrow"><span /> SIGNED INVOICES</p>
              <h1>Issue a <em>verifiable invoice.</em></h1>
              <p>Each invoice is EdDSA-Poseidon signed over its canonical fields. The claim circuit proves the signature against your registered public key without exposing the bill.</p>
            </div>
            <div className="client-intro-stamp">
              <img src={sourceMapImage} alt="Route map of a claim converging on one verified point" />
              <span>ROUTE</span><strong style={{ fontSize: 12 }}>INVOICE → PROOF</strong><i>{Object.keys(hospitals).length} KEYS</i>
            </div>
          </section>

          <section className="portal-lower-grid">
            <article className="proof-card client-portal-reveal portal-route-card">
              <div className="card-kicker"><span>01 / INVOICE</span><FileSignature size={17} /></div>
              <div className="flow-grid">
                <div className="flow-field"><label>Hospital ID</label>
                  <input value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} placeholder="HOSP001" /></div>
                <div className="flow-field"><label>Policy ID</label>
                  <input value={policyId} onChange={(e) => setPolicyId(e.target.value)} placeholder="e.g. 5" /></div>
                <div className="flow-field"><label>Treatment</label>
                  <select value={treatmentCode} onChange={(e) => setTreatmentCode(e.target.value)}>
                    <option value="1">HOSPITALIZATION</option><option value="2">SURGERY</option>
                    <option value="3">EMERGENCY</option><option value="4">ICU</option>
                  </select></div>
                <div className="flow-field" style={{ gridColumn: "1 / -1" }}><label>Itemized expenses (₹, comma separated)</label>
                  <input value={expenses} onChange={(e) => setExpenses(e.target.value)} /></div>
              </div>
              <button className="dark-action" style={{ marginTop: 14 }} disabled={busy} onClick={sign}>
                {busy ? <Loader2 className="animate-spin" size={15} /> : <FileSignature size={15} />} Sign invoice
              </button>

              {signedInvoice && (
                <div className="flow-panel">
                  <h3>Signed bundle</h3>
                  <div className="mono">{JSON.stringify(signedInvoice, null, 2).slice(0, 600)}…</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button className="outline-action" onClick={copy}>Copy JSON <ArrowUpRight size={14} /></button>
                  </div>
                  <small style={{ opacity: 0.6 }}>Send this to the claimant (client). They combine it with private policy data inside the ZK prover.</small>
                </div>
              )}
            </article>

            <article className="privacy-card client-portal-reveal portal-route-card">
              <div className="card-kicker"><span>02 / REGISTERED KEYS</span><BadgeCheck size={17} /></div>
              <p>Only provider-authorized public keys pass the on-chain hospital registry. Your key:</p>
              <div className="row-list">
                {Object.values(hospitals).map((h: any) => (
                  <div className="row-item" key={h.hospital_id}>
                    <div><strong>{h.hospital_id}</strong><small style={{ display: "block", opacity: 0.6 }} className="mono">pk_x {String(h.pk_x).slice(0, 18)}…</small></div>
                    <LockKeyhole size={15} />
                  </div>
                ))}
              </div>
              <small style={{ opacity: 0.6, marginTop: 8 }}>
                Need a new key? Ask the provider dashboard to authorize a generated key after registering it here.
              </small>
            </article>
          </section>
        </div>
      </main>
    </div>
  );
}
