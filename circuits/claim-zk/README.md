# claim-zk — Ordinary ZK Claim Circuit (Teammate 1, claims side)

Privacy-preserving insurance claim settlement. A client proves a hospital-issued,
signed invoice is covered and the payout math is correct — without revealing
medical/financial details.

See **`docs/zk_interface.md`** for the full integration handover (public-input ABI,
encodings, contract snippets, test evidence).

## Layout

```
circuits/claim.circom      the circuit (7 conditions: sig, coverage, sum,
                           deductible/co-pay settlement, coverage bound, nullifier)
circuits/utils.circom      Sum helper
scripts/setup.sh           compile + pot14 + groth16 zkey setup (run once)
scripts/hospital_keys.js   generate hospital EdDSA keys + registry JSON
scripts/make_invoice_and_input.js  sign invoice → witness input + public signals
scripts/run_claim_flow.sh  happy path end-to-end (prove + verify)
scripts/invalid_cases.js   5 negative tests — every one must be rejected
scripts/convert_payout_to_eth.js  paise→wei preview (mirrors on-chain Chainlink math)
scripts/export_claim_proof.js     proof -> IVerifier bytes + HealthInsurancePolicy calldata
scripts/export_hospital_auth.js   keccak key for authorizeHospitalByKey
build/ClaimProofVerifier.sol       snarkjs Solidity verifier (standalone, 5 inputs)
contract/ClaimVerifier.sol         IVerifier wrapper for HealthInsurancePolicy (Groth16) — synced with ProofSure-main/contracts/
contract/HealthInsurancePolicy.sol unified policy (paise→wei via Chainlink AFTER verify) — synced with ProofSure-main/contracts/
contract/MockAggregatorV3.sol      mock INR/ETH feed (300k*1e8, 8 dec)
contract/MockVerifier.sol          MockVerifier for unit tests (alwaysValid toggle)
test_vectors/              signed invoice, proof, public inputs, calldata (incl. claim_proof_bytes.hex, claim_calldata.json)
docs/zk_interface.md       ← hand this to the smart-contract teammate (now covers HealthInsurancePolicy integration)
```

## Quick start

```bash
npm install
bash scripts/setup.sh            # ~2 min, once
bash scripts/run_claim_flow.sh   # ends with "snarkjs groth16 verify ... OK!"
node scripts/invalid_cases.js    # ends with "All negative cases behaved as expected."
```

## Settlement formula (frozen)

```
payout_paise = floor((total_expense − deductible) × (10000 − copay_bps) / 10000)
```
Demo values: ₹87,500 bill, ₹20,000 deductible, 10% co-pay ⇒ **₹60,750** payout.
