"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NAV_LINKS, GITHUB_URL } from "@/lib/constants";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-[18px] w-[18px] fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [onColor, setOnColor] = useState(false);

  // The mockup tints the header when it sits over the teal demo section.
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const demo = document.getElementById("demo-section");
      if (!demo) return;
      const r = demo.getBoundingClientRect();
      setOnColor(r.top <= 64 && r.bottom >= 64);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b transition-colors duration-300 ${
        onColor ? "border-transparent bg-[#0d1f1c]" : "border-hair bg-canvas"
      }`}
    >
      <nav className="mx-auto flex w-full max-w-content items-center justify-between gap-4 px-6 py-5">
        <Link href="/" className="shrink-0 font-display text-lg font-bold tracking-tight text-ink-heading">
          Drydock
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-ink-body transition-colors hover:text-ink-heading"
            >
              {link.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Drydock on GitHub"
            className="text-ink-body transition-colors hover:text-ink-heading"
          >
            <GitHubIcon />
          </a>
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hair text-ink-heading md:hidden"
        >
          <span className="text-xl leading-none">{open ? "✕" : "≡"}</span>
        </button>
      </nav>

      {open && (
        <div className="w-full border-t border-hair bg-canvas px-6 pb-4 pt-2 md:hidden">
          <div className="flex w-full flex-col gap-2">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="w-full rounded-lg border border-hair px-4 py-3 text-center text-sm font-medium text-ink-heading transition-colors hover:border-strong"
              >
                {link.label}
              </Link>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-hair px-4 py-3 text-center text-sm font-medium text-ink-heading transition-colors hover:border-strong"
            >
              <GitHubIcon /> GitHub
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
