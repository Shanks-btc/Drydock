# Drydock — Railway deployment

Mirrors Metron's shape: one repo, two Railway services — **backend** (root
directory `/`, this `src/` Express app) and **web** (root directory `/web`,
the Next.js frontend). Env vars are set in the Railway dashboard, never
committed. Stays on **Base Sepolia** (`eip155:84532`) and the public
`https://x402.org/facilitator` — no mainnet swap.

## What's in the repo (already configured)

| File | Purpose |
| --- | --- |
| `Dockerfile` | Backend image: Node 24 + Python 3.11 + `sibyl-memory-client`. Python is a **runtime** dep — the Sibyl bridge spawns `python3`. Nixpacks Node autodetect can't do this, hence a Dockerfile. |
| `.dockerignore` | Keeps `deploys/`, `public_sites/`, `.env`, `web/`, `node_modules` out of the backend image. |
| `requirements.txt` | `sibyl-memory-client==0.8.0` (zero transitive deps). |
| `railway.json` | Backend service: `DOCKERFILE` builder, healthcheck `GET /health`, restart-on-failure. |
| `web/railway.json` | Web service: `NIXPACKS` builder (standard Next.js), healthcheck `/`. |
| `package.json` / `web/package.json` | `engines.node` pinned (`>=22.6.0` / `>=20`). |
| `Dockerfile` env | `PYTHONIOENCODING=utf-8`, `PYTHONUTF8=1` (Day-8 encoding-bug fix), `SIBYL_PYTHON_BIN=python3`. |
| `src/server.ts` | New `DRYDOCK_DEPLOYS_ROOT` env override so retained `src.zip`s can live on a volume. |
| `src/memory/sibylBridge.ts` | Python default is now `python3` on Linux (was a hardcoded Windows path). |

## Manual steps in the Railway dashboard (in order)

### 0. Prerequisite — the repo must be on GitHub
This directory is **not a git repo yet**. Railway deploys from a connected
GitHub repo (or `railway up` from the CLI). Do: `git init`, commit, push to a
GitHub repo, then in Railway **New Project → Deploy from GitHub repo**.

### 1. Backend service
1. Add the GitHub repo as a service. Name it e.g. `drydock-backend`.
2. **Settings → Root Directory**: `/` (default). It will pick up `railway.json`
   → Dockerfile build.
3. **Settings → Networking → Public Networking → Generate Domain.** Railway
   injects `PORT`; the app already does `app.listen(process.env.PORT)`. Note
   the generated `https://…up.railway.app` URL — the web service needs it.
4. **Volumes → New Volume**, mount path **`/data`** on this service. (Railway
   allows one volume per service; both stores go under it via env vars below.)
5. **Variables** — set all of these (see the table in the next section).
6. Deploy. Watch logs for `Drydock listening on …`, `static host: cloudflare`,
   and the `x402 deploy gate: {…}` line.

### 2. Web service
1. Add the **same** repo as a second service. Name it e.g. `drydock-web`.
2. **Settings → Root Directory**: `/web`. Picks up `web/railway.json` → Nixpacks.
3. **Settings → Networking → Generate Domain.**
4. **Variables** — set `NEXT_PUBLIC_DRYDOCK_API` to the backend domain from
   step 1.3 (**before** the first build — it's inlined at `next build` time).
5. Deploy. If it built before the var was set, redeploy after setting it.

## Environment variables to set in the Railway dashboard

### Backend service

| Variable | Value | Notes |
| --- | --- | --- |
| `DRYDOCK_SELLER_ADDRESS` | `0x…` (40 hex) | **Required — server throws on boot without it.** Keep the current Sepolia sink or use a real receiving address. |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | **Required** — the gate's reasoning step (Claude Opus 5). Missing → gate fail-closes every deploy. |
| `CLOUDFLARE_API_TOKEN` | `cf…` | **Required** — `DRYDOCK_STATIC_HOST=cloudflare` throws on boot without it. Scope: Account · Cloudflare Pages · Edit. |
| `CLOUDFLARE_ACCOUNT_ID` | hex | **Required** (same reason). |
| `DRYDOCK_STATIC_HOST` | `cloudflare` | |
| `DRYDOCK_DEPLOYS_ROOT` | `/data/deploys` | Persist retained `src.zip`s on the volume. |
| `SIBYL_MEMORY_DB` | `/data/sibyl-memory/memory.db` | Persist incident/pattern memory on the volume. |
| `DRYDOCK_DEPLOY_FEE_USDC` | `0.01` | Optional (this is the default). |
| `X402_NETWORK` | `eip155:84532` | Optional — this is the default. **Do not set `eip155:8453`.** |
| `X402_FACILITATOR_URL` | *(unset)* | Defaults to `https://x402.org/facilitator`. Leave unset. |
| `PUBLIC_BASE_URL` | backend domain | Optional; only `LocalStaticHost` uses it, but good hygiene. |
| `NODE_ENV` | `production` | Set in the Dockerfile already; harmless to also set here. |

`PORT` — injected by Railway, do not set. `.env` is not deployed; `npm start`'s
`--env-file-if-exists=.env` no-ops when it's absent.

### Web service

| Variable | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_DRYDOCK_API` | backend `https://…up.railway.app` | **Required, build-time.** No trailing slash. Without it the frontend calls `localhost:3000`. |
| `NEXT_PUBLIC_GITHUB_URL` | repo URL | Optional — nav/footer link (default is a bare `https://github.com/`). |
| `NEXT_PUBLIC_X402_NETWORK` | *(unset)* | Leave unset for Base Sepolia. |

## Likely first-deploy failure points

1. **Backend crash-loops on boot** if `DRYDOCK_SELLER_ADDRESS`,
   `CLOUDFLARE_API_TOKEN`, or `CLOUDFLARE_ACCOUNT_ID` is missing/malformed —
   `payment.ts` and `selectStaticHost()` throw at import. Healthcheck then
   fails the deploy. Set all three before the first deploy.
2. **Frontend points at localhost** if `NEXT_PUBLIC_DRYDOCK_API` wasn't set
   before the web build. Symptom: `/try-it` shows "Couldn't reach the Drydock
   backend". Fix: set it, redeploy the web service.
3. **CORS** — backend `cors()` is fully permissive (no origin allowlist), so
   the browser → backend calls from the web domain work. If that's ever
   tightened, the web domain must be allowed.
4. **Volume not mounted / wrong path** — if `DRYDOCK_DEPLOYS_ROOT` and
   `SIBYL_MEMORY_DB` don't point under the mounted volume, every redeploy
   wipes all memory and breaks redeploy-by-id. Verify the mount path is
   exactly `/data`.
5. **Docker build — `pip install --break-system-packages`** is required on
   Debian bookworm (PEP 668). Already in the Dockerfile; if the base image
   changes, revisit.
6. **`npm ci` needs `package-lock.json` in sync** with `package.json`. It is
   now (engines field added to both — commit the lockfile if `npm i` rewrites
   it locally first).
7. **Sibyl free-tier 5 MB cap** across all tiers combined. Fine at demo scale;
   if hit, writes raise `CapExceededError` and the gate fail-closes. Mitigation:
   clear the volume's `sibyl-memory/` dir, or bind a paid tier.
8. **Cloudflare Pages project limit** (100/account). Drydock creates a new
   `drydock-<id8>` project per deploy. Heavy demo prep can approach it — set
   `CLOUDFLARE_PAGES_PROJECT=drydock` to reuse one project (trade-off: all
   deploys then share one `drydock.pages.dev` showing the latest).
9. **In-memory deploy list resets on every redeploy.** `GET /deploy` (the
   dashboard's live list) is empty after a container restart until new deploys
   land. `/patterns` and `/incidents` survive (Sibyl volume); redeploy-by-id
   survives (disk). Existing behaviour — just more visible in prod.
10. **x402.org facilitator soft-fails** occasionally on settlement submission
    (already surfaced in the `/try-it` UI). Not a deploy issue, but expect the
    occasional "retry" prompt during a live demo.
11. **Gate latency** ~10–50s per deploy (subprocess spawn per Sibyl call +
    the Opus reasoning call). The web poller allows ~2 min; fine, but the
    demo should expect the wait.
