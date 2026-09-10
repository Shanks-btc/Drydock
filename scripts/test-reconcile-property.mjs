#!/usr/bin/env node
// §7.1 — required before reconcilePattern ships: permute the same incident
// events into N random orders, assert IDENTICAL (entityBody, exceptions)
// every time. No Sibyl, no network — pure function test.
import assert from "node:assert/strict";
import { reconcilePattern } from "../src/memory/reconcile.ts";

const events = [
  {
    id: "ev_3",
    ts: "2026-09-04T10:00:00.000Z",
    evaluated: {},
    acted: { kind: "exposed-key-in-build-output", severity: "high" },
    forward: { status: "open" },
    extra: { incident_id: "inc_aaa", pattern_id: "exposed-key-in-build-output" },
  },
  {
    id: "ev_1",
    ts: "2026-09-03T08:00:00.000Z",
    evaluated: {},
    acted: { kind: "exposed-key-in-build-output", severity: "critical" },
    forward: { status: "resolved" },
    extra: { incident_id: "inc_bbb", pattern_id: "exposed-key-in-build-output" },
  },
  // Duplicate of inc_bbb — a retried write with a LATER ts. Dedup must keep
  // the earliest (ev_1), so this later duplicate must not move first/last
  // seen or double-count incident_count.
  {
    id: "ev_9",
    ts: "2026-09-03T09:30:00.000Z",
    evaluated: {},
    acted: { kind: "exposed-key-in-build-output", severity: "critical" },
    forward: { status: "resolved" },
    extra: { incident_id: "inc_bbb", pattern_id: "exposed-key-in-build-output" },
  },
  // Quarantine event (collision) — must be excluded entirely.
  {
    id: "ev_5",
    ts: "2026-09-05T00:00:00.000Z",
    evaluated: {},
    acted: { kind: "incident-id-collision" },
    forward: {},
    extra: { incident_id: "inc_bbb", pattern_id: "exposed-key-in-build-output", quarantine: true },
  },
  {
    id: "ev_2",
    ts: "2026-09-03T20:00:00.000Z",
    evaluated: {},
    acted: { kind: "exposed-key-in-build-output", severity: "bogus-severity" },
    forward: { status: "open" },
    extra: { incident_id: "inc_ccc", pattern_id: "exposed-key-in-build-output" },
  },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const referenceDoc = { pattern_id: "exposed-key-in-build-output" };
const baseline = reconcilePattern("exposed-key-in-build-output", events, referenceDoc);

console.log("baseline:", JSON.stringify(baseline, null, 2));

let failures = 0;
const N = 200;
for (let i = 0; i < N; i++) {
  const permuted = shuffle(events);
  const result = reconcilePattern("exposed-key-in-build-output", permuted, referenceDoc);
  try {
    assert.deepStrictEqual(result, baseline);
  } catch (err) {
    failures++;
    console.error(`FAIL on permutation ${i}:`, err.message);
  }
}

// Sanity checks on the baseline itself, so a bug that's stable under
// permutation (wrong but consistent) still gets caught.
assert.equal(baseline.entityBody.incident_count, 3, "3 distinct incident_ids (aaa, bbb, ccc)");
assert.deepEqual(baseline.entityBody.incident_ids, ["inc_aaa", "inc_bbb", "inc_ccc"]);
assert.deepEqual(baseline.entityBody.open_incident_ids, ["inc_aaa", "inc_ccc"]);
assert.deepEqual(baseline.entityBody.resolved_incident_ids, ["inc_bbb"]);
assert.equal(baseline.entityBody.first_seen_ts, "2026-09-03T08:00:00.000Z", "earliest of inc_bbb's two ts, not the later duplicate");
assert.equal(baseline.entityBody.last_seen_ts, "2026-09-04T10:00:00.000Z");
assert.equal(baseline.entityBody.severity_ceiling, "critical");
assert.equal(baseline.exceptions.length, 1, "one bad-severity exception for inc_ccc");
assert.equal(baseline.exceptions[0].kind, "bad-severity");
assert.equal(baseline.exceptions[0].incident_id, "inc_ccc");

console.log(`\n=== ${N - failures}/${N} permutations produced identical output ===`);
if (failures > 0) process.exit(1);
console.log("Sanity assertions on baseline: PASS");
