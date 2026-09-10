#!/usr/bin/env node
// Day 4 end-to-end: zip a real folder -> POST /deploy -> pay the real x402 fee
// on Base Sepolia -> onAfterSettle publishes -> the static site is actually
// live and serving the real files. Same evidentiary standard as Day 3: it
// fetches the deployed URL and checks the bytes, not "the code compiled".
//
// Preconditions: Drydock server running (DRYDOCK_URL, default :3000), and a
// funded TEST_BUYER_PRIVATE_KEY (Base Sepolia test USDC — see
// scripts/test-x402-sepolia.mjs header). Whatever static host the server is
// configured for (local or netlify) is what gets tested.
//
// Usage:  TEST_BUYER_PRIVATE_KEY=0x... npm run test:deploy

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const DRYDOCK_URL = (process.env.DRYDOCK_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TARGET_NETWORK = process.env.X402_NETWORK ?? "eip155:84532";
const KEY = process.env.TEST_BUYER_PRIVATE_KEY;
const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sample-site");
const MARKER = "drydock:sample-site-v1";

if (!KEY) {
  console.error("Missing TEST_BUYER_PRIVATE_KEY.");
  process.exit(1);
}

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function zipDir(dir) {
  const zip = new AdmZip();
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(a, r);
      else zip.addLocalFile(a, path.dirname(r) === "." ? "" : path.dirname(r));
    }
  };
  walk(dir, "");
  return zip.toBuffer();
}

async function main() {
  console.log(`[harness] target ${DRYDOCK_URL}  network ${TARGET_NETWORK}  site ${SITE_DIR}\n`);

  // 1. Upload the folder as a zip.
  const zipBytes = zipDir(SITE_DIR);
  console.log(`[harness] zipped sample-site -> ${zipBytes.length} bytes`);
  const createRes = await fetch(`${DRYDOCK_URL}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: zipBytes,
  });
  const created = await createRes.json();
  console.log("[harness] POST /deploy ->", JSON.stringify(created));
  rec("POST /deploy returns 201", createRes.status === 201, `got ${createRes.status}`);
  rec("deploy is awaiting_payment", created.state === "awaiting_payment", `got ${created.state}`);
  rec("file count is 2 (index.html + style.css)", created.fileCount === 2, `got ${created.fileCount}`);
  const payUrl = `${DRYDOCK_URL}${created.payUrl}`;
  const statusUrl = `${DRYDOCK_URL}${created.statusUrl}`;

  // 2. Unpaid -> 402.
  const unpaid = await fetch(payUrl);
  rec("unpaid pay URL returns 402", unpaid.status === 402, `got ${unpaid.status}`);

  // 3. Pay for real.
  const account = privateKeyToAccount(KEY);
  console.log(`\n[harness] paying as ${account.address} ...`);
  const client = new x402Client().register(TARGET_NETWORK, new ExactEvmScheme(account));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  let paid;
  try {
    paid = await fetchWithPayment(payUrl);
  } catch (err) {
    rec("payment completes without throwing", false, err?.message ?? String(err));
    return finish();
  }
  console.log(`[harness] paid GET ${created.payUrl} -> HTTP ${paid.status}`);
  rec("paid request returns 200", paid.status === 200, `got ${paid.status}`);

  const respHeader = paid.headers.get("PAYMENT-RESPONSE");
  rec("PAYMENT-RESPONSE header present", !!respHeader);
  let settleTx = null;
  if (respHeader) {
    const settle = new x402HTTPClient(client).getPaymentSettleResponse((n) => paid.headers.get(n));
    console.log("[harness] settlement:", JSON.stringify(settle));
    settleTx = settle.transaction ?? null;
    rec("settlement success", settle.success === true, `reason=${settle.errorReason}`);
    rec("settlement tx hash present", /^0x[0-9a-fA-F]{64}$/.test(settleTx ?? ""), `got ${settleTx}`);
  }

  // 4. Poll for the publish (onAfterSettle already ran, but poll is the contract).
  let status;
  for (let i = 0; i < 40; i++) {
    status = await (await fetch(statusUrl)).json();
    if (status.state === "live" || status.state === "failed") break;
    await sleep(1500);
  }
  console.log("\n[harness] final deploy record:", JSON.stringify(status, null, 2));
  rec("deploy state is 'live'", status.state === "live", `got ${status.state}${status.error ? ` — ${status.error}` : ""}`);
  rec("payer recorded on the deploy", status.payerAddress?.toLowerCase() === account.address.toLowerCase(), `got ${status.payerAddress}`);
  rec("settlement tx recorded on the deploy", !!settleTx && status.txHash === settleTx, `got ${status.txHash}`);
  rec("live URL present", typeof status.url === "string" && /^https?:\/\//.test(status.url), `got ${status.url}`);

  if (status.state !== "live" || !status.url) return finish();

  // 5. The site is ACTUALLY live — fetch it and check the bytes.
  const home = await fetch(status.url);
  const html = await home.text();
  console.log(`\n[harness] GET ${status.url} -> HTTP ${home.status}, ${html.length} bytes`);
  rec("deployed site root returns 200", home.status === 200, `got ${home.status}`);
  rec("deployed HTML contains the sample marker", html.includes(MARKER));

  const cssUrl = new URL("style.css", status.url).toString();
  const css = await fetch(cssUrl);
  const cssText = await css.text();
  rec("deployed sub-resource style.css serves 200", css.status === 200, `got ${css.status}`);
  rec("style.css has real CSS content", cssText.includes("place-items: center"));

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} assertions passed ===`);
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.name}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("[harness] fatal:", err);
  process.exit(1);
});
