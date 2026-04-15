import { useState } from "react";
import { useCrmLeads, useCrmLeadDetail, useCreateCrmLead, useTransferCrmLead } from "@/hooks/crm/use-crm-leads";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, ArrowRightLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CLASSIFICACAO_BADGE: Record<string, string> = {
  frio: "bg-slate-100 text-slate-700",
  morno: "bg-yellow-100 text-yellow-800",
  quente: "bg-orange-100 text-orange-800",
  ultra_quente: "bg-red-100 text-red-800",
};

const AGENTES = ["sofia", "leo", "carlos", "lucas", "rafael"];

export default function CrmLeadsTab() {
  const { toast } = useToast();
  const [busca, setBusca] = useState("");
  const [filtroAgente, setFiltroAgente] = useState("");
  const [filtroClassificacao, setFiltroClassificacao] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const filters: Record<string, string> = {};
  if (busca) filters.busca = busca;
  if (filtroAgente) filters.agente = filtroAgente;
  if (filtroClassificacao) filters.classificacao = filtroClassificacao;

  const { data, isLoading } = useCrmLeads(filters);
  const { data: leadDetail } = useCrmLeadDetail(selectedLeadId);
  const createLead = useCreateCrmLead();
  const transferLead = useTransferCrmLead();

  const leads = data?.leads || [];

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await createLead.mutateAsync({
        telefone: fd.get("telefone") as string,
        nome: fd.get("nome") as string || undefined,
        provedor: fd.get("provedor") as string || undefined,
        cidade: fd.get("cidade") as string || undefined,
        estado: fd.get("estado") as string || undefined,
        observacoes: fd.get("observacoes") as string || undefined,
      });
      setShowCreate(false);
      toast({ title: "Lead criado com sucesso" });
    } catch (err: any) {
      toast({ title: "Erro ao criar lead", description: err.message, variant: "destructive" });
    }
  };

  const handleTransfer = async (leadId: number, paraAgente: string) => {
    try {
      await transferLead.mutateAsync({ leadId, paraAgente, motivo: "Transferencia manual" });
      toast({ title: `Transferido para ${paraAgente}` });
    } catch (err: any) {
      toast({ title: "Erro na transferencia", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted)]" />
          <Input
            placeholder="Buscar por nome, telefone, provedor..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filtroAgente} onValueChange={(v) => setFiltroAgente(v === "todos" ? "" : v)}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Agente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {AGENTES.map(a => <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroClassificacao} onValueChange={(v) => setFiltroClassificacao(v === "todos" ? "" : v)}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Classificacao" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="frio">Frio</SelectItem>
            <SelectItem value="morno">Morno</SelectItem>
            <SelectItem value="quente">Quente</SelectItem>
            <SelectItem value="ultra_quente">Ultra Quente</SelectItem>
          </SelectContent>
        </Select>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Novo Lead</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Criar Lead</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-3">
              <div><Label>Telefone *</Label><Input name="telefone" placeholder="5511999998888" required /></div>
              <div><Label>Nome</Label><Input name="nome" placeholder="Nome do contato" /></div>
              <div><Label>Provedor</Label><Input name="provedor" placeholder="Nome do ISP" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Cidade</Label><Input name="cidade" /></div>
                <div><Label>Estado</Label><Input name="estado" placeholder="SP" maxLength={2} /></div>
              </div>
              <div><Label>Observacoes</Label><Textarea name="observacoes" rows={2} /></div>
              <Button type="submit" className="w-full" disabled={createLead.isPending}>
                {createLead.isPending ? "Criando..." : "Criar Lead"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Leads table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-[var(--color-muted)]">Carregando...</p>
          ) : leads.length === 0 ? (
            <p className="p-6 text-center text-[var(--color-muted)]">Nenhum lead encontrado</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[var(--color-muted)]">
                    <th className="p-3">Nome</th>
                    <th className="p-3">Telefone</th>
                    <th className="p-3">Provedor</th>
                    <th className="p-3">Cidade</th>
                    <th className="p-3">Score</th>
                    <th className="p-3">Classificacao</th>
                    <th className="p-3">Agente</th>
                    <th className="p-3">Etapa</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead: any) => (
                    <tr
                      key={lead.id}
                      className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setSelectedLeadId(lead.id)}
                    >
                      <td className="p-3 font-medium">{lead.nome || "—"}</td>
                      <td className="p-3">{lead.telefone}</td>
                      <td className="p-3">{lead.provedor || "—"}</td>
                      <td className="p-3">{lead.cidade ? `${lead.cidade}/${lead.estado || ""}` : "—"}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${lead.scoreTotal}%`,
                                backgroundColor: lead.scoreTotal >= 81 ? "#ef4444" : lead.scoreTotal >= 61 ? "#f97316" : lead.scoreTotal >= 31 ? "#fbbf24" : "#94a3b8",
                              }}
                            />
                          </div>
                          <span className="text-xs">{lead.scoreTotal}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge className={CLASSIFICACAO_BADGE[lead.classificacao] || ""}>
                          {lead.classificacao}
                        </Badge>
                      </td>
                      <td className="p-3 capitalize">{lead.agenteAtual}</td>
                      <td className="p-3 capitalize">{lead.etapaFunil}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lead detail drawer */}
      <Sheet open={selectedLeadId !== null} onOpenChange={(open) => { if (!open) setSelectedLeadId(null); }}>
        <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{leadDetail?.nome || "Lead"}</SheetTitle>
          </SheetHeader>
          {leadDetail && (
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-[var(--color-muted)]">Telefone:</span> {leadDetail.telefone}</div>
                <div><span className="text-[var(--color-muted)]">Provedor:</span> {leadDetail.provedor || "—"}</div>
                <div><span className="text-[var(--color-muted)]">Cidade:</span> {leadDetail.cidade || "—"}</div>
                <div><span className="text-[var(--color-muted)]">Porte:</span> {leadDetail.porte}</div>
                <div><span className="text-[var(--color-muted)]">ERP:</span> {leadDetail.erp || "—"}</div>
                <div><span className="text-[var(--color-muted)]">Origem:</span> {leadDetail.origem}</div>
              </div>

              <div className="p-3 rounded-lg border">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">Score: {leadDetail.scoreTotal}/100</span>
                  <Badge className={CLASSIFICACAO_BADGE[leadDetail.classificacao] || ""}>
                    {leadDetail.classificacao}
                  </Badge>
                </div>
                <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${leadDetail.scoreTotal}%`,
                      backgroundColor: leadDetail.scoreTotal >= 81 ? "#ef4444" : leadDetail.scoreTotal >= 61 ? "#f97316" : leadDetail.scoreTotal >= 31 ? "#fbbf24" : "#94a3b8",
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs text-[var(--color-muted)] mt-1">
                  <span>Perfil: {leadDetail.scorePerfil}/50</span>
                  <span>Comportamento: {leadDetail.scoreComportamento}/50</span>
                </div>
              </div>

              <div className="p-3 rounded-lg border">
                <p className="text-sm font-medium mb-2 flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4" /> Agente atual: <span className="capitalize">{leadDetail.agenteAtual}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {AGENTES.filter(a => a !== leadDetail.agenteAtual).map(a => (
                    <Button key={a} variant="outline" size="sm" className="capitalize"
                      onClick={() => handleTransfer(leadDetail.id, a)}>
                      &rarr; {a}
                    </Button>
                  ))}
                </div>
              </div>

              {leadDetail.handoffs?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Handoffs</h4>
                  <div className="space-y-1">
                    {leadDetail.handoffs.map((h: any) => (
                      <div key={h.id} className="text-xs text-[var(--color-muted)] py-1 border-b last:border-0">
                        {h.deAgente} &rarr; {h.paraAgente} — {h.motivo || "sem motivo"} (score: {h.scoreNoMomento})
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {leadDetail.observacoes && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Observacoes</h4>
                  <p className="text-sm text-[var(--color-muted)]">{leadDetail.observacoes}</p>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
