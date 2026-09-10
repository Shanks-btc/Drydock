import type { ReactNode } from "react";

/** One stat tile in the dashboard row. `value` is rendered from a real
 *  backend response upstream — there is no placeholder path. */
export default function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "success" | "bad";
}) {
  const valueColor =
    tone === "success" ? "text-success" : tone === "bad" ? "text-[#FF7A7A]" : "text-ink-heading";
  return (
    <div className="min-w-0 rounded-xl border border-subtle bg-surface-gradient p-5 shadow-glow">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-label">{label}</p>
      <p className={`mt-2 font-display text-[1.9rem] font-bold leading-none ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-ink-body">{sub}</p>}
    </div>
  );
}
