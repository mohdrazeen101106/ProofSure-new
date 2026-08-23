#!/usr/bin/env bash
# Full happy-path claim flow: keys -> signed invoice -> witness -> proof -> verify.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> [1/4] Hospital key generation + registry"
node scripts/hospital_keys.js

echo "==> [2/4] Sign invoice + build circuit input"
node scripts/make_invoice_and_input.js

echo "==> [3/4] Generate witness + groth16 proof"
npx snarkjs wtns calculate build/claim_js/claim.wasm test_vectors/claim_input.json build/witness.wtns
npx snarkjs groth16 prove build/claim_final.zkey build/witness.wtns \
  test_vectors/claim_proof.json test_vectors/claim_public.json

echo "==> [4/4] Verify proof locally"
npx snarkjs groth16 verify build/verification_key.json \
  test_vectors/claim_public.json test_vectors/claim_proof.json

echo ""
echo "Public signals (contract ABI order):"
cat test_vectors/claim_public.json
