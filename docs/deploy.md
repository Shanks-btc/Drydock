# Drydock — Deploy

How to actually ship a site through Drydock: env vars, the three static-host
options, and the known host gotchas (found by running it for real, not from
the docs).

## Env vars

```
DRYDOCK_STATIC_HOST=local | netlify | cloudflare
#   unset -> cloudflare if CLOUDFLARE_API_TOKEN+ACCOUNT_ID present,
#            else netlify if NETLIFY_AUTH_TOKEN present, else local
PUBLIC_BASE_URL=http://localhost:3000 # only used by the local host, to build /s/<id>/ URLs
NETLIFY_AUTH_TOKEN=nfp_...            # app.netlify.com -> User settings -> Applications -> New access token
NETLIFY_SITE_ID=                      # optional: reuse one Netlify site instead of one-per-deploy
CLOUDFLARE_API_TOKEN=...              # custom token, ONE scope: Account | Cloudflare Pages | Edit
CLOUDFLARE_ACCOUNT_ID=...             # Workers & Pages -> right sidebar, or the hex in the dash URL
CLOUDFLARE_PAGES_PROJECT=drydock      # optional; lowercase a-z0-9-, created on first deploy
```

**Netlify is billing-locked on the hackathon account** ("Account credit
usage exceeded — new deploys are blocked"). Use `cloudflare` — its Pages
free tier needs no card.

## `cloudflare` — real public URL, free tier

Cloudflare Pages "Direct Upload" — the multi-call API `wrangler` drives
internally (`CloudflarePagesStaticHost`, verified 2026-09-07 against
workers-sdk `main`: `packages/wrangler/src/pages/{validate,hash,upload}.ts`
+ `src/api/pages/deploy.ts`). `deploy()`:

1. `GET /accounts/{acct}/pages/projects/{project}` (exists?) → if 404
   (`code 8000007`), `POST /accounts/{acct}/pages/projects
   {name, production_branch:"main"}`.
2. `GET /accounts/{acct}/pages/projects/{project}/upload-token` → `{ jwt }`
   (short-lived, account-scoped).
3. Hash every servable file: **`blake3(base64(bytes) + ext_no_dot)` → hex →
   first 32 chars**. Cloudflare re-derives this exact key on its side, so it
   must match byte-for-byte (`@noble/hashes` blake3 cross-checked against
   wrangler's `blake3-wasm` — identical). Ignores `_worker.js` / `_redirects`
   / `_headers` / `_routes.json` / `.DS_Store` / `node_modules` / `.git`.
4. `POST /pages/assets/check-missing` (`Bearer <jwt>`, no `/accounts`
   prefix) `{hashes}` → hashes to upload. On error → upload everything.
5. `POST /pages/assets/upload` (`Bearer <jwt>`)
   `[{key:<hash>, value:<base64>, metadata:{contentType}, base64:true}]`.
6. `POST /pages/assets/upsert-hashes` (`Bearer <jwt>`) `{hashes:[all]}` —
   non-fatal if it fails (only warms the cross-deploy cache).
7. `POST /accounts/{acct}/pages/projects/{project}/deployments`, multipart:
   `manifest` = `{"/index.html":"<hash>", ...}` (leading slash) + `branch`.
   → `{ id, url, latest_stage }`.
8. Poll `GET .../deployments/{id}` until `latest_stage` is
   `{name:"deploy", status:"success"}` (or `"failure"` → throw).

### URL: one project per deploy, return the project subdomain

Cloudflare's `*.pages.dev` wildcard cert covers **`<project>.pages.dev`**
(one label) but **not** the deeper per-deployment
`<hash>.<project>.pages.dev` — that needs the project's own
`*.<project>.pages.dev` cert, which lags minutes-to-hours after a project is
first created (a fresh deployment URL fails the TLS handshake until then).

So `CloudflarePagesStaticHost` defaults to **one Pages project per deploy**
(`drydock-<first 8 of deployId>`) and hands back that project's
`<project>.pages.dev` subdomain — a durable, immediately-valid URL per paid
deploy (the same shape as Netlify's site-per-deploy). Set
`CLOUDFLARE_PAGES_PROJECT` to force a single shared project instead, in
which case the returned URL is that one `<project>.pages.dev` and always
shows the newest deploy. The per-deployment `<hash>.<project>.pages.dev` is
kept in `meta.deploymentUrl` only.

Note Cloudflare picks the subdomain label — if `drydock-abc123` is globally
taken it appends a suffix (`drydock-abc123-5x1.pages.dev`); the host reads
`project.subdomain` back rather than assuming.

### Gotcha — the manifest hash MUST match, or the asset 404s silently

Cloudflare stores the uploaded blob under whatever `key` you send, but the
edge lookup **re-derives** the key from `blake3(base64(contents)+ext)`. Send
a wrong hash and every call still returns 200 — upload "succeeds", deployment
"succeeds" — but the file is never served. Hence `hashForCloudflare()` is a
verbatim port of wrangler's `hashFile`, cross-checked against its actual lib.

### API token scope

`dash.cloudflare.com` → **My Profile → API Tokens → Create Token → Create
Custom Token**. Exactly one permission: **Account · Cloudflare Pages ·
Edit** (the item under the *Account* permission group — not the Zone or User
one). Account Resources → **Include → your account**. No Zone permissions,
no TTL. The token is shown once. The Account ID is on **Workers & Pages →
Overview → right sidebar**, or the hex in the dashboard URL right after
login (`dash.cloudflare.com/<ACCOUNT_ID>`).

**Symptom of a mis-scoped token:** `GET /accounts/{id}/pages/projects` →
`403 code 10000 "Authentication error"` even though `/user/tokens/verify`
says the token is active. Check `GET /accounts` — if it returns `[]`, the
token has no account permission / the account isn't in its resource scope.

### Verified run — 2026-09-07

- `npm run test:cloudflare`: **6/6.** `sample-site` → deploy 12s →
  `https://drydock-hosttest.pages.dev` returns 200 with the real HTML,
  `style.css` 200.
- Full headed-browser Flow A (`E2E_STATIC_HOST=cloudflare
  scripts/e2e-tryit-browser.mjs`): **27/27.** Forced x402 facilitator retry
  → real settlement `0x2a9e2496…be05e1` (Base Sepolia block 46513833,
  independently verified on-chain) → gate clean → published to
  **`https://drydock-1ecdb52b.pages.dev`**, fetched outside the harness:
  200, `server: cloudflare`, expected marker + CSS. Flow C (blocked) also
  passed. Screenshots in `docs/evidence/tryit-2026-09-07T15-43-18/`.

`npm run test:cloudflare` deploys `sample-site` via the host directly (no
payment) and fetches the URL — run it first when wiring Cloudflare.

## `local` — zero-account fallback

Drydock serves the extracted site itself at `/s/<deployId>/` via
`express.static`. No account, works offline and in CI. Not a public URL —
it's the "dumbest thing that works" for proving the pipeline end-to-end, not
the demo target.

## `netlify` — real public URL

One `NETLIFY_AUTH_TOKEN`, no CLI. `NetlifyStaticHost.deploy()`:

1. `POST /sites` (JSON) — creates a site, e.g. `drydock-<first 8 of deployId>`.
2. `PATCH /sites/{id} {sso_login:false}` — see "the SSO gotcha" below.
3. `POST /sites/{id}/deploys` with `Content-Type: application/zip` and the
   whole site as the body — one call, no per-file manifest/JWT dance.
4. Poll `GET /sites/{id}/deploys/{deployId}` until `state === "ready"`.
5. Live URL is the deploy's `ssl_url`.

### Gotcha #1 — `POST /sites` does not take a zip body

An earlier version tried to create-and-deploy in one call by POSTing the zip
straight to `/sites`. Netlify accepts it (200) but ignores the body — you get
an empty site and no deploy object, which then 404s on the poll step
(`GET /deploys/undefined`). There is no one-call site+deploy endpoint for
zips; it's always the two-step flow above.

### Gotcha #2 — new sites can be born access-gated

On an `nf_team_dev`-plan account, every freshly created site inherits
`sso_login: true` (scope `"all"`) from the account default. That means
visiting the *production* URL — not just a preview — returns Netlify's own
"Login Redirect" page (HTTP 401 with an `app.netlify.com/edge-access`
redirect), not your site. Netlify's own deploy-status API still reports
`state: "ready"`, so anything that only polls deploy state (rather than
fetching the URL) won't notice. `NetlifyStaticHost` now `PATCH`es
`sso_login: false` on the site right after creating it, so this is handled
automatically — but if a deploy ever "succeeds" per Drydock yet 401s for a
real visitor, this is the first thing to check (`GET /sites/{id}` and look at
`sso_login` / `account_sso_login`).

## Verifying a deploy actually happened

`GET /deploy/:id` — poll until `state` is `live`, `failed`, or **`blocked`**
(Day 6). `state: "live"` only means the pipeline believes the host accepted
it; the only real proof is fetching `url` yourself and checking the bytes,
which is what `scripts/test-deploy-e2e.mjs` does (`npm run test:deploy`) — it
pays a real x402 fee on Base Sepolia, waits for `onAfterSettle` to publish,
then fetches the resulting URL directly.

Real run, 2026-09-04, against `netlify`: 16/16 assertions passed. Payment tx
`0xbf8084f62cfbac6424bc26ce0723f98beb7cd892a09f1b85a49005dc679f29fa`
(Base Sepolia, block 46381657) independently verified via a direct RPC read
of the settlement's USDC `Transfer` log. Published site:
`https://drydock-d68d2ed5.netlify.app` — fetched directly outside the test
harness and confirmed 200 with the expected HTML/CSS.

## The memory-check gate (Day 6)

Between payment and publish, every deploy is checked against Sibyl's known
`failure-pattern` anchors (`docs/architecture.md` §8.2) — see
`src/memory/deployGate.ts` + `src/deploy/settlement.ts`. Payment always
commits first (`markPaid` is unconditional); the gate only decides whether
`host.deploy()` ever gets called:

- **clean** → deploy proceeds exactly as before Day 6; `GET /deploy/:id`
  shows `gate: { verdict: "clean", topMatch: null, ... }` alongside the live
  `url`.
- **blocked** (a known pattern matched at confidence ≥ 0.6) → `state:
  "blocked"`, `url`/`host` stay `null`, the host is never contacted. The
  record's `gate.topMatch` carries `pattern_id`, `confidence`, and the full
  LLM `rationale`. **Day 6.5:** a blocked deploy is also written to Sibyl as
  an incident (`src/memory/recordBlockedDeploy.ts` → `recordIncident` §6),
  retrievable via `GET /incidents` — the block still stands even if that
  write fails. (**No override/manual-proceed endpoint yet** — Day 7 UI.)
- **gate check itself errors** (bridge crash, LLM API failure) → fails
  closed: `state: "blocked"` with no `gate` field, distinguishable from a
  real match. A security-relevant gate that silently opens on its own
  failure defeats the point of having one.

Real run, 2026-09-04, `npm run test:gate`: 22/22 assertions passed, two real
Base Sepolia payments (both independently verified on-chain):
- **Clean** — `sample-site` paid (tx `0xb8ea59f4…9663d3`, block 46382837),
  gate found nothing, deployed to `https://drydock-4a6aa621.netlify.app`.
- **Blocked** — `leaked-key-site/` (a fixture with a real `build.log`
  leaking an AWS-shaped credential pair via `RUN env >> build.log`) paid (tx
  `0x3b989070…8174e8014`, block 46382845), gate matched
  `exposed-key-in-build-output` at confidence 0.95, halted before deploy —
  confirmed independently that Netlify never created a site for it.

**Known pattern set is read from Sibyl at gate time** (`list_entities` on
WARM `failure-pattern`, status `active`) — no code change needed to add a
new pattern, only a new REFERENCE anchor + entity (§5c/§5b1).

## Dashboard read/write endpoints (Day 6.5)

For the `/dashboard` frontend page:

- **`GET /patterns`** — known `failure-pattern` rollups (incident counts,
  severity ceiling, open/resolved ids, first/last seen) joined with each
  pattern's REFERENCE anchor for `title` + `mechanism`.
- **`GET /incidents?limit=N`** — recent COLD journal events, newest-first,
  `type: "incident" | "collision"`. `limit` clamped to `[1, 500]`, default 50.
- **`POST /deploy/:id/redeploy`** — new deploy from a prior one's retained
  `src.zip` (works after a server restart — reads `deploys/<id>/src.zip` off
  disk). New record carries `redeployOf`. Not payment-gated itself; the new
  deploy then flows through payment + gate normally.

Verified: `npm run test:dashboard` (24/24) + the `test:gate` re-run (25/25,
confirms a real block lands in `GET /incidents` with its rationale).

## Rough latency (Day 9 risk-list input)

`scripts/measure-sibyl-latency.mjs`, one real run, 2026-09-04 — not
averaged, treat as order-of-magnitude:

| Operation | ~Time |
|---|---|
| bare Python-bridge round trip (spawn + trivial op) | 300-330 ms |
| one full write (`recordIncident`, ~5-6 bridge calls) | 2.4 s |
| one full query (`checkBuildAgainstKnownPatterns`) | 8.0 s |
| — of which the Claude Opus 5 reasoning call alone | 5.2 s |
| — of which bridge-only (implied) | ~2.8 s |
| **one full write + query round trip** | **~10.4 s** |

The per-call subprocess-spawn cost (~300 ms, mostly Python interpreter
startup) is the scaling risk, not the SQLite ops themselves: today there's
one known pattern and one `get_reference` call; each additional pattern
loaded individually adds ~300 ms to the query path. If the known-pattern set
grows past a handful, batch the reference-doc loads or move to a persistent
bridge worker instead of one-shot spawns per call.
