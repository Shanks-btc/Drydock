// Single source of truth for the /docs page: the sidebar nav (id -> label)
// and the API-reference endpoint list. The page renders one <section> per
// nav entry with the matching id; the endpoint table is generated from
// ENDPOINTS. Everything here describes the backend as it ACTUALLY is
// (src/server.ts) — no aspirational routes.

export interface DocNavItem {
  id: string;
  label: string;
}

export const DOCS_NAV: DocNavItem[] = [
  { id: "overview", label: "Overview" },
  { id: "memory-check", label: "The memory check" },
  { id: "payment", label: "The payment flow" },
  { id: "deploy-states", label: "Deploy record states" },
  { id: "api", label: "API reference" },
];

export interface Endpoint {
  method: "GET" | "POST";
  path: string;
  /** payment-gated via x402 */
  gated?: boolean;
  summary: string;
  request?: string;
  /** a real, trimmed response body */
  response: string;
  notes?: string[];
}

export const ENDPOINTS: Endpoint[] = [
  {
    method: "POST",
    path: "/deploy",
    summary: "Upload a static site as a zip of its folder. Extracts it, counts files, opens a deploy awaiting payment.",
    request: `Content-Type: application/zip
<the site folder, zipped>          # 50 MB max`,
    response: `201 Created
{
  "deployId": "1ecdb52b-8c3a-4f0e-9d21-7b6a0c4e5f88",
  "state": "awaiting_payment",
  "fileCount": 2,
  "hasRootIndex": true,          // false → the site 404s at "/" (no root index.html)
  "indexHint": null,             // e.g. "dist/index.html" when the folder looks double-wrapped
  "payUrl": "/deploy/1ecdb52b-.../pay",
  "statusUrl": "/deploy/1ecdb52b-...",
  "feeUsdc": 0.01
}`,
    notes: [
      "400 if the body isn't a non-empty zip, or the archive has no files.",
      "`hasRootIndex` is a warning signal only — a deploy with no root index.html still proceeds.",
    ],
  },
  {
    method: "GET",
    path: "/deploy",
    summary: "Every deploy this server knows about, newest first.",
    response: `200 OK
[ { "id": "...", "state": "live", "url": "https://drydock-1ecdb52b.pages.dev",
    "gate": { "verdict": "clean", ... }, "txHash": "0x2a9e…", ... }, ... ]`,
    notes: ["In-memory — resets on server restart. Artifacts on disk outlive it (see /deploy/:id/redeploy)."],
  },
  {
    method: "GET",
    path: "/deploy/:id",
    summary: "One deploy's full record — poll this after paying for the live URL or the gate verdict.",
    response: `200 OK
{
  "id": "1ecdb52b-...",
  "state": "live",                    // awaiting_payment | paid | deploying | live | failed | blocked
  "createdAt": "2026-09-07T15:43:31.008Z",
  "fileCount": 2,
  "redeployOf": null,
  "payerAddress": "0xaFD8730A20E57F1FEfD4b7BC680DB89bAA4d95A8",
  "txHash": "0x2a9e249643949268397f472bec76b958265d0476618f002ea9b0727dcebe05e1",
  "paidAt": "2026-09-07T15:43:31.5Z",
  "url": "https://drydock-1ecdb52b.pages.dev",
  "host": "cloudflare",
  "liveAt": "2026-09-07T15:44:01.9Z",
  "error": null,
  "gate": {
    "verdict": "clean",              // or "blocked"
    "checkedAt": "2026-09-07T15:43:32.1Z",
    "signalsExtracted": 2,
    "knownPatternsChecked": 1,
    "scannedFiles": ["index.html", "style.css"],
    "topMatch": null                 // { pattern_id, confidence, rationale } when blocked
  },
  "blockedAt": null
}`,
    notes: ["404 if the id is unknown."],
  },
  {
    method: "GET",
    path: "/deploy/:id/pay",
    gated: true,
    summary: "Pay the flat deploy fee. x402 `exact` scheme on Base — a signed EIP-3009 authorization, the facilitator submits it and pays gas.",
    response: `402 Payment Required              # first hit — carries the PAYMENT-REQUIRED header
200 OK                            # after a valid PAYMENT-SIGNATURE
{ "deployId": "...", "paid": true, "statusUrl": "/deploy/..." }
# PAYMENT-RESPONSE header carries { success, transaction, payer, network }`,
    notes: [
      "The publish runs on settlement (onAfterSettle), not in this response — poll statusUrl.",
      "A facilitator soft-fail returns 402 with PAYMENT-RESPONSE { success:false }; retry with a fresh payment.",
    ],
  },
  {
    method: "POST",
    path: "/deploy/:id/redeploy",
    summary: "Re-trigger a prior deploy from its retained src.zip. New deploy is awaiting_payment; flows through payment + the gate again.",
    response: `201 Created
{ "deployId": "<new id>", "state": "awaiting_payment", "fileCount": 2,
  "redeployOf": "1ecdb52b-...", "payUrl": "...", "statusUrl": "...", "feeUsdc": 0.01 }`,
    notes: [
      "Reads deploys/<id>/src.zip off disk, so it works even after a restart wiped the in-memory record.",
      "Not payment-gated itself. 404 if no retained zip for that id.",
    ],
  },
  {
    method: "GET",
    path: "/patterns",
    summary: "Known failure patterns — the reconciled WARM rollups joined with each pattern's REFERENCE anchor (title + mechanism).",
    response: `200 OK
[ {
  "patternId": "exposed-key-in-build-output",
  "title": "Exposed key in build output",
  "mechanism": "A build step interpolates a secret into output that is then persisted or shipped…",
  "status": "active",
  "incidentCount": 10,
  "openIncidentIds": ["inc_1d51c04c…", …],
  "resolvedIncidentIds": [],
  "severityCeiling": "critical",
  "firstSeenTs": "2026-09-04T14:45:15.388Z",
  "lastSeenTs":  "2026-09-07T15:46:44.831Z",
  "referenceKey": "pattern/exposed-key-in-build-output"
} ]`,
    notes: ["502 if the Sibyl bridge is unreachable."],
  },
  {
    method: "GET",
    path: "/incidents",
    summary: "Recent incident-memory activity — COLD journal events, newest first.",
    request: `?limit=50                         # clamped to [1, 500]`,
    response: `200 OK
[ {
  "type": "incident",              // or "collision" (a content-hash quarantine)
  "eventId": "935e593b-…",
  "ts": "2026-09-07T15:46:44.831Z",
  "incidentId": "inc_1d51c04c…",
  "patternId": "exposed-key-in-build-output",
  "summary": "Deploy 562d5d51 blocked: build matched exposed-key-in-build-output",
  "severity": "high",
  "locator": "deploy/562d5d51-…#gate.exposed-key-in-build-output",
  "blockedDeploy": true,
  "matchConfidence": 0.95,
  "matchRationale": "Step 5/9 runs \`RUN env >> /app/dist/build.log\`, interpolating…"
} ]`,
  },
  {
    method: "GET",
    path: "/pricing",
    summary: "The deploy fee, settlement network, USDC asset + EIP-712 domain, and which static host is active.",
    response: `200 OK
{ "deployFeeUsdc": 0.01, "staticHost": "cloudflare", "network": "eip155:84532",
  "payTo": "0x4Aa7…E8AF", "asset": "0x036CbD…dCF7e", "feeAtomic": "10000",
  "eip712": { "name": "USDC", "version": "2" } }`,
  },
  {
    method: "GET",
    path: "/health",
    summary: "Liveness.",
    response: `200 OK
{ "status": "ok" }`,
  },
];
