import { useEffect, useState } from "react";

interface Props {
  score: number;
  size?: "sm" | "md" | "lg";
}

const ZONES = [
  { min: 0, max: 300, label: "Muito Alto", color: "#C44040" },
  { min: 300, max: 500, label: "Alto", color: "#D97A2B" },
  { min: 500, max: 700, label: "Moderado", color: "#C9A820" },
  { min: 700, max: 1000, label: "Baixo", color: "#2E8B57" },
];

function getZone(score: number) {
  return ZONES.find(z => score >= z.min && score < z.max) || ZONES[ZONES.length - 1];
}

export default function ScoreGaugeSvg({ score, size = "md" }: Props) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const clamped = Math.max(0, Math.min(1000, score));

  useEffect(() => {
    const start = performance.now();
    const duration = 900;
    const from = 0;
    const to = clamped;
    function tick(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setAnimatedScore(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [clamped]);

  const zone = getZone(clamped);

  // Dimensions based on size
  const dims = size === "sm" ? { w: 160, h: 100 } : size === "lg" ? { w: 280, h: 165 } : { w: 220, h: 132 };
  const CX = dims.w / 2;
  const CY = dims.h - 12;
  const R = size === "sm" ? 60 : size === "lg" ? 110 : 82;
  const strokeW = size === "sm" ? 10 : size === "lg" ? 16 : 13;

  // Build zone arcs (semicircle from left to right, 180° = PI)
  const totalRange = 1000;
  const zoneArcs = ZONES.map(z => {
    const startFrac = z.min / totalRange;
    const endFrac = z.max / totalRange;
    const startAngle = Math.PI * (1 - startFrac);
    const endAngle = Math.PI * (1 - endFrac);
    const x1 = CX - R * Math.cos(startAngle);
    const y1 = CY - R * Math.sin(startAngle);
    const x2 = CX - R * Math.cos(endAngle);
    const y2 = CY - R * Math.sin(endAngle);
    const large = (endFrac - startFrac) > 0.5 ? 1 : 0;
    return { ...z, x1, y1, x2, y2, large };
  });

  // Needle angle
  const needleFrac = animatedScore / totalRange;
  const needleAngle = Math.PI * (1 - needleFrac);
  const needleLen = R - strokeW / 2 - 4;
  const nx = CX - needleLen * Math.cos(needleAngle);
  const ny = CY - needleLen * Math.sin(needleAngle);

  // Font sizes
  const scoreFontSize = size === "sm" ? 28 : size === "lg" ? 48 : 38;
  const labelFontSize = size === "sm" ? 9 : size === "lg" ? 13 : 11;
  const maxFontSize = size === "sm" ? 10 : size === "lg" ? 14 : 12;

  return (
    <div className="flex flex-col items-center">
      <svg width={dims.w} height={dims.h} viewBox={`0 0 ${dims.w} ${dims.h}`}>
        {/* Background track */}
        <path
          d={`M${CX - R},${CY} A${R},${R} 0 0 1 ${CX + R},${CY}`}
          fill="none"
          stroke="var(--color-tag-bg)"
          strokeWidth={strokeW + 4}
          strokeLinecap="round"
        />

        {/* Zone arcs */}
        {zoneArcs.map((z, i) => (
          <path
            key={i}
            d={`M${z.x1},${z.y1} A${R},${R} 0 ${z.large} 0 ${z.x2},${z.y2}`}
            fill="none"
            stroke={z.color}
            strokeWidth={strokeW}
            strokeLinecap="butt"
            opacity={0.25}
          />
        ))}

        {/* Active arc (from 0 to score) */}
        <path
          d={`M${CX - R},${CY} A${R},${R} 0 0 1 ${CX + R},${CY}`}
          fill="none"
          stroke={zone.color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={Math.PI * R}
          strokeDashoffset={Math.PI * R * (1 - animatedScore / totalRange)}
        />

        {/* Needle */}
        <line
          x1={CX}
          y1={CY}
          x2={nx}
          y2={ny}
          stroke="var(--color-ink)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r={5} fill="var(--color-ink)" />
        <circle cx={CX} cy={CY} r={2.5} fill="var(--color-surface)" />

        {/* Score number */}
        <text
          x={CX}
          y={CY - (size === "sm" ? 22 : size === "lg" ? 42 : 30)}
          textAnchor="middle"
          fontSize={scoreFontSize}
          fontWeight="800"
          fill="var(--color-ink)"
          style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
        >
          {animatedScore}
        </text>

        {/* "de 1000" label */}
        <text
          x={CX}
          y={CY - (size === "sm" ? 12 : size === "lg" ? 24 : 16)}
          textAnchor="middle"
          fontSize={maxFontSize}
          fontWeight="600"
          fill="var(--color-muted)"
          letterSpacing="0.5"
        >
          de 1000
        </text>

        {/* Zone labels at edges */}
        <text x={CX - R - 6} y={CY + (size === "sm" ? 10 : 14)} textAnchor="end" fontSize={labelFontSize} fill="var(--color-muted)" fontWeight="500">0</text>
        <text x={CX + R + 6} y={CY + (size === "sm" ? 10 : 14)} textAnchor="start" fontSize={labelFontSize} fill="var(--color-muted)" fontWeight="500">1000</text>
      </svg>

      {/* Risk label */}
      <div
        className="flex items-center gap-1.5 -mt-1"
        style={{ color: zone.color }}
      >
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: zone.color }} />
        <span className="text-sm font-bold tracking-wide uppercase">
          Risco {zone.label === "Muito Alto" ? "Muito Alto" : zone.label}
        </span>
      </div>
    </div>
  );
}
