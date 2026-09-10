import Link from "next/link";
import { Container } from "@/components/layout/Section";
import EyebrowLabel from "@/components/primitives/EyebrowLabel";
import Terminal, { type TerminalLine } from "@/components/primitives/Terminal";

// A trimmed transcript of a REAL Drydock run — the `leaked-key-site` fixture
// that `npm run test:gate` exercises: a build.log that bakes an AWS-shaped
// credential into the deploy artifact, caught by the memory gate at
// confidence 0.96 and halted before publish.
export const BLOCKED_RUN: TerminalLine[] = [
  { text: "$ drydock deploy ./leaked-key-site", tone: "cmd" },
  { text: "→ uploaded 3 files · awaiting payment", tone: "dim" },
  { text: "✓ payment settled — 0.01 USDC on Base Sepolia · tx 0x3b98…e8014", tone: "ok" },
  { text: "→ extracting build signals — 3 files (build.log, index.html, style.css)", tone: "dim" },
  { text: "→ checking against incident memory — 1 known pattern", tone: "dim" },
  { text: "⚠ match: exposed-key-in-build-output — confidence 0.96", tone: "warn" },
  {
    text: "build.log runs `RUN env >> build.log`, baking AWS_SECRET_ACCESS_KEY into the shipped artifact — the same mechanism as a recorded incident: a build step persisting a secret into deploy output.",
    tone: "warn",
    indent: true,
  },
  { text: "✗ deploy halted before publish — no site went live", tone: "bad" },
  { text: "→ incident recorded — deploy/a822983d#gate.exposed-key-in-build-output", tone: "dim" },
];

export default function DemoTerminal() {
  return (
    <section id="demo-section" className="bg-demo-gradient py-24">
      <Container>
        <EyebrowLabel tone="on-accent" className="mb-4">
          Live Demo
        </EyebrowLabel>
        <h2 className="mx-auto max-w-[640px] text-center font-display text-[1.75rem] font-bold tracking-[-0.02em] text-on-accent-heading sm:text-[2.25rem]">
          Try a deployment yourself.
        </h2>
        <p className="mx-auto mt-4 max-w-[560px] text-center text-base text-on-accent-body">
          Drop in a build and watch Drydock walk it against remembered incidents — a replay of a real run.
          No wallet required to see how the check works.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Teaser form — the working flow lives on /try-it */}
          <div className="min-w-0 rounded-xl bg-canvas p-7">
            <label className="mb-2 block text-[11px] uppercase tracking-[0.08em] text-ink-body">Site source</label>
            <div className="mb-5 rounded-lg border border-dashed border-white/20 p-6 text-center text-[13.5px] text-ink-body">
              Drop a folder or paste a repo URL
            </div>

            <label className="mb-2 block text-[11px] uppercase tracking-[0.08em] text-ink-body">Network</label>
            <div className="mb-5 w-full rounded-lg border border-white/10 bg-surface-gradient px-3.5 py-3 text-sm text-ink-heading">
              Base Sepolia (testnet)
            </div>

            <Link
              href="/try-it"
              className="block w-full rounded-full bg-accent-gradient px-7 py-3.5 text-center text-[15px] font-bold text-[#06120F] transition-[filter] hover:brightness-105"
            >
              Check &amp; Deploy
            </Link>

            <div className="mt-3 flex flex-col gap-2">
              <Link
                href="/try-it"
                className="rounded-lg border border-white/10 px-3.5 py-3 text-left text-[13px] text-ink-body transition-colors hover:border-strong hover:text-ink-heading"
              >
                Try preset — clean static export
              </Link>
              <Link
                href="/try-it"
                className="rounded-lg border border-white/10 px-3.5 py-3 text-left text-[13px] text-ink-body transition-colors hover:border-strong hover:text-ink-heading"
              >
                Try preset — leaked key in build output (known incident)
              </Link>
            </div>
          </div>

          <Terminal script={BLOCKED_RUN} title="drydock — deploy check" />
        </div>
      </Container>
    </section>
  );
}
