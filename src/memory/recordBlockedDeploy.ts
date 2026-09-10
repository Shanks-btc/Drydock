/**
 * Day 6.5 — bridge the deploy gate to the incident write path.
 *
 * When the Day 6 gate blocks a deploy, that IS an incident: a build carrying
 * a known failure signal was stopped before publish. This turns the gate's
 * `GateResult` into an `IncidentPayload` and records it via §6, so the
 * incident-memory activity log (`GET /incidents`) shows real gate activity
 * rather than only Day 4-5 test data.
 *
 * This is trusted internal server code reacting to its own gate — not an
 * externally-callable "file an incident" API — so `recordIncident`'s
 * `assertAuthorized` no-op stays correct here (the threat it guards, an
 * outsider probing which incident_ids exist, doesn't apply).
 *
 * Drydock's zip-upload pipeline has no git metadata, so the incident's
 * `build` fingerprint is derived from the deploy id. The reasoning step
 * doesn't return which file matched, so the locator is synthetic
 * (`deploy/<id>#gate.<pattern_id>`) — honest about being deploy-scoped, not
 * a fake file:line.
 */
import type { GateResult } from "./deployGate.ts";
import { recordIncident, type RecordOutcome } from "./incidentRecorder.ts";
import type { FailureRef } from "./identity.ts";
import * as sibyl from "./sibylBridge.ts";

const SEVERITIES: FailureRef["severity"][] = ["low", "med", "high", "critical"];

export async function recordBlockedDeployAsIncident(
  deployId: string,
  gate: GateResult,
): Promise<{ outcome: RecordOutcome["outcome"]; eventId: string | null }> {
  const match = gate.topMatch;
  if (!match) throw new Error("recordBlockedDeployAsIncident called with no topMatch");

  // Pull severity_default from the pattern's REFERENCE anchor; fall back to
  // "high" (a build blocked for carrying a credential-shaped signal is not
  // a low-severity event by default).
  let severity: FailureRef["severity"] = "high";
  try {
    const ref = await sibyl.getReference(`pattern/${match.pattern_id}`);
    const body = ref ? (typeof ref.body === "string" ? JSON.parse(ref.body) : ref.body) : null;
    if (body && SEVERITIES.includes(body.severity_default)) severity = body.severity_default;
  } catch {
    // keep the fallback — the block already stands, severity is cosmetic here
  }

  const now = new Date().toISOString();
  const locator = `deploy/${deployId}#gate.${match.pattern_id}`;

  const result = await recordIncident({
    patternId: match.pattern_id,
    build: {
      commit: deployId,
      branch: "unknown",
      target: "unknown",
      build_number: deployId,
      built_at: now,
    },
    scanner: { name: "drydock-gate", version: "0.6" },
    inputs: gate.scannedFiles,
    failure: {
      summary: `Deploy ${deployId.slice(0, 8)} blocked: build matched ${match.pattern_id}`,
      locator,
      severity,
      // Deterministic (hashed as content_hash) — stable for a given deploy +
      // pattern, so a re-fired settlement hook re-derives the same incident_id.
      signal: `gate blocked deploy ${deployId} against ${match.pattern_id}; ${gate.scannedFiles.length} file(s) scanned: ${gate.scannedFiles.join(", ")}`,
      matchRationale: match.rationale,
      matchConfidence: match.confidence,
      blockedDeploy: true,
    },
    forward: { status: "open" },
    ts: now,
  });

  const eventId =
    result.outcome === "collision" ? result.quarantineEventId : result.eventId;
  return { outcome: result.outcome, eventId: eventId ?? null };
}
