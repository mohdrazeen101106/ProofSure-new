const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { buildEddsa } = require("circomlibjs");

// Deterministic demo keys (canonical, match docs/zk_interface.md known-good vectors
// and contracts/script/Deploy.s.sol). Pass --random to generate fresh ones.
const DEMO_SK = {
  HOSP001: "eb3718c4583beec57ab11d839234a44844f786a2928ef2034aecd49283939fb3",
  FAKE999: "455b00827a8e94dd7da1d7a94a492d9f915253ca6d58fde04362773b175c85eb",
};

async function main() {
  const eddsa = await buildEddsa();
  const useRandom = process.argv.includes("--random");
  const authorized = useRandom ? crypto.randomBytes(32) : Buffer.from(DEMO_SK.HOSP001, "hex");
  const unauthorized = useRandom ? crypto.randomBytes(32) : Buffer.from(DEMO_SK.FAKE999, "hex");

  // prv2pub returns [x, y] as 32-byte little-endian buffers
  const pubA = eddsa.prv2pub(authorized);
  const pubB = eddsa.prv2pub(unauthorized);
  const dec = (b) => eddsa.F.toObject(b).toString(10);

  const registry = {
    format: "hospital_registry_v1",
    note: "Contract stores this allowlist. Only listed pubkeys pass the ZK check.",
    hospitals: [
      {
        hospital_id: "HOSP001",
        name: "Apollo Demo Hospital",
        pk_x: dec(pubA[0]),
        pk_y: dec(pubA[1]),
        packed_pk_hex: Buffer.from(pubA[0]).toString("hex") + Buffer.from(pubA[1]).toString("hex"),
      },
      {
        hospital_id: "FAKE999",
        name: "Unauthorized Hospital (negative-test key)",
        pk_x: dec(pubB[0]),
        pk_y: dec(pubB[1]),
        packed_pk_hex: Buffer.from(pubB[0]).toString("hex") + Buffer.from(pubB[1]).toString("hex"),
        authorized: false,
      },
    ],
  };

  const keys = {
    format: "hospital_keys_v1",
    HOSP001: { sk_hex: authorized.toString("hex") },
    FAKE999: { sk_hex: unauthorized.toString("hex") },
  };

  const out = path.join(__dirname, "..", "test_vectors");
  fs.writeFileSync(path.join(out, "hospital_registry.json"), JSON.stringify(registry, null, 2));
  fs.writeFileSync(path.join(out, "hospital_keys.json"), JSON.stringify(keys, null, 2));
  console.log("Wrote test_vectors/hospital_registry.json and hospital_keys.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
