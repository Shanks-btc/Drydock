#!/usr/bin/env node
// SPIKE — web/src/lib/payX402.ts, proven standalone before /try-it is built.
// (docs/frontend-plan.md §5 "RISK ITEM"; docs/plan.md "Day 6.5" carry-forward.)
//
// The question this answers: can a BROWSER wallet signer — i.e. an EIP-1193
// injected provider whose only signing primitive is `eth_signTypedData_v4`
// (what `window.ethereum` gives us) — drive the x402 `exact` scheme to a
// REAL 0.01 USDC settlement on Base Sepolia through the public facilitator?
//
// It is scripts/test-x402-sepolia.mjs's evidentiary bar, with ONE thing
// swapped: instead of handing `privateKeyToAccount(KEY)` straight to
// `ExactEvmScheme` (a local account that signs in-process), we build the
// exact object graph /try-it's payX402.ts will use in the browser —
//
//     window.ethereum  ->  viem createWalletClient({ transport: custom(eth) })
//                      ->  { address, signTypedData } adapter
//                      ->  x402Client.register(net, new ExactEvmScheme(adapter))
//
// — and the signature is produced by a JSON round-trip through
// `eth_signTypedData_v4`, byte-for-byte the call MetaMask receives.
//
// The private key here is ONLY the backing of a headless EIP-1193 provider
// shim standing in for the extension. Every RPC read the "wallet" can't
// answer itself is forwarded to a real Base Sepolia node, exactly as a
// real injected provider proxies reads. See makeInjectedProviderShim().
//
// Independently verified: the settlement tx is pulled from a SEPARATE plain
// RPC connection (no x402 SDK in the path) — receipt status, the ERC-20
// Transfer log (buyer -> seller, 10000 atomic), and the seller balance
// delta — so we are not just trusting the SDK's own PAYMENT-RESPONSE.
//
// Preconditions (all real, nothing mocked):
//   1. `npm start` running at DRYDOCK_URL (default http://localhost:3000),
//      configured for Base Sepolia (GET /pricing network === eip155:84532).
//   2. TEST_BUYER_PRIVATE_KEY holds Base Sepolia test USDC (faucet.circle.com,
//      "Base Sepolia"). Needs NO ETH — `exact` is a signed EIP-3009
//      authorization; the facilitator submits and pays gas.
//   3. Outbound network to the facilitator and a Base Sepolia RPC.
//
// Usage:
//   TEST_BUYER_PRIVATE_KEY=0x... node --experimental-transform-types \
//     --env-file-if-exists=.env scripts/spike-payx402-browser-signer.mjs
//
// RESIDUAL UNKNOWN this spike does NOT close: browser-ORIGIN CORS on
// x402.org/facilitator. The facilitator round-trip here runs from Node.
// wrapFetchWithPayment does not call the facilitator from the client — the
// resource server does that server-side — but ExactEvmScheme extension
// probes and any future direct verify from the page would. Close it with
// the companion HTML harness (scripts/payx402-browser-harness.html) opened
// in a real browser with a real wallet.

import fs from "node:fs";
import AdmZip from "adm-zip";
import { privateKeyToAccount } from "viem/accounts";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  getAddress,
  parseEventLogs,
  erc20Abi,
} from "viem";
import { baseSepolia } from "viem/chains";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { HTTPFacilitatorClient } from "@x402/core/server";

const DRYDOCK_URL = (process.env.DRYDOCK_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TARGET_NETWORK = process.env.X402_NETWORK ?? "eip155:84532";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";
// A DIFFERENT RPC path from anything the payment flow touches — this is the
// independent-verification connection.
const VERIFY_RPC = process.env.SPIKE_VERIFY_RPC ?? "https://sepolia.base.org";
const KEY = process.env.TEST_BUYER_PRIVATE_KEY;

if (!KEY) {
  console.error("Missing TEST_BUYER_PRIVATE_KEY — see this script's header.");
  process.exit(1);
}

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};

// ---------------------------------------------------------------------------
// The browser stand-in. An EIP-1193 provider whose ONLY signing operation is
// `eth_signTypedData_v4` — everything a real injected wallet also can't
// compute locally (chain id at first read, receipts, balances) is proxied to
// a real node, exactly as MetaMask proxies to its configured RPC. Nothing
// here is x402-aware.
// ---------------------------------------------------------------------------
function makeInjectedProviderShim(privateKey, rpcUrl) {
  const account = privateKeyToAccount(privateKey);
  const passthrough = createPublicClient({ transport: http(rpcUrl) });
  const capture = { typedDataSeen: null, methodsSeen: [] };
  let activeChainHex = "0x14a34"; // Base Sepolia (84532) — the wallet's current network

  const provider = {
    async request({ method, params = [] }) {
      capture.methodsSeen.push(method);
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address];
        case "eth_chainId":
          return activeChainHex;
        case "net_version":
          return String(parseInt(activeChainHex, 16));
        case "wallet_switchEthereumChain":
          activeChainHex = params[0]?.chainId ?? activeChainHex;
          return null;
        case "wallet_addEthereumChain":
          return null;
        case "personal_sign": {
          const [data] = params;
          return account.signMessage({ message: { raw: data } });
        }
        case "eth_signTypedData_v4": {
          // params: [address, typedDataJSON] — precisely what viem sends to
          // window.ethereum for a JSON-RPC account, and what MetaMask's
          // confirmation dialog renders.
          const [, json] = params;
          const typed = typeof json === "string" ? JSON.parse(json) : json;
          capture.typedDataSeen = typed;
          // The wallet signs exactly what it was handed. Re-derive via the
          // backing key over the parsed payload (post-JSON: numeric fields
          // are strings, chainId a number — viem re-normalises on hash).
          return account.signTypedData({
            domain: typed.domain,
            types: typed.types,
            primaryType: typed.primaryType,
            message: typed.message,
          });
        }
        default:
          // Reads the wallet can't answer -> real node, like a real provider.
          return passthrough.request({ method, params });
      }
    },
  };

  return { provider, capture, expectedAddress: account.address };
}

// The exact adapter payX402.ts will build in the browser: a viem WalletClient
// over the injected provider, reduced to the { address, signTypedData } shape
// ExactEvmScheme duck-types as its signer (ClientEvmSigner). `signTypedData`
// here goes provider -> eth_signTypedData_v4, NOT an in-process key.
async function browserSignerFromProvider(provider) {
  const [address] = await provider.request({ method: "eth_requestAccounts" });
  const wallet = createWalletClient({
    account: getAddress(address),
    chain: baseSepolia,
    transport: custom(provider),
  });
  return {
    address: getAddress(address),
    signTypedData: (typedData) => wallet.signTypedData(typedData),
  };
}

function tinySiteZip() {
  const zip = new AdmZip();
  const stamp = `payx402-spike-${Date.now()}`;
  zip.addFile(
    "index.html",
    Buffer.from(
      `<!doctype html><meta charset="utf-8"><title>${stamp}</title>` +
        `<h1>${stamp}</h1><p>payX402 browser-signer spike fixture.</p>\n`,
    ),
  );
  return { bytes: zip.toBuffer(), stamp };
}

async function main() {
  console.log(`[spike] target ${DRYDOCK_URL}  network ${TARGET_NETWORK}  facilitator ${FACILITATOR_URL}\n`);

  // --- Step 0: the server's real payment config ---------------------------
  const pricing = await (await fetch(`${DRYDOCK_URL}/pricing`)).json();
  console.log("[spike] GET /pricing:", JSON.stringify(pricing));
  record("Server network matches this spike", pricing.network === TARGET_NETWORK, `got ${pricing.network}`);
  const expectedAmount = pricing.feeAtomic;
  const expectedPayTo = getAddress(pricing.payTo);
  const expectedAsset = getAddress(pricing.asset);

  // --- Step 1: a real payable resource (current flow: upload then pay) ----
  const { bytes, stamp } = tinySiteZip();
  const createRes = await fetch(`${DRYDOCK_URL}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: bytes,
  });
  const created = await createRes.json();
  console.log(`[spike] POST /deploy -> ${createRes.status}`, JSON.stringify(created));
  record("POST /deploy returns 201", createRes.status === 201, `got ${createRes.status}`);
  record("deploy record has a payUrl", typeof created.payUrl === "string");
  const payUrl = `${DRYDOCK_URL}${created.payUrl}`;
  const statusUrl = `${DRYDOCK_URL}${created.statusUrl}`;

  // --- Step 2: unpaid probe x2 — 402 + PAYMENT-REQUIRED shape ------------
  const unpaid = await fetch(payUrl);
  const prHeader = unpaid.headers.get("PAYMENT-REQUIRED");
  console.log(`\n[spike] unpaid GET ${created.payUrl} -> HTTP ${unpaid.status}`);
  record("Unpaid request returns 402", unpaid.status === 402, `got ${unpaid.status}`);
  record("PAYMENT-REQUIRED header present", !!prHeader);
  const unpaid2 = await fetch(payUrl);
  record("Second unpaid probe also 402s cleanly", unpaid2.status === 402, `got ${unpaid2.status}`);

  let decoded;
  if (prHeader) {
    decoded = decodePaymentRequiredHeader(prHeader);
    const a = Array.isArray(decoded.accepts) ? decoded.accepts[0] : decoded.accepts;
    console.log("[spike] decoded PAYMENT-REQUIRED accepts[0]:", JSON.stringify(a, null, 2));
    record("scheme is 'exact'", a?.scheme === "exact", `got ${a?.scheme}`);
    record("network matches target", a?.network === TARGET_NETWORK, `got ${a?.network}`);
    record("asset is the configured USDC", getAddress(a?.asset) === expectedAsset, `got ${a?.asset}`);
    record("payTo is the configured seller", getAddress(a?.payTo) === expectedPayTo, `got ${a?.payTo}`);
    record("amount is the flat fee (atomic)", a?.amount === expectedAmount, `expected ${expectedAmount}, got ${a?.amount}`);
    record("extra carries the EIP-712 domain", !!a?.extra?.name && !!a?.extra?.version, JSON.stringify(a?.extra));
  }

  // --- Step 3: build the BROWSER signer --------------------------------
  const { provider, capture, expectedAddress } = makeInjectedProviderShim(KEY, VERIFY_RPC);
  const signer = await browserSignerFromProvider(provider);
  console.log(`\n[spike] browser signer address: ${signer.address}`);
  record("Signer address resolves via eth_requestAccounts", signer.address === getAddress(expectedAddress));
  record(
    "Signer used the injected-provider path (no local account)",
    capture.methodsSeen.includes("eth_requestAccounts"),
    `methods so far: ${capture.methodsSeen.join(",")}`,
  );

  const buyer = signer.address;
  const seller = expectedPayTo;

  // Balances BEFORE — via the independent RPC.
  const verifyClient = createPublicClient({ transport: http(VERIFY_RPC) });
  const usdc = expectedAsset;
  const balOf = (who) =>
    verifyClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  const buyerBefore = await balOf(buyer);
  const sellerBefore = await balOf(seller);
  console.log(`[spike] balances before — buyer ${buyerBefore} seller ${sellerBefore} (atomic)`);

  // --- Step 4: Layer-3 — sign via the browser path, verify at facilitator
  const client = new x402Client().register(TARGET_NETWORK, new ExactEvmScheme(signer));
  try {
    const http3 = new x402HTTPClient(client);
    const signed = await http3.createPaymentPayload(decoded);
    const reqs = Array.isArray(decoded.accepts) ? decoded.accepts[0] : decoded.accepts;
    const fac = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
    const verdict = await fac.verify(signed, reqs);
    console.log("[spike] facilitator.verify ->", JSON.stringify(verdict));
    record(
      "Facilitator accepts the browser-signed payment (verify.isValid)",
      verdict.isValid === true,
      verdict.isValid ? "" : `${verdict.invalidReason} — ${String(verdict.invalidMessage ?? "").split("\n")[0]}`,
    );
    record(
      "verify recovered the browser wallet as payer",
      !verdict.payer || getAddress(verdict.payer) === buyer,
      `got ${verdict.payer}`,
    );
  } catch (err) {
    record("Facilitator verify probe completes", false, err?.message ?? String(err));
  }

  // Assert the payload that went THROUGH eth_signTypedData_v4 is the real
  // EIP-3009 authorization the browser wallet would have been asked to sign.
  const td = capture.typedDataSeen;
  console.log("\n[spike] typed data seen by eth_signTypedData_v4:", JSON.stringify(td, null, 2));
  record("Wallet was asked via eth_signTypedData_v4", capture.methodsSeen.includes("eth_signTypedData_v4"));
  record("  primaryType is TransferWithAuthorization", td?.primaryType === "TransferWithAuthorization", `got ${td?.primaryType}`);
  record("  domain.name / version match server extra", td?.domain?.name === pricing.eip712.name && String(td?.domain?.version) === String(pricing.eip712.version), JSON.stringify(td?.domain));
  record("  domain.chainId is Base Sepolia (84532)", Number(td?.domain?.chainId) === 84532, `got ${td?.domain?.chainId}`);
  record("  domain.verifyingContract is the USDC asset", td?.domain?.verifyingContract && getAddress(td.domain.verifyingContract) === usdc, `got ${td?.domain?.verifyingContract}`);
  record("  message.from is the browser wallet", td?.message?.from && getAddress(td.message.from) === buyer, `got ${td?.message?.from}`);
  record("  message.to is the seller", td?.message?.to && getAddress(td.message.to) === seller, `got ${td?.message?.to}`);
  record("  message.value is the flat fee (atomic)", String(td?.message?.value) === expectedAmount, `got ${td?.message?.value}`);

  // --- Step 5: the REAL payment, browser signer, via wrapFetchWithPayment
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  let paid;
  try {
    paid = await fetchWithPayment(payUrl);
  } catch (err) {
    record("Real payment completes without throwing", false, err?.message ?? String(err));
    return finish();
  }
  console.log(`\n[spike] paid GET ${created.payUrl} -> HTTP ${paid.status}`);
  record("Paid request returns 200", paid.status === 200, `got ${paid.status}`);

  const respHeader = paid.headers.get("PAYMENT-RESPONSE");
  record("PAYMENT-RESPONSE header present", !!respHeader);
  let sdkTxHash = null;
  if (respHeader) {
    const settle = new x402HTTPClient(client).getPaymentSettleResponse((n) => paid.headers.get(n));
    console.log("[spike] decoded PAYMENT-RESPONSE (SDK's own claim):", JSON.stringify(settle, null, 2));
    sdkTxHash = settle.transaction ?? null;
    record("Settlement reports success", settle.success === true, `success=${settle.success} errorReason=${settle.errorReason}`);
    record("Settlement network matches target", settle.network === TARGET_NETWORK, `got ${settle.network}`);
    record("Real payer is the browser wallet", getAddress(settle.payer ?? "0x0") === buyer, `got ${settle.payer}`);
    record("Settlement tx hash is well-formed", /^0x[0-9a-fA-F]{64}$/.test(sdkTxHash ?? ""), `got ${sdkTxHash}`);
  }

  const body = await paid.json().catch(() => ({}));
  console.log("[spike] paid response body:", JSON.stringify(body));

  // --- Step 6: INDEPENDENT on-chain verification ------------------------
  // Nothing below touches the x402 SDK. Plain RPC, from the tx hash only.
  if (sdkTxHash) {
    console.log(`\n[spike] independently verifying ${sdkTxHash} via ${VERIFY_RPC} ...`);
    let receipt = null;
    for (let i = 0; i < 30; i++) {
      try {
        receipt = await verifyClient.getTransactionReceipt({ hash: sdkTxHash });
        if (receipt) break;
      } catch {
        /* not mined yet */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    record("Settlement tx is on-chain (receipt found)", !!receipt);
    if (receipt) {
      console.log(
        `[spike] receipt: block ${receipt.blockNumber} status ${receipt.status} from ${receipt.from} to ${receipt.to}`,
      );
      record("On-chain tx status is success", receipt.status === "success", `got ${receipt.status}`);
      record("Tx target is the USDC contract", getAddress(receipt.to) === usdc, `got ${receipt.to}`);

      const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
      const match = transfers.find(
        (t) =>
          getAddress(t.args.from) === buyer &&
          getAddress(t.args.to) === seller &&
          String(t.args.value) === expectedAmount,
      );
      console.log("[spike] USDC Transfer logs:", JSON.stringify(transfers.map((t) => ({ from: t.args.from, to: t.args.to, value: String(t.args.value) })), null, 2));
      record("On-chain USDC Transfer buyer -> seller for the exact fee", !!match, match ? "" : "no matching Transfer log");

      const buyerAfter = await balOf(buyer);
      const sellerAfter = await balOf(seller);
      console.log(`[spike] balances after — buyer ${buyerAfter} seller ${sellerAfter} (atomic)`);
      record(
        "Seller balance rose by exactly the fee",
        sellerAfter - sellerBefore === BigInt(expectedAmount),
        `delta ${sellerAfter - sellerBefore}, expected ${expectedAmount}`,
      );
      record(
        "Buyer balance fell by exactly the fee (no ETH/gas paid by buyer)",
        buyerBefore - buyerAfter === BigInt(expectedAmount),
        `delta ${buyerBefore - buyerAfter}, expected ${expectedAmount}`,
      );

      console.log(`\n[spike] BASESCAN: https://sepolia.basescan.org/tx/${sdkTxHash}`);
    }
  }

  // The deploy pipeline runs post-settlement; out of scope for this spike but
  // report where it landed so the run is legible.
  try {
    const st = await (await fetch(statusUrl)).json();
    console.log(`\n[spike] (fyi) deploy ${created.deployId} state: ${st.state}${st.url ? ` url ${st.url}` : ""}${st.error ? ` error ${st.error}` : ""}`);
  } catch {
    /* fyi only */
  }

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
  console.error("[spike] fatal:", err);
  process.exit(1);
});
