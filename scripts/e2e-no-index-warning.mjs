#!/usr/bin/env node
// Pre-upload "no index.html at the root" warning — the gap between "live" and
// "404" that the Aurex deploys fell into. The backend now reports
// `hasRootIndex` on POST /deploy; /try-it's Build-ready card shows a
// prominent, DISMISSIBLE warning (it does not block payment).
//
//   1. folder with NO root index.html  -> warning shown on the ready card,
//      dismiss removes it, "Continue to payment" still works
//   2. folder WITH a root index.html   -> no warning
//   3. double-wrapped folder (index.html one level down) -> warning names the
//      nested path
//
// Usage: node scripts/e2e-no-index-warning.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { makeNoIndexSite } from "./lib/make-sample-site.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = process.env.WEB_BASE ?? "http://localhost:3001";
const SCRATCH = path.join(ROOT, "scratchpad-noindex");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SHOTS = path.join(ROOT, "docs", "evidence", `no-index-warning-${STAMP}`);
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const rec = (n, p, d) => {
  results.push({ n, p });
  console.log(`${p ? "PASS" : "FAIL"} — ${n}${d ? ` (${d})` : ""}`);
};

const noIndex = makeNoIndexSite(path.join(SCRATCH, "no-index"));
// a small valid site WITH a root index.html
fs.mkdirSync(path.join(SCRATCH, "with-index"), { recursive: true });
fs.writeFileSync(path.join(SCRATCH, "with-index", "index.html"), "<!doctype html><title>ok</title><h1>ok</h1>\n");
fs.writeFileSync(path.join(SCRATCH, "with-index", "style.css"), "body{}\n");
const withIndex = { dir: path.join(SCRATCH, "with-index") };
// double-wrapped: a site folder zipped inside a parent dir
fs.mkdirSync(path.join(SCRATCH, "wrapped", "mysite"), { recursive: true });
fs.writeFileSync(path.join(SCRATCH, "wrapped", "mysite", "index.html"), "<h1>hi</h1>\n");
fs.writeFileSync(path.join(SCRATCH, "wrapped", "mysite", "style.css"), "body{}\n");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

async function pickAndWait(dir) {
  await page.goto(`${WEB}/try-it`, { waitUntil: "networkidle" });
  await page.getByText(/Drop a site folder/i).waitFor({ timeout: 15_000 });
  await page.locator('input[type="file"][webkitdirectory]').setInputFiles(dir);
  await page.getByText(/Build ready/i).waitFor({ timeout: 30_000 });
}

// --- 1. no root index.html ---
console.log("\n=== 1 — folder with NO root index.html ===");
await pickAndWait(noIndex.dir);
const warn = page.getByTestId("no-index-warning");
await warn.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
rec("warning is shown on the Build-ready card", await warn.isVisible());
const warnText = await warn.innerText().catch(() => "");
rec("warning text names index.html + built output", /index\.html/.test(warnText) && /dist\/|build\//.test(warnText));
await page.screenshot({ path: path.join(SHOTS, "1-warning.png"), fullPage: true });

// dismiss
await warn.getByRole("button", { name: /Dismiss/i }).click();
await page.waitForTimeout(300);
rec("warning is dismissible", !(await warn.isVisible().catch(() => false)));

// continue still works (not blocked)
await page.getByTestId("continue-to-payment").click();
await page.getByRole("button", { name: /Connect wallet & pay/i }).waitFor({ timeout: 10_000 });
rec("Continue to payment still works after the warning (not blocked)", true);
await page.screenshot({ path: path.join(SHOTS, "1-continued.png"), fullPage: true });

// --- 2. has root index.html ---
console.log("\n=== 2 — folder WITH a root index.html ===");
await pickAndWait(withIndex.dir);
await page.waitForTimeout(500);
rec("no warning when a root index.html is present", !(await page.getByTestId("no-index-warning").isVisible().catch(() => false)));

// --- 3. double-wrapped ---
console.log("\n=== 3 — double-wrapped folder (index.html one level down) ===");
await pickAndWait(path.join(SCRATCH, "wrapped"));
const warn3 = page.getByTestId("no-index-warning");
const shown3 = await warn3.isVisible().catch(() => false);
rec("warning shown for double-wrapped folder", shown3);
if (shown3) {
  const t3 = await warn3.innerText();
  rec("warning names the nested index.html path", /mysite\/index\.html|mysite\//.test(t3), t3.match(/mysite\S*/)?.[0]);
  await page.screenshot({ path: path.join(SHOTS, "3-wrapped-warning.png"), fullPage: true });
}

rec("no uncaught page errors", pageErrors.length === 0, pageErrors[0] ?? "");

await browser.close();
fs.rmSync(SCRATCH, { recursive: true, force: true });

const failed = results.filter((r) => !r.p);
fs.writeFileSync(path.join(SHOTS, "summary.json"), JSON.stringify({ results }, null, 2));
console.log(`\n=== ${results.length - failed.length}/${results.length} assertions passed ===`);
console.log(`screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
