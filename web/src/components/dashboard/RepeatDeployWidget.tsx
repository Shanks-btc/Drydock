"use client";

import { useCallback, useState } from "react";
import Card from "@/components/primitives/Card";
import StatusPill, { type PillTone } from "@/components/primitives/StatusPill";
import PaymentPanel from "@/components/try-it/PaymentPanel";
import ScanPanel from "@/components/try-it/ScanPanel";
import DeployResult from "@/components/try-it/DeployResult";
import RelativeTime from "@/components/primitives/RelativeTime";
import { redeploy, type DeployRecord } from "@/lib/api";
import { useDeploy } from "@/lib/useDeploy";

// Client. POST /deploy/:id/redeploy on a prior deploy, then run the same
// payment + memory-check flow inline (reusing the /try-it panels). The
// backend reads deploys/<id>/src.zip off disk, so an id from before a
// restart still works — hence the paste-an-id fallback.

const STATE_TONE: Record<string, PillTone> = {
  live: "success",
  blocked: "bad",
  failed: "warn",
  awaiting_payment: "neutral",
  paid: "accent",
  deploying: "accent",
};

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export default function RepeatDeployWidget({ initialDeploys }: { initialDeploys: DeployRecord[] }) {
  const m = useDeploy();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const inFlow = ["unpaid", "paying", "payment_retry", "scanning", "done"].includes(m.phase);

  const trigger = useCallback(
    async (fromId: string) => {
      setErr(null);
      setBusyId(fromId);
      try {
        const created = await redeploy(fromId.trim());
        m.resumeDeploy(created);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [m],
  );

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[1.3rem] font-bold tracking-[-0.01em] text-ink-heading">
          Repeat a deploy
        </h2>
        <span className="font-mono text-[12px] text-ink-label">POST /deploy/:id/redeploy</span>
      </div>

      {inFlow ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={m.reset}
            className="mb-4 text-[12.5px] text-ink-label underline decoration-white/20 underline-offset-2 hover:text-ink-body"
          >
            ← back to the deploy list
          </button>
          {m.deploy && (
            <p className="mb-3 text-[12.5px] text-ink-body">
              New deploy <span className="font-mono">{m.deploy.deployId.slice(0, 8)}</span>
              {m.deploy.redeployOf && (
                <>
                  {" "}
                  — a repeat of <span className="font-mono">{m.deploy.redeployOf.slice(0, 8)}</span>
                </>
              )}
              . It flows through payment and the memory check again.
            </p>
          )}
          {(m.phase === "unpaid" || m.phase === "paying" || m.phase === "payment_retry") && (
            <PaymentPanel m={m} />
          )}
          {m.phase === "scanning" && <ScanPanel m={m} />}
          {m.phase === "done" && <DeployResult m={m} />}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {initialDeploys.length === 0 ? (
            <Card>
              <p className="text-[13.5px] text-ink-body">
                No deploys in memory (the list resets on server restart). Paste a prior deploy id below — the
                backend still has its <span className="font-mono">src.zip</span> on disk.
              </p>
            </Card>
          ) : (
            <ul className="space-y-2.5">
              {initialDeploys.slice(0, 8).map((d) => (
                <li
                  key={d.id}
                  data-testid="redeploy-row"
                  data-deploy-id={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hair bg-surface-gradient p-3.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12.5px] text-ink-heading">{d.id.slice(0, 8)}</span>
                      <StatusPill tone={STATE_TONE[d.state] ?? "neutral"}>{d.state}</StatusPill>
                      {d.redeployOf && (
                        <span className="font-mono text-[11px] text-ink-label">
                          ↻ {d.redeployOf.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-[11.5px] text-ink-label">
                      <RelativeTime iso={d.createdAt} /> · {d.fileCount} file{d.fileCount === 1 ? "" : "s"}
                      {d.url ? (
                        <>
                          {" · "}
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-light underline underline-offset-2"
                          >
                            {d.url.replace(/^https?:\/\//, "")}
                          </a>
                        </>
                      ) : d.gate?.topMatch ? (
                        <> · blocked: {d.gate.topMatch.pattern_id}</>
                      ) : null}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === d.id}
                    onClick={() => trigger(d.id)}
                    className="shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-[12.5px] font-semibold text-ink-heading transition-colors hover:border-white/30 disabled:opacity-50"
                  >
                    {busyId === d.id ? "starting…" : "Deploy again"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-lg border border-hair bg-surface-gradient p-3.5">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-label">
              Or repeat by deploy id
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="1ecdb52b-8c3a-4f0e-9d21-7b6a0c4e5f88"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-canvas px-3 py-2 font-mono text-[12.5px] text-ink-heading placeholder:text-ink-label focus:border-strong focus:outline-none"
              />
              <button
                type="button"
                disabled={!UUID_RE.test(manualId.trim()) || busyId === manualId.trim()}
                onClick={() => trigger(manualId.trim())}
                className="shrink-0 rounded-full bg-accent-gradient px-5 py-2 text-[12.5px] font-bold text-[#06120F] transition-[filter] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Redeploy
              </button>
            </div>
          </div>

          {err && (
            <p className="rounded-lg border border-[#FF7A7A]/30 bg-[#FF7A7A]/10 px-3.5 py-2.5 text-[12.5px] text-[#FF7A7A]">
              {err}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
