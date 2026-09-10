import { Container } from "@/components/layout/Section";
import EyebrowLabel from "@/components/primitives/EyebrowLabel";
import Card from "@/components/primitives/Card";

const CARDS = [
  {
    title: "No memory between builds",
    body: "Standard deploy pipelines treat every push as if it's the first one ever made. They validate syntax and run the build script, but they have no idea your last three deploys all failed on the exact same missing environment variable. Every failure lands as a fresh surprise, and every fix gets rediscovered from scratch by whoever's on call that day.",
  },
  {
    title: "Same cause, different symptom",
    body: "A missing env var, a stale lockfile, and a broken build script can all produce a red X in CI that looks identical at a glance. Teams burn the first ten minutes of every incident just re-diagnosing a root cause someone already solved last month, because nothing wrote it down anywhere the next deploy could check.",
  },
  {
    title: "Drydock checks first",
    body: "Before your site ships, Drydock compares the incoming build against a running memory of past deployment incidents on this project, missing config, dependency mismatches, output-path errors. A likely repeat gets flagged and explained, not just failed silently at the end.",
  },
];

export default function ProblemSection() {
  return (
    <section className="py-24">
      <Container>
        <EyebrowLabel className="mb-4">The Problem</EyebrowLabel>
        <h2 className="mx-auto max-w-[640px] text-center font-display text-[1.75rem] font-bold tracking-[-0.02em] text-ink-heading sm:text-[2.25rem]">
          Every deploy starts from zero.
        </h2>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => (
            <Card key={c.title}>
              <h3 className="font-display text-lg font-bold text-ink-heading">{c.title}</h3>
              <p className="mt-2.5 text-[14.5px] text-ink-body">{c.body}</p>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}
