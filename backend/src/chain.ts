import { JsonRpcProvider, Wallet, Contract, formatEther, parseEther } from "ethers";
import { config, deploymentInfo } from "./config";

/** On-chain service. Runs in SIMULATION mode when RPC_URL/PROVIDER_PRIVATE_KEY/
 *  POLICY_ADDRESS are not configured so the whole product is demoable offline. */

const POLICY_ABI = [
  "function createPolicy(address holder,uint256 premium,uint256 coverageLimit,uint256 deductible,uint256 coPayBps,uint64 durationSeconds,bytes32 premiumModelId) returns (uint256)",
  "function payPremium(uint256 policyId) payable",
  "function activatePolicy(uint256 policyId)",
  "function getPolicy(uint256) view returns (tuple(address holder,uint256 premium,uint256 coverageLimit,uint256 coverageUsed,uint256 deductible,uint256 coPayBps,uint64 startTime,uint64 endTime,bool active,bytes32 premiumModelId))",
  "function authorizeHospitalByKey(uint256 pkX,uint256 pkY)",
  "function removeHospitalByKey(uint256 pkX,uint256 pkY)",
  "function authorizeHospitalsByKey(uint256[],uint256[])",
  "function isHospitalAuthorizedByKey(uint256 pkX,uint256 pkY) view returns (bool)",
  "function submitClaimProof(bytes proof,uint256[] publicInputs) returns (uint256)",
  "function getClaim(uint256) view returns (tuple(uint256 policyId,uint256 payoutPaise,uint256 payoutWei,bytes32 nullifier,bool processed))",
  "function paiseToWei(uint256 paise) view returns (uint256)",
  "function previewPayoutInEth(uint256 paise) view returns (uint256 weiAmt,uint256 price,uint8 dec)",
  "function fundReserve() payable",
  "function usedNullifiers(bytes32) view returns (bool)",
  "event PolicyCreated(uint256 indexed policyId, address indexed holder, uint256 premium, uint256 coverageLimit)",
  "event PremiumPaid(uint256 indexed policyId, address indexed holder, uint256 amount)",
  "event PolicyActivated(uint256 indexed policyId)",
  "event HospitalAuthorizedByKey(bytes32 indexed key, uint256 pkX, uint256 pkY)",
  "event ClaimSubmitted(uint256 indexed claimId, uint256 indexed policyId)",
  "event ClaimPaid(uint256 indexed claimId, uint256 indexed policyId, address indexed holder, uint256 payout)",
  "event ClaimPaidDetailed(uint256 indexed claimId, uint256 indexed policyId, address indexed holder, uint256 payoutPaise, uint256 payoutWei, uint256 price, uint8 decimals)",
];

export const simulation = !(config.rpcUrl && config.providerPrivateKey && config.policyAddress);

const provider = simulation ? null : new JsonRpcProvider(config.rpcUrl);
const wallet = simulation ? null : new Wallet(config.providerPrivateKey, provider!);
export const policy = simulation
  ? null
  : new Contract(config.policyAddress, POLICY_ABI, wallet);

let simPolicyCounter = 1000;
let simClaimCounter = 5000;

function simTx() {
  const h = "0x" + Buffer.from(Math.random().toString(36).slice(2) + Date.now()).toString("hex").padEnd(64, "0").slice(0, 64);
  return h;
}

export async function chainStatus() {
  if (simulation) {
    return { mode: "simulation", policyAddress: "sim", chainId: 31337 };
  }
  const net = await provider!.getNetwork();
  let balance = "0";
  try {
    balance = formatEther(await provider!.getBalance(await wallet!.getAddress()));
  } catch {
    /* ignore */
  }
  return {
    mode: "live",
    policyAddress: config.policyAddress,
    claimVerifier: deploymentInfo().claimVerifier,
    chainId: Number(net.chainId),
    providerBalance: balance,
  };
}

export async function createPolicyTx(args: {
  holder: string;
  premiumWei: bigint;
  coverageLimitWei: bigint;
  deductiblePaise: bigint;
  coPayBps: number;
  durationSeconds: number;
  premiumModelId: string;
}) {
  if (simulation) {
    return { policyId: ++simPolicyCounter, txHash: simTx() };
  }
  const tx = await policy!.createPolicy(
    args.holder,
    args.premiumWei,
    args.coverageLimitWei,
    args.deductiblePaise,
    args.coPayBps,
    args.durationSeconds,
    args.premiumModelId
  );
  const receipt = await tx.wait();
  const ev = receipt.logs
    .map((l: any) => {
      try {
        return policy!.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p: any) => p?.name === "PolicyCreated");
  return { policyId: Number(ev!.args.policyId), txHash: receipt.hash };
}

export async function activatePolicyTx(policyId: number) {
  if (simulation) return { txHash: simTx() };
  const tx = await policy!.activatePolicy(policyId);
  await tx.wait();
  return { txHash: tx.hash };
}

export async function getPolicyOnChain(policyId: number) {
  if (simulation) return null;
  try {
    return await policy!.getPolicy(policyId);
  } catch {
    return null;
  }
}

export async function authorizeHospitalKey(pkX: string, pkY: string) {
  if (simulation) return { txHash: simTx() };
  const tx = await policy!.authorizeHospitalByKey(BigInt(pkX), BigInt(pkY));
  await tx.wait();
  return { txHash: tx.hash };
}

export async function removeHospitalKey(pkX: string, pkY: string) {
  if (simulation) return { txHash: simTx() };
  const tx = await policy!.removeHospitalByKey(BigInt(pkX), BigInt(pkY));
  await tx.wait();
  return { txHash: tx.hash };
}

export async function fundReserve(ethAmount: string) {
  if (simulation) return { txHash: simTx() };
  const tx = await policy!.fundReserve({ value: parseEther(ethAmount) });
  await tx.wait();
  return { txHash: tx.hash };
}

export async function reserveBalance() {
  if (simulation) return { eth: "50.0000", note: "simulated reserve" };
  const bal = await provider!.getBalance(config.policyAddress);
  return { eth: formatEther(bal), note: "" };
}

/** Submit the Groth16 claim proof on-chain and wait for settlement. */
export async function settleClaimOnChain(proofBytesHex: string, publicInputs: string[]) {
  if (simulation) {
    return { claimId: ++simClaimCounter, txHash: simTx(), payoutWei: null };
  }
  const tx = await policy!.submitClaimProof(proofBytesHex, publicInputs.map((x) => BigInt(x)));
  const receipt = await tx.wait();
  const ev = receipt.logs
    .map((l: any) => {
      try {
        return policy!.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p: any) => p?.name === "ClaimPaidDetailed" || p?.name === "ClaimPaid");
  return {
    claimId: Number(ev?.args.claimId ?? 0),
    txHash: receipt.hash,
    payoutWei: ev?.args.payoutWei != null ? String(ev.args.payoutWei) : null,
  };
}

export async function payoutPreview(paise: string) {
  if (simulation) {
    // mirror contract math at 300k INR/ETH
    const wei = (BigInt(paise) * 10n ** 18n) / (100n * 300000n);
    return { weiAmt: wei.toString(), price: "30000000000000", dec: 8 };
  }
  const r = await policy!.previewPayoutInEth(BigInt(paise));
  return { weiAmt: r.weiAmt.toString(), price: r.price.toString(), dec: r.dec };
}
