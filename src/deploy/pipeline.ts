/**
 * Deploy pipeline.
 *
 * folder (as a zip) in  ->  [memory-check gate]  ->  static host  ->  live URL.
 *
 * NO ownership recording yet (that's separate from the Day 6 memory-check
 * gate — still not built). Payment fields ARE stored on the record, but
 * that's just local bookkeeping for the receipt — not the Sibyl ownership
 * feature.
 *
 * The Day 6 gate (src/memory/deployGate.ts) sits between payment and
 * publish: `paid -> [gate: clean] -> deploying -> (live | failed)`, or
 * `paid -> [gate: blocked] -> blocked`. The gate never affects whether
 * `markPaid` succeeds — payment is already committed by the time the gate
 * runs (see src/deploy/settlement.ts).
 *
 * State store is an in-memory Map (mirrors Valiquo/Metron's original build
 * order — Postgres comes later). Deploy artifacts live on disk under
 * <deploysRoot>/<id>/.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

import type { StaticHost } from "./hosts.ts";
import type { GateResult } from "../memory/deployGate.ts";

export type DeployState =
  | "awaiting_payment"
  | "paid"
  | "deploying"
  | "live"
  | "failed"
  | "blocked";

export interface DeployRecord {
  id: string;
  createdAt: string;
  state: DeployState;
  srcZipPath: string;
  srcDir: string;
  fileCount: number;
  /** Set when this deploy was created by re-triggering a prior one (Day 6.5). */
  redeployOf?: string;
  // Local payment bookkeeping (NOT the ownership feature).
  payerAddress?: string;
  txHash?: string;
  paidAt?: string;
  // Day 6 memory-check gate result — set regardless of verdict, so a clean
  // deploy's record still shows what was checked.
  gate?: GateResult;
  blockedAt?: string;
  // Result.
  url?: string;
  host?: string;
  hostMeta?: Record<string, unknown>;
  liveAt?: string;
  error?: string;
  // Pre-deploy sanity: is there an `index.html` at the deploy root? A static
  // host serves the root URL from there — without it the site 404s at `/`
  // even though the deploy "succeeds". `indexHint` names a nested one when
  // the content looks double-wrapped (zipped the folder, not its contents).
  hasRootIndex: boolean;
  indexHint?: string;
}

export class DeployPipeline {
  private readonly deploys = new Map<string, DeployRecord>();

  constructor(private readonly deploysRoot: string) {
    fs.mkdirSync(this.deploysRoot, { recursive: true });
  }

  /** Accept an uploaded site (a zip of the folder). Extract, record, await payment. */
  createDeploy(zipBytes: Buffer): DeployRecord {
    const id = crypto.randomUUID();
    const dir = path.join(this.deploysRoot, id);
    const srcDir = path.join(dir, "src");
    const srcZipPath = path.join(dir, "src.zip");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(srcZipPath, zipBytes);

    const zip = new AdmZip(zipBytes);
    // adm-zip >=0.5.10 guards extractAllTo against zip-slip.
    zip.extractAllTo(srcDir, /* overwrite */ true);
    const fileCount = countFiles(srcDir);
    if (fileCount === 0) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error("uploaded archive contained no files");
    }

    const { hasRootIndex, indexHint } = inspectEntrypoint(srcDir);

    const record: DeployRecord = {
      id,
      createdAt: new Date().toISOString(),
      state: "awaiting_payment",
      srcZipPath,
      srcDir,
      fileCount,
      hasRootIndex,
      indexHint,
    };
    this.deploys.set(id, record);
    return record;
  }

  /**
   * Re-trigger a prior deploy: create a NEW deploy from its retained
   * `src.zip`. Falls back to reading `<deploysRoot>/<fromId>/src.zip` off
   * disk when the in-memory record is gone (e.g. after a server restart) —
   * the artifact dirs outlive the Map. New deploy flows through payment +
   * gate again from scratch. (Day 6.5, for the dashboard repeat-deploy widget.)
   */
  redeploy(fromId: string): DeployRecord {
    if (!/^[0-9a-fA-F-]{36}$/.test(fromId)) {
      throw new Error(`invalid deploy id ${fromId}`);
    }
    const known = this.deploys.get(fromId);
    const zipPath = known?.srcZipPath ?? path.join(this.deploysRoot, fromId, "src.zip");
    if (!fs.existsSync(zipPath)) {
      throw new Error(`unknown deploy ${fromId}`);
    }
    const rec = this.createDeploy(fs.readFileSync(zipPath));
    rec.redeployOf = fromId;
    return rec;
  }

  get(id: string): DeployRecord | undefined {
    return this.deploys.get(id);
  }

  list(): DeployRecord[] {
    return [...this.deploys.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Compare-and-set awaiting_payment -> paid. Returns true if THIS call did
   * the transition (so the caller should proceed to deploy), false if the
   * record was already past that point — the idempotency guard against a
   * re-fired settlement hook.
   */
  markPaid(id: string, payment: { payerAddress?: string; txHash?: string }): boolean {
    const r = this.deploys.get(id);
    if (!r || r.state !== "awaiting_payment") return false;
    r.state = "paid";
    r.payerAddress = payment.payerAddress;
    r.txHash = payment.txHash;
    r.paidAt = new Date().toISOString();
    return true;
  }

  /** Attach the Day 6 gate result to the record. Informational only — no
   *  state transition, so it's safe to call regardless of verdict before
   *  the caller decides whether to proceed to runDeploy or blockDeploy. */
  recordGateResult(id: string, gate: GateResult): void {
    const r = this.deploys.get(id);
    if (!r) return;
    r.gate = gate;
  }

  /**
   * Compare-and-set paid -> blocked. Returns true if THIS call did the
   * transition (mirrors markPaid's CAS pattern) — guards a re-fired
   * settlement hook from double-processing a block the same way it already
   * guards double-payment.
   */
  blockDeploy(id: string): boolean {
    const r = this.deploys.get(id);
    if (!r || r.state !== "paid") return false;
    r.state = "blocked";
    r.blockedAt = new Date().toISOString();
    return true;
  }

  /**
   * paid -> deploying -> (live | failed). Idempotent: only runs from `paid`.
   * Returns the record in its resulting state (never throws for a deploy
   * failure — the failure is recorded on the record).
   */
  async runDeploy(id: string, host: StaticHost): Promise<DeployRecord> {
    const r = this.deploys.get(id);
    if (!r) throw new Error(`unknown deploy ${id}`);
    if (r.state !== "paid") return r; // already deploying/live/failed, or unpaid
    r.state = "deploying";
    try {
      const site = await host.deploy(r.id, r.srcDir, fs.readFileSync(r.srcZipPath));
      r.url = site.url;
      r.host = site.host;
      r.hostMeta = site.meta;
      r.liveAt = new Date().toISOString();
      r.state = "live";
    } catch (err) {
      r.state = "failed";
      r.error = err instanceof Error ? err.message : String(err);
    }
    return r;
  }
}

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(full);
    else if (entry.isFile()) n += 1;
  }
  return n;
}

/**
 * Is there an `index.html` at the deploy root? If not, look one level down —
 * a single content-bearing subdirectory with its own `index.html` is the
 * classic "zipped the folder instead of its contents" mistake, worth calling
 * out specifically. Case-insensitive on the filename.
 */
function inspectEntrypoint(srcDir: string): { hasRootIndex: boolean; indexHint?: string } {
  const rootEntries = safeReaddir(srcDir);
  const hasRootIndex = rootEntries.some((e) => e.isFile() && e.name.toLowerCase() === "index.html");
  if (hasRootIndex) return { hasRootIndex: true };

  // Ignore junk when deciding "there's just one real subdir".
  const junk = new Set([".git", "node_modules", ".ds_store", "__macosx", ".next"]);
  const dirs = rootEntries.filter((e) => e.isDirectory() && !junk.has(e.name.toLowerCase()));
  const looseFiles = rootEntries.filter((e) => e.isFile() && !e.name.startsWith("."));
  if (dirs.length === 1 && looseFiles.length === 0) {
    const inner = safeReaddir(path.join(srcDir, dirs[0].name));
    if (inner.some((e) => e.isFile() && e.name.toLowerCase() === "index.html")) {
      return { hasRootIndex: false, indexHint: `${dirs[0].name}/index.html` };
    }
  }
  return { hasRootIndex: false };
}

function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
