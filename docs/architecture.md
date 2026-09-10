# Drydock — Architecture

> **Status: FINAL schema, write + query paths implemented AND wired into the
> deploy flow (2026-09-04).** This document is the agreed design for how
> Drydock records deployment incidents in the Sibyl Memory store. All §9
> decisions are resolved. The write path (§6, `src/memory/incidentRecorder.ts`)
> and the query path (§8.2, `src/memory/patternMatch.ts`) are implemented and
> verified against a real Sibyl store + real Claude Opus 5 calls — see
> `docs/plan.md` Day 4-5. As of Day 6, the query path also runs for real
> against real build content (`src/memory/signalExtraction.ts` +
> `src/memory/deployGate.ts`), sitting between payment confirmation and
> publish in `src/deploy/settlement.ts` — see `docs/deploy.md` "The
> memory-check gate". **Still not built**: no HTTP surface for the gate
> itself, no override/manual-proceed path for a blocked deploy (Day 7 UI),
> no ownership recording.
>
> **Tier: free, no payment (decided).** `sibyl init` is not run and no account
> is bound. The client resolves to `tier="free"`,
> `tenant_id=00000000-0000-0000-0000-000000000001`, and a **5 MB hard cap
> across all tiers combined** (entities + state + reference + journal + their
> FTS indexes). There is no "Pro / $9-month" tier in the package source; the
> real vocabulary is `free | sync | team | lifetime | stake | enterprise`, and
> only `{sync, team, lifetime, stake, enterprise}` lift the cap. This is a
> hackathon-scale build — the free cap is accepted as a constraint, not
> designed around (see §9).

---

## 1. Scope

Drydock checks a deploy before it ships and records what it finds. The unit
of record is a **deployment incident**: one thing that failed a pre-deploy
check on one build (an exposed key in build output, a missing migration, a
dependency with a known advisory, …).

Incidents that look different on the surface — different file, different
commit, different build — often share one **underlying cause**. The schema
has to let us group them by cause, keep a canonical description of each known
cause to compare new builds against, and hold the working state of a scan
that is currently running.

This maps onto four of Sibyl's five memory tiers (COLD, WARM, REFERENCE, HOT;
the fifth, ARCHIVE, is used only for retirement — §5e).

---

## 2. Sibyl primitives Drydock uses

Verified against installed source — `sibyl-memory-client 0.8.0`
(`client.py`), `sibyl-memory-mcp 0.2.0` (`server.py`) — not the PyPI text.

| Tier | SDK method (`MemoryClient`) | Signature | Write semantics |
|---|---|---|---|
| COLD | `write_event` | `write_event(*, evaluated=None, acted=None, forward=None, extra=None, ts=None) -> event_id: str` | Append-only. **A fresh UUID is generated on every call — there is no dedup. A retried call writes a duplicate row.** |
| WARM | `set_entity` | `set_entity(category, name, body, *, status=None) -> dict` | Upsert on `(tenant, category, name)`. **Full-body last-write-wins. No content comparison, no merge, no tamper flag.** `body` must be `dict`/`list`. |
| WARM (read) | `get_entity` / `list_entities` | `get_entity(category, name)` · `list_entities(category=None, *, status=None, limit=100)` | — |
| WARM (retire) | `archive_entity` | `archive_entity(category, name, reason=None)` | Moves the row to `archived_entities` (ARCHIVE tier); drops out of recall/list/search, preserved for forensics. |
| REFERENCE | `set_reference` | `set_reference(key, body, *, metadata=None) -> None` | Upsert on `(tenant, doc_key)`. `body` is `str` **or** a JSON-serializable `dict`/`list` (a dict is canonicalised to sorted-key JSON and stored as text — `get_reference` returns it as that string, caller must `json.loads`). |
| REFERENCE (read) | `get_reference` | `get_reference(key) -> {body, metadata, updated_at} \| None` | — |
| HOT | `set_state` / `get_state` | `set_state(key, body) -> None` · `get_state(key) -> {body, updated_at} \| None` | Upsert on `(tenant, document_key)`, one row per key, overwritten each set. **No `delete_state` exists** — reset by overwriting with an idle sentinel. `body` must be `dict`/`list`. |
| COLD (read) | `read_events` | `read_events(*, limit=50, since=None, until=None) -> list` | Exact, time-ordered (`ts DESC`), `limit` clamped to `[0, 10000]`. Not FTS. |
| all | `search` / MCP `memory_search` | cross-tier FTS5 | Fuzzy. Every zero-result carries a `verdict.code` (`abstained_on`, `negation_abstain`, `gated`, `empty_store`, `no_match`); contract says retry ≤2× dropping the flagged token. **Not reliable for exact-key lookup.** |

### 2.1 Access path: SDK, not MCP, for writes

Drydock's incident recorder calls `sibyl-memory-client` **in-process**. It
does **not** go through the MCP server for writes, because:

- **`set_reference` has no MCP tool.** The MCP server exposes 8 `memory_*`
  tools; reference *writes* are not among them (search covers the read side).
- **`memory_record_event` is lossy.** It maps `(kind, body, category, name)`
  onto `write_event(acted={kind, body}, extra={category, name})` — it cannot
  set `evaluated`, `forward`, or `ts`. The incident schema (§5a) uses all
  four slots and an explicit `ts`.

The MCP server stays useful for *interactive* recall (an agent asking "have
we seen this failure before") but is not on Drydock's write path.

> **Implementation note (Day 4-5, 2026-09-04):** `sibyl-memory-client` is a
> Python package (`pip show` confirms 0.8.0, matching what this doc was
> verified against) — there is no Node SDK, and Drydock's backend is
> Node/TypeScript. "In-process" above is contrasted against *the MCP server*
> (a separate long-running process with its own lossy 8-tool protocol) — it
> does not mean literally the same OS process as Drydock's Express server,
> which is impossible without a language bridge. The implementation is a
> single-purpose Python script (`src/memory/sibyl_bridge.py`) that imports
> `MemoryClient` directly and calls it in-process *within that Python
> process*; Node reaches it via one spawned subprocess per call
> (`src/memory/sibylBridge.ts`), never through MCP. Every method call still
> gets full field control (`evaluated`/`acted`/`forward`/`extra`/`ts`,
> `set_reference`, etc.) — the property this section actually cares about.

### 2.2 `ts` is the incident time

`write_event(ts=...)` sets the journal timestamp. Drydock passes the
**build/deploy-check time**, not ingestion time. `event_id` (the returned
UUID) is Sibyl's internal id and is **not** Drydock's idempotency key
(that's `incident_id`, §6).

---

## 3. Tier map

| Drydock concept | Sibyl tier | Primitive | Key |
|---|---|---|---|
| One incident (what failed, on which build, when) | COLD | `write_event` | `extra.incident_id` (our key; `event_id` is Sibyl's) |
| A failure *pattern* — the rollup of all incidents sharing a cause | WARM | `set_entity` | `category="failure-pattern"`, `name=<pattern_id>` |
| Idempotency ledger — one row per incident key we've accepted | WARM | `set_entity` | `category="incident-ledger"`, `name=<incident_id>` |
| Canonical description of a known pattern (the comparison anchor) | REFERENCE | `set_reference` | `key="pattern/<pattern_id>"` |
| The scan running right now | HOT | `set_state` | `key="scan/active"` |
| A retired pattern | ARCHIVE | `archive_entity` | (from WARM `failure-pattern`) |

> The brief uses `kind="failure-pattern"`; Sibyl's parameter is `category`.
> Same thing — `category` is the entity's kind/namespace.

---

## 4. Identity & content hashing

Two derived values travel with every incident.

### 4.1 `incident_id` — the idempotency key

Deterministic, client-derived, stable across retries of the *same* detected
failure:

```
incident_id = "inc_" + sha256(canonical([
    pattern_id,                 # which cause
    build_fingerprint,          # commit_sha + "@" + build_number
    failure_locator,            # normalised: <artifact path> "#" <rule id>
]))[:32]
```

The same failure re-detected in a retried scan produces the same
`incident_id`. Two genuinely different failures on the same build (different
locator) produce different ids.

### 4.2 `content_hash` — the tamper / change check

```
content_hash = sha256(canonical_json({
    "pattern_id":   ...,
    "build":        { "commit": ..., "branch": ..., "target": ..., "build_number": ... },
    "failure":      { "kind": ..., "locator": ..., "severity": ..., "signal": <evidence.signal only> },
    "schema_version": 1
}))
```

**Canonicalisation:** JSON, `sort_keys=True`, no insignificant whitespace,
UTF-8, `\n` newlines only.

**Deliberately excluded** (incidental / transport-added / non-deterministic —
must not affect the hash): `ts` / ingestion time, `event_id`, scan run id,
retry counter, reconciliation timestamps, and **`evidence.match_rationale` /
`evidence.match_confidence`** — those are LLM-reasoning-step output (§8.2) and
vary between runs on the same build, so they are audit metadata, never part
of incident identity. Only the deterministic `evidence.signal` is hashed.

Per the idempotent-write-safety rule: compare **content**, not just the
presence of the key.

---

## 5. Record schemas

### 5a. COLD — incident event (`write_event`)

One event per incident. The four slots carry:

| Slot | Contents |
|---|---|
| `evaluated` | What the check looked at. `{ build: {commit, branch, target, build_number, built_at}, scanner: {name, version}, inputs: [<what was scanned>] }` |
| `acted` | The failure itself. `{ kind: <pattern_id>, summary: <one line>, locator: <artifact#rule>, severity: "low"\|"med"\|"high"\|"critical", evidence: { signal: <redacted snippet>, match_rationale: <the LLM reasoning step's explanation for why this build matches this pattern — §8.2>, match_confidence: <0..1> }, blocked_deploy: <bool> }` |
| `forward` | Disposition. `{ status: "open"\|"resolved"\|"accepted-risk", remediation: <text or ref>, owner: <handle\|null>, resolved_at: <ts\|null> }` |
| `extra` | Linkage + idempotency. `{ incident_id, content_hash, pattern_id, reference_key: "pattern/<pattern_id>", schema_version: 1, quarantine: false }` |
| `ts` | Deploy-check time (§2.2). |

A **collision** event (§7) reuses this shape with
`acted.kind = "incident-id-collision"` and `extra.quarantine = true`.

### 5b1. WARM — `failure-pattern` entity (`set_entity`)

`category="failure-pattern"`, `name=<pattern_id>` (e.g.
`exposed-key-in-build-output`). The body is a **rollup**, always the output
of the pure reconciliation function (§8) — never edited in place:

| Field | Meaning |
|---|---|
| `pattern_id` | Stable slug; equals `name`. |
| `reference_key` | `"pattern/<pattern_id>"` — pointer to the REFERENCE anchor (§5c). |
| `first_seen_ts` / `last_seen_ts` | Min / max incident `ts` (deduped by `incident_id`). |
| `incident_count` | Count of distinct `incident_id`s. |
| `incident_ids` | Sorted list of distinct `incident_id`s. |
| `open_incident_ids` / `resolved_incident_ids` | Partition by each incident's latest `forward.status`. |
| `severity_ceiling` | Max severity across incidents. |
| `status_note` | Free text (last reconcile summary, exceptions). |
| `schema_version` | `1` |

Entity-level `status=` param: `"active"` | `"muted"` | `"retired"`.

### 5b2. WARM — `incident-ledger` entity (`set_entity`)

`category="incident-ledger"`, `name=<incident_id>`. This is the
**seen-record store** the idempotency check needs — Sibyl's journal is
append-only and has no "get event by our key", so Drydock keeps its own
keyed index:

| Field | Meaning |
|---|---|
| `incident_id` | Equals `name`. |
| `content_hash` | The hash accepted under this key (§4.2). |
| `event_id` | The COLD `event_id` returned by the first successful `write_event`. |
| `status` | `"open"` \| `"resolved"` \| `"collision"` |
| `pattern_id` | Denormalised for reconciliation lookup. |
| `first_written_ts` | When Drydock first accepted this key. |
| `collisions` | Append-only list of `{seen_at, incoming_hash, quarantine_event_id}` (only if `status="collision"`). |
| `schema_version` | `1` |

### 5c. REFERENCE — canonical pattern doc (`set_reference`)

`key="pattern/<pattern_id>"`. This is the **comparison anchor** for the
known-vs-novel decision (§8.2). The `detection` block is **anchor text for an
LLM reasoning step**, not a rule engine — it describes the *cause* in
substantive terms so a new build can be judged for genuine similarity, not
keyword overlap. Cheap structured `prefilters` exist only to shortlist
candidates before that reasoning step runs; they never decide.

`body` (dict → stored as canonical JSON; caller `json.loads` on read):

| Field | Meaning |
|---|---|
| `pattern_id` | Slug; matches the entity `name` and the key suffix. |
| `title` | Human name. |
| `detection` | Anchor text for the reasoning step (§8.2), a dict of prose fields — see below. |
| `canonical_remediation` | The fix, in prose. |
| `severity_default` | Severity to assign when no incident-specific signal overrides. |
| `references` | Links: runbooks, advisories, CVEs, prior post-mortems. |
| `pattern_version` | Bumped when `detection` or remediation changes. |
| `content_hash` | Hash of the doc body (change detection for the anchor itself). |
| `created_ts` / `updated_ts` | — |
| `retired_at` | Set on retirement (§5e); `null` otherwise. |

**`detection` sub-fields** (all prose except `prefilters`):

| Sub-field | Meaning | Example — `exposed-key-in-build-output` |
|---|---|---|
| `mechanism` | The causal story — what goes wrong and *why*, not the symptom. | "A build step interpolates a secret into output that is then persisted or shipped — logs, a bundled artifact, a cached layer — because the step treats the value as ordinary config." |
| `distinguishing_evidence` | What a build exhibiting this looks like, described **conceptually** (never a regex). | "A high-entropy, credential-shaped string appears in an artifact or log that survives the build and is readable outside the build sandbox." |
| `not_this_pattern` | Negative anchors — nearby patterns it's confused with, and the distinction. This is what forces the reasoning step to be substantive. | "vs. `secret-in-source`: there the key is committed to the repo; here it's absent from source and only appears at build time. vs. `verbose-error-leak`: that's PII / stack traces, not credentials." |
| `canonical_incident` | One real past incident as a worked example: `{ summary, build_context, incident_id }`. | — |
| `prefilters` *(optional)* | Cheap structured hints to shortlist candidates only. `{ artifact_kinds: [...], cues: [<substring / coarse keyword>] }` | `{ artifact_kinds: ["build-log", "bundle"], cues: ["token", "key", "secret", "PRIVATE KEY"] }` |

`metadata=` param: `{ pattern_id, entity_ref: "failure-pattern/<pattern_id>", schema_version: 1 }`.

### 5d. HOT — scan working context (`set_state`)

`key="scan/active"` (single in-flight scan; use `scan/<build_id>` if Drydock
ever runs concurrent scans). Overwritten as the scan progresses; reset to an
idle sentinel when done (no `delete_state`).

| Field | Meaning |
|---|---|
| `build` | `{ build_id, commit, branch, target }` |
| `phase` | `"idle"` \| `"enumerating"` \| `"matching"` \| `"classifying"` \| `"flushing"` \| `"done"` |
| `started_ts` / `updated_ts` | — |
| `signals_collected` | Raw signals pulled from this build. |
| `shortlist` | `[{ pattern_id, reference_key }]` — candidates from the prefilter stage (§8.2.1), before the reasoning step. |
| `candidate_matches` | `[{ pattern_id, reference_key, confidence, rationale }]` — output of the reasoning step (§8.2.2). `rationale` is the LLM's explanation of *why* the build matches this pattern; it is copied into the incident's `acted.evidence.match_rationale` on flush for a permanent audit trail. |
| `new_pattern_candidates` | `[{ signal, reasoning }]` — signals the reasoning step judged to match no known pattern. |
| `incidents_drafted` | `[{ incident_id, content_hash, pattern_id }]` — computed but **not yet** written to COLD. |
| `verdict` | `"pending"` \| `"clean"` \| `"blocked"` |
| `schema_version` | `1` |

Idle sentinel: `{ "phase": "idle", "schema_version": 1 }`.

### 5e. ARCHIVE — retirement only

When a pattern is permanently fixed / structurally impossible, call
`archive_entity("failure-pattern", pattern_id, reason=...)`. The rollup moves
to `archived_entities` (recoverable, out of active recall/search). The
REFERENCE doc is kept (mark `body` with a `retired_at`) so historical
incidents still resolve their anchor. Drydock does not write ARCHIVE
directly beyond this call.

---

## 6. Write path — three-way idempotency classification

Applied to **every incident write**, before it reaches COLD. From the
idempotent-write-safety pattern: classify three ways on **content**, never
just on key presence.

```
record_incident(incident_payload):
    incident_id  = derive_incident_id(incident_payload)      # §4.1
    content_hash = derive_content_hash(incident_payload)     # §4.2

    # (1) AUTHORISATION FIRST — before any existence-revealing lookup,
    #     so an unauthorised caller can't probe which incident_ids exist.
    assert caller_may_file_incidents_for(incident_payload.target)

    ledger = get_entity("incident-ledger", incident_id)      # may be NotFound

    if ledger is None:
        # NEW incident.
        event_id = write_event(
            evaluated=..., acted=..., forward=..., ts=incident_time,
            extra={ incident_id, content_hash, pattern_id,
                    reference_key, schema_version: 1, quarantine: False },
        )
        set_entity("incident-ledger", incident_id, {
            incident_id, content_hash, event_id,
            status: "open", pattern_id,
            first_written_ts: now(), schema_version: 1,
        })
        reconcile_and_store_pattern(pattern_id)              # §8
        return { outcome: "recorded", event_id }

    if ledger.body.content_hash == content_hash:
        # LEGITIMATE RETRY — same key, same content.
        return { outcome: "already_recorded", event_id: ledger.body.event_id }

    # COLLISION — same key, different content. Do NOT overwrite the ledger,
    # do NOT write into the normal incident stream, do NOT pick a winner.
    q_event_id = write_event(
        acted={ kind: "incident-id-collision", incident_id,
                stored_hash: ledger.body.content_hash,
                incoming_hash: content_hash,
                incoming_payload: incident_payload },
        extra={ incident_id, quarantine: True, schema_version: 1 },
        ts=now(),
    )
    set_entity("incident-ledger", incident_id, {
        **ledger.body,
        status: "collision",
        collisions: ledger.body.get("collisions", []) + [
            { seen_at: now(), incoming_hash: content_hash,
              quarantine_event_id: q_event_id }
        ],
    })
    return { outcome: "collision", quarantine_event_id: q_event_id }
```

### 6.1 Crash window

`write_event` then `set_entity` is two calls. A crash between them leaves the
ledger unwritten; the retry re-enters the `ledger is None` branch and writes
a **second COLD event with the same `incident_id`**. This is tolerated
because:

- COLD is append-only anyway, and
- reconciliation (§8) dedupes events by `incident_id`, keeping the earliest
  `event_id`.

So a crash-induced duplicate event is harmless to every downstream number.
Document it; don't try to make the two writes atomic (Sibyl gives no
cross-call transaction).

---

## 7. Pure reconciliation of the pattern rollup

The `failure-pattern` entity body (§5b1) is **never** mutated incrementally
(`count += 1` is unsafe under retries and out-of-order flushes). It is
recomputed by a pure function whose every input is passed explicitly — no
querying ambient state mid-computation.

```
reconcile_pattern(
    pattern_id:       str,
    incident_events:  list[Event],   # ALL COLD events tagged this pattern_id
    reference_doc:    dict | None,   # current REFERENCE anchor
    seed:             dict | None = None,
) -> (entity_body: dict, exceptions: list[dict])
```

- **Input source:** `incident_events` is gathered by the caller via
  `read_events(since=…, until=…)` (deterministic, time-ordered) filtered
  client-side on `extra.pattern_id` — **not** `memory_search` (FTS, gated,
  fuzzy). Paged by `ts` window for patterns with many incidents.
- **Dedup:** collapse events by `extra.incident_id`; on duplicates keep the
  one with the earliest `ts` (tie-break: lexically smallest `event_id`).
  Quarantine events (`extra.quarantine == true`) are excluded from all
  counts.
- **Derivation:** `incident_count`, `first_seen_ts`, `last_seen_ts`,
  `severity_ceiling`, and the `open` / `resolved` partition (from each
  incident's latest `forward.status`) are all computed with sort + set
  operations only — **order-independent by construction**.
- **Exceptions returned, not thrown:** e.g. an event whose `pattern_id` has
  no REFERENCE doc → `{ kind: "unknown-pattern", incident_id }`; a severity
  value outside the enum → `{ kind: "bad-severity", incident_id }`.
- The caller then does `set_entity("failure-pattern", pattern_id,
  entity_body)` — a full-body upsert. Running it repeatedly or concurrently
  converges to the same row.

### 7.1 Property test (required before implementation ships)

Permute `incident_events` into N random orders, call `reconcile_pattern` on
each, assert **identical** `(entity_body, exceptions)` every time. If this
test needs heavy mocking, the function is still reading ambient state and
isn't pure yet.

---

## 8. Query flows

### 8.1 Checking a new deploy (HOT lifecycle)

1. `set_state("scan/active", { build, phase: "enumerating", started_ts, schema_version: 1 })`.
2. Extract build signals → `set_state` with `signals_collected`, `phase: "matching"`.
3. Load anchors: read every REFERENCE `pattern/*` doc (SDK `get_reference`;
   `memory_search` over the `reference` tier may pre-narrow which docs to
   load but is not authoritative).
4. **Two-stage match (§8.2)**, `phase: "classifying"`:
   a. *Prefilter* — for each pattern, keep it as a candidate if any collected
      signal touches its `detection.prefilters` (`artifact_kinds` overlap or a
      `cues` substring hit). Deterministic. Write the survivors to
      `shortlist`.
   b. *Reasoning step* — one LLM call comparing the build's
      `signals_collected` against each shortlisted pattern's `detection`
      anchor text (`mechanism`, `distinguishing_evidence`,
      `not_this_pattern`, `canonical_incident`). It returns, per shortlisted
      pattern, `{ pattern_id, confidence, rationale }` for a match or nothing;
      unexplained signals go to `new_pattern_candidates`. Write
      `candidate_matches` + `new_pattern_candidates`.
5. For each `candidate_matches` entry above the confidence floor, compute
   `incident_id` + `content_hash` and add to `incidents_drafted`, carrying
   the `rationale` and `confidence` through. **Nothing is written to COLD
   yet.**
6. Scan ends → set `verdict`, `phase: "flushing"`, then:
   a. For each drafted incident → `record_incident(...)` (§6).
   b. For each affected `pattern_id` → `reconcile_pattern(...)` → `set_entity`.
   c. For each operator-confirmed `new_pattern_candidate` → `set_reference`
      the new anchor + seed a `failure-pattern` entity.
   d. `set_state("scan/active", { phase: "done", verdict, ... })`, then reset
      to the idle sentinel.

### 8.2 Known vs. novel — the two-stage match

"Is this build's failure a known cause or something new" is decided in two
stages. The first is a cheap deterministic filter; the second is the actual
judgement.

#### 8.2.1 Prefilter — shortlist (deterministic)

For every REFERENCE `pattern/*` doc, keep it as a candidate if any collected
build signal overlaps its `detection.prefilters` — an `artifact_kinds` match
or a `cues` substring hit. Pure string/set work, no LLM, no network. This
only *narrows* the set the reasoning step considers; a pattern with no
`prefilters` is always a candidate. A false negative here is a real miss, so
`cues` are kept loose. Output → HOT `shortlist`.

#### 8.2.2 Reasoning step — attribute (LLM, authoritative)

One LLM call. Input: the build's `signals_collected` plus, for each
shortlisted pattern, its `detection` anchor text — `mechanism`,
`distinguishing_evidence`, `not_this_pattern`, `canonical_incident`. The
prompt asks for *substantive* similarity (same underlying cause) and
explicitly uses `not_this_pattern` to push back on surface resemblance.

Output, per shortlisted pattern:

```
{ "pattern_id": <slug>, "confidence": <0..1>, "rationale": <2–4 sentences:
  why this build exhibits this cause, citing the specific signal and the
  anchor field it matches> }
```

plus a list of `signals_collected` entries the step could not attribute to
any shortlisted pattern → `new_pattern_candidates` (each with its own
`reasoning`).

- **Match** (`confidence ≥ floor`, default `0.6`): the incident is attributed
  to that `pattern_id`. The WARM `failure-pattern` entity then supplies
  history. The `rationale` is persisted — HOT `candidate_matches[].rationale`
  now, then copied to the COLD incident's `acted.evidence.match_rationale` on
  flush (§8.1-6a) so every attribution is auditable after the fact.
- **No match**: a `new_pattern_candidate`, escalated to an operator (Q2) who
  names the `pattern_id` and authors the REFERENCE anchor before any
  `failure-pattern` entity or `pattern/*` doc is created.

#### 8.2.3 Why not pure rules, why not pure LLM

Pure `cues`/regex collapses the schema into a keyed lookup table — it can
only recognise a recurrence that *looks* like a prior one, which defeats the
"surface differs, cause is the same" grouping the WARM tier exists for. Pure
LLM-over-every-pattern is unbounded cost per scan and needless once the
pattern set grows. The split keeps the LLM call bounded (shortlist only) and
keeps the *decision* semantic. Note Sibyl's own `memory_search` is keyword
FTS5 with an abstention gate — it cannot do this matching; the semantic
judgement lives entirely in Drydock's reasoning step, and Sibyl is the
durable anchor store.

### 8.3 Incident history for a pattern

`get_entity("failure-pattern", pattern_id)` → the rollup. Drill into
individual incidents through `incident_ids` → `read_events` filtered on
`extra.pattern_id` (or per-incident `incident-ledger` entities for the
`event_id` + status).

---

## 9. Resolved decisions

All five settled for a **hackathon-scale** build. Each notes what the
production-scale answer would be, so a later reader knows it was a scoped
choice, not an oversight.

**Q1 — `incident-ledger` stays one WARM entity per incident.** Keeps the
O(1) keyed `get_entity` lookup the idempotency check (§6) depends on. The
cost — entity count grows 1:1 with total incidents, all against the 5 MB cap
— is a non-issue at hackathon volume (hundreds of incidents ≈ tens of KB).
*Production:* collapse the ledger into a per-pattern append-only structure
with an in-memory index, or move idempotency state to a real KV store.

**Q2 — new patterns stay human-confirmed.** A `new_pattern_candidate` is
escalated to an operator who assigns the `pattern_id` slug and authors the
REFERENCE anchor text (§8.2.2) before any `pattern/*` doc or `failure-pattern`
entity exists. Auto-slugging from the first signal produces near-duplicate
patterns for one cause and pollutes the anchor set — and the anchor text
(`mechanism`, `not_this_pattern`) genuinely needs a human to write well.
Volume is low enough that a human in the loop is not a bottleneck.
*Production:* an LLM drafts the anchor + slug, a human approves in one click.

**Q3 — concurrent scans deferred.** Single `scan/active` HOT key. Drydock
checks one deploy at a time in this build; a second concurrent scan would
overwrite the first's working context. *Production:* per-build key
`scan/<build_id>` plus a `scan/index` state doc enumerating active scans.
The schema change is localised to §5d and §8.1 — no rework of COLD/WARM/
REFERENCE.

**Q4 — reconciliation input window deferred.** `reconcile_pattern` (§7)
reads the full journal via `read_events` and filters client-side on
`extra.pattern_id` — a full walk per reconcile. Fine for hundreds of events;
quadratic-ish as a pattern accumulates thousands. *Production:* a per-pattern
`last_reconciled_ts` watermark on the `failure-pattern` body + incremental
merge `reconcile(prior_body, events_since_watermark)`, which stays pure and
order-independent over the new slice. Not built now.

**Q5 — proceed on free tier, no payment, no eviction.** Accepted: COLD
events accumulate forever (there is no `delete_event` in the client, nor
`delete_state`), and the 5 MB cap is a hard ceiling across all tiers. At
hackathon scale the cap is not reached. There is deliberately **no**
retention/eviction policy — if the cap is ever hit, `set_*` and `write_event`
raise `CapExceededError` loudly (not silent data loss), which is an
acceptable failure mode for a demo. *Production:* an uncapped tier
(`sync`/`team`/…), or roll old resolved incidents into an aggregate count on
the pattern body and accept the orphaned COLD events.
