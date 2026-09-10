#!/usr/bin/env node
// Day 6.5 — the /dashboard backend gap: GET /patterns, GET /incidents,
// POST /deploy/:id/redeploy. Shape + behavior checks against the running
// server. No payment needed (redeploy only creates the awaiting_payment
// record; full pay-through is covered by test:gate).
//
// Usage: npm run test:dashboard   (server must be running)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const DRYDOCK_URL = (process.env.DRYDOCK_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};

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
  console.log(`[harness] target ${DRYDOCK_URL}\n`);

  // --- GET /patterns -----------------------------------------------------
  const pRes = await fetch(`${DRYDOCK_URL}/patterns`);
  const patterns = await pRes.json();
  console.log("[patterns]", JSON.stringify(patterns, null, 2));
  rec("GET /patterns returns 200", pRes.status === 200, `got ${pRes.status}`);
  rec("GET /patterns returns an array", Array.isArray(patterns));
  rec(
    "at least one known pattern exists (from prior test runs)",
    Array.isArray(patterns) && patterns.length >= 1,
    `got ${patterns.length}`,
  );
  const known = Array.isArray(patterns) ? patterns.find((p) => p.patternId === "exposed-key-in-build-output") : null;
  rec("exposed-key-in-build-output is in the list", !!known);
  if (known) {
    rec("pattern row has a human title joined from the REFERENCE anchor", typeof known.title === "string" && known.title.length > 0);
    rec("pattern row has the mechanism prose", typeof known.mechanism === "string" && known.mechanism.length > 20);
    rec("pattern row has a numeric incidentCount", typeof known.incidentCount === "number");
    rec("pattern row has severityCeiling", "severityCeiling" in known);
  }

  // --- GET /incidents --------------------------------------------------
  const iRes = await fetch(`${DRYDOCK_URL}/incidents?limit=100`);
  const incidents = await iRes.json();
  console.log(`\n[incidents] ${Array.isArray(incidents) ? incidents.length : "?"} rows; first 3:`);
  console.log(JSON.stringify(Array.isArray(incidents) ? incidents.slice(0, 3) : incidents, null, 2));
  rec("GET /incidents returns 200", iRes.status === 200, `got ${iRes.status}`);
  rec("GET /incidents returns an array", Array.isArray(incidents));
  rec("at least one incident recorded (from prior test runs)", Array.isArray(incidents) && incidents.length >= 1, `got ${incidents.length}`);
  if (Array.isArray(incidents) && incidents.length) {
    const row = incidents[0];
    rec("incident row has a type discriminator (incident|collision)", ["incident", "collision"].includes(row.type), `got ${row.type}`);
    rec("incident row has eventId + ts", !!row.eventId && !!row.ts);
    rec("incidents are newest-first", incidents.every((r2, k) => k === 0 || incidents[k - 1].ts >= r2.ts));
  }
  const limited = await (await fetch(`${DRYDOCK_URL}/incidents?limit=3`)).json();
  rec("GET /incidents?limit=3 caps the result", Array.isArray(limited) && limited.length <= 3, `got ${limited.length}`);

  // --- POST /deploy/:id/redeploy -------------------------------------
  const zipBytes = zipDir(path.join(ROOT, "sample-site"));
  const created = await (
    await fetch(`${DRYDOCK_URL}/deploy`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: zipBytes })
  ).json();
  rec("seed: POST /deploy created a deploy to re-trigger", !!created.deployId);

  const reRes = await fetch(`${DRYDOCK_URL}/deploy/${created.deployId}/redeploy`, { method: "POST" });
  const redeployed = await reRes.json();
  console.log("\n[redeploy]", JSON.stringify(redeployed));
  rec("POST /deploy/:id/redeploy returns 201", reRes.status === 201, `got ${reRes.status}`);
  rec("redeploy produced a NEW deploy id", redeployed.deployId && redeployed.deployId !== created.deployId);
  rec("redeploy record points back via redeployOf", redeployed.redeployOf === created.deployId);
  rec("redeploy is awaiting_payment", redeployed.state === "awaiting_payment", `got ${redeployed.state}`);
  rec("redeploy carried the same fileCount", redeployed.fileCount === created.fileCount, `got ${redeployed.fileCount} vs ${created.fileCount}`);

  const fetched = await (await fetch(`${DRYDOCK_URL}${redeployed.statusUrl}`)).json();
  rec("GET /deploy/:id exposes redeployOf", fetched.redeployOf === created.deployId);

  const bogus = await fetch(`${DRYDOCK_URL}/deploy/00000000-0000-0000-0000-000000000000/redeploy`, { method: "POST" });
  rec("redeploy of an unknown (but well-formed) id returns 404", bogus.status === 404, `got ${bogus.status}`);
  const malformed = await fetch(`${DRYDOCK_URL}/deploy/not-a-uuid/redeploy`, { method: "POST" });
  rec("redeploy of a malformed id returns 400", malformed.status === 400, `got ${malformed.status}`);

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
