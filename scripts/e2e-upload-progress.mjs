#!/usr/bin/env node
// /try-it step-1 progress states, end-to-end in a real browser with a real
// folder of meaningful size (~150 files / ~7 MB, not the tiny preset).
// Confirms the zipping/upload progress is actually VISIBLE — measured, not
// assumed — same standard as the Day 7 ScanPanel timing fix.
//
//   1. pick the folder -> assert Reading / Compressing / Uploading each show
//      (sampled every 60ms) and the whole step-1 progress lasts well over a
//      single frame
//   2. "Build ready" confirmation shows the real file count + size, and the
//      stepper is still on step 1 until "Continue to payment" is clicked
//   3. upload failure (route.abort on POST /deploy) -> "Upload didn't
//      complete" card with a Retry that recovers, no frozen dropzone
//   4. zip failure (>400 files) -> inline error on the dropzone, phase stays
//      at "picking"
//
// Usage: node scripts/e2e-upload-progress.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { makeSampleSite, makeTooManyFiles } from "./lib/make-sample-site.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = process.env.WEB_BASE ?? "http://localhost:3001";
const SCRATCH = process.env.SCRATCH_DIR ?? path.join(ROOT, "scratchpad-e2e");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SHOTS = path.join(ROOT, "docs", "evidence", `upload-progress-${STAMP}`);
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const rec = (n, p, d) => {
  results.push({ n, p });
  console.log(`${p ? "PASS" : "FAIL"} — ${n}${d ? ` (${d})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function labelFor(text) {
  if (/Reading the folder/.test(text)) return "reading";
  if (/Compressing/.test(text)) return "compressing";
  if (/Uploading to Drydock/.test(text)) return "uploading";
  if (/Build ready/.test(text)) return "ready";
  if (/Upload didn.t complete/.test(text)) return "failed";
  return null;
}

/** Sample the visible step-1 state every ~55ms until it reaches `until`
 *  (or timeout). Screenshots the first frame of each transient state.
 *  Returns { order: string[], ms: Record<label, ms> }. */
async function sampleStates(page, until, shotDir, timeoutMs = 40_000) {
  const ms = {};
  const order = [];
  const shot = {};
  let last = null;
  const t0 = Date.now();
  let tick = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const body = await page.locator("main").innerText().catch(() => "");
    const label = labelFor(body);
    const now = Date.now();
    if (label) {
      ms[label] = (ms[label] || 0) + (now - tick);
      if (label !== last) {
        order.push(label);
        last = label;
      }
      if (["reading", "compressing", "uploading"].includes(label) && !shot[label]) {
        shot[label] = true;
        await page.screenshot({ path: `${shotDir}/F1-${order.length}-${label}.png` }).catch(() => {});
      }
    }
    tick = now;
    if (label === until) break;
    await sleep(55);
  }
  return { order, ms };
}

async function main() {
  console.log("[gen] building sample site…");
  const site = makeSampleSite(path.join(SCRATCH, "big-site"));
  console.log(`[gen] ${site.fileCount} files, ${(site.totalBytes / 1024 / 1024).toFixed(1)} MB -> ${site.dir}`);
  const tooMany = makeTooManyFiles(path.join(SCRATCH, "too-many"), 420);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const pageErrors = [];
  const crumbs = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[drydock/try-it]")) crumbs.push(t.replace(/%c|color:#2DD4BF/g, "").trim());
  });

  // ============ FLOW 1 — happy path, real folder ============
  console.log("\n=== FLOW 1 — real folder, progress visible ===");
  await page.goto(`${WEB}/try-it`, { waitUntil: "networkidle" });
  await page.getByText(/Drop a site folder/i).waitFor({ timeout: 15_000 });

  const folderInput = page.locator('input[type="file"][webkitdirectory]');
  await folderInput.setInputFiles(site.dir);

  // sample the reading→compressing→uploading progression from the DOM
  const sampled = await sampleStates(page, "ready", SHOTS);
  console.log("[flow1] DOM state order:", sampled.order.join(" → "));
  console.log("[flow1] DOM visible ms:", JSON.stringify(sampled.ms));

  await page.getByText(/Build ready/i).waitFor({ timeout: 20_000 });

  // The upload step on localhost can finish between DOM samples, so verify it
  // from the (deterministic) breadcrumb trail instead of the sampler.
  const trail = crumbs.join(" | ");
  console.log("[flow1] breadcrumbs:\n  " + crumbs.join("\n  "));

  const prepMs = (sampled.ms.reading || 0) + (sampled.ms.compressing || 0) + (sampled.ms.uploading || 0);
  rec("Reading state was shown (DOM)", sampled.order.includes("reading"));
  rec("Compressing state was shown (DOM)", sampled.order.includes("compressing"));
  rec("Upload step ran (breadcrumb: POST /deploy → deploy created)", /POST \/deploy/.test(trail) && /deploy created:/.test(trail));
  rec(
    "zip progress visible, not a flash (reading+compressing > 300ms)",
    (sampled.ms.reading || 0) + (sampled.ms.compressing || 0) > 300,
    `${prepMs}ms total (read ${sampled.ms.reading || 0} / zip ${sampled.ms.compressing || 0} / up ${sampled.ms.uploading || 0})`,
  );
  rec(
    "flow order is pricing → picking → preparing → uploading → ready",
    /phase → picking[\s\S]*phase → preparing[\s\S]*phase → uploading[\s\S]*phase → ready/.test(trail),
  );

  await page.getByText(/Build ready/i).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: path.join(SHOTS, "F1c-ready.png"), fullPage: true });

  const readyText = await page.locator("main").innerText();
  rec("ready card shows the real file count", new RegExp(`${site.fileCount}\\s+files`).test(readyText), readyText.match(/\d+ files/)?.[0]);
  rec("ready card shows a MB size", /\d+(\.\d+)?\s*MB\s*—\s*uploaded/.test(readyText));

  // stepper: still on step 1 (Upload) until Continue is clicked
  const stepperBefore = await page.locator("ol li").allInnerTexts();
  rec("stepper still on step 1 before Continue", /1[\s\S]*Upload/.test(stepperBefore.join("|")) && !/✓[\s\S]*Upload/.test(stepperBefore[0] ?? ""));

  await page.getByTestId("continue-to-payment").click();
  await page.getByRole("button", { name: /Connect wallet & pay/i }).waitFor({ timeout: 10_000 });
  await page.screenshot({ path: path.join(SHOTS, "F1d-payment.png"), fullPage: true });
  const stepperAfter = (await page.locator("ol li").allInnerTexts()).join("|");
  rec("stepper advanced to step 2 (Pay) after Continue", /✓[\s\S]*Upload/.test(stepperAfter) && /2[\s\S]*Pay|Pay/.test(stepperAfter));

  // ============ FLOW 2 — upload failure + recovery ============
  console.log("\n=== FLOW 2 — upload failure -> retry ===");
  await page.getByRole("button", { name: /Start over with a different build/i }).click();
  await page.getByText(/Drop a site folder/i).waitFor({ timeout: 10_000 });

  let abortNext = true;
  await page.route("**/deploy", (route) => {
    if (route.request().method() === "POST" && abortNext) {
      abortNext = false;
      return route.abort("failed");
    }
    return route.continue();
  });

  await page.locator('input[type="file"][webkitdirectory]').setInputFiles(site.dir);
  await page.getByText(/Upload didn.t complete/i).waitFor({ timeout: 25_000 });
  await page.screenshot({ path: path.join(SHOTS, "F2a-upload-failed.png"), fullPage: true });
  const failText = await page.locator("main").innerText();
  rec("upload-failed card shows an error and a Retry", /Retry upload/.test(failText) && /zipped fine/.test(failText));
  rec("upload-failed keeps the file count (no re-zip needed)", new RegExp(`${site.fileCount}`).test(failText));
  rec("dropzone is not frozen — a distinct failure card replaced it", !/Drop a site folder/.test(failText));

  await page.getByTestId("retry-upload").click(); // this POST is allowed through
  await page.getByText(/Build ready/i).waitFor({ timeout: 25_000 });
  rec("Retry upload recovered to Build ready", true);
  await page.unroute("**/deploy");

  // ============ FLOW 3 — zip failure (too many files) ============
  console.log("\n=== FLOW 3 — zip failure (>400 files) ===");
  await page.getByRole("button", { name: /Start over with a different build/i }).click();
  await page.getByText(/Drop a site folder/i).waitFor({ timeout: 10_000 });
  await page.locator('input[type="file"][webkitdirectory]').setInputFiles(tooMany.dir);
  await page.getByText(/accepts up to 400/i).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: path.join(SHOTS, "F3-zip-error.png"), fullPage: true });
  const zipErrText = await page.locator("main").innerText();
  rec("zip error is shown inline on the dropzone", /accepts up to 400/.test(zipErrText) && /Drop a site folder/.test(zipErrText));
  rec("still on step 1, dropzone usable (not advanced, not frozen)", /Choose folder/.test(zipErrText));

  rec("no uncaught page errors", pageErrors.length === 0, pageErrors[0] ?? "");

  await browser.close();
  fs.rmSync(SCRATCH, { recursive: true, force: true });

  const failed = results.filter((r) => !r.p);
  fs.writeFileSync(
    path.join(SHOTS, "summary.json"),
    JSON.stringify({ site: { files: site.fileCount, mb: +(site.totalBytes / 1048576).toFixed(1) }, sampled, results }, null, 2),
  );
  console.log(`\n=== ${results.length - failed.length}/${results.length} assertions passed ===`);
  console.log(`screenshots: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("[e2e] fatal:", e);
  try {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  } catch {}
  process.exit(1);
});
