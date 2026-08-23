/**
 * ProofSure Hospital Portal — routed screens: Invoice desk and Key management.
 * The signing identity is the logged-in account's server-assigned hospital ID;
 * invoices are addressed to a client and delivered through the backend, so the
 * client receives them in their portal (no more copy/paste JSON hand-off).
 */
import {
  ArrowUpRight, BadgeCheck, FileSignature, KeyRound, Loader2, LockKeyhole, Send, Stethoscope,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import PortalLayout, { SectionHead } from "@/components/PortalLayout";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const SECTIONS = ["invoice", "keys"] as const;
type Section = (typeof SECTIONS)[number];

export default function HospitalPortal() {
  const { session } = useAuth();
  const [location] = useLocation();
  const raw = location.split("/")[2] ?? "";
  const section: Section = (SECTIONS as readonly string[]).includes(raw) ? (raw as Section) : "invoice";

  // Identity is bound to the login — never user-editable.
  const hospitalId = session?.hospitalId ?? null;

  const [clientEmail, setClientEmail] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [treatmentCode, setTreatmentCode] = useState("1");
  const [admissionOffsetDays, setAdmissionOffsetDays] = useState(2);
  const [expenses, setExpenses] = useState("35000, 25000, 12000, 9000, 6500");
  const [signedInvoice, setSignedInvoice] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [hospitals, setHospitals] = useState<any[]>([]);

  const refresh = async () => {
    if (!hospitalId) return;
    try { setInvoices(await api.hospitalInvoices()); } catch { /* */ }
    try { setHospitals(await api.hospitals()); } catch { /* */ }
  };

  useEffect(() => { refresh(); }, [hospitalId]); // eslint-disable-line react-hooks/exhaustive-deps

  const expensePaise = () =>
    expenses.split(/[,\s]+/).filter(Boolean).map((r) => String(Math.round(Number(r) * 100)));

  const signAndSend = async () => {
    if (!hospitalId) return toast.error("Your account has no hospital identity assigned.");
    if (!policyId) return toast.error("Policy ID is required.");
    if (!expensePaise().length) return toast.error("Add at least one expense line.");
    const email = clientEmail.trim().toLowerCase();
    if (!email) return toast.error("Enter the client's email to deliver the invoice to.");
    setBusy("sign");
    try {
      const invoice = await api.signInvoice({
        policy_id: policyId,
        treatment_code: Number(treatmentCode),
        admission_date: Math.floor(Date.now() / 1000) - 86400 * admissionOffsetDays,
        expenses_paise: expensePaise(),
        clientEmail: email,
      });
      setSignedInvoice(invoice);
      setClientEmail("");
      toast.success(`Invoice #${invoice.invoice_id} signed & delivered`, {
        description: `Total Rs ${(Number(invoice.total_expense_paise) / 100).toLocaleString("en-IN")} — now visible in ${invoice.deliveredTo}'s claims screen.`,
      });
      refresh();
    } catch (e) {
      toast.error("Signing failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const generateKey = async () => {
    setBusy("key");
    try {
      await api.generateHospitalKey(hospitalId!);
      toast.success(`New key registered for ${hospitalId}`, { description: "Ask the provider to authorize it on-chain before issuing invoices." });
      refresh();
    } catch (e) {
      toast.error("Key generation failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <PortalLayout
      role="hospital"
      workspaceTag="HOSPITAL DESK"
      navItems={[
        { label: "Invoice desk", path: "/hospital/invoice", icon: FileSignature },
        { label: "Keys", path: "/hospital/keys", icon: KeyRound },
      ]}
      breadcrumb={section === "invoice" ? "INVOICE DESK" : "KEY MANAGEMENT"}
      roleCard={
        <div className="client-role-card">
          <div className="role-mark"><Stethoscope size={16} /></div>
          <div><span>IDENTITY</span><strong>{session?.name}</strong></div>
          <p>Signing as <strong>{hospitalId ?? "unassigned"}</strong>. Invoices are signed with your hospital's registered key; fake identities fail the ZK check.</p>
        </div>
      }
    >
      {!hospitalId && (
        <section className="portal-notice" style={{ marginBottom: 18 }}>
          <LockKeyhole size={16} />
          <p><strong>No hospital identity.</strong> This account was created before identity binding existed. Ask the administrator to re-provision your hospital account.</p>
        </section>
      )}

      {section === "invoice" && (
        <>
          <SectionHead kicker="SIGNED INVOICES" title={<>Issue a <em style={{ fontStyle: "italic" }}>verifiable invoice.</em></>} sub="Each invoice is EdDSA-Poseidon signed over its canonical fields and delivered straight into the named client's portal. The claim circuit proves the signature against your registered public key without exposing the bill." />
          <div className="card-grid-2">
            <article className="portal-panel dark proof-card" style={{ padding: 24 }}>
              <div className="card-kicker"><span>NEW INVOICE — SIGNING AS {hospitalId ?? "?"}</span><FileSignature size={17} /></div>
              <div className="flow-grid" style={{ marginTop: 14 }}>
                <div className="flow-field" style={{ gridColumn: "1 / -1" }}><label>Deliver to client (email)</label>
                  <input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="client@proofsure.dev" />
                </div>
                <div className="flow-field"><label>Policy ID</label>
                  <input value={policyId} onChange={(e) => setPolicyId(e.target.value)} placeholder="e.g. 1" />
                </div>
                <div className="flow-field"><label>Treatment</label>
                  <select value={treatmentCode} onChange={(e) => setTreatmentCode(e.target.value)}>
                    <option value="1">HOSPITALIZATION</option><option value="2">SURGERY</option>
                    <option value="3">EMERGENCY</option><option value="4">ICU</option>
                  </select>
                </div>
                <div className="flow-field"><label>Admitted (days ago)</label>
                  <input type="number" min={0} value={admissionOffsetDays} onChange={(e) => setAdmissionOffsetDays(Number(e.target.value))} />
                </div>
                <div className="flow-field" style={{ gridColumn: "1 / -1" }}><label>Itemized expenses (INR, comma separated)</label>
                  <input value={expenses} onChange={(e) => setExpenses(e.target.value)} />
                </div>
              </div>
              <button className="dark-action" style={{ marginTop: 14 }} disabled={busy === "sign"} onClick={signAndSend}>
                {busy === "sign" ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />} Sign &amp; deliver to client
              </button>

              {signedInvoice && (
                <div className="flow-panel">
                  <h4 style={{ margin: 0, fontSize: 12 }}>Invoice #{signedInvoice.invoice_id} — delivered</h4>
                  <small>Total INR {(Number(signedInvoice.total_expense_paise) / 100).toLocaleString("en-IN")} · treatment code {signedInvoice.treatment_code} · to {signedInvoice.deliveredTo}</small>
                  <small style={{ opacity: 0.6 }}>The client will find it under Claims in their portal, pre-filled and ready to prove.</small>
                </div>
              )}
            </article>

            <article className="portal-panel" style={{ padding: 24 }}>
              <h3>Issued invoices (server ledger)</h3>
              {invoices.length === 0 && <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>Nothing issued yet.</p>}
              <div className="row-list" style={{ maxHeight: 380 }}>
                {invoices.map((inv) => (
                  <div className="row-item" key={inv.invoiceId}>
                    <div>
                      <strong>#{inv.invoiceId} · policy {inv.policyId}</strong>
                      <small style={{ display: "block", opacity: 0.65 }}>
                        INR {(Number(inv.totalExpensePaise) / 100).toLocaleString("en-IN")} → {inv.clientEmail}
                      </small>
                    </div>
                    <span className={`state-pill ${inv.status === "claimed" ? "ok" : "busy"}`}>{inv.status.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </>
      )}

      {section === "keys" && (
        <>
          <SectionHead kicker="KEY MANAGEMENT" title="Your signing keys" sub={`Keys are generated for your bound identity (${hospitalId ?? "?"}) only. The private key never leaves the ProofSure backend. Only provider-authorized public keys pass the on-chain hospital registry.`} />
          <div className="card-grid-2">
            <article className="portal-panel" style={{ padding: 24 }}>
              <h3>Register a new key</h3>
              <p style={{ fontSize: "0.8rem", lineHeight: 1.6 }}>
                Generate a fresh BabyJubJub keypair bound to <strong>{hospitalId ?? "your identity"}</strong>. Then ask the provider to authorize it — until then, invoices signed by it will fail the circuit's authorization check.
              </p>
              <button className="dark-action" style={{ marginTop: 12 }} disabled={!hospitalId || busy === "key"} onClick={generateKey}>
                {busy === "key" ? <Loader2 className="animate-spin" size={15} /> : <KeyRound size={15} />} Generate &amp; register key
              </button>
            </article>

            <article className="portal-panel dark" style={{ padding: 24 }}>
              <div className="card-kicker"><span>REGISTERED KEYS</span><LockKeyhole size={17} /></div>
              {Object.values(hospitals).length === 0 && <p>No keys registered yet.</p>}
              <div className="row-list" style={{ marginTop: 12 }}>
                {Object.values(hospitals).map((h: any) => (
                  <div className="row-item" key={h.hospital_id}>
                    <div>
                      <strong>{h.hospital_id}{h.hospital_id === hospitalId ? " (you)" : ""}</strong>
                      <small style={{ display: "block", opacity: 0.6 }} className="mono">pk_x {String(h.pk_x).slice(0, 22)}...</small>
                    </div>
                    <BadgeCheck size={15} style={{ opacity: h.hospital_id === hospitalId ? 1 : 0.35 }} />
                  </div>
                ))}
              </div>
              <small style={{ display: "block", marginTop: 12, opacity: 0.55 }}>
                Authorization status is controlled by the provider (registry screen).
              </small>
            </article>
          </div>
        </>
      )}
    </PortalLayout>
  );
}
