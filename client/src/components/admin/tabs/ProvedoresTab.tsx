import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, STALE_LISTS } from "@/lib/queryClient";
import {
  Plus, Search, RefreshCw, XCircle, Globe, Users, ChevronRight,
} from "lucide-react";
import { PLAN_LABELS } from "../constants";
import NewProviderWizard from "../NewProviderWizard";
import ProviderDrawer from "../ProviderDrawer";

export default function ProvedoresTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [providerSearch, setProviderSearch] = useState("");
  const [showNewProvider, setShowNewProvider] = useState(false);
  const [drawerProviderId, setDrawerProviderId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: allProviders = [], isLoading: providersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    staleTime: STALE_LISTS,
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/providers/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Provedor desativado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const filteredProviders = allProviders.filter((p: any) =>
    p.name.toLowerCase().includes(providerSearch.toLowerCase()) ||
    (p.subdomain || "").toLowerCase().includes(providerSearch.toLowerCase())
  );

  const openDrawer = (id: number) => {
    setDrawerProviderId(id);
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted)]" />
          <Input
            placeholder="Buscar provedor..."
            className="pl-9"
            value={providerSearch}
            onChange={(e) => setProviderSearch(e.target.value)}
            data-testid="input-search-provider"
          />
        </div>
        <Button onClick={() => setShowNewProvider(!showNewProvider)} className="gap-1.5" data-testid="button-new-provider">
          <Plus className="w-4 h-4" />Novo Provedor
        </Button>
      </div>
      <div className="flex items-center gap-2 text-xs text-[var(--color-muted)] bg-muted/40 rounded px-3 py-2">
        <Users className="w-3.5 h-3.5 text-[var(--color-steel)] flex-shrink-0" />
        Todos os provedores cadastrados
        <span className="ml-auto text-xs font-medium">{filteredProviders.length} provedor(es)</span>
      </div>

      <NewProviderWizard open={showNewProvider} onOpenChange={setShowNewProvider} />
      <ProviderDrawer providerId={drawerProviderId} open={drawerOpen} onOpenChange={setDrawerOpen} />

      <Card className="overflow-hidden">
        {providersLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-[var(--color-muted)]" />
          </div>
        ) : (
          <div className="divide-y">
            {filteredProviders.map((p: any) => (
              <div
                key={p.id}
                className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
                data-testid={`admin-provider-row-${p.id}`}
                onClick={() => openDrawer(p.id)}
              >
                <div className="w-10 h-10 rounded from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                  {p.name?.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{p.name}</p>
                    <span className={`w-2 h-2 rounded-full ${p.status === "active" ? "bg-emerald-500" : "bg-gray-400"}`} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--color-muted)] mt-0.5">
                    <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{p.subdomain}.consultaisp.com.br</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />{p.userCount} usuarios</span>
                    <span>ISP: {p.ispCredits} | SPC: {p.spcCredits}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Badge className={`text-xs ${PLAN_LABELS[p.plan]?.color || ""}`}>
                    {PLAN_LABELS[p.plan]?.label}
                  </Badge>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5 text-xs h-8"
                    onClick={() => openDrawer(p.id)}
                    data-testid={`button-painel-provider-${p.id}`}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />Painel
                  </Button>
                  {p.status === "active" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-500 hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
                      onClick={() => {
                        if (confirm(`Desativar ${p.name}?`)) deactivateMutation.mutate(p.id);
                      }}
                      data-testid={`button-deactivate-provider-${p.id}`}
                    >
                      <XCircle className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
