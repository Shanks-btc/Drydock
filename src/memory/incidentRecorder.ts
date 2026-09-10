/**
 * Write path — architecture.md §6, the three-way idempotency classification
 * applied to every incident write. Uses the Sibyl bridge (§2.1: SDK,
 * in-process, not MCP) for COLD `write_event` + WARM `incident-ledger` +
 * WARM `failure-pattern` (via the pure reconciler, §7).
 *
 * No caller/ownership model exists yet (that's the payment-gate wiring,
 * Day 6) — assertAuthorized is a documented no-op today so only this one
 * function changes when that lands, per §6 step (1).
 */
import { deriveContentHash, deriveIncidentId, type BuildRef, type FailureRef } from "./identity.ts";
import { reconcilePattern, type JournalEvent } from "./reconcile.ts";
import * as sibyl from "./sibylBridge.ts";

export interface IncidentPayload {
  patternId: string;
  build: BuildRef & { built_at: string };
  scanner: { name: string; version: string };
  inputs: string[];
  failure: {
    summary: string;
    locator: string; // "<artifact path>#<rule id>"
    severity: FailureRef["severity"];
    signal: string; // deterministic, redacted — hashed
    matchRationale?: string; // LLM output, NOT hashed (§4.2)
    matchConfidence?: number; // LLM output, NOT hashed (§4.2)
    blockedDeploy: boolean;
  };
  forward?: { status?: "open" | "resolved" | "accepted-risk"; remediation?: string; owner?: string | null };
  ts: string; // deploy-check time, §2.2
  target?: string; // for the auth stub
}

export type RecordOutcome =
  | { outcome: "recorded"; eventId: string; incidentId: string }
  | { outcome: "already_recorded"; eventId: string; incidentId: string }
  | { outcome: "collision"; quarantineEventId: string; incidentId: string };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function assertAuthorized(_payload: IncidentPayload): Promise<void> {
  // No caller/ownership model yet — today's write path is a manual/operator
  // trigger (per the Day 4-5 brief), so this trivially passes. Day 6 wires
  // this to the payment gate's payer address.
}

export async function recordIncident(payload: IncidentPayload): Promise<RecordOutcome> {
  const incidentId = deriveIncidentId(payload.patternId, payload.build, payload.failure.locator);
  const contentHash = deriveContentHash(payload.patternId, payload.build, {
    kind: payload.patternId,
    locator: payload.failure.locator,
    severity: payload.failure.severity,
    signal: payload.failure.signal,
  });
  const referenceKey = `pattern/${payload.patternId}`;

  // (1) Authorization before any existence-revealing lookup (§6).
  await assertAuthorized(payload);

  const ledger = (await sibyl.getEntity("incident-ledger", incidentId)) as {
    body: { content_hash: string; event_id: string };
  } | null;

  const evaluated = {
    build: {
      commit: payload.build.commit,
      branch: payload.build.branch,
      target: payload.build.target,
      build_number: payload.build.build_number,
      built_at: payload.build.built_at,
    },
    scanner: payload.scanner,
    inputs: payload.inputs,
  };
  const acted = {
    kind: payload.patternId,
    summary: payload.failure.summary,
    locator: payload.failure.locator,
    severity: payload.failure.severity,
    evidence: {
      signal: payload.failure.signal,
      match_rationale: payload.failure.matchRationale ?? null,
      match_confidence: payload.failure.matchConfidence ?? null,
    },
    blocked_deploy: payload.failure.blockedDeploy,
  };
  const forward = {
    status: payload.forward?.status ?? "open",
    remediation: payload.forward?.remediation ?? null,
    owner: payload.forward?.owner ?? null,
    resolved_at: payload.forward?.status === "resolved" ? payload.ts : null,
  };

  if (ledger === null) {
    // NEW incident.
    const eventId = await sibyl.writeEvent({
      evaluated,
      acted,
      forward,
      extra: {
        incident_id: incidentId,
        content_hash: contentHash,
        pattern_id: payload.patternId,
        reference_key: referenceKey,
        schema_version: 1,
        quarantine: false,
      },
      ts: payload.ts,
    });
    await sibyl.setEntity("incident-ledger", incidentId, {
      incident_id: incidentId,
      content_hash: contentHash,
      event_id: eventId,
      status: "open",
      pattern_id: payload.patternId,
      first_written_ts: new Date().toISOString(),
      schema_version: 1,
    });
    await reconcileAndStore(payload.patternId);
    return { outcome: "recorded", eventId, incidentId };
  }

  if (ledger.body.content_hash === contentHash) {
    // LEGITIMATE RETRY — same key, same content.
    return { outcome: "already_recorded", eventId: ledger.body.event_id, incidentId };
  }

  // COLLISION — same key, different content. Never overwrite the ledger,
  // never pick a winner.
  const quarantineEventId = await sibyl.writeEvent({
    acted: {
      kind: "incident-id-collision",
      incident_id: incidentId,
      stored_hash: ledger.body.content_hash,
      incoming_hash: contentHash,
      incoming_payload: { evaluated, acted, forward },
    },
    extra: { incident_id: incidentId, quarantine: true, schema_version: 1 },
    ts: new Date().toISOString(),
  });
  const collisions = ((ledger.body as any).collisions ?? []) as unknown[];
  await sibyl.setEntity("incident-ledger", incidentId, {
    ...ledger.body,
    status: "collision",
    collisions: [
      ...collisions,
      { seen_at: new Date().toISOString(), incoming_hash: contentHash, quarantine_event_id: quarantineEventId },
    ],
  });
  return { outcome: "collision", quarantineEventId, incidentId };
}

/** §8.1-6b: for each affected pattern_id, reconcile then set_entity. Reads
 *  via read_events + client-side filter on extra.pattern_id, per §7 — never
 *  memory_search (FTS, gated, fuzzy). */
async function reconcileAndStore(patternId: string): Promise<void> {
  const all = (await sibyl.readEvents({ limit: 10000 })) as JournalEvent[];
  const forPattern = all.filter((e) => e.extra?.pattern_id === patternId);
  const referenceDoc = await sibyl.getReference(`pattern/${patternId}`);
  const { entityBody } = reconcilePattern(patternId, forPattern, referenceDoc);
  await sibyl.setEntity("failure-pattern", patternId, entityBody as unknown as Record<string, unknown>, "active");
}
