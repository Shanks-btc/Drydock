"use client";

import { useEffect, useState } from "react";
import Card from "@/components/primitives/Card";
import StatusPill from "@/components/primitives/StatusPill";
import Hash from "@/components/primitives/Hash";
import { formatUsdc } from "@/lib/format";
import type { DeployMachine } from "@/lib/useDeploy";

// The real wait between "payment settled" and a terminal state, while the
// memory-check gate runs server-side (docs/frontend-plan.md §3). The gate is
// detached from the payment response (src/deploy/settlement.ts), so this is
// a genuine ~8-10s poll on GET /deploy/:id state transitions — paid ->
// deploying -> live, or paid -> blocked — not a decorative spinner. The
// elapsed counter is wall-clock since payment settled.

const STAGE_COPY: Record<string, string> = {
  paid: "Payment settled. Extracting build signals and matching them against incident memory…",
  deploying: "Build cleared the memory check — publishing to the static host…",
};

export default function ScanPanel({ m }: { m: DeployMachine }) {
  const { pricing, record, txHash, payer, scanStartedAt } = m;
  const state = record?.state ?? "paid";
  const gate = record?.gate ?? null;

  // Live wall-clock since the scan began, updated ~4x/s.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const elapsed = scanStartedAt ? Math.max(0, (now - scanStartedAt) / 1000) : 0;

  return (
    <Card className="max-w-[560px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink-heading">Checking the build</h2>
        <StatusPill tone="accent" pulse>
          {state === "deploying" ? "Publishing" : "Scanning"}
        </StatusPill>
      </div>

      {/* settled receipt */}
      <div className="mt-5 rounded-lg border border-success/25 bg-success/[0.07] p-3.5">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-success">
          <CheckIcon /> {pricing ? formatUsdc(pricing.feeAtomic) : "0.01"} USDC settled on Base Sepolia
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-label">
          {txHash ? (
            <span className="inline-flex items-center gap-1">
              tx <Hash value={txHash} kind="tx" />
            </span>
          ) : (
            <span>confirming settlement tx…</span>
          )}
          {payer && (
            <span className="inline-flex items-center gap-1">
              payer <Hash value={payer} kind="address" />
            </span>
          )}
        </div>
      </div>

      {/* live scan status */}
      <div className="mt-5 flex items-start gap-2.5">
        <span className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
        <div className="min-w-0">
          <p className="text-[13.5px] leading-relaxed text-ink-body">
            {STAGE_COPY[state] ?? "Waiting on the deploy to reach a final state…"}
          </p>
          <p className="mt-1 font-mono text-[12px] text-accent-light">
            {elapsed.toFixed(1)}s elapsed{state === "deploying" ? " · gate cleared" : ""}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-ink-label">
        This is a real wait on a server-side state change — the memory check is a reasoning call (~8s)
        comparing the build against every known failure pattern, running independently of the payment that
        already settled. The page is polling <span className="font-mono">GET /deploy/{record?.id?.slice(0, 8) ?? "…"}</span>.
      </p>

      {gate && (
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-hair pt-4 text-[12.5px]">
          <div>
            <dt className="text-ink-label">Signals extracted</dt>
            <dd className="font-mono text-ink-heading">{gate.signalsExtracted}</dd>
          </div>
          <div>
            <dt className="text-ink-label">Known patterns checked</dt>
            <dd className="font-mono text-ink-heading">{gate.knownPatternsChecked}</dd>
          </div>
        </dl>
      )}
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
