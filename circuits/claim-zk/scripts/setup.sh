#!/usr/bin/env bash
# Compile circuit + powersoftau + groth16 setup. Run once (~1-2 min).
set -euo pipefail
cd "$(dirname "$0")/.."

CIRCOM=${CIRCOM:-$HOME/bin/circom}
mkdir -p build

echo "==> Compiling claim.circom"
"$CIRCOM" circuits/claim.circom --r1cs --wasm --sym -o build -l node_modules

echo "==> Powers of tau (pot14)"
npx snarkjs powersoftau new bn128 14 build/pot14_0000.ptau
npx snarkjs powersoftau contribute build/pot14_0000.ptau build/pot14_0001.ptau \
  --name="first" -e="hackathon entropy $(date +%s)"
npx snarkjs powersoftau prepare phase2 build/pot14_0001.ptau build/pot14_final.ptau

echo "==> Groth16 setup"
npx snarkjs groth16 setup build/claim.r1cs build/pot14_final.ptau build/claim_0000.zkey
npx snarkjs zkey contribute build/claim_0000.zkey build/claim_final.zkey \
  --name="1st Contributor" -e="more entropy $(date +%s)"
npx snarkjs zkey export verificationkey build/claim_final.zkey build/verification_key.json

echo "==> Circuit stats"
npx snarkjs r1cs info build/claim.r1cs

echo "Done. Artifacts in build/: claim.r1cs, claim_js/, claim_final.zkey, verification_key.json"
