import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle, Clock, XCircle, Shield, FileText } from "lucide-react";

interface TitularRequest {
  id: number;
  cpfCnpj: string;
  nome: string;
  email: string;
  tipoSolicitacao: string;
  descricao: string | null;
  protocolo: string;
  status: string;
  prazoLimite: string | null;
  updatedBy: number | null;
  updatedAt: string | null;
  executionResult: any;
  createdAt: string;
  businessDays: number;
  nearDeadline: boolean;
  overdue: boolean;
}

interface Stats {
  pendente: number;
  em_andamento: number;
  concluido: number;
  recusado: number;
  slaRisco: number;
  total: number;
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  pendente: { label: "Pendente", variant: "secondary" },
  em_andamento: { label: "Em Andamento", variant: "default", className: "bg-blue-600" },
  concluido: { label: "Concluido", variant: "default", className: "bg-green-600" },
  recusado: { label: "Recusado", variant: "destructive" },
};

const TIPO_LABELS: Record<string, string> = {
  acesso: "Acesso",
  correcao: "Correcao",
  exclusao: "Exclusao",
  portabilidade: "Portabilidade",
  revogacao: "Revogacao",
};

function maskCpf(cpf: string): string {
  const raw = cpf.replace(/\D/g, "");
  if (raw.length === 11) return `${raw.slice(0, 3)}.***.***-${raw.slice(9)}`;
  if (raw.length === 14) return `${raw.slice(0, 2)}.***.***/${raw.slice(8, 12)}-**`;
  return cpf;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SlaIndicator({ request }: { request: TitularRequest }) {
  if (request.status === "concluido" || request.status === "recusado") {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  if (request.overdue) {
    return <Badge variant="destructive" className="text-xs px-1.5">Vencido</Badge>;
  }
  if (request.nearDeadline) {
    return <Badge className="bg-amber-500 text-white text-xs px-1.5">Urgente</Badge>;
  }
  const remaining = 15 - request.businessDays;
  if (remaining <= 5) {
    return <Badge className="bg-yellow-500 text-white text-xs px-1.5">{remaining}d uteis</Badge>;
  }
  return <Badge variant="outline" className="text-green-600 border-green-300 text-xs px-1.5">{remaining}d uteis</Badge>;
}

export default function AdminLgpdPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterTipo, setFilterTipo] = useState<string>("all");
  const [selectedRequest, setSelectedRequest] = useState<TitularRequest | null>(null);

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/admin/titular-requests/stats"],
  });

  const { data: requests = [], isLoading } = useQuery<TitularRequest[]>({
    queryKey: ["/api/admin/titular-requests"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/admin/titular-requests/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/titular-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/titular-requests/stats"] });
      toast({ title: "Status atualizado com sucesso" });
      setSelectedRequest(null);
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao atualizar status", description: err.message, variant: "destructive" });
    },
  });

  const filtered = requests.filter(r => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterTipo !== "all" && r.tipoSolicitacao !== filterTipo) return false;
    return true;
  });

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">LGPD — Solicitacoes de Titulares</h1>
          <p className="text-sm text-muted-foreground">Gerenciamento de direitos do titular (Art. 18)</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="w-8 h-8 text-amber-500" />
            <div>
              <p className="text-2xl font-bold">{stats?.pendente ?? 0}</p>
              <p className="text-xs text-muted-foreground">Pendentes</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <FileText className="w-8 h-8 text-blue-500" />
            <div>
              <p className="text-2xl font-bold">{stats?.em_andamento ?? 0}</p>
              <p className="text-xs text-muted-foreground">Em Andamento</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-green-500" />
            <div>
              <p className="text-2xl font-bold">{stats?.concluido ?? 0}</p>
              <p className="text-xs text-muted-foreground">Concluidas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <XCircle className="w-8 h-8 text-red-500" />
            <div>
              <p className="text-2xl font-bold">{stats?.recusado ?? 0}</p>
              <p className="text-xs text-muted-foreground">Recusadas</p>
            </div>
          </CardContent>
        </Card>
        <Card className={stats?.slaRisco ? "border-red-300 bg-red-50 dark:bg-red-950/20" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className={`w-8 h-8 ${stats?.slaRisco ? "text-red-600" : "text-muted-foreground"}`} />
            <div>
              <p className="text-2xl font-bold">{stats?.slaRisco ?? 0}</p>
              <p className="text-xs text-muted-foreground">SLA em Risco</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrar por status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="em_andamento">Em Andamento</SelectItem>
            <SelectItem value="concluido">Concluido</SelectItem>
            <SelectItem value="recusado">Recusado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterTipo} onValueChange={setFilterTipo}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrar por tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="acesso">Acesso</SelectItem>
            <SelectItem value="correcao">Correcao</SelectItem>
            <SelectItem value="exclusao">Exclusao</SelectItem>
            <SelectItem value="portabilidade">Portabilidade</SelectItem>
            <SelectItem value="revogacao">Revogacao</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} solicitacao(oes)
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium">Protocolo</th>
                  <th className="text-left px-4 py-3 font-medium">CPF/CNPJ</th>
                  <th className="text-left px-4 py-3 font-medium">Tipo</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Criado em</th>
                  <th className="text-left px-4 py-3 font-medium">Prazo</th>
                  <th className="text-left px-4 py-3 font-medium">SLA</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Carregando...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Nenhuma solicitacao encontrada</td></tr>
                ) : (
                  filtered.map(r => {
                    const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.pendente;
                    return (
                      <tr
                        key={r.id}
                        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setSelectedRequest(r)}
                      >
                        <td className="px-4 py-3 font-mono text-xs">{r.protocolo}</td>
                        <td className="px-4 py-3 font-mono text-xs">{maskCpf(r.cpfCnpj)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs">{TIPO_LABELS[r.tipoSolicitacao] || r.tipoSolicitacao}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={sc.variant} className={sc.className}>{sc.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(r.createdAt)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(r.prazoLimite)}</td>
                        <td className="px-4 py-3"><SlaIndicator request={r} /></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Detalhes da Solicitacao
            </DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Protocolo</p>
                  <p className="font-mono text-xs">{selectedRequest.protocolo}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  <Badge
                    variant={STATUS_CONFIG[selectedRequest.status]?.variant || "secondary"}
                    className={STATUS_CONFIG[selectedRequest.status]?.className}
                  >
                    {STATUS_CONFIG[selectedRequest.status]?.label || selectedRequest.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Nome</p>
                  <p>{selectedRequest.nome}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">CPF/CNPJ</p>
                  <p className="font-mono text-xs">{maskCpf(selectedRequest.cpfCnpj)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Tipo</p>
                  <p>{TIPO_LABELS[selectedRequest.tipoSolicitacao] || selectedRequest.tipoSolicitacao}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">SLA</p>
                  <SlaIndicator request={selectedRequest} />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Criado em</p>
                  <p className="text-xs">{formatDateTime(selectedRequest.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Prazo Limite</p>
                  <p className="text-xs">{formatDate(selectedRequest.prazoLimite)}</p>
                </div>
              </div>

              {selectedRequest.descricao && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Descricao</p>
                  <p className="text-sm bg-muted/50 p-3 rounded-lg">{selectedRequest.descricao}</p>
                </div>
              )}

              {selectedRequest.updatedAt && (
                <div className="text-xs text-muted-foreground border-t pt-3">
                  Ultima atualizacao: {formatDateTime(selectedRequest.updatedAt)}
                </div>
              )}

              {selectedRequest.executionResult && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Resultado da Execucao</p>
                  <pre className="text-xs bg-muted/50 p-3 rounded-lg overflow-auto max-h-48">
                    {JSON.stringify(selectedRequest.executionResult, null, 2)}
                  </pre>
                </div>
              )}

              {/* Action Buttons */}
              {selectedRequest.status !== "concluido" && selectedRequest.status !== "recusado" && (
                <div className="flex gap-2 pt-2 border-t">
                  {selectedRequest.status === "pendente" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateStatusMutation.mutate({ id: selectedRequest.id, status: "em_andamento" })}
                      disabled={updateStatusMutation.isPending}
                    >
                      Marcar em Andamento
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => updateStatusMutation.mutate({ id: selectedRequest.id, status: "concluido" })}
                    disabled={updateStatusMutation.isPending}
                  >
                    Concluir
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => updateStatusMutation.mutate({ id: selectedRequest.id, status: "recusado" })}
                    disabled={updateStatusMutation.isPending}
                  >
                    Recusar
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
