import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, RefreshCw, Save, X, Pencil, Trash2, Database, ImagePlus,
  ToggleLeft, ToggleRight,
} from "lucide-react";
import type { ErpCatalog } from "@shared/schema";

const BLANK_ERP_FORM = {
  key: "", name: "", description: "", gradient: "from-teal-500 to-teal-600",
  authType: "bearer", authHint: "", active: true, logoBase64: "",
};

export default function ConfiguracoesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: erpCatalogList = [], isLoading: erpCatalogLoading } = useQuery<ErpCatalog[]>({
    queryKey: ["/api/erp-catalog"],
  });

  const [showErpForm, setShowErpForm] = useState(false);
  const [editingErp, setEditingErp] = useState<ErpCatalog | null>(null);
  const [erpForm, setErpForm] = useState({ ...BLANK_ERP_FORM });
  const [erpLogoPreview, setErpLogoPreview] = useState<string>("");

  const createErpMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/erp-catalog", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] });
      setShowErpForm(false);
      setEditingErp(null);
      setErpForm({ ...BLANK_ERP_FORM });
      setErpLogoPreview("");
      toast({ title: "ERP cadastrado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao cadastrar ERP", description: e.message, variant: "destructive" }),
  });

  const updateErpMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/erp-catalog/${id}`, data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] });
      setShowErpForm(false);
      setEditingErp(null);
      setErpForm({ ...BLANK_ERP_FORM });
      setErpLogoPreview("");
      toast({ title: "ERP atualizado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar ERP", description: e.message, variant: "destructive" }),
  });

  const deleteErpMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/erp-catalog/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] });
      toast({ title: "ERP removido" });
    },
    onError: (e: any) => toast({ title: "Erro ao remover", description: e.message, variant: "destructive" }),
  });

  const toggleErpActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/erp-catalog/${id}`, { active });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] }),
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const handleErpLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast({ title: "Imagem muito grande", description: "Maximo 2MB", variant: "destructive" }); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setErpLogoPreview(base64);
      setErpForm(f => ({ ...f, logoBase64: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const openEditErp = (erp: ErpCatalog) => {
    setEditingErp(erp);
    setErpForm({
      key: erp.key, name: erp.name, description: erp.description ?? "",
      gradient: erp.gradient, authType: erp.authType, authHint: erp.authHint ?? "",
      active: erp.active, logoBase64: erp.logoBase64 ?? "",
    });
    setErpLogoPreview(erp.logoBase64 ?? "");
    setShowErpForm(true);
  };

  const handleErpSubmit = () => {
    if (!erpForm.key || !erpForm.name) {
      toast({ title: "Campos obrigatorios", description: "Chave e Nome sao obrigatorios", variant: "destructive" });
      return;
    }
    const payload = { ...erpForm, logoBase64: erpForm.logoBase64 || null };
    if (editingErp) { updateErpMutation.mutate({ id: editingErp.id, data: payload }); }
    else { createErpMutation.mutate(payload); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-[var(--color-muted)]">
          {erpCatalogList.length} ERP(s) cadastrado(s). Adicione logos para deixar mais visual para os provedores.
        </p>
        <Button
          size="sm"
          className="gap-1.5 h-8 text-xs"
          onClick={() => { setEditingErp(null); setErpForm({ ...BLANK_ERP_FORM }); setErpLogoPreview(""); setShowErpForm(true); }}
          data-testid="button-new-erp"
        >
          <Plus className="w-3.5 h-3.5" />Novo ERP
        </Button>
      </div>

      {showErpForm && (
        <Card className="p-5 border-2 border-teal-200 dark:border-teal-900">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm">{editingErp ? "Editar ERP" : "Cadastrar Novo ERP"}</h3>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setShowErpForm(false); setEditingErp(null); }} data-testid="button-close-erp-form">
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium mb-1 block">Chave (slug) *</Label>
                <Input value={erpForm.key} onChange={e => setErpForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))} placeholder="ex: ixc, sgp, mk" disabled={!!editingErp} data-testid="input-erp-key" className="h-8 text-sm" />
                <p className="text-xs text-[var(--color-muted)] mt-0.5">Identificador unico, sem espacos</p>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1 block">Nome do ERP *</Label>
                <Input value={erpForm.name} onChange={e => setErpForm(f => ({ ...f, name: e.target.value }))} placeholder="ex: iXC Soft" data-testid="input-erp-name" className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1 block">Descricao</Label>
                <Input value={erpForm.description} onChange={e => setErpForm(f => ({ ...f, description: e.target.value }))} placeholder="ex: ERP para provedores de internet" data-testid="input-erp-description" className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1 block">Tipo de autenticacao</Label>
                <select className="w-full border rounded-md px-3 py-1.5 text-sm bg-background" value={erpForm.authType} onChange={e => setErpForm(f => ({ ...f, authType: e.target.value }))} data-testid="select-erp-auth-type">
                  <option value="bearer">Bearer Token</option>
                  <option value="basic">Basic Auth (usuario + token)</option>
                  <option value="apikey">API Key</option>
                </select>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1 block">Dica de autenticacao</Label>
                <Input value={erpForm.authHint} onChange={e => setErpForm(f => ({ ...f, authHint: e.target.value }))} placeholder="ex: Token: chave de API do sistema" data-testid="input-erp-auth-hint" className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1 block">Cor do gradiente</Label>
                <select className="w-full border rounded-md px-3 py-1.5 text-sm bg-background" value={erpForm.gradient} onChange={e => setErpForm(f => ({ ...f, gradient: e.target.value }))} data-testid="select-erp-gradient">
                  {[
                    { label: "Azul", v: "from-blue-500 to-blue-600" },
                    { label: "Roxo", v: "from-purple-500 to-purple-600" },
                    { label: "Verde", v: "from-green-500 to-green-600" },
                    { label: "Laranja", v: "from-orange-500 to-orange-600" },
                    { label: "Indigo", v: "from-indigo-500 to-indigo-600" },
                    { label: "Ciano", v: "from-cyan-500 to-cyan-600" },
                    { label: "Rosa", v: "from-rose-500 to-pink-600" },
                    { label: "Teal", v: "from-teal-500 to-teal-600" },
                    { label: "Ambar", v: "from-amber-500 to-amber-600" },
                    { label: "Vermelho", v: "from-red-500 to-red-600" },
                    { label: "Cinza", v: "from-slate-500 to-slate-600" },
                    { label: "Branco", v: "from-white to-slate-100" },
                  ].map(g => <option key={g.v} value={g.v}>{g.label}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium mb-1 block">Logo do ERP</Label>
                <div className="border-2 border-dashed rounded p-4 flex flex-col items-center gap-3 bg-muted/20">
                  {erpLogoPreview ? (
                    <div className="relative">
                      <img src={erpLogoPreview} alt="Logo preview" className="w-20 h-20 object-contain rounded border bg-[var(--color-surface)] p-1" data-testid="img-erp-logo-preview" />
                      <button className="absolute -top-2 -right-2 w-5 h-5 bg-[var(--color-danger-bg)]0 text-white rounded-full flex items-center justify-center" onClick={() => { setErpLogoPreview(""); setErpForm(f => ({ ...f, logoBase64: "" })); }}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className={`w-20 h-20 rounded ${erpForm.gradient} flex items-center justify-center`}>
                      <span className="text-white text-xl font-bold">{(erpForm.name[0] || "?").toUpperCase()}</span>
                    </div>
                  )}
                  <label className="cursor-pointer" data-testid="label-upload-logo">
                    <input type="file" accept="image/*" className="hidden" onChange={handleErpLogoUpload} data-testid="input-erp-logo-file" />
                    <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-foreground transition-colors border rounded-md px-3 py-1.5">
                      <ImagePlus className="w-3.5 h-3.5" />
                      {erpLogoPreview ? "Trocar logo" : "Enviar logo"}
                    </div>
                  </label>
                  <p className="text-xs text-[var(--color-muted)] text-center">PNG, JPG ou SVG. Max 2MB.<br />Sem logo: inicial do nome sobre gradiente.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setErpForm(f => ({ ...f, active: !f.active }))} className="p-0" data-testid="toggle-erp-active">
                  {erpForm.active ? <ToggleRight className="w-8 h-8 text-emerald-500" /> : <ToggleLeft className="w-8 h-8 text-[var(--color-muted)]" />}
                </button>
                <span className="text-sm">{erpForm.active ? "ERP Ativo (visivel para provedores)" : "ERP Inativo (oculto para provedores)"}</span>
              </div>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1 h-8 text-xs gap-1" onClick={handleErpSubmit} disabled={createErpMutation.isPending || updateErpMutation.isPending} data-testid="button-save-erp">
                  <Save className="w-3.5 h-3.5" />{editingErp ? "Salvar alteracoes" : "Cadastrar ERP"}
                </Button>
                <Button variant="outline" className="h-8 text-xs" onClick={() => { setShowErpForm(false); setEditingErp(null); }}>Cancelar</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {erpCatalogLoading ? (
        <div className="flex items-center justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-[var(--color-muted)]" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {erpCatalogList.map(erp => (
            <Card key={erp.id} className={`relative overflow-hidden ${!erp.active ? "opacity-60" : ""}`} data-testid={`card-erp-${erp.id}`}>
              <div className={`h-1.5 ${erp.gradient}`} />
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-14 h-14 rounded flex items-center justify-center flex-shrink-0 overflow-hidden ${erp.logoBase64 ? "bg-[var(--color-surface)] border border-[var(--color-border)]" : `${erp.gradient}`}`}>
                    {erp.logoBase64 ? (
                      <img src={erp.logoBase64} alt={erp.name} className="w-full h-full object-contain p-1.5" data-testid={`img-erp-logo-${erp.id}`} />
                    ) : (
                      <span className="text-white text-xl font-bold">{erp.name[0].toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex gap-1 ml-2">
                    <button className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center text-[var(--color-muted)] hover:text-foreground" onClick={() => openEditErp(erp)} data-testid={`button-edit-erp-${erp.id}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button className="w-7 h-7 rounded-md hover:bg-[var(--color-danger-bg)] dark:hover:bg-red-950 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-danger)]" onClick={() => { if (confirm(`Remover "${erp.name}"?`)) deleteErpMutation.mutate(erp.id); }} data-testid={`button-delete-erp-${erp.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <h3 className="font-semibold text-sm leading-tight" data-testid={`text-erp-name-${erp.id}`}>{erp.name}</h3>
                {erp.description && <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-tight" data-testid={`text-erp-desc-${erp.id}`}>{erp.description}</p>}
                <div className="flex items-center justify-between mt-3 pt-3 border-t">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono" data-testid={`text-erp-key-${erp.id}`}>{erp.key}</code>
                  <button onClick={() => toggleErpActiveMutation.mutate({ id: erp.id, active: !erp.active })} data-testid={`toggle-erp-status-${erp.id}`}>
                    {erp.active
                      ? <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 text-xs h-5 cursor-pointer hover:opacity-80">Ativo</Badge>
                      : <Badge className="bg-slate-100 text-[var(--color-muted)] dark:bg-slate-800 dark:text-[var(--color-muted)] text-xs h-5 cursor-pointer hover:opacity-80">Inativo</Badge>
                    }
                  </button>
                </div>
              </div>
            </Card>
          ))}
          {erpCatalogList.length === 0 && (
            <div className="col-span-full text-center py-12 text-[var(--color-muted)]">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nenhum ERP cadastrado ainda.</p>
              <p className="text-xs mt-1">Clique em "Novo ERP" para adicionar.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
