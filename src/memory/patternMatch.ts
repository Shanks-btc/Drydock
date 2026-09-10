/**
 * Query path — architecture.md §8.2, the two-stage known-vs-novel match.
 * Standalone today (no payment-gate wiring — that's Day 6): callers pass in
 * a build + its collected signals and get back the match verdict, with the
 * HOT `scan/active` state written per §5d/§8.1 along the way.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as sibyl from "./sibylBridge.ts";

export interface BuildSignal {
  artifact_kind: string;
  text: string; // the actual evidence — a log excerpt, described-in-prose finding, etc.
  path?: string; // source file within the build, when the signal came from a real file (Day 6 extraction)
}

export interface PatternDoc {
  pattern_id: string;
  title: string;
  detection: {
    mechanism: string;
    distinguishing_evidence: string;
    not_this_pattern: string;
    canonical_incident: { summary: string; build_context?: string; incident_id?: string };
    prefilters?: { artifact_kinds?: string[]; cues?: string[] };
  };
}

export interface ShortlistEntry {
  pattern_id: string;
  reference_key: string;
}

export interface CandidateMatch {
  pattern_id: string;
  reference_key: string;
  confidence: number;
  rationale: string;
}

export interface NewPatternCandidate {
  signal: string;
  reasoning: string;
}

export const CONFIDENCE_FLOOR = 0.6; // §8.2.2 default; see docs/architecture.md §9 Q-note on tuning it in Day 8

// --- 8.2.1 — deterministic prefilter ---------------------------------------

/** Pure string/set work, no LLM. A pattern with no `prefilters` is always a
 *  candidate. Loose by design — a false negative here is a real miss. */
export function prefilterShortlist(signals: BuildSignal[], patterns: PatternDoc[]): ShortlistEntry[] {
  const out: ShortlistEntry[] = [];
  for (const p of patterns) {
    const pf = p.detection.prefilters;
    if (!pf) {
      out.push({ pattern_id: p.pattern_id, reference_key: `pattern/${p.pattern_id}` });
      continue;
    }
    const artifactHit = pf.artifact_kinds?.some((k) => signals.some((s) => s.artifact_kind === k)) ?? false;
    const cueHit =
      pf.cues?.some((cue) => signals.some((s) => s.text.toLowerCase().includes(cue.toLowerCase()))) ?? false;
    if (artifactHit || cueHit) {
      out.push({ pattern_id: p.pattern_id, reference_key: `pattern/${p.pattern_id}` });
    }
  }
  return out;
}

// --- 8.2.2 — reasoning step (LLM, authoritative) ---------------------------

const ReasoningOutput = z.object({
  matches: z.array(
    z.object({
      pattern_id: z.string(),
      confidence: z.number().min(0).max(1),
      rationale: z.string(),
    }),
  ),
  new_pattern_candidates: z.array(
    z.object({
      signal: z.string(),
      reasoning: z.string(),
    }),
  ),
});

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

/** One LLM call comparing build signals against each shortlisted pattern's
 *  anchor text. Returns a match {pattern_id, confidence, rationale} only for
 *  patterns judged a genuine, substantive match — never a keyword hit. */
export async function reasoningStep(
  signals: BuildSignal[],
  shortlisted: PatternDoc[],
): Promise<{ matches: CandidateMatch[]; newPatternCandidates: NewPatternCandidate[] }> {
  if (shortlisted.length === 0) {
    // Nothing to compare against — every signal is unattributed by construction.
    return {
      matches: [],
      newPatternCandidates: signals.map((s) => ({
        signal: s.text,
        reasoning: "No pattern was shortlisted by the prefilter for this signal.",
      })),
    };
  }

  const system = `You are Drydock's deploy-incident pattern-matcher (architecture.md §8.2.2).

You are given a build's collected signals and a shortlist of KNOWN failure patterns, each described by:
- mechanism: the causal story — what goes wrong and WHY, not the symptom
- distinguishing_evidence: what a build exhibiting this looks like, conceptually
- not_this_pattern: negative anchors — nearby patterns this is confused with, and the distinction
- canonical_incident: one real past incident as a worked example

Judge SUBSTANTIVE similarity: does this build's signal share the same underlying cause as a
pattern's mechanism? Surface resemblance (shared keywords, similar-looking artifact) is NOT
sufficient — use each pattern's not_this_pattern field explicitly to push back against surface
resemblance. A signal that merely mentions the same kind of noun (e.g. "key", "secret") as a
pattern's cues, without actually exhibiting that pattern's causal mechanism, must NOT be matched.

For each shortlisted pattern, decide independently whether the build's signals exhibit that
pattern's mechanism. Include an entry in "matches" ONLY for patterns you judge to be a genuine
match, citing the specific signal and the anchor field (mechanism / distinguishing_evidence /
not_this_pattern) that drove your judgement in 2-4 sentences. Omit patterns you reject — do not
pad "matches" with low-confidence guesses.

For any signal that does not fit ANY shortlisted pattern's mechanism, add it to
"new_pattern_candidates" with your reasoning for why it looks like a genuinely new cause.`;

  const patternBlocks = shortlisted
    .map(
      (p) => `### Pattern: ${p.pattern_id} ("${p.title}")
mechanism: ${p.detection.mechanism}
distinguishing_evidence: ${p.detection.distinguishing_evidence}
not_this_pattern: ${p.detection.not_this_pattern}
canonical_incident: ${JSON.stringify(p.detection.canonical_incident)}`,
    )
    .join("\n\n");

  const signalBlocks = signals.map((s, i) => `${i + 1}. [${s.artifact_kind}] ${s.text}`).join("\n");

  const user = `## Shortlisted patterns\n\n${patternBlocks}\n\n## This build's collected signals\n\n${signalBlocks}`;

  const response = await client().messages.parse({
    model: "claude-opus-5",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(ReasoningOutput) },
    system,
    messages: [{ role: "user", content: user }],
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(`reasoning step: model output failed to parse against the schema (stop_reason=${response.stop_reason})`);
  }

  const byId = new Map(shortlisted.map((p) => [p.pattern_id, p]));
  const matches: CandidateMatch[] = parsed.matches
    .filter((m) => byId.has(m.pattern_id)) // ignore a hallucinated pattern_id outside the shortlist
    .map((m) => ({ ...m, reference_key: `pattern/${m.pattern_id}` }));

  return { matches, newPatternCandidates: parsed.new_pattern_candidates };
}

// --- Orchestration: load anchors, run both stages, persist to HOT ----------

async function loadReferenceDocs(patternIds?: string[]): Promise<PatternDoc[]> {
  // No list-all-references primitive in the SDK (§2 table) — the caller
  // either knows the pattern_ids to load (this build) or, for the
  // standalone test, passes them explicitly. Production would enumerate via
  // the WARM failure-pattern entities' names instead of guessing.
  if (!patternIds || patternIds.length === 0) return [];
  const docs: PatternDoc[] = [];
  for (const id of patternIds) {
    const ref = await sibyl.getReference(`pattern/${id}`);
    if (!ref) continue;
    const body = typeof ref.body === "string" ? JSON.parse(ref.body) : ref.body;
    docs.push(body as PatternDoc);
  }
  return docs;
}

export interface MatchResult {
  shortlist: ShortlistEntry[];
  candidateMatches: CandidateMatch[]; // above CONFIDENCE_FLOOR
  belowFloor: CandidateMatch[]; // matched but below the floor — visible for tuning (§9 Day-8 note)
  newPatternCandidates: NewPatternCandidate[];
}

/**
 * Standalone query check (§8.1 steps 2-4 / §8.2), scoped to this call — no
 * COLD writes, no flush (§8.1-6, the payment-gate integration, is Day 6).
 * Writes HOT `scan/active` per §5d as it progresses, including
 * `candidate_matches[].rationale` for the audit trail described in §8.2.2.
 */
export async function checkBuildAgainstKnownPatterns(
  build: { build_id: string; commit: string; branch: string; target: string },
  signals: BuildSignal[],
  knownPatternIds: string[],
): Promise<MatchResult> {
  const startedTs = new Date().toISOString();
  await sibyl.setState("scan/active", {
    build,
    phase: "enumerating",
    started_ts: startedTs,
    updated_ts: startedTs,
    schema_version: 1,
  });

  const patterns = await loadReferenceDocs(knownPatternIds);

  await sibyl.setState("scan/active", {
    build,
    phase: "matching",
    started_ts: startedTs,
    updated_ts: new Date().toISOString(),
    signals_collected: signals,
    schema_version: 1,
  });

  const shortlist = prefilterShortlist(signals, patterns);
  await sibyl.setState("scan/active", {
    build,
    phase: "classifying",
    started_ts: startedTs,
    updated_ts: new Date().toISOString(),
    signals_collected: signals,
    shortlist,
    schema_version: 1,
  });

  const shortlistedDocs = patterns.filter((p) => shortlist.some((s) => s.pattern_id === p.pattern_id));
  const { matches, newPatternCandidates } = await reasoningStep(signals, shortlistedDocs);

  const candidateMatches = matches.filter((m) => m.confidence >= CONFIDENCE_FLOOR);
  const belowFloor = matches.filter((m) => m.confidence < CONFIDENCE_FLOOR);

  await sibyl.setState("scan/active", {
    build,
    phase: "done", // no flush yet (§8.1-6 is Day 6) — left visible for inspection, not reset to idle
    started_ts: startedTs,
    updated_ts: new Date().toISOString(),
    signals_collected: signals,
    shortlist,
    candidate_matches: candidateMatches,
    new_pattern_candidates: newPatternCandidates,
    verdict: candidateMatches.length > 0 ? "blocked" : "clean",
    schema_version: 1,
  });

  return { shortlist, candidateMatches, belowFloor, newPatternCandidates };
}
