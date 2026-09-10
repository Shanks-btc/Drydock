// Small display helpers. No deps — these run in server and client components.

/** `0x1234…abcd` — a hash or address trimmed to head+tail. */
export function truncateHash(value: string | null | undefined, head = 6, tail = 4): string {
  if (!value) return "";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Address form — a touch shorter tail than a tx hash reads better. */
export function truncateAddress(value: string | null | undefined): string {
  return truncateHash(value, 6, 4);
}

/** Bytes -> "3.2 MB" / "412 KB" / "88 B". One decimal below 10 units. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) {
    const kb = n / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Atomic USDC (6 decimals) -> a human string like "0.01". Trims trailing
 *  fractional zeros. Deploy-fee amounts are tiny, so Number math is exact
 *  here; formats via string ops rather than toFixed to avoid rounding. */
export function formatUsdc(atomic: string | number | bigint): string {
  const digits = BigInt(atomic).toString().padStart(7, "0");
  const whole = digits.slice(0, -6);
  const frac = digits.slice(-6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

// Windows-1252 code points in the 0x80–0x9F range map to non-Latin-1 chars;
// reverse table so we can turn a mojibake'd string back into its byte stream.
const CP1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/**
 * Undo one layer of "UTF-8 bytes decoded as Windows-1252" mojibake
 * (`â€”` → `—`, `â€™` → `’`, `Ã©` → `é`, …). The Sibyl Python bridge stores
 * some reference/rationale prose double-encoded; this repairs it for display
 * only. Guarded so a clean string is never touched, and the repair is
 * discarded unless it actually resolves the telltale sequences. (The real
 * fix belongs in `sibyl_bridge.py`.)
 */
export function demojibake(s: string | null | undefined): string {
  if (!s) return "";
  // telltale double-encoding of UTF-8 as Windows-1252
  if (!/â€|[ÂÃ][-¿]/.test(s)) return s;
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const cp = s.charCodeAt(i);
      const b = cp <= 0xff ? cp : CP1252_REVERSE[cp];
      if (b === undefined) return s; // char can't have come from a single CP1252 byte
      bytes[i] = b;
    }
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return repaired.length < s.length && !repaired.includes("�") ? repaired : s;
  } catch {
    return s; // not valid UTF-8 once reversed — wasn't this kind of mojibake
  }
}

/** "3s ago" / "5m ago" / "2h ago" / "Sep 4" — coarse, for activity rows. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((now - then) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
