import type { Metadata } from "next";
import { Container } from "@/components/layout/Section";
import EyebrowLabel from "@/components/primitives/EyebrowLabel";
import Callout from "@/components/primitives/Callout";
import TryItFlow from "@/components/try-it/TryItFlow";

export const metadata: Metadata = {
  title: "Try It — Drydock",
  description:
    "Deploy a real static site through Drydock: upload a build, pay the flat 0.01 USDC fee on Base Sepolia, and watch the memory check run before it goes live — or halts.",
};

export default function TryItPage() {
  return (
    <main className="w-full max-w-full overflow-x-clip">
      <section className="dot-grid pb-12 pt-16">
        <Container className="flex flex-col items-center text-center">
          <EyebrowLabel className="mb-4">Try It</EyebrowLabel>
          <h1 className="mx-auto max-w-[720px] font-display text-[2rem] font-bold leading-[1.14] tracking-[-0.02em] text-ink-heading sm:text-[2.5rem]">
            Run your own build through the gate.
          </h1>
          <p className="mx-auto mt-4 max-w-[580px] text-base text-ink-body">
            This is the real product, wired to the running backend. You&rsquo;ll need a browser wallet with a
            little Base Sepolia test USDC — the fee is a flat 0.01 USDC, and it&rsquo;s gasless.
          </p>
        </Container>
      </section>

      <section className="border-t border-hair py-14">
        <Container className="flex flex-col gap-12">
          <div className="mx-auto w-full min-w-0 max-w-[560px]">
            <TryItFlow />
          </div>

          <aside className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3">
            <Callout label="What you need" title="A wallet with test USDC">
              <ul className="list-disc space-y-1.5 pl-4">
                <li>MetaMask or another injected wallet</li>
                <li>
                  Base Sepolia test USDC from{" "}
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-light underline underline-offset-2"
                  >
                    faucet.circle.com
                  </a>{" "}
                  (select Base Sepolia)
                </li>
                <li>No ETH — the facilitator pays gas</li>
              </ul>
            </Callout>

            <Callout label="Heads up" title="Payment settles before the check">
              <p>
                The 0.01 USDC settles the moment you authorize it — unconditionally. The memory check runs
                after, on a build that&rsquo;s already paid for, and only decides whether the publish step
                runs. A flagged build is halted, not refunded.
              </p>
            </Callout>

            <Callout label="If payment retries" title="The facilitator sometimes soft-fails">
              <p>
                The public x402 facilitator can hit a transient error submitting the settlement. When it does,
                nothing was charged and the page offers a retry — a fresh signature settles it. This is
                expected, occasional behaviour, not a bug in the flow.
              </p>
            </Callout>
          </aside>
        </Container>
      </section>
    </main>
  );
}
