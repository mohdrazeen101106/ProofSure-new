import fs from "fs";
import path from "path";
import { config } from "./config";

/** Simple JSON-file persistence. NOT the authoritative ledger — the contract is.
 *  Raw health features and raw invoices are never persisted here. */

interface Db {
  premiumSubmissions: PremiumSubmission[];
  claims: ClaimRecord[];
  policies: PolicyRecord[];
  hospitalKeys: Record<string, { sk_hex: string; pk_x: string; pk_y: string; label?: string }>;
  invoices: InvoiceRecord[];
  events: EventRecord[];
}

export interface PremiumSubmission {
  id: string;
  clientEmail: string;
  clientWallet: string | null;
  predictionInr: number;
  proof: unknown;
  publicInputs: string[][];
  proveSeconds: number;
  status: "pending_verification" | "verified" | "rejected" | "used";
  verifiedAt?: string;
  usedForPolicyId?: number;
  createdAt?: string;
}

export interface PolicyRecord {
  id: number;
  holderWallet: string;
  clientEmail?: string | null;
  premiumWei: string;
  coverageLimitWei: string;
  deductiblePaise: string;
  coPayBps: number;
  durationSeconds: number;
  premiumModelId: string;
  submissionId: string | null;
  txHash: string | null;
  createdAt: string;
}

export interface ClaimRecord {
  id: string;
  policyId: number;
  clientEmail: string;
  invoiceId: number;
  hospitalId: string;
  payoutPaise: string;
  nullifier: string;
  proofBytesHex: string;
  publicInputs: string[];
  invoice: unknown; // signed invoice doc (kept for demo display; contains no raw medical records beyond itemization)
  status: "submitted" | "settled" | "rejected";
  settlementTxHash?: string | null;
  payoutWei?: string | null;
  createdAt: string;
}

export interface EventRecord {
  ts: string;
  type: string;
  data: Record<string, unknown>;
}

export interface InvoiceRecord {
  invoiceId: number;
  policyId: string;
  hospitalId: string;
  clientEmail: string;
  treatmentCode: number;
  totalExpensePaise: string;
  doc: unknown;
  status: "issued" | "claimed";
  createdAt: string;
}

let db: Db;

function load(): Db {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, "state.json");
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    parsed.invoices ??= [];
    return parsed;
  }
  return {
    premiumSubmissions: [],
    claims: [],
    policies: [],
    hospitalKeys: {},
    invoices: [],
    events: [],
  };
}

db = load();

export function save() {
  const file = path.join(config.dataDir, "state.json");
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
}

export const store = {
  get db() {
    return db;
  },

  addEvent(type: string, data: Record<string, unknown> = {}) {
    db.events.unshift({ ts: new Date().toISOString(), type, data });
    db.events = db.events.slice(0, 200);
    save();
  },

  addInvoice(inv: InvoiceRecord) {
    db.invoices.unshift(inv);
    save();
  },
  invoiceById(invoiceId: number) {
    return db.invoices.find((i) => i.invoiceId === invoiceId);
  },
  markInvoiceClaimed(invoiceId: number) {
    const inv = db.invoices.find((i) => i.invoiceId === invoiceId);
    if (inv && inv.status === "issued") {
      inv.status = "claimed";
      save();
    }
  },

  addPremiumSubmission(s: PremiumSubmission) {
    db.premiumSubmissions.unshift(s);
    save();
  },
  getPremiumSubmission(id: string) {
    return db.premiumSubmissions.find((s) => s.id === id);
  },
  updatePremiumSubmission(id: string, patch: Partial<PremiumSubmission>) {
    const s = db.premiumSubmissions.find((x) => x.id === id);
    if (!s) return undefined;
    Object.assign(s, patch);
    save();
    return s;
  },
  premiumSubmissionsFor(email: string) {
    return db.premiumSubmissions.filter((s) => s.clientEmail === email);
  },

  addPolicy(p: PolicyRecord) {
    db.policies.unshift(p);
    save();
  },
  getPolicy(id: number) {
    return db.policies.find((p) => p.id === id);
  },
  listPolicies(holder?: string) {
    return holder ? db.policies.filter((p) => p.holderWallet === holder) : db.policies;
  },
  /** Clients may only see policies bound to their account email or wallet. */
  listPoliciesForClient(email: string, wallet?: string | null) {
    const w = wallet?.toLowerCase();
    return db.policies.filter((p) => p.clientEmail === email || (w && p.holderWallet === w));
  },

  addClaim(c: ClaimRecord) {
    db.claims.unshift(c);
    save();
  },
  getClaim(id: string) {
    return db.claims.find((c) => c.id === id);
  },
  listClaims(email?: string) {
    return email ? db.claims.filter((c) => c.clientEmail === email) : db.claims;
  },

  hospitalKey(hospitalId: string) {
    return db.hospitalKeys[hospitalId];
  },
  setHospitalKey(id: string, v: { sk_hex: string; pk_x: string; pk_y: string; label?: string }) {
    db.hospitalKeys[id] = v;
    save();
  },
  deleteHospitalKey(id: string) {
    delete db.hospitalKeys[id];
    save();
  },
  listHospitalKeys() {
    return db.hospitalKeys;
  },
};
