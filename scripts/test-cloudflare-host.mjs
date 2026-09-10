#!/usr/bin/env node
// Focused test for CloudflarePagesStaticHost (src/deploy/hosts.ts) — a REAL
// deploy of ./sample-site to Cloudflare Pages via the direct-upload API, then
// an independent fetch of the returned URL. No Drydock pipeline, no payment —
// just "does the host publish a working public site". Run this first when
// wiring Cloudflare; the full browser e2e (scripts/e2e-tryit-browser.mjs)
// exercises it end-to-end after.
//
// Preconditions: CLOUDFLARE_API_TOKEN (scope: Account > Cloudflare Pages >
// Edit) and CLOUDFLARE_ACCOUNT_ID set (see .env / .env.example).
//
// Usage:
//   node --experimental-transform-types --no-warnings --env-file-if-exists=.env \
//     scripts/test-cloudflare-host.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CloudflarePagesStaticHost } from "../src/deploy/hosts.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
// A FIXED project for the standalone test (re-deploys to the same one, no
// project proliferation). The real pipeline defaults to project-per-deploy.
const PROJECT = process.env.CLOUDFLARE_PAGES_PROJECT || "drydock-hosttest";

if (!TOKEN || !ACCOUNT) {
  console.error("Missing CLOUDFLARE_API_TOKEN and/or CLOUDFLARE_ACCOUNT_ID — see .env.example.");
  process.exit(1);
}

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};

async function main() {
  const siteDir = path.join(ROOT, "sample-site");
  const deployId = `hosttest-${Date.now().toString(36)}`;
  console.log(`[test] deploying ${siteDir} to Cloudflare Pages project "${PROJECT}" (account ${ACCOUNT.slice(0, 8)}…)\n`);

  const host = new CloudflarePagesStaticHost(TOKEN, ACCOUNT, PROJECT);

  const t0 = Date.now();
  let site;
  try {
    site = await host.deploy(deployId, siteDir, fs.readFileSync(path.join(ROOT, "web/public/presets/clean.zip")));
  } catch (err) {
    rec("host.deploy() completes without throwing", false, err?.message ?? String(err));
    return finish();
  }
  console.log(`[test] deployed in ${((Date.now() - t0) / 1000).toFixed(1)}s ->`, JSON.stringify(site, null, 2));

  rec("host name is 'cloudflare'", site.host === "cloudflare");
  rec("returned URL is https://<project>.pages.dev", /^https:\/\/[a-z0-9-]+\.pages\.dev\/?$/i.test(site.url), site.url);
  rec("meta carries the deployment id", typeof site.meta?.deploymentId === "string");

  // Independent fetch — the real evidentiary bar. Pages can take a few seconds
  // to propagate the new deployment to the edge.
  let ok = false;
  let html = "";
  for (let i = 0; i < 15; i++) {
    try {
      const res = await fetch(site.url, { redirect: "follow" });
      html = await res.text();
      if (res.status === 200) {
        ok = true;
        break;
      }
      console.log(`[test] fetch attempt ${i + 1}: HTTP ${res.status}`);
    } catch (e) {
      console.log(`[test] fetch attempt ${i + 1}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  rec("the live URL returns HTTP 200", ok);
  rec("the live URL serves the real sample-site HTML", html.includes("drydock:sample-site-v1"), html.slice(0, 80));

  // The per-file asset too (proves the manifest hash matched CF's own lookup).
  try {
    const cssRes = await fetch(new URL("style.css", site.url).href);
    rec("a sub-asset (style.css) also serves", cssRes.status === 200, `HTTP ${cssRes.status}`);
  } catch (e) {
    rec("a sub-asset (style.css) also serves", false, e.message);
  }

  console.log(`\n[test] LIVE: ${site.url}`);
  finish();
}

function finish() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} assertions passed ===`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("[test] fatal:", e);
  process.exit(1);
});
