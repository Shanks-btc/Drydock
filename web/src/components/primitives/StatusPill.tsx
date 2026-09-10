import type { ReactNode } from "react";

export type PillTone = "neutral" | "accent" | "success" | "warn" | "bad";

const TONE: Record<PillTone, string> = {
  neutral: "border-white/12 bg-white/[0.04] text-ink-body",
  accent: "border-strong bg-accent/10 text-accent-light",
  success: "border-success/30 bg-success/10 text-success",
  warn: "border-[#FEBC2E]/30 bg-[#FEBC2E]/10 text-[#FEBC2E]",
  bad: "border-[#FF7A7A]/30 bg-[#FF7A7A]/10 text-[#FF7A7A]",
};

/** Small state chip: clean / flagged / live / blocked / awaiting, etc.
 *  `pulse` adds the live dot for in-progress states. */
export default function StatusPill({
  tone = "neutral",
  pulse = false,
  children,
  className = "",
}: {
  tone?: PillTone;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${TONE[tone]} ${className}`}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-60 animate-ping-slow" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}
