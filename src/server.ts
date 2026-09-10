/**
 * Drydock - backend.
 *
 *   POST /deploy              (zip of a folder)  -> deploy record, awaiting payment
 *   POST /deploy/:id/redeploy                    -> new deploy from a prior one's zip (Day 6.5)
 *   GET  /deploy/:id/pay      (x402-gated)       -> pay the flat fee
 *   onAfterSettle (success)   -> markPaid -> memory-check gate (Day 6) ->
 *                                clean: publish | blocked: halt + record incident (Day 6.5)
 *   GET  /deploy / GET /deploy/:id               -> poll for the live URL / gate verdict
 *   GET  /patterns / GET /incidents              -> Sibyl incident-memory reads (Day 6.5)
 *
 * No ownership recording yet. Sibyl integration is the memory-check gate +
 * incident log; see docs/architecture.md and docs/plan.md.
 */

import path from "node:path";
import express from "express";
import cors from "cors";

import {
  deployPaymentMiddleware,
  resourceServer,
  paymentConfigSummary,
  DEPLOY_FEE_USDC,
} from "./payment.ts";
import { DeployPipeline } from "./deploy/pipeline.ts";
import { selectStaticHost } from "./deploy/hosts.ts";
import { wireDeployOnSettlement } from "./deploy/settlement.ts";
import * as sibyl from "./memory/sibylBridge.ts";

const CWD = process.cwd();
// Retained deploy artifacts (src.zip per deploy) — the redeploy feature reads
// these back off disk. In production this must point at a persistent volume;
// on Railway set DRYDOCK_DEPLOYS_ROOT to a path under the mounted volume.
const DEPLOYS_ROOT = process.env.DRYDOCK_DEPLOYS_ROOT ?? path.join(CWD, "deploys");
const SITES_ROOT = process.env.DRYDOCK_SITES_ROOT ?? path.join(CWD, "public_sites");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

const pipeline = new DeployPipeline(DEPLOYS_ROOT);
const staticHost = selectStaticHost(
  { ...process.env, PUBLIC_BASE_URL, DRYDOCK_SITES_ROOT: SITES_ROOT },
  SITES_ROOT,
);
wireDeployOnSettlement(resourceServer, pipeline, staticHost);

const app = express();
app.use(cors({ exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"] }));
// JSON parsing for any future body routes; harmless to the zip upload
// (that route declares its own application/zip raw parser).
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/pricing", (_req, res) => {
  res.status(200).json({
    deployFeeUsdc: DEPLOY_FEE_USDC,
    staticHost: staticHost.name,
    ...paymentConfigSummary(),
  });
});

// Serve locally-hosted deploys (LocalStaticHost writes here).
app.use("/s", express.static(SITES_ROOT, { index: "index.html", extensions: ["html"] }));

// --- Deploy pipeline routes ------------------------------------------------

// Upload a site as a zip of its folder. `express.raw` gives us the bytes.
app.post("/deploy", express.raw({ type: ["application/zip", "application/octet-stream"], limit: "50mb" }), (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({ error: "POST the site as a zip body with Content-Type: application/zip" });
    return;
  }
  try {
    const rec = pipeline.createDeploy(body);
    res.status(201).json({
      deployId: rec.id,
      state: rec.state,
      fileCount: rec.fileCount,
      hasRootIndex: rec.hasRootIndex,
      indexHint: rec.indexHint ?? null,
      payUrl: `/deploy/${rec.id}/pay`,
      statusUrl: `/deploy/${rec.id}`,
      feeUsdc: DEPLOY_FEE_USDC,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/deploy", (_req, res) => {
  res.json(pipeline.list().map(publicRecord));
});

// Re-trigger a prior deploy from its retained zip (Day 6.5 — dashboard
// repeat-deploy widget). New deploy is awaiting_payment; flows through
// payment + gate again. Registered BEFORE deployPaymentMiddleware — not
// payment-gated itself.
app.post("/deploy/:id/redeploy", (req, res) => {
  try {
    const rec = pipeline.redeploy(req.params.id);
    res.status(201).json({
      deployId: rec.id,
      state: rec.state,
      fileCount: rec.fileCount,
      hasRootIndex: rec.hasRootIndex,
      indexHint: rec.indexHint ?? null,
      redeployOf: rec.redeployOf,
      payUrl: `/deploy/${rec.id}/pay`,
      statusUrl: `/deploy/${rec.id}`,
      feeUsdc: DEPLOY_FEE_USDC,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes("unknown deploy") ? 404 : 400).json({ error: msg });
  }
});

app.get("/deploy/:id", (req, res) => {
  const rec = pipeline.get(req.params.id);
  if (!rec) {
    res.status(404).json({ error: "unknown deploy" });
    return;
  }
  res.json(publicRecord(rec));
});

// --- Sibyl incident-memory reads (Day 6.5 — dashboard) --------------------

// Known failure patterns: the WARM `failure-pattern` rollups, joined with
// each pattern's REFERENCE anchor for a human title + the mechanism prose.
app.get("/patterns", async (_req, res) => {
  try {
    const rows = await sibyl.listEntities("failure-pattern");
    const patterns = await Promise.all(
      rows.map(async (row) => {
        const b = (row.body ?? {}) as Record<string, any>;
        let title = row.name;
        let mechanism: string | null = null;
        try {
          const ref = await sibyl.getReference(b.reference_key ?? `pattern/${row.name}`);
          const refBody = ref ? (typeof ref.body === "string" ? JSON.parse(ref.body) : ref.body) : null;
          if (refBody?.title) title = refBody.title;
          if (refBody?.detection?.mechanism) mechanism = refBody.detection.mechanism;
        } catch {
          /* rollup still returns; the anchor join is best-effort */
        }
        return {
          patternId: row.name,
          title,
          mechanism,
          status: row.status,
          incidentCount: b.incident_count ?? 0,
          openIncidentIds: b.open_incident_ids ?? [],
          resolvedIncidentIds: b.resolved_incident_ids ?? [],
          severityCeiling: b.severity_ceiling ?? null,
          firstSeenTs: b.first_seen_ts ?? null,
          lastSeenTs: b.last_seen_ts ?? null,
          statusNote: b.status_note ?? null,
          referenceKey: b.reference_key ?? `pattern/${row.name}`,
        };
      }),
    );
    res.json(patterns);
  } catch (err) {
    res.status(502).json({ error: `sibyl unavailable: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// Incident-memory activity log: recent COLD journal events, newest first.
app.get("/incidents", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  try {
    const events = await sibyl.readEvents({ limit });
    const incidents = events.map((ev: any) => {
      const extra = ev.extra ?? {};
      const acted = ev.acted ?? {};
      const isCollision = acted.kind === "incident-id-collision" || extra.quarantine === true;
      return {
        type: isCollision ? "collision" : "incident",
        eventId: ev.id,
        ts: ev.ts,
        incidentId: extra.incident_id ?? null,
        patternId: extra.pattern_id ?? (isCollision ? null : acted.kind ?? null),
        summary: acted.summary ?? (isCollision ? "content-hash collision — quarantined" : null),
        severity: acted.severity ?? null,
        locator: acted.locator ?? null,
        blockedDeploy: acted.blocked_deploy ?? null,
        status: ev.forward?.status ?? null,
        matchConfidence: acted.evidence?.match_confidence ?? null,
        matchRationale: acted.evidence?.match_rationale ?? null,
      };
    });
    res.json(incidents);
  } catch (err) {
    res.status(502).json({ error: `sibyl unavailable: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// x402-gated. Registered globally; the routes config keys on
// "GET /deploy/:id/pay". Runs only after payment verifies.
app.use(deployPaymentMiddleware);

// Paid handler. Runs post-verify / pre-settle, so the deploy hasn't happened
// yet when this returns — the client polls GET /deploy/:id for the live URL.
// The actual publish is triggered from onAfterSettle (see deploy/settlement.ts).
app.get("/deploy/:id/pay", (req, res) => {
  const rec = pipeline.get(req.params.id);
  if (!rec) {
    res.status(404).json({ error: "unknown deploy" });
    return;
  }
  res.status(200).json({
    deployId: rec.id,
    paid: true,
    note: "Payment received. The publish runs on settlement — poll statusUrl for the live URL.",
    statusUrl: `/deploy/${rec.id}`,
  });
});

function publicRecord(r: import("./deploy/pipeline.ts").DeployRecord) {
  return {
    id: r.id,
    state: r.state,
    createdAt: r.createdAt,
    fileCount: r.fileCount,
    hasRootIndex: r.hasRootIndex ?? true,
    indexHint: r.indexHint ?? null,
    redeployOf: r.redeployOf ?? null,
    payerAddress: r.payerAddress ?? null,
    txHash: r.txHash ?? null,
    paidAt: r.paidAt ?? null,
    url: r.url ?? null,
    host: r.host ?? null,
    liveAt: r.liveAt ?? null,
    error: r.error ?? null,
    // Day 6 memory-check gate — present once the gate has run, regardless
    // of verdict (clean deploys show what was checked, not just "live").
    gate: r.gate
      ? {
          verdict: r.gate.verdict,
          checkedAt: r.gate.checkedAt,
          signalsExtracted: r.gate.signalsExtracted,
          knownPatternsChecked: r.gate.knownPatternsChecked,
          scannedFiles: r.gate.scannedFiles ?? [],
          topMatch: r.gate.topMatch,
          // Genuinely-new causes the reasoning step flagged but had no
          // pattern for. Lets the result page say "cleared the known
          // patterns, but spotted something new" instead of a bare pass.
          // Not persisted/promoted — that pipeline is still Day 6 scope.
          newPatternCandidates: r.gate.newPatternCandidates ?? [],
        }
      : null,
    blockedAt: r.blockedAt ?? null,
  };
}

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Drydock listening on http://localhost:${PORT}`);
  console.log(`static host: ${staticHost.name}`);
  console.log(`x402 deploy gate: ${JSON.stringify(paymentConfigSummary())}`);
});
