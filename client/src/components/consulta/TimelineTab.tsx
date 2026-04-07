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
    <Card className="shadow-lg rounded-2xl overflow-hidden">
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center gap-3">
        <Activity className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900">Timeline do CPF/CNPJ</h2>
        {cpfCnpj && (
          <Badge variant="outline" className="ml-auto text-xs">{formatCpfCnpj(cpfCnpj)}</Badge>
        )}
      </div>
      <div className="p-6">
        {!cpfCnpj ? (
          <div className="text-center py-12">
            <Search className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500">Realize uma consulta para ver o historico temporal</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-500 text-sm">Carregando timeline...</span>
          </div>
        ) : !timelineData?.timeline?.length ? (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500">Nenhum historico encontrado para este CPF/CNPJ</p>
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
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Evolucao do Score</p>
                  <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
                    <polyline
                      points={points}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {scores.map((s, i) => {
                      const x = pad + (i / (scores.length - 1)) * (w - 2 * pad);
                      const y = pad + (1 - (s.score - minScore) / range) * (h - 2 * pad);
                      const color = s.score >= 200 ? "#22c55e" : s.score >= 100 ? "#eab308" : "#ef4444";
                      return <circle key={i} cx={x} cy={y} r="3" fill={color} />;
                    })}
                  </svg>
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                    <span>{new Date(scores[0].date).toLocaleDateString("pt-BR")}</span>
                    <span>{new Date(scores[scores.length - 1].date).toLocaleDateString("pt-BR")}</span>
                  </div>
                </div>
              );
            })()}

            {/* Vertical timeline */}
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200" />
              <div className="space-y-4">
                {timelineData.timeline.map((entry, idx) => {
                  const entryScoreColor = (entry.score ?? 0) >= 200
                    ? "bg-green-100 text-green-700"
                    : (entry.score ?? 0) >= 100
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-red-100 text-red-700";
                  const dotColor = (entry.score ?? 0) >= 200
                    ? "bg-green-500"
                    : (entry.score ?? 0) >= 100
                    ? "bg-yellow-500"
                    : "bg-red-500";
                  const dateStr = entry.date
                    ? new Date(entry.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                    : "";
                  return (
                    <div key={idx} className="relative pl-10">
                      <div className={`absolute left-3 top-3 w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ring-white`} />
                      <div className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-200 transition-colors">
                        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-xs text-slate-500">{dateStr}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {entry.score != null && (
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${entryScoreColor}`}>
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
                            <Building2 className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-sm text-slate-700">{entry.provider}</span>
                            {entry.isSameProvider && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">Seu provedor</Badge>
                            )}
                          </div>
                          <span className="text-xs text-slate-400 uppercase">{entry.searchType}</span>
                        </div>
                        {entry.alerts.length > 0 && (
                          <div className="flex gap-1.5 mt-2 flex-wrap">
                            {entry.alerts.map((alert, ai) => (
                              <span key={ai} className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
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
