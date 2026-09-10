"use client";

import { useEffect, useRef, useState } from "react";

export type TerminalTone = "cmd" | "dim" | "warn" | "ok" | "bad";
export type TerminalLine = { text: string; tone: TerminalTone; indent?: boolean };

const TONE_CLASS: Record<TerminalTone, string> = {
  cmd: "text-[#D8FFF7]",
  dim: "text-white/45",
  warn: "text-[#FEBC2E]",
  ok: "text-accent-light",
  bad: "text-[#FF7A7A]",
};

/** Terminal card whose lines reveal one-by-one when scrolled into view.
 *  Reduced motion → all lines shown immediately. The `script` is expected to
 *  be a real transcript (see the callers) — not invented output. */
export default function Terminal({
  script,
  title = "drydock",
  className = "",
}: {
  script: TerminalLine[];
  title?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(script.length);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return;
        started.current = true;
        obs.disconnect();
        let i = 0;
        const tick = () => {
          i += 1;
          setShown(i);
          if (i < script.length) window.setTimeout(tick, 430);
        };
        tick();
      },
      { threshold: 0.35 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [script.length]);

  return (
    <div ref={ref} className={`min-w-0 overflow-hidden rounded-xl bg-[#08080C] ${className}`}>
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        <span className="ml-2 font-mono text-[12.5px] text-white/45">{title}</span>
      </div>
      <div className="min-h-[280px] px-5 py-5 font-mono text-[13px] leading-[1.75]">
        {script.slice(0, shown).map((line, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-words ${TONE_CLASS[line.tone]} ${
              line.indent ? "pl-4 opacity-90" : ""
            }`}
          >
            {line.text}
          </div>
        ))}
        {shown < script.length && (
          <span className="inline-block h-4 w-2 animate-pulse bg-accent-light align-middle" />
        )}
      </div>
    </div>
  );
}
