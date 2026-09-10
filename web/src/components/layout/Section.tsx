import type { ReactNode } from "react";

/** Centered content column — 1140px max, 24px gutters. Matches the mockup's
 *  `.wrap`. Section vertical rhythm (`py-24`) is applied on the <section>
 *  itself, not here, so a section can opt out (e.g. the hero). */
export function Container({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`mx-auto w-full max-w-content px-6 ${className}`}>{children}</div>;
}
