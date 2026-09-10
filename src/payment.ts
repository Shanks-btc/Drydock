/**
 * Drydock x402 payment gate — a flat, one-shot "deploy fee".
 *
 * No negotiation, no per-deploy price: every deploy pays the same fixed
 * amount of USDC on Base before the pipeline runs. This module only builds
 * the gate; it does NOT run any deploy logic (that's Day 4+).
 *
 * SDK: @x402/* v2.23 (v2 protocol — PAYMENT-REQUIRED / PAYMENT-RESPONSE
 * headers, not the v1 X-PAYMENT era). Verified against installed source.
 *
 * CONSTANTS BELOW MUST STAY IN SYNC with web/src/lib/chain.ts — the backend
 * is a separate package and can't import from web/. Sources (2026-09-01):
 *   - chain id / RPC / explorer: docs.base.org/chain/network-information
 *   - USDC address + EIP-712 name/version: x402 SDK DEFAULT_ASSETS table
 *     (@x402/evm). Base Sepolia test USDC name is "USDC" (NOT "USD Coin",
 *     which is mainnet) — the two differ, hence the explicit override.
 */

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

// --- Network -------------------------------------------------------------
// CAIP-2 id. Hackathon default: Base Sepolia. Set X402_NETWORK=eip155:8453
// for mainnet (and flip the client's NEXT_PUBLIC_X402_NETWORK to match —
// the two must always agree).
export const X402_NETWORK = (process.env.X402_NETWORK ?? "eip155:84532") as `${string}:${string}`;

// --- Settlement asset (USDC) --------------------------------------------
const USDC_BY_NETWORK: Record<
  string,
  { address: `0x${string}`; decimals: number; eip712Name: string; eip712Version: string }
> = {
  "eip155:8453": {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    eip712Name: "USD Coin",
    eip712Version: "2",
  },
  "eip155:84532": {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
    eip712Name: "USDC",
    eip712Version: "2",
  },
};

export const USDC =
  USDC_BY_NETWORK[X402_NETWORK] ??
  (() => {
    throw new Error(`No USDC config for X402_NETWORK=${X402_NETWORK} (expected eip155:8453 or eip155:84532)`);
  })();

// Allow overriding the EIP-712 domain from env (Metron's convention) — the
// on-chain contract's name()/version() is authoritative; if a test token ever
// disagrees with the SDK table, override here rather than editing code.
export const USDC_EIP712_NAME = process.env.X402_USDC_EIP712_NAME ?? USDC.eip712Name;
export const USDC_EIP712_VERSION = process.env.X402_USDC_EIP712_VERSION ?? USDC.eip712Version;

// --- Fee ----------------------------------------------------------------
/** Flat deploy fee, in whole USDC. */
export const DEPLOY_FEE_USDC = Number(process.env.DRYDOCK_DEPLOY_FEE_USDC ?? "0.01");
/** Same fee in atomic units (USDC has 6 decimals) — the x402 wire format. */
export const DEPLOY_FEE_ATOMIC = String(Math.round(DEPLOY_FEE_USDC * 10 ** USDC.decimals));

// --- Recipient --------------------------------------------------------
export const SELLER_ADDRESS = (process.env.DRYDOCK_SELLER_ADDRESS ?? "") as `0x${string}`;
if (!/^0x[0-9a-fA-F]{40}$/.test(SELLER_ADDRESS)) {
  throw new Error(
    "DRYDOCK_SELLER_ADDRESS is missing or malformed — set it to the address that should receive deploy fees.",
  );
}

// --- Facilitator ------------------------------------------------------
// Who verifies the signed payment and submits the on-chain settlement tx.
// Default: the public x402 reference facilitator, which supports
// eip155:84532 `exact` v2 with NO auth (confirmed via its /supported
// endpoint). Coinbase's hosted facilitator (@coinbase/x402, needs
// CDP_API_KEY_ID/SECRET, reaches api.cdp.coinbase.com) is the mainnet
// choice — set X402_FACILITATOR_URL + provide those keys for that.
export const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";

// --- Resource server + middleware ------------------------------------
export const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: FACILITATOR_URL }),
).register(X402_NETWORK, new ExactEvmScheme());

/** The route the deploy fee gates. One payable resource per deploy id. */
export const DEPLOY_PAY_ROUTE = "GET /deploy/:id/pay";

/** Pull the deploy id out of a `/deploy/<id>/pay` path. The x402 hook context
 *  only exposes the raw request path, not Express's resolved :id param. */
export function deployIdFromPath(pathname: string | undefined): string | null {
  if (!pathname) return null;
  const m = /^\/deploy\/([^/?]+)\/pay(?:$|[/?])/.exec(pathname);
  return m ? m[1] : null;
}

export const deployPaymentMiddleware = paymentMiddleware(
  {
    [DEPLOY_PAY_ROUTE]: {
      accepts: {
        scheme: "exact",
        network: X402_NETWORK,
        payTo: SELLER_ADDRESS,
        // Flat fee — but expressed as an explicit { asset, amount } rather
        // than the "$0.01" shorthand, so the settlement token is never
        // ambiguous. THAT is why `extra` below is required here even though
        // the price is static: `extra: { name, version }` (the USDC EIP-712
        // domain) is needed whenever `price` is an explicit AssetAmount, not
        // only when it's a dynamic resolver. Omit it and the client has no
        // domain to sign the EIP-3009 authorization against — every payment
        // fails before a request is even sent.
        price: { asset: USDC.address, amount: DEPLOY_FEE_ATOMIC },
        extra: { name: USDC_EIP712_NAME, version: USDC_EIP712_VERSION },
        maxTimeoutSeconds: 120,
      },
      description: "Drydock one-shot deploy fee",
      mimeType: "application/json",
    },
  },
  resourceServer,
);

export function paymentConfigSummary() {
  return {
    network: X402_NETWORK,
    facilitatorUrl: FACILITATOR_URL,
    payTo: SELLER_ADDRESS,
    asset: USDC.address,
    feeUsdc: DEPLOY_FEE_USDC,
    feeAtomic: DEPLOY_FEE_ATOMIC,
    eip712: { name: USDC_EIP712_NAME, version: USDC_EIP712_VERSION },
  };
}
