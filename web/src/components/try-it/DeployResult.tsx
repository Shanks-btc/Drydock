"use client";

import Card from "@/components/primitives/Card";
import StatusPill from "@/components/primitives/StatusPill";
import Hash from "@/components/primitives/Hash";
import { formatUsdc } from "@/lib/format";
import type { DeployMachine } from "@/lib/useDeploy";

// Terminal state (docs/frontend-plan.md §3):
//   live    -> the real published URL, fetchable
//   blocked -> matched pattern + confidence + full rationale, NO url;
//              payment already settled (link the tx), deploy halted
//   failed  -> host error; payment settled, gate verdict shown

/** How long the scan step was actually on screen: from payment settling
 *  (scanStartedAt) to the first poll that saw a terminal state (scanEndedAt).
 *  This is the client-observed memory-check + publish window. */
function scanSeconds(m: DeployMachine): string | null {
  if (!m.scanStartedAt || !m.scanEndedAt) return null;
  const secs = (m.scanEndedAt - m.scanStartedAt) / 1000;
  return secs > 0 && secs < 180 ? secs.toFixed(1) : null;
}

export default function DeployResult({ m }: { m: DeployMachine }) {
  const { record, pricing, txHash } = m;
  if (!record) return null;
  const fee = pricing ? formatUsdc(pricing.feeAtomic) : "0.01";
  const gateS = scanSeconds(m);

  if (record.state === "live") {
    return (
      <Card className="max-w-[560px]">
        <Header tone="success" pill="Live">
          Your site is live
        </Header>
        <a
          href={record.url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="live-url"
          className="mt-4 block break-all rounded-lg border border-success/25 bg-success/[0.07] px-4 py-3 font-mono text-[13.5px] text-success underline decoration-success/40 underline-offset-2 hover:decoration-success"
        >
          {record.url}
        </a>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-body">
          The build cleared the memory check
          {record.gate ? (
            <>
              {" "}
              — {record.gate.signalsExtracted} signal
              {record.gate.signalsExtracted === 1 ? "" : "s"} checked against {record.gate.knownPatternsChecked}{" "}
              known pattern{record.gate.knownPatternsChecked === 1 ? "" : "s"}, no match at or above 0.6
            </>
          ) : null}
          , then published to {record.host ?? "the static host"}.
        </p>
        {record.gate && record.gate.newPatternCandidates.length > 0 && (
          <div className="mt-3 rounded-lg border border-[#FEBC2E]/30 border-l-2 border-l-[#FEBC2E] bg-[#FEBC2E]/[0.07] p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#FEBC2E]">
              Cleared every known pattern — but flagged{" "}
              {record.gate.newPatternCandidates.length}{" "}
              {record.gate.newPatternCandidates.length === 1 ? "cause" : "causes"} it hasn&rsquo;t learned yet
            </p>
            <ul className="mt-3 flex flex-col gap-3">
              {record.gate.newPatternCandidates.map((c, i) => (
                <li key={i} className="text-[13px] leading-relaxed text-ink-body">
                  <span className="text-ink-heading">{c.signal}</span>
                  <span className="mt-1 block text-ink-label">{c.reasoning}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-label">
              These aren&rsquo;t blocks — the deploy is live. They&rsquo;re novel signals the gate has no
              pattern for yet, surfaced here rather than only in internal scan state.
            </p>
          </div>
        )}
        {record.hasRootIndex === false && (
          <p className="mt-2 rounded-lg border border-[#FEBC2E]/30 bg-[#FEBC2E]/[0.08] px-3 py-2 text-[12px] leading-relaxed text-[#FEBC2E]">
            Heads up: there&rsquo;s no <span className="font-mono">index.html</span> at the root, so{" "}
            <span className="font-mono">{"/"}</span> will 404. Individual files are served
            {record.indexHint ? (
              <>
                {" "}
                — try <span className="font-mono">{record.indexHint.replace(/index\.html$/, "")}</span>
              </>
            ) : (
              " at their paths"
            )}
            .
          </p>
        )}
        {gateS && (
          <p className="mt-2 font-mono text-[12px] text-ink-label">
            memory check + poll: {gateS}s on screen
          </p>
        )}
        <Receipt fee={fee} txHash={txHash ?? record.txHash} state="settled" />
      </Card>
    );
  }

  if (record.state === "blocked") {
    const match = record.gate?.topMatch ?? null;
    const gateErrored = !record.gate; // fail-closed block (deployGate.ts) leaves gate undefined
    return (
      <Card className="max-w-[560px]">
        <Header tone="bad" pill="Halted">
          Deploy halted before publish
        </Header>

        {match ? (
          <div className="mt-4 rounded-lg border border-[#FF7A7A]/30 border-l-2 border-l-[#FF7A7A] bg-[#FF7A7A]/[0.07] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[13px] font-semibold text-[#FF7A7A]">{match.pattern_id}</span>
              <StatusPill tone="bad">confidence {match.confidence.toFixed(2)}</StatusPill>
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-ink-body">{match.rationale}</p>
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-[#FF7A7A]/30 bg-[#FF7A7A]/[0.07] p-4 text-[13px] leading-relaxed text-ink-body">
            {gateErrored
              ? "The memory check could not complete, so the deploy failed closed — it was stopped rather than published without a check."
              : "The build matched a known failure pattern and was stopped."}
          </p>
        )}

        <p className="mt-4 text-[13px] leading-relaxed text-ink-body">
          No site went live and the static host was never touched. Your payment still settled — you paid for
          the deploy attempt and a real answer about why it stopped. The halt was written back to incident
          memory.
        </p>
        {gateS && (
          <p className="mt-2 font-mono text-[12px] text-ink-label">
            memory check + poll: {gateS}s on screen
          </p>
        )}
        <Receipt fee={fee} txHash={txHash ?? record.txHash} state="settled" />
      </Card>
    );
  }

  // failed — host error after a clean gate (rare)
  return (
    <Card className="max-w-[560px]">
      <Header tone="warn" pill="Failed">
        The publish step failed
      </Header>
      <p className="mt-4 text-[13px] leading-relaxed text-ink-body">
        The build{" "}
        {record.gate?.verdict === "clean" ? "cleared the memory check, but the static host rejected the publish" : "did not publish"}
        . This is a host-side error, not a memory-check block.
      </p>
      {record.error && (
        <p className="mt-3 break-words rounded-lg border border-[#FEBC2E]/30 bg-[#FEBC2E]/[0.08] p-3.5 font-mono text-[12px] leading-snug text-[#FEBC2E]">
          {record.error}
        </p>
      )}
      <Receipt fee={fee} txHash={txHash ?? record.txHash} state="settled" />
    </Card>
  );
}

function Header({
  tone,
  pill,
  children,
}: {
  tone: "success" | "bad" | "warn";
  pill: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-display text-lg font-bold text-ink-heading">{children}</h2>
      <StatusPill tone={tone}>{pill}</StatusPill>
    </div>
  );
}

function Receipt({ fee, txHash, state }: { fee: string; txHash: string | null; state: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hair pt-4 text-[12px] text-ink-label">
      <span className="text-success">{fee} USDC {state} on Base Sepolia</span>
      {txHash && (
        <span className="inline-flex items-center gap-1">
          · tx <Hash value={txHash} kind="tx" />
        </span>
      )}
    </div>
  );
}
