#!/usr/bin/env node
// Day 9 risk-list input: rough latency for the Sibyl Python-bridge path.
// Not a benchmark harness — one real run, reported honestly as "rough".
import { recordIncident } from "../src/memory/incidentRecorder.ts";
import { checkBuildAgainstKnownPatterns, reasoningStep } from "../src/memory/patternMatch.ts";
import * as sibyl from "../src/memory/sibylBridge.ts";

const PATTERN_ID = "exposed-key-in-build-output";
const ms = (a, b) => (Number(b - a) / 1e6).toFixed(0);

async function main() {
  // 1. Bare single bridge round trip (spawn python + trivial op), 5x.
  console.log("--- (1) bare bridge round-trip (get_state on a scratch key), 5x ---");
  const bare = [];
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    await sibyl.getState("latency-scratch/probe");
    const t1 = process.hrtime.bigint();
    bare.push(Number(t1 - t0) / 1e6);
    console.log(`  call ${i + 1}: ${bare[i].toFixed(0)} ms`);
  }
  bare.sort((a, b) => a - b);
  console.log(`  min ${bare[0].toFixed(0)}ms  median ${bare[2].toFixed(0)}ms  max ${bare[4].toFixed(0)}ms\n`);

  // 2. One full write — recordIncident on a fresh, never-seen key (~5-6 bridge calls).
  console.log("--- (2) one full write: recordIncident (new incident) ---");
  const build = {
    commit: `latency_${Date.now()}`,
    branch: "main",
    target: "web",
    build_number: `latency-${Date.now()}`,
    built_at: new Date().toISOString(),
  };
  const t0 = process.hrtime.bigint();
  const writeResult = await recordIncident({
    patternId: PATTERN_ID,
    build,
    scanner: { name: "latency-probe", version: "0.0.0" },
    inputs: ["build.log"],
    failure: {
      summary: "latency probe incident",
      locator: "build.log#latency-probe",
      severity: "low",
      signal: "synthetic signal for latency measurement only",
      blockedDeploy: false,
    },
    ts: new Date().toISOString(),
  });
  const t1 = process.hrtime.bigint();
  console.log(`  outcome=${writeResult.outcome} elapsed=${ms(t0, t1)}ms\n`);

  // 3. One full query — checkBuildAgainstKnownPatterns (bridge calls + 1 LLM call).
  console.log("--- (3) one full query: checkBuildAgainstKnownPatterns (bridge + LLM) ---");
  const signals = [
    {
      artifact_kind: "bundle",
      text: "a live OAuth refresh token was pulled into the shipped bundle via an environment substitution during the build",
    },
  ];
  const t2 = process.hrtime.bigint();
  const queryResult = await checkBuildAgainstKnownPatterns(
    { build_id: `latency_${Date.now()}`, commit: "n/a", branch: "n/a", target: "n/a" },
    signals,
    [PATTERN_ID],
  );
  const t3 = process.hrtime.bigint();
  console.log(`  matched=${queryResult.candidateMatches.length > 0} elapsed=${ms(t2, t3)}ms`);

  // 3b. Isolate the LLM portion: call reasoningStep alone (no bridge calls) with
  // the same shortlist so bridge-only time ~= (3) - (3b).
  const patternDoc = JSON.parse((await sibyl.getReference(`pattern/${PATTERN_ID}`)).body);
  const t4 = process.hrtime.bigint();
  await reasoningStep(signals, [patternDoc]);
  const t5 = process.hrtime.bigint();
  console.log(`  ...of which reasoningStep (LLM call) alone: ${ms(t4, t5)}ms`);
  console.log(`  ...implied bridge-only portion of the query: ~${ms(t2, t3) - ms(t4, t5)}ms\n`);

  console.log("=== summary (single real run, not averaged — see report for caveats) ===");
  console.log(`bare bridge call (median of 5):      ${bare[2].toFixed(0)} ms`);
  console.log(`full write (recordIncident):          ${ms(t0, t1)} ms`);
  console.log(`full query (gate check, w/ LLM):      ${ms(t2, t3)} ms`);
  console.log(`  - LLM reasoning step alone:          ${ms(t4, t5)} ms`);
  console.log(`write + query round-trip, combined:    ${(Number(t1 - t0) + Number(t3 - t2)) / 1e6 | 0} ms`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
