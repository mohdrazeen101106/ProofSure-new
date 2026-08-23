import path from "path";
import fs from "fs";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const config = {
  port: Number(process.env.PORT || 3010),
  repoRoot: REPO_ROOT,

  // --- auth ---
  jwtSecret: process.env.JWT_SECRET || "proofsure-dev-jwt-secret-change-me",
  jwtTtl: process.env.JWT_TTL || "12h",
  dataDir: process.env.DATA_DIR || path.join(REPO_ROOT, "backend", ".data"),

  // --- premium prover service (services/premium-prover) ---
  proverUrl: process.env.PROVER_URL || "http://127.0.0.1:8000",
  proverApiKey: process.env.PROVER_API_KEY || "proofsure-dev-prover-key",

  // --- chain ---
  rpcUrl: process.env.RPC_URL || "",
  providerPrivateKey: process.env.PROVIDER_PRIVATE_KEY || "",
  policyAddress: process.env.POLICY_ADDRESS || "",

  // --- claim zk artifacts ---
  claimZkDir:
    process.env.CLAIM_ZK_DIR || path.join(REPO_ROOT, "circuits", "claim-zk"),
};

export function deploymentInfo(): { policy?: string; claimVerifier?: string; groth16Verifier?: string; priceFeed?: string } {
  try {
    const p = path.join(REPO_ROOT, "contracts", "deployment.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}
