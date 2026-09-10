/**
 * Day 6 — the memory-check gate. Sits between payment confirmation and the
 * deploy actually going live (wired from src/deploy/settlement.ts). Per the
 * reframed x402 principle carried over from the payment gate itself: this
 * gate controls whether the DEPLOY proceeds, never whether the PAYMENT does
 * — by the time this runs, `pipeline.markPaid` has already committed.
 *
 * Known patterns are enumerated from the WARM `failure-pattern` entities
 * (list_entities), not hardcoded — there is no list-all-references
 * primitive (§2 table), so "which patterns are known" is read from the
 * rollup entities, exactly as flagged as a TODO in patternMatch.ts's
 * loadReferenceDocs when that was written standalone in Day 4-5.
 *
 * Fail-closed decision (not explicitly specified by the brief, flagged
 * here): if the gate check itself throws (bridge crash, LLM API error),
 * the deploy does NOT proceed. A security-relevant gate that silently opens
 * on its own failure defeats its purpose; the caller surfaces the error on
 * the deploy record distinctly from a genuine pattern match.
 */
import { extractBuildSignals } from "./signalExtraction.ts";
import { checkBuildAgainstKnownPatterns, type CandidateMatch, type NewPatternCandidate } from "./patternMatch.ts";
import * as sibyl from "./sibylBridge.ts";

export interface GateResult {
  verdict: "clean" | "blocked";
  checkedAt: string;
  signalsExtracted: number;
  knownPatternsChecked: number;
  /** Repo-relative paths of the files the extractor read, for the incident
   *  record's `inputs` (§5a) when a block gets recorded. */
  scannedFiles: string[];
  topMatch: CandidateMatch | null;
  allMatches: CandidateMatch[];
  /** Signals the reasoning step judged to be a genuinely new cause, not
   *  covered by any known pattern. Surfaced on the public deploy record so a
   *  clean pass that still spotted something ("cleared the known patterns,
   *  but flagged a new one") is visible without reading HOT scan state. Not
   *  a block, and nothing is written to COLD from here — that's the
   *  pattern-promotion pipeline (still Day 6 scope). */
  newPatternCandidates: NewPatternCandidate[];
}

/**
 * @param build   Drydock's zip-upload pipeline has no git metadata (it's
 *                not a git-backed build) — build_id is the deploy id;
 *                commit/branch/target are honestly "unknown" rather than
 *                fabricated. They're bookkeeping only (§5d HOT state
 *                labels); the reasoning-step prompt never reads them.
 * @param srcDir  the extracted deploy folder on disk (pipeline.ts's srcDir)
 */
export async function checkDeployAgainstKnownPatterns(deployId: string, srcDir: string): Promise<GateResult> {
  const checkedAt = new Date().toISOString();
  const signals = extractBuildSignals(srcDir);
  const scannedFiles = signals.map((s) => s.path).filter((p): p is string => !!p);

  const patternRows = await sibyl.listEntities("failure-pattern", { status: "active" });
  const patternIds = patternRows.map((r) => r.name);

  if (patternIds.length === 0 || signals.length === 0) {
    // Nothing known to check against, or nothing extracted to check —
    // either way there's no basis for a block. Skips the LLM call entirely.
    return {
      verdict: "clean",
      checkedAt,
      signalsExtracted: signals.length,
      knownPatternsChecked: patternIds.length,
      scannedFiles,
      topMatch: null,
      allMatches: [],
      newPatternCandidates: [],
    };
  }

  const build = { build_id: deployId, commit: "unknown", branch: "unknown", target: "unknown" };
  const result = await checkBuildAgainstKnownPatterns(build, signals, patternIds);
  const sortedMatches = [...result.candidateMatches].sort((a, b) => b.confidence - a.confidence);

  return {
    verdict: sortedMatches.length > 0 ? "blocked" : "clean",
    checkedAt,
    signalsExtracted: signals.length,
    knownPatternsChecked: patternIds.length,
    scannedFiles,
    topMatch: sortedMatches[0] ?? null,
    allMatches: sortedMatches,
    newPatternCandidates: result.newPatternCandidates,
  };
}
