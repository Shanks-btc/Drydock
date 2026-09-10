import Card from "@/components/primitives/Card";
import StatusPill, { type PillTone } from "@/components/primitives/StatusPill";
import { relativeTime } from "@/lib/format";
import type { Pattern } from "@/lib/api";

// Server component. Renders GET /patterns verbatim — the reconciled
// failure-pattern rollups. Honest empty state, no placeholder rows.

const SEVERITY_TONE: Record<string, PillTone> = {
  critical: "bad",
  high: "warn",
  medium: "neutral",
  low: "neutral",
};

export default function PatternMemoryList({ patterns }: { patterns: Pattern[] }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[1.3rem] font-bold tracking-[-0.01em] text-ink-heading">
          Known failure patterns
        </h2>
        <span className="font-mono text-[12px] text-ink-label">GET /patterns</span>
      </div>

      {patterns.length === 0 ? (
        <Card className="mt-4">
          <p className="text-[13.5px] text-ink-body">
            No patterns seeded yet. Once a REFERENCE anchor + <span className="font-mono">failure-pattern</span>{" "}
            entity exist in Sibyl, they appear here with their reconciled incident rollup.
          </p>
        </Card>
      ) : (
        <div className="mt-4 space-y-4">
          {patterns.map((p) => (
            <Card key={p.patternId}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-display text-[15px] font-bold text-ink-heading">{p.title}</h3>
                  <p className="truncate font-mono text-[12px] text-accent-light">{p.patternId}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.severityCeiling && (
                    <StatusPill tone={SEVERITY_TONE[p.severityCeiling] ?? "neutral"}>
                      {p.severityCeiling}
                    </StatusPill>
                  )}
                  <StatusPill tone={p.status === "active" ? "accent" : "neutral"}>
                    {p.status ?? "—"}
                  </StatusPill>
                </div>
              </div>

              {p.mechanism && (
                <p className="mt-3 text-[13px] leading-relaxed text-ink-body">{p.mechanism}</p>
              )}

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hair pt-4 text-[12.5px] sm:grid-cols-4">
                <Field label="Incidents" value={String(p.incidentCount)} />
                <Field label="Open" value={String(p.openIncidentIds.length)} />
                <Field label="Resolved" value={String(p.resolvedIncidentIds.length)} />
                <Field
                  label="Seen"
                  value={
                    p.firstSeenTs && p.lastSeenTs
                      ? `${relativeTime(p.firstSeenTs)} → ${relativeTime(p.lastSeenTs)}`
                      : "—"
                  }
                />
              </dl>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-label">{label}</dt>
      <dd className="truncate font-mono text-ink-heading">{value}</dd>
    </div>
  );
}
