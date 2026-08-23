/** Minimal MetaMask wallet helpers (ethers v6 BrowserProvider). */
import { BrowserProvider, formatEther, parseEther } from "ethers";

declare global {
  interface Window {
    ethereum?: any;
  }
}

export function hasWallet() {
  return typeof window !== "undefined" && !!window.ethereum;
}

export async function connectWallet(): Promise<string> {
  if (!hasWallet()) throw new Error("No Ethereum wallet found — install MetaMask to continue.");
  const browserProvider = new BrowserProvider(window.ethereum);
  const accounts = await browserProvider.send("eth_requestAccounts", []);
  return accounts[0] as string;
}

export async function getChainId(): Promise<number> {
  const browserProvider = new BrowserProvider(window.ethereum);
  const net = await browserProvider.getNetwork();
  return Number(net.chainId);
}

export async function getBalance(address: string): Promise<string> {
  const browserProvider = new BrowserProvider(window.ethereum);
  return formatEther(await browserProvider.getBalance(address));
}

/** Send payPremium(policyId) with exact premium value from the connected wallet. */
export async function payPremium(policyAddress: string, policyId: number, premiumWei: string) {
  if (!hasWallet()) throw new Error("No Ethereum wallet found.");
  const browserProvider = new BrowserProvider(window.ethereum);
  const signer = await browserProvider.getSigner();
  const data = "0xb6b55f25" + BigInt(policyId).toString(16).padStart(64, "0");
  const tx = await signer.sendTransaction({ to: policyAddress, value: BigInt(premiumWei), data });
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}
