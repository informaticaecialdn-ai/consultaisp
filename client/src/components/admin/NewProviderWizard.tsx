import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Building2, Plus, Search, RefreshCw, CheckCircle, ChevronRight,
  Settings2, MapPin, Users, User, Crown, AlertTriangle,
} from "lucide-react";

function generateSubdomainSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
}

export default function NewProviderWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [, setSubdomainEdited] = useState(false);
  const [cnpjInput, setCnpjInput] = useState("");
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjData, setCnpjData] = useState<any>(null);
  const [form, setForm] = useState({
    name: "", tradeName: "", cnpj: "", subdomain: "", plan: "basic",
    contactEmail: "", contactPhone: "",
    addressZip: "", addressStreet: "", addressNumber: "",
    addressComplement: "", addressNeighborhood: "", addressCity: "", addressState: "",
    legalType: "", openingDate: "", businessSegment: "",
    adminName: "", adminEmail: "", adminPassword: "",
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/admin/providers", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Provedor criado com sucesso!" });
      onOpenChange(false);
      resetForm();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setStep(1);
    setCnpjInput("");
    setCnpjData(null);
    setSubdomainEdited(false);
    setForm({
      name: "", tradeName: "", cnpj: "", subdomain: "", plan: "basic",
      contactEmail: "", contactPhone: "", addressZip: "", addressStreet: "",
      addressNumber: "", addressComplement: "", addressNeighborhood: "",
      addressCity: "", addressState: "", legalType: "", openingDate: "",
      businessSegment: "", adminName: "", adminEmail: "", adminPassword: "",
    });
  };

  const formatCnpj = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
    if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  };

  const lookupCnpj = async () => {
    const clean = cnpjInput.replace(/\D/g, "");
    if (clean.length !== 14) { toast({ title: "CNPJ deve ter 14 digitos", variant: "destructive" }); return; }
    setCnpjLoading(true);
    try {
      const res = await apiRequest("GET", `/api/admin/cnpj/${clean}`);
      if (!res.ok) throw new Error((await res.json()).message);
      const data = await res.json();
      setCnpjData(data);
      const slug = generateSubdomainSlug(data.nomeFantasia || data.razaoSocial);
      setForm(p => ({
        ...p,
        name: data.razaoSocial, tradeName: data.nomeFantasia, cnpj: clean,
        subdomain: slug, contactEmail: data.email, contactPhone: data.telefone,
        addressZip: data.cep, addressStreet: data.logradouro, addressNumber: data.numero,
        addressComplement: data.complemento, addressNeighborhood: data.bairro,
        addressCity: data.cidade, addressState: data.uf,
        legalType: data.naturezaJuridica, openingDate: data.dataAbertura,
        businessSegment: data.atividadePrincipal,
      }));
      setStep(2);
    } catch (e: any) {
      toast({ title: "Erro ao consultar CNPJ", description: e.message, variant: "destructive" });
    } finally { setCnpjLoading(false); }
  };

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const handleSubdomainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSubdomainEdited(true);
    setForm(p => ({ ...p, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30) }));
  };

  const canProceedStep2 = form.name && form.cnpj && form.subdomain;
  const canProceedStep3 = form.adminName && form.adminEmail && form.adminPassword.length >= 6;

  const stepLabels = ["CNPJ", "Dados da Empresa", "Administrador"];

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-violet-500" />
            Novo Provedor
          </DialogTitle>
          <DialogDescription>
            Cadastre um novo provedor em 3 passos
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 py-2">
          {stepLabels.map((label, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step > i + 1 ? "bg-emerald-500 text-white" : step === i + 1 ? "bg-violet-600 text-white" : "bg-muted text-[var(--color-muted)]"
              }`}>
                {step > i + 1 ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-xs font-medium ${step === i + 1 ? "text-foreground" : "text-[var(--color-muted)]"}`}>{label}</span>
              {i < 2 && <div className={`flex-1 h-0.5 ${step > i + 1 ? "bg-emerald-500" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        {/* Step 1: CNPJ Lookup */}
        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="text-center space-y-2 py-4">
              <Search className="w-10 h-10 mx-auto text-violet-500" />
              <p className="text-sm text-[var(--color-muted)]">Digite o CNPJ para buscar os dados automaticamente</p>
            </div>
            <div className="flex gap-2 max-w-md mx-auto">
              <Input
                placeholder="00.000.000/0000-00"
                value={cnpjInput}
                onChange={(e) => setCnpjInput(formatCnpj(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && lookupCnpj()}
                className="text-center text-lg font-mono tracking-wider"
                autoFocus
              />
              <Button onClick={lookupCnpj} disabled={cnpjLoading} className="gap-2 px-6">
                {cnpjLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Buscar
              </Button>
            </div>
            <p className="text-xs text-[var(--color-muted)] text-center">
              Dados puxados da Receita Federal via BrasilAPI
            </p>
          </div>
        )}

        {/* Step 2: Company Data (auto-filled) */}
        {step === 2 && (
          <div className="space-y-4 py-2">
            {cnpjData?.situacao && cnpjData.situacao !== "ATIVA" && (
              <div className="flex items-center gap-2 bg-[var(--color-gold-bg)] dark:bg-amber-950/30 text-[var(--color-gold)] dark:text-amber-400 rounded px-3 py-2 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                Situacao cadastral: <strong>{cnpjData.situacao}</strong>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium mb-1 block">Razao Social</label>
                <Input value={form.name} onChange={f("name")} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Nome Fantasia</label>
                <Input value={form.tradeName} onChange={f("tradeName")} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">CNPJ</label>
                <Input value={formatCnpj(form.cnpj)} disabled className="bg-muted font-mono" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Telefone</label>
                <Input value={form.contactPhone} onChange={f("contactPhone")} placeholder="(00) 0000-0000" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Email</label>
                <Input value={form.contactEmail} onChange={f("contactEmail")} placeholder="contato@provedor.com" />
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <MapPin className="w-3 h-3" /> Endereço
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">CEP</label>
                  <Input value={form.addressZip} onChange={f("addressZip")} className="font-mono" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium mb-1 block">Logradouro</label>
                  <Input value={form.addressStreet} onChange={f("addressStreet")} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Numero</label>
                  <Input value={form.addressNumber} onChange={f("addressNumber")} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Complemento</label>
                  <Input value={form.addressComplement} onChange={f("addressComplement")} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Bairro</label>
                  <Input value={form.addressNeighborhood} onChange={f("addressNeighborhood")} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Cidade</label>
                  <Input value={form.addressCity} onChange={f("addressCity")} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">UF</label>
                  <Input value={form.addressState} onChange={f("addressState")} maxLength={2} className="uppercase" />
                </div>
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Settings2 className="w-3 h-3" /> Configuracao
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">Subdominio</label>
                  <div className="flex items-center gap-1">
                    <Input value={form.subdomain} onChange={handleSubdomainChange} className="font-mono text-sm" />
                    <span className="text-xs text-[var(--color-muted)] whitespace-nowrap">.consultaisp.com.br</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Plano Inicial</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={form.plan} onChange={f("plan")}>
                    <option value="free">Gratuito</option>
                    <option value="basic">Basico</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
              </div>
            </div>

            {cnpjData?.socios?.length > 0 && (
              <div className="border-t pt-3">
                <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Users className="w-3 h-3" /> Socios encontrados
                </p>
                <div className="space-y-1">
                  {cnpjData.socios.map((s: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-muted/40 rounded px-2 py-1.5">
                      <User className="w-3 h-3 text-[var(--color-muted)]" />
                      <span className="font-medium">{s.nome}</span>
                      <span className="text-[var(--color-muted)]">— {s.qualificacao}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Admin User */}
        {step === 3 && (
          <div className="space-y-4 py-2">
            <div className="text-center space-y-1 py-2">
              <Crown className="w-8 h-8 mx-auto text-amber-500" />
              <p className="text-sm font-medium">Administrador do Provedor</p>
              <p className="text-xs text-[var(--color-muted)]">Este usuario tera acesso total ao painel do provedor</p>
            </div>
            <div className="max-w-md mx-auto space-y-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Nome completo</label>
                <Input value={form.adminName} onChange={f("adminName")} placeholder="Nome do administrador" autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Email</label>
                <Input type="email" value={form.adminEmail} onChange={f("adminEmail")} placeholder="admin@provedor.com" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Senha</label>
                <Input type="password" value={form.adminPassword} onChange={f("adminPassword")} placeholder="Minimo 6 caracteres" />
                {form.adminPassword.length > 0 && form.adminPassword.length < 6 && (
                  <p className="text-xs text-red-500 mt-0.5">Senha deve ter no minimo 6 caracteres</p>
                )}
              </div>
            </div>

            {/* Summary */}
            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">Resumo</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs bg-muted/40 rounded p-3">
                <div><span className="text-[var(--color-muted)]">Empresa:</span> {form.tradeName || form.name}</div>
                <div><span className="text-[var(--color-muted)]">CNPJ:</span> {formatCnpj(form.cnpj)}</div>
                <div><span className="text-[var(--color-muted)]">Subdominio:</span> <span className="font-mono">{form.subdomain}.consultaisp.com.br</span></div>
                <div><span className="text-[var(--color-muted)]">Plano:</span> {form.plan}</div>
                <div><span className="text-[var(--color-muted)]">Cidade:</span> {form.addressCity}/{form.addressState}</div>
                <div><span className="text-[var(--color-muted)]">Telefone:</span> {form.contactPhone || "—"}</div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="gap-2 sm:gap-0">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(s => s - 1)} className="gap-1">
              Voltar
            </Button>
          )}
          <div className="flex-1" />
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={!canProceedStep2} className="gap-1">
              Proximo <ChevronRight className="w-4 h-4" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={() => mutation.mutate(form)} disabled={!canProceedStep3 || mutation.isPending} className="gap-2">
              {mutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Criar Provedor
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
