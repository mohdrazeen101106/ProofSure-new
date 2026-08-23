# PREMIUM_ZK_INTERFACE — ZKML premium proof (ZK_proof_premium)

> Frozen encoding contract between the client frontend, the orchestration backend,
> the EZKL prover service (`services/premium-prover`), and `HealthInsurancePolicy`.

## 1. Statement

```text
Using model M (sha256-bound),
with my private health inputs X (16 raw fields -> 34 encoded features),
the resulting standardized premium prediction is P.
```

- Framework: **EZKL 23.0.5**, proving system **KZG** (local, non-ceremony SRS — swap in a
  ceremony SRS before any production use).
- Model: 3-layer MLP, ONNX `network.onnx`, input `[1,34]` → `34→16→8→1`.
- Visibility: inputs **Public**, params **Private**, output **Public**.
- Fixed-point scale: **2^13** for both input and output.

## 2. Model identity (premiumModelId)

```text
onnx_sha256            = sha256(network.onnx)          # canonical graph
premiumModelId (bytes32 on-chain) = first 32 bytes of onnx_sha256
```

Current frozen value:

```text
onnx_sha256        = 61c1b222f5ac930a6aea9c7bd1c2e5fa0801379ddf37b0835c10b700f587f8f5
premiumModelId     = 0x61c1b222f5ac930a6aea9c7bd1c2e5fa0801379ddf37b0835c10b700f587f8f5
```

Fetch live via prover service `GET /model`. The provider backend MUST check this hash
before creating a policy ("Premium proof does not match the registered model").

## 3. Raw row schema (16 fields)

| field | type | constraint |
|---|---|---|
| gender | enum | F, M |
| age | int | 0 < x < 130 |
| marital_status | enum | Divorced, Married, Single, Widowed |
| occupation_type | enum | Business, Retired, Salaried, Self-employed, Student, Unemployed |
| annual_income_inr | float | >= 0 |
| bmi | float | 0 < x < 100 |
| tobacco_usage | enum | both, chewing, none, smoking |
| alcohol_units_per_week | float | >= 0 |
| physical_activity_level | enum | low, moderate, high |
| diet_type | enum | eggetarian, non-veg, veg, vegan |
| has_diabetes | int | 0/1 |
| has_hypertension | int | 0/1 |
| family_history_cardiac | int | 0/1 |
| stress_level_score | float | >= 0 |
| policy_type | enum | family_floater, individual, senior_citizen |
| sum_insured | float | >= 0 |

(Exact category sets are derived from the fitted encoder at runtime — see `/prove` 422s.)

## 4. Proof flow

```text
CLIENT BROWSER                          PROVER SERVICE (:8000)              BACKEND (:3001)
health inputs
  |
  v                                     owns key.pk (~130MB)
local ONNX inference (onnxruntime-web)      |
  |                                         v
premium displayed  ---POST /prove---------> re-derive features from RAW row
  |  (raw row leaves browser only here)      gen_witness -> prove (~4-9s)
  |                                         |
  |<-- {proof, public_inputs, pred_inr} ----+
  |
  +--- POST /api/premium/prove -------------------------------------------------> store submission
                                            POST /verify (X-API-Key) -> valid
```

- The browser NEVER receives `key.pk`; the prover never trusts a client feature vector.
- Prover endpoints `/prove` and `/verify` require header `X-API-Key`
  (env `PROVER_API_KEY`, default `proofsure-dev-prover-key`).

## 5. Public inputs

EZKL instances: **35 field elements** = 34 encoded features (StandardScaler +
binary passthrough + one-hot, order per `artifacts/schema.json`) + 1 output
(scaled prediction). Encoding: little-endian two's-complement hex mod BN254 —
handled entirely by ezkl; downstream code only consumes `instances[-1]`.

### De-scaling to INR

```text
prediction_inr = felt_to_float(instances[-1], scale=13)
                 then inverse_transform with target scaler:
                 INR = scaled * 67670.9748983689 + 121759.2603125
```

Provider-side acceptance tolerance: **±1 INR** vs the claimed premium.

## 6. On-chain usage snippet

Premium proofs are verified OFF-CHAIN by the provider (KZG verification is not
practical on-chain for this demo); the chain binds the model version:

```solidity
// HealthInsurancePolicy.sol
policy.createPolicy{...}(holder, premiumWei, coverageLimitWei,
                         deductiblePaise, coPayBps, durationSeconds,
                         bytes32 premiumModelId); // = 0x61c1b222…f587f8f5
```

The provider creates a policy ONLY after:
1. `POST /verify` returns `valid: true`,
2. de-scaled `instances[-1]` matches the claimed premium within ±1 INR,
3. proof was generated against the registered model hash.

## 7. Known-good artifacts

- `interfaces/samples/sample-premium-input.json` — valid raw row
- `interfaces/samples/sample-premium-proof.json` — real proof (verified true, ~Rs 99,513)
- Reproduce: see README §Run the services.

## 8. Open decisions / caveats

- [x] Model hash convention — sha256(network.onnx), first 32 bytes on-chain.
- [ ] Replace local non-ceremony `kzg.srs` before mainnet/production.
- [x] Paise scaling: circuit/premium side works in INR floats; CLAIM side is
      integer paise — conversion happens once, at claim settlement (see zk-interface.md).
- [x] Premium is stored/paid in wei; claim payouts converted paise→wei via oracle.
