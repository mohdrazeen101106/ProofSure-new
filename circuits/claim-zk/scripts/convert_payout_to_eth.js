#!/usr/bin/env node
/**
 * Post-inference INR (paise) -> ETH converter.
 *
 * Mirrors on-chain logic in contract/HealthInsurancePolicy.sol:paiseToWei()
 * (and contract/ClaimPayoutChainlink.sol:paiseToWei()) so off-chain previews match settlement exactly.
 *
 * Usage (after model/circuit inference):
 *   node scripts/convert_payout_to_eth.js                          # uses test_vectors/claim_public.json paise + mock price 300k INR/ETH
 *   node scripts/convert_payout_to_eth.js --paise 6075000
 *   node scripts/convert_payout_to_eth.js --paise 6075000 --price 300000 --decimals 8
 *   node scripts/convert_payout_to_eth.js --fetch                 # fetch live ETH/INR from CoinGecko (preview only, on-chain still uses Chainlink)
 *   node scripts/convert_payout_to_eth.js --eth-usd 3000 --usd-inr 83.5  # dual-feed preview
 *
 * On-chain truth remains Chainlink; --fetch is for UI preview parity only.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const PUB_PATH = path.join(__dirname, "..", "test_vectors", "claim_public.json");

function paiseToWei(paise, priceRaw, decimals) {
  // Solidity: wei = paise * 1e18 * 10**dec / (100 * price)
  const paiseBig = BigInt(paise);
  const priceBig = BigInt(priceRaw);
  const decPow = 10n ** BigInt(decimals);
  return (paiseBig * 10n ** 18n * decPow) / (100n * priceBig);
}

function weiToEthStr(wei) {
  const s = wei.toString().padStart(19, "0");
  const intPart = s.slice(0, -18) || "0";
  const frac = s.slice(-18).replace(/0+$/, "");
  return frac ? `${intPart}.${frac}` : intPart;
}

function paiseToInrStr(paise) {
  const p = BigInt(paise);
  const inr = p / 100n;
  const paiseRem = (p % 100n).toString().padStart(2, "0");
  return `₹${inr.toString()}.${paiseRem}`;
}

function fetchEthInr() {
  // CoinGecko simple price: eth in INR
  return new Promise((resolve, reject) => {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr";
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          const inrPerEth = j.ethereum.inr; // float
          resolve(inrPerEth);
        } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (k) => {
    const i = args.indexOf(k);
    return i !== -1 ? args[i + 1] : null;
  };
  const has = (k) => args.includes(k);

  let paise;
  if (getArg("--paise")) paise = getArg("--paise");
  else {
    try {
      const pub = JSON.parse(fs.readFileSync(PUB_PATH, "utf8"));
      paise = pub[4].toString();
    } catch {
      paise = "6075000";
    }
  }

  // defaults match MockAggregatorV3: 300k INR/ETH, 8 dec
  let decimals = parseInt(getArg("--decimals") || "8", 10);
  let priceRaw;

  if (has("--eth-usd") && has("--usd-inr")) {
    // Dual-feed preview: INR/ETH = ETH/USD * USD/INR
    const ethUsd = parseFloat(getArg("--eth-usd"));
    const usdInr = parseFloat(getArg("--usd-inr"));
    const inrPerEth = ethUsd * usdInr;
    priceRaw = BigInt(Math.round(inrPerEth * 10 ** decimals));
    console.log(`Dual-feed preview: ETH/USD=${ethUsd} * USD/INR=${usdInr} => INR/ETH=${inrPerEth}`);
  } else if (has("--fetch")) {
    const inrPerEth = await fetchEthInr();
    priceRaw = BigInt(Math.round(inrPerEth * 10 ** decimals));
    console.log(`Fetched live ETH/INR from CoinGecko: ~₹${inrPerEth.toLocaleString("en-IN")} per ETH`);
  } else if (getArg("--price")) {
    // --price is human INR per ETH, convert to raw
    const human = parseFloat(getArg("--price"));
    priceRaw = BigInt(Math.round(human * 10 ** decimals));
  } else {
    // default mock
    priceRaw = BigInt(300000 * 10 ** decimals); // 300000 * 1e8
  }

  const wei = paiseToWei(paise, priceRaw, decimals);
  const eth = weiToEthStr(wei);
  const humanPrice = Number(priceRaw) / 10 ** decimals;

  console.log("");
  console.log("=== Post-inference converter (mirrors contract/HealthInsurancePolicy.sol:paiseToWei) ===");
  console.log(`Payout (paise) : ${paise}  (${paiseToInrStr(paise)})`);
  console.log(`Oracle price   : ${humanPrice.toLocaleString("en-IN")} INR/ETH  (raw=${priceRaw.toString()}, dec=${decimals})`);
  console.log(`Formula        : wei = paise *1e18 *10**dec / (100*price)`);
  console.log(`Payout (wei)   : ${wei.toString()}`);
  console.log(`Payout (ETH)   : ${eth} ETH`);
  console.log(`Payout (gwei)  : ${(wei / 10n**9n).toString()} gwei`);
  console.log("");
  console.log("On-chain will call HealthInsurancePolicy.submitClaimProof() -> paiseToWei() after verifyClaimProof()");
  console.log("atomically AFTER ClaimVerifier.verifyClaimProof() using Chainlink latestRoundData().");
  console.log("Keep circuit outputs in paise; do NOT add price to the ZK statement.");
}

main().catch((e) => { console.error(e); process.exit(1); });
