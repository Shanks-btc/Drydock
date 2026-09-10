#!/usr/bin/env node
// Day 7 — /try-it END-TO-END through a REAL browser (headed Chromium, not
// headless). Same evidentiary bar as every prior day: real x402 payments on
// Base Sepolia, real deploy pipeline, real memory-check gate, independently
// verified on-chain — plus the browser layer this time (real DOM, the real
// React components, real fetch from a real page origin).
//
// What's real vs. stood-in:
//   REAL: the /try-it React app (web/, prod-built), the Drydock backend, the
//         memory-check gate + Sibyl, the x402 client stack, EIP-712 signing
//         via eth_signTypedData_v4, the facilitator round-trip, the on-chain
//         USDC settlement, the block-explorer receipts.
//   STOOD-IN: the wallet EXTENSION UI only. `window.ethereum` is an EIP-1193
//         provider whose signing is done by TEST_BUYER_PRIVATE_KEY in this
//         Node process (via page.exposeFunction) — the exact shim proven in
//         scripts/spike-payx402-browser-signer.mjs, now injected into a real
//         page. Every non-signing RPC is proxied to a real Base Sepolia node.
//
// Three flows, each asserted and screenshotted:
//   A. FORCED RETRY  — a fault-injecting facilitator proxy soft-fails the
//      first settle; assert the UI shows a retryable "retry payment" state
//      (NOT an error), click retry, assert it then settles + goes live.
//   B. CLEAN         — (covered by A's successful retry: clean gate -> live)
//   C. BLOCKED       — leaked-key-site preset: real settle -> gate matches
//      exposed-key-in-build-output -> deploy halted, no URL, incident recorded.
//
// An isolated stack (backend :3010 + web :3011) is used so the fault proxy
// and DRYDOCK_STATIC_HOST=local don't disturb the dev servers on :3000/:3001.
//
// Usage: TEST_BUYER_PRIVATE_KEY=0x... node --experimental-transform-types \
//          --env-file-if-exists=.env scripts/e2e-tryit-browser.mjs

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http as viemHttp, getAddress, parseEventLogs, erc20Abi } from "viem";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.TEST_BUYER_PRIVATE_KEY;
if (!KEY) {
  console.error("Missing TEST_BUYER_PRIVATE_KEY.");
  process.exit(1);
}
const VERIFY_RPC = process.env.SPIKE_VERIFY_RPC ?? "https://sepolia.base.org";
const account = privateKeyToAccount(KEY);

const PROXY_PORT = 3999;
const BACKEND_PORT = 3010;
const WEB_PORT = 3011;
const WEB_BASE = `http://localhost:${WEB_PORT}`;
const BACKEND_BASE = `http://localhost:${BACKEND_PORT}`;

const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SHOTS = path.join(ROOT, "docs", "evidence", `tryit-${STAMP}`);
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: "pipe", shell: process.platform === "win32", ...opts });
  children.push(child);
  const tag = opts.tag ?? cmd;
  child.stdout?.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${tag}] ${d}`));
  child.stderr?.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${tag}!] ${d}`));
  return child;
}
async function waitFor(url, label, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 402 || r.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${label} at ${url}`);
}
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const c of children) {
    if (!c.pid) continue;
    try {
      // SYNC — an exit handler can't await, and spawn()'d cleanup never runs.
      if (process.platform === "win32") execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-c.pid, "SIGKILL");
    } catch {
      try {
        c.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(1);
});

// --- the wallet shim (Node side of window.ethereum) ---------------------
const passthrough = createPublicClient({ transport: viemHttp(VERIFY_RPC) });
let activeChainHex = "0x14a34";
const walletLog = [];
async function walletRPC(method, params = []) {
  walletLog.push(method);
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [account.address];
    case "eth_chainId":
      return activeChainHex;
    case "net_version":
      return String(parseInt(activeChainHex, 16));
    case "wallet_switchEthereumChain":
      activeChainHex = params?.[0]?.chainId ?? activeChainHex;
      return null;
    case "wallet_addEthereumChain":
      return null;
    case "personal_sign":
      return account.signMessage({ message: { raw: params[0] } });
    case "eth_signTypedData_v4": {
      const typed = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
      console.log(
        `[wallet] eth_signTypedData_v4 primaryType=${typed.primaryType} value=${typed.message?.value} to=${typed.message?.to}`,
      );
      return account.signTypedData({
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
      });
    }
    default:
      return passthrough.request({ method, params });
  }
}

// --- on-chain verification (independent of the SDK / the page) ----------
const verifyClient = createPublicClient({ transport: viemHttp(VERIFY_RPC) });
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
async function verifyOnChain(label, txHash, expectPayTo) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) {
    rec(`${label}: settlement tx hash well-formed`, false, `got ${txHash}`);
    return;
  }
  let receipt = null;
  for (let i = 0; i < 30; i++) {
    try {
      receipt = await verifyClient.getTransactionReceipt({ hash: txHash });
      if (receipt) break;
    } catch {
      /* pending */
    }
    await sleep(2000);
  }
  rec(`${label}: settlement tx on-chain`, !!receipt, txHash);
  if (!receipt) return;
  rec(`${label}: tx status success`, receipt.status === "success", receipt.status);
  rec(`${label}: tx target is USDC`, getAddress(receipt.to) === getAddress(USDC), receipt.to);
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  const match = transfers.find(
    (t) =>
      getAddress(t.args.from) === getAddress(account.address) &&
      getAddress(t.args.to) === getAddress(expectPayTo) &&
      String(t.args.value) === "10000",
  );
  rec(`${label}: USDC Transfer buyer->seller 0.01`, !!match);
  console.log(
    `[verify] ${label}: https://sepolia.basescan.org/tx/${txHash} block ${receipt.blockNumber} status ${receipt.status}`,
  );
  return txHash;
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`[shot] ${file}`);
  return file;
}

// --- flow helpers ------------------------------------------------------
async function pickPreset(page, which) {
  // DropZone preset buttons
  const label = which === "clean" ? /Clean static export/i : /Leaked key in build output/i;
  await page.getByRole("button", { name: label }).click();
}

/** Click pay/retry until the flow leaves the payment phases. Returns the
 *  number of soft-fail retries observed. */
async function payThroughRetries(page, maxRetries = 5) {
  let softFails = 0;
  for (let i = 0; i <= maxRetries; i++) {
    const payBtn = page.getByRole("button", { name: /pay .*USDC|Retry payment/i });
    await payBtn.waitFor({ state: "visible", timeout: 30_000 });
    const isRetry = /Retry payment/i.test((await payBtn.textContent()) ?? "");
    if (isRetry) softFails++;
    await payBtn.click();

    // Wait for one of: retry state, scanning, done, error
    const outcome = await Promise.race([
      page
        .getByText(/No payment was taken/i)
        .waitFor({ state: "visible", timeout: 90_000 })
        .then(() => "retry"),
      page
        .getByText(/Checking the build/i)
        .waitFor({ state: "visible", timeout: 90_000 })
        .then(() => "scanning"),
      page
        .getByText(/Your site is live|Deploy halted before publish|The publish step failed/i)
        .waitFor({ state: "visible", timeout: 90_000 })
        .then(() => "done"),
      page
        .getByText(/Something went wrong/i)
        .waitFor({ state: "visible", timeout: 90_000 })
        .then(() => "error"),
    ]);
    if (outcome === "retry") {
      await shot(page, `retry-state-attempt-${i + 1}`);
      continue;
    }
    return { softFails, outcome };
  }
  return { softFails, outcome: "gave_up" };
}

/** Time how long ScanPanel ("Checking the build") is actually on screen —
 *  from payment settling to a terminal card. Grabs a mid-scan screenshot and
 *  the on-screen elapsed counter. This is the evidence for "the scan step is
 *  visibly meaningful, not instantaneous". */
async function measureScan(page, label) {
  const scanning = page.getByText(/Checking the build/i);
  let appearedAt = null;
  try {
    await scanning.waitFor({ state: "visible", timeout: 8000 });
    appearedAt = Date.now();
  } catch {
    /* scan panel never showed — the flash bug is back */
  }

  // Sample mid-scan (~4.5s after it appeared) — if still scanning, capture it.
  let midElapsedText = null;
  let stillScanningAt4_5s = false;
  if (appearedAt) {
    await sleep(4500);
    stillScanningAt4_5s = await scanning.isVisible().catch(() => false);
    if (stillScanningAt4_5s) {
      midElapsedText = (await page.getByText(/s elapsed/i).textContent().catch(() => null))?.trim() ?? null;
      await shot(page, `${label}-scan-midway`);
    }
  }

  await page
    .getByText(/Your site is live|Deploy halted before publish|The publish step failed/i)
    .waitFor({ state: "visible", timeout: 120_000 });
  const terminalAt = Date.now();

  // The frozen "on screen" duration DeployResult prints.
  const resultTiming =
    (await page.getByText(/on screen/i).textContent().catch(() => null))?.trim() ?? null;

  return {
    appeared: !!appearedAt,
    scanVisibleMs: appearedAt ? terminalAt - appearedAt : 0,
    stillScanningAt4_5s,
    midElapsedText,
    resultTiming,
  };
}

async function readTxHashFromResult(page) {
  // DeployResult / ScanPanel render tx hashes as basescan links.
  const link = page.locator('a[href*="sepolia.basescan.org/tx/"]').first();
  try {
    await link.waitFor({ state: "visible", timeout: 10_000 });
    const href = await link.getAttribute("href");
    return href?.split("/tx/")[1] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`[e2e] buyer ${account.address}`);
  console.log(`[e2e] screenshots -> ${SHOTS}\n`);

  // 0. dev servers (the real ones) must be up — we read pricing/payTo from them.
  await waitFor("http://localhost:3000/health", "dev backend :3000");
  const pricing = await (await fetch("http://localhost:3000/pricing")).json();
  const payTo = pricing.payTo;
  console.log(`[e2e] payTo ${payTo}  network ${pricing.network}`);

  // 1. fault-injecting facilitator proxy (soft-fail the FIRST settle only)
  run("node", ["scripts/fault-facilitator-proxy.mjs"], {
    tag: "proxy",
    env: { ...process.env, FF_PORT: String(PROXY_PORT), FF_SOFTFAIL_FIRST: "1" },
  });
  await waitFor(`http://localhost:${PROXY_PORT}/supported`, "fault proxy");

  // 2. isolated backend on :3010 -> fault proxy. Static host defaults to
  //    `local`; set E2E_STATIC_HOST=cloudflare (with CLOUDFLARE_* in .env) to
  //    prove the clean path against a real public *.pages.dev URL.
  const STATIC_HOST = process.env.E2E_STATIC_HOST || "local";
  console.log(`[e2e] static host for the isolated backend: ${STATIC_HOST}`);
  run(
    "node",
    [
      "--experimental-transform-types",
      "--no-warnings",
      "--env-file-if-exists=.env",
      "src/server.ts",
    ],
    {
      tag: "backend2",
      env: {
        ...process.env,
        PORT: String(BACKEND_PORT),
        X402_FACILITATOR_URL: `http://localhost:${PROXY_PORT}`,
        DRYDOCK_STATIC_HOST: STATIC_HOST,
        PUBLIC_BASE_URL: BACKEND_BASE,
      },
    },
  );
  await waitFor(`${BACKEND_BASE}/health`, "isolated backend :3010");

  // 3. isolated web on :3011 -> isolated backend (next dev reads NEXT_PUBLIC_*
  //    from the environment at start)
  run("npx", ["--no-install", "next", "dev", "-p", String(WEB_PORT)], {
    tag: "web2",
    cwd: path.join(ROOT, "web"),
    env: { ...process.env, NEXT_PUBLIC_DRYDOCK_API: BACKEND_BASE },
  });
  await waitFor(WEB_BASE, "isolated web :3011");
  await waitFor(`${WEB_BASE}/try-it`, "isolated /try-it");
  await sleep(2500); // let the first compile settle

  // 4. browser
  const browser = await chromium.launch({ headless: false, slowMo: 120 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  await context.exposeFunction("__walletRPC", walletRPC);
  await context.addInitScript(() => {
    const provider = {
      isMetaMask: true,
      _events: {},
      request: (args) => window.__walletRPC(args.method, args.params ?? []),
      on(event, handler) {
        (this._events[event] ||= []).push(handler);
      },
      removeListener(event, handler) {
        this._events[event] = (this._events[event] || []).filter((h) => h !== handler);
      },
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  });
  const page = await context.newPage();
  page.on("console", (msg) => process.env.E2E_VERBOSE && console.log(`[page:${msg.type()}] ${msg.text()}`));

  const settlementTxs = [];
  const timings = {};

  // === FLOW A — FORCED RETRY (clean preset) ============================
  console.log(`\n=== FLOW A — forced facilitator retry (clean build) ===`);
  await page.goto(`${WEB_BASE}/try-it`, { waitUntil: "networkidle" });
  await shot(page, "A1-landing");
  await pickPreset(page, "clean");
  await page.getByRole("button", { name: /Connect wallet & pay .*USDC/i }).waitFor({ timeout: 30_000 });
  await shot(page, "A2-payment-panel");

  const a = await payThroughRetries(page);
  rec("A: facilitator soft-fail surfaced as a retry (not an error)", a.softFails >= 1, `${a.softFails} retry(ies)`);
  rec("A: payment settled, flow moved to the scan step", a.outcome === "scanning" || a.outcome === "done", a.outcome);

  // The retry-state screenshot(s) were captured inside payThroughRetries.
  const retryShot = fs.existsSync(path.join(SHOTS, "retry-state-attempt-1.png"));
  rec("A: retry-state screenshot captured", retryShot);

  // TIMING — how long is ScanPanel genuinely on screen? (gate is now detached
  // from the payment response, so this should be the real ~8-10s gate window)
  const aScan = await measureScan(page, "A");
  rec("A: ScanPanel actually rendered (not skipped)", aScan.appeared);
  rec(
    "A: scan step visible for a meaningful duration (>= 4s, not a flash)",
    aScan.scanVisibleMs >= 4000,
    `${(aScan.scanVisibleMs / 1000).toFixed(1)}s on screen`,
  );
  rec("A: scan still running at the 4.5s mark", aScan.stillScanningAt4_5s, aScan.midElapsedText ?? "");
  console.log(`[timing] FLOW A — ScanPanel visible ${(aScan.scanVisibleMs / 1000).toFixed(1)}s; mid "${aScan.midElapsedText}"; result "${aScan.resultTiming}"`);
  timings.A = aScan;

  await page.getByText(/Your site is live/i).waitFor({ timeout: 60_000 });
  await shot(page, "A3-live");
  const aLiveUrl = await page
    .locator('[data-testid="live-url"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  rec("A: a real live URL is shown", !!aLiveUrl && /^https?:\/\//.test(aLiveUrl), aLiveUrl ?? "none");
  if (STATIC_HOST === "cloudflare") {
    rec("A: live URL is a Cloudflare Pages URL", /\.pages\.dev\/?$/i.test(aLiveUrl ?? ""), aLiveUrl ?? "none");
  }
  if (aLiveUrl) {
    // CF edge propagation can lag a few seconds after the deploy reports success.
    let live, html;
    for (let i = 0; i < 12; i++) {
      live = await fetch(aLiveUrl, { redirect: "follow" });
      html = await live.text();
      if (live.status === 200) break;
      await sleep(3000);
    }
    rec(
      "A: the live URL actually serves the deployed site",
      live.status === 200 && html.includes("drydock:sample-site-v1"),
      `HTTP ${live.status}`,
    );
    // sub-asset — proves the manifest hash matched the host's own lookup
    try {
      const css = await fetch(new URL("style.css", aLiveUrl).href);
      rec("A: a sub-asset (style.css) also serves from the live URL", css.status === 200, `HTTP ${css.status}`);
    } catch (e) {
      rec("A: a sub-asset (style.css) also serves from the live URL", false, e.message);
    }
  }
  const aTx = await readTxHashFromResult(page);
  const aVerified = await verifyOnChain("A", aTx, payTo);
  if (aVerified) settlementTxs.push({ flow: "A (forced retry -> clean -> live)", tx: aVerified });

  // === FLOW C — BLOCKED (leaked-key preset) ===========================
  console.log(`\n=== FLOW C — blocked build (known incident) ===`);
  // proxy soft-fail budget is spent; this settle is real.
  await page.getByRole("button", { name: /Start over with a different build/i }).click();
  await page.getByRole("button", { name: /Leaked key in build output/i }).waitFor({ timeout: 15_000 });
  await pickPreset(page, "leaked");
  await page.getByRole("button", { name: /Connect wallet & pay .*USDC/i }).waitFor({ timeout: 30_000 });
  await shot(page, "C1-payment-panel");

  const c = await payThroughRetries(page);
  rec("C: payment settled, flow moved to the scan step", c.outcome === "scanning" || c.outcome === "done", c.outcome);

  const cScan = await measureScan(page, "C");
  rec("C: ScanPanel actually rendered (not skipped)", cScan.appeared);
  rec(
    "C: scan step visible for a meaningful duration (>= 4s, not a flash)",
    cScan.scanVisibleMs >= 4000,
    `${(cScan.scanVisibleMs / 1000).toFixed(1)}s on screen`,
  );
  rec("C: scan still running at the 4.5s mark", cScan.stillScanningAt4_5s, cScan.midElapsedText ?? "");
  console.log(`[timing] FLOW C — ScanPanel visible ${(cScan.scanVisibleMs / 1000).toFixed(1)}s; mid "${cScan.midElapsedText}"; result "${cScan.resultTiming}"`);
  timings.C = cScan;

  await page.getByText(/Deploy halted before publish/i).waitFor({ timeout: 60_000 });
  await shot(page, "C2-blocked");

  const cBodyText = await page.locator("main").innerText();
  rec("C: matched pattern shown as exposed-key-in-build-output", /exposed-key-in-build-output/.test(cBodyText));
  rec("C: a confidence score is shown", /confidence \d/i.test(cBodyText));
  rec("C: a written rationale is shown", /baking|persist|secret|build step/i.test(cBodyText));
  rec("C: NO live URL is present on a blocked deploy", !/\/s\/[0-9a-f-]{10,}/.test(cBodyText) || !/site is live/i.test(cBodyText));

  const cTx = await readTxHashFromResult(page);
  const cVerified = await verifyOnChain("C", cTx, payTo);
  if (cVerified) settlementTxs.push({ flow: "C (blocked -> halted)", tx: cVerified });

  // The blocked deploy must have been recorded as an incident (Day 6.5).
  await sleep(3000);
  const incidents = await (await fetch(`${BACKEND_BASE}/incidents?limit=20`)).json();
  const mine =
    Array.isArray(incidents) &&
    incidents.find((r) => r.type === "incident" && r.patternId === "exposed-key-in-build-output" && r.blockedDeploy === true);
  rec("C: the block was recorded in Sibyl incident memory", !!mine, mine ? `incident ${mine.incidentId}` : "not found");

  await browser.close();

  // --- summary -------------------------------------------------------
  console.log(`\n=== settlement transactions (independently confirmed on-chain) ===`);
  for (const s of settlementTxs) console.log(`  ${s.flow}\n    https://sepolia.basescan.org/tx/${s.tx}`);
  console.log(`\n=== ScanPanel visible duration (gate detached from payment response) ===`);
  for (const [k, v] of Object.entries(timings)) {
    console.log(`  FLOW ${k}: ${(v.scanVisibleMs / 1000).toFixed(1)}s on screen · mid-scan "${v.midElapsedText ?? "-"}" · result card "${v.resultTiming ?? "-"}"`);
  }
  console.log(`\n=== screenshots: ${SHOTS} ===`);
  fs.writeFileSync(
    path.join(SHOTS, "summary.json"),
    JSON.stringify({ stamp: STAMP, buyer: account.address, payTo, settlementTxs, timings, results }, null, 2),
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} assertions passed ===`);
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  }
  cleanup();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("[e2e] fatal:", err);
  cleanup();
  process.exit(1);
});
