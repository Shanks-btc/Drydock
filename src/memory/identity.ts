/**
 * Identity & content hashing — architecture.md §4.
 *
 * Two derived values travel with every incident: `incident_id` (the
 * idempotency key) and `content_hash` (the tamper/change check). Both must
 * match a Python-side `sha256(canonical_json(...))` byte-for-byte since
 * nothing here re-derives them — this is the only place they're computed.
 */
import crypto from "node:crypto";

/** JSON, sort_keys=True, no insignificant whitespace, UTF-8. Matches
 *  Python's `json.dumps(x, sort_keys=True, separators=(",", ":"))` — compact
 *  separators are what "no insignificant whitespace" means in Python's
 *  json module; JSON.stringify with no indent arg already omits whitespace,
 *  so the only thing this adds over a plain stringify is deep key sorting. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export interface BuildRef {
  commit: string;
  branch: string;
  target: string;
  build_number: string;
}

export interface FailureRef {
  kind: string; // pattern_id
  locator: string; // "<artifact path>#<rule id>"
  severity: "low" | "med" | "high" | "critical";
  signal: string; // evidence.signal only — deterministic, redacted
}

/** §4.1 — deterministic, stable across retries of the *same* detected failure. */
export function deriveIncidentId(patternId: string, build: BuildRef, locator: string): string {
  const buildFingerprint = `${build.commit}@${build.build_number}`;
  const digest = sha256Hex(canonicalJson([patternId, buildFingerprint, locator]));
  return "inc_" + digest.slice(0, 32);
}

/** §4.2 — deliberately excludes ts/event_id/scan-run-id/retry-counter/
 *  reconciliation timestamps and match_rationale/match_confidence (those are
 *  the §8.2 reasoning step's output and vary run-to-run on the same build —
 *  audit metadata, never identity). */
export function deriveContentHash(patternId: string, build: BuildRef, failure: FailureRef): string {
  return sha256Hex(
    canonicalJson({
      pattern_id: patternId,
      build: { commit: build.commit, branch: build.branch, target: build.target, build_number: build.build_number },
      failure: { kind: failure.kind, locator: failure.locator, severity: failure.severity, signal: failure.signal },
      schema_version: 1,
    }),
  );
}
