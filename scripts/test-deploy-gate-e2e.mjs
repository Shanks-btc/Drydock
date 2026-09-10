#!/usr/bin/env node
// Day 6 end-to-end: the memory-check gate wired between payment and publish.
// Two REAL runs against the live server, same evidentiary standard as
// Day 3/4/5 — real x402 payments on Base Sepolia, real deploy records, real
// gate output, not "the code compiles":
//
//   Run 1 (clean):   sample-site pays -> gate clean -> deploys -> live URL.
//   Run 2 (blocked): leaked-key-site (a real build.log carrying an AWS-shaped
//                     secret) pays -> gate matches exposed-key-in-build-output
//                     at >=0.6 -> halted BEFORE deploy, no live URL, no host
//                     ever touched.
//
// Usage: TEST_BUYER_PRIVATE_KEY=0x... npm run test:gate
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
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const account = privateKeyToAccount(KEY);
const client = new x402Client().register(TARGET_NETWORK, new ExactEvmScheme(account));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

/** Upload + pay for one site folder, poll for a terminal state, return the final record. */
async function payAndDeploy(label, siteDir) {
  console.log(`\n--- ${label}: ${siteDir} ---`);
  const zipBytes = zipDir(siteDir);
  const createRes = await fetch(`${DRYDOCK_URL}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: zipBytes,
  });
  const created = await createRes.json();
  console.log(`[${label}] POST /deploy ->`, JSON.stringify(created));
  rec(`${label}: POST /deploy returns 201`, createRes.status === 201, `got ${createRes.status}`);

  const payUrl = `${DRYDOCK_URL}${created.payUrl}`;
  const statusUrl = `${DRYDOCK_URL}${created.statusUrl}`;

  let paid;
  try {
    paid = await fetchWithPayment(payUrl);
  } catch (err) {
    rec(`${label}: payment completes without throwing`, false, err?.message ?? String(err));
    return null;
  }
  console.log(`[${label}] paid GET ${created.payUrl} -> HTTP ${paid.status}`);
  rec(`${label}: paid request returns 200`, paid.status === 200, `got ${paid.status}`);

  const respHeader = paid.headers.get("PAYMENT-RESPONSE");
  let settleTx = null;
  if (respHeader) {
    const settle = new x402HTTPClient(client).getPaymentSettleResponse((n) => paid.headers.get(n));
    console.log(`[${label}] settlement:`, JSON.stringify(settle));
    settleTx = settle.transaction ?? null;
    rec(`${label}: settlement success`, settle.success === true, `reason=${settle.errorReason}`);
  }

  // Poll for a terminal state — now THREE possible terminal states (live /
  // failed / blocked), not two.
  let status;
  for (let i = 0; i < 40; i++) {
    status = await (await fetch(statusUrl)).json();
    if (["live", "failed", "blocked"].includes(status.state)) break;
    await sleep(1500);
  }
  console.log(`[${label}] final deploy record:`, JSON.stringify(status, null, 2));
  rec(`${label}: payer recorded on the deploy`, status.payerAddress?.toLowerCase() === account.address.toLowerCase());
  rec(`${label}: settlement tx recorded on the deploy`, !!settleTx && status.txHash === settleTx);
  return status;
}

async function main() {
  console.log(`[harness] target ${DRYDOCK_URL}  network ${TARGET_NETWORK}  buyer ${account.address}`);

  // ------------------------------------------------------------------
  // Run 1 — clean build: pays, gate clean, deploys, real live URL.
  // ------------------------------------------------------------------
  const clean = await payAndDeploy("RUN 1 (clean)", path.join(ROOT, "sample-site"));
  if (clean) {
    rec("RUN 1: deploy state is 'live'", clean.state === "live", `got ${clean.state}${clean.error ? ` — ${clean.error}` : ""}`);
    rec("RUN 1: gate ran and verdict is 'clean'", clean.gate?.verdict === "clean", `got ${JSON.stringify(clean.gate)}`);
    rec("RUN 1: gate found no top match", clean.gate?.topMatch === null || clean.gate?.topMatch === undefined);
    rec("RUN 1: live URL present", typeof clean.url === "string" && /^https?:\/\//.test(clean.url), `got ${clean.url}`);
    if (clean.url) {
      const home = await fetch(clean.url);
      const html = await home.text();
      rec("RUN 1: deployed site root returns 200", home.status === 200, `got ${home.status}`);
      rec("RUN 1: deployed HTML is the real sample-site content", html.includes("drydock:sample-site-v1"));
    }
  }

  // ------------------------------------------------------------------
  // Run 2 — build carrying the real exposed-key-in-build-output signal:
  // pays, gate BLOCKS before deploy, no live URL, host never touched.
  // ------------------------------------------------------------------
  const blocked = await payAndDeploy("RUN 2 (blocked)", path.join(ROOT, "leaked-key-site"));
  if (blocked) {
    rec("RUN 2: deploy state is 'blocked'", blocked.state === "blocked", `got ${blocked.state}`);
    rec("RUN 2: gate verdict is 'blocked'", blocked.gate?.verdict === "blocked", `got ${JSON.stringify(blocked.gate)}`);
    rec(
      "RUN 2: matched pattern is exposed-key-in-build-output",
      blocked.gate?.topMatch?.pattern_id === "exposed-key-in-build-output",
      `got ${blocked.gate?.topMatch?.pattern_id}`,
    );
    rec(
      "RUN 2: matched confidence >= 0.6",
      typeof blocked.gate?.topMatch?.confidence === "number" && blocked.gate.topMatch.confidence >= 0.6,
      `got ${blocked.gate?.topMatch?.confidence}`,
    );
    rec("RUN 2: rationale is present and non-trivial", (blocked.gate?.topMatch?.rationale?.length ?? 0) > 40);
    rec("RUN 2: NO live URL was ever set", blocked.url === null || blocked.url === undefined, `got ${blocked.url}`);
    console.log(`\n[harness] RUN 2 halt reason — pattern=${blocked.gate?.topMatch?.pattern_id} confidence=${blocked.gate?.topMatch?.confidence}`);
    console.log(`[harness] RUN 2 rationale: ${blocked.gate?.topMatch?.rationale}`);

    // Day 6.5 — the block should also have been written to Sibyl as an
    // incident (give onAfterSettle's fire-and-forget write a moment).
    await sleep(3000);
    const incidents = await (await fetch(`${DRYDOCK_URL}/incidents?limit=20`)).json();
    const mine = Array.isArray(incidents)
      ? incidents.find((r) => r.type === "incident" && r.locator === `deploy/${blocked.id}#gate.exposed-key-in-build-output`)
      : null;
    console.log(`[harness] RUN 2 incident row:`, JSON.stringify(mine));
    rec("RUN 2: the block was recorded in Sibyl incident memory", !!mine);
    rec("RUN 2: recorded incident carries the LLM rationale + confidence", !!mine?.matchRationale && typeof mine?.matchConfidence === "number");
    rec("RUN 2: recorded incident is flagged blockedDeploy", mine?.blockedDeploy === true);
  }

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
