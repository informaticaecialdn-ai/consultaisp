import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, STALE_LISTS } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Check, X, Star, Brain, BookOpen, Shield, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const AGENTE_COLORS: Record<string, string> = {
  sofia: "#f472b6", leo: "#fbbf24", carlos: "#34d399", lucas: "#60a5fa", rafael: "#a78bfa", marcos: "#f59e0b",
};

const NOTA_COLORS = ["", "bg-red-100 text-red-800", "bg-orange-100 text-orange-800", "bg-yellow-100 text-yellow-800", "bg-blue-100 text-blue-800", "bg-emerald-100 text-emerald-800"];

export default function CrmTreinamentoTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sub, setSub] = useState<"avaliacoes" | "regras" | "conhecimento" | "metricas">("avaliacoes");
  const [filtroAgente, setFiltroAgente] = useState("");
  const [showCriarRegra, setShowCriarRegra] = useState(false);

  const { data: avaliacoes = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/avaliacoes" + (filtroAgente ? `?agente=${filtroAgente}` : "")],
    staleTime: STALE_LISTS,
  });

  const { data: regras = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/regras"],
    staleTime: STALE_LISTS,
  });

  const { data: conhecimento = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/conhecimento" + (filtroAgente ? `?agente=${filtroAgente}` : "")],
    staleTime: STALE_LISTS,
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/crm/treinamento/stats"],
    staleTime: STALE_LISTS,
  });

  const actionRegra = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: string }) => {
      await apiRequest("PATCH", `/api/crm/regras/${id}`, { action });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/regras"] });
      qc.invalidateQueries({ queryKey: ["/api/crm/treinamento/stats"] });
      toast({ title: "Regra atualizada" });
    },
  });

  const toggleConhecimento = useMutation({
    mutationFn: async ({ id, ativo }: { id: number; ativo: boolean }) => {
      await apiRequest("PATCH", `/api/crm/conhecimento/${id}`, { ativo });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/conhecimento"] });
      toast({ title: "Exemplo atualizado" });
    },
  });

  const criarRegra = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/crm/regras", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/regras"] });
      setShowCriarRegra(false);
      toast({ title: "Regra criada e aprovada" });
    },
  });

  const regrasPendentes = regras.filter((r: any) => r.status === "pendente");
  const regrasAprovadas = regras.filter((r: any) => r.status === "aprovada");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "avaliacoes", label: "Avaliacoes", icon: Star },
          { key: "regras", label: `Regras ${regrasPendentes.length > 0 ? `(${regrasPendentes.length})` : ""}`, icon: Shield },
          { key: "conhecimento", label: "Base de Conhecimento", icon: BookOpen },
          { key: "metricas", label: "Metricas", icon: Brain },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSub(tab.key as any)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2 ${
              sub === tab.key ? "bg-[var(--color-navy)] text-white" : "bg-muted text-[var(--color-muted)] hover:bg-muted/70"
            }`}
          >
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
        <Select value={filtroAgente} onValueChange={(v) => setFiltroAgente(v === "todos" ? "" : v)}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Agente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {["sofia", "leo", "carlos", "lucas", "rafael", "marcos"].map((a) => (
              <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {sub === "avaliacoes" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Avaliacoes do Supervisor</CardTitle></CardHeader>
          <CardContent>
            {avaliacoes.length === 0 ? (
              <p className="text-[var(--color-muted)] text-center py-4">Nenhuma avaliacao ainda. O supervisor avalia automaticamente apos cada resposta dos agentes.</p>
            ) : (
              <div className="space-y-3">
                {avaliacoes.map((a: any) => (
                  <div key={a.id} className="p-3 border rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: AGENTE_COLORS[a.agente] || "#64748b" }} />
                      <span className="font-medium capitalize text-sm">{a.agente}</span>
                      <Badge className={NOTA_COLORS[a.nota] || ""}>{a.nota}/5</Badge>
                      {a.leadSentimento && <Badge variant="outline" className="text-xs">{a.leadSentimento}</Badge>}
                      <span className="text-xs text-[var(--color-muted)] ml-auto">
                        {a.criadoEm ? new Date(a.criadoEm).toLocaleString("pt-BR") : ""}
                      </span>
                    </div>
                    {a.sugestao && <p className="text-sm text-[var(--color-muted)]">{a.sugestao}</p>}
                    {a.problemas && a.problemas.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {a.problemas.map((p: string, i: number) => (
                          <Badge key={i} variant="destructive" className="text-xs">{p}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sub === "regras" && (
        <div className="space-y-4">
          {regrasPendentes.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Regras Pendentes ({regrasPendentes.length})</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {regrasPendentes.map((r: any) => (
                  <div key={r.id} className="p-3 border rounded-lg flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="capitalize text-sm font-medium" style={{ color: AGENTE_COLORS[r.agente] }}>{r.agente}</span>
                        <Badge variant="outline" className="text-xs">{r.categoria}</Badge>
                      </div>
                      <p className="text-sm">{r.regra}</p>
                      {r.evidencia && <p className="text-xs text-[var(--color-muted)] mt-1">{r.evidencia}</p>}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => actionRegra.mutate({ id: r.id, action: "aprovar" })}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-600" onClick={() => actionRegra.mutate({ id: r.id, action: "rejeitar" })}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-base">Regras Aprovadas ({regrasAprovadas.length})</CardTitle>
                <Dialog open={showCriarRegra} onOpenChange={setShowCriarRegra}>
                  <DialogTrigger asChild>
                    <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Criar Regra</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Criar Regra Manual</DialogTitle></DialogHeader>
                    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); criarRegra.mutate({ agente: fd.get("agente"), regra: fd.get("regra"), categoria: fd.get("categoria") }); }} className="space-y-3">
                      <div><Label>Agente</Label><Input name="agente" placeholder="carlos (ou 'todos')" required /></div>
                      <div><Label>Regra</Label><Input name="regra" placeholder="Nunca mencionar preco na primeira mensagem" required /></div>
                      <div><Label>Categoria</Label><Input name="categoria" placeholder="tom/timing/conteudo/objecao/regional" required /></div>
                      <Button type="submit" className="w-full" disabled={criarRegra.isPending}>Criar e Aprovar</Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {regrasAprovadas.length === 0 ? (
                <p className="text-[var(--color-muted)] text-center py-4">Nenhuma regra aprovada</p>
              ) : (
                <div className="space-y-2">
                  {regrasAprovadas.map((r: any) => (
                    <div key={r.id} className="flex items-center gap-3 p-2 border rounded text-sm">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: AGENTE_COLORS[r.agente] || "#64748b" }} />
                      <span className="flex-1">{r.regra}</span>
                      <Badge variant="outline" className="text-xs">{r.categoria}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {sub === "conhecimento" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Base de Conhecimento ({conhecimento.length} exemplos)</CardTitle></CardHeader>
          <CardContent>
            {conhecimento.length === 0 ? (
              <p className="text-[var(--color-muted)] text-center py-4">Nenhum exemplo. O supervisor extrai automaticamente das conversas.</p>
            ) : (
              <div className="space-y-3">
                {conhecimento.map((e: any) => (
                  <div key={e.id} className={`p-3 border rounded-lg ${!e.ativo ? "opacity-50" : ""}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: AGENTE_COLORS[e.agente] || "#64748b" }} />
                      <span className="capitalize text-sm font-medium">{e.agente}</span>
                      <Badge className={e.tipo === "sucesso" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>
                        {e.tipo}
                      </Badge>
                      {e.tags?.map((t: string) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                      <Button size="sm" variant="ghost" className="ml-auto text-xs"
                        onClick={() => toggleConhecimento.mutate({ id: e.id, ativo: !e.ativo })}>
                        {e.ativo ? "Desativar" : "Ativar"}
                      </Button>
                    </div>
                    {e.mensagemLead && <p className="text-xs text-[var(--color-muted)]">Lead: "{e.mensagemLead}"</p>}
                    {e.respostaAgente && <p className="text-xs mt-1">Agente: "{e.respostaAgente}"</p>}
                    {e.resultado && <p className="text-xs text-[var(--color-muted)] mt-1">{e.resultado}</p>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sub === "metricas" && stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {(stats.agentes || []).map((a: any) => (
              <Card key={a.agente} className="border-t-4" style={{ borderTopColor: AGENTE_COLORS[a.agente] }}>
                <CardContent className="pt-4">
                  <p className="font-medium capitalize mb-2">{a.agente}</p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--color-muted)]">Nota media</span>
                      <span className="font-medium">{a.notaMedia}/5</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-muted)]">Avaliacoes</span>
                      <span>{a.totalAvaliacoes}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-muted)]">Regras ativas</span>
                      <span>{a.regrasAtivas}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-muted)]">Exemplos</span>
                      <span>{a.exemplosAtivos}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {Number(stats.regrasPendentes) > 0 && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-center">
                  <span className="font-medium text-orange-600">{stats.regrasPendentes}</span> regras pendentes de aprovacao.
                  <button onClick={() => setSub("regras")} className="text-blue-500 underline ml-1">Ver regras</button>
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
