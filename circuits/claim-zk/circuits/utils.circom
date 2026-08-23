pragma circom 2.1.6;

// Local helpers not shipped in circomlib

template Sum(n) {
    signal input in[n];
    signal output out;
    signal accs[n - 1];
    for (var i = 0; i < n - 1; i++) {
        if (i == 0) {
            accs[0] <== in[0] + in[1];
        } else {
            accs[i] <== accs[i - 1] + in[i + 1];
        }
    }
    out <== accs[n - 2];
}
