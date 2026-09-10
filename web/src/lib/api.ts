// Typed client for the Drydock backend (src/server.ts). Every shape here is
// the server's real response — `publicRecord()` in src/server.ts, `/pricing`
// from `paymentConfigSummary()`, `/patterns` + `/incidents` from Day 6.5.
//
// Reads work from server OR client (backend CORS is permissive). The /try-it
// flow calls these from the browser.

import { API_BASE } from "./constants";
import { demojibake } from "./format";

// --- deploy pipeline -----------------------------------------------------

export type DeployState =
  | "awaiting_payment"
  | "paid"
  | "deploying"
  | "live"
  | "failed"
  | "blocked";

/** One LLM-judged match against a known failure pattern (src/memory/patternMatch.ts). */
export interface CandidateMatch {
  pattern_id: string;
  reference_key: string;
  confidence: number;
  rationale: string;
}

/** A signal the reasoning step judged to be a genuinely new cause with no
 *  matching known pattern (src/memory/patternMatch.ts). Informational only —
 *  not a block, not yet promoted to a pattern. */
export interface NewPatternCandidate {
  signal: string;
  reasoning: string;
}

/** src/memory/deployGate.ts GateResult, as surfaced by publicRecord(). */
export interface GateResult {
  verdict: "clean" | "blocked";
  checkedAt: string;
  signalsExtracted: number;
  knownPatternsChecked: number;
  scannedFiles: string[];
  topMatch: CandidateMatch | null;
  newPatternCandidates: NewPatternCandidate[];
}

export interface DeployRecord {
  id: string;
  state: DeployState;
  createdAt: string;
  fileCount: number;
  hasRootIndex: boolean;
  indexHint: string | null;
  redeployOf: string | null;
  payerAddress: string | null;
  txHash: string | null;
  paidAt: string | null;
  url: string | null;
  host: string | null;
  liveAt: string | null;
  error: string | null;
  gate: GateResult | null;
  blockedAt: string | null;
}

export interface CreateDeployResponse {
  deployId: string;
  state: DeployState;
  fileCount: number;
  /** is there an index.html at the deploy root? A static host serves `/` from
   *  there — without it the site 404s at its root URL. */
  hasRootIndex: boolean;
  /** when the content looks double-wrapped, the nested entry point, e.g.
   *  "dist/index.html" — otherwise null. */
  indexHint: string | null;
  payUrl: string; // "/deploy/:id/pay"
  statusUrl: string; // "/deploy/:id"
  feeUsdc: number;
  /** present only on the POST /deploy/:id/redeploy response */
  redeployOf?: string;
}

export interface PricingInfo {
  deployFeeUsdc: number;
  staticHost: string;
  network: string; // CAIP-2, e.g. "eip155:84532"
  facilitatorUrl: string;
  payTo: string;
  asset: string;
  feeUsdc: number;
  feeAtomic: string;
  eip712: { name: string; version: string };
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(`Drydock returned non-JSON (HTTP ${res.status})`, res.status, text.slice(0, 300));
  }
  if (!res.ok) {
    const msg = (body as { error?: string })?.error ?? `Drydock request failed (HTTP ${res.status})`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getPricing(signal?: AbortSignal): Promise<PricingInfo> {
  return fetch(`${API_BASE}/pricing`, { cache: "no-store", signal }).then((r) => json<PricingInfo>(r));
}

/** POST the site as a zip body. The backend extracts + counts files and
 *  returns the pay/status URLs. Throws ApiError on a rejected upload.
 *
 *  Uses XHR (not fetch) when `onUploadProgress` is given — fetch has no
 *  upload-progress event, and /try-it wants a determinate "X / Y MB" bar. */
export function createDeploy(
  zip: Blob,
  opts: { onUploadProgress?: (sent: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<CreateDeployResponse> {
  const { onUploadProgress, signal } = opts;
  if (!onUploadProgress) {
    return fetch(`${API_BASE}/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: zip,
      signal,
    }).then((r) => json<CreateDeployResponse>(r));
  }

  return new Promise<CreateDeployResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/deploy`);
    xhr.setRequestHeader("Content-Type", "application/zip");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let body: unknown;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        reject(new ApiError(`Drydock returned non-JSON (HTTP ${xhr.status})`, xhr.status, xhr.responseText.slice(0, 300)));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as CreateDeployResponse);
      } else {
        reject(new ApiError((body as { error?: string })?.error ?? `Drydock request failed (HTTP ${xhr.status})`, xhr.status, body));
      }
    };
    xhr.onerror = () => reject(new ApiError("Couldn't reach the Drydock backend (network error). Is it running?", 0));
    xhr.ontimeout = () => reject(new ApiError("The upload timed out.", 0));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(zip);
  });
}

export function getDeploy(id: string, signal?: AbortSignal): Promise<DeployRecord> {
  return fetch(`${API_BASE}/deploy/${encodeURIComponent(id)}`, { cache: "no-store", signal }).then((r) =>
    json<DeployRecord>(r),
  );
}

export function listDeploys(signal?: AbortSignal): Promise<DeployRecord[]> {
  return fetch(`${API_BASE}/deploy`, { cache: "no-store", signal }).then((r) => json<DeployRecord[]>(r));
}

/** Re-trigger a prior deploy from its retained src.zip (Day 6.5). The new
 *  deploy is `awaiting_payment` and flows through payment + gate again. */
export function redeploy(id: string, signal?: AbortSignal): Promise<CreateDeployResponse> {
  return fetch(`${API_BASE}/deploy/${encodeURIComponent(id)}/redeploy`, { method: "POST", signal }).then((r) =>
    json<CreateDeployResponse>(r),
  );
}

/** Absolute URL for a relative path the backend hands back (payUrl/statusUrl). */
export function apiUrl(pathFromBackend: string): string {
  return `${API_BASE}${pathFromBackend}`;
}

// --- Day 6.5 incident-memory reads -------------------------------------

/** GET /patterns — one row per known `failure-pattern`, the reconciled
 *  rollup joined with its REFERENCE anchor (title + mechanism). */
export interface Pattern {
  patternId: string;
  title: string;
  mechanism: string | null;
  status: string | null;
  incidentCount: number;
  openIncidentIds: string[];
  resolvedIncidentIds: string[];
  severityCeiling: string | null;
  firstSeenTs: string | null;
  lastSeenTs: string | null;
  statusNote: string | null;
  referenceKey: string;
}

/** GET /incidents — a COLD journal event, mapped to a compact shape.
 *  `type: "collision"` is a content-hash quarantine, not a gate block. */
export interface Incident {
  type: "incident" | "collision";
  eventId: string;
  ts: string;
  incidentId: string | null;
  patternId: string | null;
  summary: string | null;
  severity: string | null;
  locator: string | null;
  blockedDeploy: boolean | null;
  status: string | null;
  matchConfidence: number | null;
  matchRationale: string | null;
}

export function getPatterns(signal?: AbortSignal): Promise<Pattern[]> {
  return fetch(`${API_BASE}/patterns`, { cache: "no-store", signal })
    .then((r) => json<Pattern[]>(r))
    .then((rows) => rows.map((p) => ({ ...p, mechanism: p.mechanism ? demojibake(p.mechanism) : null })));
}

export function getIncidents(limit = 50, signal?: AbortSignal): Promise<Incident[]> {
  return fetch(`${API_BASE}/incidents?limit=${limit}`, { cache: "no-store", signal })
    .then((r) => json<Incident[]>(r))
    .then((rows) =>
      rows.map((i) => ({
        ...i,
        summary: i.summary ? demojibake(i.summary) : null,
        matchRationale: i.matchRationale ? demojibake(i.matchRationale) : null,
      })),
    );
}
