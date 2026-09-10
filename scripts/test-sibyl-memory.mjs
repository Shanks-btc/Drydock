#!/usr/bin/env node
// Day 4-5 second half — real test of the Sibyl write + query paths.
// Same evidentiary standard as Day 3/4: real calls (real Sibyl DB writes,
// real Claude API calls), real output printed, not "the code compiles".
//
// Part A (write path, §6): author one REFERENCE pattern anchor (the human-
// confirmed anchor Q2 requires), write one real incident against it, then
// prove the 3-way idempotency classification for real — retry (same
// content) and collision (different content, same key).
//
// Part B (query path, §8.2): two real two-stage-match calls against a
// DIFFERENT build each, using genuinely different surface wording than the
// incident written in Part A:
//   - Test 1 (should MATCH):    a totally different-sounding secret-leak,
//     same underlying mechanism.
//   - Test 2 (should NOT match): shares surface cues ("secret key") but is
//     the not_this_pattern case (committed to source, not build-time) — a
//     real test that the reasoning step is judging cause, not keywords.
//
// Usage: npm run test:sibyl   (needs ANTHROPIC_API_KEY in .env)
import { recordIncident } from "../src/memory/incidentRecorder.ts";
import { checkBuildAgainstKnownPatterns, CONFIDENCE_FLOOR } from "../src/memory/patternMatch.ts";
import * as sibyl from "../src/memory/sibylBridge.ts";

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};

const PATTERN_ID = "exposed-key-in-build-output";
const RUN = `test-${Date.now()}`; // makes this run's incident genuinely NEW, not a replay of a prior run

async function main() {
  // ---------------------------------------------------------------------
  // Setup — author the REFERENCE anchor (§5c). This is the Q2 human-
  // confirmed step: the exact worked example already drafted in
  // architecture.md §5c, authored here as the operator.
  // ---------------------------------------------------------------------
  const patternDoc = {
    pattern_id: PATTERN_ID,
    title: "Exposed key in build output",
    detection: {
      mechanism:
        "A build step interpolates a secret into output that is then persisted or shipped — logs, a " +
        "bundled artifact, a cached layer — because the step treats the value as ordinary config.",
      distinguishing_evidence:
        "A high-entropy, credential-shaped string appears in an artifact or log that survives the build " +
        "and is readable outside the build sandbox.",
      not_this_pattern:
        "vs. secret-in-source: there the key is committed to the repo; here it's absent from source and " +
        "only appears at build time. vs. verbose-error-leak: that's PII / stack traces, not credentials.",
      canonical_incident: {
        summary:
          "A Jenkins pipeline for atlas-web echoed $DEPLOY_TOKEN during a `docker build --build-arg` step; " +
          "the token remained embedded in an intermediate layer pushed to the public registry.",
        build_context: "atlas-web, Jenkins pipeline, 2026-06 internal audit finding",
        incident_id: "inc_illustrative_atlas_web_2026_06",
      },
      prefilters: {
        artifact_kinds: ["build-log", "bundle"],
        cues: ["token", "key", "secret", "PRIVATE KEY"],
      },
    },
    canonical_remediation:
      "Scrub the offending step's output; rotate the exposed credential; move it to a secret store the " +
      "build fetches at deploy time instead of interpolating into persisted output.",
    severity_default: "high",
    references: [],
    pattern_version: 1,
    content_hash: null,
    created_ts: new Date().toISOString(),
    updated_ts: new Date().toISOString(),
    retired_at: null,
  };
  await sibyl.setReference(`pattern/${PATTERN_ID}`, patternDoc, {
    pattern_id: PATTERN_ID,
    entity_ref: `failure-pattern/${PATTERN_ID}`,
    schema_version: 1,
  });
  console.log(`[setup] wrote REFERENCE pattern/${PATTERN_ID}\n`);

  // ---------------------------------------------------------------------
  // Part A — write path (§6)
  // ---------------------------------------------------------------------
  console.log("=== Part A: write path (§6 three-way idempotency) ===\n");

  const build = { commit: `c_${RUN}`, branch: "main", target: "web", build_number: RUN, built_at: new Date().toISOString() };
  const basePayload = {
    patternId: PATTERN_ID,
    build,
    scanner: { name: "drydock-scan", version: "0.1.0" },
    inputs: ["dist/build.log"],
    failure: {
      summary: "AWS secret access key literal found in persisted build log",
      locator: "dist/build.log#secret-scan.aws-key",
      severity: "critical",
      signal:
        "Line 214 of dist/build.log: AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY printed " +
        "by `env` during the docker build step and retained in the persisted CI log artifact.",
      blockedDeploy: true,
    },
    ts: new Date().toISOString(),
  };

  const first = await recordIncident(basePayload);
  console.log("[A1] recordIncident (new):", JSON.stringify(first));
  rec("first write outcome is 'recorded'", first.outcome === "recorded", `got ${first.outcome}`);

  const retry = await recordIncident(basePayload); // identical content, same key
  console.log("[A2] recordIncident (exact retry):", JSON.stringify(retry));
  rec("retry with identical content is 'already_recorded'", retry.outcome === "already_recorded", `got ${retry.outcome}`);
  rec(
    "retry returns the SAME event_id as the first write",
    retry.outcome === "already_recorded" && first.outcome === "recorded" && retry.eventId === first.eventId,
  );

  const colliding = {
    ...basePayload,
    failure: { ...basePayload.failure, severity: "high", signal: basePayload.failure.signal + " (rescanned, different finding)" },
  };
  const collision = await recordIncident(colliding); // same key, DIFFERENT content
  console.log("[A3] recordIncident (same key, different content):", JSON.stringify(collision));
  rec("write with same key + different content is 'collision'", collision.outcome === "collision", `got ${collision.outcome}`);

  const rollup = await sibyl.getEntity("failure-pattern", PATTERN_ID);
  console.log("[A4] failure-pattern rollup after reconcile:", JSON.stringify(rollup, null, 2));
  rec("rollup entity exists after write", rollup !== null);
  rec(
    "this run's incident_id is in the rollup's incident_ids",
    !!rollup && rollup.body.incident_ids.includes(first.incidentId),
  );
  rec(
    "collision did NOT create a second counted incident (still 1 per this run's key)",
    !!rollup && rollup.body.incident_ids.filter((id) => id === first.incidentId).length === 1,
  );

  // ---------------------------------------------------------------------
  // Part B — query path (§8.2 two-stage match), real Claude calls
  // ---------------------------------------------------------------------
  console.log("\n=== Part B: query path (§8.2 two-stage match, live Claude Opus 5) ===\n");

  console.log("--- Test B1: should MATCH (genuinely different wording) ---");
  const buildMatch = { build_id: "build_9911", commit: "f00dcafe1234", branch: "release/2.4", target: "payments-api" };
  const signalsMatch = [
    {
      artifact_kind: "bundle",
      text:
        "the shipped client bundle embeds a live OAuth refresh token that was pulled in via an environment " +
        "substitution during the webpack build, and it's readable by anyone who downloads the release asset",
    },
  ];
  const resultMatch = await checkBuildAgainstKnownPatterns(buildMatch, signalsMatch, [PATTERN_ID]);
  console.log("shortlist:", JSON.stringify(resultMatch.shortlist));
  console.log("candidate_matches:", JSON.stringify(resultMatch.candidateMatches, null, 2));
  console.log("new_pattern_candidates:", JSON.stringify(resultMatch.newPatternCandidates, null, 2));
  rec("B1 shortlisted the known pattern", resultMatch.shortlist.some((s) => s.pattern_id === PATTERN_ID));
  rec(
    `B1 matched ${PATTERN_ID} at confidence >= ${CONFIDENCE_FLOOR}`,
    resultMatch.candidateMatches.some((m) => m.pattern_id === PATTERN_ID),
    `matches=${JSON.stringify(resultMatch.candidateMatches.map((m) => [m.pattern_id, m.confidence]))}`,
  );
  const hotAfterB1 = await sibyl.getState("scan/active");
  console.log("HOT scan/active after B1:", JSON.stringify(hotAfterB1, null, 2));
  rec(
    "HOT scan/active carries the rationale text (not just a verdict)",
    !!hotAfterB1?.body?.candidate_matches?.[0]?.rationale?.length,
  );

  console.log("\n--- Test B2: should NOT match (shares cues, wrong mechanism — not_this_pattern case) ---");
  const buildNoMatch = { build_id: "build_9912", commit: "deadbeef5678", branch: "main", target: "billing-service" };
  const signalsNoMatch = [
    {
      artifact_kind: "source",
      text:
        "a teammate hard-coded the Stripe secret key directly into config/prod.rb and committed it to the " +
        "repository months ago; it has been sitting in git history ever since, unrelated to any build step",
    },
  ];
  const resultNoMatch = await checkBuildAgainstKnownPatterns(buildNoMatch, signalsNoMatch, [PATTERN_ID]);
  console.log("shortlist:", JSON.stringify(resultNoMatch.shortlist));
  console.log("candidate_matches:", JSON.stringify(resultNoMatch.candidateMatches, null, 2));
  console.log("below_floor:", JSON.stringify(resultNoMatch.belowFloor, null, 2));
  console.log("new_pattern_candidates:", JSON.stringify(resultNoMatch.newPatternCandidates, null, 2));
  rec(
    "B2 shortlisted the known pattern (shares surface cues — proves this isn't a prefilter fluke)",
    resultNoMatch.shortlist.some((s) => s.pattern_id === PATTERN_ID),
  );
  rec(
    `B2 did NOT match ${PATTERN_ID} at or above the floor (reasoning rejected the surface resemblance)`,
    !resultNoMatch.candidateMatches.some((m) => m.pattern_id === PATTERN_ID),
    `matches=${JSON.stringify(resultNoMatch.candidateMatches.map((m) => [m.pattern_id, m.confidence]))}`,
  );

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
