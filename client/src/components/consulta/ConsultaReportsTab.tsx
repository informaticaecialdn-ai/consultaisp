import { Card } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

interface Props {
  consultations: any[];
  approvedCount: number;
  rejectedCount: number;
  avgScore: number;
}

export default function ConsultaReportsTab({ consultations, approvedCount, rejectedCount, avgScore }: Props) {
  return (
    <Card className="rounded overflow-hidden">
      <div className="bg-[var(--color-bg)] border-b border-[var(--color-border)] px-6 py-4 flex items-center gap-3">
        <BarChart3 className="w-5 h-5 text-[var(--color-muted)]" />
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">Resumo de Consultas</h2>
      </div>
      <div className="p-6">
        {consultations.length === 0 ? (
          <div className="text-center py-12">
            <BarChart3 className="w-12 h-12 mx-auto mb-3 text-[var(--color-muted)]" />
            <p className="text-[var(--color-muted)]">Realize consultas para ver o resumo</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Consultas", value: consultations.length, color: "text-[var(--color-ink)]" },
                { label: "Aprovadas", value: approvedCount, color: "text-[var(--color-success)]" },
                { label: "Rejeitadas", value: rejectedCount, color: "text-[var(--color-danger)]" },
                { label: "Score Medio", value: `${avgScore}/100`, color: "text-[var(--color-navy)]" },
              ].map(s => (
                <div key={s.label} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-4 text-center">
                  <p className="text-xs text-[var(--color-muted)] mb-1">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-ink)] mb-3">Distribuicao por Sugestao de Decisao</h3>
              <div className="flex gap-1 h-4 rounded-sm overflow-hidden bg-[var(--color-tag-bg)]">
                {approvedCount > 0 && (
                  <div className="bg-[var(--color-success)]" style={{ width: `${(approvedCount / consultations.length) * 100}%` }} />
                )}
                {rejectedCount > 0 && (
                  <div className="bg-[var(--color-danger)]" style={{ width: `${(rejectedCount / consultations.length) * 100}%` }} />
                )}
              </div>
              <div className="flex justify-between mt-2 text-xs text-[var(--color-muted)]">
                <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[var(--color-success)]" />Aprovadas ({approvedCount})</span>
                <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[var(--color-danger)]" />Rejeitadas ({rejectedCount})</span>
              </div>
            </div>
            {(() => {
              const freeCount = consultations.filter((c: any) => c.cost === 0).length;
              const paidCount = consultations.filter((c: any) => c.cost > 0).length;
              const totalSpent = consultations.reduce((s: number, c: any) => s + (c.cost || 0), 0);
              const withAlerts = consultations.filter((c: any) => (c.result as any)?.alerts?.length > 0).length;
              return (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--color-ink)]">Creditos e Alertas</h3>
                  {[
                    { label: "Consultas gratuitas", value: freeCount, color: "text-[var(--color-success)]", bg: "bg-[var(--color-surface)]" },
                    { label: "Consultas pagas", value: paidCount, color: "text-[var(--color-navy)]", bg: "bg-[var(--color-surface)]" },
                    { label: "Total creditos consumidos", value: totalSpent, color: "text-[var(--color-navy)]", bg: "bg-[var(--color-navy-bg)]" },
                    { label: "Consultas com alertas anti-fraude", value: withAlerts, color: "text-[var(--color-gold)]", bg: "bg-[var(--color-gold-bg)]" },
                  ].map(r => (
                    <div key={r.label} className={`flex justify-between p-3 ${r.bg} border border-[var(--color-border)] rounded text-sm`}>
                      <span className="text-[var(--color-ink)]">{r.label}</span>
                      <span className={`font-semibold ${r.color}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </Card>
  );
}
