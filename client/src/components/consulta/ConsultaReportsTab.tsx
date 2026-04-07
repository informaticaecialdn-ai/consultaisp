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
    <Card className="shadow-lg rounded-2xl overflow-hidden">
      <div className="bg-slate-50 border-b px-6 py-4 flex items-center gap-3">
        <BarChart3 className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900">Resumo de Consultas</h2>
      </div>
      <div className="p-6">
        {consultations.length === 0 ? (
          <div className="text-center py-12">
            <BarChart3 className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500">Realize consultas para ver o resumo</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Consultas", value: consultations.length, color: "text-slate-900" },
                { label: "Aprovadas", value: approvedCount, color: "text-emerald-600" },
                { label: "Rejeitadas", value: rejectedCount, color: "text-red-600" },
                { label: "Score Medio", value: `${avgScore}/100`, color: "text-blue-600" },
              ].map(s => (
                <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
                  <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Distribuicao por Sugestao de Decisao</h3>
              <div className="flex gap-1 h-4 rounded-full overflow-hidden bg-slate-100">
                {approvedCount > 0 && (
                  <div className="bg-emerald-500" style={{ width: `${(approvedCount / consultations.length) * 100}%` }} />
                )}
                {rejectedCount > 0 && (
                  <div className="bg-red-500" style={{ width: `${(rejectedCount / consultations.length) * 100}%` }} />
                )}
              </div>
              <div className="flex justify-between mt-2 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" />Aprovadas ({approvedCount})</span>
                <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500" />Rejeitadas ({rejectedCount})</span>
              </div>
            </div>
            {(() => {
              const freeCount = consultations.filter((c: any) => c.cost === 0).length;
              const paidCount = consultations.filter((c: any) => c.cost > 0).length;
              const totalSpent = consultations.reduce((s: number, c: any) => s + (c.cost || 0), 0);
              const withAlerts = consultations.filter((c: any) => (c.result as any)?.alerts?.length > 0).length;
              return (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700">Creditos e Alertas</h3>
                  {[
                    { label: "Consultas gratuitas", value: freeCount, color: "text-emerald-600", bg: "bg-white" },
                    { label: "Consultas pagas", value: paidCount, color: "text-blue-600", bg: "bg-white" },
                    { label: "Total creditos consumidos", value: totalSpent, color: "text-blue-600", bg: "bg-blue-50" },
                    { label: "Consultas com alertas anti-fraude", value: withAlerts, color: "text-amber-700", bg: "bg-amber-50" },
                  ].map(r => (
                    <div key={r.label} className={`flex justify-between p-3 ${r.bg} border border-slate-200 rounded-lg text-sm`}>
                      <span className="text-slate-700">{r.label}</span>
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
