# Drydock

Drydock is a deployment agent with memory. A build is uploaded, one gasless USDC payment settles on Base, and before the site publishes, Drydock checks the build against every past deployment incident it has stored, reasoning about the actual cause of a failure, not matching on keywords.

I built Drydock around a simple question: what should a deploy pipeline actually remember? Not every build error is the same error wearing a different face, and not every surface-similar problem shares the same cause. A payment settling and a site going live are not proof that nothing was learned in between, the decision itself needs a record you can inspect

Project stage: Deployed and operating on Base Sepolia (testnet). Payment settlement, on-chain ownership recording, and the memory-check gate are real and independently verifiable on Sepolia. Drydock does not perform Base mainnet writes in this build.

## Demo

Watch the walkthrough: https://www.youtube.com/watch?v=3uZz-0K8pCk

Read the build-in-public posts: https://x.com/Fastlanexbt/status/2098148118671892847?s=20 · https://x.com/Fastlanexbt/status/2098146456121041159?s=20

## Why Drydock

Finding out a deploy is fine is only the start. A build can pass a syntax check and a compile step and still ship the exact failure that broke a different project last month, because nothing connects one incident to the next. For a deploy tool, a useful check needs to remember what it has already learned, and needs to be honest about what it hasn't.

Drydock brings that into one workflow:

- **Real signals, not a syntax check:** the build's actual files, env vars, and config are extracted and reasoned about, not just validated against a schema.
- **Causal matching, not keyword matching:** every known failure pattern is stored with its mechanism, its distinguishing evidence, and an explicit note on what it is *not* — proven by a build sharing every suspicious keyword of a known leak still clearing correctly, because the underlying cause differed.
- **Payment settles independently of the verdict:** the 0.01 USDC fee confirms on Base regardless of outcome; the memory check only ever decides whether *publishing* proceeds.
- **Explicit failure states:** clean, blocked, and "flagged as something I haven't learned yet" all remain visible, rather than collapsing into a single pass/fail.
- **Fail-closed by design:** if the memory check itself cannot complete, the deploy halts rather than publishing unchecked.

Drydock makes a deploy easier to trust: a real payment, a real reasoning step, and a traceable verdict travel with every build.

## How Drydock works

Uploading and paying are sequential but decoupled. Payment settlement and the memory-check gate are two separable events — the settlement hook triggers the gate asynchronously rather than holding the payment response hostage to an ~8-15 second reasoning call.

The flow: upload → pay → memory check → result.

1. A build is uploaded (folder or `.zip`), zipped client-side.
2. A flat 0.01 USDC fee settles gaslessly on Base via the x402 `exact` scheme — a real on-chain transaction, confirmed independently of the check that follows.
3. Drydock extracts real signals from the build and queries Sibyl Memory in two stages: a cheap prefilter shortlists candidate patterns, then a reasoning step compares the build's actual signals against each candidate's stored causal explanation.
4. The build is published, halted, or flagged as resembling something not yet in memory — with the rationale shown either way.

## Try it without spending anything

Two presets are available on the live `/try-it` page so you can see both outcomes without needing a build of your own:

- **Clean static export** — clears the memory check, deploys, and returns a live URL.
- **Leaked key in build output** — a known incident. The check halts the deploy and shows the mechanism it recognized.

Bring your own wallet with a small amount of Base Sepolia test USDC (from `faucet.circle.com`) to run a real payment through either path yourself.

## Core components

| Component | What it does | Where it lives |
|---|---|---|
| Deploy pipeline | Folder/zip in, static host out | `src/deploy/` |
| Payment gate | x402 exact-scheme settlement on Base | `src/payment.ts` |
| Memory gate | Two-stage semantic match against Sibyl | `src/memory/` |
| Sibyl bridge | In-process call into `sibyl-memory-client` (Python) from the Node backend | `src/memory/sibylBridge.ts` |
| Frontend | Landing, mechanism explainer, live try-it flow, docs, dashboard | `web/` |

## Current status

| Surface | Status | Meaning |
|---|---|---|
| Backend | Live on Railway | Express API, persistent volume for Sibyl memory and retained deploy artifacts |
| Frontend | Live on Railway | Next.js, five real routes, light/dark theme |
| Hosting for deployed sites | Cloudflare Pages | Direct-upload API, one project per paid deploy |
| Payment | Base Sepolia | x402 `exact` scheme via the public facilitator |
| Memory | Sibyl Memory, free tier | Five-tier schema, semantic reasoning over stored causal explanations |

## What the runs have shown

- A clean build settles payment and clears the memory check, with no known pattern matched.
- A build carrying a leaked credential in build output halts before publishing, citing the specific mechanism it matched — full rationale shown, not a bare rejection.
- A build carrying a differently-shaped credential — committed directly into source rather than leaked at build time — is correctly **not** matched against the known leaked-key pattern, using the same stored distinction in reverse. Same suspicious keywords, opposite verdict, because the cause differs.
- When a build resembles a genuinely new failure class, Drydock names it as an unlearned pattern rather than forcing a match either way.
- A real container restart on the production deployment was used to deliberately test whether memory and retained deploy artifacts survive — they did; only the in-memory deploy list (expected to reset) did not.
- The intermittent soft-fail behavior of the public x402 facilitator was reproduced deterministically with a fault-injecting proxy and confirmed recoverable via a retry, rather than assumed safe from the happy path alone.

## Memory

Drydock's memory is load-bearing, not decorative: it persists context that matters, recalls it in a genuinely fresh session, and uses it to change a real decision — the deploy either publishes, halts, or is flagged as something not yet known. Delete the memory, and the product cannot tell a real recurrence apart from a coincidence, or a false positive apart from a genuine match.

**Kind of memory.** This isn't a cache or a log — it's a store of causal explanations. Sibyl holds *why* a failure happens (its mechanism), what it looks like, and what it explicitly is not, and every new build is judged against that reasoning, not against a keyword or a rule. The primitives in use: **recall** (fresh-session lookup against stored context), **entities** (failure-pattern rollups and an idempotency ledger), **semantic search** (reasoning-based matching over causal similarity, not keyword overlap), **consolidation** (many incidents reconciled into one grouped pattern), and **reflection** (recognizing when a build resembles nothing stored, and naming that gap instead of guessing).

**What is persisted.** Every confirmed incident is stored as a reasoned record, not a log line: the causal mechanism behind the failure, what evidence looks like it, a worked example, and an explicit statement of what the pattern is *not* — the negative anchor that does the real work of distinguishing similar-looking but different causes.

**How a fresh session recalls it.** Every deploy is an independent process with no session carried over. The build's real signals are extracted fresh, a cheap prefilter shortlists candidate patterns from Sibyl's stored entities, and a reasoning step compares the new signals against each candidate's stored explanation — genuinely re-deriving the verdict each time, not reading a cached answer.

**What changes because of it.** A build matching a known failure's real mechanism is halted before publishing, even though payment has already settled. A build that shares every surface signal of a known failure but not its actual cause is correctly let through — proven directly: a database credential committed into source code was **not** matched against a known build-time key-leak pattern, because Drydock's stored reasoning distinguishes "committed to source" from "generated at build time," and applied that same distinction, in reverse, to clear a case that shared every suspicious keyword. When a build resembles something genuinely outside what's stored, Drydock says so explicitly rather than guessing.

**What breaks if memory is deleted.** Every one of the above becomes impossible. A fresh deploy would have nothing to compare against, so every build would look identical — no halt, no clearance based on cause, no honest "I don't know this one yet." The product would collapse to a deploy pipeline with no actual check running at all.

**Storage.** Sibyl Memory, free tier, used across four of its five tiers — COLD for incident events, WARM for pattern entities and an idempotency ledger, REFERENCE for the causal anchor text patterns are matched against, HOT for live scan state. Every incident write is content-hashed: a retried write with identical content returns the original record; a retried write with different content under the same key is quarantined rather than silently overwritten.

## Public endpoints

| Service | URL |
|---|---|
| Drydock web | https://web-production-1909c.up.railway.app |
| Drydock API health | https://backend-production-acb8.up.railway.app/health |
| Try it | https://web-production-1909c.up.railway.app/try-it |
| Dashboard | https://web-production-1909c.up.railway.app/dashboard |
| Docs | https://web-production-1909c.up.railway.app/docs |

## Architecture

Drydock keeps payment, hosting, and memory as separate concerns so that one succeeding does not silently authorize the others.

| Layer | Responsibility | Primary location |
|---|---|---|
| Web | Landing, mechanism explainer, live try-it flow, dashboard | `web/` |
| API | Deploy records, pricing, redeploy | `src/server.ts` |
| Payment | x402 exact-scheme settlement on Base | `src/payment.ts` |
| Deploy pipeline | Build intake, host dispatch (Cloudflare/Netlify/local) | `src/deploy/` |
| Memory gate | Signal extraction, prefilter, reasoning-step match | `src/memory/` |
| Memory store | Sibyl Memory, five-tier schema | Python, via `sibylBridge.ts` |

### Memory-check sequence

1. Payment settles on Base — unconditionally, independent of what follows.
2. The settlement hook triggers the memory gate asynchronously; the payment response does not wait on it.
3. Real signals are extracted from the uploaded build (`node_modules`/`.git` excluded, size-capped).
4. A deterministic prefilter shortlists candidate patterns from Sibyl's WARM-tier entities.
5. A reasoning step compares the build's signals against each shortlisted pattern's REFERENCE anchor — its mechanism, distinguishing evidence, and explicit negative anchors.
6. A match at or above the confidence threshold halts the deploy; no match clears it; a genuinely novel resemblance is filed as an unlearned candidate.
7. The verdict, rationale, and any new-pattern candidate are recorded and surfaced on the public deploy record.

## Trust and safety model

### Network separation

| Purpose | Network | Write policy |
|---|---|---|
| Payment settlement | Base Sepolia | Real, gasless, on-chain |
| Site hosting | Cloudflare Pages | One project per paid deploy |
| Memory | Sibyl (local/Sibyl-hosted) | Read/write, free tier, content-hashed for idempotency |

### Idempotency and fail-closed behavior

Every incident write is keyed by a content hash: a retried write with identical content returns the original record; a retried write with different content under the same key is quarantined rather than silently overwritten. If the memory-check gate itself cannot complete — rather than completing and returning a clean or blocked verdict — the deploy fails closed and does not publish.

### Secret handling

Local secrets live in a gitignored `.env`. Production secrets are set directly in the Railway dashboard, not committed. API tokens (Cloudflare, Anthropic) are scoped to the minimum permission needed.

## Quick start

### Requirements

- Node.js 18+
- Python 3.11+ (for the Sibyl memory bridge)
- A Base Sepolia wallet with test USDC, for the payment flow

### Install

```bash
git clone https://github.com/Shanks-btc/Drydock.git
cd Drydock
npm install
pip install sibyl-memory-client --break-system-packages

cd web
npm install
```

### Run locally

```bash
# Backend
cp .env.example .env   # fill in ANTHROPIC_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DRYDOCK_SELLER_ADDRESS
npm start

# Frontend
cd web
npm run dev
```

## Useful commands

| Command | Purpose | Network/write behavior |
|---|---|---|
| `npm run test:gate` | Full clean + blocked deploy flow through the memory gate | Real Base Sepolia payment |
| `npm run test:sibyl` | Memory write/query paths, should-match / should-not-match | No chain writes |
| `npm run test:reconcile-property` | Pattern reconciliation order-independence | No chain writes |
| `npm run test:dashboard` | Dashboard API endpoints | No chain writes |
| `npm run test:cloudflare` | Hosting integration | Deploys a real test site |

## Repository layout

```
src/
  deploy/         build intake, host dispatch (Cloudflare/Netlify/local)
  memory/         signal extraction, pattern match, Sibyl bridge, idempotent writes
  payment.ts      x402 settlement
  server.ts       API routes
web/
  src/app/        five routes: /, /how-it-works, /try-it, /docs, /dashboard
  src/components/ primitives, marketing sections, try-it flow, dashboard widgets
scripts/          end-to-end test harnesses, latency/property checks
docs/             architecture, deploy guide, demo script, build log
```

## How I approach the build

- Make the check's claim no stronger than what it actually reasoned through.
- Keep payment settlement unconditional — never make it depend on a model's judgment.
- Store *why* something failed, not just that it did.
- Fail closed when the check itself can't complete, rather than publishing unchecked.
- Prove a match and a non-match against the same surface signals before trusting either.
- Verify real behavior against installed source, not documentation, before building on it.
- Independently re-confirm every on-chain claim off a plain RPC call, not just the SDK's own response.

A deployment agent with memory, built for the Sibyl Labs "Forgetting is a Bug" Memory Hackathon. Payment on Base, hosting on Cloudflare Pages, reasoning-driven memory on Sibyl.
