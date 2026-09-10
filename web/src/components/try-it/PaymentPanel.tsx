"use client";

import Card from "@/components/primitives/Card";
import StatusPill from "@/components/primitives/StatusPill";
import { formatUsdc, truncateAddress } from "@/lib/format";
import type { DeployMachine } from "@/lib/useDeploy";

// Connect wallet + pay the flat deploy fee. The one non-obvious requirement
// (proven in the spike, docs/plan.md Day 7): the public x402 facilitator
// intermittently returns { success:false } on settlement — a real,
// observed, transient condition, NOT a wallet problem and NOT a code bug.
// When that happens the deploy record is still `awaiting_payment` server-
// side, so a fresh payment against the same URL settles. This panel treats
// that as a first-class "retry payment" state (warn tone, reassuring copy),
// never an error dead-end.

const NETWORK_LABEL: Record<string, string> = {
  "eip155:84532": "Base Sepolia (testnet)",
  "eip155:8453": "Base",
};

export default function PaymentPanel({ m }: { m: DeployMachine }) {
  const { phase, pricing, deploy, prepared, progress, paymentIssue, attempts } = m;
  if (!pricing || !deploy) return null;

  const paying = phase === "paying";
  const retry = phase === "payment_retry";
  const fee = formatUsdc(pricing.feeAtomic);

  return (
    <Card className="max-w-[560px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink-heading">Pay the deploy fee</h2>
        {retry ? (
          <StatusPill tone="warn">Retry needed</StatusPill>
        ) : paying ? (
          <StatusPill tone="accent" pulse>
            Paying
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">Awaiting payment</StatusPill>
        )}
      </div>

      <dl className="mt-5 space-y-2.5 text-[13.5px]">
        <Row label="Fee">
          <span className="font-mono text-ink-heading">{fee} USDC</span>{" "}
          <span className="text-ink-label">· flat, one-shot</span>
        </Row>
        <Row label="Network">{NETWORK_LABEL[pricing.network] ?? pricing.network}</Row>
        <Row label="Pays to">
          <span className="font-mono" title={pricing.payTo}>
            {truncateAddress(pricing.payTo)}
          </span>
        </Row>
        <Row label="For">
          deploy <span className="font-mono">{deploy.deployId.slice(0, 8)}</span> ·{" "}
          {prepared?.fileCount ?? deploy.fileCount} file{(prepared?.fileCount ?? deploy.fileCount) === 1 ? "" : "s"}
        </Row>
      </dl>

      <p className="mt-4 text-[12.5px] leading-relaxed text-ink-label">
        A gasless USDC transfer via x402 — you sign an EIP-3009 authorization in your wallet; the facilitator
        submits it and pays the gas. The memory check runs <em>after</em> this settles.
      </p>

      {retry && paymentIssue && (
        <div className="mt-5 rounded-lg border border-[#FEBC2E]/30 border-l-2 border-l-[#FEBC2E] bg-[#FEBC2E]/[0.08] p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#FEBC2E]">
            Facilitator couldn&rsquo;t settle — this happens, it&rsquo;s not you
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-body">
            The public x402 facilitator hit a transient error submitting the settlement
            {paymentIssue.reason && paymentIssue.reason !== "error" ? (
              <>
                {" "}
                (<span className="font-mono text-[12px]">{paymentIssue.reason}</span>)
              </>
            ) : null}
            . <strong className="text-ink-heading">No payment was taken</strong> — nothing settled on-chain and
            the deploy is still awaiting payment. Retrying signs a fresh authorization and tries again.
          </p>
          {paymentIssue.message && (
            <p className="mt-2 break-words font-mono text-[11.5px] leading-snug text-ink-label">
              {paymentIssue.message}
            </p>
          )}
        </div>
      )}

      {paying && progress && (
        <p className="mt-5 flex items-center gap-2 text-[13px] text-accent-light">
          <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          {progress}
        </p>
      )}

      <button
        type="button"
        disabled={paying}
        onClick={() => (retry ? m.retryPayment() : m.pay())}
        className="mt-6 w-full rounded-full bg-accent-gradient px-7 py-3.5 text-[15px] font-bold text-[#06120F] transition-[filter] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {paying ? "Paying…" : retry ? `Retry payment (${fee} USDC)` : `Connect wallet & pay ${fee} USDC`}
      </button>

      {attempts > 0 && (
        <p className="mt-2.5 text-center text-[11.5px] text-ink-label">
          {attempts === 1 ? "1 attempt" : `${attempts} attempts`}
          {retry ? " · the last one soft-failed at the facilitator" : ""}
        </p>
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-label">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ink-body">{children}</dd>
    </div>
  );
}
