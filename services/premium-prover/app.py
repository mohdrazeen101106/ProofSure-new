"""
Backend prover service.

Owns the trust boundary: it independently re-derives the encoded feature
vector from the RAW row (never trusts a client-supplied feature vector),
then runs the fixed ezkl circuit to produce a proof. This is the only
component that holds the proving key (key.pk, ~130MB) -- it never leaves
this service.

Endpoints
---------
GET  /health            liveness/readiness probe
POST /predict            raw row -> prediction, NOT proved (fast, e.g. for
                          audit/back-office use; the frontend already does
                          this locally for instant UI feedback)
POST /prove               raw row -> {proof, public_inputs, prediction_inr}
POST /verify               proof   -> {valid: bool}

Run locally:
    uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1

IMPORTANT: keep --workers 1 (or use a proving-request queue across workers)
-- see the concurrency note near PROVE_LOCK below.
"""
import asyncio
import hashlib
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Optional

import ezkl
import joblib
import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("prover")

BASE = Path(__file__).parent
ARTIFACTS = BASE / "artifacts"
EZKL_WD = BASE / "ezkl_workspace"
RUNS_DIR = BASE / "runs"  # scratch space for per-request witness/proof files
RUNS_DIR.mkdir(exist_ok=True)

# Service-to-service shared secret (orchestration backend -> this prover).
# Set PROVER_API_KEY in production; the default keeps local dev frictionless.
PROVER_API_KEY = os.environ.get("PROVER_API_KEY", "proofsure-dev-prover-key")


async def require_api_key(x_api_key: Optional[str] = Header(None)):
    if x_api_key != PROVER_API_KEY:
        raise HTTPException(status_code=401, detail="invalid or missing X-API-Key")

COMPILED_PATH = str(EZKL_WD / "network.compiled")
SETTINGS_PATH = str(EZKL_WD / "settings.json")
PK_PATH = str(EZKL_WD / "key.pk")
VK_PATH = str(EZKL_WD / "key.vk")
SRS_PATH = str(EZKL_WD / "kzg.srs")

# --- Load fixed artifacts once at startup -----------------------------------
preprocessor = joblib.load(ARTIFACTS / "preprocessor.joblib")
target_scaler = joblib.load(ARTIFACTS / "target_scaler.joblib")
schema = json.loads((ARTIFACTS / "schema.json").read_text())
settings = json.loads((EZKL_WD / "settings.json").read_text())
INPUT_SCALE = settings["run_args"]["input_scale"]

def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

# Frozen model identity: proofs are bound to these hashes downstream.
MODEL_ONNX_SHA256 = _sha256_file(str(EZKL_WD / "network.onnx"))
MODEL_COMPILED_SHA256 = _sha256_file(COMPILED_PATH)
# bytes32 commitment stored on-chain as Policy.premiumModelId:
# first 32 bytes of the sha256 digest of the canonical ONNX graph.
PREMIUM_MODEL_ID_BYTES32 = MODEL_ONNX_SHA256[:64]

for p in (COMPILED_PATH, SETTINGS_PATH, PK_PATH, VK_PATH, SRS_PATH):
    if not Path(p).exists():
        raise RuntimeError(f"Missing required ezkl artifact: {p}")

CATEGORY_VALUES = None  # populated below directly from the fitted encoder,
# so this can never drift from what the model was actually trained on.
_cat_encoder = preprocessor.named_transformers_["cat"]
CATEGORY_VALUES = {
    col: set(_cat_encoder.categories_[i].tolist())
    for i, col in enumerate(schema["categorical_cols"])
}

# Proving is CPU-heavy and ezkl's Python bindings are not safe to call
# concurrently from multiple threads against the same proving key file.
# For a single-process deployment, serialize /prove calls with a lock.
# For real throughput, run several worker PROCESSES (not threads, since
# the ezkl calls below are sync/blocking) behind a queue, each with its
# own copy of key.pk loaded -- proving key access is read-only so this is
# safe to replicate.
PROVE_LOCK = asyncio.Lock()


# --- Request/response schemas ------------------------------------------------
class RawRow(BaseModel):
    gender: str
    age: int = Field(gt=0, lt=130)
    marital_status: str
    occupation_type: str
    annual_income_inr: float = Field(ge=0)
    bmi: float = Field(gt=0, lt=100)
    tobacco_usage: str
    alcohol_units_per_week: float = Field(ge=0)
    physical_activity_level: str
    diet_type: str
    has_diabetes: int = Field(ge=0, le=1)
    has_hypertension: int = Field(ge=0, le=1)
    family_history_cardiac: int = Field(ge=0, le=1)
    stress_level_score: float = Field(ge=0)
    policy_type: str
    sum_insured: float = Field(ge=0)

    @field_validator(
        "gender", "marital_status", "occupation_type", "tobacco_usage",
        "physical_activity_level", "diet_type", "policy_type",
    )
    @classmethod
    def known_category(cls, v: str, info):
        allowed = CATEGORY_VALUES[info.field_name]
        if v not in allowed:
            raise ValueError(f"{info.field_name}={v!r} not in known categories {sorted(allowed)}")
        return v


class ProveResponse(BaseModel):
    request_id: str
    prediction_inr: float
    proof: dict
    public_inputs: list
    prove_seconds: float


class VerifyRequest(BaseModel):
    proof: dict


class VerifyResponse(BaseModel):
    valid: bool
    verify_seconds: float


class PredictResponse(BaseModel):
    prediction_inr: float


# --- App ----------------------------------------------------------------------
app = FastAPI(title="Premium Prover Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your actual frontend origin(s) in production
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


def preprocess(row: RawRow) -> np.ndarray:
    df = pd.DataFrame([row.model_dump()])
    X = preprocessor.transform(df).astype(np.float32)
    return X


def decode_prediction(scaled_value: float) -> float:
    return float(target_scaler.inverse_transform([[scaled_value]])[0, 0])


@app.get("/model")
def model_info():
    """Frozen model identity consumed by the orchestration backend + provider UI."""
    return {
        "premium_model_id_bytes32": PREMIUM_MODEL_ID_BYTES32,
        "onnx_sha256": MODEL_ONNX_SHA256,
        "compiled_sha256": MODEL_COMPILED_SHA256,
        "ezkl_version": ezkl.__version__ if hasattr(ezkl, "__version__") else "23.x",
        "input_scale": INPUT_SCALE,
        "target_scaler": {"mean": float(target_scaler.mean_[0]), "scale": float(target_scaler.scale_[0])},
        "proving_system": "ezkl/KZG",
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict", response_model=PredictResponse)
def predict(row: RawRow):
    """Fast, unproved prediction. Backend re-derives features itself."""
    import torch  # local import: keep torch off the hot /prove path's import time
    X = preprocess(row)
    # Cheapest correct option: run the same ONNX graph used for the circuit,
    # so this endpoint can never silently diverge from what /prove attests to.
    import onnxruntime as ort
    sess = ort.InferenceSession(str(EZKL_WD / "network.onnx"))
    out = sess.run(None, {"input": X})[0]
    return PredictResponse(prediction_inr=decode_prediction(float(out[0, 0])))


@app.post("/prove", response_model=ProveResponse)
async def prove(row: RawRow, _: None = Depends(require_api_key)):
    request_id = uuid.uuid4().hex[:12]
    run_dir = RUNS_DIR / request_id
    run_dir.mkdir()

    # 1. Preprocess server-side ONLY -- this is what makes the proof mean
    #    something: the input being proved is derived from data this
    #    service validated and transformed itself, not a value the client
    #    could have crafted to force an arbitrary "proved" output.
    X = preprocess(row)
    input_path = run_dir / "input.json"
    input_path.write_text(json.dumps({"input_data": X.tolist()}))

    witness_path = run_dir / "witness.json"
    proof_path = run_dir / "proof.json"

    async with PROVE_LOCK:
        t0 = time.time()
        try:
            ezkl.gen_witness(str(input_path), COMPILED_PATH, str(witness_path))
            ezkl.prove(str(witness_path), COMPILED_PATH, PK_PATH, str(proof_path), srs_path=SRS_PATH)
        except Exception as e:
            log.exception("Proving failed for request %s", request_id)
            raise HTTPException(status_code=500, detail=f"Proving failed: {e}")
        prove_seconds = time.time() - t0

    proof = json.loads(proof_path.read_text())
    out_hex = proof["instances"][0][-1]
    scaled_pred = ezkl.felt_to_float(out_hex, INPUT_SCALE)
    prediction_inr = decode_prediction(scaled_pred)

    log.info("request_id=%s prove_seconds=%.2f prediction_inr=%.0f",
              request_id, prove_seconds, prediction_inr)

    return ProveResponse(
        request_id=request_id,
        prediction_inr=prediction_inr,
        proof=proof,
        public_inputs=proof["instances"],
        prove_seconds=prove_seconds,
    )


@app.post("/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest, _: None = Depends(require_api_key)):
    tmp_path = RUNS_DIR / f"verify_{uuid.uuid4().hex[:8]}.json"
    tmp_path.write_text(json.dumps(req.proof))
    t0 = time.time()
    try:
        valid = ezkl.verify(str(tmp_path), SETTINGS_PATH, VK_PATH, srs_path=SRS_PATH)
    except Exception:
        valid = False  # a malformed/tampered proof throws -- that IS "invalid"
    finally:
        tmp_path.unlink(missing_ok=True)
    return VerifyResponse(valid=bool(valid), verify_seconds=time.time() - t0)
