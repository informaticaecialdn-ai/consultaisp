import { useCrmLeads } from "@/hooks/crm/use-crm-leads";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ETAPAS = [
  { key: "novo", label: "Novo", color: "border-t-slate-400" },
  { key: "prospeccao", label: "Prospeccao", color: "border-t-blue-400" },
  { key: "qualificacao", label: "Qualificacao", color: "border-t-yellow-400" },
  { key: "demo", label: "Demo", color: "border-t-orange-400" },
  { key: "proposta", label: "Proposta", color: "border-t-pink-400" },
  { key: "negociacao", label: "Negociacao", color: "border-t-purple-400" },
  { key: "fechamento", label: "Fechamento", color: "border-t-emerald-400" },
];

const CLASSIFICACAO_BADGE: Record<string, string> = {
  frio: "bg-slate-100 text-slate-700",
  morno: "bg-yellow-100 text-yellow-800",
  quente: "bg-orange-100 text-orange-800",
  ultra_quente: "bg-red-100 text-red-800",
};

export default function CrmPipelineTab() {
  const { data, isLoading } = useCrmLeads({ limit: "200" });
  const leads = data?.leads || [];

  if (isLoading) return <div className="text-[var(--color-muted)]">Carregando...</div>;

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {ETAPAS.map((etapa) => {
        const etapaLeads = leads.filter((l: any) => l.etapaFunil === etapa.key);
        return (
          <div key={etapa.key} className="min-w-[220px] flex-shrink-0">
            <div className={`rounded-lg border border-t-4 ${etapa.color} bg-card`}>
              <div className="p-3 border-b flex justify-between items-center">
                <span className="font-medium text-sm">{etapa.label}</span>
                <Badge variant="secondary" className="text-xs">{etapaLeads.length}</Badge>
              </div>
              <div className="p-2 space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto">
                {etapaLeads.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted)] text-center py-4">Vazio</p>
                ) : (
                  etapaLeads.map((lead: any) => (
                    <Card key={lead.id} className="shadow-sm">
                      <CardContent className="p-3">
                        <p className="font-medium text-sm truncate">{lead.nome || lead.telefone}</p>
                        {lead.provedor && <p className="text-xs text-[var(--color-muted)]">{lead.provedor}</p>}
                        <div className="flex justify-between items-center mt-2">
                          <Badge className={`text-xs ${CLASSIFICACAO_BADGE[lead.classificacao] || ""}`}>
                            {lead.classificacao}
                          </Badge>
                          <span className="text-xs capitalize text-[var(--color-muted)]">{lead.agenteAtual}</span>
                        </div>
                        {Number(lead.valorEstimado) > 0 && (
                          <p className="text-xs text-emerald-600 mt-1">
                            R$ {Number(lead.valorEstimado).toLocaleString("pt-BR")}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
