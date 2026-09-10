import type { ReactNode } from "react";

/** A fenced code / request-response block. Monospace, dark, horizontally
 *  scrollable (never widens the page). `label` is an optional caption bar
 *  (e.g. an HTTP method + path). */
export default function CodeBlock({
  label,
  children,
  className = "",
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 overflow-hidden rounded-lg border border-hair bg-[#08080C] ${className}`}>
      {label && (
        <div className="border-b border-hair px-4 py-2 font-mono text-[12px] text-ink-label">{label}</div>
      )}
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-[1.7] text-[#C9D1D9]">
        <code>{children}</code>
      </pre>
    </div>
  );
}
