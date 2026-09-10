# Drydock — Plan

Originally scoped as an 8-day build; running longer as real work lands.
**Days 1, 3, 4, 4-5(second half), and 6 reflect real work done and
independently verified (real on-chain payments, real Sibyl writes, real LLM
calls); Day 2 is in-progress groundwork; Days 7–9 are provisional** and will
tighten as the earlier days land.

---

## Day 1 — Skeleton + Sibyl memory schema ✅ COMPLETE

- Repo skeleton: Express backend (`src/`), Next.js frontend (`web/`), `docs/`,
  `scripts/`. Config only, no deps installed.
- `sibyl-memory-mcp` installed; tier situation investigated and documented
  (free tier, no "Pro" tier exists — see `docs/architecture.md` banner).
- Deployment-incident storage schema designed end-to-end in
  `docs/architecture.md`: COLD/WARM/REFERENCE/HOT tier mapping, content-hash
  idempotency (3-way classification), pure reconciliation, two-stage
  known-vs-novel match. All §9 decisions resolved for hackathon scale.
- **No implementation** — schema is reviewed and frozen; code starts Day 3+.

---

## Day 2 — Base chain config + x402 payment SDK groundwork 🔨 IN PROGRESS

- `wallet-chain-validation` skill applied: real Base `ChainConfig` (chain id,
  hex, native currency = ETH, RPC, explorer) sourced from the x402 SDK's own
  `EVM_NETWORK_CHAIN_ID_MAP` + a working sibling integration (Metron), not
  hand-typed. → `web/src/lib/chain.ts`.
- `x402-payment-integration` skill, steps 1 & 3:
  - Step 1 — read the actual installed x402 SDK source (`@x402/*` v2.23,
    `@coinbase/x402` v2.1) before writing any integration. Findings reported.
  - Step 3 — identified the layered "test a payment directly, bypassing
    UI/wallet/proxy" ladder for debugging later (headless private-key signer →
    manual payload → direct facilitator → pure signature).
- **Not done this day:** the `ensureChain` guard, x402 middleware wiring, or
  any payment test harness — those are Day 3 (report-and-confirm gate first).

---

## Day 3 — x402 payment integration ✅ COMPLETE

- ✅ Server-side flat deploy-fee gate — `src/payment.ts` (`@x402/express`
  `paymentMiddleware` + `x402ResourceServer` + `HTTPFacilitatorClient`),
  wired in `src/server.ts` at `GET /deploy/pay`. Explicit `{asset,amount}`
  price + `extra:{name,version}`.
- ✅ `ensureChain` wallet guard — `web/src/lib/ensureChain.ts` (Base Sepolia).
- ✅ Headless Layer-1 test — `scripts/test-x402-sepolia.mjs` (`npm run test:x402`).
  Also runs a Layer-3 direct-facilitator `verify` probe so it reports *why*, not
  just *that*.
- ✅ Facilitator: **public x402 reference facilitator** (`https://x402.org/facilitator`,
  no auth, supports `eip155:84532`). Coinbase's (`api.cdp.coinbase.com`) is
  unreachable from the build env and is the mainnet-only path.
- ✅ **Real settlement on Base Sepolia, 2026-09-01: 19/19 assertions pass.**
  Buyer wallet funded (20 test USDC), payment settled — tx
  `0x254c981aa253edc37cec7d72e1c1eb824d723fa1beaae4518b47e04245f2b9d6`
  (block 46250828, status 0x1). On-chain balances confirm 0.01 USDC moved
  buyer → seller. Facilitator `0xd407e409…` submitted + paid gas.

## Day 3.5 — carry-forward before Day 4

- Mainnet path: set `X402_FACILITATOR_URL` to Coinbase's + provide
  `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`, flip both network vars to
  `eip155:8453`. Needs an env with route to `api.cdp.coinbase.com`.
- Replace the throwaway `DRYDOCK_SELLER_ADDRESS` with a real receiving address.
- `resourceServer` settlement hooks (`onAfterSettle` etc.) are exported but not
  attached — Day 4 hooks the deploy pipeline in there.

## Day 4 — Deploy pipeline ✅ COMPLETE (first half)

- ✅ Dumb, ungated pipeline: `POST /deploy` (zip in) → `src/deploy/pipeline.ts`
  extracts to `deploys/<id>/`, in-memory `Map` state store (mirrors
  Valiquo/Metron's original build order — Postgres comes later).
- ✅ Host choice — **Netlify, zip-deploy REST API** (`src/deploy/hosts.ts`):
  one token, one POST with the whole site as a zip, no per-file manifest/JWT
  dance (Vercel/Cloudflare Pages need that). `LocalStaticHost` kept as the
  zero-account fallback (`DRYDOCK_STATIC_HOST=local`) for offline/CI runs.
- ✅ `onAfterSettle` wired to the deploy trigger (`src/deploy/settlement.ts`),
  gated on `context.result.success` — per the Day 3 finding that a
  facilitator soft-failure (`{success:false}`, not thrown) only ever reaches
  `onAfterSettle`, never `onSettleFailure`. `markPaid` is a CAS
  (`awaiting_payment` → `paid`) so a re-fired hook can't double-deploy.
- ⚠️ Two Netlify integration bugs found and fixed only by actually driving a
  real deploy (not visible from docs or a dry run):
  - `POST /sites` does **not** accept a zip body — the original "create +
    deploy in one call" attempt silently created an empty site with no
    deploy. Fixed to the documented two-step flow: `POST /sites` (JSON) →
    `POST /sites/{id}/deploys` (zip).
  - This Netlify account's plan (`nf_team_dev`) creates every new site with
    `sso_login: true` scoped `"all"` — visitor traffic gets Netlify's
    "Login Redirect" page (HTTP 401) on the *production* URL, not just
    previews. Invisible to Drydock's own polling (which only checks deploy
    `state`, not a real fetch). Fixed with a `PATCH /sites/{id}
    {sso_login:false}` right after site creation, folded into
    `NetlifyStaticHost.deploy()` so no manual step is needed per deploy.
- ✅ **Real end-to-end run, 2026-09-04, `npm run test:deploy` against the live
  Netlify path: 16/16 assertions pass.** Real 0.01 USDC payment on Base
  Sepolia — tx `0xbf8084f62cfbac6424bc26ce0723f98beb7cd892a09f1b85a49005dc679f29fa`
  (block 46381657, status success, verified independently via a direct RPC
  read of the USDC `Transfer` log: `0xaFD87…95A8` → `0x4Aa76…9E8AF`, 0.01
  USDC, facilitator `0xd407e4…` paid gas) → `onAfterSettle` fired → site
  published to **`https://drydock-d68d2ed5.netlify.app`** — fetched directly
  (not through the test harness) and confirmed 200 with the real HTML
  (`drydock:sample-site-v1` marker) and a 200 `style.css` with real CSS.
- Not done (Day 4 second half / Day 5, per the brief): no memory-check
  gating, no ownership recording, no Sibyl writes — scan output isn't even
  produced yet. This half was strictly folder-in → paid → live.

## Day 4-5 second half — Sibyl write + query paths ✅ COMPLETE (standalone)

Per `docs/architecture.md` (final schema, all §9 decisions resolved).
**Not wired to the deploy pipeline or the payment gate yet — Day 6.**

- ✅ Sibyl access is a Python subprocess bridge, not literally in-process —
  `sibyl-memory-client` has no Node SDK. `src/memory/sibyl_bridge.py` (one
  JSON-in/JSON-out call per invocation) + `src/memory/sibylBridge.ts` (typed
  Node wrapper). Still "SDK, not MCP" per the §2.1 finding — see the
  architecture.md §2.1 implementation note for why this satisfies that
  finding despite not being one OS process.
- ✅ `src/memory/identity.ts` — `incident_id` / `content_hash` derivation,
  §4.1/§4.2, canonical JSON (sorted keys) + sha256, matching the Python
  `json.dumps(sort_keys=True)` convention byte-for-byte.
- ✅ `src/memory/reconcile.ts` — pure `reconcilePattern` (§7): dedup by
  `incident_id` (earliest ts wins), quarantine exclusion, order-independent
  by construction. `scripts/test-reconcile-property.mjs` — the §7.1-required
  property test — **200/200 random permutations produced identical output**,
  plus baseline sanity assertions (dedup-keeps-earliest, bad-severity
  exception, quarantine exclusion) all pass.
- ✅ `src/memory/incidentRecorder.ts` — `recordIncident` (§6): the three-way
  classification (new / legitimate-retry / collision-quarantine), reconcile
  triggered on every new write. `assertAuthorized` is a documented no-op
  today (no caller/ownership model exists until Day 6 wires this to the
  payment gate's payer).
- ✅ `src/memory/patternMatch.ts` — the two-stage match (§8.2):
  `prefilterShortlist` (pure, deterministic, cue/artifact-kind substring
  match) → `reasoningStep` (one Claude Opus 5 call, structured output via
  `zodOutputFormat`, prompted per §8.2.2 to judge substantive mechanism
  match and explicitly use `not_this_pattern` against surface resemblance).
  `checkBuildAgainstKnownPatterns` orchestrates both stages and writes HOT
  `scan/active` at each phase (§5d), including `candidate_matches[].rationale`
  for the audit trail — not reset to idle since the flush/reset (§8.1-6) is
  Day 6 (no COLD writes happen from the query path itself; §8.1 step 5
  is honored literally).
- ✅ **Real end-to-end test, 2026-09-04, `npm run test:sibyl` — 12/12
  assertions pass**, against the live `~/.sibyl-memory/memory.db` (confirmed
  a real durable SQLite file, 438 KB) and live Claude Opus 5 calls:
  - Authored the REFERENCE anchor `pattern/exposed-key-in-build-output`
    (the exact worked example from architecture.md §5c) — the Q2
    human-confirmed step.
  - Wrote one real incident → `outcome: "recorded"`. Retried the identical
    payload → `outcome: "already_recorded"`, same `event_id`. Wrote the same
    key with different content → `outcome: "collision"`, ledger untouched,
    quarantine event written — all three branches of §6 demonstrated for
    real, not just asserted in code.
  - WARM `failure-pattern` rollup reconciled correctly after the write
    (`incident_count`, `severity_ceiling`, etc.).
  - Query test 1 (**should match**, deliberately different surface wording
    than the incident above — "a live OAuth refresh token pulled in via an
    environment substitution during the webpack build" vs. the incident's
    "AWS_SECRET_ACCESS_KEY printed by `env`"): matched
    `exposed-key-in-build-output` at **confidence 0.95**, rationale citing
    the specific mechanism/distinguishing_evidence/not_this_pattern fields
    it matched on.
  - Query test 2 (**should NOT match** — shares surface cues, "Stripe secret
    key", with the pattern's own `prefilters.cues`, so the prefilter
    correctly shortlists it, but the underlying cause is `secret-in-source`
    — committed to the repo, not build-time — exactly the case
    `not_this_pattern` calls out): **no match**, correctly routed to
    `new_pattern_candidates` with reasoning citing `not_this_pattern`
    explicitly. Re-ran the whole script a second time — same correct
    verdicts both times, wording of the LLM's rationale varies run to run
    (as expected, since it's not hashed — §4.2) but the classification
    doesn't.
  - This is real evidence the reasoning step is judging cause, not doing
    keyword lookup: both test builds passed the *same* cue-based prefilter,
    and only the one whose cause genuinely matched the anchor's `mechanism`
    was accepted.

Not done at the time (correctly out of scope then): no HTTP endpoint, no
wiring into `onAfterSettle` or the deploy pipeline, no real pre-deploy
signal extraction (test signals were hand-authored) — all landed Day 6,
below.

## Day 6 — Wire the memory-check gate into the deploy flow ✅ COMPLETE

Sits between payment confirmation and the deploy actually going live.
**Non-blocking relative to payment** — the reframed x402 principle carried
over from the payment gate itself: the gate controls whether the DEPLOY
proceeds, never whether the PAYMENT does.

- ✅ `src/memory/signalExtraction.ts` — real signal extraction, replacing Day
  4-5's hand-authored test signals. Walks the actual extracted deploy
  folder, skips binaries, classifies each file's `artifact_kind`
  (`build-log`/`bundle`/`source`) by path/extension, hands raw file text to
  the existing §8.2 prefilter + reasoning pipeline unchanged — no new
  secret-detection heuristics; that judgement stays entirely in the already-
  built two-stage match.
- ✅ `src/memory/deployGate.ts` — orchestrates extraction + the two-stage
  match. Known patterns are enumerated from WARM `failure-pattern` entities
  via `list_entities` (newly added to the bridge) rather than hardcoded —
  closes the TODO left in Day 4-5's `patternMatch.ts`. **Fail-closed
  decision** (not in the brief, flagged explicitly): if the gate check
  itself throws, the deploy does NOT proceed — a security gate that opens on
  its own failure defeats its purpose. Surfaced on the record as `blocked`
  with no `gate` result, distinguishable from a genuine pattern match.
- ✅ `src/deploy/pipeline.ts` — new `"blocked"` state, `gate` field (set
  regardless of verdict — a clean deploy's record shows what was checked,
  not just `live`), `blockDeploy` (CAS `paid -> blocked`, same idempotency
  pattern as `markPaid`/`runDeploy` against a re-fired settlement hook).
- ✅ `src/deploy/settlement.ts` — the actual wiring:
  `onAfterSettle(success) -> markPaid (unconditional, payment already
  committed) -> checkDeployAgainstKnownPatterns -> clean: runDeploy (Day 4
  behavior unchanged) | blocked: blockDeploy, host.deploy is never called`.
  No override/manual-proceed flow (Day 7 UI concern, not built).
- ✅ **Two real end-to-end runs, 2026-09-04, `npm run test:gate` — 22/22
  assertions pass**, both against the live server with real Base Sepolia
  payments (verified independently via direct RPC reads of each
  settlement's USDC `Transfer` log, both `status: success`):
  - **Run 1 (clean)** — `sample-site` (the real Day 4 fixture) pays (tx
    `0xb8ea59f4…9663d3`, block 46382837) → gate runs (2 signals extracted, 1
    known pattern checked) → verdict `clean`, no top match → deploys →
    **`https://drydock-4a6aa621.netlify.app`** — fetched independently
    outside the harness, 200, real content.
  - **Run 2 (blocked)** — a new fixture, `leaked-key-site/` (real
    `index.html`/`style.css` plus a `build.log` containing a real
    AWS-documentation-example credential pair leaked via `RUN env >>
    build.log`, i.e. an actual instance of the `exposed-key-in-build-output`
    mechanism, not a copy of Day 4-5's test wording) pays (tx
    `0x3b989070…8174e8014`, block 46382845) → gate runs (3 signals
    extracted) → **matched `exposed-key-in-build-output` at confidence
    0.95** → `blockDeploy` fires → `url`/`host` stay `null` → confirmed
    independently that Netlify never created a site for this deploy
    (`drydock-63780e62.netlify.app` → 404). Rationale, in full:
    > "Step 5/9 runs `RUN env >> /app/dist/build.log`, interpolating the
    > build environment — including AWS_ACCESS_KEY_ID and
    > AWS_SECRET_ACCESS_KEY — into a file inside the published dist/
    > directory, which is then copied to /output/ and staged alongside
    > index.html and style.css. This is exactly the mechanism: a build step
    > treats secrets as ordinary config and persists them into a shipped
    > artifact. The credentials are absent from source (index.html and
    > style.css are clean), so this is not secret-in-source, and the leaked
    > content is credential-shaped rather than PII/stack traces, ruling out
    > verbose-error-leak."
- ✅ `scripts/test-reconcile-property.mjs` is now a real npm script,
  `test:reconcile-property` (was runnable directly but not wired in).
- ✅ **Rough latency, `scripts/measure-sibyl-latency.mjs`, single real run
  (not averaged — see the caveats in Day 9's risk note below)**:
  - bare Python-bridge round trip (spawn + trivial op): **~300-330 ms**,
    dominated by Python interpreter startup, not the SQLite op itself.
  - one full write (`recordIncident`, ~5-6 bridge calls): **~2.4 s**.
  - one full query (`checkBuildAgainstKnownPatterns`, ~5 bridge calls + 1
    Claude Opus 5 call): **~8.0 s**, of which the LLM reasoning step alone
    was **~5.2 s** and the bridge-only portion **~2.8 s**.
  - **one full write + query round trip: ~10.4 s.** The per-call ~300 ms
    subprocess-spawn overhead is the real risk factor as pattern count
    grows (today: 1 known pattern, 1 `get_reference` call; N patterns loaded
    individually would add ~300 ms × N) — see the Day 9 risk-list note.

Not done (correctly out of scope): no override/manual-proceed path, no
ownership recording — Day 7+.

## Day 6.5 — /dashboard backend gap ✅ COMPLETE

Built before the frontend so page 5 (`/dashboard`) isn't blocked later. See
`docs/frontend-plan.md` §7. Three read/write endpoints + one wiring fix.

- ✅ **Gate → incident wiring** (`src/memory/recordBlockedDeploy.ts`): a
  blocked deploy now also calls `recordIncident` (§6), so the
  incident-memory activity log reflects real gate activity, not just Day 4-5
  test data. **This was Claude's call, not in the Day 6 brief** —
  `GET /incidents` is not a real feature without it. The block is the
  primary effect; a failed incident write is logged and swallowed (never
  un-blocks or fails the deploy), and only the settlement-hook call that
  actually did the `paid → blocked` transition records the incident (a
  re-fire does not double-write; idempotency §6 would catch it anyway). The
  incident's `build` fingerprint is deploy-id-derived (no git metadata in a
  zip upload) and the locator is synthetic (`deploy/<id>#gate.<pattern_id>`)
  — honest about being deploy-scoped, not a fake file:line.
- ✅ `GET /patterns` — `list_entities("failure-pattern")` rollups joined
  best-effort with each pattern's REFERENCE anchor for `title` + `mechanism`
  prose.
- ✅ `GET /incidents?limit=` — recent COLD journal events (`read_events`),
  mapped to a compact shape with a `type` discriminator (`incident` |
  `collision`), newest-first, `limit` clamped to [1, 500].
- ✅ `POST /deploy/:id/redeploy` — new deploy from a prior one's retained
  `src.zip` (falls back to reading `deploys/<id>/src.zip` off disk when the
  in-memory record is gone after a restart). `:id` validated as a UUID
  before any disk touch. Returns the same shape as `POST /deploy`; the new
  record carries `redeployOf`. Flows through payment + gate again from scratch.
- ✅ `GateResult` gained `scannedFiles: string[]` (the extractor's file
  list, surfaced on the deploy record and fed to the incident's `inputs`);
  `BuildSignal` gained an optional `path`.
- ✅ **Tests — 49/49 assertions across two real suites:**
  - `npm run test:dashboard` (24/24) — `/patterns` + `/incidents` shape and
    behavior (title join, mechanism prose, newest-first, limit clamp),
    `/redeploy` (new id, `redeployOf` back-pointer, same fileCount, 404 on
    unknown id, 400 on malformed id). No payment needed.
  - `npm run test:gate` re-run (25/25, was 22 — 3 new) — a blocked deploy
    (real Base Sepolia payment, tx `0x3b989070…` class) now also produces a
    real Sibyl incident carrying the LLM rationale, confidence 0.96, and
    `blockedDeploy: true`, retrievable via `GET /incidents`. Clean path
    still deploys to a real Netlify URL.

## Day 7 — Frontend (in progress)

- Build order: `/` → `/how-it-works` → `/try-it` → `/docs` → `/dashboard`.
  Full route/component/token plan in `docs/frontend-plan.md`.
- ✅ **Page 1 (`/` landing) built 2026-09-05** — shell (`layout.tsx`,
  `Nav`, `Footer`, Drydock teal token set), primitives (`Reveal`, `Card`,
  `Button`, `EyebrowLabel`), and marketing sections (`Hero`,
  `ProblemSection`, `HowItWorksPreview`, `DemoTerminal`) from the pasted
  HTML mockup. `next build` clean; renders on `next dev` :3001. The demo
  terminal replays a real `test:gate` block transcript, not a scripted
  fiction. Nine flagged deviations from the mockup (latency `<4s`→`~8s`,
  ownership claims softened to on-chain *settlement* since ownership
  recording is unbuilt, how-it-works reordered to Pay-before-Check to match
  the real gate, GitHub icon, real terminal script) — all in
  `docs/frontend-plan.md` §8, all reversible.
- ✅ **Page 2 (`/how-it-works`) built 2026-09-05** — from
  `docs/frontend-plan.md`'s component list (no mockup). `PipelineDiagram`
  (real isometric SVG, 30° rhombus math + staggered pulse per the design
  skill), `MechanismSteps` (5 steps + a side-by-side "two real runs" block
  showing the clean publish and the flagged halt, both real `test:gate`
  transcripts), and a `Callout` framing payment-settles-before-the-check as
  a deliberate non-blocking design choice. `Terminal` extracted to a shared
  primitive; `Callout` added. `next build` clean.
- **RISK: `web/src/lib/payX402.ts` is new code, not a port** — Valiquo's
  `walletPay.ts` is Circle-Gateway-specific and not reusable. Drydock's
  browser wallet payment for the x402 `exact` scheme (EIP-3009
  `TransferWithAuthorization` via the public facilitator, browser signer)
  must be written fresh and **needs its own real end-to-end test** (a
  browser wallet signer producing a real 0.01 USDC Base Sepolia settlement
  through the facilitator, verified on-chain) before `/try-it` counts as
  done. See `docs/frontend-plan.md` §5.
- ✅ **payX402 browser-signer spike PROVEN 2026-09-07** —
  `scripts/spike-payx402-browser-signer.mjs`. The exact browser object graph
  (`custom(eip1193Provider)` → viem `WalletClient` → `{address,signTypedData}`
  adapter → `ExactEvmScheme`); the signature is produced by a JSON round-trip
  through `eth_signTypedData_v4`, byte-for-byte the MetaMask call. **36/36
  assertions. Real settlement tx
  `0xc79c4c12056637bce2e7ac5bab0a335a71de021ea252915bbd998156fd9b71d0`**
  (block 46508853, status success), independently confirmed off a plain
  `sepolia.base.org` RPC — USDC Transfer buyer→seller 10000 atomic, seller
  +0.01 / buyer −0.01, buyer paid no ETH (facilitator `0xd407e409…` submitted
  + paid gas). Findings for `payX402.ts`: (a) `ExactEvmScheme`'s signer is
  duck-typed `{address, signTypedData}` — a viem `WalletClient` needs the
  thin adapter (it has neither a bare `.address` nor an account-less
  `signTypedData`); (b) the public `x402.org/facilitator` intermittently
  soft-fails settlement with `invalid_exact_evm_transaction_failed` /
  "replacement transaction underpriced" (its own submitter-nonce race on
  shared Base Sepolia) — `success:false`, never throws; retrying a fresh
  payment clears it. `payX402.ts` must surface this as retryable, not fatal;
  (c) **residual unknown — browser-ORIGIN CORS on the facilitator** is not
  exercised by a Node spike (`wrapFetchWithPayment` calls the facilitator
  server-side, so the happy path is fine; close it with a real-browser run
  before shipping if any client-side `verify` is added).
- ✅ **Page 3 (`/try-it`) built + PROVEN end-to-end 2026-09-07.**
  `web/src/lib/{payX402,api,useDeploy,zipFolder,format}.ts` +
  `components/try-it/{TryItFlow,DropZone,PaymentPanel,ScanPanel,DeployResult}.tsx`
  + `primitives/{StatusPill,Hash}.tsx`. `next build` clean (`/try-it` 137 kB
  first-load — x402 + viem). Flow mirrors the backend exactly: upload →
  client-side zip → `POST /deploy` → browser wallet pays (`payX402.ts`, the
  spike's object graph) → poll `GET /deploy/:id` while the gate runs →
  live | blocked | failed. Deps added to `web/`: `@x402/{core,evm,fetch}`
  2.23.0, `viem` 2.56.1, `fflate`.
  - **Payment retry is a first-class phase.** `payDeployFee()` classifies a
    facilitator `{success:false}` as `status:"soft_failed", retryable:true`;
    `PaymentPanel` shows a warn-tone "retry payment" affordance ("no payment
    was taken", attempt counter), never an error dead-end. The deploy record
    is still `awaiting_payment` server-side, so a fresh payment on the same
    payUrl settles.
  - **Real browser e2e** — `scripts/e2e-tryit-browser.mjs` (headed Chromium
    via Playwright; `window.ethereum` = the spike's EIP-1193 shim injected
    with `page.exposeFunction`, real signing via `eth_signTypedData_v4`;
    isolated stack on :3010/:3011). **19/19 assertions.** Screenshots +
    `summary.json` in `docs/evidence/tryit-2026-09-07T13-28-34/`.
    - **FLOW A (forced retry → clean → live):**
      `scripts/fault-facilitator-proxy.mjs` soft-failed the first `/settle`;
      the UI showed the retry state (not an error); retry → real settlement
      **tx `0x97459caa020d1349e1aefce49919c7f9d90f1f6bcc1ca8314fe30aca677ac7ba`**
      (block 46509749, success), gate clean, deployed (local host), live URL
      served the real site.
    - **FLOW C (blocked → halted):** real settlement **tx
      `0xc04929a287e23b95a6562395f5e5d90d2dd292e86f0acd592f2f7a0a26107eef`**
      (block 46509756, success); gate matched `exposed-key-in-build-output`
      at 0.94 with full rationale; deploy halted, NO url; incident
      `inc_7abcc3689356ab15d0cf3b5ceb7c4814` recorded in Sibyl. Both txs
      independently confirmed off a plain `sepolia.base.org` RPC (USDC
      Transfer buyer→seller 10000 atomic; buyer paid no ETH).
  - **Residual — CORS from a browser origin to `x402.org/facilitator`:**
    now effectively closed — Flow A/C ran real payments from a real page
    origin (`http://localhost:3011`) with no CORS failure. (The client still
    never calls the facilitator directly; `wrapFetchWithPayment` only talks
    to the Drydock backend.)
- ✅ **Settlement hook made non-blocking relative to payment 2026-09-07**
  (`src/deploy/settlement.ts`). `onAfterSettle` had been `await`ing the
  whole gate + publish before the payment HTTP response flushed — collapsing
  "payment confirmed" and "memory-check verdict" into one ~10s response and
  making the scan step invisible to the client. Fixed: the hook now `await`s
  only `markPaid` (sync CAS) and returns; the gate + publish run as a
  detached `runGateAndPublish(deployId)` task (not awaited, every failure
  path logged/recorded). The record moves `paid → (deploying → live |
  failed) | blocked` on its own; the client polls for it. Restores the Day 6
  intent (the gate is non-blocking *relative to payment*).
  - `useDeploy` polls `GET /deploy/:id` every 1s after payment settles;
    `ScanPanel` shows a live wall-clock counter; `DeployResult` prints the
    frozen "on screen" duration.
  - **Re-run e2e (`docs/evidence/tryit-2026-09-07T13-47-53/`) — 25/25.**
    Timing evidence: **ScanPanel visible 11.4s (Flow A), 13.4s (Flow C)** —
    was a sub-second flash before. Mid-scan screenshots captured at the
    ~4.8s mark. New settlement txs (both confirmed on-chain, USDC
    buyer→seller 10000 atomic):
    - Flow A (retry→clean→live) **`0x0d57780bb4b8416d4f1c9342f30e52f725adc3443f1e122994a712268d828104`** (block 46510321)
    - Flow C (blocked) **`0x94cda3fc2ce67d490c74163bea2c65ddf98d8207e814a5927625c1639e94b17d`** (block 46510329); incident `inc_235b426a7aca5ebe08ca87095ea7ffa3`.
  - `test:gate` re-run against the new hook (local host): **25/25** — it
    already polled for a terminal state, so the timing shift is transparent
    to it (gate start `checkedAt` → `blockedAt` measured ~14s apart).
- ✅ **CloudflarePagesStaticHost added 2026-09-07** (`src/deploy/hosts.ts`)
  — Netlify stayed billing-locked ("don't want to pay"). Cloudflare Pages
  Direct Upload, free tier, no card. Same `StaticHost` interface; the
  pipeline is untouched. `blake3` manifest hashing is a verbatim port of
  wrangler's `hashFile` (`@noble/hashes` blake3 cross-checked against
  wrangler's `blake3-wasm` — byte-identical for all samples). Flow verified
  against workers-sdk `main` source, not docs. New: `scripts/test-cloudflare-host.mjs`
  (`npm run test:cloudflare`), `E2E_STATIC_HOST=cloudflare` flag on the
  browser e2e. Setup (Account · Cloudflare Pages · Edit token + Account ID)
  documented in `.env.example` / `docs/deploy.md`.
- ✅ **Cloudflare Pages PROVEN end-to-end 2026-09-07.** `npm run
  test:cloudflare` 6/6 (`sample-site` → `https://drydock-hosttest.pages.dev`,
  200 + real HTML + style.css). Then the full **headed-browser Flow A
  against Cloudflare** (`E2E_STATIC_HOST=cloudflare
  scripts/e2e-tryit-browser.mjs`) — **27/27**: forced facilitator retry →
  real settlement **tx `0x2a9e249643949268397f472bec76b958265d0476618f002ea9b0727dcebe05e1`**
  (block 46513833, confirmed on-chain, USDC buyer→seller 10000 atomic) →
  gate clean → published to **`https://drydock-1ecdb52b.pages.dev`**,
  independently fetched (`server: cloudflare`, sample-site marker present,
  `style.css` 200 `text/css`). Flow C blocked also passed (tx
  `0xc4ef2dcd22b7eecc4f1408d53a104aab4cbf9bd26ae9753cd962531f0ffac487`,
  incident `inc_1d51c04c606132803f5aadb47670229d`). Screenshots:
  `docs/evidence/tryit-2026-09-07T15-43-18/`.
  - **Two fixes during bring-up:** (a) the token needs the *Account*-group
    Pages·Edit permission AND the account in its resource scope — a token
    with neither shows `/accounts` → `[]` and 403s (not a clear error). (b)
    Cloudflare's `*.pages.dev` wildcard cert covers `<project>.pages.dev`
    (one label) but NOT the deeper per-deployment `<hash>.<project>.pages.dev`
    until the project's own `*.<project>` cert provisions (minutes-hours on a
    fresh project). So the host defaults to **one Pages project per deploy**
    (`drydock-<deployId8>`) and returns that project's
    `<project>.pages.dev` — a durable, immediately-valid URL per paid deploy
    (mirrors Netlify's site-per-deploy). `CLOUDFLARE_PAGES_PROJECT` forces a
    single shared project (URL = latest deploy).
  - ScanPanel window on Cloudflare: ~14–30s (the ~12s CF deploy is now
    inside the detached gate/publish task, so it lengthens the visible scan
    rather than the payment response — as intended).
- ✅ **Pages 4 (`/docs`) + 5 (`/dashboard`) built 2026-09-08.** `next build`
  clean, 8/8 static + `/dashboard` `ƒ` dynamic.
  - **`/docs`** — `DocsSidebar` (sticky, scroll-spy via IntersectionObserver
    + mobile `<details>`), sections from `content/docsSections.ts`:
    overview, the memory check (links to `/how-it-works#mechanism`, no
    duplication), the payment flow, deploy record states, and a real **API
    reference** generated from an `ENDPOINTS` table — `POST /deploy`,
    `GET /deploy`, `GET /deploy/:id`, `GET /deploy/:id/pay` (x402-gated),
    `POST /deploy/:id/redeploy`, `GET /patterns`, `GET /incidents`,
    `/pricing`, `/health`, each with a real trimmed response body. New
    primitive `CodeBlock`.
  - **`/dashboard`** — server component, `export const dynamic =
    "force-dynamic"`, fetches `/deploy` + `/patterns` + `/incidents` in
    parallel (`no-store`) every request. `StatCard` row (deploys / published
    / halted / known patterns / incidents), `PatternMemoryList` +
    `IncidentActivityLog` (server components, native `<details>` for
    rationale — no client JS), `RepeatDeployWidget` (client). Honest empty
    states throughout — no placeholder data.
  - **`RepeatDeployWidget`** — lists recent deploys + a paste-a-deploy-id
    fallback (redeploy reads `src.zip` off disk, so ids survive a restart).
    "Deploy again" → `POST /deploy/:id/redeploy` → `useDeploy.resumeDeploy()`
    runs the same payment + scan + result panels inline.
  - **Bugs fixed during build:** (a) `demojibake()` in `lib/format.ts` —
    the Sibyl bridge stores some rationale/mechanism prose double-encoded
    (UTF-8-as-Windows-1252); repaired for display with a CP1252 reverse
    table, guarded, discarded unless it resolves. Real fix still belongs in
    `sibyl_bridge.py`. (b) Hydration mismatch — `relativeTime()` in a client
    component drifted between SSR and hydration; new `RelativeTime` primitive
    renders an absolute date until mounted, then ticks the relative form.
  - **`/try-it` panels reused** — `PaymentPanel` / `ScanPanel` /
    `DeployResult` now also drive the dashboard's repeat flow. Added
    `data-testid` hooks (`live-url`, `redeploy-row`) for the e2e.
  - **Repeat-deploy e2e** — `scripts/e2e-redeploy-widget.mjs` (headed
    Chromium, wallet shim). **12/12**: `POST /deploy/:id/redeploy` → 201 →
    PaymentPanel ("a repeat of 5a855567") → 2 facilitator soft-fails →
    retry → real settlement **tx
    `0x4049903fced3f22d5cc3a1f610e4351deabde55aa697dae318ca4ec5aaa37525`**
    (block 46514827, confirmed on-chain) → gate re-ran → blocked again
    (matched the source verdict); new record `aa0e30d6` carries
    `redeployOf` + the tx. Screenshots `docs/evidence/redeploy-2026-09-07T16-18-43/`.
  - Page screenshots (real backend data): `docs/evidence/pages-2026-09-08T14-24-58/`.
- ✅ **/try-it step-1 progress 2026-09-08** (`components/try-it/UploadProgress.tsx`).
  Between folder-pick and Pay: a determinate "reading X / N files" bar → an
  indeterminate "Compressing" state (fflate's `zip()` gives no per-chunk
  progress) → a determinate upload bytes bar (switched `createDeploy` to
  **XHR** for `upload.onprogress` — fetch has none) → a "N files · X MB —
  uploaded" confirmation with an explicit **Continue to payment** (no
  auto-advance) → a retryable `upload_failed` card (re-POSTs the same blob,
  no re-zip). Zip errors fall back to the dropzone with the message inline —
  never a frozen dropzone. Still the same 4-step stepper; this all maps to
  step 1. `zipFolder.prepareFolder` gained an `onProgress` callback and
  yields to the event loop ~40× so the counter animates.
  - **`scripts/e2e-upload-progress.mjs`** (`scripts/lib/make-sample-site.mjs`
    generates a real 148-file / 8.5 MB folder — not the tiny preset).
    **16/16.** Step-1 progress **visible ~5s** (reading 2.7s / compressing
    1.2s / uploading 1.3s) — measured by 55ms sampling, not a flash, same
    bar as the ScanPanel timing check. Upload-failure→retry and
    zip-error→inline paths both asserted; no page errors. Screenshots
    `docs/evidence/upload-progress-2026-09-08T15-23-55/`.
  - **2026-09-09 — "nothing happens" report + hardening.** Root cause: a
    stray edit had corrupted `src/memory/patternMatch.ts` line 1
    (`/**` → `  **`), which crashed `npm start` with
    `ERR_INVALID_TYPESCRIPT_SYNTAX` — so `/try-it` couldn't load `/pricing`.
    Fixed the delimiter. Hardening on top: (a) rejected picks now show a
    **prominent error banner at the top of the dropzone** (was tiny text at
    the bottom, below the presets — easy to miss when a real >400-file
    project folder is picked; the message now says "point it at just the
    built output"); (b) `[drydock/try-it]` **breadcrumb `console.info`** at
    every step (pick → prepareFolder → phase transitions → POST /deploy →
    deploy created) so a stuck flow is diagnosable from DevTools; (c) removed
    the mid-flow `if (cancelled.current) return` guards from
    `selectUpload`/`runPayment`/poll — a stuck unmount-ref could strand the
    machine; kept only for quieting high-frequency progress callbacks;
    (d) 45s timeout guard on the fflate worker so a blocked Web Worker
    surfaces an error instead of a stuck "Compressing…". e2e re-run 16/16.
- ✅ **Incident 2026-09-09 — "the memory check could not complete" root-caused + fixed.**
  A real `/try-it` deploy (`a96729e2`, a full `Aurex` project checkout —
  2736 files incl. `node_modules` + `.git`, uploaded as a `.zip` so the
  client's 400-file cap didn't apply) fail-closed. **Actual cause:** the
  Sibyl Python bridge (`sibylBridge.ts` → `sibyl_bridge.py`) was spawned
  without pinning stdio encoding. Node pipes the request as UTF-8; Python on
  Windows opened stdin/stdout as **cp1252 + surrogateescape**. Bytes
  undefined in cp1252 — `0x81 0x8D 0x8F 0x90 0x9D`, all valid UTF-8
  continuation bytes present in any `—` / `–` / emoji / CJK char — decoded
  to **lone surrogates** (`\udc90`). `sibyl-memory-client`'s strict UTF-8
  encode for SQLite then threw `UnicodeEncodeError: surrogates not allowed`
  (during the `phase: "matching"` `setState("scan/active", {signals…})` —
  *before* the LLM reasoning step, so **ANTHROPIC_API_KEY was never used**;
  verified valid + unthrottled anyway). Bridge caught it and returned a
  clean `{ok:false}` — no crash, hang, or timeout (the 45s guard added
  during upload-progress hardening is client-side fflate, unrelated).
  **Not** the Q3 `scan/active` shared-key limitation — no concurrent scan,
  no Day-8 seeding running (only one pattern exists, untouched for 20h).
  Contributing factor: `signalExtraction.ts` walked all 2630 `node_modules`
  files → a **14 MB** `scan/active` payload, making a `0x90` byte a near
  certainty.
  - **Fixes:** (1) `sibylBridge.ts` spawns with
    `env:{PYTHONIOENCODING:"utf-8", PYTHONUTF8:"1"}` + `.setEncoding("utf8")`
    on the streams + explicit `"utf8"` stdin write — the actual root-cause
    fix, applies to every bridge call; (2) `sibyl_bridge.py` `traceback.print_exc`
    to stderr, now surfaced by the Node caller in `SibylBridgeError`;
    (3) `signalExtraction.ts` skips `node_modules`/`.git`/`.next`/`vendor`/…,
    caps 300 files / 3 MB total, better binary sniff (C1-byte density, not
    just NUL), and `toWellFormedText()` scrubs any lone surrogate from
    `Buffer.toString("utf8")` before it leaves Node.
  - **Verified end-to-end** (`scripts/redeploy-a96729e2.mjs`):
    `POST /deploy/a96729e2/redeploy` → new deploy `b0095948` (2736 files) →
    real x402 payment **tx `0x6a7beea08cde4dd26e62fcd00f0e548e9c797e79807121327b4b4886be698faf`**
    (Base Sepolia block 46591062, confirmed on-chain, 0.01 USDC moved) →
    **gate COMPLETED, verdict clean** (24 signals, was the crash — no
    `UnicodeEncodeError`, `gate` is a real object not `null`) → published
    **LIVE** at `https://drydock-b0095948.pages.dev` (root 404s only because
    `Aurex` is unbuilt Next.js source with no `index.html`; `/Aurex/*` serve
    200 — CF upload was fine). `npm run test:gate` **25/25** (ASCII path
    unaffected).
- ✅ **Pre-upload "no root index.html" warning 2026-09-09.** The live→404 gap
  the Aurex deploys fell into is input, not a pipeline bug (confirmed:
  `https://drydock-4bea1b02.pages.dev/Aurex/package.json` → **200**, `/` →
  404). `pipeline.createDeploy` now runs `inspectEntrypoint(srcDir)` →
  `hasRootIndex` (+ `indexHint` naming a nested `index.html` when the folder
  looks double-wrapped), surfaced on `POST /deploy`, `/redeploy`, and
  `GET /deploy/:id`. `/try-it`'s **Build-ready card** shows a prominent,
  **dismissible** amber warning ("No index.html at the root … upload your
  built static output, e.g. dist/ or build/, not your project source") that
  **does not block** payment; `DeployResult`'s live card repeats a one-line
  heads-up. `scripts/e2e-no-index-warning.mjs` **8/8** (no-index → warn +
  dismiss + continue still works; has-index → no warn; double-wrapped →
  names the nested path). `next build` clean.
- Override/manual-proceed UI for a gate-blocked deploy (deferred from Day 6).

## Day 8 — Seed real patterns + integration (provisional)

- Author 4–6 real REFERENCE pattern docs (anchor text: `mechanism`,
  `distinguishing_evidence`, `not_this_pattern`, `canonical_incident`).
- Full end-to-end pass: real build → scan → match → incident → payment → views.

## Day 9 — Demo prep + dry run (provisional)

- `docs/demo-script.md` finalised; timed dry run.
- **⚠️ Sanity-check the `confidence ≥ 0.6` match threshold (§8.2.2) against the
  real seeded incidents from Day 8 before the demo.** It is a hand-picked
  default, never validated at scale — too low floods `candidate_matches` with
  weak attributions, too high sends real recurrences to the `new_pattern_candidate`
  operator path and makes the "we've seen this before" moment miss. Day 6's
  one real match (0.95) and one real reject (below floor, correctly routed to
  `new_pattern_candidates`) are consistent with 0.6 but are a sample size of
  one pattern each way — tune properly on Day 8's full seeded set (does each
  seeded recurrence land above the floor, does each genuinely-novel build
  land below it) and record the chosen value + why in `docs/architecture.md`
  §8.2.2.
