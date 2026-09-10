// Single source for cross-cutting constants the frontend needs.

/** Drydock backend base URL. Client and server both read this; default is
 *  the local dev backend (`npm start` in the repo root, port 3000). */
export const API_BASE =
  process.env.NEXT_PUBLIC_DRYDOCK_API ?? process.env.DRYDOCK_API ?? "http://localhost:3000";

/** The real repository — GitHub link in the nav + footer. */
export const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/";

/** Base Sepolia block explorer, for linking settlement txs. */
export const EXPLORER_BASE = "https://sepolia.basescan.org";

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/try-it", label: "Try It" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/docs", label: "Docs" },
] as const;
