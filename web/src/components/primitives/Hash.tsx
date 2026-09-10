import { truncateHash } from "@/lib/format";
import { EXPLORER_BASE } from "@/lib/constants";

/** A truncated tx hash / address, monospace, linking to the block explorer.
 *  `kind` picks the explorer path. */
export default function Hash({
  value,
  kind = "tx",
  className = "",
}: {
  value: string | null | undefined;
  kind?: "tx" | "address";
  className?: string;
}) {
  if (!value) return null;
  const href = `${EXPLORER_BASE}/${kind === "tx" ? "tx" : "address"}/${value}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
      className={`inline-flex min-w-0 items-center gap-1 font-mono text-[12.5px] text-accent-light underline decoration-accent/30 underline-offset-2 transition-colors hover:decoration-accent ${className}`}
    >
      <span className="truncate">{truncateHash(value)}</span>
      <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0 fill-current opacity-70">
        <path d="M3.5 2h5a1.5 1.5 0 0 1 1.5 1.5v5h-1V4.2l-5.15 5.15-.7-.7L8.3 3.5H3.5v-1Z" />
      </svg>
    </a>
  );
}
