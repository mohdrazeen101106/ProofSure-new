# ProofSure — integrated monorepo

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
│   ├── src/HealthInsurancePolicy.sol   policy lifecycle, dual hospital registry,
│   │                                   nullifier replay protection, paise→wei via oracle
│   ├── src/ClaimVerifier.sol           IVerifier wrapper over the snarkjs Groth16 verifier
│   ├── src/verifier/ClaimProofVerifier.sol  drop-in generated verifier (5 public signals)
│   └── script/Deploy.s.sol             one-command deploy (+ demo hospital keys)
├── circuits/claim-zk/        Circom claim circuit + build artifacts + scripts
├── services/premium-prover/  FastAPI EZKL service (holds key.pk; API-key protected)
├── backend/                  Express orchestration API — JWT auth, roles, proving, settlement
└── frontend/                 React UI — client / hospital / provider portals
```

## Quick start

```bash
bash scripts/dev.sh          # prover :8000, backend :3010, frontend :3000
```

Open http://localhost:3000 → log in (`client@proofsure.dev` / `demo1234`).

### Full on-chain mode (recommended for the demo)

```bash
cd contracts && anvil &      # or use any RPC
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

RPC_URL=http://localhost:8545 \
PROVIDER_PRIVATE_KEY=0xac09...ff80 \
POLICY_ADDRESS=$(python3 -c "import json;print(json.load(open('contracts/deployment.json'))['policy'])") \
bash scripts/dev.sh
```

Demo accounts (password `demo1234`): `client@proofsure.dev`, `hospital@proofsure.dev`,
`provider@proofsure.dev`.

## End-to-end demo flow

1. **Client** connects wallet → enters private health inputs → *Run local model*
   (ONNX inference in-browser) → *Generate ZKML proof* (EZKL/KZG via prover service).
2. **Provider** verifies the proof in the queue (ezkl verify + ±1 INR de-scale check)
   → creates the policy bound to `premiumModelId = sha256(network.onnx)[0:32]`.
3. **Client** pays the premium from their wallet (`payPremium`) → provider activates.
4. **Hospital** issues an itemized invoice signed with its EdDSA-Poseidon key;
   provider authorizes that key on-chain.
5. **Client** pastes the invoice → claim circuit proves: authorized hospital,
   covered treatment, expense sum, deductible/co-pay formula, coverage bound.
6. **Provider** settles → contract verifies Groth16, checks nullifier/policy/coverage,
   converts paise→wei via oracle and **pays out automatically**.

Failure demos: fake-hospital key (proof fails), duplicate nullifier
(`"nullifier already used"`), payout above remaining coverage.

## Testing

```bash
cd contracts && forge test        # 30 tests incl. REAL Groth16 vectors:
                                  # known-good calldata verifies, tampered/invalid fail
cd circuits/claim-zk && bash scripts/run_claim_flow.sh    # keys→invoice→proof→verify
bash scripts/invalid_cases.js     # 5 negative witness cases
cd backend && npm run check       # typecheck
cd frontend && npx tsc --noEmit   # typecheck
```

## Security notes

- JWT auth with role middleware (client/hospital/provider); provider endpoints are
  role-gated server-side; prover `/prove`+`/verify` need `X-API-Key`.
- Proving key (~130MB) never leaves the prover service; raw health features are never
  persisted by the backend; no medical data goes on-chain.
- Demo scope: hospital signing happens server-side for this role; SRS is a local
  non-ceremony setup — replace before production (see interface docs).
