/**
 * predictor.js
 * -----------------------------------------------------------------------
 * Runs ENTIRELY client-side, in the browser. No network calls needed for
 * a prediction.
 *
 * Responsibilities:
 *   1. Reproduce the exact sklearn ColumnTransformer (StandardScaler +
 *      OneHotEncoder) from `web_preprocess_params.json`, in pure JS.
 *   2. Run the ONNX model (`network.onnx`) locally via onnxruntime-web
 *      (WASM backend -- no GPU/server required) to get an instant
 *      prediction for UI purposes.
 *   3. Package a raw row into the exact JSON shape ezkl expects
 *      (`{ input_data: [[...]] }`), ready to POST to the backend's
 *      /prove endpoint when the user wants a verifiable result.
 *
 * IMPORTANT PRODUCTION CAVEAT (read before shipping):
 * Shipping network.onnx to the browser means every client has the full
 * trained weights. That's fine for integrity (the zk proof's job is to
 * let a verifier check *which* fixed model produced an output, not to
 * hide weights from the end user) but it does mean the weights are not
 * confidential -- anyone using the web app can extract them. If model
 * confidentiality matters for your business, don't ship network.onnx to
 * the browser; instead call a backend /predict endpoint for the instant
 * preview too, and use this module only for the preprocessing + proof
 * request packaging.
 *
 * The backend NEVER trusts a client-supplied feature vector as the basis
 * for a proof -- see backend/app.py. This module's predict() is for fast
 * UI feedback only; the backend re-derives features from the raw row
 * independently before proving.
 */

import * as ort from "onnxruntime-web";
// Vite-managed copies of ORT's runtime assets. `?url` yields plain asset URLs
// that bypass the dev transform pipeline, so the browser's dynamic import of
// the Emscripten loader works in both dev and production builds.
import wasmSimdUrl from "./ort/ort-wasm-simd-threaded.wasm?url";
import mjsSimdUrl from "./ort/ort-wasm-simd-threaded.mjs?url";

/** @typedef {{
 *   gender: string, age: number, marital_status: string,
 *   occupation_type: string, annual_income_inr: number, bmi: number,
 *   tobacco_usage: string, alcohol_units_per_week: number,
 *   physical_activity_level: string, diet_type: string,
 *   has_diabetes: 0|1, has_hypertension: 0|1, family_history_cardiac: 0|1,
 *   stress_level_score: number, policy_type: string, sum_insured: number
 * }} RawRow */

export class PremiumPredictor {
  /**
   * @param {string} onnxUrl path/URL to network.onnx
   * @param {string} paramsUrl path/URL to web_preprocess_params.json
   */
  constructor(onnxUrl = "/network.onnx", paramsUrl = "/web_preprocess_params.json") {
    this.onnxUrl = onnxUrl;
    this.paramsUrl = paramsUrl;
    this.params = null;
    this.session = null;
  }

  /** Load params + ONNX session. Call once, before predict(). */
  async init() {
    const res = await fetch(this.paramsUrl);
    if (!res.ok) throw new Error(`Failed to load preprocess params: ${res.status}`);
    this.params = await res.json();

    // Single-threaded wasm, assets resolved from Vite-bundled URLs.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = {
      mjs: mjsSimdUrl,
      wasm: wasmSimdUrl,
    };

    this.session = await ort.InferenceSession.create(this.onnxUrl, {
      executionProviders: ["wasm"],
    });
    return this;
  }

  /**
   * Reproduces the fitted sklearn ColumnTransformer exactly:
   * StandardScaler on numerics, passthrough on binaries, OneHotEncoder
   * (drop='if_binary', handle_unknown='ignore') on categoricals -- in the
   * exact column order recorded in params.feature_order.
   * @param {RawRow} row
   * @returns {Float32Array} length === params.n_features
   */
  preprocess(row) {
    if (!this.params) throw new Error("Call init() before preprocess().");
    const p = this.params;
    const out = new Float32Array(p.n_features);
    let idx = 0;

    // 1. Numeric: (x - mean) / scale, in the exact fitted order
    p.numeric.columns.forEach((col, i) => {
      const x = Number(row[col]);
      if (Number.isNaN(x)) throw new Error(`Missing/invalid numeric field: ${col}`);
      out[idx++] = (x - p.numeric.mean[i]) / p.numeric.scale[i];
    });

    // 2. Binary passthrough, values must already be 0/1
    p.binary.columns.forEach((col) => {
      const x = Number(row[col]);
      if (x !== 0 && x !== 1) throw new Error(`Binary field ${col} must be 0 or 1, got ${row[col]}`);
      out[idx++] = x;
    });

    // 3. One-hot categoricals, matching sklearn's drop='if_binary' behaviour
    //    and handle_unknown='ignore' (unseen category -> all zeros, no throw)
    for (const colSpec of p.categorical.per_column) {
      const value = row[colSpec.column];
      const isBinaryDropped = colSpec.dropped_category !== null;
      const emittedCategories = isBinaryDropped
        ? colSpec.categories.filter((c) => c !== colSpec.dropped_category)
        : colSpec.categories;

      for (const cat of emittedCategories) {
        out[idx++] = value === cat ? 1 : 0;
      }
      // handle_unknown='ignore': if value isn't in colSpec.categories at all,
      // every column for this feature is correctly already 0 -- no action needed.
    }

    if (idx !== p.n_features) {
      throw new Error(`Internal error: built ${idx} features, expected ${p.n_features}`);
    }
    return out;
  }

  /**
   * Runs the ONNX model locally and returns the prediction in rupees.
   * This is NOT proved -- it's a fast client-side preview. Call
   * buildProofRequest() + POST to the backend for a verifiable result.
   * @param {RawRow} row
   */
  async predict(row) {
    if (!this.session) throw new Error("Call init() before predict().");
    const features = this.preprocess(row);
    const tensor = new ort.Tensor("float32", features, [1, this.params.n_features]);
    const results = await this.session.run({ input: tensor });
    const outputName = this.session.outputNames[0];
    const scaledPred = results[outputName].data[0];

    const rupees = scaledPred * this.params.target.scale[0] + this.params.target.mean[0];
    return { rupees, scaledPred, features };
  }

  /**
   * Packages a raw row into the request body the backend's POST /prove
   * endpoint expects. The backend re-derives the feature vector itself
   * from `raw_row` (see backend/app.py) -- `features` here is included
   * only so the UI can show "what we're about to prove" without a second
   * round trip; it is NOT trusted by the backend as the basis for proving.
   * @param {RawRow} row
   */
  buildProofRequest(row) {
    const features = this.preprocess(row);
    return {
      raw_row: row,
      features_preview: Array.from(features),
    };
  }
}

export default PremiumPredictor;
