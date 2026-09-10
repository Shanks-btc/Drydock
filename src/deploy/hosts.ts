/**
 * Static hosts — folder-in, live-URL-out.
 *
 * HOST CHOICE (flagged, per the Day 4 brief):
 *
 *   Primary: **Netlify, via its zip-deploy REST API.** For a 10-day build it's
 *   the least code for a real public HTTPS URL:
 *     - one token (a personal access token), no CLI dependency
 *     - a single POST with the whole site as one zip — no per-file SHA upload
 *       (Vercel's /v13/deployments needs that), no manifest + JWT + per-file
 *       upload (Cloudflare Pages direct-upload), no wrangler
 *     - no build config needed for a plain static folder
 *     - poll one endpoint for `state: "ready"`, read `ssl_url`
 *     - more reliable / longer-lived than Surge; fewer moving parts than
 *       S3+CloudFront or Bunny Storage+PullZone (two resources to provision)
 *   Docs verified 2026-09-01: POST /api/v1/sites/{id}/deploys with
 *   Content-Type: application/zip.
 *
 *   **CloudflarePagesStaticHost (added 2026-09-07)** — Netlify's account went
 *   billing-locked ("Account credit usage exceeded"). Cloudflare Pages has a
 *   genuinely free tier (no card) with a real `*.pages.dev` HTTPS URL. Its
 *   direct-upload API is more calls than Netlify's one-shot zip POST — a
 *   per-file blake3 manifest, a JWT, a bulk asset upload, then a deployment —
 *   but it's the wrangler-less flow wrangler itself uses under the hood
 *   (verified 2026-09-07 against workers-sdk `packages/wrangler/src/pages/`
 *   {validate,hash,upload}.ts + `src/api/pages/deploy.ts`). Set
 *   `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` and
 *   `DRYDOCK_STATIC_HOST=cloudflare`.
 *
 *   Fallback: **LocalStaticHost** — Drydock serves the extracted site itself
 *   at /s/<id>/ via express.static. Zero external accounts, works offline and
 *   in CI, and is what the end-to-end wiring test runs against when no
 *   NETLIFY_AUTH_TOKEN is set. Not a public URL — it's the "dumbest thing
 *   that works" for proving the pipeline, not the demo target.
 *
 * The StaticHost interface keeps them swappable; the deploy pipeline
 * doesn't know which one it's talking to.
 */

import fs from "node:fs";
import path from "node:path";
import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";

export interface DeployedSite {
  /** The live, browsable URL of the deployed site's root. */
  url: string;
  /** Which host handled it (for logging / the deploy record). */
  host: string;
  /** Host-specific detail worth keeping (site id, deploy id, ...). */
  meta?: Record<string, unknown>;
}

export interface StaticHost {
  readonly name: string;
  /**
   * Publish the site.
   * @param deployId  Drydock's deploy id (use for naming / paths).
   * @param srcDir    Absolute path to the extracted site folder.
   * @param zipBytes  The original uploaded zip (some hosts take it directly).
   */
  deploy(deployId: string, srcDir: string, zipBytes: Buffer): Promise<DeployedSite>;
}

// ---------------------------------------------------------------------------
// LocalStaticHost
// ---------------------------------------------------------------------------

export class LocalStaticHost implements StaticHost {
  readonly name = "local";

  constructor(
    /** Directory under which each deploy's files are placed: <root>/<deployId>/ */
    private readonly sitesRoot: string,
    /** Public base URL of this Drydock server, e.g. http://localhost:3000 */
    private readonly publicBaseUrl: string,
  ) {}

  async deploy(deployId: string, srcDir: string, _zipBytes: Buffer): Promise<DeployedSite> {
    const dest = path.join(this.sitesRoot, deployId);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(srcDir, dest, { recursive: true });
    return {
      url: `${this.publicBaseUrl.replace(/\/$/, "")}/s/${deployId}/`,
      host: this.name,
      meta: { dest },
    };
  }
}

// ---------------------------------------------------------------------------
// NetlifyStaticHost
// ---------------------------------------------------------------------------
// NOTE: not exercised from the build environment (no NETLIFY_AUTH_TOKEN).
// Kept deliberately defensive. Set NETLIFY_AUTH_TOKEN (a personal access
// token) and optionally NETLIFY_SITE_ID (reuse one site instead of creating
// a fresh one per deploy).

const NETLIFY_API = "https://api.netlify.com/api/v1";

export class NetlifyStaticHost implements StaticHost {
  readonly name = "netlify";

  constructor(
    private readonly token: string,
    private readonly siteId?: string,
    private readonly pollMs = 2000,
    private readonly maxPolls = 60,
  ) {}

  private async api(pathname: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${NETLIFY_API}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Netlify ${init.method ?? "GET"} ${pathname} -> ${res.status}: ${text.slice(0, 400)}`);
    }
    return text ? JSON.parse(text) : {};
  }

  async deploy(deployId: string, _srcDir: string, zipBytes: Buffer): Promise<DeployedSite> {
    // Two steps, per Netlify's zip-deploy docs:
    //   1. POST /sites (JSON)                    -> a site (has an id)
    //   2. POST /sites/{id}/deploys (zip body)   -> a deploy (id + state)
    // POST /sites does NOT accept a zip body — passing one just creates an
    // empty site and returns no deploy, which is the bug this replaced.
    let siteId = this.siteId;
    if (!siteId) {
      const site = await this.api(`/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `drydock-${deployId.slice(0, 8)}` }),
      });
      siteId = site.id;

      // Discovered empirically (2026-09-04, account plan "nf_team_dev"): a
      // freshly created site inherits the ACCOUNT's visitor-access-control
      // default, which on this account is "require Netlify team login for
      // every context, including production" (`sso_login: true` scoped
      // `"all"`). That's invisible until you fetch the URL: it 200s from
      // Drydock's own polling (which only checks deploy `state`), but a
      // real visitor gets a 401 "Login Redirect" page, not the site. A flat
      // PATCH turns that off per-site right after creation, so every deploy
      // is actually public with no manual step. If Netlify ever changes the
      // account default to already-public, this PATCH is a harmless no-op.
      await this.api(`/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sso_login: false }),
      });
    }

    let deploy: any = await this.api(`/sites/${siteId}/deploys`, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      // Node's fetch accepts a Buffer/Uint8Array body.
      body: zipBytes as unknown as BodyInit,
    });

    for (let i = 0; i < this.maxPolls && deploy?.state !== "ready"; i++) {
      if (deploy?.state === "error") {
        throw new Error(`Netlify deploy ${deploy.id} failed: ${deploy.error_message ?? "unknown"}`);
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
      deploy = await this.api(`/sites/${siteId}/deploys/${deploy.id}`);
    }
    if (deploy?.state !== "ready") {
      throw new Error(`Netlify deploy ${deploy?.id} not ready after ${this.maxPolls} polls (state=${deploy?.state})`);
    }

    const url: string = deploy.ssl_url ?? deploy.deploy_ssl_url ?? deploy.deploy_url ?? deploy.url;
    return { url, host: this.name, meta: { siteId, deployId: deploy.id, netlifyState: deploy.state } };
  }
}

// ---------------------------------------------------------------------------
// CloudflarePagesStaticHost
// ---------------------------------------------------------------------------
// Cloudflare Pages "Direct Upload" — the API wrangler drives internally.
// Flow (all verified against workers-sdk `main`, 2026-09-07):
//
//   1. GET  /accounts/{acct}/pages/projects/{project}                 (exists?)
//      POST /accounts/{acct}/pages/projects  {name, production_branch} (create)
//   2. GET  /accounts/{acct}/pages/projects/{project}/upload-token -> { jwt }
//   3. hash every file:  blake3(base64(bytes) + ext_no_dot).hex().slice(0,32)
//   4. POST /pages/assets/check-missing        Bearer <jwt>  {hashes:[...]}
//                                              -> string[] of hashes to send
//   5. POST /pages/assets/upload               Bearer <jwt>
//        [ { key:<hash>, value:<base64>, metadata:{contentType}, base64:true } ]
//   6. POST /pages/assets/upsert-hashes        Bearer <jwt>  {hashes:[all]}
//   7. POST /accounts/{acct}/pages/projects/{project}/deployments
//        multipart:  manifest = JSON{ "/path": "<hash>", ... },  branch
//                                              -> { id, url, latest_stage }
//   8. poll GET .../deployments/{id}  until latest_stage {name:"deploy",
//                                     status:"success"|"failure"}
//
// Steps 4-6 hit api.cloudflare.com with NO /accounts prefix — the JWT from
// step 2 carries the account scope. Every response is Cloudflare's
// {success, errors, result} envelope.

const CF_API = "https://api.cloudflare.com/client/v4";

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  map: "application/json",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  txt: "text/plain",
  xml: "application/xml",
  pdf: "application/pdf",
  wasm: "application/wasm",
  md: "text/markdown",
  csv: "text/csv",
  mp4: "video/mp4",
  webm: "video/webm",
  zip: "application/zip",
};

/** Pages ignores these (wrangler `validate.ts` IGNORE_LIST) — they're config,
 *  not servable assets, and are handled as separate deploy fields. */
const CF_IGNORE = new Set(["_worker.js", "_redirects", "_headers", "_routes.json"]);
const CF_MAX_ASSET_SIZE = 25 * 1024 * 1024;

interface CfEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
}

export class CloudflarePagesStaticHost implements StaticHost {
  readonly name = "cloudflare";

  constructor(
    private readonly apiToken: string,
    private readonly accountId: string,
    /**
     * A FIXED Pages project name to deploy every site into (from
     * CLOUDFLARE_PAGES_PROJECT). When set, the returned URL is that project's
     * shared `<project>.pages.dev` — it always shows the newest deploy.
     *
     * When UNSET (the default, and the Drydock model — one durable URL per
     * paid deploy, like Netlify's site-per-deploy), each deploy gets its own
     * project `drydock-<deployId8>` and its own `drydock-<deployId8>.pages.dev`.
     * That flat `<label>.pages.dev` is covered by Cloudflare's `*.pages.dev`
     * wildcard cert immediately; the deeper per-deployment
     * `<hash>.<project>.pages.dev` needs the project's own `*.<project>` cert
     * which lags minutes-to-hours after project creation — so we never hand
     * that one back.
     */
    private readonly fixedProject?: string,
    private readonly branch = "main",
    private readonly pollMs = 2500,
    private readonly maxPolls = 40,
  ) {}

  private projectFor(deployId: string): string {
    if (this.fixedProject) return this.fixedProject;
    const slug = deployId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "site";
    return `drydock-${slug}`;
  }

  // --- account-scoped calls (Bearer = the API token) --------------------
  private async cf<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${CF_API}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiToken}`, ...(init.headers ?? {}) },
    });
    return this.unwrap<T>(res, `${init.method ?? "GET"} ${pathname}`);
  }

  // --- asset calls (Bearer = the short-lived upload JWT, no /accounts) ---
  private async cfJwt<T>(pathname: string, jwt: string, body: unknown): Promise<T> {
    const res = await fetch(`${CF_API}${pathname}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.unwrap<T>(res, `POST ${pathname}`);
  }

  private async unwrap<T>(res: Response, label: string): Promise<T> {
    const text = await res.text();
    let body: CfEnvelope<T> | undefined;
    try {
      body = text ? (JSON.parse(text) as CfEnvelope<T>) : undefined;
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok || !body || body.success === false) {
      const detail = body?.errors?.map((e) => `${e.code} ${e.message}`).join("; ") || text.slice(0, 400);
      throw new Error(`Cloudflare ${label} -> ${res.status}: ${detail}`);
    }
    return body.result;
  }

  async deploy(deployId: string, srcDir: string, _zipBytes: Buffer): Promise<DeployedSite> {
    const project = this.projectFor(deployId);
    const subdomain = await this.ensureProject(project);

    // 1. hash every servable file (blake3, exactly wrangler's hashFile).
    const files = this.collectFiles(srcDir);
    if (files.length === 0) throw new Error("Cloudflare Pages: no servable files in the build");

    // 2. short-lived upload JWT (account-scoped).
    const { jwt } = await this.cf<{ jwt: string }>(
      `/accounts/${this.accountId}/pages/projects/${project}/upload-token`,
    );

    // 3. which hashes does Pages not already have? (best-effort — on failure,
    //    send everything, same as wrangler's fallback.)
    let missing: string[];
    try {
      missing = await this.cfJwt<string[]>(`/pages/assets/check-missing`, jwt, {
        hashes: files.map((f) => f.hash),
      });
    } catch {
      missing = files.map((f) => f.hash);
    }
    const toUpload = files.filter((f) => missing.includes(f.hash));

    // 4. bulk upload the missing assets (one batch — Drydock sites are small;
    //    wrangler's bucket limits are 40 MB / 2000 files).
    if (toUpload.length > 0) {
      const payload = toUpload.map((f) => ({
        key: f.hash,
        value: fs.readFileSync(f.absPath).toString("base64"),
        metadata: { contentType: f.contentType },
        base64: true,
      }));
      await this.cfJwt(`/pages/assets/upload`, jwt, payload);
    }

    // 5. register the full hash set for this deploy.
    try {
      await this.cfJwt(`/pages/assets/upsert-hashes`, jwt, { hashes: files.map((f) => f.hash) });
    } catch {
      /* wrangler treats this as non-fatal — the deployment still carries the
         full manifest below, this only warms the cross-deploy cache. */
    }

    // 6. create the deployment from the manifest (path -> hash, leading slash).
    const manifest: Record<string, string> = {};
    for (const f of files) manifest[`/${f.key}`] = f.hash;

    const form = new FormData();
    form.append("manifest", JSON.stringify(manifest));
    form.append("branch", this.branch);

    const created = await this.cf<CfDeployment>(
      `/accounts/${this.accountId}/pages/projects/${project}/deployments`,
      { method: "POST", body: form },
    );

    // 7. poll the deploy stage.
    let dep = created;
    for (let i = 0; i < this.maxPolls; i++) {
      const stage = dep.latest_stage;
      if (stage?.name === "deploy" && stage.status === "success") break;
      if (stage?.name === "deploy" && stage.status === "failure") {
        throw new Error(`Cloudflare Pages deployment ${dep.id} failed at the deploy stage`);
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
      dep = await this.cf<CfDeployment>(
        `/accounts/${this.accountId}/pages/projects/${project}/deployments/${dep.id}`,
      );
    }
    if (!(dep.latest_stage?.name === "deploy" && dep.latest_stage.status === "success")) {
      throw new Error(
        `Cloudflare Pages deployment ${dep.id} not ready after ${this.maxPolls} polls ` +
          `(stage ${dep.latest_stage?.name}/${dep.latest_stage?.status})`,
      );
    }

    // The project subdomain — `<project>.pages.dev`, covered by the *.pages.dev
    // wildcard cert right away. `dep.url` is the deeper `<hash>.<project>`
    // form whose cert can lag on a brand-new project, so it's meta only.
    const url = `https://${subdomain}`;
    return {
      url,
      host: this.name,
      meta: { projectName: project, deploymentId: dep.id, deploymentUrl: dep.url },
    };
  }

  /** Ensure the project exists; return its `<name>.pages.dev` subdomain
   *  (Cloudflare may append a suffix if the label is globally taken). */
  private async ensureProject(project: string): Promise<string> {
    try {
      const existing = await this.cf<CfProject>(
        `/accounts/${this.accountId}/pages/projects/${project}`,
      );
      if (existing.subdomain) return existing.subdomain;
    } catch (err) {
      // CF code 8000007 == project not found. Anything else (auth, rate) is real.
      if (!/8000007|not found|404/i.test(err instanceof Error ? err.message : String(err))) throw err;
    }
    const made = await this.cf<CfProject>(`/accounts/${this.accountId}/pages/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: project, production_branch: this.branch }),
    });
    if (made.subdomain) return made.subdomain;
    // Fallback: re-read (subdomain is normally on the create response).
    const fetched = await this.cf<CfProject>(
      `/accounts/${this.accountId}/pages/projects/${project}`,
    );
    return fetched.subdomain ?? `${project}.pages.dev`;
  }

  /** Walk srcDir into {key, absPath, hash, contentType}. `key` is the POSIX
   *  relative path (no leading slash) — the manifest key without its `/`. */
  private collectFiles(srcDir: string): CfFile[] {
    const out: CfFile[] = [];
    const walk = (dir: string, rel: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === ".DS_Store" || entry.name === "node_modules" || entry.name === ".git") continue;
        const abs = path.join(dir, entry.name);
        const key = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          walk(abs, key);
          continue;
        }
        if (CF_IGNORE.has(key)) continue;
        const bytes = fs.readFileSync(abs);
        if (bytes.length > CF_MAX_ASSET_SIZE) {
          throw new Error(`Cloudflare Pages: ${key} exceeds the 25 MiB per-file limit`);
        }
        out.push({
          key,
          absPath: abs,
          hash: hashForCloudflare(bytes, path.extname(entry.name).slice(1)),
          contentType: CONTENT_TYPES[path.extname(entry.name).slice(1).toLowerCase()] ?? "application/octet-stream",
        });
      }
    };
    walk(srcDir, "");
    return out;
  }
}

interface CfFile {
  key: string;
  absPath: string;
  hash: string;
  contentType: string;
}

interface CfDeployment {
  id: string;
  url: string;
  project_name?: string;
  aliases?: string[];
  latest_stage?: { name: string; status: string };
}

interface CfProject {
  name: string;
  /** `<project>.pages.dev` (no scheme) — CF may suffix the label. */
  subdomain?: string;
}

/** wrangler's `hashFile`, byte-for-byte: blake3 over the base64 text of the
 *  file plus its extension (no dot), first 32 hex chars. The lookup on
 *  Cloudflare's side re-derives this exact key, so it MUST match. */
export function hashForCloudflare(contents: Buffer, extensionNoDot: string): string {
  const input = contents.toString("base64") + extensionNoDot;
  return bytesToHex(blake3(new TextEncoder().encode(input))).slice(0, 32);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface HostEnv {
  DRYDOCK_STATIC_HOST?: string;
  NETLIFY_AUTH_TOKEN?: string;
  NETLIFY_SITE_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_PAGES_PROJECT?: string;
  PUBLIC_BASE_URL?: string;
  DRYDOCK_SITES_ROOT?: string;
}

export function selectStaticHost(env: HostEnv, defaultSitesRoot: string): StaticHost {
  const choice = (env.DRYDOCK_STATIC_HOST ?? "").toLowerCase();
  const local = () =>
    new LocalStaticHost(
      env.DRYDOCK_SITES_ROOT ?? defaultSitesRoot,
      env.PUBLIC_BASE_URL ?? "http://localhost:3000",
    );

  if (choice === "local") return local();

  if (choice === "cloudflare" || (!choice && env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID)) {
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
      throw new Error(
        "DRYDOCK_STATIC_HOST=cloudflare needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID",
      );
    }
    return new CloudflarePagesStaticHost(
      env.CLOUDFLARE_API_TOKEN,
      env.CLOUDFLARE_ACCOUNT_ID,
      env.CLOUDFLARE_PAGES_PROJECT || undefined,
    );
  }

  if (choice === "netlify" || (!choice && env.NETLIFY_AUTH_TOKEN)) {
    if (!env.NETLIFY_AUTH_TOKEN) throw new Error("DRYDOCK_STATIC_HOST=netlify but NETLIFY_AUTH_TOKEN is not set");
    return new NetlifyStaticHost(env.NETLIFY_AUTH_TOKEN, env.NETLIFY_SITE_ID || undefined);
  }

  return local();
}
