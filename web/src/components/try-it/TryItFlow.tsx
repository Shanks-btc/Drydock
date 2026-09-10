"use client";

import { useEffect } from "react";
import { useDeploy, type DeployPhase } from "@/lib/useDeploy";
import DropZone from "./DropZone";
import UploadProgress, { UploadReady, UploadFailed } from "./UploadProgress";
import PaymentPanel from "./PaymentPanel";
import ScanPanel from "./ScanPanel";
import DeployResult from "./DeployResult";
import Card from "@/components/primitives/Card";

// Client orchestrator for /try-it. One state machine (useDeploy), one panel
// visible at a time, following the real backend sequence:
// upload -> pay (settles first) -> scan (gate runs) -> live | blocked | failed.
//
// Step 1 (Upload) has its own internal states — pick → read+zip → upload →
// "ready" confirmation → Pay. They all map to stepper step 0; no new step.

const STEPS: { key: string; label: string; phases: DeployPhase[] }[] = [
  {
    key: "upload",
    label: "Upload",
    phases: ["picking", "preparing", "uploading", "ready", "upload_failed"],
  },
  { key: "pay", label: "Pay", phases: ["unpaid", "paying", "payment_retry"] },
  { key: "check", label: "Memory check", phases: ["scanning"] },
  { key: "result", label: "Result", phases: ["done"] },
];

function currentStep(phase: DeployPhase): number {
  const i = STEPS.findIndex((s) => s.phases.includes(phase));
  return i === -1 ? 0 : i;
}

export default function TryItFlow() {
  const m = useDeploy();
  const step = currentStep(m.phase);
  const showRestart = ["ready", "unpaid", "paying", "payment_retry", "scanning", "done", "error"].includes(m.phase);

  useEffect(() => {
    console.info("%c[drydock/try-it]", "color:#2DD4BF", "phase →", m.phase);
  }, [m.phase]);

  return (
    <div className="w-full min-w-0">
      {/* progress rail */}
      <ol className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-2 text-[12px]">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold ${
                i < step
                  ? "border-success/40 bg-success/10 text-success"
                  : i === step
                    ? "border-accent bg-accent/10 text-accent-light"
                    : "border-white/12 text-ink-label"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={i === step ? "text-ink-heading" : "text-ink-label"}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-white/10" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      {m.phase === "loading" && (
        <Card className="max-w-[560px]">
          <p className="flex items-center gap-2 text-[13.5px] text-ink-body">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
            Loading deploy pricing from the backend…
          </p>
        </Card>
      )}

      {m.phase === "picking" && (
        <div className="max-w-[560px]">
          <DropZone onSelect={m.selectUpload} error={m.error} />
        </div>
      )}

      {(m.phase === "preparing" || m.phase === "uploading") && <UploadProgress m={m} />}

      {m.phase === "ready" && m.prepared && (
        <UploadReady prepared={m.prepared} deploy={m.deploy} onContinue={m.continueToPayment} />
      )}

      {m.phase === "upload_failed" && (
        <UploadFailed error={m.error} prepared={m.prepared} onRetry={m.retryUpload} onStartOver={m.reset} />
      )}

      {(m.phase === "unpaid" || m.phase === "paying" || m.phase === "payment_retry") && <PaymentPanel m={m} />}

      {m.phase === "scanning" && <ScanPanel m={m} />}

      {m.phase === "done" && <DeployResult m={m} />}

      {m.phase === "error" && (
        <Card className="max-w-[560px]">
          <h2 className="font-display text-lg font-bold text-[#FF7A7A]">Something went wrong</h2>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-body">{m.error}</p>
        </Card>
      )}

      {showRestart && (
        <button
          type="button"
          onClick={m.reset}
          className="mt-6 text-[12.5px] text-ink-label underline decoration-white/20 underline-offset-2 transition-colors hover:text-ink-body"
        >
          Start over with a different build
        </button>
      )}
    </div>
  );
}
