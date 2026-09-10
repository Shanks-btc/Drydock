"use client";

import { useEffect, useState } from "react";
import { DOCS_NAV } from "@/content/docsSections";

/** Sticky section nav for /docs. Desktop: a rail that scroll-spies the
 *  active section. Mobile: a collapsed <details> at the top. */
export default function DocsSidebar() {
  const [active, setActive] = useState(DOCS_NAV[0]?.id ?? "");

  useEffect(() => {
    const sections = DOCS_NAV.map((n) => document.getElementById(n.id)).filter(
      (el): el is HTMLElement => !!el,
    );
    if (sections.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  const links = (onClick?: () => void) =>
    DOCS_NAV.map((item) => (
      <a
        key={item.id}
        href={`#${item.id}`}
        onClick={onClick}
        className={`block rounded-md px-3 py-2 text-[13.5px] transition-colors ${
          active === item.id
            ? "bg-accent/10 font-medium text-accent-light"
            : "text-ink-body hover:text-ink-heading"
        }`}
      >
        {item.label}
      </a>
    ));

  return (
    <>
      {/* mobile */}
      <details className="mb-8 rounded-lg border border-hair bg-surface-gradient lg:hidden">
        <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-semibold text-ink-heading">
          On this page ▾
        </summary>
        <nav className="border-t border-hair px-2 py-2">{links()}</nav>
      </details>

      {/* desktop */}
      <nav className="sticky top-24 hidden lg:block">
        <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-label">
          On this page
        </p>
        {links()}
      </nav>
    </>
  );
}
