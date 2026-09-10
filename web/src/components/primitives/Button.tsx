import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary";

const base = "inline-block rounded-full px-7 py-3.5 text-[15px] font-bold no-underline transition-colors";
const variants: Record<Variant, string> = {
  // dark ink on the teal gradient — high contrast, the signature CTA
  primary: "bg-accent-gradient text-[#06120F] hover:brightness-105",
  secondary: "border border-white/15 bg-white/[0.04] font-semibold text-ink-heading hover:border-white/30",
};

export default function Button({
  href,
  variant = "primary",
  className = "",
  children,
  external = false,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
  external?: boolean;
}) {
  const cls = `${base} ${variants[variant]} ${className}`;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
