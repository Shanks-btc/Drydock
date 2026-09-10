import Link from "next/link";
import { Container } from "@/components/layout/Section";
import EyebrowLabel from "@/components/primitives/EyebrowLabel";

// NOTE (build-time deviation from the mockup — see the report):
// the mockup ordered these Upload → Check → Pay → Own, i.e. the memory
// check before payment. The built backend (Day 6) and the confirmed
// /try-it flow run the check AFTER payment settles ("payment always goes
// through; the gate only decides whether the deploy proceeds"). These
// steps reflect the real order. "Own" → "Go live" because on-chain
// ownership recording is not built yet (Day 7+) — the settlement tx is
// what's actually on-chain today.
const STEPS = [
  {
    num: "01",
    title: "Upload",
    body: "Point Drydock at your static site folder or connect a repo. No pipeline config, no YAML to write, Drydock inspects the build output itself to figure out what it's looking at.",
  },
  {
    num: "02",
    title: "Pay",
    body: "One gasless USDC payment on Base settles the deploy instantly. No invoice, no manual reconciliation, no waiting on a payment provider. The payment always goes through, it buys a deploy attempt and a real answer.",
  },
  {
    num: "03",
    title: "Check",
    body: "Before your site ships, Drydock walks the build against every incident it remembers for this project, missing vars, broken paths, leaked secrets  and either clears it or halts the deploy with the matching pattern and the reason it flagged it.",
  },
  {
    num: "04",
    title: "Go live",
    body: "A clean build goes live on a real URL. The payment settled on Base against your wallet, an on-chain record of who deployed and when, not just a row in a dashboard you don't control.",
  },
];

export default function HowItWorksPreview() {
  return (
    <section className="py-24">
      <Container>
        <EyebrowLabel className="mb-4">How It Works</EyebrowLabel>
        <h2 className="mx-auto max-w-[640px] text-center font-display text-[1.75rem] font-bold tracking-[-0.02em] text-ink-heading sm:text-[2.25rem]">
          Four steps from folder to live site.
        </h2>

        <div className="relative mt-16 grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* connector line behind the numbers (desktop only) */}
          <div className="absolute left-[12.5%] right-[12.5%] top-6 hidden h-px bg-white/10 md:block" aria-hidden="true" />
          {STEPS.map((s) => (
            <div key={s.num} className="relative z-10 text-center">
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-accent bg-canvas font-display text-[15px] font-bold text-accent-light">
                {s.num}
              </div>
              <h4 className="font-display text-base font-bold text-ink-heading">{s.title}</h4>
              <p className="mt-2 text-[13.5px] text-ink-body">{s.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-12 text-center text-sm">
          <Link href="/how-it-works" className="text-accent-light transition-colors hover:text-accent">
            See the full mechanism, step by step &rarr;
          </Link>
        </p>
      </Container>
    </section>
  );
}
