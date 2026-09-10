#!/usr/bin/env node
// Full-page screenshots of Drydock frontend routes for the build evidence
// record. Pure display pages (no wallet) — headless is fine; the point is
// capturing the REAL rendered page with REAL backend data.
//
// Usage: node scripts/shoot-pages.mjs [/route ...]   (default: /docs /dashboard)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.WEB_BASE ?? "http://localhost:3001";
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ["/docs", "/dashboard"];

const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join(ROOT, "docs", "evidence", `pages-${STAMP}`);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  const t = m.text().trim();
  // ignore benign noise: favicon 404s, resource 404s with no useful text
  if (m.type() === "error" && t && !/favicon|Failed to load resource/i.test(t)) {
    problems.push(`console.error: ${t}`);
  }
});

for (const route of routes) {
  const name = route.replace(/^\//, "").replace(/\//g, "-") || "home";
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200); // scroll-reveal / IntersectionObserver settle
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`[shot] ${route} -> ${file}`);

  // also a viewport-height crop for a "clean top" shot
  await page.screenshot({ path: path.join(OUT, `${name}-top.png`) });
}

await browser.close();

if (problems.length) {
  console.log("\n⚠ page problems:");
  for (const p of [...new Set(problems)]) console.log("  " + p);
  process.exit(1);
}
console.log(`\nOK — ${OUT}`);
