"use client";

import { useState } from "react";
import Card from "@/components/primitives/Card";
import StatusPill from "@/components/primitives/StatusPill";
import { formatBytes } from "@/lib/format";
import type { PreparedUpload } from "@/lib/zipFolder";
import type { CreateDeployResponse } from "@/lib/api";
import type { DeployMachine, UploadStage } from "@/lib/useDeploy";

// Step 1 (Upload) internals — lives inside the existing 4-step stepper, adds
// no step. Three visible states:
//   preparing/uploading  -> <UploadProgress>   (reading bar → indeterminate
//                                               compress → upload bar)
//   ready                -> <UploadReady>      ("N files, X MB — ready" + Continue)
//   upload_failed        -> <UploadFailed>     (error + Retry upload)

const STAGE_LABEL: Record<UploadStage["phase"], string> = {
  reading: "Reading",
  compressing: "Zipping",
  uploading: "Uploading",
};

export default function UploadProgress({ m }: { m: DeployMachine }) {
  const stage: UploadStage = m.prepProgress ?? { phase: "reading", done: 0, total: 0, bytes: 0 };

  let pct: number | null = null;
  let title = "";
  let detail = "";
  if (stage.phase === "reading") {
    pct = stage.total > 0 ? (stage.done / stage.total) * 100 : 0;
    title = "Reading the folder";
    detail = `${stage.done} / ${stage.total} file${stage.total === 1 ? "" : "s"} · ${formatBytes(stage.bytes)}`;
  } else if (stage.phase === "compressing") {
    pct = null; // fflate's one-shot zip() gives no per-chunk progress
    title = "Compressing";
    detail = `${stage.files} file${stage.files === 1 ? "" : "s"} · ${formatBytes(stage.bytes)} — zipping in your browser`;
  } else {
    pct = stage.total > 0 ? (stage.sent / stage.total) * 100 : 0;
    title = "Uploading to Drydock";
    detail = `${formatBytes(stage.sent)} / ${formatBytes(stage.total)}`;
  }

  return (
    <Card className="max-w-[560px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink-heading">Preparing your build</h2>
        <StatusPill tone="accent" pulse>
          {STAGE_LABEL[stage.phase]}
        </StatusPill>
      </div>

      <ol className="mt-5 space-y-2 text-[13px]">
        <SubStep label="Read files" state={stage.phase === "reading" ? "active" : "done"} />
        <SubStep
          label="Compress — client-side zip"
          state={stage.phase === "reading" ? "pending" : stage.phase === "compressing" ? "active" : "done"}
        />
        <SubStep label="Upload to the backend" state={stage.phase === "uploading" ? "active" : "pending"} />
      </ol>

      <div className="mt-5">
        <div className="flex items-baseline justify-between text-[12.5px]">
          <span className="text-ink-heading">{title}</span>
          <span className="font-mono text-ink-label">{pct !== null ? `${Math.round(pct)}%` : ""}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
          {pct !== null ? (
            <div
              className="h-full rounded-full bg-accent-gradient transition-[width] duration-200 ease-out"
              style={{ width: `${Math.max(3, pct)}%` }}
            />
          ) : (
            <div className="h-full w-1/3 rounded-full bg-accent-gradient animate-indeterminate" />
          )}
        </div>
        <p className="mt-2 font-mono text-[12px] text-ink-label">{detail}</p>
      </div>
    </Card>
  );
}

function SubStep({ label, state }: { label: string; state: "pending" | "active" | "done" }) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
          state === "done"
            ? "bg-success/15 text-success"
            : state === "active"
              ? "bg-accent/15 text-accent-light"
              : "border border-white/12 text-transparent"
        }`}
      >
        {state === "done" ? "✓" : state === "active" ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : "•"}
      </span>
      <span className={state === "pending" ? "text-ink-label" : "text-ink-body"}>{label}</span>
    </li>
  );
}

// --- the confirmation, before the stepper advances to Pay -----------------

export function UploadReady({
  prepared,
  deploy,
  onContinue,
}: {
  prepared: PreparedUpload;
  deploy: CreateDeployResponse | null;
  onContinue: () => void;
}) {
  const summary = prepared.passthrough
    ? prepared.paths[0]
    : `${prepared.fileCount} file${prepared.fileCount === 1 ? "" : "s"}`;

  // Warn (don't block) when there's no index.html at the deploy root — the
  // static host serves `/` from there, so the site would 404 at its root URL.
  const missingRootIndex = deploy ? deploy.hasRootIndex === false : false;
  const [warningDismissed, setWarningDismissed] = useState(false);

  return (
    <Card className="max-w-[560px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink-heading">Build ready</h2>
        <StatusPill tone="success">Ready</StatusPill>
      </div>

      <div className="mt-4 rounded-lg border border-success/25 bg-success/[0.07] p-3.5">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold text-success">
          <CheckIcon />
          {summary} · {formatBytes(prepared.totalBytes)} — uploaded
        </p>
        <p className="mt-1 text-[12px] text-ink-label">
          {prepared.passthrough
            ? "Zip uploaded as-is."
            : `Zipped in your browser to ${formatBytes(prepared.blob.size)} and sent to the backend.`}
        </p>
      </div>

      {missingRootIndex && !warningDismissed && (
        <div
          data-testid="no-index-warning"
          className="mt-3 rounded-lg border border-[#FEBC2E]/40 border-l-2 border-l-[#FEBC2E] bg-[#FEBC2E]/[0.09] p-3.5"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] font-semibold text-[#FEBC2E]">
              No <span className="font-mono text-[12px]">index.html</span> at the root of this folder
            </p>
            <button
              type="button"
              onClick={() => setWarningDismissed(true)}
              aria-label="Dismiss warning"
              className="-mr-1 -mt-1 shrink-0 rounded p-1 text-ink-label hover:text-ink-heading"
            >
              ✕
            </button>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-body">
            Make sure you&rsquo;re uploading your built static output (e.g. <span className="font-mono">dist/</span> or{" "}
            <span className="font-mono">build/</span>), not your project source. Without a root{" "}
            <span className="font-mono">index.html</span> the site will 404 at its root URL even though the deploy
            succeeds.
            {deploy?.indexHint ? (
              <>
                {" "}
                Found one at <span className="font-mono text-[12px]">{deploy.indexHint}</span> — looks like the
                folder got zipped inside another folder; upload its <em>contents</em> instead.
              </>
            ) : null}
          </p>
        </div>
      )}

      {!prepared.passthrough && prepared.paths.length > 1 && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-[12px] font-medium text-accent-light">
            <span className="group-open:hidden">Show {prepared.paths.length} files ▾</span>
            <span className="hidden group-open:inline">Hide files ▴</span>
          </summary>
          <ul className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-hair bg-white/[0.02] p-3 font-mono text-[11.5px] leading-relaxed text-ink-label">
            {prepared.paths.map((p) => (
              <li key={p} className="truncate">
                {p}
              </li>
            ))}
          </ul>
        </details>
      )}

      <button
        type="button"
        onClick={onContinue}
        data-testid="continue-to-payment"
        className="mt-5 w-full rounded-full bg-accent-gradient px-7 py-3.5 text-[15px] font-bold text-[#06120F] transition-[filter] hover:brightness-105"
      >
        Continue to payment →
      </button>
    </Card>
  );
}

export function UploadFailed({
  error,
  prepared,
  onRetry,
  onStartOver,
}: {
  error: string | null;
  prepared: PreparedUpload | null;
  onRetry: () => void;
  onStartOver: () => void;
}) {
  return (
    <Card className="max-w-[560px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-[#FF7A7A]">Upload didn&rsquo;t complete</h2>
        <StatusPill tone="bad">Failed</StatusPill>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-ink-body">
        The build
        {prepared ? (
          <>
            {" "}
            (<span className="font-mono">{prepared.fileCount}</span> file
            {prepared.fileCount === 1 ? "" : "s"}, {formatBytes(prepared.totalBytes)})
          </>
        ) : null}{" "}
        zipped fine, but the upload to the backend failed. Your files are still here — retrying re-sends the
        same zip, no re-packaging.
      </p>

      {error && (
        <p className="mt-3 break-words rounded-lg border border-[#FF7A7A]/30 bg-[#FF7A7A]/10 p-3 font-mono text-[12px] leading-snug text-[#FF7A7A]">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!prepared}
          onClick={onRetry}
          data-testid="retry-upload"
          className="rounded-full bg-accent-gradient px-6 py-3 text-[13.5px] font-bold text-[#06120F] transition-[filter] hover:brightness-105 disabled:opacity-60"
        >
          Retry upload
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="rounded-full border border-white/15 bg-white/[0.04] px-6 py-3 text-[13.5px] font-semibold text-ink-heading transition-colors hover:border-white/30"
        >
          Pick a different folder
        </button>
      </div>
    </Card>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0 fill-current">
      <path d="M6.4 11.2 3.2 8l-1.1 1.1 4.3 4.3 8-8L13.3 4.3z" />
    </svg>
  );
}
