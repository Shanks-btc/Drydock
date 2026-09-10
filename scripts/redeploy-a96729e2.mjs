#!/usr/bin/env node
// One-shot verification for the 2026-09-09 fail-closed incident: redeploy the
// EXACT folder that crashed the memory-check gate (a96729e2 — a full Aurex
// project checkout, 2736 files) from its retained src.zip, pay for real, and
// watch it through to a terminal state. The bug: the Sibyl bridge mis-decoded
// non-ASCII UTF-8 as cp1252 → lone surrogates → UnicodeEncodeError → gate
// fail-closed. Fixed in sibylBridge.ts + signalExtraction.ts. This proves the
// whole pipeline (redeploy → x402 → gate → publish), not just the signal count.
//
// Usage: TEST_BUYER_PRIVATE_KEY=0x... node --experimental-transform-types \
//          --no-warnings --env-file-if-exists=.env scripts/redeploy-a96729e2.mjs

import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const DRYDOCK_URL = (process.env.DRYDOCK_URL ?? "http://localhost:3000").replace(/\/$/, "");
const NETWORK = process.env.X402_NETWORK ?? "eip155:84532";
const SOURCE_ID = process.env.SOURCE_DEPLOY ?? "a96729e2-308a-4f9e-9cdb-933c42d91d3c";
const KEY = process.env.TEST_BUYER_PRIVATE_KEY;
if (!KEY) {
  console.error("Missing TEST_BUYER_PRIVATE_KEY.");
  process.exit(1);
}

const account = privateKeyToAccount(KEY);
const client = new x402Client().register(NETWORK, new ExactEvmScheme(account));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`[redeploy] source ${SOURCE_ID}  buyer ${account.address}\n`);

  // 1. POST /deploy/:id/redeploy — reads deploys/<id>/src.zip off disk
  const createRes = await fetch(`${DRYDOCK_URL}/deploy/${SOURCE_ID}/redeploy`, { method: "POST" });
  const created = await createRes.json();
  console.log(`[redeploy] POST redeploy -> ${createRes.status}`, JSON.stringify(created));
  if (createRes.status !== 201) {
    console.error("redeploy did not return 201 — aborting");
    process.exit(1);
  }
  const newId = created.deployId;
  const payUrl = `${DRYDOCK_URL}${created.payUrl}`;
  const statusUrl = `${DRYDOCK_URL}${created.statusUrl}`;
  console.log(`[redeploy] new deploy ${newId} (redeployOf ${created.redeployOf}) · ${created.fileCount} files\n`);

  // 2. pay for real (x402 exact on Base Sepolia), retry on facilitator soft-fail
  let paid;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      paid = await fetchWithPayment(payUrl);
    } catch (err) {
      console.error(`[redeploy] payment attempt ${attempt} threw:`, err?.message ?? err);
      await sleep(3000);
      continue;
    }
    if (paid.status === 200) break;
    const settle = new x402HTTPClient(client).getPaymentSettleResponse((n) => paid.headers.get(n));
    console.log(`[redeploy] payment attempt ${attempt} -> HTTP ${paid.status} · settle.success=${settle?.success} reason=${settle?.errorReason}`);
    if (settle && settle.success === false) {
      await sleep(3500); // facilitator nonce race — retry
      continue;
    }
    break;
  }
  if (!paid || paid.status !== 200) {
    console.error("[redeploy] payment never settled — aborting");
    process.exit(1);
  }
  const settle = new x402HTTPClient(client).getPaymentSettleResponse((n) => paid.headers.get(n));
  console.log(`[redeploy] PAID — tx ${settle.transaction} (payer ${settle.payer})\n`);

  // 3. poll to a terminal state (gate is detached; ~1min for the LLM step + CF)
  let rec;
  const t0 = Date.now();
  for (let i = 0; i < 90; i++) {
    rec = await (await fetch(statusUrl)).json();
    if (["live", "failed", "blocked"].includes(rec.state)) break;
    await sleep(2000);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  console.log(`[redeploy] final record after ${secs}s:`);
  console.log(JSON.stringify(rec, null, 2));
  console.log();

  // 4. verdict
  const failClosed = rec.state === "blocked" && (rec.gate === null || rec.gate === undefined);
  const realBlock = rec.state === "blocked" && rec.gate && rec.gate.verdict === "blocked" && rec.gate.topMatch;
  const clean = rec.state === "live" || (rec.gate && rec.gate.verdict === "clean");

  console.log("=".repeat(70));
  if (failClosed) {
    console.log("❌ STILL FAIL-CLOSED — the memory check did not complete. gate === null.");
    console.log(`   record.error: ${rec.error ?? "(none — check backend log)"}`);
    process.exit(1);
  } else if (rec.state === "live") {
    console.log(`✅ GATE COMPLETED — verdict clean, deploy is LIVE`);
    console.log(`   url: ${rec.url}`);
    console.log(`   gate: ${rec.gate.signalsExtracted} signals, ${rec.gate.knownPatternsChecked} pattern(s) checked, no match ≥ 0.6`);
    console.log(`   tx:  ${rec.txHash}`);
  } else if (realBlock) {
    console.log(`✅ GATE COMPLETED — verdict BLOCKED on a real pattern match (not fail-closed)`);
    console.log(`   pattern: ${rec.gate.topMatch.pattern_id} @ ${rec.gate.topMatch.confidence}`);
    console.log(`   rationale: ${rec.gate.topMatch.rationale}`);
  } else if (rec.state === "failed") {
    console.log(`⚠️  GATE COMPLETED (verdict ${rec.gate?.verdict ?? "?"}) but the PUBLISH step failed — host-side, not the gate`);
    console.log(`   error: ${rec.error}`);
    console.log(`   (this still proves the memory check no longer fail-closes)`);
  } else if (clean) {
    console.log(`✅ GATE COMPLETED — verdict clean (state: ${rec.state})`);
  } else {
    console.log(`? unexpected terminal state: ${rec.state}`);
    process.exit(1);
  }
  console.log("=".repeat(70));
  process.exit(0);
}

main().catch((e) => {
  console.error("[redeploy] fatal:", e);
  process.exit(1);
});
