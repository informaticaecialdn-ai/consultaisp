export default function ScoreGaugeSvg({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1000, score)) / 10;
  const r = 45;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = score >= 701 ? "#22c55e" : score >= 501 ? "#eab308" : score >= 301 ? "#f97316" : "#ef4444";
  return (
    <svg width="100" height="100" viewBox="0 0 120 120" className="-rotate-90">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
      <circle
        cx="60" cy="60" r={r} fill="none" strokeWidth="10"
        stroke={color} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        className="transition-all duration-1000"
      />
    </svg>
  );
}
