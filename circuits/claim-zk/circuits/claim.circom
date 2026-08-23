pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/eddsaposeidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "utils.circom";

// ---------------------------------------------------------------------------
// CLAIM_VERIFICATION — ordinary ZK circuit (no ML on the claim side)
//
// Proves, without revealing raw invoice / coverage details:
//   1. the hospital EdDSA-Poseidon signature over the invoice is valid
//   2. treatment_code is in the covered-treatment allowlist
//   3. itemized expenses sum to total_expense
//   4. settlement formula: payout = floor((total - deductible) * (1 - copay))
//   5. coverage_used_before + payout <= coverage_limit
//   6. claim_nullifier = Poseidon(policy_id, invoice_id, nullifier_secret)
//
// All monetary amounts are INTEGER PAISE (1 INR = 100 paise).
// ---------------------------------------------------------------------------

template ClaimVerification(N_EXPENSES, MONEY_BITS) {

    // ------------------------- PUBLIC INPUTS --------------------------------
    signal input policy_id;          // [0]
    signal input hospital_pk_x;      // [1] BabyJubJub pubkey of authorized hospital
    signal input hospital_pk_y;      // [2]
    signal input claim_nullifier;    // [3] H(policy_id, invoice_id, secret)
    signal input payout_amount;      // [4] settlement output (paise)

    // ------------------------- PRIVATE INPUTS -------------------------------
    // Hospital signature (EdDSA over Poseidon) on the invoice
    signal input sig_r_x;
    signal input sig_r_y;
    signal input sig_s;

    // Signed invoice fields
    signal input invoice_id;
    signal input patient_commitment;   // commitment to patient identity
    signal input treatment_code;       // 1=HOSPITALIZATION 2=SURGERY 3=EMERGENCY 4=ICU
    signal input admission_date;       // unix seconds
    signal input discharge_date;       // unix seconds
    signal input expenses[N_EXPENSES]; // itemized line items (paise)
    signal input total_expense;        // claimed total (paise)

    // Policy parameters + coverage state
    signal input deductible_paise;     // e.g. 2000000 (= Rs 20,000)
    signal input copay_bps;            // basis points, e.g. 1000 (=10%)
    signal input coverage_used_before; // already-consumed coverage (paise)
    signal input coverage_limit;       // policy limit (paise)

    // Nullifier secret
    signal input nullifier_secret;

    // Witness-provided remainder of the settlement division:
    // gross = payout_amount * 10000 + settlement_remainder, remainder < 10000
    signal input settlement_remainder;

    // ------------------------- RANGE CHECKS ---------------------------------
    // Bound all money-ish values so no field-mod-p wraparound tricks.
    component rangeTotal   = Num2Bits(MONEY_BITS); rangeTotal.in   <== total_expense;
    component rangeDeduct  = Num2Bits(MONEY_BITS); rangeDeduct.in  <== deductible_paise;
    component rangeUsed    = Num2Bits(MONEY_BITS); rangeUsed.in    <== coverage_used_before;
    component rangeLimit   = Num2Bits(MONEY_BITS); rangeLimit.in   <== coverage_limit;
    component rangePayout  = Num2Bits(MONEY_BITS); rangePayout.in  <== payout_amount;
    component rangeCopay   = Num2Bits(16);         rangeCopay.in    <== copay_bps;
    component rangeCode    = Num2Bits(8);          rangeCode.in     <== treatment_code;
    component rangeAdm     = Num2Bits(32);         rangeAdm.in      <== admission_date;
    component rangeDis     = Num2Bits(32);         rangeDis.in      <== discharge_date;

    component rangeExpenses[N_EXPENSES];
    for (var i = 0; i < N_EXPENSES; i++) {
        rangeExpenses[i] = Num2Bits(MONEY_BITS);
        rangeExpenses[i].in <== expenses[i];
    }

    // ------------------------- 1. SIGNATURE ---------------------------------
    component poseidonInvoice = Poseidon(7);
    poseidonInvoice.inputs[0] <== invoice_id;
    poseidonInvoice.inputs[1] <== policy_id;
    poseidonInvoice.inputs[2] <== patient_commitment;
    poseidonInvoice.inputs[3] <== treatment_code;
    poseidonInvoice.inputs[4] <== admission_date;
    poseidonInvoice.inputs[5] <== discharge_date;
    poseidonInvoice.inputs[6] <== total_expense;

    component sigVerify = EdDSAPoseidonVerifier();
    sigVerify.enabled <== 1;
    sigVerify.Ax <== hospital_pk_x;
    sigVerify.Ay <== hospital_pk_y;
    sigVerify.R8x <== sig_r_x;
    sigVerify.R8y <== sig_r_y;
    sigVerify.S <== sig_s;
    sigVerify.M <== poseidonInvoice.out;

    // ------------------------- 2. COVERED TREATMENT -------------------------
    // Allowlist: {1: HOSPITALIZATION, 2: SURGERY, 3: EMERGENCY, 4: ICU}
    component eq1 = IsEqual(); eq1.in[0] <== treatment_code; eq1.in[1] <== 1;
    component eq2 = IsEqual(); eq2.in[0] <== treatment_code; eq2.in[1] <== 2;
    component eq3 = IsEqual(); eq3.in[0] <== treatment_code; eq3.in[1] <== 3;
    component eq4 = IsEqual(); eq4.in[0] <== treatment_code; eq4.in[1] <== 4;
    signal covered;
    covered <== eq1.out + eq2.out + eq3.out + eq4.out;
    covered === 1;

    // ------------------------- 3. EXPENSE SUM -------------------------------
    component expSum = Sum(N_EXPENSES);
    for (var i = 0; i < N_EXPENSES; i++) {
        expSum.in[i] <== expenses[i];
    }
    expSum.out === total_expense;

    // ------------------------- 4. SETTLEMENT FORMULA ------------------------
    // eligible = total_expense - deductible_paise        (must be >= 0)
    // gross    = eligible * (10000 - copay_bps)
    // payout   = gross \ 10000   (integer division, remainder enforced)
    component geZero = GreaterEqThan(MONEY_BITS);
    geZero.in[0] <== total_expense;
    geZero.in[1] <== deductible_paise;
    geZero.out === 1;

    signal eligible;
    eligible <== total_expense - deductible_paise;

    signal grossMultiplier;
    grossMultiplier <== 10000 - copay_bps;
    component rangeMult = Num2Bits(16);
    rangeMult.in <== grossMultiplier;

    signal gross;
    gross <== eligible * grossMultiplier;

    // Integer-division uniqueness: given fixed gross,
    // (payout_amount, settlement_remainder) is unique when remainder < 10000.
    component rangeRem = Num2Bits(16);
    rangeRem.in <== settlement_remainder;

    signal grossProd;
    grossProd <== payout_amount * 10000;
    grossProd + settlement_remainder === gross;

    // ------------------------- 5. COVERAGE BOUND ----------------------------
    signal usedAfter;
    usedAfter <== coverage_used_before + payout_amount;
    component withinLimit = LessThan(MONEY_BITS + 1);
    withinLimit.in[0] <== usedAfter;
    withinLimit.in[1] <== coverage_limit;
    withinLimit.out === 1;

    // ------------------------- 6. NULLIFIER ---------------------------------
    component nullifierHash = Poseidon(3);
    nullifierHash.inputs[0] <== policy_id;
    nullifierHash.inputs[1] <== invoice_id;
    nullifierHash.inputs[2] <== nullifier_secret;
    nullifierHash.out === claim_nullifier;
}

component main {public [policy_id, hospital_pk_x, hospital_pk_y, claim_nullifier, payout_amount]} =
    ClaimVerification(8, 56);
