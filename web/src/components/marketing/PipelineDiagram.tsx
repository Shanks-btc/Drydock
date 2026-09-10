// Isometric pipeline diagram — real 30° projection (rhombus width:height =
// sqrt(3):1), plain SVG polygons, not a CSS 3D transform. A teal pulse
// travels stage → connector → stage down the pipeline via staggered
// POSITIVE animation-delays on the shared `pipeline-travel` keyframe
// (globals.css). Scrolls horizontally on narrow screens rather than
// shrinking to illegible.

const SQRT3 = Math.sqrt(3);

function isoRhombus(cx: number, cy: number, r: number) {
  const hw = r * SQRT3;
  return `${cx},${cy + r} ${cx + hw},${cy} ${cx},${cy - r} ${cx - hw},${cy}`;
}

const STAGES = [
  { label: "Folder in", sub: "files, no config" },
  { label: "Payment", sub: "0.01 USDC · Base" },
  { label: "Memory check", sub: "two-stage match" },
  { label: "Ship", sub: "or halt" },
];

const R = 32;
const DEPTH = 24;
const HW = R * SQRT3;
const CY = 132;
const GAP = 214;
const X0 = 90;

export default function PipelineDiagram() {
  const cx = (i: number) => X0 + i * GAP;
  const width = X0 * 2 + (STAGES.length - 1) * GAP;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} 232`}
        className="mx-auto block h-auto w-full min-w-[680px] max-w-[900px]"
        role="img"
        aria-label="Pipeline: folder in, payment settles on Base, memory check runs, then the deploy ships or halts."
      >
        {/* dashed connectors */}
        {STAGES.slice(0, -1).map((_, i) => (
          <line
            key={`c${i}`}
            x1={cx(i) + HW + 8}
            y1={CY}
            x2={cx(i + 1) - HW - 8}
            y2={CY}
            stroke="rgba(45,212,191,0.45)"
            strokeWidth={1.5}
            strokeDasharray="5 5"
          />
        ))}

        {STAGES.map((stage, i) => (
          <g key={stage.label}>
            {/* right side face (darkest) */}
            <polygon
              points={`${cx(i)},${CY + R} ${cx(i) + HW},${CY} ${cx(i) + HW},${CY + DEPTH} ${cx(i)},${CY + R + DEPTH}`}
              fill="rgba(20,184,166,0.07)"
            />
            {/* left side face */}
            <polygon
              points={`${cx(i)},${CY + R} ${cx(i) - HW},${CY} ${cx(i) - HW},${CY + DEPTH} ${cx(i)},${CY + R + DEPTH}`}
              fill="rgba(20,184,166,0.12)"
            />
            {/* top face */}
            <polygon points={isoRhombus(cx(i), CY, R)} fill="rgba(20,184,166,0.16)" stroke="rgba(45,212,191,0.35)" strokeWidth={1} />
            {/* travelling pulse — bright outline, staggered per stage */}
            <polygon
              points={isoRhombus(cx(i), CY, R)}
              fill="none"
              stroke="#2DD4BF"
              strokeWidth={2}
              className="pipeline-pulse"
              style={{ animationDelay: `${i * 0.6}s` }}
            />
            {/* labels */}
            <text x={cx(i)} y={CY + R + DEPTH + 26} textAnchor="middle" className="fill-ink-heading font-display text-[13px] font-semibold">
              {stage.label}
            </text>
            <text x={cx(i)} y={CY + R + DEPTH + 44} textAnchor="middle" className="fill-ink-label text-[11px]">
              {stage.sub}
            </text>
            {/* stage number chip on the top face */}
            <text x={cx(i)} y={CY + 4} textAnchor="middle" className="fill-accent-light font-mono text-[12px] font-bold">
              {`0${i + 1}`}
            </text>
          </g>
        ))}

        {/* branch note under the memory-check stage */}
        <text x={cx(2)} y={26} textAnchor="middle" className="fill-ink-label text-[10.5px]">
          clear → ship · match ≥ 0.6 → halt before publish
        </text>
        <line x1={cx(2)} y1={32} x2={cx(2)} y2={CY - R - 6} stroke="rgba(45,212,191,0.3)" strokeWidth={1} strokeDasharray="3 3" />
      </svg>
    </div>
  );
}
