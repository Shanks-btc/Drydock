# Drydock — Frontend Plan

Route plan, folder/component structure, and design-token adaptation for
Drydock's `web/` frontend. Mirrors Valiquo's structure (one root layout,
real separate routes, no SPA modal-switching), adapted to Drydock's own
palette and its already-built-and-tested backend.

**Status:** agreed 2026-09-04. Day 6.5 backend gap (§7) — **done, tested**
(`docs/plan.md` "Day 6.5"). Building order for pages: 1 (`/`) →
2 (`/how-it-works`) → 3 (`/try-it`) → 4 (`/docs`) → 5 (`/dashboard`).

**All 5 pages built.** `/` + `/how-it-works` (2026-09-05), `/try-it`
(2026-09-07, proven end-to-end), `/docs` + `/dashboard` (2026-09-08). See
`docs/plan.md` "Day 7". Historical detail below.

**Pages 1–2 built 2026-09-05. Page 3 (`/try-it`) built + proven end-to-end
2026-09-07** (real browser, real payments, 19/19 — see `docs/plan.md`
"Day 7" and `docs/evidence/tryit-2026-09-07T13-28-34/`). `next build` clean,
`next dev` on :3001. Remaining: `/docs`, `/dashboard`.

- **Page 1 (`/`)** — shell (`layout.tsx`, `Nav`, `Footer`), tokens
  (`tailwind.config.ts`, `globals.css`), primitives (`Reveal`, `Card`,
  `Button`, `EyebrowLabel`, `Container`), marketing sections (`Hero`,
  `ProblemSection`, `HowItWorksPreview`, `DemoTerminal`). From the pasted
  mockup; deviations flagged in §8, all reversible.
- **Page 2 (`/how-it-works`)** — from this plan's component list, no mockup.
  `PipelineDiagram` (real isometric SVG — 30° rhombus math per the design
  skill, staggered `pipeline-travel` pulse), `MechanismSteps` (5 steps +
  a two-terminal "step 04, two real runs" block: the clean `sample-site`
  publish and the `leaked-key-site` halt, both real `test:gate`
  transcripts), and a `Callout` framing payment-before-check as a
  deliberate non-blocking design choice.
- New shared primitives: `Terminal` (`primitives/Terminal.tsx` — the
  scroll-revealed transcript widget, extracted from `DemoTerminal` so both
  pages reuse it) and `Callout` (`primitives/Callout.tsx`).

---

## 1. Routes

| Route | Type | Purpose |
|---|---|---|
| `/` | real page | landing: hero, problem statement, how-it-works preview, live demo terminal, social proof |
| `/how-it-works` | real page | the mechanism in depth: signal extraction → two-stage match → payment gate → (future) on-chain ownership, step-by-step |
| `/try-it` | real page | the live product, wired to the running backend (payment, deploy pipeline, Sibyl gate) |
| `/docs` | real page | technical reference, sticky sidebar + anchor-linked sections |
| `/dashboard` | real page | stats, incident-memory activity log, repeat-deploy widget |
| GitHub | external `<a>` (icon) in nav | links to the real repo — **not a route** |

Divergence from Valiquo, per explicit instruction: `/how-it-works` and
`/try-it` are **real routes with their own `page.tsx`**, not `/#anchors` on
the landing page. Nav links point at `/how-it-works` and `/try-it`.

`Nav` + `Footer` live in `layout.tsx` (one true shell). Valiquo puts `Nav`
per-page and only `Footer` in the layout — Drydock follows the "one root
layout" instruction more strictly.

---

## 2. Folder structure

```
web/
├── tailwind.config.ts          # extend theme with the Drydock token set (§4)
├── src/
│   ├── app/
│   │   ├── layout.tsx           # fonts (Space Grotesk + Inter), Nav, Footer, metadata
│   │   ├── globals.css          # token fallbacks, keyframes, reduced-motion safety net
│   │   ├── page.tsx             # landing — composes marketing sections
│   │   ├── how-it-works/page.tsx
│   │   ├── try-it/page.tsx
│   │   ├── docs/page.tsx
│   │   └── dashboard/page.tsx
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Nav.tsx              # sticky, 4 links + GitHub icon, mobile disclosure
│   │   │   ├── Footer.tsx
│   │   │   └── Section.tsx          # section shell — eyebrow/heading narrow, content wider (siblings, not nested)
│   │   ├── primitives/
│   │   │   ├── Card.tsx             # the ONE recipe: rounded-2xl border-subtle bg-surface-gradient shadow-glow
│   │   │   ├── Button.tsx           # accent-gradient primary / bordered secondary
│   │   │   ├── EyebrowLabel.tsx     # uppercase tracked text-xs text-ink-label
│   │   │   ├── Reveal.tsx           # scroll-reveal (skill code, verbatim)
│   │   │   ├── AnimatedNumber.tsx   # count-up on scroll (skill code, verbatim)
│   │   │   ├── LiveDot.tsx          # pulsing "this is live" dot (ping-slow)
│   │   │   ├── StatusPill.tsx       # clean / flagged / live / blocked / awaiting states
│   │   │   ├── CodeBlock.tsx
│   │   │   ├── Callout.tsx
│   │   │   └── Hash.tsx             # truncated address / tx hash + block-explorer link
│   │   ├── marketing/              # landing + how-it-works
│   │   │   ├── Hero.tsx
│   │   │   ├── PipelineDiagram.tsx  # isometric SVG: upload → memory-check → payment → on-chain (skill iso math)
│   │   │   ├── ProblemSection.tsx
│   │   │   ├── HowItWorksPreview.tsx    # 3-step condensed, links to /how-it-works
│   │   │   ├── MechanismSteps.tsx       # /how-it-works deep steps
│   │   │   ├── DemoTerminal.tsx         # animated replay of a real gate run (the leaked-key block)
│   │   │   └── ProofSection.tsx         # real GET /deploy records + on-chain tx links, honest empty state
│   │   ├── try-it/
│   │   │   ├── TryItFlow.tsx        # client orchestrator / state machine
│   │   │   ├── DropZone.tsx         # folder/zip pick + drag-drop, client-side zip
│   │   │   ├── ScanPanel.tsx        # "scanning…" then verdict (clear ✓ / flagged ⚠ + pattern_id + rationale)
│   │   │   └── DeployResult.tsx     # live URL (clean) | blocked card w/ pattern_id + rationale (flagged)
│   │   ├── docs/
│   │   │   └── DocsSidebar.tsx      # sticky aside + mobile <details> (Valiquo pattern)
│   │   └── dashboard/
│   │       ├── StatCard.tsx
│   │       ├── IncidentActivityLog.tsx   # GET /incidents  (Day 6.5)
│   │       ├── PatternMemoryList.tsx     # GET /patterns   (Day 6.5)
│   │       └── RepeatDeployWidget.tsx    # POST /deploy/:id/redeploy  (Day 6.5)
│   │
│   ├── lib/
│   │   ├── chain.ts            # exists — Base chain config
│   │   ├── ensureChain.ts      # exists — wrong-network guard
│   │   ├── api.ts              # NEW — typed backend client + DeployRecord/GateResult/Pattern/Incident types
│   │   ├── payX402.ts          # NEW — browser wallet x402 `exact` scheme (RISK ITEM — §5)
│   │   ├── useDeploy.ts        # NEW — client hook: upload → poll state machine
│   │   ├── format.ts           # NEW — truncateHash/Address, formatUsdc, relativeTime
│   │   └── constants.ts        # NEW — API base URL, GitHub repo URL, explorer base
│   │
│   └── content/
│       ├── docsSections.ts     # docs copy + anchor ids, kept out of JSX
│       └── howItWorksSteps.ts  # step data for MechanismSteps + HowItWorksPreview
```

### Per-page composition

- **`/`** → `Hero`, `ProblemSection`, `HowItWorksPreview`, `DemoTerminal`,
  `ProofSection`, each wrapped in `Reveal`. `ProofSection` is a server
  component (SSR `GET /deploy`).
- **`/how-it-works`** → page header, `MechanismSteps`, `PipelineDiagram`
  (full-size), a `Callout` on the "payment confirms regardless" principle.
- **`/try-it`** → `TryItFlow` (client). Everything else on the page is
  static chrome.
- **`/docs`** → `DocsSidebar` + anchored sections rendered from
  `content/docsSections.ts`, using `CodeBlock` / `Callout`.
- **`/dashboard`** → `StatCard` row (SSR from `/deploy` + `/patterns` +
  `/incidents`), `PatternMemoryList`, `IncidentActivityLog`,
  `RepeatDeployWidget` (client — needs the wallet flow after re-trigger).

---

## 3. `/try-it` flow — DECISION: mirror the real backend exactly (option a)

The backend's Day 6 gate runs **after** payment settles (deliberate — "the
gate controls whether the deploy proceeds, never whether the payment does").
`/try-it` mirrors that sequence exactly. **No pre-payment advisory scan
endpoint is being built.**

```
1. DropZone        user picks a folder / zip
2. (client zips)   POST /deploy            -> { deployId, payUrl, statusUrl, feeUsdc }
3. PaymentPanel    connect wallet, ensureChain(Base Sepolia),
                   payX402(payUrl)          -> real 0.01 USDC settlement on Base Sepolia
4. ScanPanel       poll GET /deploy/:id     -> state: paid -> (gate runs server-side) ->
                   "Scanning the build against incident memory…"
5. DeployResult    state: live     -> show the real https://…netlify.app URL, fetchable
                   state: blocked  -> show gate.topMatch.pattern_id + confidence +
                                      full rationale; NO url; explain the deploy was
                                      halted, payment already settled (link the tx)
                   state: failed   -> host error (rare), show gate.error / record.error
```

The "scanning" step is a real polling wait on a state transition, not a
faked spinner — copy says so explicitly.

**Built 2026-09-07.** `lib/{payX402,api,useDeploy,zipFolder,format}.ts` +
`components/try-it/{TryItFlow,DropZone,PaymentPanel,ScanPanel,DeployResult}.tsx`.
`payment_retry` is its own machine phase (option-a still holds — no
pre-payment scan; retry is about the facilitator, not the gate).

The first e2e exposed that the backend `await`ed the whole gate inside the
x402 settlement hook, so the record was terminal before `wrapFetchWithPayment`
resolved and `ScanPanel` flashed. **Fixed in `src/deploy/settlement.ts`** —
`onAfterSettle` now awaits only `markPaid` and detaches the gate+publish. The
client polls `GET /deploy/:id` every 1s; `ScanPanel` shows a live counter.
Re-run e2e: **ScanPanel visible 11–13s** (was <1s), mid-scan screenshots at
~4.8s. See `docs/plan.md` Day 7 and `docs/evidence/tryit-2026-09-07T13-47-53/`.

**Step-1 progress added 2026-09-08** (`components/try-it/UploadProgress.tsx`).
Same 4-step stepper — the zip/upload progress lives *inside* step 1. Phases
`preparing` (reading bar `18 / 24 files` → indeterminate `Compressing` —
fflate's one-shot `zip()` has no per-chunk callback, so honest-indeterminate)
→ `uploading` (determinate bytes bar via **XHR** `upload.onprogress`, since
fetch has none) → `ready` (a "N files · X MB — uploaded" confirmation with an
explicit *Continue to payment* — the stepper does not auto-advance) →
`upload_failed` (retryable — re-POSTs the same blob, no re-zip). Zip errors
(too many files / >25 MB) drop back to the dropzone with the error inline;
never a frozen dropzone. `zipFolder.prepareFolder` takes an `onProgress`
callback and yields to the event loop ~40× so the counter animates.
Proven: `scripts/e2e-upload-progress.mjs` (real 148-file / 8.5 MB folder,
headless) — **16/16**, step-1 progress **visible ~5s** (read 2.7s / zip 1.2s /
upload 1.3s), not a flash; upload-failure retry + zip-error paths asserted.
`docs/evidence/upload-progress-2026-09-08T15-23-55/`.

---

## 4. Design tokens — Drydock palette in Valiquo's token structure

`tailwind.config.ts` → `theme.extend`:

```ts
colors: {
  canvas: "#0A0A0F",                                   // page background
  surface: { from: "#12141A", to: "#0C0D11" },         // card gradient stops — cool-neutral, not purple-tinted
  ink: { heading: "#F2F3F5", body: "#9BA1AC", label: "#7E8592" },
  accent: { light: "#2DD4BF", DEFAULT: "#14B8A6", dark: "#0F9488" },  // teal-400 / 500 / 600
  success: "#4ADE80",   // KEPT visually distinct from teal — reserved ONLY for "real / settled / on-chain confirmed"
},
borderColor: {
  subtle: "rgba(20,184,166,0.15)",
  strong: "rgba(20,184,166,0.32)",
},
backgroundImage: {
  "accent-gradient": "linear-gradient(135deg, #2DD4BF 0%, #14B8A6 55%, #0F9488 100%)",  // primary CTAs
  "surface-gradient": "linear-gradient(160deg, #12141A 0%, #0C0D11 100%)",              // every card
},
boxShadow: {
  glow: "0 0 0 1px rgba(20,184,166,0.15), 0 8px 40px -12px rgba(20,184,166,0.35)",     // the signature 1px ring + diffuse shadow
},
fontFamily: {
  display: ["var(--font-space-grotesk)", "sans-serif"],
  body: ["var(--font-inter)", "sans-serif"],
},
```

`globals.css`:
- `body { background-color: #0A0A0F; color: #F2F3F5; }`
- keyframes `pipeline-travel` and `ping-slow` — same timing as the skill;
  drop-shadow color swaps purple `rgba(167,139,250,…)` → teal
  `rgba(45,212,191,…)`.
- the `@media (prefers-reduced-motion: reduce)` blanket rule, verbatim.

**DECISION locked:** `success` green (`#4ADE80`) stays visually distinct
from the teal accent. Teal and green sit close on the wheel; keeping a
yellow-green success preserves its reserved meaning (the skill is emphatic
that `success` must never blur into the brand accent). Do not collapse them.

Fonts: Space Grotesk (display) + Inter (body) — the skill default, loaded
via `next/font/google` as CSS variables. Swap later if desired; not blocking.

### The "feel" rules carried over from the skill (non-negotiable)

- One accent family, one reserved success color, never a third brand color.
- One card recipe reused everywhere (`Card.tsx`) — no per-section card styles.
- `min-w-0` on cards + their text children, `truncate` on anything that can
  overflow (deploy ids, tx hashes, addresses, file paths).
- Grids scale with data count via responsive breakpoints
  (`sm:grid-cols-2 lg:grid-cols-3`), never hardcoded to today's item count.
- Every number claiming to be "real" is rendered from an actual backend
  response object, with an honest first-class empty state — never a
  placeholder value. Sections that make this claim say so in copy
  (e.g. "rendered from `GET /deploy` on the running server").
- Every scroll/count animation has a `prefers-reduced-motion` bailout at
  the component level (skip the JS) *and* the CSS safety net.

---

## 5. RISK ITEM — `lib/payX402.ts` is new code, not a port

Valiquo's `web/src/lib/walletPay.ts` is **not reusable**: it's specific to
Circle Gateway / `@circle-fin/x402-batching` — it deposits into a
`GatewayWallet` contract and signs a `GatewayWalletBatched` EIP-712 domain.

Drydock uses the plain x402 **`exact` scheme** via the public
`x402.org/facilitator` — an EIP-3009 `TransferWithAuthorization` signed
directly against the Base Sepolia USDC contract, no gateway deposit step.

`payX402.ts` must be written fresh, modelled on the backend's working
`scripts/test-x402-sepolia.mjs` (which uses `@x402/fetch` +
`wrapFetchWithPayment` with a raw private key), but adapted to a **browser
wallet signer** — `eth_signTypedData_v4` via `window.ethereum`, then the
`PAYMENT` header round-trip against `GET /deploy/:id/pay`.

**Unknowns to resolve with a real spike before `/try-it` is "done":**
- Does `@x402/fetch`'s client accept a viem `WalletClient` (injected
  provider) as the signer, or must the EIP-712 payload + `PAYMENT` header be
  hand-built (as Valiquo had to for the Gateway scheme)?
- Exact EIP-712 domain/types the `exact` scheme's `ExactEvmScheme` expects
  for Base Sepolia USDC (name `"USDC"`, version `"2"` per `chain.ts`).
- Facilitator round-trip from a browser origin (CORS on
  `x402.org/facilitator`; the backend calls it server-side today).

**`/try-it` cannot be considered complete until `payX402.ts` has its own
real end-to-end test**: a browser wallet signer producing a real 0.01 USDC
settlement on Base Sepolia through the facilitator, verified on-chain — same
evidentiary standard as every prior day. Until then `/try-it` is a
scaffold, not a shippable page.

### ✅ Spike done 2026-09-07 — `scripts/spike-payx402-browser-signer.mjs`

Ran before any `/try-it` component. Models `scripts/test-x402-sepolia.mjs`,
swapping the raw-key local account for the browser object graph:
`custom(eip1193Provider)` → viem `createWalletClient` →
`{ address, signTypedData }` adapter → `x402Client.register(net, new
ExactEvmScheme(adapter))`. The signature is produced by a real JSON
round-trip through `eth_signTypedData_v4` (headless EIP-1193 provider shim
backed by the test key, standing in for the extension; all non-signing RPC
proxied to a real node). **36/36 assertions. Real settlement tx
`0xc79c4c12056637bce2e7ac5bab0a335a71de021ea252915bbd998156fd9b71d0`**
(block 46508853), independently verified off a plain `sepolia.base.org` RPC
(receipt status success, USDC Transfer buyer→seller 10000 atomic, seller
+0.01 / buyer −0.01, buyer spent no ETH).

Unknowns from the list above, resolved:
- **Does `@x402/*` accept an injected `WalletClient` as the signer?** Not
  directly — `ExactEvmScheme`'s signer is duck-typed `{ address,
  signTypedData({domain,types,primaryType,message}) }` (verified in
  `@x402/evm` compiled source). A viem `WalletClient` has neither a bare
  `.address` nor an account-less `signTypedData`, so `payX402.ts` wraps it
  in the ~4-line adapter shown in the spike. No hand-built `PAYMENT` header
  needed — `wrapFetchWithPayment` does the header round-trip.
- **Exact EIP-712 domain/types for Base Sepolia USDC.** Confirmed on the
  wire: domain `{ name:"USDC", version:"2", chainId:84532,
  verifyingContract:0x036CbD…dCF7e }`, primaryType
  `TransferWithAuthorization`, `EIP712Domain` type auto-added by viem.
- **Facilitator round-trip from a browser origin (CORS).** ⚠️ **Still
  open** — the spike runs from Node. The happy path is safe
  (`wrapFetchWithPayment` never calls the facilitator client-side; the
  resource server does). Close it with a real-browser run only if
  `payX402.ts` gains a direct client-side `verify`.

Also observed: the public `x402.org/facilitator` intermittently soft-fails
settlement — `{ success:false, errorReason:
"invalid_exact_evm_transaction_failed" }`, message "replacement transaction
underpriced" (its own submitter-nonce race on shared Base Sepolia). It
**never throws** — only `onAfterSettle` / the `PAYMENT-RESPONSE` sees it.
First spike run hit this; an immediate retry with a fresh payment settled.
`payX402.ts` + `TryItFlow` must treat `success:false` as **retryable**, with
a "retry payment" affordance, not a dead end.

### ✅ RISK CLEARED 2026-09-07 — `payX402.ts` built and proven in a real browser

`web/src/lib/payX402.ts` written from the spike's object graph.
`scripts/e2e-tryit-browser.mjs` drove the finished `/try-it` page in headed
Chromium (wallet = the spike's EIP-1193 shim injected via
`page.exposeFunction`; real `eth_signTypedData_v4`, real facilitator, real
on-chain settlement). **19/19.** `scripts/fault-facilitator-proxy.mjs`
force-injected the facilitator soft-fail: the UI showed the retry state, and
a click on "Retry payment" settled for real
(`tx 0x97459caa…677ac7ba`). Blocked path also proven
(`tx 0xc04929a2…26107eef`, `exposed-key-in-build-output` @ 0.94, incident
recorded). Both txs independently confirmed on-chain. Screenshots:
`docs/evidence/tryit-2026-09-07T13-28-34/`. The three §5 unknowns are all
resolved (the CORS one effectively — real page origin, no CORS failure).

---

## 6. Backend integration points

Backend has permissive CORS (`app.use(cors(...))`), so reads can be client-
or server-side. Plan:

- **SSR (Next server components / `lib/api.ts` server fns)** for read-only
  lists: landing `ProofSection`, all of `/dashboard`. `cache: "no-store"`.
- **Client-side** for `/try-it` (the wallet flow must run in the browser).

| Frontend need | Backend endpoint | Status |
|---|---|---|
| deploy fee, network, seller addr | `GET /pricing` | exists |
| recent deploys (proof, dashboard stats) | `GET /deploy` | exists |
| one deploy's live status (try-it poll) | `GET /deploy/:id` | exists |
| upload a build | `POST /deploy` (zip body) | exists |
| pay the fee | `GET /deploy/:id/pay` (x402-gated) | exists |
| known failure patterns + rollups | `GET /patterns` | **Day 6.5** |
| incident-memory activity log | `GET /incidents` | **Day 6.5** |
| repeat a past deploy | `POST /deploy/:id/redeploy` | **Day 6.5** |

Web dev server runs on `:3001`, backend on `:3000` — no clash.
`NEXT_PUBLIC_DRYDOCK_API` (client) / `DRYDOCK_API` (server) env var,
default `http://localhost:3000`.

---

## 7. Day 6.5 — the /dashboard backend gap ✅ DONE

Built before page 1 so page 5 isn't blocked later. See `docs/plan.md`
"Day 6.5" for the build record and test results (`npm run test:dashboard`
24/24; `test:gate` re-run 25/25).

- **`GET /patterns`** — `list_entities("failure-pattern")` joined with each
  pattern's REFERENCE doc for `title` + `mechanism`. Returns the reconciled
  rollup fields (`incident_count`, `severity_ceiling`, `open`/`resolved`
  ids, first/last seen).
- **`GET /incidents?limit=`** — recent COLD journal events
  (`read_events`), mapped to a compact shape with a `type` discriminator
  (`incident` | `collision`), newest first.
- **`POST /deploy/:id/redeploy`** — creates a NEW deploy from a prior
  deploy's retained `src.zip` (falls back to reading
  `deploys/<id>/src.zip` off disk if the in-memory record is gone after a
  restart). Returns the same shape as `POST /deploy` so it flows through
  payment + gate again. `:id` validated as a UUID before any disk touch.
- **Gate → incident wiring** (Claude's call, flagged): a blocked deploy now
  also calls `recordIncident` (§6) so the incident-memory activity log
  shows real gate activity, not just Day 4-5 test data. The block is the
  primary effect; a failed incident write is logged but never un-blocks or
  fails the deploy. Not in the original Day 6 brief — added here because
  `GET /incidents` is not a real feature without it.

---

## 8. Page-1 build — deviations from the pasted mockup

All flagged, all cheap to revert. Design, layout, spacing, and structure
follow the mockup; these are content/accuracy corrections plus the two
plan items the mockup didn't reflect.

| # | Mockup | Built | Why |
|---|---|---|---|
| 1 | hero stat "&lt;4s memory check time" | **"~8s memory check"** | Real measured latency is ~8s for a full gate check (~5s LLM + ~2.8s bridge) — `docs/deploy.md`. `<4s` is not achievable today. |
| 2 | hero stat "100% / on-chain ownership" | **"Base / on-chain settlement"** | On-chain **ownership recording is not built** (Day 7+). The x402 **settlement** on Base is real and proven — that's the honest on-chain claim. |
| 3 | hero stat "0.01 USDC / avg. deploy cost" | "0.01 USDC / **flat deploy fee**" | It's a flat fee (`DRYDOCK_DEPLOY_FEE_USDC`), not an average. |
| 4 | how-it-works order: Upload → **Check → Pay** → Own | **Upload → Pay → Check → Go live** | The built gate (Day 6) and the confirmed `/try-it` flow run the check **after** payment settles. Shipping "check before pay" contradicts a decision made this same session. Step copy adapted minimally to the real order; "Own" → "Go live" (ownership recording unbuilt). |
| 5 | problem card 3: "Before a single dollar of USDC moves, Drydock compares…" | "**Before your site ships**, Drydock compares…" | Same check-after-pay correction; the deploy (not the payment) is what the check gates. |
| 6 | demo sub: "…before a single cent moves" | "…**a replay of a real run**. No wallet required…" | Same correction; also makes the section honestly a replay, not a live pre-payment scan. |
| 7 | demo terminal: scripted `drydock resolve --set-env` / incident-resolution flow | **Real transcript** of the `leaked-key-site` gate block from `npm run test:gate` (pattern match at 0.96, halt, incident recorded) | The mockup's script used commands that don't exist. The real block flow is also a stronger "the memory caught it" demo. |
| 8 | nav: "GitHub" as a text link | **GitHub icon** (SVG), + mobile disclosure menu | Per §1 / the approved route plan. The mockup's mobile nav also had no menu (links would overflow). |
| 9 | hero prose "records ownership on-chain"; step 04 "ownership is written on-chain against your wallet" | **softened to "settles on Base" / "the payment settled on Base against your wallet — an on-chain record of who deployed and when"** | On-chain ownership recording isn't built; the settlement tx (payer address + timestamp on Base) is the real on-chain artifact. Now matches the other corrections. |
| — | teaser form on the landing demo section | button + presets link to `/try-it` | The working flow is page 3; the landing form is a visual teaser. |

Not changed: every other line of hero / problem / steps copy is verbatim
from the mockup.
