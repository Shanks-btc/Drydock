#!/usr/bin/env node
// Day 7 — the dashboard's repeat-deploy widget, end-to-end through a REAL
// browser. Clicks "Deploy again" on a prior deploy, which POSTs
// /deploy/:id/redeploy, then completes the SAME payment + memory-check flow
// inline. Same evidentiary bar: real x402 settlement on Base Sepolia
// (confirmed on-chain), real gate verdict, real new deploy record carrying
// `redeployOf`.
//
// Wallet: the spike's EIP-1193 shim injected via page.exposeFunction (real
// eth_signTypedData_v4). See scripts/e2e-tryit-browser.mjs.
//
// Usage: TEST_BUYER_PRIVATE_KEY=0x... node --experimental-transform-types \
//          --env-file-if-exists=.env scripts/e2e-redeploy-widget.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http as viemHttp, getAddress, parseEventLogs, erc20Abi } from "viem";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.TEST_BUYER_PRIVATE_KEY;
if (!KEY) { console.error("Missing TEST_BUYER_PRIVATE_KEY."); process.exit(1); }
const WEB = process.env.WEB_BASE ?? "http://localhost:3001";
const API = process.env.DRYDOCK_URL ?? "http://localhost:3000";
const RPC = "https://sepolia.base.org";
const account = privateKeyToAccount(KEY);

const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SHOTS = path.join(ROOT, "docs", "evidence", `redeploy-${STAMP}`);
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const rec = (n, p, d) => { results.push({ n, p }); console.log(`${p ? "PASS" : "FAIL"} — ${n}${d ? ` (${d})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- wallet shim (Node side of window.ethereum) ---
const pass = createPublicClient({ transport: viemHttp(RPC) });
let chainHex = "0x14a34";
async function walletRPC(method, params = []) {
  switch (method) {
    case "eth_requestAccounts": case "eth_accounts": return [account.address];
    case "eth_chainId": return chainHex;
    case "net_version": return String(parseInt(chainHex, 16));
    case "wallet_switchEthereumChain": chainHex = params?.[0]?.chainId ?? chainHex; return null;
    case "wallet_addEthereumChain": return null;
    case "personal_sign": return account.signMessage({ message: { raw: params[0] } });
    case "eth_signTypedData_v4": {
      const td = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
      console.log(`[wallet] eth_signTypedData_v4 ${td.primaryType} value=${td.message?.value}`);
      return account.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message: td.message });
    }
    default: return pass.request({ method, params });
  }
}

const verify = createPublicClient({ transport: viemHttp(RPC) });
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main() {
  // 0. pick a prior deploy to repeat — prefer a blocked one (deterministic verdict).
  const deploys = await (await fetch(`${API}/deploy`)).json();
  const source = deploys.find((d) => d.state === "blocked") ?? deploys.find((d) => d.state === "live") ?? deploys[0];
  if (!source) { console.error("No deploys on the backend to repeat. Run `npm run test:gate` first."); process.exit(1); }
  const expectBlocked = source.state === "blocked";
  console.log(`[e2e] repeating deploy ${source.id} (was ${source.state})  buyer ${account.address}\n`);

  const pricing = await (await fetch(`${API}/pricing`)).json();
  const payTo = getAddress(pricing.payTo);

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
  await ctx.exposeFunction("__walletRPC", walletRPC);
  await ctx.addInitScript(() => {
    Object.defineProperty(window, "ethereum", {
      value: { isMetaMask: true, request: (a) => window.__walletRPC(a.method, a.params ?? []), on() {}, removeListener() {} },
      configurable: true,
    });
  });
  const page = await ctx.newPage();

  // 1. dashboard -> the repeat-deploy widget's row for the source deploy
  await page.goto(`${WEB}/dashboard`, { waitUntil: "networkidle" });
  const row = page.locator(`[data-testid="redeploy-row"][data-deploy-id="${source.id}"]`);
  await row.waitFor({ timeout: 15_000 });
  await row.scrollIntoViewIfNeeded();
  await row.screenshot({ path: path.join(SHOTS, "R1-source-row.png") });

  let redeployPosted = null;
  page.on("response", (r) => {
    if (r.request().method() === "POST" && /\/deploy\/[0-9a-f-]+\/redeploy$/.test(r.url())) redeployPosted = r.status();
  });
  await row.getByRole("button", { name: /Deploy again/i }).click();

  // 2. PaymentPanel for the NEW deploy
  await page.getByText(/a repeat of/i).waitFor({ timeout: 20_000 });
  rec("POST /deploy/:id/redeploy fired and returned 201", redeployPosted === 201, `status ${redeployPosted}`);
  await page.getByRole("button", { name: /Connect wallet & pay .*USDC/i }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: path.join(SHOTS, "R2-payment-panel.png"), fullPage: true });

  // grab the new deploy id from the panel ("New deploy <8> — a repeat of <8>")
  const panelText = await page.locator("main").innerText();
  const m = panelText.match(/New deploy ([0-9a-f]{8})/i);
  rec("new deploy shown as a repeat of the source", panelText.includes(source.id.slice(0, 8)));

  // 3. pay — the public facilitator soft-fails intermittently (its own nonce
  //    race); retry generously with a gap to let its pending tx clear.
  let softFails = 0;
  let paid = false;
  for (let i = 0; i < 10 && !paid; i++) {
    const btn = page.getByRole("button", { name: /pay .*USDC|Retry payment/i });
    await btn.waitFor({ state: "visible", timeout: 20_000 });
    await btn.click();
    const out = await Promise.race([
      page.getByText(/No payment was taken/i).waitFor({ timeout: 90_000 }).then(() => "retry"),
      page.getByText(/Checking the build/i).waitFor({ timeout: 90_000 }).then(() => "scan"),
      page.getByText(/Your site is live|Deploy halted before publish|publish step failed/i).waitFor({ timeout: 90_000 }).then(() => "done"),
    ]);
    if (out === "retry") { softFails++; await sleep(3500); continue; }
    paid = true;
  }
  rec("payment settled for the repeat deploy (after retries if any)", paid, `${softFails} facilitator soft-fail(s)`);
  if (!paid) { await browser.close(); return finish(); }

  const terminal = expectBlocked ? /Deploy halted before publish/i : /Your site is live/i;
  await page.getByText(terminal).waitFor({ timeout: 120_000 });
  await page.screenshot({ path: path.join(SHOTS, "R3-result.png"), fullPage: true });
  rec(`repeat deploy reached the expected terminal state (${expectBlocked ? "blocked" : "live"})`, true);

  // 4. tx from the result card
  const txHref = await page.locator('a[href*="basescan.org/tx/"]').first().getAttribute("href").catch(() => null);
  const txHash = txHref?.split("/tx/")[1] ?? null;
  rec("settlement tx shown", /^0x[0-9a-f]{64}$/i.test(txHash ?? ""), txHash ?? "none");

  await browser.close();

  // 5. the NEW deploy record — via the API, independent of the page
  const all = await (await fetch(`${API}/deploy`)).json();
  const fresh = all.find((d) => d.redeployOf === source.id);
  rec("a new deploy record exists with redeployOf === source", !!fresh, fresh ? fresh.id : "not found");
  if (fresh) {
    rec("new deploy carries a settlement txHash", /^0x[0-9a-f]{64}$/i.test(fresh.txHash ?? ""), fresh.txHash ?? "");
    rec("new deploy state matches the source's verdict", fresh.state === source.state, `${fresh.state} vs ${source.state}`);
    rec("tx on the page matches the tx on the record", !txHash || txHash.toLowerCase() === (fresh.txHash ?? "").toLowerCase());
  }

  // 6. on-chain
  const chainTx = txHash ?? fresh?.txHash;
  if (chainTx) {
    let r = null;
    for (let i = 0; i < 25; i++) { try { r = await verify.getTransactionReceipt({ hash: chainTx }); if (r) break; } catch {} await sleep(2000); }
    rec("settlement tx is on-chain", !!r, chainTx);
    if (r) {
      rec("tx status success", r.status === "success");
      const t = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: r.logs })[0];
      rec("USDC Transfer buyer -> seller 0.01", !!t && getAddress(t.args.from) === getAddress(account.address) && getAddress(t.args.to) === payTo && String(t.args.value) === "10000");
      console.log(`\n[verify] https://sepolia.basescan.org/tx/${chainTx}  block ${r.blockNumber} ${r.status}`);
    }
  }

  finish({ source: source.id, newDeploy: fresh?.id, txHash: chainTx });
}

function finish(extra = {}) {
  const failed = results.filter((x) => !x.p);
  fs.writeFileSync(path.join(SHOTS, "summary.json"), JSON.stringify({ ...extra, results }, null, 2));
  console.log(`\n=== ${results.length - failed.length}/${results.length} assertions passed ===`);
  console.log(`screenshots: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("[e2e] fatal:", e); process.exit(1); });
