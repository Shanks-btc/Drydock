/** The recurring uppercase-tracked eyebrow above section headings.
 *  `tone="on-accent"` for use on the teal demo section. */
export default function EyebrowLabel({
  children,
  tone = "default",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "default" | "on-accent";
  className?: string;
}) {
  const color = tone === "on-accent" ? "text-on-accent-label" : "text-accent-light";
  return (
    <p
      className={`text-center text-[11px] font-semibold uppercase tracking-[0.12em] ${color} ${className}`}
    >
      {children}
    </p>
  );
}
