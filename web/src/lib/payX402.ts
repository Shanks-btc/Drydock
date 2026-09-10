// Browser-wallet x402 payment for Drydock's flat deploy fee — the `exact`
// scheme (EIP-3009 TransferWithAuthorization) against Base Sepolia USDC via
// the public facilitator.
//
// PROVEN STANDALONE before this file existed:
// scripts/spike-payx402-browser-signer.mjs — 36/36 assertions, real
// settlement tx 0xc79c4c12…b71d0 on Base Sepolia, independently confirmed
// on-chain. See docs/frontend-plan.md §5. This is that spike's object graph,
// lifted verbatim:
//
//     window.ethereum
//       -> viem createWalletClient({ transport: custom(eth) })
//       -> { address, signTypedData } adapter   (ExactEvmScheme's signer is
//                                                 duck-typed to exactly this;
//                                                 a WalletClient alone doesn't
//                                                 satisfy it)
//       -> x402Client.register(net, new ExactEvmScheme(adapter))
//       -> wrapFetchWithPayment(fetch, client)
//
// The signature is produced by the wallet via `eth_signTypedData_v4`.
//
// CRITICAL, from the spike (docs/plan.md Day 7): the public x402.org
// facilitator intermittently SOFT-FAILS settlement — it returns
// `{ success: false, errorReason: "invalid_exact_evm_transaction_failed" }`
// ("replacement transaction underpriced" — its own submitter-nonce race on
// shared Base Sepolia), never throws, and the payer sees an HTTP 402 whose
// PAYMENT-RESPONSE header carries that soft failure. This is NOT a bug and
// NOT the user's fault — an immediate retry with a fresh payment settles.
// payDeployFee() classifies this as `status: "soft_failed", retryable: true`
// so the UI can offer "retry payment", never a dead end.

"use client";

import { createWalletClient, custom, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

import { ACTIVE_CHAIN } from "./chain";
import { ensureChain, type Eip1193Provider } from "./ensureChain";

export type PaymentResult =
  | { status: "settled"; txHash: `0x${string}`; payer: string; network: string }
  // facilitator returned { success:false } — observed, intermittent, clears on retry
  | { status: "soft_failed"; retryable: true; reason: string; message: string }
  // user dismissed the wallet signature prompt — they can try again
  | { status: "rejected"; retryable: true }
  // everything else. `retryable` says whether a plain "try again" could help.
  | { status: "error"; retryable: boolean; message: string };

export type PayProgress = (message: string) => void;

/** The slice of EIP-1193 we use. `window.ethereum` satisfies it. */
export interface InjectedProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

interface WindowWithEthereum extends Window {
  ethereum?: InjectedProvider;
}

export function getInjectedProvider(): InjectedProvider {
  const eth = (typeof window !== "undefined" && (window as WindowWithEthereum).ethereum) || null;
  if (!eth) {
    throw new PayEnvError(
      "No browser wallet found. Install MetaMask (or another injected wallet) and reload to pay the deploy fee.",
    );
  }
  return eth;
}

export class PayEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayEnvError";
  }
}

/** The connected wallet address (prompts the wallet the first time). */
export async function connectWallet(onProgress?: PayProgress): Promise<string> {
  const eth = getInjectedProvider();
  onProgress?.("Requesting wallet connection…");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) throw new PayEnvError("Wallet returned no accounts. Unlock it and try again.");
  return getAddress(accounts[0]);
}

/**
 * Pay the flat deploy fee at `payUrl` (the backend's `/deploy/:id/pay`).
 * Ensures the wallet is on Base Sepolia first. Never throws for the expected
 * failure classes — returns a discriminated `PaymentResult`. Throws only for
 * a genuinely unexpected condition (e.g. no wallet at all — PayEnvError).
 */
export async function payDeployFee(opts: {
  payUrl: string;
  /** CAIP-2 network the server expects (from GET /pricing). Defaults to the
   *  active chain's CAIP-2 — they must agree; a mismatch is surfaced. */
  network?: string;
  onProgress?: PayProgress;
}): Promise<PaymentResult> {
  const { payUrl, onProgress } = opts;
  const network = opts.network ?? ACTIVE_CHAIN.caip2;

  if (network !== ACTIVE_CHAIN.caip2) {
    return {
      status: "error",
      retryable: false,
      message: `Server expects ${network} but this build targets ${ACTIVE_CHAIN.caip2}. Set NEXT_PUBLIC_X402_NETWORK to match the backend.`,
    };
  }

  const eth = getInjectedProvider();

  try {
    await ensureChain(eth as unknown as Eip1193Provider, ACTIVE_CHAIN, onProgress);
  } catch (err) {
    // ensureChain throws user-readable, specific messages (declined switch,
    // add failed, still wrong network). A wrong network is recoverable.
    return { status: "error", retryable: true, message: messageOf(err) };
  }

  let address: string;
  try {
    onProgress?.("Connecting wallet…");
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    address = getAddress(accounts[0]);
  } catch (err) {
    if (isUserRejection(err)) return { status: "rejected", retryable: true };
    return { status: "error", retryable: true, message: messageOf(err) };
  }

  // The spike's adapter: a viem WalletClient over the injected provider,
  // reduced to { address, signTypedData }. signTypedData here goes
  // provider -> eth_signTypedData_v4, not an in-process key.
  const wallet = createWalletClient({
    account: getAddress(address),
    chain: baseSepolia,
    transport: custom(eth),
  });
  const signer = {
    address: getAddress(address),
    signTypedData: (typedData: Parameters<typeof wallet.signTypedData>[0]) => wallet.signTypedData(typedData),
  };

  const client = new x402Client().register(network, new ExactEvmScheme(signer));
  const httpClient = new x402HTTPClient(client);
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  onProgress?.("Waiting for you to sign the payment in your wallet…");
  let res: Response;
  try {
    res = await fetchWithPayment(payUrl);
  } catch (err) {
    if (isUserRejection(err)) return { status: "rejected", retryable: true };
    const msg = messageOf(err);
    // "Failed to create payment payload" == the signature/EIP-712 step broke.
    // That's a code/config problem, not something a plain retry fixes.
    const retryable = !/create payment payload|already attempted/i.test(msg);
    return { status: "error", retryable, message: msg };
  }

  onProgress?.("Payment sent — waiting for settlement…");

  // Decode the settlement response (present on both the 200 and the
  // soft-fail 402).
  let settle: SettleResponse | null = null;
  try {
    settle = httpClient.getPaymentSettleResponse((n) => res.headers.get(n)) as SettleResponse;
  } catch {
    settle = null;
  }

  if (res.status === 200 && settle?.success && settle.transaction) {
    return {
      status: "settled",
      txHash: settle.transaction as `0x${string}`,
      payer: settle.payer ?? address,
      network: settle.network ?? network,
    };
  }

  // Non-200 after a payment attempt.
  if (settle && settle.success === false) {
    if (settle.errorReason === "invalid_exact_evm_insufficient_balance") {
      return {
        status: "error",
        retryable: false,
        message:
          "The wallet doesn't hold enough test USDC on Base Sepolia. Fund it at faucet.circle.com (select Base Sepolia) and try again.",
      };
    }
    // Everything else from the facilitator's settle step — the observed
    // "replacement transaction underpriced" race lives here. Retryable.
    return {
      status: "soft_failed",
      retryable: true,
      reason: settle.errorReason ?? "settlement_failed",
      message:
        firstLine(settle.errorMessage) ||
        "The payment facilitator couldn't submit the settlement this time. This is an intermittent facilitator issue, not a problem with your wallet — retrying sends a fresh payment.",
    };
  }

  // A 402 with no settle response means the signed payment wasn't accepted
  // (verify failed) — pull the server's reason if it left one.
  let serverReason = "";
  try {
    const pr = res.headers.get("PAYMENT-REQUIRED");
    if (pr) serverReason = (decodePaymentRequiredHeader(pr) as { error?: string }).error ?? "";
  } catch {
    /* header absent or not decodable */
  }
  return {
    status: "error",
    retryable: false,
    message:
      serverReason ||
      `Payment was not accepted (HTTP ${res.status}). The signed authorization didn't verify against the server's requirements.`,
  };
}

// --- internals ---------------------------------------------------------

interface SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction?: string;
  network?: string;
}

function messageOf(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string } | undefined;
  return e?.shortMessage || e?.message || String(err);
}

function isUserRejection(err: unknown): boolean {
  const e = err as { code?: number; cause?: { code?: number }; name?: string; message?: string } | undefined;
  if (e?.code === 4001 || e?.cause?.code === 4001) return true;
  return /user rejected|user denied|rejected the request|action_rejected/i.test(
    String(e?.name ?? "") + " " + String(e?.message ?? ""),
  );
}

function firstLine(s: string | undefined): string {
  return (s ?? "").split("\n")[0].trim();
}
