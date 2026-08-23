#!/usr/bin/env bash
# Start the full ProofSure demo stack locally (simulation chain mode).
#
#   1. anvil                       (optional — enables LIVE on-chain mode)
#   2. premium prover  :8000       FastAPI + EZKL
#   3. backend         :3010       Express orchestration API (JWT auth)
#   4. frontend        :3000       Vite dev server (proxies /api -> :3010)
#
# For LIVE on-chain mode: start anvil first, then
#   cd contracts && forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
# and export RPC_URL / PROVIDER_PRIVATE_KEY / POLICY_ADDRESS before starting the backend.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> [1/4] premium prover (:8000)"
cd "$ROOT/services/premium-prover"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install -q -r requirements.txt 2>/dev/null || true
(setsid ./.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000 > /tmp/proofsure-prover.log 2>&1 < /dev/null &)

echo "==> [2/4] claim circuits sanity (artifacts present)"
[ -f "$ROOT/circuits/claim-zk/build/claim_final.zkey" ] || { echo "claim-zk build artifacts missing — run bash scripts/setup.sh in circuits/claim-zk"; exit 1; }

echo "==> [3/4] backend (:3010)"
cd "$ROOT/backend"
[ -d node_modules ] || npm install --silent
if [ -f "$ROOT/contracts/deployment.json" ]; then
  export POLICY_ADDRESS=$(python3 -c "import json;print(json.load(open('$ROOT/contracts/deployment.json'))['policy'])")
fi
(setsid npx tsx src/index.ts > /tmp/proofsure-backend.log 2>&1 < /dev/null &)

echo "==> [4/4] frontend (:3000)"
cd "$ROOT/frontend"
[ -d node_modules ] || pnpm install --silent
exec npx vite --port 3000
