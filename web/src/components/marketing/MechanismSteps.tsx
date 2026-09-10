import { Container } from "@/components/layout/Section";
import EyebrowLabel from "@/components/primitives/EyebrowLabel";
import Terminal, { type TerminalLine } from "@/components/primitives/Terminal";
import { BLOCKED_RUN } from "./DemoTerminal";

// Real transcript — `npm run test:gate` RUN 1: the clean `sample-site`
// fixture, paid and published to a real Netlify URL.
const CLEAN_RUN: TerminalLine[] = [
  { text: "$ drydock deploy ./sample-site", tone: "cmd" },
  { text: "→ uploaded 2 files · awaiting payment", tone: "dim" },
  { text: "✓ payment settled — 0.01 USDC on Base Sepolia · tx 0xb8ea…9663d3", tone: "ok" },
  { text: "→ extracting build signals — 2 files (index.html, style.css)", tone: "dim" },
  { text: "→ checking against incident memory — 1 known pattern", tone: "dim" },
  { text: "✓ no match above 0.6 — build clears the memory check", tone: "ok" },
  { text: "✓ published — https://drydock-4a6aa621.netlify.app", tone: "ok" },
];

const STEPS = [
  {
    num: "01",
    title: "Upload, and Drydock reads the build itself",
    body: "You hand Drydock a static-site folder or a zip. There's no pipeline file to write and no build settings to configure, it walks every file in the output, classifies each one (a build log, a bundled asset, a source file), and pulls the raw text as signals to check. Whatever's in the folder is what gets examined.",
  },
  {
    num: "02",
    title: "Payment settles on Base  first, and unconditionally",
    body: "One gasless USDC payment on Base (via x402) settles before the memory check runs. That ordering is deliberate, see the note below. The payment always completes; it buys a deploy attempt and a definite answer, not a guarantee that the site publishes.",
  },
  {
    num: "03",
    title: "The build is matched against memory, in two stages",
    body: "First a fast deterministic prefilter shortlists known failure patterns whose surface cues, an artifact kind, a keyword, appear anywhere in the build's signals. Then a single reasoning step compares the build against each shortlisted pattern's anchor: its mechanism (what actually goes wrong, and why), its distinguishing evidence, and its not-this-pattern notes that rule out look-alikes. Shared keywords are never enough, the match has to be the same underlying cause. Out comes a pattern, a confidence score, and a written rationale, or “novel”.",
  },
  {
    num: "04",
    title: "Clear, or halt before publish",
    body: "If nothing matches or the best match is below 0.6 confidence, the deploy proceeds to the static host and the site goes live on a real URL. If a known pattern matches at 0.6 or above, the deploy stops before the publish step. No site goes live, and you get the pattern and the full rationale for why it was flagged.",
  },
  {
    num: "05",
    title: "A halt becomes memory",
    body: "Every halt is written back as a deployment incident, a journal event plus an update to that pattern's running rollup: how often it's been seen, when, at what severity. The next deploy, yours or a teammate's, is checked against it too. The memory only gets sharper.",
  },
];

export default function MechanismSteps() {
  return (
    <section id="mechanism" className="scroll-mt-24 py-24">
      <Container>
        <EyebrowLabel className="mb-4">The Mechanism</EyebrowLabel>
        <h2 className="mx-auto max-w-[640px] text-center font-display text-[1.75rem] font-bold tracking-[-0.02em] text-ink-heading sm:text-[2.25rem]">
          What actually happens between folder and URL.
        </h2>

        <ol className="mx-auto mt-16 max-w-[760px] space-y-12">
          {STEPS.map((step, i) => (
            <li key={step.num} className="relative flex gap-5 sm:gap-7">
              <div className="flex shrink-0 flex-col items-center">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent bg-canvas font-display text-sm font-bold text-accent-light">
                  {step.num}
                </span>
                {i < STEPS.length - 1 && <span className="mt-2 w-px flex-1 bg-white/10" aria-hidden="true" />}
              </div>
              <div className="min-w-0 pb-2">
                <h3 className="font-display text-lg font-bold text-ink-heading">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* The two real outcomes of step 04, side by side. */}
        <div className="mx-auto mt-16 max-w-[900px]">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-label">
            Step 04  two real runs
          </p>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-2 text-sm font-semibold text-success">Clears &rarr; publishes</p>
              <Terminal script={CLEAN_RUN} title="drydock, clean deploy" />
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-sm font-semibold text-[#FF7A7A]">Matches &rarr; halts</p>
              <Terminal script={BLOCKED_RUN} title="drydock — flagged deploy" />
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-ink-label">
            Both transcripts are from <span className="font-mono">npm run test:gate</span>, real Base Sepolia
            payments, real gate output.
          </p>
        </div>
      </Container>
    </section>
  );
}
