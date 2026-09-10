import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Section";
import EyebrowLabel from "@/components/primitives/EyebrowLabel";
import Reveal from "@/components/primitives/Reveal";
import Callout from "@/components/primitives/Callout";
import PipelineDiagram from "@/components/marketing/PipelineDiagram";
import MechanismSteps from "@/components/marketing/MechanismSteps";

export const metadata: Metadata = {
  title: "How It Works, Drydock",
  description:
    "Drydock sits between a build folder and a live URL: signal extraction, a two-stage match against incident memory, and a payment that settles on Base before the check runs, on purpose.",
};

export default function HowItWorksPage() {
  return (
    <main className="w-full max-w-full overflow-x-clip">
      {/* header */}
      <section className="dot-grid pb-14 pt-16">
        <Container className="flex flex-col items-center text-center">
          <EyebrowLabel className="mb-4">How It Works</EyebrowLabel>
          <h1 className="mx-auto max-w-[760px] font-display text-[2rem] font-bold leading-[1.14] tracking-[-0.02em] text-ink-heading sm:text-[2.6rem]">
            Memory check, payment gate, on-chain settlement.
          </h1>
          <p className="mx-auto mt-4 max-w-[600px] text-base text-ink-body">
            Drydock sits between your build folder and a live URL. Here&rsquo;s every step it runs, why the
            payment settles before the memory check, and what a real flagged deploy looks like.
          </p>
        </Container>
      </section>

      {/* pipeline diagram */}
      <section className="border-t border-hair py-20">
        <Container>
          <EyebrowLabel className="mb-4">The Pipeline</EyebrowLabel>
          <h2 className="mx-auto mb-12 max-w-[560px] text-center font-display text-[1.6rem] font-bold tracking-[-0.02em] text-ink-heading sm:text-[2rem]">
            Four stages, one direction.
          </h2>
          <Reveal>
            <PipelineDiagram />
          </Reveal>
        </Container>
      </section>

      {/* the mechanism, step by step */}
      <Reveal>
        <div className="border-t border-hair">
          <MechanismSteps />
        </div>
      </Reveal>

      {/* the design decision */}
      <section className="border-t border-hair py-24">
        <Container>
          <EyebrowLabel className="mb-4">Design Decision</EyebrowLabel>
          <h2 className="mx-auto mb-12 max-w-[620px] text-center font-display text-[1.6rem] font-bold tracking-[-0.02em] text-ink-heading sm:text-[2rem]">
            Why payment settles before the check.
          </h2>
          <div className="mx-auto max-w-[760px]">
            <Reveal>
              <Callout label="Non-blocking by design" title="The payment gate and the memory gate answer different questions">
                <p>
                  The payment gate confirms one thing: a real, on-chain USDC transfer happened. The memory
                  check decides something else entirely, whether <em>this specific build</em> should be
                  allowed to publish. Folding them into &ldquo;pay only if the build looks clean&rdquo; would
                  make settlement conditional on a model-driven judgement, and a build that gets flagged
                  still consumed a real check.
                </p>
                <p>
                  So the two stay separate. Payment settles unconditionally the moment it&rsquo;s authorized.
                  The memory check runs after, on a build that&rsquo;s already paid for, and the only thing it
                  controls is whether the publish step ever runs. A flagged deploy is <strong>halted, not
                  refunded</strong>, you paid for the attempt and for a real answer about why it stopped.
                </p>
                <p>
                  Two side effects fall out of this for free: the check can take its time (a real reasoning
                  call, ~8s) without holding up settlement, and a check that <em>errors</em> fails closed, 
                  the deploy stops, without ever touching the payment.
                </p>
              </Callout>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* CTA */}
      <section className="border-t border-hair py-20">
        <Container className="flex flex-col items-center text-center">
          <h2 className="font-display text-[1.5rem] font-bold tracking-[-0.02em] text-ink-heading sm:text-[1.9rem]">
            See it run on your own build.
          </h2>
          <Link
            href="/try-it"
            className="mt-6 inline-block rounded-full bg-accent-gradient px-7 py-3.5 text-[15px] font-bold text-[#06120F] transition-[filter] hover:brightness-105"
          >
            Try It Now
          </Link>
        </Container>
      </section>
    </main>
  );
}
