"use client";

// The /try-it state machine. Mirrors the real backend sequence exactly
// (docs/frontend-plan.md §3): upload -> pay (settles first, unconditionally)
// -> poll while the memory-check gate runs server-side -> terminal
// (live | blocked | failed).
//
// Payment retry is a first-class phase, not an error: the public x402
// facilitator intermittently soft-fails settlement (proven in the spike —
// docs/plan.md Day 7). `pay()` and `retryPayment()` are the same call; a
// soft fail lands in phase "payment_retry" with the facilitator's reason,
// and the deploy record is still `awaiting_payment` server-side so a fresh
// payment against the same payUrl just works.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDeploy,
  getDeploy,
  getPricing,
  type CreateDeployResponse,
  type DeployRecord,
  type PricingInfo,
  apiUrl,
} from "./api";
import { payDeployFee, type PaymentResult } from "./payX402";
import { prepareUpload, type PreparedUpload, type PrepProgress } from "./zipFolder";

/** The single "step 1" progress signal — zip preparation (from zipFolder)
 *  plus the POST /deploy upload (bytes sent / total). */
export type UploadStage = PrepProgress | { phase: "uploading"; sent: number; total: number };

export type DeployPhase =
  | "loading" // fetching pricing
  | "picking" // DropZone
  | "preparing" // reading + zipping in the browser
  | "uploading" // POST /deploy in flight
  | "ready" // zipped + uploaded — showing the "N files, X MB — ready" confirmation
  | "upload_failed" // zip succeeded, POST /deploy failed — retryable, blob still in hand
  | "unpaid" // PaymentPanel — connect + pay
  | "paying" // payX402 in flight
  | "payment_retry" // facilitator soft-fail — retryable
  | "scanning" // paid; polling while the gate runs
  | "done" // terminal: read record.state
  | "error"; // fatal (bad upload, pricing down, non-retryable pay error)

export interface DeployMachine {
  phase: DeployPhase;
  pricing: PricingInfo | null;
  prepared: PreparedUpload | null;
  deploy: CreateDeployResponse | null;
  record: DeployRecord | null;
  txHash: string | null;
  payer: string | null;
  /** transient status line during paying / scanning */
  progress: string | null;
  /** step-1 progress: reading → compressing → uploading. Non-null during
   *  "preparing" / "uploading". */
  prepProgress: UploadStage | null;
  /** last facilitator soft-fail (or retryable pay error) detail, for the retry panel */
  paymentIssue: { reason: string; message: string } | null;
  /** number of settlement attempts made (evidence / telemetry) */
  attempts: number;
  /** epoch ms when the scan (poll-for-gate-verdict) began — the gate runs
   *  detached from the payment response, so this is a real ~8-10s window */
  scanStartedAt: number | null;
  /** epoch ms when a poll first saw a terminal state — freeze the elapsed
   *  counter here. `scanEndedAt - scanStartedAt` is how long ScanPanel showed. */
  scanEndedAt: number | null;
  error: string | null;

  selectUpload: (files: File[]) => Promise<void>;
  /** Re-POST the already-zipped blob after an upload failure (no re-zip). */
  retryUpload: () => void;
  /** "ready" → "unpaid": advance the stepper to Pay after the confirmation. */
  continueToPayment: () => void;
  /** Enter the machine at "unpaid" with an already-created deploy — for the
   *  dashboard's repeat-deploy widget (POST /deploy/:id/redeploy returns the
   *  same shape as POST /deploy, minus the client-side zip step). */
  resumeDeploy: (created: CreateDeployResponse) => void;
  pay: () => Promise<void>;
  retryPayment: () => Promise<void>;
  reset: () => void;
}

const POLL_INTERVAL_MS = 1000;
const POLL_MAX_TRIES = 120; // ~2 min — gate LLM call is ~8s, deploy a few s more
const TERMINAL: DeployRecord["state"][] = ["live", "failed", "blocked"];

// Breadcrumbs for the "wired to the real backend" debug page — open DevTools
// → Console and every step of a deploy prints one line. Cheap and quiet.
const log = (...a: unknown[]) => console.info("%c[drydock/try-it]", "color:#2DD4BF", ...a);

export function useDeploy(): DeployMachine {
  const [phase, setPhase] = useState<DeployPhase>("loading");
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [prepared, setPrepared] = useState<PreparedUpload | null>(null);
  const [deploy, setDeploy] = useState<CreateDeployResponse | null>(null);
  const [record, setRecord] = useState<DeployRecord | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [payer, setPayer] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [prepProgress, setPrepProgress] = useState<UploadStage | null>(null);
  const [paymentIssue, setPaymentIssue] = useState<{ reason: string; message: string } | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanEndedAt, setScanEndedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only ever `true` after a genuine unmount. Used to quiet high-frequency
  // progress callbacks — NOT to gate flow transitions (a stuck ref must never
  // be able to strand the machine mid-step).
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  // Pricing on mount — /try-it can't function without it (network, fee).
  useEffect(() => {
    let alive = true;
    log("fetching /pricing…");
    getPricing()
      .then((p) => {
        if (!alive) return;
        log("pricing OK — fee", p.feeUsdc, "USDC ·", p.network, "· host", p.staticHost);
        setPricing(p);
        setPhase("picking");
      })
      .catch((e) => {
        if (!alive) return;
        console.error("[drydock/try-it] /pricing failed:", e);
        setError(
          `Couldn't reach the Drydock backend for pricing (${
            e instanceof Error ? e.message : String(e)
          }). Is \`npm start\` running on :3000?`,
        );
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  const reset = useCallback(() => {
    setPrepared(null);
    setDeploy(null);
    setRecord(null);
    setTxHash(null);
    setPayer(null);
    setProgress(null);
    setPrepProgress(null);
    setPaymentIssue(null);
    setAttempts(0);
    setScanStartedAt(null);
    setScanEndedAt(null);
    setError(null);
    setPhase(pricing ? "picking" : "loading");
  }, [pricing]);

  const resumeDeploy = useCallback((created: CreateDeployResponse) => {
    setPrepared(null);
    setRecord(null);
    setTxHash(null);
    setPayer(null);
    setProgress(null);
    setPrepProgress(null);
    setPaymentIssue(null);
    setAttempts(0);
    setScanStartedAt(null);
    setScanEndedAt(null);
    setError(null);
    setDeploy(created);
    setPhase("unpaid");
  }, []);

  // POST the prepared zip. Split out so an upload failure can retry it
  // without re-reading + re-zipping the folder.
  const doUpload = useCallback(async (prep: PreparedUpload) => {
    setError(null);
    setPhase("uploading");
    setPrepProgress({ phase: "uploading", sent: 0, total: prep.blob.size });
    log(`POST /deploy — ${(prep.blob.size / 1048576).toFixed(2)} MB zip`);
    try {
      const created = await createDeploy(prep.blob, {
        onUploadProgress: (sent, total) => {
          if (!unmounted.current) setPrepProgress({ phase: "uploading", sent, total });
        },
      });
      log("deploy created:", created.deployId, "— state", created.state);
      setDeploy(created);
      setPrepProgress(null);
      setPhase("ready");
    } catch (e) {
      console.error("[drydock/try-it] POST /deploy failed:", e);
      setError(e instanceof Error ? e.message : String(e));
      setPrepProgress(null);
      setPhase("upload_failed");
    }
  }, []);

  const selectUpload = useCallback(
    async (files: File[]) => {
      log(
        `folder picked — ${files.length} entr${files.length === 1 ? "y" : "ies"}`,
        files[0] ? `(first: ${(files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || files[0].name})` : "",
      );
      setError(null);
      setDeploy(null);
      setPrepared(null);
      setPhase("preparing");
      setPrepProgress({ phase: "reading", done: 0, total: files.length, bytes: 0 });
      let prep: PreparedUpload;
      try {
        prep = await prepareUpload(files, (p) => {
          if (!unmounted.current) setPrepProgress(p);
        });
        log(`zipped — ${prep.fileCount} files, ${(prep.totalBytes / 1048576).toFixed(2)} MB`);
      } catch (e) {
        // Zip failures are recoverable — the user needs a different folder
        // anyway. Back to the dropzone with the error shown prominently.
        console.error("[drydock/try-it] preparing the folder failed:", e);
        setError(e instanceof Error ? e.message : String(e));
        setPrepProgress(null);
        setPhase("picking");
        return;
      }
      setPrepared(prep);
      await doUpload(prep);
    },
    [doUpload],
  );

  const retryUpload = useCallback(() => {
    if (prepared) void doUpload(prepared);
  }, [prepared, doUpload]);

  const continueToPayment = useCallback(() => {
    setPhase((p) => (p === "ready" ? "unpaid" : p));
  }, []);

  const runPayment = useCallback(async () => {
    if (!deploy || !pricing) return;
    setPaymentIssue(null);
    setError(null);
    setPhase("paying");
    setAttempts((n) => n + 1);

    let result: PaymentResult;
    try {
      result = await payDeployFee({
        payUrl: apiUrl(deploy.payUrl),
        network: pricing.network,
        onProgress: (m) => !unmounted.current && setProgress(m),
      });
    } catch (e) {
      // Only PayEnvError (no wallet) reaches here.
      console.error("[drydock/try-it] payDeployFee threw:", e);
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
      return;
    }
    log("payment result:", result.status);
    setProgress(null);

    switch (result.status) {
      case "settled": {
        setTxHash(result.txHash);
        setPayer(result.payer);
        setScanStartedAt(Date.now());
        setScanEndedAt(null);
        setPhase("scanning");
        void pollUntilTerminal(deploy.deployId);
        return;
      }
      case "soft_failed": {
        setPaymentIssue({ reason: result.reason, message: result.message });
        setPhase("payment_retry");
        return;
      }
      case "rejected": {
        // They dismissed the wallet prompt — back to the pay button, no scary error.
        setProgress(null);
        setPhase("unpaid");
        return;
      }
      case "error": {
        if (result.retryable) {
          setPaymentIssue({ reason: "error", message: result.message });
          setPhase("payment_retry");
        } else {
          setError(result.message);
          setPhase("error");
        }
        return;
      }
    }
  }, [deploy, pricing]);

  const pollUntilTerminal = useCallback(async (deployId: string) => {
    for (let i = 0; i < POLL_MAX_TRIES; i++) {
      if (unmounted.current) return;
      try {
        const rec = await getDeploy(deployId);
        setRecord((prev) => {
          if (prev?.state !== rec.state) log("deploy state →", rec.state);
          return rec;
        });
        if (rec.txHash) setTxHash((h) => h ?? rec.txHash);
        if (rec.payerAddress) setPayer((p) => p ?? rec.payerAddress);
        if (TERMINAL.includes(rec.state)) {
          setScanEndedAt(Date.now());
          setPhase("done");
          return;
        }
      } catch {
        /* transient — keep polling */
      }
      await sleep(POLL_INTERVAL_MS);
    }
    // Ran out of tries without a terminal state — surface what we last saw.
    setError(
      "The deploy is taking longer than expected to reach a final state. Your payment settled — check the dashboard for this deploy.",
    );
    setPhase("error");
  }, []);

  return {
    phase,
    pricing,
    prepared,
    deploy,
    record,
    txHash,
    payer,
    progress,
    prepProgress,
    paymentIssue,
    attempts,
    scanStartedAt,
    scanEndedAt,
    error,
    selectUpload,
    retryUpload,
    continueToPayment,
    resumeDeploy,
    pay: runPayment,
    retryPayment: runPayment,
    reset,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
