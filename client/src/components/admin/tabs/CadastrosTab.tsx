import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, STALE_LISTS } from "@/lib/queryClient";
import {
  Activity, Search, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle,
  User, Send, FileText, Globe, CreditCard, Users, Trash2, Eye,
} from "lucide-react";
import { PLAN_LABELS } from "../constants";

const VERIFICATION_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: "Pendente", color: "bg-amber-100 text-[var(--color-gold)] dark:bg-amber-900 dark:text-amber-300", icon: Clock },
  approved: { label: "Aprovado", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300", icon: CheckCircle },
  rejected: { label: "Rejeitado", color: "bg-red-100 text-[var(--color-danger)] dark:bg-red-900 dark:text-red-300", icon: XCircle },
};

export default function CadastrosTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [cadastroSearch, setCadastroSearch] = useState("");
  const [cadastroFilter, setCadastroFilter] = useState("all");

  const { data: allProviders = [], isLoading: providersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    staleTime: STALE_LISTS,
  });
  const { data: allUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    staleTime: STALE_LISTS,
  });

  const updateVerificationMutation = useMutation({
    mutationFn: async ({ id, verificationStatus }: { id: number; verificationStatus: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/providers/${id}`, { verificationStatus });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      const statusLabels: Record<string, string> = { approved: "aprovado", rejected: "rejeitado", pending: "movido para pendente" };
      toast({ title: `Cadastro ${statusLabels[variables.verificationStatus] || "atualizado"} com sucesso` });
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar status", description: e.message, variant: "destructive" }),
  });

  const resendVerificationMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/providers/${id}/resend-verification`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Email enviado", description: data.message || "Email de verificacao reenviado com sucesso." });
    },
    onError: (e: any) => toast({ title: "Erro ao reenviar email", description: e.message, variant: "destructive" }),
  });

  const deleteProviderMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/providers/${id}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Provedor excluido", description: "O cadastro e todos os dados associados foram removidos." });
    },
    onError: (e: any) => toast({ title: "Erro ao excluir", description: e.message, variant: "destructive" }),
  });

  const filteredCadastros = allProviders
    .filter((p: any) => {
      const matchesSearch = p.name.toLowerCase().includes(cadastroSearch.toLowerCase()) ||
        (p.contactEmail || "").toLowerCase().includes(cadastroSearch.toLowerCase()) ||
        (p.cnpj || "").includes(cadastroSearch);
      const matchesFilter = cadastroFilter === "all" || p.verificationStatus === cadastroFilter;
      return matchesSearch && matchesFilter;
    })
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const cadastroCounts = {
    all: allProviders.length,
    pending: allProviders.filter((p: any) => p.verificationStatus === "pending").length,
    approved: allProviders.filter((p: any) => p.verificationStatus === "approved").length,
    rejected: allProviders.filter((p: any) => p.verificationStatus === "rejected").length,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["all", "pending", "approved", "rejected"] as const).map((f) => {
          const labels: Record<string, { label: string; color: string; activeColor: string }> = {
            all: { label: "Todos", color: "text-gray-600", activeColor: "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900" },
            pending: { label: "Pendentes", color: "text-[var(--color-gold)]", activeColor: "bg-amber-600 text-white" },
            approved: { label: "Aprovados", color: "text-emerald-600", activeColor: "bg-emerald-600 text-white" },
            rejected: { label: "Rejeitados", color: "text-[var(--color-danger)]", activeColor: "bg-red-600 text-white" },
          };
          const l = labels[f];
          const isActive = cadastroFilter === f;
          return (
            <button
              key={f}
              onClick={() => setCadastroFilter(f)}
              className={`rounded p-3 text-left transition-all border ${isActive ? l.activeColor + " border-transparent" : "bg-[var(--color-surface)] dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-gray-300"}`}
              data-testid={`button-filter-cadastro-${f}`}
            >
              <p className={`text-2xl font-bold ${isActive ? "" : l.color}`}>{cadastroCounts[f]}</p>
              <p className={`text-xs mt-0.5 ${isActive ? "opacity-80" : "text-[var(--color-muted)]"}`}>{l.label}</p>
            </button>
          );
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted)]" />
        <Input
          placeholder="Buscar por nome, email ou CNPJ..."
          className="pl-9"
          value={cadastroSearch}
          onChange={(e) => setCadastroSearch(e.target.value)}
          data-testid="input-search-cadastro"
        />
      </div>

      <Card className="overflow-hidden">
        {providersLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-[var(--color-muted)]" />
          </div>
        ) : filteredCadastros.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--color-muted)]">
            <Activity className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">Nenhum cadastro encontrado</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredCadastros.map((p: any) => {
              const vs = VERIFICATION_LABELS[p.verificationStatus] || VERIFICATION_LABELS.pending;
              const VsIcon = vs.icon;
              const adminUser = allUsers.find((u: any) => u.providerId === p.id && u.role === "admin");
              const createdDate = p.createdAt ? new Date(p.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
              return (
                <div key={p.id} className="px-5 py-4" data-testid={`cadastro-row-${p.id}`}>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded from-amber-500 to-orange-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {p.name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{p.name}</p>
                        <Badge className={`text-xs gap-1 ${vs.color}`} data-testid={`badge-status-${p.id}`}>
                          <VsIcon className="w-3 h-3" />{vs.label}
                        </Badge>
                        {p.adminEmailVerified ? (
                          <Badge className="text-xs bg-green-100 text-[var(--color-success)] dark:bg-green-900 dark:text-green-300 gap-1" data-testid={`badge-email-verified-${p.id}`}>
                            <CheckCircle className="w-3 h-3" />Email verificado
                          </Badge>
                        ) : (
                          <Badge className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 gap-1" data-testid={`badge-email-unverified-${p.id}`}>
                            <AlertCircle className="w-3 h-3" />Email nao verificado
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs text-[var(--color-muted)]">
                        <div className="flex items-center gap-1.5"><User className="w-3 h-3 flex-shrink-0" /><span className="truncate">{adminUser?.name || "-"}</span></div>
                        <div className="flex items-center gap-1.5"><Send className="w-3 h-3 flex-shrink-0" /><span className="truncate">{p.contactEmail || adminUser?.email || "-"}</span></div>
                        <div className="flex items-center gap-1.5"><FileText className="w-3 h-3 flex-shrink-0" /><span>{p.cnpj ? p.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : "-"}</span></div>
                        <div className="flex items-center gap-1.5"><Clock className="w-3 h-3 flex-shrink-0" /><span>{createdDate}</span></div>
                        <div className="flex items-center gap-1.5"><Globe className="w-3 h-3 flex-shrink-0" /><span>{p.subdomain ? `${p.subdomain}.consultaisp.com.br` : "-"}</span></div>
                        <div className="flex items-center gap-1.5"><CreditCard className="w-3 h-3 flex-shrink-0" /><span>Plano: {PLAN_LABELS[p.plan]?.label || p.plan}</span></div>
                        <div className="flex items-center gap-1.5"><Users className="w-3 h-3 flex-shrink-0" /><span>{p.userCount || 0} usuario(s)</span></div>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.status === "active" ? "bg-emerald-500" : "bg-gray-400"}`} />
                          <span>{p.status === "active" ? "Ativo" : "Inativo"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {p.verificationStatus === "pending" && (
                        <>
                          <Button
                            size="sm"
                            className="gap-1.5 text-xs h-8 bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "approved" })}
                            disabled={updateVerificationMutation.isPending}
                            data-testid={`button-approve-${p.id}`}
                          >
                            <CheckCircle className="w-3.5 h-3.5" />Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs h-8 text-[var(--color-danger)] border-red-200 hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger)]"
                            onClick={() => {
                              if (confirm(`Rejeitar o cadastro de ${p.name}?`))
                                updateVerificationMutation.mutate({ id: p.id, verificationStatus: "rejected" });
                            }}
                            disabled={updateVerificationMutation.isPending}
                            data-testid={`button-reject-${p.id}`}
                          >
                            <XCircle className="w-3.5 h-3.5" />Rejeitar
                          </Button>
                        </>
                      )}
                      {p.verificationStatus === "rejected" && (
                        <>
                          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "approved" })} disabled={updateVerificationMutation.isPending} data-testid={`button-reapprove-${p.id}`}>
                            <CheckCircle className="w-3.5 h-3.5" />Aprovar
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8 text-[var(--color-gold)] border-amber-200 hover:bg-[var(--color-gold-bg)]" onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "pending" })} disabled={updateVerificationMutation.isPending} data-testid={`button-set-pending-rejected-${p.id}`}>
                            <Clock className="w-3.5 h-3.5" />Pendente
                          </Button>
                        </>
                      )}
                      {p.verificationStatus === "approved" && (
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8 text-[var(--color-gold)] border-amber-200 hover:bg-[var(--color-gold-bg)]" onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "pending" })} disabled={updateVerificationMutation.isPending} data-testid={`button-set-pending-${p.id}`}>
                          <Clock className="w-3.5 h-3.5" />Pendente
                        </Button>
                      )}
                      {!p.adminEmailVerified && (
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8 text-[var(--color-navy)] border-blue-200 hover:bg-[var(--color-navy-bg)] hover:text-[var(--color-navy)]" onClick={() => resendVerificationMutation.mutate(p.id)} disabled={resendVerificationMutation.isPending} data-testid={`button-resend-email-${p.id}`}>
                          <RefreshCw className="w-3.5 h-3.5" />Reenviar Email
                        </Button>
                      )}
                      <Button
                        size="sm" variant="outline"
                        className="gap-1.5 text-xs h-8 text-[var(--color-danger)] border-red-200 hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger)]"
                        onClick={() => {
                          if (confirm(`Excluir permanentemente o cadastro de "${p.name}"?\n\nTodos os dados associados (usuarios, clientes, consultas, faturas etc.) serao removidos. Esta acao nao pode ser desfeita.`))
                            deleteProviderMutation.mutate(p.id);
                        }}
                        disabled={deleteProviderMutation.isPending}
                        data-testid={`button-delete-cadastro-${p.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />Excluir
                      </Button>
                      <Button
                        variant="default" size="sm"
                        className="gap-1.5 text-xs h-8"
                        onClick={() => navigate(`/admin/provedor/${p.id}`)}
                        data-testid={`button-view-cadastro-${p.id}`}
                      >
                        <Eye className="w-3.5 h-3.5" />Ver
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
