/**
 * ProofSure Hospital Portal — routed screens: Invoice desk and Key management.
 * Creates itemized invoices and signs them with the hospital's
 * EdDSA-Poseidon (BabyJubJub) key held by the backend for this role.
 */
import {
  ArrowUpRight, BadgeCheck, Copy, FileSignature, KeyRound, Loader2, LockKeyhole, Stethoscope,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import PortalLayout, { SectionHead } from "@/components/PortalLayout";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const HISTORY_KEY = "proofsure-hospital-invoices";
const SECTIONS = ["invoice", "keys"] as const;
type Section = (typeof SECTIONS)[number];

export default function HospitalPortal() {
  const { session } = useAuth();
  const [location] = useLocation();
  const raw = location.split("/")[2] ?? "";
  const section: Section = (SECTIONS as readonly string[]).includes(raw) ? (raw as Section) : "invoice";

  const [hospitalId, setHospitalId] = useState(session?.hospitalId ?? "");
  const [policyId, setPolicyId] = useState("");
  const [treatmentCode, setTreatmentCode] = useState("1");
  const [admissionOffsetDays, setAdmissionOffsetDays] = useState(2);
  const [expenses, setExpenses] = useState("35000, 25000, 12000, 9000, 6500");
  const [signedInvoice, setSignedInvoice] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    api.hospitals().then(setHospitals).catch(() => {});
    if (!hospitalId && !session?.hospitalId) setHospitalId("HOSP001");
    try { setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]")); } catch { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expensePaise = () =>
    expenses.split(/[,\s]+/).filter(Boolean).map((r) => String(Math.round(Number(r) * 100)));

  const sign = async () => {
    if (!hospitalId || !policyId) return toast.error("Hospital ID and policy ID are required.");
    if (!expensePaise().length) return toast.error("Add at least one expense line.");
    setBusy("sign");
    try {
      const invoice = await api.signInvoice({
        hospital_id: hospitalId,
        policy_id: policyId,
        treatment_code: Number(treatmentCode),
        admission_date: Math.floor(Date.now() / 1000) - 86400 * admissionOffsetDays,
        expenses_paise: expensePaise(),
      });
      setSignedInvoice(invoice);
      const next = [{ ...invoice }, ...history].slice(0, 20);
      setHistory(next);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      toast.success(`Invoice #${invoice.invoice_id} signed`, {
        description: `Total Rs ${(Number(invoice.total_expense_paise) / 100).toLocaleString("en-IN")} - EdDSA-Poseidon verified server-side.`,
      });
    } catch (e) {
      toast.error("Signing failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const copyInvoice = async (inv: any) => {
    await navigator.clipboard.writeText(JSON.stringify(inv, null, 2));
    toast.success("Signed invoice copied", { description: "The client pastes this into their claims screen." });
  };

  const generateKey = async () => {
    if (!hospitalId) return toast.error("Enter your hospital ID first.");
    setBusy("key");
    try {
      await api.generateHospitalKey(hospitalId);
      toast.success(`New key registered for ${hospitalId}`, { description: "Ask the provider to authorize it on-chain before issuing invoices." });
      api.hospitals().then(setHospitals).catch(() => {});
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
          <p>Invoices are signed with your hospital's registered key. Fake keys fail the ZK authorization check.</p>
        </div>
      }
    >
      {section === "invoice" && (
        <>
          <SectionHead kicker="SIGNED INVOICES" title={<>Issue a <em style={{ fontStyle: "italic" }}>verifiable invoice.</em></>} sub="Each invoice is EdDSA-Poseidon signed over its canonical fields. The claim circuit proves the signature against your registered public key without exposing the bill." />
          <div className="card-grid-2">
            <article className="portal-panel dark proof-card" style={{ padding: 24 }}>
              <div className="card-kicker"><span>NEW INVOICE</span><FileSignature size={17} /></div>
              <div className="flow-grid" style={{ marginTop: 14 }}>
                <div className="flow-field"><label>Hospital ID</label>
                  <input value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} placeholder="HOSP001" />
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
              <button className="dark-action" style={{ marginTop: 14 }} disabled={busy === "sign"} onClick={sign}>
                {busy === "sign" ? <Loader2 className="animate-spin" size={15} /> : <FileSignature size={15} />} Sign invoice
              </button>

              {signedInvoice && (
                <div className="flow-panel">
                  <h4 style={{ margin: 0, fontSize: 12 }}>Signed bundle - invoice #{signedInvoice.invoice_id}</h4>
                  <small>Total INR {(Number(signedInvoice.total_expense_paise) / 100).toLocaleString("en-IN")} - treatment code {signedInvoice.treatment_code}</small>
                  <button className="outline-action" onClick={() => copyInvoice(signedInvoice)}>Copy JSON for client <ArrowUpRight size={14} /></button>
                  <small style={{ opacity: 0.6 }}>Send this to the claimant. They combine it with private policy data inside the ZK prover.</small>
                </div>
              )}
            </article>

            <article className="portal-panel" style={{ padding: 24 }}>
              <h3>Issued invoices (this browser)</h3>
              {history.length === 0 && <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>Nothing issued yet.</p>}
              <div className="row-list" style={{ maxHeight: 380 }}>
                {history.map((inv) => (
                  <div className="row-item" key={inv.invoice_id}>
                    <div>
                      <strong>#{inv.invoice_id}</strong>
                      <small style={{ display: "block", opacity: 0.65 }}>
                        policy #{inv.policy_id} - INR {(Number(inv.total_expense_paise) / 100).toLocaleString("en-IN")}
                      </small>
                    </div>
                    <button className="text-action" onClick={() => copyInvoice(inv)} aria-label={`Copy invoice ${inv.invoice_id}`}>
                      Copy <Copy size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </>
      )}

      {section === "keys" && (
        <>
          <SectionHead kicker="KEY MANAGEMENT" title="Your signing keys" sub="The private key never leaves the ProofSure backend for this role. Only provider-authorized public keys pass the on-chain hospital registry." />
          <div className="card-grid-2">
            <article className="portal-panel" style={{ padding: 24 }}>
              <h3>Register a new key</h3>
              <p style={{ fontSize: "0.8rem", lineHeight: 1.6 }}>
                Generate a fresh BabyJubJub keypair bound to your hospital ID. Then ask the provider to authorize it - until then, invoices signed by it will fail the circuit's authorization check.
              </p>
              <div className="flow-field" style={{ marginTop: 10 }}>
                <label>Hospital ID</label>
                <input value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} placeholder="HOSP001" />
              </div>
              <button className="dark-action" style={{ marginTop: 12 }} disabled={busy === "key"} onClick={generateKey}>
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
                      <strong>{h.hospital_id}</strong>
                      <small style={{ display: "block", opacity: 0.6 }} className="mono">pk_x {String(h.pk_x).slice(0, 22)}...</small>
                    </div>
                    <BadgeCheck size={15} style={{ opacity: 0.6 }} />
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
