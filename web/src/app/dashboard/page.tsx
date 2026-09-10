import type { Metadata } from "next";
import { Container } from "@/components/layout/Section";
import EyebrowLabel from "@/components/primitives/EyebrowLabel";
import Card from "@/components/primitives/Card";
import StatCard from "@/components/dashboard/StatCard";
import PatternMemoryList from "@/components/dashboard/PatternMemoryList";
import IncidentActivityLog from "@/components/dashboard/IncidentActivityLog";
import RepeatDeployWidget from "@/components/dashboard/RepeatDeployWidget";
import {
  getPatterns,
  getIncidents,
  listDeploys,
  type Pattern,
  type Incident,
  type DeployRecord,
} from "@/lib/api";
import { API_BASE } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Dashboard — Drydock",
  description:
    "Live from the running backend: deploy stats, the incident-memory activity log, the known-pattern list, and repeat-deploy.",
};

// Every number and row on this page is rendered from a real backend response
// at request time — no placeholder data, no ISR cache.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [deploys, patterns, incidents, reachable] = await load();

  return (
    <main className="w-full max-w-full overflow-x-clip">
      <section className="dot-grid pb-8 pt-16">
        <Container className="flex flex-col items-center text-center">
          <EyebrowLabel className="mb-4">Dashboard</EyebrowLabel>
          <h1 className="font-display text-[2rem] font-bold leading-[1.14] tracking-[-0.02em] text-ink-heading sm:text-[2.4rem]">
            Everything, live from the backend
          </h1>
          <p className="mx-auto mt-4 max-w-[560px] text-base text-ink-body">
            Rendered from <span className="font-mono text-[13px]">GET /deploy</span>,{" "}
            <span className="font-mono text-[13px]">/patterns</span> and{" "}
            <span className="font-mono text-[13px]">/incidents</span> on the running server, on every request.
          </p>
        </Container>
      </section>

      <section className="border-t border-hair py-14">
        <Container className="space-y-16">
          {!reachable && (
            <Card>
              <p className="text-[13.5px] text-[#FEBC2E]">
                The Drydock backend didn&rsquo;t respond. Start it with{" "}
                <span className="font-mono">npm start</span> and reload — this page has no cached fallback,
                by design.
              </p>
            </Card>
          )}

          {/* stat row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Deploys" value={deploys.length} sub="this server session" />
            <StatCard
              label="Published"
              value={deploys.filter((d) => d.state === "live").length}
              tone="success"
              sub="reached a live URL"
            />
            <StatCard
              label="Halted by memory"
              value={deploys.filter((d) => d.state === "blocked").length}
              tone="bad"
              sub="matched a known pattern"
            />
            <StatCard
              label="Known patterns"
              value={patterns.length}
              sub={patterns.filter((p) => p.status === "active").length + " active"}
            />
            <StatCard
              label="Incidents in memory"
              value={patterns.reduce((n, p) => n + p.incidentCount, 0)}
              sub={incidents.filter((i) => i.type === "collision").length + " collisions logged"}
            />
          </div>

          <PatternMemoryList patterns={patterns} />

          <IncidentActivityLog incidents={incidents} />

          <RepeatDeployWidget initialDeploys={deploys} />
        </Container>
      </section>
    </main>
  );
}

async function load(): Promise<[DeployRecord[], Pattern[], Incident[], boolean]> {
  const reachable = await fetch(`${API_BASE}/health`, { cache: "no-store" })
    .then((r) => r.ok)
    .catch(() => false);
  const [deploys, patterns, incidents] = await Promise.all([
    listDeploys().catch(() => [] as DeployRecord[]),
    getPatterns().catch(() => [] as Pattern[]),
    getIncidents(50).catch(() => [] as Incident[]),
  ]);
  return [deploys, patterns, incidents, reachable];
}
