import type { ReactNode } from "react";

/** An aside that carries weight — a teal left rule, the surface gradient,
 *  an uppercase eyebrow. For "here's a design decision and why" moments. */
export default function Callout({
  label,
  title,
  children,
}: {
  label?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="w-full min-w-0 rounded-xl border border-subtle border-l-2 border-l-accent bg-surface-gradient p-6 shadow-glow sm:p-8">
      {label && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-light">{label}</p>
      )}
      {title && (
        <h3 className="mt-2 font-display text-lg font-bold text-ink-heading sm:text-xl">{title}</h3>
      )}
      <div className="mt-3 space-y-3 text-[14.5px] leading-relaxed text-ink-body">{children}</div>
    </div>
  );
}
