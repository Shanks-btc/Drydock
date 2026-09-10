import Card from "@/components/primitives/Card";
import StatusPill from "@/components/primitives/StatusPill";
import { relativeTime } from "@/lib/format";
import type { Incident } from "@/lib/api";

// Server component. GET /incidents, newest first. Each row is a real COLD
// journal event: a gate block, or a content-hash collision quarantine.
// The LLM rationale (when present) is behind a native <details> — no JS.

export default function IncidentActivityLog({ incidents }: { incidents: Incident[] }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[1.3rem] font-bold tracking-[-0.01em] text-ink-heading">
          Incident-memory activity
        </h2>
        <span className="font-mono text-[12px] text-ink-label">GET /incidents</span>
      </div>

      {incidents.length === 0 ? (
        <Card className="mt-4">
          <p className="text-[13.5px] text-ink-body">
            Nothing recorded yet. Every gate block writes a journal event here, newest first.
          </p>
        </Card>
      ) : (
        <Card className="mt-4 !p-0">
          <ul className="divide-y divide-hair">
            {incidents.map((i) => (
              <li key={i.eventId} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <StatusPill tone={i.type === "collision" ? "warn" : "bad"}>
                    {i.type === "collision" ? "collision" : "block"}
                  </StatusPill>
                  <span className="font-mono text-[11.5px] text-ink-label">{relativeTime(i.ts)}</span>
                  {i.patternId && (
                    <span className="font-mono text-[12px] text-accent-light">{i.patternId}</span>
                  )}
                  {typeof i.matchConfidence === "number" && (
                    <span className="font-mono text-[11.5px] text-ink-body">
                      confidence {i.matchConfidence.toFixed(2)}
                    </span>
                  )}
                  {i.severity && (
                    <span className="text-[11px] uppercase tracking-[0.06em] text-ink-label">
                      {i.severity}
                    </span>
                  )}
                </div>

                {i.summary && (
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-body">{i.summary}</p>
                )}

                {i.locator && (
                  <p className="mt-1 truncate font-mono text-[11px] text-ink-label">{i.locator}</p>
                )}

                {i.matchRationale && (
                  <details className="group mt-2">
                    <summary className="cursor-pointer list-none text-[12px] font-medium text-accent-light">
                      <span className="group-open:hidden">Show rationale ▾</span>
                      <span className="hidden group-open:inline">Hide rationale ▴</span>
                    </summary>
                    <p className="mt-2 rounded-lg border border-hair bg-white/[0.02] p-3 text-[12.5px] leading-relaxed text-ink-body">
                      {i.matchRationale}
                    </p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
