import type { ReactNode } from "react";

/** The one card recipe, reused everywhere: rounded, hairline teal border,
 *  surface gradient, the signature 1px-ring-plus-diffuse glow. `min-w-0` so
 *  a long value inside a grid cell can't force the column wider. */
export default function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`w-full min-w-0 rounded-xl border border-subtle bg-surface-gradient p-8 shadow-glow ${className}`}
    >
      {children}
    </div>
  );
}
