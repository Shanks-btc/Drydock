"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/format";

/** "5m ago", but hydration-safe: renders a stable absolute date on the
 *  server and first client paint, then upgrades to the relative form after
 *  mount (and ticks it every 30s). Use this in CLIENT components — server
 *  components can call `relativeTime` directly, they render once. */
export default function RelativeTime({ iso, className = "" }: { iso: string | null | undefined; className?: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!iso) return null;
  const text =
    now === null
      ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : relativeTime(iso, now);
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} className={className}>
      {text}
    </time>
  );
}
