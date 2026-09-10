/**
 * Pure reconciliation of the WARM `failure-pattern` rollup — architecture.md
 * §7. Every input passed explicitly, no ambient reads mid-computation, so
 * running it repeatedly or on any ordering of the same events converges to
 * the same output. §7.1 requires a permutation property test before this
 * ships — see scripts/test-reconcile-property.mjs.
 */

const SEVERITY_RANK: Record<string, number> = { low: 0, med: 1, high: 2, critical: 3 };

export interface JournalEvent {
  id: string;
  ts: string;
  evaluated: unknown;
  acted: { kind?: string; severity?: string; [k: string]: unknown };
  forward: { status?: string; [k: string]: unknown };
  extra: {
    incident_id?: string;
    pattern_id?: string;
    quarantine?: boolean;
    [k: string]: unknown;
  };
}

export interface ReconcileException {
  kind: "unknown-pattern" | "bad-severity";
  incident_id: string;
}

export interface FailurePatternBody {
  pattern_id: string;
  reference_key: string;
  first_seen_ts: string | null;
  last_seen_ts: string | null;
  incident_count: number;
  incident_ids: string[];
  open_incident_ids: string[];
  resolved_incident_ids: string[];
  severity_ceiling: string | null;
  status_note: string;
  schema_version: 1;
}

/**
 * @param patternId       which pattern this rollup is for
 * @param incidentEvents  ALL COLD events tagged this pattern_id (any order)
 * @param referenceDoc    current REFERENCE anchor, or null if none exists
 *                        (drives the "unknown-pattern" exception — passed in
 *                        rather than fetched here so the function stays pure)
 * @param seed            optional prior rollup body to carry a status_note
 *                         forward from (unused fields are recomputed fresh)
 */
export function reconcilePattern(
  patternId: string,
  incidentEvents: JournalEvent[],
  referenceDoc: unknown | null,
  seed: FailurePatternBody | null = null,
): { entityBody: FailurePatternBody; exceptions: ReconcileException[] } {
  const exceptions: ReconcileException[] = [];

  // Exclude quarantine events from every count (§7 "Dedup").
  const live = incidentEvents.filter((e) => e.extra?.quarantine !== true);

  // Dedup by incident_id: keep earliest ts, tie-break smallest event_id.
  // Order-independent by construction — sort is total, not accumulation order.
  const byIncident = new Map<string, JournalEvent>();
  for (const ev of live) {
    const id = ev.extra?.incident_id;
    if (!id) continue;
    const existing = byIncident.get(id);
    if (!existing) {
      byIncident.set(id, ev);
      continue;
    }
    if (ev.ts < existing.ts || (ev.ts === existing.ts && ev.id < existing.id)) {
      byIncident.set(id, ev);
    }
  }

  const incidentIds = [...byIncident.keys()].sort();
  const openIds: string[] = [];
  const resolvedIds: string[] = [];
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;
  let severityCeiling: string | null = null;

  for (const id of incidentIds) {
    const ev = byIncident.get(id)!;

    if (referenceDoc === null) {
      exceptions.push({ kind: "unknown-pattern", incident_id: id });
    }

    const severity = ev.acted?.severity;
    if (severity !== undefined && !(severity in SEVERITY_RANK)) {
      exceptions.push({ kind: "bad-severity", incident_id: id });
    } else if (severity !== undefined) {
      if (severityCeiling === null || SEVERITY_RANK[severity] > SEVERITY_RANK[severityCeiling]) {
        severityCeiling = severity;
      }
    }

    if (firstSeen === null || ev.ts < firstSeen) firstSeen = ev.ts;
    if (lastSeen === null || ev.ts > lastSeen) lastSeen = ev.ts;

    const status = ev.forward?.status ?? "open";
    if (status === "resolved") resolvedIds.push(id);
    else openIds.push(id);
  }
  openIds.sort();
  resolvedIds.sort();

  const entityBody: FailurePatternBody = {
    pattern_id: patternId,
    reference_key: `pattern/${patternId}`,
    first_seen_ts: firstSeen,
    last_seen_ts: lastSeen,
    incident_count: incidentIds.length,
    incident_ids: incidentIds,
    open_incident_ids: openIds,
    resolved_incident_ids: resolvedIds,
    severity_ceiling: severityCeiling,
    status_note:
      `reconciled ${incidentIds.length} incident(s) as of ${lastSeen ?? "n/a"}` +
      (exceptions.length ? `; ${exceptions.length} exception(s)` : ""),
    schema_version: 1,
  };
  void seed; // reserved for a future carried-forward field; nothing to inherit yet
  return { entityBody, exceptions };
}
