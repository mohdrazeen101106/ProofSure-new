# ProofSure

Private, proof-driven health insurance: **local ZKML premium underwriting** +
**hospital-signed claims proven in ordinary ZK** + **automatic on-chain payouts**.

```
ProofSure-new/
├── interfaces/               FROZEN shared specs — read these first
│   ├── zk-interface.md           claim ZK: ABI order, paise scaling, encoding
│   ├── premium-zk-interface.md   premium ZKML: model hash, de-scaling, flow
│   ├── insurance-contract.json   deployed ABIs + conventions
│   └── samples/                  known-good premium & claim proofs
├── contracts/                Foundry project (forge test / anvil / Sepolia)
│   ├── src/HealthInsurancePolicy.sol   policy lifecycle, hospital key registry,
│   │                                   nullifier replay protection, paise→wei oracle
│   ├── src/ClaimVerifier.sol           IVerifier wrapper over the snarkjs Groth16 verifier
│   └── script/Deploy.s.sol             one-command deploy (+ initial hospital keys)
├── circuits/claim-zk/        Circom claim circuit + build artifacts + scripts
├── services/premium-prover/  FastAPI EZKL service (holds key.pk; API-key protected)
├── backend/                  Express orchestration API — JWT auth, roles, proving, settlement
└── frontend/                 React UI — client / hospital / provider workspaces
```

## Quick start

```bash
bash scripts/dev.sh          # prover :8000, backend :3010, frontend :3000
```

Open http://localhost:3000 and sign in. Seeded platform accounts (password `demo1234`):

| Account | Role | Notes |
|---|---|---|
| `client@proofsure.dev` | client | binds a MetaMask wallet to pay premiums / receive payouts |
| `hospital@proofsure.dev` | hospital | bound to signing identity `HOSP001` |
| `provider@proofsure.dev` | provider | underwriting, registry and settlement |

### Live on-chain mode

The backend runs against the chain whenever `RPC_URL`, `PROVIDER_PRIVATE_KEY` and
`POLICY_ADDRESS` are set; otherwise it degrades to simulation.

```bash
cd contracts && anvil &      # or any RPC (Sepolia works identically)
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

RPC_URL=http://localhost:8545 \
PROVIDER_PRIVATE_KEY=0xac09...ff80 \
POLICY_ADDRESS=$(python3 -c "import json;print(json.load(open('contracts/deployment.json'))['policy'])") \
bash scripts/dev.sh
```

- `POLICY_ADDRESS` is written to `contracts/deployment.json` by the deploy script.
- The provider key signs every settlement/payout — keep it funded.
- For Sepolia: `DEPLOYER_PRIVATE_KEY` + `SEPOLIA_RPC_URL` are read by the deploy
  script; set `PRICE_FEED` to a real AggregatorV3 INR-per-ETH feed or leave `0`
  for the bundled mock feed.

## End-to-end flow

1. **Client ▸ Private premium** — fills a 16-field health profile. *Run local model*
   performs ONNX inference **in the browser** (onnxruntime-web, WASM assets served
   from the app bundle). *Generate ZKML proof* sends the raw row once to the prover
   service, which re-derives features server-side and produces an EZKL/KZG proof.
2. **Provider ▸ Verification queue** — verifies each submission (`ezkl verify`,
   ±1 INR de-scale check, model-hash binding) then creates the policy on-chain.
   The premium ETH amount is auto-filled from the policy's **AggregatorV3 feed**
   (no hardcoded rate), and the holder wallet from the client's bound address.
3. **Client ▸ My policy** — pays the premium from MetaMask (`payPremium`);
   provider activates coverage.
4. **Hospital ▸ Invoice desk** — the login is bound to a server-assigned signing
   identity (`HOSP001`, …). Invoices are EdDSA-Poseidon signed over canonical
   fields and **addressed to a client email**, which delivers them into that
   client's portal ledger.
5. **Client ▸ Claims** — picks the delivered invoice, generates a Groth16 claim
   proof (authorization, covered treatment, expense sum, deductible/co-pay,
   coverage bound, nullifier), and submits it.
6. **Provider ▸ Claims** — settles on-chain: Groth16 verification, hospital
   registry check, nullifier replay protection, coverage state, oracle conversion
   (paise→wei), then automatic payout to the client's wallet.

## ZK systems

| Flow | System | Verified where |
|---|---|---|
| Premium (ZKML) | EZKL 23.x, KZG (local SRS) | off-chain by the provider; model hash pinned on-chain via `createPolicy(premiumModelId)` |
| Claim | Circom 2.1.6, Groth16 (BN254), 10,787 constraints | **on-chain** by `ClaimVerifier` inside `submitClaimProof` |

Frozen public-input orders and encoding rules live in `interfaces/`.

## API surface (orchestration backend :3010)

All routes require a JWT unless noted. Roles: C=client H=hospital P=provider.

```
POST /api/auth/register | login          — signup/signin (JWT)
GET  /api/auth/me                        — session user
PATCH /api/auth/me/wallet                — bind wallet            C

GET  /api/config                         — chain mode, addresses
GET  /api/events                         — activity feed (all roles)
GET  /api/convert/paise/:paise           — INR→wei via on-chain AggregatorV3

POST /api/premium/prove                  — raw row → KZML proof   C
GET  /api/premium/submissions/mine       — own submissions        C
GET  /api/provider/premium/queue         — verification queue     P
POST /api/provider/premium/:id/verify    — ezkl verify + checks   P

POST /api/provider/policies              — createPolicy on-chain  P
GET  /api/policies                       — role-scoped list       C/P
POST /api/provider/policies/:id/activate — activate after payment P
POST /api/policies/:id/pay               — premium payment record C

POST /api/hospital/keys/generate         — new BabyJubJub key     H (own identity only)
GET  /api/hospitals                      — registered keys
POST /api/provider/hospitals/authorize-key — on-chain registry    P

POST /api/hospital/invoices/sign         — sign + deliver to client email  H
GET  /api/hospital/invoices              — issued ledger          H
GET  /api/invoices/mine                  — delivered invoices     C

POST /api/claims/prove                   — invoice → Groth16 proof C
POST /api/claims                          — submit claim           C
GET  /api/claims                          — role-scoped list
POST /api/provider/claims/:id/settle     — on-chain settlement    P

GET  /api/reserve                        — reserve balance
POST /api/provider/reserve/fund          — fundReserve            P
```

Prover service (:8000) exposes `/prove`, `/verify`, `/model`, guarded by the
`X-API-Key` header (`PROVER_API_KEY`). Its proving key (~130 MB `key.pk`) never
leaves the service and is not stored in git.

## Testing

```bash
cd contracts && forge test        # 30 tests incl. REAL Groth16 vectors:
                                  # known-good calldata verifies, tampered/invalid fail
cd circuits/claim-zk && bash scripts/run_claim_flow.sh    # keys→invoice→proof→verify
bash scripts/invalid_cases.js     # 5 negative witness cases
cd backend && npm run check       # typecheck
cd frontend && npm run check      # typecheck
```

## Security posture

- JWT auth with role middleware; every portal route is role-gated server-side.
- Hospital identities are **server-assigned at registration**; key generation and
  invoice signing are bound to the logged-in identity only. A signed invoice can
  never cross hospitals, matching what the circuit proves against the registry.
- Raw health features are sent only to the prover service at explicit proof time
  and are never persisted by the backend. Invoices contain line items but no
  diagnosis data; delivered invoices are visible only to the addressed client.
- Claim integrity is enforced by the circuit AND re-checked by the contract:
  signature, registry membership, nullifier replay, coverage bound, expiry.
- Currency conversion always queries the deployed AggregatorV3 feed with
  staleness validation (`maxStaleness`, default 3600 s).

### Hardening items before mainnet

- Replace the local non-ceremony SRS (KZG) with a ceremony setup.
- Move hospital signing keys into HSM/KMS; stop returning `sk_hex` from
  `/hospitals` (currently present for development visibility only).
- Swap the mock aggregator for real Chainlink feeds (single INR/ETH or the
  dual-feed ETH/USD + USD/INR path already implemented in the contract).
- Persist backend state (currently JSON files) and add rate limiting/auditing.
