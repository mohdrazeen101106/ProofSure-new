# ZK INTERFACE — CLAIM PROOF HANDOVER (to Integration)

> **Audience:** smart-contract / integration member.
> **Status:** ✅ COMPLETE & TESTED. Valid proof verified locally; 5 invalid cases rejected for the correct reasons. Integrated with `contract/HealthInsurancePolicy.sol` (unified with ProofSure-main) + Chainlink ETH conversion AFTER inference.
> **Stack:** Circom 2.1.6 · snarkjs 0.7.6 (Groth16, BN254) · circomlib Poseidon + EdDSA (BabyJubJub) · OpenZeppelin Ownable/ReentrancyGuard · Chainlink AggregatorV3

---

## 1. What the claim side is

An **ordinary ZK circuit** (no ML). One Groth16 proof per claim proves all seven conditions:

| # | Condition | Enforced at |
|---|-----------|-------------|
| 1 | Hospital EdDSA-Poseidon signature over invoice is valid | `claim.circom` §1 |
| 2 | `treatment_code ∈ {1,2,3,4}` (HOSPITALIZATION, SURGERY, EMERGENCY, ICU) | §2 |
| 3 | `sum(itemized_expenses) == total_expense` | §3 |
| 4 | `payout = floor((total − deductible) × (1 − copay))` | §4 |
| 5 | `coverage_used_before + payout ≤ coverage_limit` | §5 |
| 6 | `claim_nullifier = Poseidon(policy_id, invoice_id, secret)` | §6 |

The verifier/contract never sees raw line items, patient data, or coverage state.

---

## 2. PUBLIC INPUTS — exact ABI order (FROZEN — 5 elements)

`test_vectors/claim_public.json` is a JSON array; index order below is final. **Do not reorder.** This matches `circuits/claim.circom:159` `main {public [policy_id, hospital_pk_x, hospital_pk_y, claim_nullifier, payout_amount]}`.

```
index  signal           meaning
-----  ---------------  ------------------------------------------------------
[0]    policy_id        uint256, decimal string in JSON
[1]    hospital_pk_x    uint256 — BabyJubJub pubkey X of signing hospital
[2]    hospital_pk_y    uint256 — BabyJubJub pubkey Y
[3]    claim_nullifier  uint256 — replay marker, contract must mark as used (bytes32 on-chain)
[4]    payout_amount    uint256 — settlement payout in PAISE (paise→wei converted on-chain AFTER verification)
```

### Known-good public signals (`test_vectors/claim_public.json`)
```json
[
  "555000111",            // policy_id
  "3001663862947518470137736212854659435214873785439783602437506608489804173299",
  "20563630333446074709065402395611689329132456103612690714253596740614394103611",
  "18101872441927683042421352942116788789016773113871323921816041718670789495851",
  "6075000"               // = Rs 60,750 (paise, converted to wei on-chain)
]
```
Demo math: ₹87,500 bill − ₹20,000 deductible = ₹67,500 → ×90% (10% co-pay) = **₹60,750** → at 300k INR/ETH = **0.2025 ETH**.

**Legacy 4-input test compatibility:** `ProofSure-main/test/contract/HealthInsurancePolicy.ts` uses `[policyId, nullifier, payoutWei, hospitalAddress]` (wei + address). `contract/HealthInsurancePolicy.sol` (synced with `ProofSure-main/contracts/HealthInsurancePolicy.sol`) supports BOTH: length 5 = ZK paise path (BabyJubJub + Chainlink), length 4 = legacy wei path (address + no conversion). New integrations MUST use length 5.

---

## 3. Encoding & scaling rules (FROZEN)

| Rule | Value |
|------|-------|
| Curve / proving system | BN254, Groth16 |
| All money amounts (circuit) | **integer paise** (1 INR = 100 paise). ₹87,500 → `8750000` |
| All money amounts (on-chain policy) | `premium`/`coverageLimit`/`coverageUsed` in **wei** (ETH); payout proven in paise then converted to wei |
| Co-pay | basis points of 10000. 10% copay → multiplier `(10000 − 1000)` |
| Deductible | private input, paise |
| Dates | unix seconds, uint32 |
| `treatment_code` | enum: `1`=HOSPITALIZATION `2`=SURGERY `3`=EMERGENCY `4`=ICU |
| Hash function | Poseidon (circomlib, BN254) everywhere — invoice hash AND nullifier |
| Signature | EdDSA over BabyJubJub ("EdDSA-Poseidon"), same keys as registry |
| Range safety | all monetary inputs constrained `< 2^56`; no mod-p wraparound tricks possible |
| Invoice message | `M = Poseidon(invoice_id, policy_id, patient_commitment, treatment_code, admission_date, discharge_date, total_expense)` |
| Nullifier | `Poseidon(policy_id, invoice_id, nullifier_secret)` — secret stays private, stored as `bytes32(publicInputs[3])` on-chain |

**Invoice fields signed by hospital (canonical order):**
`invoice_id, policy_id, patient_commitment, treatment_code, admission_date, discharge_date, total_expense`
(`hospital_id` is implicitly bound by which registry pubkey verifies.)

### Signed invoice document format (`signed_hospital_invoice_v1`)
See `test_vectors/invoice_signed.json`. Fields: `hospital_id, invoice_id, policy_id,
patient_commitment, treatment_code, admission_date, discharge_date,
expenses_paise[≤8], total_expense_paise, signature_r_x, signature_r_y, signature_s`.
Sig components are hex strings of 32-byte little-endian values; `signature_s` decimal.

### Hospital registry format (`hospital_registry_v1`)
See `test_vectors/hospital_registry.json`. Contract now has dual registry:
- **ZK path:** `authorizeHospitalByKey(pk_x, pk_y)` — stores `keccak256(abi.encode(pk_x,pk_y))` in `authorizedHospitalsByKey`; proven via public inputs [1],[2].
- **Legacy path:** `addHospital(address)` — for `ProofSure-main` tests. New deployments should use the key-based registry.

---

## 4. Proof artifacts & on-chain verification — UNIFIED WITH `contract`

### 4.0 What changed (integration with `contract`)

- **`contract/` is now the canonical HealthInsurancePolicy source** — `claim-zk/contract/HealthInsurancePolicy.sol` synced with `ProofSure-main/contracts/HealthInsurancePolicy.sol`.
- **New verifier:** `contract/ClaimVerifier.sol` wraps the snarkjs `Groth16Verifier` (from `build/ClaimProofVerifier.sol`) and implements `IVerifier.verifyClaimProof(bytes proof, uint256[] pubSignals)`. Proof bytes are `abi.encode(uint[2] a, uint[2][2] b, uint[2] c)` — produced by `node scripts/export_claim_proof.js`.
- **Chainlink after inference:** `contract/HealthInsurancePolicy.sol` (synced with `ProofSure-main/contracts/HealthInsurancePolicy.sol`) now takes `AggregatorV3Interface priceFeed` (INR per ETH, 8 dec) and converts `payoutPaise [4]` → `wei` **after** `verifyClaimProof` via `paiseToWei()` (`wei = paise *1e18 *10**dec / (100*price)`). Legacy 4-input path skips conversion.
- **Ignition:** `ignition/modules/ClaimPolicy.ts` (claim-zk) and `ProofSure-main/ignition/modules/HealthInsurancePolicy.ts` now deploy `MockAggregatorV3(300000*1e8,8)` + `ClaimVerifier` + `HealthInsurancePolicy(verifier, feed)`.
- **Scripts:** `scripts/export_claim_proof.js` (proof bytes + calldata for `submitClaimProof`), `scripts/export_hospital_auth.js`, `scripts/convert_payout_to_eth.js` (mirrors on-chain math).
- **Legacy wrapper still exists:** `contract/ClaimPayoutChainlink.sol` (simple paise→wei without policy management) remains for claim-only demos; unified path is `HealthInsurancePolicy`.

### 4.1 Artifacts

- Verifier (standalone): **`build/ClaimProofVerifier.sol`** (snarkjs, `verifyProof(a,b,c,pubSignals)` with 5 signals).
- **Unified verifier:** **`contract/ClaimVerifier.sol`** (synced with **`ProofSure-main/contracts/ClaimVerifier.sol`**) — same VK, implements `IVerifier`.
- **Policy (unified):** `contract/HealthInsurancePolicy.sol` (synced with `ProofSure-main/contracts/HealthInsurancePolicy.sol`) — `Ownable` + `ReentrancyGuard`, dual hospital registry, Chainlink conversion, support for both 5- and 4-input pubSignals.
- Mock feed: `contract/MockAggregatorV3.sol` (synced with `ProofSure-main/contracts/MockAggregatorV3.sol`, defaults to 300k INR/ETH, 8 dec).
- Proof JSON: `test_vectors/claim_proof.json` (`pi_a`, `pi_b`, `pi_c`, protocol `groth16`).
- Public inputs: `test_vectors/claim_public.json` (5-element, paise).
- Calldata export: `test_vectors/claim_calldata.json` + `claim_proof_bytes.hex` (after running export script).
- Verification key: `build/verification_key.json`.
- Off-chain preview: `node scripts/convert_payout_to_eth.js --paise 6075000` or `--fetch`.

### 4.2 Chainlink settlement flow — AFTER inference/proving (the ETH conversion you asked for)

```
Client: local circuit inference -> proof with payoutPaise (e.g. 6075000)
        |
        v
On-chain: HealthInsurancePolicy.submitClaimProof(proofBytes, pubSignals[5])
        1. decode proofBytes -> (a,b,c); verifyClaimProof(proof, pubSignals) // Groth16, ClaimVerifier
        2. checks: !usedNullifiers[bytes32(pub[3])], authorizedHospitalsByKey[keccak(pk_x,pk_y)], coverageUsed+weiPayout <= coverageLimit, policy active & not expired, sufficient reserve
        3. paise -> wei via Chainlink (only for 5-input ZK path):
             wei = paise * 1e18 * 10**decimals / (100 * price)
           where price = AggregatorV3Interface.latestRoundData() // INR per ETH, 8 dec
           e.g. 6075000 paise (=₹60,750) / 300000 INR/ETH = 0.2025 ETH = 202500000000000000 wei
           Dual-feed alternative: paiseToWeiDualFeed(ethUsdFeed, usdInrFeed) — see ClaimPayoutChainlink
        4. mark nullifier, update coverageUsed (wei), transfer wei to policy.holder, emit ClaimPaid + ClaimPaidDetailed
```

**Deployment (single-feed, recommended for demo):**

```solidity
// 1. deploy
MockAggregatorV3 feed = new MockAggregatorV3(300000 * 1e8, 8); // INR per ETH
ClaimVerifier verifier = new ClaimVerifier(); // contains claim.circom VK
HealthInsurancePolicy policy = new HealthInsurancePolicy(address(verifier), address(feed));

// 2. authorize hospital (BabyJubJub key from hospital_registry.json / claim_public.json)
policy.authorizeHospitalByKey(
  6581781790582791676866385184842367664603665639125448719263921209915667713006,
  19099797786266514037329521559976600218901144494217183839938780509263153667721
);

// 3. create + fund + activate policy (coverageLimit in wei)
policy.createPolicy(holder, 0.01 ether, 1 ether, 2000000, 1000, 30 days, bytes32("premium-model-v1"));
policy.fundReserve{value: 2 ether}();
policy.activatePolicy(0);

// 4. submit ZK claim (proofBytes from export script, pubSignals = 5-element)
policy.submitClaimProof(proofBytes, publicInputs); // publicInputs[4]=6075000 paise -> pays 0.2025 ETH

// Preview without settling:
// (uint256 wei, uint256 price, uint8 dec) = policy.previewPayoutInEth(6075000);
// (uint256 wei, uint256 price, uint8 dec) = policy.paiseToWei(6075000) via view
```

**Using a real Chainlink feed:** deploy `HealthInsurancePolicy` with the feed address (Sepolia ETH/USD `0x694AA1769357215DE4FAC081bf1f309aDC325306` plus USD/INR, or custom INR/ETH). Set `maxStaleness` (default 3600s).

**Exporting proof bytes for IVerifier (new):**

```bash
bash scripts/run_claim_flow.sh          # prove
node scripts/export_claim_proof.js      # -> test_vectors/claim_proof_bytes.hex + claim_calldata.json
# then in hardhat/cast:
# proofBytes = 0x...
# pubSignals = [555000111, 6581..., 19099..., 10523..., 6075000]
# policy.submitClaimProof(proofBytes, pubSignals)
```

Legacy 4-input call (for ProofSure tests without ZK):

```solidity
policy.addHospital(0xHospitalAddr);
policy.submitClaimProof(hex"", [policyId, uint256(keccak256("invoice-1")), 0.1 ether, uint256(uint160(hospital))]);
```

### Negative test artifact
`test_vectors/invalid_proof.json` + `invalid_public_payout.json` — valid witness, but payout bumped by Rs 10,000 in public inputs. **Must** return `false` from `verifyClaimProof` / `verifyProof`.

---

## 5. Reproduce everything (commands)

```bash
cd claim-zk
npm install                      # snarkjs, circomlib(js), ffjavascript
bash scripts/setup.sh            # compile + powersoftau(pot14) + groth16 setup (~2 min)
bash scripts/run_claim_flow.sh   # keys → sign → prove → verify (happy path)
node scripts/export_claim_proof.js        # proof bytes + calldata for HealthInsurancePolicy
node scripts/export_hospital_auth.js      # keccak key + authorize call
node scripts/convert_payout_to_eth.js --paise 6075000  # preview 0.2025 ETH at mock price
node scripts/invalid_cases.js    # 5 rejection tests, prints constraint that fired

# Hardhat (unified policy + real verifier + mock feed):
cd ../ProofSure-main
npm install
npx hardhat test test/contract/HealthInsurancePolicy.ts            # legacy 4-input tests (MockVerifier, address registry)
# with real ClaimVerifier + 5-input ZK proof:
# npx hardhat ignition deploy ignition/modules/HealthInsurancePolicy.ts --network hardhat
```

Expected outputs: `snarkjs groth16 verify … OK!` for the happy path, and
`All negative cases behaved as expected.` with per-case reasons:

| Case | Rejects via |
|------|-------------|
| A fake/unauthorized hospital | EdDSA eq-check (`EdDSAPoseidonVerifier`) |
| B tampered public payout | `verifyProof == false` (also `verifyClaimProof` false) |
| C uncovered code, properly re-signed | allowlist constraint `covered === 1` |
| D inflated line item | expense-sum constraint |
| E over-limit claim | coverage-bound `LessThan` |

Circuit stats (build/claim.r1cs): **10,787 constraints**, 23 private / 5 public inputs.
Proof gen ≈ seconds on a laptop; pot14 setup is done once.

---

## 6. Open items / joint decisions needed from you

1. **Nullifier storage:** `HealthInsurancePolicy.usedNullifiers[bytes32(pub[3])]` — done (was `ClaimPayoutChainlink.usedNullifiers`).
2. **Hospital registry:** dual — `authorizedHospitalsByKey[keccak(pk_x,pk_y)]` for ZK path + `authorizedHospitals[address]` for legacy. Use `authorizeHospitalByKey()` for claim-zk.
3. **Payout currency — RESOLVED:** Circuit proves paise (integer, no oracle in ZK). `HealthInsurancePolicy` (+ `ClaimPayoutChainlink`) converts **after** verification to ETH/wei via Chainlink at settlement. Preview with `node scripts/convert_payout_to_eth.js`. For ETH/USD-only networks use `paiseToWeiDualFeed()`. Coverage checks after conversion are in wei.
4. **Verifier wiring — RESOLVED:** `contract/ClaimVerifier.sol` implements `IVerifier` for the real circuit; `MockVerifier` stays for unit tests. `HealthInsurancePolicy` now stores `IVerifier` + `priceFeed`.
5. **Coverage state across claims:** current circuit keeps remaining coverage PRIVATE (proves only `used_before + payout ≤ limit`). On-chain `HealthInsurancePolicy` now tracks `coverageUsed` (wei) across claims and enforces `coverageUsed + payoutWei ≤ coverageLimit`. No Poseidon chaining needed unless you want private state commitments.
6. **Trusted setup:** dev ceremony (single contribution). Fine for demo; note it to judges.

## 7. Definition of done — claim section

- [x] Signed hospital invoice format finalized (`invoice_signed_v1`)
- [x] Hospital key/registry format finalized (`hospital_registry_v1`)
- [x] Claim circuit implemented (`circuits/claim.circom`)
- [x] Signature/authorization condition checked (case A)
- [x] Covered-treatment condition checked (case C)
- [x] Expense sum checked (case D)
- [x] Deductible/co-pay settlement formula checked (§4, matches handout's ₹60,750 example)
- [x] Coverage bound checked (case E)
- [x] Claim nullifier generated & proven (§6)
- [x] Valid claim proof generated + locally verified
- [x] Invalid/fake claim proofs rejected (5/5 cases)
- [x] **Unified with contract/HealthInsurancePolicy (ETH via Chainlink after inference, 5-input ZK path + 4-input legacy compat)**
- [x] **ClaimVerifier + MockAggregator + export scripts wired**
