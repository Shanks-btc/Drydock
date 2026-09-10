import { Container } from "@/components/layout/Section";
import Button from "@/components/primitives/Button";

const STATS = [
  { n: "0.01 USDC", l: "flat deploy fee" },
  { n: "~8s", l: "memory check" },
  { n: "Base", l: "on-chain settlement" },
];

export default function Hero() {
  return (
    <section className="dot-grid pb-16 pt-16">
      <Container className="flex flex-col items-center text-center">
        <span className="mb-6 inline-block rounded-full border border-strong px-[18px] py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-light">
          Deployment agent with memory
        </span>

        <h1 className="mx-auto max-w-[720px] font-display text-[2rem] font-bold leading-[1.12] tracking-[-0.02em] text-ink-heading sm:text-[2.75rem]">
          Ship faster. Never ship the <span className="text-accent-light">same failure twice</span>.
        </h1>

        <p className="mx-auto mt-4 max-w-[560px] text-base text-ink-body">
          One gasless USDC payment settles on Base and ships your site, but not before Drydock checks the
          build against every past deployment incident it&rsquo;s seen.
        </p>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <Button href="/try-it">Try It Now</Button>
          <Button href="/docs" variant="secondary">
            Read the Docs
          </Button>
        </div>

        <div className="mt-14 flex flex-wrap justify-center gap-x-14 gap-y-6">
          {STATS.map((s) => (
            <div key={s.l} className="text-center">
              <div className="font-display text-[28px] font-bold text-accent-light">{s.n}</div>
              <div className="mt-1 text-[12.5px] text-ink-body">{s.l}</div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
