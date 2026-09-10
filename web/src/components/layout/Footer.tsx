import Link from "next/link";
import { Container } from "./Section";
import { GITHUB_URL } from "@/lib/constants";

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Getting Started",
    links: [
      { label: "Try It", href: "/try-it" },
      { label: "Docs", href: "/docs" },
      { label: "GitHub", href: GITHUB_URL, external: true },
    ],
  },
  {
    title: "The App",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "How It Works", href: "/how-it-works" },
    ],
  },
  {
    title: "The Protocol",
    links: [
      { label: "Base", href: "https://base.org", external: true },
      { label: "Sibyl Memory", href: "https://sibyllabs.org/plugin", external: true },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-hair bg-canvas pb-8 pt-16">
      <Container>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="font-display text-lg font-bold tracking-tight text-ink-heading">Drydock</div>
            <p className="mt-2 text-sm text-ink-body">Deployments with memory.</p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h5 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-light">
                {col.title}
              </h5>
              {col.links.map((link) =>
                link.external ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-2.5 block text-sm text-ink-body transition-colors hover:text-ink-heading"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="mb-2.5 block text-sm text-ink-body transition-colors hover:text-ink-heading"
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>
        <p className="mt-12 border-t border-hair pt-6 text-xs text-[#555560]">© 2026 Drydock</p>
      </Container>
    </footer>
  );
}
