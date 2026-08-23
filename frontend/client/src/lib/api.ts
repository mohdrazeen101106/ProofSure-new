/** Typed API client for the ProofSure orchestration backend (JWT bearer). */

const BASE = "/api";
const TOKEN_KEY = "proofsure-token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface User {
  email: string;
  name: string;
  role: "client" | "hospital" | "provider";
  wallet?: string | null;
  hospitalId?: string | null;
}

export const api = {
  register: (b: { email: string; password: string; name: string; role: string }) =>
    call<{ token: string; user: User }>("/auth/register", { method: "POST", body: JSON.stringify(b) }),
  login: (email: string, password: string) =>
    call<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => call<{ user: User }>("/auth/me"),
  setWallet: (wallet: string) => call<{ user: User }>("/auth/me/wallet", { method: "PATCH", body: JSON.stringify({ wallet }) }),

  config: () => call<any>("/config"),
  events: () => call<any[]>("/events"),

  premiumProve: (raw_row: Record<string, unknown>) =>
    call<{ id: string; predictionInr: number; proveSeconds: number }>("/premium/prove", { method: "POST", body: JSON.stringify({ raw_row }) }),
  mySubmissions: () => call<any[]>("/premium/submissions/mine"),
  verifyPremium: (id: string, claimedPremiumInr: number) =>
    call<{ ok: boolean; checks: any; descaledInr: number }>(`/provider/premium/${id}/verify`, { method: "POST", body: JSON.stringify({ claimedPremiumInr }) }),
  providerQueue: () => call<any[]>("/provider/premium/queue"),

  createPolicy: (b: Record<string, unknown>) => call<{ policyId: number; txHash: string }>("/provider/policies", { method: "POST", body: JSON.stringify(b) }),
  policies: () => call<any[]>("/policies"),
  activatePolicy: (id: number) => call<{ activated: boolean; txHash?: string }>(`/provider/policies/${id}/activate`, { method: "POST" }),

  hospitals: () => call<any[]>("/hospitals"),
  generateHospitalKey: (hospitalId: string) =>
    call<{ pk_x: string; pk_y: string; sk_hex: string }>("/hospital/keys/generate", { method: "POST", body: JSON.stringify({ hospitalId }) }),
  authorizeHospitalKey: (pk_x: string, pk_y: string) =>
    call<{ txHash: string }>("/provider/hospitals/authorize-key", { method: "POST", body: JSON.stringify({ pk_x, pk_y }) }),

  signInvoice: (b: Record<string, unknown>) =>
    call<Record<string, any>>("/hospital/invoices/sign", { method: "POST", body: JSON.stringify(b) }),

  claimProve: (b: Record<string, unknown>) =>
    call<{ proofBytesHex: string; publicInputs: string[]; payoutPaise: string; claimNullifier: string }>("/claims/prove", { method: "POST", body: JSON.stringify(b) }),
  submitClaim: (b: Record<string, unknown>) => call<any>("/claims", { method: "POST", body: JSON.stringify(b) }),
  claims: () => call<any[]>("/claims"),
  settleClaim: (id: string) =>
    call<{ ok: boolean; txHash: string; payoutWei: string; payoutPaise: string }>(`/provider/claims/${id}/settle`, { method: "POST" }),

  reserve: () => call<{ eth: string; note?: string }>("/reserve"),
  fundReserve: (eth: string) => call<{ txHash: string }>("/provider/reserve/fund", { method: "POST", body: JSON.stringify({ eth }) }),
};
