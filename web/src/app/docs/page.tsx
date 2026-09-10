import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@/components/layout/Section";
import EyebrowLabel from "@/components/primitives/EyebrowLabel";
import Callout from "@/components/primitives/Callout";
import CodeBlock from "@/components/primitives/CodeBlock";
import DocsSidebar from "@/components/docs/DocsSidebar";
import { ENDPOINTS, type Endpoint } from "@/content/docsSections";
import { API_BASE } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Docs — Drydock",
  description:
    "How Drydock works and the backend API: the memory check, the x402 payment flow, deploy record states, and every endpoint that actually exists.",
};

export default function DocsPage() {
  return (
    <main className="w-full max-w-full overflow-x-clip">
      <section className="dot-grid pb-10 pt-16">
        <Container className="flex flex-col items-center text-center">
          <EyebrowLabel className="mb-4">Docs</EyebrowLabel>
          <h1 className="font-display text-[2rem] font-bold leading-[1.14] tracking-[-0.02em] text-ink-heading sm:text-[2.4rem]">
            Reference
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-base text-ink-body">
            The mechanism in brief, the payment flow, and the backend API — every route below is one the
            running server actually serves.
          </p>
        </Container>
      </section>

      <section className="border-t border-hair py-14">
        <Container className="grid grid-cols-1 gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
          <aside className="min-w-0">
            <DocsSidebar />
          </aside>

          <div className="min-w-0 max-w-[760px] space-y-16">
            <DocSection id="overview" title="Overview">
              <p>
                Drydock sits between a static-site build folder and a live URL. One flat{" "}
                <Mono>0.01 USDC</Mono> payment on Base ships the site — but the build is first checked against
                every past deployment incident Drydock has seen. A build that matches a known failure pattern
                is <strong>halted before it publishes</strong>; the payment still settles.
              </p>
              <CodeBlock label="the pipeline">
                {`upload (zip)  ->  pay (x402, settles first)  ->  memory check  ->  live | blocked | failed`}
              </CodeBlock>
              <p>
                The backend is an Express server; the memory lives in{" "}
                <a
                  href="https://sibyllabs.org/plugin"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-light underline underline-offset-2"
                >
                  Sibyl
                </a>
                . This page documents the API it exposes.
              </p>
            </DocSection>

            <DocSection id="memory-check" title="The memory check">
              <p>
                After payment settles, Drydock extracts signals from the build (each file classified — a build
                log, a bundled asset, a source file — and its text pulled), then runs a two-stage match against
                known <Mono>failure-pattern</Mono> anchors: a deterministic prefilter shortlists candidates,
                then one reasoning step compares the build against each shortlisted pattern&rsquo;s mechanism,
                distinguishing evidence, and not-this-pattern notes.
              </p>
              <p>
                The full walkthrough — why shared keywords are never enough, what the reasoning step is
                actually given — is on{" "}
                <Link href="/how-it-works#mechanism" className="text-accent-light underline underline-offset-2">
                  How It Works
                </Link>
                . In short:
              </p>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  A match at <Mono>confidence ≥ 0.6</Mono> blocks the deploy. Below that, or no match, the
                  deploy proceeds.
                </li>
                <li>
                  Every block is written back as an incident — a journal event plus an update to that
                  pattern&rsquo;s running rollup. Visible on the{" "}
                  <Link href="/dashboard" className="text-accent-light underline underline-offset-2">
                    dashboard
                  </Link>{" "}
                  and via <Mono>GET /incidents</Mono>.
                </li>
                <li>
                  The gate <strong>fails closed</strong>: if the check itself errors (bridge crash, model
                  API failure), the deploy stops rather than shipping unchecked.
                </li>
              </ul>
              <p className="text-[13px] text-ink-label">
                The check runs independently of the payment (it&rsquo;s a detached task, ~8–15s). Poll{" "}
                <Mono>GET /deploy/:id</Mono> for the verdict.
              </p>
            </DocSection>

            <DocSection id="payment" title="The payment flow">
              <p>
                Payment is the x402 <Mono>exact</Mono> scheme: a signed EIP-3009{" "}
                <Mono>TransferWithAuthorization</Mono> over Base Sepolia USDC. You sign in your wallet; the
                facilitator submits it on-chain and pays the gas — <strong>you spend no ETH</strong>.
              </p>
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>
                  <Mono>GET /deploy/:id/pay</Mono> unpaid → <Mono>402</Mono> with a <Mono>PAYMENT-REQUIRED</Mono>{" "}
                  header (scheme, network, asset, amount, the USDC EIP-712 domain).
                </li>
                <li>
                  The client signs and retries with a <Mono>PAYMENT-SIGNATURE</Mono> header → <Mono>200</Mono>,
                  and a <Mono>PAYMENT-RESPONSE</Mono> header carrying the settlement{" "}
                  <Mono>{"{ success, transaction, payer }"}</Mono>.
                </li>
                <li>
                  Settlement fires <Mono>onAfterSettle</Mono>, which commits the payment, runs the gate, and
                  publishes — as a separate step. The <Mono>200</Mono> comes back before the site is live.
                </li>
              </ol>
              <Callout label="Non-blocking by design" title="Payment settles before the check, unconditionally">
                <p>
                  The payment gate confirms a real on-chain transfer happened. The memory check decides
                  whether <em>this build</em> ships. They stay separate: a flagged build is{" "}
                  <strong>halted, not refunded</strong> — you paid for the attempt and a real answer about why
                  it stopped.
                </p>
              </Callout>
              <p className="text-[13px] text-ink-label">
                The public facilitator occasionally soft-fails settlement (<Mono>402</Mono> with{" "}
                <Mono>PAYMENT-RESPONSE {"{ success: false }"}</Mono>) — a transient facilitator issue, not a
                charge. Retrying signs a fresh authorization.
              </p>
            </DocSection>

            <DocSection id="deploy-states" title="Deploy record states">
              <p>
                A deploy moves through these states; <Mono>GET /deploy/:id</Mono> reports the current one.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] border-collapse text-[13px]">
                  <tbody>
                    {STATES.map(([s, d]) => (
                      <tr key={s} className="border-b border-hair last:border-0">
                        <td className="py-2.5 pr-4 align-top font-mono text-accent-light">{s}</td>
                        <td className="py-2.5 text-ink-body">{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[13px] text-ink-label">
                <Mono>gate</Mono> is attached to the record the moment the check finishes, whatever the verdict
                — a clean deploy&rsquo;s record still shows what was scanned. A fail-closed block has{" "}
                <Mono>gate: null</Mono>, distinguishing it from a real pattern match.
              </p>
            </DocSection>

            <DocSection id="api" title="API reference">
              <p>
                Base URL <Mono>{API_BASE}</Mono>. CORS is permissive — read endpoints work from the browser.
                Errors are <Mono>{'{ "error": "…" }'}</Mono> with a <Mono>4xx</Mono>/<Mono>5xx</Mono> status.
              </p>
              <div className="space-y-10">
                {ENDPOINTS.map((e) => (
                  <EndpointDoc key={`${e.method} ${e.path}`} endpoint={e} />
                ))}
              </div>
            </DocSection>
          </div>
        </Container>
      </section>
    </main>
  );
}

const STATES: [string, string][] = [
  ["awaiting_payment", "Uploaded, not yet paid. The pay route is x402-gated."],
  ["paid", "Payment committed on-chain. The memory check is running (detached)."],
  ["deploying", "Check cleared. Publishing to the static host."],
  ["live", "Published. url is the real public URL, fetchable."],
  ["blocked", "The check matched a known pattern (or errored → fail-closed). No url; the host was never contacted."],
  ["failed", "Check cleared but the host rejected the publish. error carries the host message."],
];

function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-[1.4rem] font-bold tracking-[-0.01em] text-ink-heading sm:text-[1.7rem]">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[14.5px] leading-relaxed text-ink-body">{children}</div>
    </section>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12.5px] text-ink-heading">{children}</code>;
}

function EndpointDoc({ endpoint }: { endpoint: Endpoint }) {
  const { method, path, gated, summary, request, response, notes } = endpoint;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 font-mono text-[12px] font-bold ${
            method === "GET" ? "bg-accent/15 text-accent-light" : "bg-[#FEBC2E]/15 text-[#FEBC2E]"
          }`}
        >
          {method}
        </span>
        <span className="font-mono text-[14px] text-ink-heading">{path}</span>
        {gated && (
          <span className="rounded-full border border-strong bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-accent-light">
            x402-gated
          </span>
        )}
      </div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-body">{summary}</p>
      {request && (
        <CodeBlock label="request" className="mt-3">
          {request}
        </CodeBlock>
      )}
      <CodeBlock label="response" className="mt-3">
        {response}
      </CodeBlock>
      {notes && notes.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[12.5px] text-ink-label">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
