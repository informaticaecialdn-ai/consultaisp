import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Clock } from "lucide-react";
import { formatCpfCnpj, riskDecisionBadge } from "./utils";

interface Props {
  consultations: any[];
}

export default function ConsultaHistoryTab({ consultations }: Props) {
  return (
    <Card className="rounded overflow-hidden">
      <div className="bg-[var(--color-bg)] border-b border-[var(--color-border)] px-6 py-4 flex items-center gap-3">
        <Clock className="w-5 h-5 text-[var(--color-muted)]" />
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">Historico de Consultas</h2>
      </div>
      <div className="p-6">
        {consultations.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-12 h-12 mx-auto mb-3 text-[var(--color-muted)]" />
            <p className="text-[var(--color-muted)]">Nenhuma consulta realizada ainda</p>
          </div>
        ) : (
          <div className="space-y-2">
            {consultations.map((c: any) => {
              const resultData = c.result as any;
              const customerName = resultData?.providerDetails?.[0]?.customerName;
              const providersFound = resultData?.providersFound || 0;
              return (
                <div key={c.id} className="flex items-center justify-between p-3.5 bg-[var(--color-surface)] rounded border border-[var(--color-border)] hover:border-[var(--color-navy)] transition-colors" data-testid={`consultation-${c.id}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${c.approved ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]"}`} />
                    <div>
                      <span className="text-sm font-medium text-[var(--color-ink)]">{formatCpfCnpj(c.cpfCnpj)}</span>
                      {customerName && <span className="text-xs text-[var(--color-muted)] ml-2">{customerName}</span>}
                      {!customerName && resultData?.notFound && <span className="text-xs text-[var(--color-muted)] ml-2">Nao encontrado</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    {providersFound > 0 && <span className="text-xs text-[var(--color-muted)]">{providersFound} prov.</span>}
                    <span className="text-sm font-medium text-[var(--color-ink)]">Score: {c.score}/100</span>
                    <Badge className={`${riskDecisionBadge(c.decisionReco)} border-0 text-xs`}>
                      {c.decisionReco === "Accept" ? "Aprovar" : c.decisionReco === "Review" ? "Revisar" : "Rejeitar"}
                    </Badge>
                    {c.cost === 0
                      ? <Badge variant="secondary" className="text-xs">Gratis</Badge>
                      : <Badge variant="outline" className="text-xs">-{c.cost} cred.</Badge>
                    }
                    <span className="text-xs text-[var(--color-muted)]">
                      {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
