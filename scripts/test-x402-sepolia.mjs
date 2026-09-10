#!/usr/bin/env node
// Layer-1 debug tool (x402-payment-integration skill, step 3): a REAL x402
// payment against Base Sepolia, driven by a raw private key — no browser, no
// MetaMask, no wallet extension, no injected-provider state. If this passes
// and the browser flow fails, the bug is in the browser layer, not the
// contract / ABI / facilitator / payment shape.
//
// Adapted from Metron's scripts/test-x402-sepolia.mjs for Drydock's payment
// shape: a FLAT one-shot deploy fee at GET /deploy/pay (no /quote step).
//
// Preconditions (all real — nothing here is mocked):
//   1. The Drydock server (src/server.ts) is running and reachable at
//      DRYDOCK_URL (default http://localhost:3000), configured for the SAME
//      network as this script (Base Sepolia by default on both sides).
//   2. TEST_BUYER_PRIVATE_KEY holds a real key. For a full settlement it must
//      hold Base Sepolia *test USDC* (get some at https://faucet.circle.com,
//      select "Base Sepolia"). It needs NO ETH — `exact` scheme payments are
//      a signed EIP-3009 authorization, not a broadcast tx; the facilitator
//      submits and pays gas. A zero-USDC key still exercises the flow up to
//      the facilitator's balance check (a real, useful partial result).
//   3. Outbound network to the facilitator (X402_FACILITATOR_URL, default
//      https://x402.org/facilitator) and to a Base Sepolia RPC.
//
// Usage:
//   TEST_BUYER_PRIVATE_KEY=0x... npm run test:x402
//
// Every assertion is against a real HTTP response. A failure is reported, not
// swallowed.

import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { HTTPFacilitatorClient } from "@x402/core/server";

const DRYDOCK_URL = process.env.DRYDOCK_URL ?? "http://localhost:3000";
const TARGET_NETWORK = process.env.X402_NETWORK ?? "eip155:84532";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";
const KEY = process.env.TEST_BUYER_PRIVATE_KEY;

if (!KEY) {
  console.error("Missing TEST_BUYER_PRIVATE_KEY — see this script's header for what's required.");
  process.exit(1);
}

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};

async function main() {
  console.log(`[harness] target: ${DRYDOCK_URL}  network: ${TARGET_NETWORK}\n`);

  // --- Step 0: the server's real config, so later assertions mean something.
  const pricing = await (await fetch(`${DRYDOCK_URL}/pricing`)).json();
  console.log("[harness] GET /pricing:", JSON.stringify(pricing));
  record("Server network matches this script", pricing.network === TARGET_NETWORK, `got ${pricing.network}`);
  const expectedAmount = pricing.feeAtomic;
  const expectedPayTo = pricing.payTo;
  const expectedAsset = pricing.asset;

  const payUrl = `${DRYDOCK_URL}/deploy/pay`;

  // --- Step 1: unpaid request — the real 402 + PAYMENT-REQUIRED shape.
  const unpaid = await fetch(payUrl);
  const prHeader = unpaid.headers.get("PAYMENT-REQUIRED");
  console.log(`\n[harness] unpaid GET /deploy/pay -> HTTP ${unpaid.status}`);
  record("Unpaid request returns 402", unpaid.status === 402, `got ${unpaid.status}`);
  record("PAYMENT-REQUIRED header present", !!prHeader);

  if (prHeader) {
    const decoded = decodePaymentRequiredHeader(prHeader);
    console.log("[harness] decoded PAYMENT-REQUIRED:", JSON.stringify(decoded, null, 2));
    const a = Array.isArray(decoded.accepts) ? decoded.accepts[0] : decoded.accepts;
    record("x402Version present", typeof decoded.x402Version === "number", `got ${decoded.x402Version}`);
    record("scheme is 'exact'", a?.scheme === "exact", `got ${a?.scheme}`);
    record("network matches target", a?.network === TARGET_NETWORK, `got ${a?.network}`);
    record("asset is the configured USDC", a?.asset?.toLowerCase() === expectedAsset?.toLowerCase(), `got ${a?.asset}`);
    record("payTo is the configured seller", a?.payTo?.toLowerCase() === expectedPayTo?.toLowerCase(), `got ${a?.payTo}`);
    record("amount is the flat fee (atomic)", a?.amount === expectedAmount, `expected ${expectedAmount}, got ${a?.amount}`);
    record("extra carries the EIP-712 domain", !!a?.extra?.name && !!a?.extra?.version, `got ${JSON.stringify(a?.extra)}`);
  }

  // --- Step 1b: hit it unpaid AGAIN — the gate must not crash or change
  // behaviour on a repeat unpaid probe (skill checklist).
  const unpaid2 = await fetch(payUrl);
  record("Second unpaid probe also 402s cleanly", unpaid2.status === 402, `got ${unpaid2.status}`);

  // --- Step 2: the real payment. Same SDK primitives the browser flow will use.
  const account = privateKeyToAccount(KEY);
  console.log(`\n[harness] paying as ${account.address} ...`);
  const client = new x402Client().register(TARGET_NETWORK, new ExactEvmScheme(account));

  // Layer-3 diagnostic (always runs): sign the payment and ask the facilitator
  // to VERIFY it directly — no resource server in the path. This is what tells
  // you *why* a payment can't go through (bad EIP-712 domain vs. bad signature
  // vs. insufficient balance vs. facilitator down), which a bare 402 on the
  // retried request does not.
  try {
    const http = new x402HTTPClient(client);
    const decoded = decodePaymentRequiredHeader(prHeader);
    const signed = await http.createPaymentPayload(decoded);
    const reqs = Array.isArray(decoded.accepts) ? decoded.accepts[0] : decoded.accepts;
    const fac = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
    const verdict = await fac.verify(signed, reqs);
    console.log("[harness] facilitator.verify ->", JSON.stringify(verdict));
    record(
      "Facilitator accepts the signed payment (verify.isValid)",
      verdict.isValid === true,
      verdict.isValid ? "" : `${verdict.invalidReason} — ${String(verdict.invalidMessage ?? "").split("\n")[0]}`,
    );
  } catch (err) {
    record("Facilitator verify probe completes", false, err?.message ?? String(err));
  }

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  let paid;
  try {
    paid = await fetchWithPayment(payUrl);
  } catch (err) {
    record("Real payment completes without throwing", false, err?.message ?? String(err));
    return finish();
  }

  console.log(`[harness] paid GET /deploy/pay -> HTTP ${paid.status}`);
  if (paid.status !== 200) {
    const retryHeader = paid.headers.get("PAYMENT-REQUIRED");
    if (retryHeader) {
      try {
        console.log("[harness] retried-request PAYMENT-REQUIRED.error:", decodePaymentRequiredHeader(retryHeader).error);
      } catch {
        /* header not decodable — leave it */
      }
    }
  }
  record("Paid request returns 200", paid.status === 200, `got ${paid.status}`);

  const respHeader = paid.headers.get("PAYMENT-RESPONSE");
  record("PAYMENT-RESPONSE header present", !!respHeader);
  if (respHeader) {
    const settle = new x402HTTPClient(client).getPaymentSettleResponse((n) => paid.headers.get(n));
    console.log("[harness] decoded PAYMENT-RESPONSE (real settlement):", JSON.stringify(settle, null, 2));
    record("Settlement reports success", settle.success === true, `success=${settle.success} errorReason=${settle.errorReason}`);
    record("Settlement network matches target", settle.network === TARGET_NETWORK, `got ${settle.network}`);
    record("Real payer is the signing wallet", settle.payer?.toLowerCase() === account.address.toLowerCase(), `got ${settle.payer}`);
    record("Real settlement tx hash present", /^0x[0-9a-fA-F]{64}$/.test(settle.transaction ?? ""), `got ${settle.transaction}`);
  }

  const body = await paid.json().catch(() => ({}));
  console.log("[harness] paid response body:", JSON.stringify(body, null, 2));
  record("Body is the deploy-fee receipt stub", body.ok === true && body.resource === "drydock-deploy-fee");

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} assertions passed ===`);
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("[harness] fatal:", err);
  process.exit(1);
});
