import { config } from "./config";

/** Client for services/premium-prover (FastAPI + EZKL). */

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${config.proverUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.proverApiKey,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(180_000), // proving can take ~10s+
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body);
    throw new Error(`Prover ${path} failed (${res.status}): ${detail}`);
  }
  return body;
}

export interface ProveResult {
  request_id: string;
  prediction_inr: number;
  proof: unknown;
  public_inputs: string[][];
  prove_seconds: number;
}

export const prover = {
  health: () => call("/health"),
  model: () => call("/model"),
  predict: (raw_row: unknown) => call("/predict", { method: "POST", body: JSON.stringify(raw_row) }),
  prove: (raw_row: unknown) => call("/prove", { method: "POST", body: JSON.stringify(raw_row) }) as Promise<ProveResult>,
  verify: (proof: unknown) =>
    call("/verify", { method: "POST", body: JSON.stringify({ proof }) }) as Promise<{ valid: boolean; verify_seconds: number }>,
};

/** De-scale the last EZKL instance to INR using the public target scaler. */
export function descaleInstanceToInr(publicInputs: string[][], targetScaler: { mean: number; scale: number }) {
  const hex = publicInputs?.[0]?.[publicInputs[0].length - 1];
  if (!hex) return null;
  // little-endian two's complement field element -> signed value
  let h = String(hex).toLowerCase();
  if (h.startsWith("0x")) h = h.slice(2);
  let neg = false;
  if (h.length % 2) h = "0" + h;
  const buf = Buffer.from(h, "hex").reverse(); // big-endian
  const bn = BigInt("0x" + buf.toString("hex"));
  // BN254 scalar field modulus for sign interpretation
  const r = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
  let v = bn;
  if (bn > r / 2n) {
    v = bn - r;
    neg = true;
  }
  // scaled value is fixed point with scale 2^13
  const SCALE = 2 ** 13;
  const scaled = Number(v < 0n ? -(Number(-v) / SCALE) : Number(v) / SCALE);
  void neg;
  return scaled * targetScaler.scale + targetScaler.mean;
}
