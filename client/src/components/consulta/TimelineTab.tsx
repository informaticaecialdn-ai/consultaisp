import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Activity, Clock, Calendar, Building2, AlertTriangle } from "lucide-react";
import { formatCpfCnpj } from "./utils";

interface TimelineEntry {
  date: string;
  score: number | null;
  decision: string | null;
  searchType: string;
  provider: string;
  alerts: string[];
  isSameProvider: boolean;
}

interface Props {
  timelineData: { timeline: TimelineEntry[] } | undefined;
  cpfCnpj: string;
  isLoading: boolean;
}

export default function TimelineTab({ timelineData, cpfCnpj, isLoading }: Props) {
  return (
    <Card className="rounded overflow-hidden">
      <div className="bg-[var(--color-bg)] border-b border-[var(--color-border)] px-6 py-4 flex items-center gap-3">
        <Activity className="w-5 h-5 text-[var(--color-muted)]" />
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">Timeline do CPF/CNPJ</h2>
        {cpfCnpj && (
          <Badge variant="outline" className="ml-auto text-xs">{formatCpfCnpj(cpfCnpj)}</Badge>
        )}
      </div>
      <div className="p-6">
        {!cpfCnpj ? (
          <div className="text-center py-12">
            <Search className="w-12 h-12 mx-auto mb-3 text-[var(--color-muted)]" />
            <p className="text-[var(--color-muted)]">Realize uma consulta para ver o historico temporal</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-5 h-5 border-2 border-[var(--color-navy)] border-t-transparent rounded-full animate-spin" />
            <span className="text-[var(--color-muted)] text-sm">Carregando timeline...</span>
          </div>
        ) : !timelineData?.timeline?.length ? (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 mx-auto mb-3 text-[var(--color-muted)]" />
            <p className="text-[var(--color-muted)]">Nenhum historico encontrado para este CPF/CNPJ</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Sparkline */}
            {(() => {
              const scores = timelineData.timeline
                .filter(e => e.score != null)
                .map(e => ({ score: e.score!, date: e.date }))
                .reverse();
              if (scores.length < 2) return null;
              const maxScore = Math.max(...scores.map(s => s.score), 1000);
              const minScore = Math.min(...scores.map(s => s.score), 0);
              const range = maxScore - minScore || 1;
              const w = 400;
              const h = 80;
              const pad = 8;
              const points = scores.map((s, i) => {
                const x = pad + (i / (scores.length - 1)) * (w - 2 * pad);
                const y = pad + (1 - (s.score - minScore) / range) * (h - 2 * pad);
                return `${x},${y}`;
              }).join(" ");
              return (
                <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4">
                  <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-widest mb-2">Evolucao do Score</p>
                  <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
                    <polyline
                      points={points}
                      fill="none"
                      stroke="#1A3A5C"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {scores.map((s, i) => {
                      const x = pad + (i / (scores.length - 1)) * (w - 2 * pad);
                      const y = pad + (1 - (s.score - minScore) / range) * (h - 2 * pad);
                      const color = s.score >= 200 ? "#1A4A2E" : s.score >= 100 ? "#B8860B" : "#8B1A1A";
                      return <circle key={i} cx={x} cy={y} r="3" fill={color} />;
                    })}
                  </svg>
                  <div className="flex justify-between text-xs text-[var(--color-muted)] mt-1">
                    <span>{new Date(scores[0].date).toLocaleDateString("pt-BR")}</span>
                    <span>{new Date(scores[scores.length - 1].date).toLocaleDateString("pt-BR")}</span>
                  </div>
                </div>
              );
            })()}

            {/* Vertical timeline */}
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-px bg-[var(--color-border)]" />
              <div className="space-y-4">
                {timelineData.timeline.map((entry, idx) => {
                  const entryScoreColor = (entry.score ?? 0) >= 200
                    ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
                    : (entry.score ?? 0) >= 100
                    ? "bg-[var(--color-gold-bg)] text-[var(--color-gold)]"
                    : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]";
                  const dotColor = (entry.score ?? 0) >= 200
                    ? "bg-[var(--color-success)]"
                    : (entry.score ?? 0) >= 100
                    ? "bg-[var(--color-gold)]"
                    : "bg-[var(--color-danger)]";
                  const dateStr = entry.date
                    ? new Date(entry.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                    : "";
                  return (
                    <div key={idx} className="relative pl-10">
                      <div className={`absolute left-3 top-3 w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ring-white`} />
                      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4 hover:border-[var(--color-navy)] transition-colors">
                        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-3.5 h-3.5 text-[var(--color-muted)]" />
                            <span className="text-xs text-[var(--color-muted)]">{dateStr}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {entry.score != null && (
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-sm ${entryScoreColor}`}>
                                Score: {entry.score}
                              </span>
                            )}
                            {entry.decision && (
                              <Badge variant={entry.decision === "Accept" ? "default" : entry.decision === "Reject" ? "destructive" : "secondary"} className="text-xs">
                                {entry.decision === "Accept" ? "Aprovado" : entry.decision === "Reject" ? "Rejeitado" : "Revisao"}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-3.5 h-3.5 text-[var(--color-muted)]" />
                            <span className="text-sm text-[var(--color-ink)]">{entry.provider}</span>
                            {entry.isSameProvider && (
                              <Badge variant="outline" className="text-xs px-1.5 py-0">Seu provedor</Badge>
                            )}
                          </div>
                          <span className="text-xs text-[var(--color-muted)] uppercase">{entry.searchType}</span>
                        </div>
                        {entry.alerts.length > 0 && (
                          <div className="flex gap-1.5 mt-2 flex-wrap">
                            {entry.alerts.map((alert, ai) => (
                              <span key={ai} className="flex items-center gap-1 text-xs bg-[var(--color-gold-bg)] text-[var(--color-gold)] border border-[var(--color-border)] px-2 py-0.5 rounded-sm">
                                <AlertTriangle className="w-3 h-3" />
                                {alert}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
