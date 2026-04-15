import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, STALE_LISTS } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Check, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_BADGE: Record<string, string> = {
  pendente: "bg-yellow-100 text-yellow-800",
  em_andamento: "bg-blue-100 text-blue-800",
  concluida: "bg-emerald-100 text-emerald-800",
  cancelada: "bg-red-100 text-red-800",
};

export default function CrmProspeccaoTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sub, setSub] = useState<"tarefas" | "campanhas">("tarefas");
  const [showCampanha, setShowCampanha] = useState(false);

  // Form state for nova campanha
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "",
    agente: "",
    regiao: "",
    mensagemTemplate: "",
  });

  const { data: tarefas = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/tarefas"],
    staleTime: STALE_LISTS,
  });

  const { data: campanhas = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/campanhas"],
    staleTime: STALE_LISTS,
  });

  const concluirTarefa = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/crm/tarefas/${id}`, { status: "concluida" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/tarefas"] });
      toast({ title: "Tarefa concluida" });
    },
  });

  const criarCampanha = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/crm/campanhas", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/campanhas"] });
      setShowCampanha(false);
      setFormData({
        nome: "",
        tipo: "",
        agente: "",
        regiao: "",
        mensagemTemplate: "",
      });
      toast({ title: "Campanha criada" });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao criar campanha",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCriarCampanha = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formData.nome.trim() || !formData.tipo || !formData.agente) {
      toast({
        title: "Campos obrigatorios",
        description: "Preencha Nome, Tipo e Agente",
        variant: "destructive",
      });
      return;
    }
    criarCampanha.mutate({
      nome: formData.nome,
      tipo: formData.tipo,
      agente: formData.agente,
      regiao: formData.regiao || undefined,
      mensagemTemplate: formData.mensagemTemplate || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setSub("tarefas")}
          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
            sub === "tarefas"
              ? "bg-[var(--color-navy)] text-white"
              : "bg-muted text-[var(--color-muted)] hover:bg-muted/70"
          }`}
        >
          Tarefas
        </button>
        <button
          onClick={() => setSub("campanhas")}
          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
            sub === "campanhas"
              ? "bg-[var(--color-navy)] text-white"
              : "bg-muted text-[var(--color-muted)] hover:bg-muted/70"
          }`}
        >
          Campanhas
        </button>
      </div>

      {sub === "tarefas" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tarefas Pendentes</CardTitle>
          </CardHeader>
          <CardContent>
            {tarefas.length === 0 ? (
              <p className="text-[var(--color-muted)] text-center py-4">
                Nenhuma tarefa
              </p>
            ) : (
              <div className="space-y-2">
                {tarefas.map((t: any) => {
                  const tarefa = t.tarefa || t;
                  return (
                    <div
                      key={tarefa.id}
                      className="flex items-center gap-3 p-3 border rounded-lg"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium">{tarefa.descricao}</p>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          <Badge
                            className={
                              STATUS_BADGE[tarefa.status] ||
                              "bg-gray-100 text-gray-800"
                            }
                          >
                            {tarefa.status}
                          </Badge>
                          <span className="text-xs text-[var(--color-muted)] capitalize">
                            {tarefa.agente} · {tarefa.tipo}
                          </span>
                          {t.leadNome && (
                            <span className="text-xs text-[var(--color-muted)]">
                              · {t.leadNome}
                            </span>
                          )}
                        </div>
                      </div>
                      {tarefa.status === "pendente" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => concluirTarefa.mutate(tarefa.id)}
                          disabled={concluirTarefa.isPending}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sub === "campanhas" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={showCampanha} onOpenChange={setShowCampanha}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" /> Nova Campanha
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Criar Campanha</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCriarCampanha} className="space-y-3">
                  <div>
                    <Label htmlFor="nome">Nome *</Label>
                    <Input
                      id="nome"
                      value={formData.nome}
                      onChange={(e) =>
                        setFormData({ ...formData, nome: e.target.value })
                      }
                      placeholder="Nome da campanha"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="tipo">Tipo *</Label>
                    <Select
                      value={formData.tipo}
                      onValueChange={(value) =>
                        setFormData({ ...formData, tipo: value })
                      }
                    >
                      <SelectTrigger id="tipo">
                        <SelectValue placeholder="Selecione tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="prospeccao">Prospeccao</SelectItem>
                        <SelectItem value="nurturing">Nurturing</SelectItem>
                        <SelectItem value="reativacao">
                          Reativacao
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="agente">Agente *</Label>
                    <Select
                      value={formData.agente}
                      onValueChange={(value) =>
                        setFormData({ ...formData, agente: value })
                      }
                    >
                      <SelectTrigger id="agente">
                        <SelectValue placeholder="Selecione agente" />
                      </SelectTrigger>
                      <SelectContent>
                        {["sofia", "carlos", "lucas", "rafael"].map((a) => (
                          <SelectItem key={a} value={a}>
                            <span className="capitalize">{a}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="regiao">Regiao</Label>
                    <Input
                      id="regiao"
                      value={formData.regiao}
                      onChange={(e) =>
                        setFormData({ ...formData, regiao: e.target.value })
                      }
                      placeholder="Interior de SP"
                    />
                  </div>
                  <div>
                    <Label htmlFor="mensagem">Template da mensagem</Label>
                    <Textarea
                      id="mensagem"
                      value={formData.mensagemTemplate}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          mensagemTemplate: e.target.value,
                        })
                      }
                      rows={3}
                      placeholder="Template de mensagem para a campanha"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={criarCampanha.isPending}
                  >
                    {criarCampanha.isPending ? "Criando..." : "Criar Campanha"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              {campanhas.length === 0 ? (
                <p className="p-6 text-[var(--color-muted)] text-center">
                  Nenhuma campanha
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-[var(--color-muted)]">
                        <th className="p-3">Nome</th>
                        <th className="p-3">Tipo</th>
                        <th className="p-3">Agente</th>
                        <th className="p-3">Regiao</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Enviados</th>
                        <th className="p-3">Respondidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campanhas.map((c: any) => (
                        <tr key={c.id} className="border-b">
                          <td className="p-3 font-medium">{c.nome}</td>
                          <td className="p-3 capitalize">{c.tipo}</td>
                          <td className="p-3 capitalize">{c.agente}</td>
                          <td className="p-3">{c.regiao || "—"}</td>
                          <td className="p-3">
                            <Badge variant="secondary">{c.status}</Badge>
                          </td>
                          <td className="p-3">{c.totalEnviados || 0}</td>
                          <td className="p-3">{c.totalRespondidos || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
