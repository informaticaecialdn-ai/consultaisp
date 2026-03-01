import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Building2, Globe, Users, CreditCard, Settings, Copy, CheckCircle,
  ExternalLink, Plus, Trash2, Shield, User, Mail, Phone, Link2,
  BarChart3, Search, AlertTriangle, Wifi, Save, RefreshCw, Crown,
  Lock, Star, FileText, Upload, Download, Eye, MapPin, Calendar,
  Briefcase, X, Pencil, ClipboardList, UserCheck, Wand2, Info,
  EyeOff, Key, Zap, Terminal, ArrowRight, Database, CheckCheck, Clock, Settings2
} from "lucide-react";

const MAIN_DOMAIN = "consultaisp.com.br";

const PLAN_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  free:       { label: "Gratuito",    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", icon: Star },
  basic:      { label: "Basico",      color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", icon: Star },
  pro:        { label: "Profissional",color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300", icon: Crown },
  enterprise: { label: "Enterprise",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300", icon: Crown },
};

const LEGAL_TYPES = ["MEI", "ME", "EPP", "LTDA", "S/A", "EIRELI", "Outro"];
const SEGMENTS = ["ISP / Provedor de Internet", "Telecom", "Data Center", "TV por Assinatura", "Outro"];

const DOCUMENT_TYPES: Record<string, string> = {
  contrato_social: "Contrato Social",
  rg_socio: "RG dos Socios",
  cnh_socio: "CNH dos Socios",
  comprovante_endereco: "Comprovante de Endereco",
  cartao_cnpj: "Cartao CNPJ",
  outro: "Outro Documento",
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:  { label: "Pendente",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  approved: { label: "Aprovado",  color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
  rejected: { label: "Rejeitado", color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
};

const KYC_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending:  { label: "Verificacao Pendente", color: "bg-amber-100 text-amber-700 border-amber-200", icon: ClipboardList },
  approved: { label: "Verificado",           color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: UserCheck },
  rejected: { label: "Verificacao Rejeitada",color: "bg-red-100 text-red-700 border-red-200", icon: X },
};

const ERP_LIST = [
  { key: "ixc",      name: "iXC Soft",    desc: "iXC Provedor",   grad: "from-blue-500 to-blue-600",    authType: "basic",  authHint: "Usuario: login do iXC | Token: token da API iXC" },
  { key: "sgp",      name: "SGP",          desc: "Solucao Gestao", grad: "from-purple-500 to-purple-600", authType: "bearer", authHint: "Token: chave de API do SGP" },
  { key: "mk",       name: "MK Solutions", desc: "MK-AUTH/ERP",    grad: "from-green-500 to-green-600",   authType: "bearer", authHint: "Token: Bearer token do MK Solutions" },
  { key: "tiacos",   name: "Tiacos",       desc: "Tiacos ISP",     grad: "from-orange-500 to-orange-600", authType: "bearer", authHint: "Token: chave de API do Tiacos" },
  { key: "hubsoft",  name: "Hubsoft",      desc: "Hubsoft ERP",    grad: "from-indigo-500 to-indigo-600", authType: "bearer", authHint: "Token: chave de API do Hubsoft" },
  { key: "flyspeed", name: "Fly Speed",    desc: "Fly Speed ISP",  grad: "from-cyan-500 to-cyan-600",     authType: "bearer", authHint: "Token: chave de API do Fly Speed" },
  { key: "netflash", name: "Netflash",     desc: "Netflash ISP",   grad: "from-rose-500 to-pink-600",     authType: "bearer", authHint: "Token: chave de API do Netflash" },
];

function relDate(d: string | null): string {
  if (!d) return "Nunca";
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (diff < 60) return `${diff}min`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h`;
  return `${Math.floor(diff / 1440)}d atras`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleCopy} data-testid="button-copy-subdomain">
      {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function PainelProvedorPage() {
  const { user, provider } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [location] = useLocation();
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get("tab") || "visao-geral");

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab) setActiveTab(tab);
  }, [location]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "user" });
  const [showToken, setShowToken] = useState(false);

  const { data: profileData, isLoading: profileLoading } = useQuery<any>({
    queryKey: ["/api/provider/profile"],
  });

  const { data: integrationData, refetch: refetchIntegration } = useQuery<any>({
    queryKey: ["/api/provider/integration"],
    enabled: activeTab === "integracao",
  });

  const { data: erpIntegrationsList = [], refetch: refetchErpList } = useQuery<any[]>({
    queryKey: ["/api/provider/erp-integrations"],
    enabled: activeTab === "integracao",
  });

  const { data: syncLogs = [], refetch: refetchSyncLogs } = useQuery<any[]>({
    queryKey: ["/api/provider/erp-sync-logs"],
    enabled: activeTab === "integracao",
  });

  const toggleErpMutation = useMutation({
    mutationFn: ({ source, isEnabled }: { source: string; isEnabled: boolean }) =>
      apiRequest("PATCH", `/api/provider/erp-integrations/${source}`, { isEnabled }),
    onSuccess: () => { refetchErpList(); },
    onError: () => toast({ title: "Erro", description: "Nao foi possivel atualizar a integracao.", variant: "destructive" }),
  });

  const saveErpConfigMutation = useMutation({
    mutationFn: ({ source, data }: { source: string; data: any }) =>
      apiRequest("PATCH", `/api/provider/erp-integrations/${source}`, data),
    onSuccess: () => {
      refetchErpList();
      toast({ title: "Configuracao salva", description: "Credenciais atualizadas com sucesso." });
    },
    onError: () => toast({ title: "Erro", description: "Nao foi possivel salvar as credenciais.", variant: "destructive" }),
  });

  const [erpTestResults, setErpTestResults] = useState<Record<string, { ok: boolean; msg: string } | null>>({});
  const [erpSyncResults, setErpSyncResults] = useState<Record<string, { ok: boolean; msg: string } | null>>({});
  const [erpPending, setErpPending] = useState<Record<string, { testing?: boolean; syncing?: boolean; saving?: boolean }>>({});
  const [expandedErp, setExpandedErp] = useState<string | null>(null);
  const [erpForms, setErpForms] = useState<Record<string, { apiUrl: string; apiUser: string; apiToken: string; showToken: boolean }>>({});

  const getErpForm = (key: string) => {
    if (erpForms[key]) return erpForms[key];
    const intg = getIntg(key);
    return { apiUrl: intg?.apiUrl || "", apiUser: intg?.apiUser || "", apiToken: intg?.apiToken || "", showToken: false };
  };

  const testConnection = async (source: string) => {
    setErpPending(p => ({ ...p, [source]: { ...p[source], testing: true } }));
    setErpTestResults(r => ({ ...r, [source]: null }));
    try {
      const res = await fetch(`/api/provider/erp-integrations/${source}/test`, { method: "POST" });
      const data = await res.json();
      setErpTestResults(r => ({ ...r, [source]: { ok: data.ok, msg: data.message } }));
    } catch {
      setErpTestResults(r => ({ ...r, [source]: { ok: false, msg: "Erro de conexao" } }));
    } finally {
      setErpPending(p => ({ ...p, [source]: { ...p[source], testing: false } }));
    }
  };

  const syncNow = async (source: string) => {
    setErpPending(p => ({ ...p, [source]: { ...p[source], syncing: true } }));
    setErpSyncResults(r => ({ ...r, [source]: null }));
    try {
      const res = await fetch(`/api/provider/erp-integrations/${source}/sync`, { method: "POST" });
      const data = await res.json();
      setErpSyncResults(r => ({ ...r, [source]: { ok: data.ok, msg: data.ok ? `${data.synced} registros sincronizados (${data.total} processados)` : data.message } }));
      refetchErpList();
      refetchSyncLogs();
    } catch {
      setErpSyncResults(r => ({ ...r, [source]: { ok: false, msg: "Erro ao sincronizar" } }));
    } finally {
      setErpPending(p => ({ ...p, [source]: { ...p[source], syncing: false } }));
    }
  };

  const [empresa, setEmpresa] = useState<any>(null);
  const profileRef = profileData;

  const getEmpresa = () => empresa ?? {
    name: profileData?.name || "",
    tradeName: profileData?.tradeName || "",
    cnpj: profileData?.cnpj || "",
    legalType: profileData?.legalType || "",
    openingDate: profileData?.openingDate || "",
    businessSegment: profileData?.businessSegment || "",
    contactEmail: profileData?.contactEmail || "",
    contactPhone: profileData?.contactPhone || "",
    website: profileData?.website || "",
    addressZip: profileData?.addressZip || "",
    addressStreet: profileData?.addressStreet || "",
    addressNumber: profileData?.addressNumber || "",
    addressComplement: profileData?.addressComplement || "",
    addressNeighborhood: profileData?.addressNeighborhood || "",
    addressCity: profileData?.addressCity || "",
    addressState: profileData?.addressState || "",
  };

  const [cnpjLookupStatus, setCnpjLookupStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [importedQsa, setImportedQsa] = useState<any[]>([]);
  const [showQsaImport, setShowQsaImport] = useState(false);

  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [editingPartner, setEditingPartner] = useState<any>(null);
  const [partnerForm, setPartnerForm] = useState({ name: "", cpf: "", birthDate: "", email: "", phone: "", role: "", sharePercentage: "" });

  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docType, setDocType] = useState("contrato_social");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const subdomainUrl = provider?.subdomain ? `https://${provider.subdomain}.${MAIN_DOMAIN}` : null;

  const { data: providerUsers = [], isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ["/api/provider/users"],
  });
  const { data: dashStats } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: ispConsultations = [] } = useQuery<any[]>({ queryKey: ["/api/isp-consultations"] });
  const { data: spcConsultations = [] } = useQuery<any[]>({ queryKey: ["/api/spc-consultations"] });

  const partners: any[] = profileData?.partners || [];
  const documents: any[] = profileData?.documents || [];

  const savePerfil = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", "/api/provider/profile", data);
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/profile"] });
      qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setEmpresa(null);
      toast({ title: "Dados salvos", description: "Informacoes da empresa atualizadas com sucesso." });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const addPartner = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/provider/partners", data);
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/profile"] });
      setShowPartnerForm(false);
      setPartnerForm({ name: "", cpf: "", birthDate: "", email: "", phone: "", role: "", sharePercentage: "" });
      toast({ title: "Socio adicionado" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const updatePartner = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/provider/partners/${id}`, data);
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/profile"] });
      setEditingPartner(null);
      setShowPartnerForm(false);
      setPartnerForm({ name: "", cpf: "", birthDate: "", email: "", phone: "", role: "", sharePercentage: "" });
      toast({ title: "Socio atualizado" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deletePartner = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/provider/partners/${id}`, undefined);
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/profile"] });
      toast({ title: "Socio removido" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteDocument = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/provider/documents/${id}`, undefined);
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/profile"] });
      toast({ title: "Documento removido" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const addUserMutation = useMutation({
    mutationFn: async (data: typeof newUser) => {
      const res = await apiRequest("POST", "/api/provider/users", data);
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/users"] });
      setNewUser({ name: "", email: "", password: "", role: "user" });
      setShowAddUser(false);
      toast({ title: "Usuario criado" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiRequest("DELETE", `/api/provider/users/${userId}`, undefined);
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/users"] });
      toast({ title: "Usuario removido" });
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Limite de 10 MB por documento.", variant: "destructive" });
      return;
    }
    setUploadingDoc(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const fileData = reader.result as string;
        const res = await apiRequest("POST", "/api/provider/documents", {
          documentType: docType,
          documentName: file.name,
          documentMimeType: file.type,
          documentSize: file.size,
          fileData,
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message);
        }
        qc.invalidateQueries({ queryKey: ["/api/provider/profile"] });
        toast({ title: "Documento enviado", description: `${file.name} enviado com sucesso.` });
        setUploadingDoc(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      };
      reader.onerror = () => { setUploadingDoc(false); toast({ title: "Erro ao ler arquivo", variant: "destructive" }); };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setUploadingDoc(false);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const openEditPartner = (p: any) => {
    setEditingPartner(p);
    setPartnerForm({ name: p.name, cpf: p.cpf, birthDate: p.birthDate || "", email: p.email || "", phone: p.phone || "", role: p.role || "", sharePercentage: p.sharePercentage || "" });
    setShowPartnerForm(true);
  };

  const handleSavePartner = () => {
    if (editingPartner) {
      updatePartner.mutate({ id: editingPartner.id, data: partnerForm });
    } else {
      addPartner.mutate(partnerForm);
    }
  };

  const handleCnpjLookup = async () => {
    const digits = (provider?.cnpj || "").replace(/\D/g, "");
    if (digits.length !== 14) {
      toast({ title: "CNPJ invalido", description: "O CNPJ do provedor nao tem 14 digitos.", variant: "destructive" });
      return;
    }
    setCnpjLookupStatus("loading");
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!res.ok) throw new Error("CNPJ nao encontrado");
      const data = await res.json();

      const streetPrefix = data.descricao_tipo_logradouro ? `${data.descricao_tipo_logradouro} ` : "";
      const street = data.logradouro ? `${streetPrefix}${data.logradouro}`.trim() : "";

      const naturalezaToLegal: Record<string, string> = {
        "Empresario Individual": "MEI",
        "Microempresario Individual (MEI)": "MEI",
        "Empresa Individual de Responsabilidade Limitada (EIRELI)": "EIRELI",
        "Sociedade Limitada": "LTDA",
        "Sociedade Anonima Aberta": "S/A",
        "Sociedade Anonima Fechada": "S/A",
      };
      const legalGuess = naturalezaToLegal[data.natureza_juridica || ""] || "";

      const phoneRaw = data.ddd_telefone_1 || data.ddd_telefone_2 || "";
      const phone = phoneRaw.replace(/\s+/g, " ").trim();

      const openingRaw = data.data_inicio_atividade || "";

      setEmpresa({
        ...getEmpresa(),
        name: data.razao_social || getEmpresa().name,
        tradeName: data.nome_fantasia || getEmpresa().tradeName,
        legalType: legalGuess || getEmpresa().legalType,
        openingDate: openingRaw || getEmpresa().openingDate,
        contactPhone: phone || getEmpresa().contactPhone,
        contactEmail: data.email || getEmpresa().contactEmail,
        addressZip: data.cep?.replace(/\D/g, "") || getEmpresa().addressZip,
        addressStreet: street || getEmpresa().addressStreet,
        addressNumber: data.numero || getEmpresa().addressNumber,
        addressComplement: (data.complemento && data.complemento !== ".") ? data.complemento : getEmpresa().addressComplement,
        addressNeighborhood: data.bairro || getEmpresa().addressNeighborhood,
        addressCity: data.municipio || getEmpresa().addressCity,
        addressState: data.uf || getEmpresa().addressState,
      });

      const qsa = Array.isArray(data.qsa) ? data.qsa : [];
      if (qsa.length > 0) {
        setImportedQsa(qsa.map((s: any) => ({
          name: s.nome_socio || "",
          cpf: s.cpf_representante_legal || "",
          role: s.qualificacao_socio || "",
          email: "",
          phone: "",
          birthDate: "",
          sharePercentage: "",
        })));
        setShowQsaImport(true);
      }

      setCnpjLookupStatus("done");
      toast({ title: "Dados importados", description: "Informacoes preenchidas automaticamente via Receita Federal." });
    } catch (err: any) {
      setCnpjLookupStatus("error");
      toast({ title: "Erro na consulta", description: "CNPJ nao encontrado ou servico indisponivel.", variant: "destructive" });
    }
  };

  const handleCepLookup = async (cep: string) => {
    const clean = cep.replace(/\D/g, "");
    if (clean.length !== 8) return;
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await resp.json();
      if (!data.erro) {
        setEmpresa((prev: any) => ({
          ...(prev ?? getEmpresa()),
          addressStreet: data.logradouro || "",
          addressNeighborhood: data.bairro || "",
          addressCity: data.localidade || "",
          addressState: data.uf || "",
        }));
      }
    } catch {}
  };

  const planInfo = PLAN_LABELS[provider?.plan || "free"] || PLAN_LABELS.free;
  const PlanIcon = planInfo.icon;
  const kycStatus = profileData?.verificationStatus || "pending";
  const kycConfig = KYC_CONFIG[kycStatus] || KYC_CONFIG.pending;
  const KycIcon = kycConfig.icon;

  const erpTotalEnabled = erpIntegrationsList.filter((i: any) => i.isEnabled).length;
  const erpTotalSynced  = erpIntegrationsList.reduce((s: number, i: any) => s + (i.totalSynced ?? 0), 0);
  const erpTotalErrors  = erpIntegrationsList.reduce((s: number, i: any) => s + (i.totalErrors ?? 0), 0);
  const erpLastSync     = erpIntegrationsList.reduce((latest: string | null, i: any) => {
    if (!i.lastSyncAt) return latest;
    return !latest || i.lastSyncAt > latest ? i.lastSyncAt : latest;
  }, null as string | null);
  const getIntg = (key: string) => erpIntegrationsList.find((i: any) => i.erpSource === key);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" data-testid="painel-provedor-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold" data-testid="text-painel-title">{provider?.name}</h1>
              <Badge className={`text-xs gap-1 ${planInfo.color}`}>
                <PlanIcon className="w-3 h-3" />
                {planInfo.label}
              </Badge>
              <Badge className={`text-xs gap-1 border ${kycConfig.color}`}>
                <KycIcon className="w-3 h-3" />
                {kycConfig.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">Painel Administrativo do Provedor</p>
          </div>
        </div>
        {subdomainUrl && (
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 border">
            <Globe className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span className="text-sm font-mono text-blue-700 dark:text-blue-400" data-testid="text-subdomain-url">
              {provider?.subdomain}.{MAIN_DOMAIN}
            </span>
            <CopyButton text={subdomainUrl} />
            <a href={subdomainUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-foreground" />
            </a>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="visao-geral" className="gap-1.5" data-testid="tab-visao-geral">
            <BarChart3 className="w-3.5 h-3.5" />Visao Geral
          </TabsTrigger>
          <TabsTrigger value="empresa" className="gap-1.5" data-testid="tab-empresa">
            <Building2 className="w-3.5 h-3.5" />Empresa
          </TabsTrigger>
          <TabsTrigger value="socios" className="gap-1.5" data-testid="tab-socios">
            <UserCheck className="w-3.5 h-3.5" />Socios
          </TabsTrigger>
          <TabsTrigger value="documentos" className="gap-1.5" data-testid="tab-documentos">
            <FileText className="w-3.5 h-3.5" />Documentos
          </TabsTrigger>
          <TabsTrigger value="subdominio" className="gap-1.5" data-testid="tab-subdominio">
            <Globe className="w-3.5 h-3.5" />Subdominio
          </TabsTrigger>
          <TabsTrigger value="usuarios" className="gap-1.5" data-testid="tab-usuarios">
            <Users className="w-3.5 h-3.5" />Usuarios
          </TabsTrigger>
          <TabsTrigger value="creditos" className="gap-1.5" data-testid="tab-creditos">
            <CreditCard className="w-3.5 h-3.5" />Creditos
          </TabsTrigger>
          <TabsTrigger value="integracao" className="gap-1.5" data-testid="tab-integracao">
            <Zap className="w-3.5 h-3.5" />Integracao
          </TabsTrigger>
        </TabsList>

        {/* ======================== VISAO GERAL ======================== */}
        <TabsContent value="visao-geral" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Clientes", value: dashStats?.totalCustomers ?? "-", icon: Users, color: "bg-blue-500" },
              { label: "Inadimplentes", value: dashStats?.defaulters ?? "-", icon: AlertTriangle, color: "bg-red-500" },
              { label: "Consultas ISP", value: ispConsultations.length, icon: Search, color: "bg-indigo-500" },
              { label: "Consultas SPC", value: spcConsultations.length, icon: BarChart3, color: "bg-purple-500" },
            ].map((s) => (
              <Card key={s.label} className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}>
                    <s.icon className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-lg font-bold" data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4" />Informacoes do Plano
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Plano atual</span>
                  <Badge className={planInfo.color}>{planInfo.label}</Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge className={provider?.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                    {provider?.status === "active" ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Verificacao KYC</span>
                  <Badge className={`border ${kycConfig.color}`}>{kycConfig.label}</Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Creditos ISP</span>
                  <span className="font-semibold" data-testid="text-isp-credits">{provider?.ispCredits ?? 0}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-muted-foreground">Creditos SPC</span>
                  <span className="font-semibold" data-testid="text-spc-credits">{provider?.spcCredits ?? 0}</span>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Building2 className="w-4 h-4" />Dados Cadastrais
              </h3>
              {profileLoading ? (
                <div className="flex items-center justify-center py-6"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-2 text-sm">
                  {[
                    { label: "Razao Social", value: profileData?.name },
                    { label: "Nome Fantasia", value: profileData?.tradeName },
                    { label: "CNPJ", value: profileData?.cnpj },
                    { label: "Tipo", value: profileData?.legalType },
                    { label: "Cidade", value: profileData?.addressCity && profileData?.addressState ? `${profileData.addressCity} / ${profileData.addressState}` : null },
                    { label: "Socios", value: partners.length > 0 ? `${partners.length} socio(s) cadastrado(s)` : null },
                    { label: "Documentos", value: documents.length > 0 ? `${documents.length} doc(s) enviado(s)` : null },
                  ].filter(i => i.value).map(i => (
                    <div key={i.label} className="flex justify-between py-1 border-b last:border-0">
                      <span className="text-muted-foreground">{i.label}</span>
                      <span className="font-medium text-right">{i.value}</span>
                    </div>
                  ))}
                  {!profileData?.tradeName && !profileData?.legalType && (
                    <p className="text-muted-foreground text-xs pt-2">
                      Complete o cadastro na aba <button className="text-blue-600 underline" onClick={() => setActiveTab("empresa")}>Empresa</button>
                    </p>
                  )}
                </div>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" />Usuarios do Provedor
            </h3>
            <div className="space-y-2">
              {providerUsers.slice(0, 3).map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
                    {u.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {u.role === "admin" ? "Admin" : "Usuario"}
                  </Badge>
                </div>
              ))}
              {providerUsers.length > 3 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  +{providerUsers.length - 3} usuario(s).{" "}
                  <button className="text-blue-600" onClick={() => setActiveTab("usuarios")}>Ver todos</button>
                </p>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* ======================== EMPRESA ======================== */}
        <TabsContent value="empresa">
          {profileLoading ? (
            <div className="flex items-center justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-5">
              <Card className="p-4 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Wand2 className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-blue-900 dark:text-blue-200">Preenchimento Automatico via Receita Federal</p>
                      <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                        Clique em buscar para preencher os dados da empresa automaticamente usando o CNPJ:
                        <span className="font-mono font-bold ml-1">{provider?.cnpj}</span>
                      </p>
                    </div>
                  </div>
                  {user?.role === "admin" && (
                    <Button
                      size="sm"
                      className="gap-2 bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0"
                      onClick={handleCnpjLookup}
                      disabled={cnpjLookupStatus === "loading"}
                      data-testid="button-cnpj-lookup"
                    >
                      {cnpjLookupStatus === "loading"
                        ? <><RefreshCw className="w-4 h-4 animate-spin" />Buscando...</>
                        : <><Wand2 className="w-4 h-4" />Buscar dados pelo CNPJ</>
                      }
                    </Button>
                  )}
                </div>
                {cnpjLookupStatus === "done" && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle className="w-4 h-4" />
                    Dados preenchidos automaticamente. Revise e clique em "Salvar Dados" para confirmar.
                  </div>
                )}
                {cnpjLookupStatus === "error" && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                    <X className="w-4 h-4" />
                    Nao foi possivel consultar o CNPJ. Verifique a conexao e tente novamente.
                  </div>
                )}
              </Card>

              {showQsaImport && importedQsa.length > 0 && (
                <Card className="p-5 border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/20">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2 text-indigo-800 dark:text-indigo-300">
                      <UserCheck className="w-4 h-4" />
                      Socios encontrados na Receita Federal ({importedQsa.length})
                    </h3>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowQsaImport(false)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-indigo-700 dark:text-indigo-400 mb-3">
                    Os socios abaixo foram encontrados no Quadro de Socios e Administradores (QSA). Deseja importa-los?
                  </p>
                  <div className="space-y-2 mb-3">
                    {importedQsa.map((s, i) => (
                      <div key={i} className="flex items-center gap-3 bg-white dark:bg-indigo-900/30 rounded-lg px-3 py-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-800 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300">
                          {s.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200 truncate">{s.name}</p>
                          {s.role && <p className="text-xs text-indigo-600 dark:text-indigo-400">{s.role}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                      onClick={async () => {
                        let count = 0;
                        for (const s of importedQsa) {
                          if (!s.name) continue;
                          try {
                            const res = await apiRequest("POST", "/api/provider/partners", s);
                            if (res.ok) count++;
                          } catch {}
                        }
                        qc.invalidateQueries({ queryKey: ["/api/provider/profile"] });
                        setShowQsaImport(false);
                        setImportedQsa([]);
                        toast({ title: "Socios importados", description: `${count} socio(s) adicionado(s) com sucesso.` });
                      }}
                      data-testid="button-import-qsa"
                    >
                      <Plus className="w-4 h-4" />Importar Socios
                    </Button>
                    <Button size="sm" variant="ghost" className="text-indigo-700" onClick={() => { setShowQsaImport(false); setImportedQsa([]); }}>
                      Ignorar
                    </Button>
                  </div>
                </Card>
              )}

              <Card className="p-6">
                <h2 className="text-lg font-semibold mb-5 flex items-center gap-2">
                  <Building2 className="w-5 h-5" />Dados da Empresa
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Razao Social *</label>
                    <Input
                      value={getEmpresa().name}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), name: e.target.value })}
                      placeholder="Razao Social da Empresa"
                      data-testid="input-razao-social"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Nome Fantasia</label>
                    <Input
                      value={getEmpresa().tradeName}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), tradeName: e.target.value })}
                      placeholder="Nome comercial da empresa"
                      data-testid="input-trade-name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">CNPJ</label>
                    <Input value={provider?.cnpj || ""} readOnly className="bg-muted" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Tipo / Natureza Juridica</label>
                    <select
                      className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                      value={getEmpresa().legalType}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), legalType: e.target.value })}
                      data-testid="select-legal-type"
                    >
                      <option value="">Selecione...</option>
                      {LEGAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />Data de Abertura
                    </label>
                    <Input
                      type="date"
                      value={getEmpresa().openingDate}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), openingDate: e.target.value })}
                      data-testid="input-opening-date"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                      <Briefcase className="w-3.5 h-3.5" />Segmento de Atuacao
                    </label>
                    <select
                      className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                      value={getEmpresa().businessSegment}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), businessSegment: e.target.value })}
                      data-testid="select-segment"
                    >
                      <option value="">Selecione...</option>
                      {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                      <Mail className="w-3.5 h-3.5" />Email de Contato
                    </label>
                    <Input
                      type="email"
                      placeholder="contato@empresa.com.br"
                      value={getEmpresa().contactEmail}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), contactEmail: e.target.value })}
                      data-testid="input-contact-email"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" />Telefone de Contato
                    </label>
                    <Input
                      placeholder="(00) 0000-0000"
                      value={getEmpresa().contactPhone}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), contactPhone: e.target.value })}
                      data-testid="input-contact-phone"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                      <Link2 className="w-3.5 h-3.5" />Website
                    </label>
                    <Input
                      placeholder="https://seuprovedor.com.br"
                      value={getEmpresa().website}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), website: e.target.value })}
                      data-testid="input-website"
                    />
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <h2 className="text-lg font-semibold mb-5 flex items-center gap-2">
                  <MapPin className="w-5 h-5" />Endereco da Empresa
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">CEP</label>
                    <Input
                      placeholder="00000-000"
                      value={getEmpresa().addressZip}
                      onChange={(e) => {
                        setEmpresa({ ...getEmpresa(), addressZip: e.target.value });
                        handleCepLookup(e.target.value);
                      }}
                      data-testid="input-cep"
                    />
                  </div>
                  <div className="md:col-span-1">
                    <label className="text-sm font-medium mb-1.5 block">Logradouro</label>
                    <Input
                      placeholder="Rua, Avenida..."
                      value={getEmpresa().addressStreet}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), addressStreet: e.target.value })}
                      data-testid="input-street"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Numero</label>
                    <Input
                      placeholder="123"
                      value={getEmpresa().addressNumber}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), addressNumber: e.target.value })}
                      data-testid="input-number"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Complemento</label>
                    <Input
                      placeholder="Sala, Andar..."
                      value={getEmpresa().addressComplement}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), addressComplement: e.target.value })}
                      data-testid="input-complement"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Bairro</label>
                    <Input
                      placeholder="Bairro"
                      value={getEmpresa().addressNeighborhood}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), addressNeighborhood: e.target.value })}
                      data-testid="input-neighborhood"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Cidade</label>
                    <Input
                      placeholder="Cidade"
                      value={getEmpresa().addressCity}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), addressCity: e.target.value })}
                      data-testid="input-city"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Estado (UF)</label>
                    <Input
                      placeholder="UF"
                      maxLength={2}
                      value={getEmpresa().addressState}
                      onChange={(e) => setEmpresa({ ...getEmpresa(), addressState: e.target.value.toUpperCase() })}
                      data-testid="input-state"
                    />
                  </div>
                </div>
              </Card>

              {user?.role === "admin" && (
                <Button
                  onClick={() => savePerfil.mutate(getEmpresa())}
                  disabled={savePerfil.isPending}
                  className="gap-2"
                  data-testid="button-save-empresa"
                >
                  {savePerfil.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {savePerfil.isPending ? "Salvando..." : "Salvar Dados"}
                </Button>
              )}
            </div>
          )}
        </TabsContent>

        {/* ======================== SOCIOS ======================== */}
        <TabsContent value="socios">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <UserCheck className="w-5 h-5" />Socios e Responsaveis
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Cadastre os socios e responsaveis legais da empresa
                </p>
              </div>
              {user?.role === "admin" && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setEditingPartner(null);
                    setPartnerForm({ name: "", cpf: "", birthDate: "", email: "", phone: "", role: "", sharePercentage: "" });
                    setShowPartnerForm(!showPartnerForm);
                  }}
                  data-testid="button-add-partner"
                >
                  <Plus className="w-4 h-4" />Novo Socio
                </Button>
              )}
            </div>

            {showPartnerForm && (
              <div className="bg-muted/40 rounded-xl p-5 mb-5 border space-y-4">
                <h3 className="font-semibold text-sm">{editingPartner ? "Editar Socio" : "Adicionar Socio"}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Nome Completo *</label>
                    <Input placeholder="Nome do socio" value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} data-testid="input-partner-name" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">CPF *</label>
                    <Input placeholder="000.000.000-00" value={partnerForm.cpf} onChange={(e) => setPartnerForm({ ...partnerForm, cpf: e.target.value })} data-testid="input-partner-cpf" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Data de Nascimento</label>
                    <Input type="date" value={partnerForm.birthDate} onChange={(e) => setPartnerForm({ ...partnerForm, birthDate: e.target.value })} data-testid="input-partner-birthdate" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Cargo / Funcao</label>
                    <Input placeholder="Ex: Socio-Administrador" value={partnerForm.role} onChange={(e) => setPartnerForm({ ...partnerForm, role: e.target.value })} data-testid="input-partner-role" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Email</label>
                    <Input type="email" placeholder="email@socio.com" value={partnerForm.email} onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })} data-testid="input-partner-email" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Telefone</label>
                    <Input placeholder="(00) 00000-0000" value={partnerForm.phone} onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })} data-testid="input-partner-phone" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Participacao (%)</label>
                    <Input type="number" min="0" max="100" step="0.01" placeholder="0.00" value={partnerForm.sharePercentage} onChange={(e) => setPartnerForm({ ...partnerForm, sharePercentage: e.target.value })} data-testid="input-partner-share" />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={handleSavePartner} disabled={addPartner.isPending || updatePartner.isPending} data-testid="button-save-partner">
                    {(addPartner.isPending || updatePartner.isPending) ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                    {editingPartner ? "Atualizar" : "Adicionar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowPartnerForm(false); setEditingPartner(null); }}>Cancelar</Button>
                </div>
              </div>
            )}

            {partners.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <UserCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nenhum socio cadastrado.</p>
                {user?.role === "admin" && (
                  <button className="text-blue-600 text-sm mt-1 underline" onClick={() => setShowPartnerForm(true)}>Adicionar primeiro socio</button>
                )}
              </div>
            ) : (
              <div className="divide-y rounded-lg border overflow-hidden">
                {partners.map((p: any) => (
                  <div key={p.id} className="flex items-start gap-4 px-4 py-4 bg-background" data-testid={`partner-row-${p.id}`}>
                    <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-sm font-bold text-indigo-700 dark:text-indigo-300 flex-shrink-0">
                      {p.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{p.name}</p>
                        {p.role && <Badge variant="outline" className="text-xs">{p.role}</Badge>}
                        {p.sharePercentage && <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 text-xs">{p.sharePercentage}%</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">CPF: {p.cpf}</p>
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                        {p.birthDate && <span>Nascimento: {new Date(p.birthDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span>}
                        {p.email && <span>{p.email}</span>}
                        {p.phone && <span>{p.phone}</span>}
                      </div>
                    </div>
                    {user?.role === "admin" && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditPartner(p)} data-testid={`button-edit-partner-${p.id}`}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => { if (confirm(`Remover socio ${p.name}?`)) deletePartner.mutate(p.id); }}
                          data-testid={`button-delete-partner-${p.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ======================== DOCUMENTOS ======================== */}
        <TabsContent value="documentos">
          <div className="space-y-5">
            <Card className="p-6">
              <div className="flex items-start justify-between flex-wrap gap-4 mb-2">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <FileText className="w-5 h-5" />Documentos KYC
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Envie os documentos para verificacao e habilitacao completa da conta
                  </p>
                </div>
                <Badge className={`text-sm px-3 py-1 border gap-1.5 ${kycConfig.color}`}>
                  <KycIcon className="w-4 h-4" />
                  {kycConfig.label}
                </Badge>
              </div>

              <div className="grid md:grid-cols-3 gap-3 mb-6 mt-4">
                {Object.entries(DOCUMENT_TYPES).map(([type, label]) => {
                  const doc = documents.find((d: any) => d.documentType === type);
                  const statusCfg = doc ? (STATUS_CONFIG[doc.status] || STATUS_CONFIG.pending) : null;
                  return (
                    <div key={type} className={`rounded-lg border p-3 ${doc ? "border-solid" : "border-dashed border-muted-foreground/30"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium">{label}</p>
                        {doc && <Badge className={`text-xs ${statusCfg?.color}`}>{statusCfg?.label}</Badge>}
                      </div>
                      {doc ? (
                        <p className="text-xs text-muted-foreground truncate">{doc.documentName}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Nao enviado</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {user?.role === "admin" && (
              <Card className="p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Upload className="w-4 h-4" />Enviar Novo Documento
                </h3>
                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Tipo de Documento</label>
                    <select
                      className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                      data-testid="select-doc-type"
                    >
                      {Object.entries(DOCUMENT_TYPES).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Arquivo (max. 10MB)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        onChange={handleUploadFile}
                        className="hidden"
                        id="doc-upload-input"
                        data-testid="input-doc-upload"
                      />
                      <Button
                        variant="outline"
                        className="gap-2 w-full"
                        disabled={uploadingDoc}
                        onClick={() => fileInputRef.current?.click()}
                        data-testid="button-select-file"
                      >
                        {uploadingDoc ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploadingDoc ? "Enviando..." : "Selecionar Arquivo"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG, DOC, DOCX</p>
                  </div>
                </div>
              </Card>
            )}

            <Card className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />Documentos Enviados
              </h3>
              {documents.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Nenhum documento enviado ainda.</p>
                </div>
              ) : (
                <div className="divide-y rounded-lg border overflow-hidden">
                  {documents.map((doc: any) => {
                    const statusCfg = STATUS_CONFIG[doc.status] || STATUS_CONFIG.pending;
                    return (
                      <div key={doc.id} className="flex items-center gap-4 px-4 py-3 bg-background" data-testid={`doc-row-${doc.id}`}>
                        <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doc.documentName}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                            <span>{DOCUMENT_TYPES[doc.documentType] || doc.documentType}</span>
                            {doc.documentSize && <span>{formatFileSize(doc.documentSize)}</span>}
                            {doc.uploadedAt && <span>{new Date(doc.uploadedAt).toLocaleDateString("pt-BR")}</span>}
                          </div>
                          {doc.status === "rejected" && doc.rejectionReason && (
                            <p className="text-xs text-red-600 mt-1">Motivo: {doc.rejectionReason}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</Badge>
                          <a href={`/api/provider/documents/${doc.id}/download`} target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" data-testid={`button-download-doc-${doc.id}`}>
                              <Download className="w-4 h-4" />
                            </Button>
                          </a>
                          {user?.role === "admin" && doc.status === "pending" && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => { if (confirm(`Remover documento ${doc.documentName}?`)) deleteDocument.mutate(doc.id); }}
                              data-testid={`button-delete-doc-${doc.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* ======================== SUBDOMINIO ======================== */}
        <TabsContent value="subdominio">
          <div className="space-y-4">
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
                <Globe className="w-5 h-5" />Seu Subdominio no Consulta ISP
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                Este e o endereco exclusivo do seu provedor na plataforma Consulta ISP.
              </p>
              {provider?.subdomain ? (
                <>
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-xl p-5 border border-blue-100 dark:border-blue-900 mb-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Seu URL exclusivo</p>
                        <div className="flex items-center gap-2">
                          <Globe className="w-5 h-5 text-blue-600" />
                          <span className="text-xl font-bold font-mono text-blue-700 dark:text-blue-300" data-testid="text-full-subdomain">
                            {provider.subdomain}.{MAIN_DOMAIN}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <CopyButton text={`https://${provider.subdomain}.${MAIN_DOMAIN}`} />
                        <a href={`https://${provider.subdomain}.${MAIN_DOMAIN}`} target="_blank" rel="noopener noreferrer" data-testid="link-open-subdomain">
                          <Button variant="outline" size="sm" className="gap-1.5">
                            <ExternalLink className="w-4 h-4" />Abrir
                          </Button>
                        </a>
                      </div>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <Card className="p-4 border-dashed">
                      <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-500" />Como usar o subdominio
                      </h3>
                      <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
                        <li>Compartilhe o link com sua equipe</li>
                        <li>Faca login com suas credenciais normais</li>
                        <li>Acesse todas as funcionalidades do Consulta ISP</li>
                        <li>Seu ambiente e isolado dos outros provedores</li>
                      </ol>
                    </Card>
                    <Card className="p-4 border-dashed">
                      <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
                        <Lock className="w-4 h-4 text-blue-500" />Seguranca e Isolamento
                      </h3>
                      <ul className="space-y-1.5 text-sm text-muted-foreground">
                        <li>Seus dados sao isolados por tenant</li>
                        <li>Apenas usuarios do seu provedor tem acesso</li>
                        <li>Base de dados compartilhada para consultas ISP</li>
                        <li>Conformidade com LGPD garantida</li>
                      </ul>
                    </Card>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Nenhum subdominio configurado. Entre em contato com o suporte.</p>
                </div>
              )}
            </Card>
            <Card className="p-6 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900">
              <h3 className="font-semibold mb-2 flex items-center gap-2 text-amber-800 dark:text-amber-300">
                <Settings className="w-4 h-4" />DNS e Configuracao de Producao
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-400 mb-3">
                Para o subdominio funcionar em producao, o administrador do sistema deve configurar o DNS wildcard:
              </p>
              <div className="bg-white dark:bg-gray-900 rounded-lg p-3 space-y-2 text-xs font-mono">
                <div className="flex items-center gap-3 border-t pt-2">
                  <span className="w-16 font-bold text-blue-600">A</span>
                  <span className="w-24">*.consultaisp</span>
                  <span className="text-emerald-600">IP_DO_SERVIDOR</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-16 font-bold text-blue-600">CNAME</span>
                  <span className="w-24">www</span>
                  <span className="text-emerald-600">consultaisp.com.br</span>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ======================== USUARIOS ======================== */}
        <TabsContent value="usuarios">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5" />Usuarios do Provedor
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Gerencie quem tem acesso ao painel do {provider?.name}
                </p>
              </div>
              {user?.role === "admin" && (
                <Button size="sm" className="gap-1.5" onClick={() => setShowAddUser(!showAddUser)} data-testid="button-add-user">
                  <Plus className="w-4 h-4" />Novo Usuario
                </Button>
              )}
            </div>

            {showAddUser && (
              <div className="bg-muted/50 rounded-lg p-4 mb-5 space-y-3 border">
                <h3 className="font-medium text-sm">Adicionar Novo Usuario</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Nome</label>
                    <Input placeholder="Nome completo" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} data-testid="input-new-user-name" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Email</label>
                    <Input type="email" placeholder="email@provedor.com" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} data-testid="input-new-user-email" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Senha temporaria</label>
                    <Input type="password" placeholder="Min. 6 caracteres" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} data-testid="input-new-user-password" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Papel</label>
                    <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} data-testid="select-new-user-role">
                      <option value="user">Usuario</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => addUserMutation.mutate(newUser)} disabled={addUserMutation.isPending} data-testid="button-confirm-add-user">
                    {addUserMutation.isPending ? "Criando..." : "Criar Usuario"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddUser(false)}>Cancelar</Button>
                </div>
              </div>
            )}

            {usersLoading ? (
              <div className="flex items-center justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="divide-y rounded-lg border overflow-hidden">
                {providerUsers.map((u: any) => (
                  <div key={u.id} className="flex items-center gap-4 px-4 py-3 bg-background" data-testid={`user-row-${u.id}`}>
                    <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300 flex-shrink-0">
                      {u.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{u.name}</p>
                        {u.id === user?.id && <Badge variant="outline" className="text-xs px-1.5">Voce</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${u.role === "admin" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}>
                        {u.role === "admin" ? "Admin" : "Usuario"}
                      </Badge>
                      {u.emailVerified ? (
                        <CheckCircle className="w-4 h-4 text-emerald-500" title="Email verificado" />
                      ) : (
                        <Mail className="w-4 h-4 text-amber-500" title="Email pendente" />
                      )}
                      {user?.role === "admin" && u.id !== user?.id && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => { if (confirm(`Remover usuario ${u.name}?`)) deleteUserMutation.mutate(u.id); }}
                          data-testid={`button-delete-user-${u.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ======================== CREDITOS ======================== */}
        <TabsContent value="creditos">
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
                    <Search className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Creditos ISP</p>
                    <p className="text-3xl font-bold" data-testid="text-isp-credits-tab">{provider?.ispCredits ?? 0}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cada consulta ISP em outro provedor consome 1 credito. Consultas no proprio provedor sao gratuitas.
                </p>
              </Card>
              <Card className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500 flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Creditos SPC</p>
                    <p className="text-3xl font-bold" data-testid="text-spc-credits-tab">{provider?.spcCredits ?? 0}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cada consulta ao bureau SPC consome 1 credito SPC.
                </p>
              </Card>
            </div>
            <Card className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <CreditCard className="w-4 h-4" />Planos Disponiveis
              </h3>
              <div className="grid md:grid-cols-3 gap-4">
                {[
                  { plan: "Basico",       price: "R$ 199/mes", isp: 200,         spc: 50,           color: "border-blue-200",                               badge: "bg-blue-100 text-blue-700" },
                  { plan: "Profissional", price: "R$ 399/mes", isp: 1000,        spc: 200,          color: "border-purple-200 ring-2 ring-purple-300",       badge: "bg-purple-100 text-purple-700", highlight: true },
                  { plan: "Enterprise",  price: "R$ 799/mes", isp: "Ilimitado", spc: "Ilimitado",  color: "border-amber-200",                              badge: "bg-amber-100 text-amber-700" },
                ].map((p) => (
                  <div key={p.plan} className={`rounded-xl border p-4 relative ${p.color}`}>
                    {p.highlight && (
                      <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-purple-600 text-white text-xs">Popular</Badge>
                    )}
                    <p className="font-bold mb-1">{p.plan}</p>
                    <p className="text-2xl font-bold mb-3">{p.price}</p>
                    <ul className="space-y-1.5 text-sm text-muted-foreground mb-4">
                      <li>{p.isp} consultas ISP/mes</li>
                      <li>{p.spc} consultas SPC/mes</li>
                      <li>Subdominio personalizado</li>
                      <li>Suporte prioritario</li>
                    </ul>
                    <Button variant="outline" size="sm" className="w-full text-xs" data-testid={`button-plan-${p.plan.toLowerCase()}`}>
                      {provider?.plan === p.plan.toLowerCase() ? "Plano Atual" : "Assinar"}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ======================== INTEGRACAO ======================== */}
        <TabsContent value="integracao" className="space-y-4" data-testid="tab-content-integracao">
          <>
                {/* Header */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
                      <Zap className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="font-bold text-base leading-tight">Integracao com ERPs</h2>
                      <p className="text-xs text-muted-foreground">O sistema busca automaticamente os inadimplentes na API do seu ERP</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { refetchErpList(); refetchSyncLogs(); }} data-testid="button-refresh-integrations">
                    <RefreshCw className="w-3.5 h-3.5" />Atualizar
                  </Button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "ERPs Ativos",         value: erpTotalEnabled,                        icon: CheckCheck,    accent: "from-violet-500 to-indigo-500", bg: "bg-violet-100 dark:bg-violet-900/30", ic: "text-violet-600" },
                    { label: "Total Sincronizados",  value: erpTotalSynced.toLocaleString("pt-BR"), icon: Database,   accent: "from-emerald-500 to-green-500",  bg: "bg-emerald-100 dark:bg-emerald-900/30", ic: "text-emerald-600" },
                    { label: "Ultima Sincronizacao", value: relDate(erpLastSync),                   icon: Clock,      accent: "from-sky-500 to-blue-500",       bg: "bg-sky-100 dark:bg-sky-900/30", ic: "text-sky-600" },
                    { label: "Total de Erros",       value: erpTotalErrors.toLocaleString("pt-BR"), icon: AlertTriangle, accent: "from-rose-500 to-red-500", bg: "bg-rose-100 dark:bg-rose-900/30", ic: "text-rose-600" },
                  ].map(s => (
                    <Card key={s.label} className="relative overflow-hidden p-3">
                      <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${s.accent}`} />
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <div className={`w-6 h-6 rounded-md ${s.bg} flex items-center justify-center`}>
                          <s.icon className={`${s.ic}`} style={{ width: 13, height: 13 }} />
                        </div>
                      </div>
                      <p className="text-lg font-bold">{s.value}</p>
                    </Card>
                  ))}
                </div>

                {/* ERP Connection Cards */}
                <div className="space-y-3">
                  {ERP_LIST.map(erp => {
                    const intg = getIntg(erp.key);
                    const enabled = intg?.isEnabled ?? false;
                    const form = getErpForm(erp.key);
                    const isExpanded = expandedErp === erp.key;
                    const hasCredentials = !!(intg?.apiUrl && intg?.apiToken);
                    const status = intg?.lastSyncStatus ?? "idle";
                    const statusBadge = status === "success" ? "bg-emerald-100 text-emerald-700"
                      : status === "error" ? "bg-red-100 text-red-700"
                      : status === "partial" ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-500";
                    return (
                      <Card key={erp.key} className={`overflow-hidden transition-all ${enabled ? "border-violet-200" : ""}`} data-testid={`card-erp-${erp.key}`}>
                        {/* Card header row */}
                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${erp.grad} flex items-center justify-center flex-shrink-0`}>
                            <Wifi className="w-4 h-4 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold">{erp.name}</p>
                              <span className="text-xs text-muted-foreground">{erp.desc}</span>
                              {hasCredentials && <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${statusBadge}`}>{status === "success" ? "Sucesso" : status === "error" ? "Erro" : status === "partial" ? "Parcial" : "Aguardando"}</span>}
                            </div>
                            {intg?.lastSyncAt && (
                              <p className="text-xs text-muted-foreground">Ultima sync: {relDate(intg.lastSyncAt)} · {(intg.totalSynced ?? 0).toLocaleString("pt-BR")} registros</p>
                            )}
                            {!hasCredentials && <p className="text-xs text-amber-600">Credenciais nao configuradas</p>}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Button
                              variant="ghost" size="sm" className="h-7 text-xs gap-1"
                              onClick={() => setExpandedErp(isExpanded ? null : erp.key)}
                              data-testid={`button-config-${erp.key}`}
                            >
                              <Settings2 className="w-3.5 h-3.5" />{isExpanded ? "Fechar" : "Configurar"}
                            </Button>
                            <button
                              onClick={() => toggleErpMutation.mutate({ source: erp.key, isEnabled: !enabled })}
                              disabled={toggleErpMutation.isPending}
                              data-testid={`toggle-erp-${erp.key}`}
                              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none ${enabled ? "bg-violet-500" : "bg-gray-300 dark:bg-gray-600"}`}
                            >
                              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 m-0.5 ${enabled ? "translate-x-4" : "translate-x-0"}`} />
                            </button>
                          </div>
                        </div>
                        {/* Expandable form */}
                        {isExpanded && (
                          <div className="border-t px-4 py-4 bg-muted/20 space-y-3">
                            <p className="text-xs text-muted-foreground">{erp.authHint}</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="space-y-1 md:col-span-2">
                                <label className="text-xs font-medium">URL da API do ERP</label>
                                <Input
                                  value={form.apiUrl}
                                  onChange={e => setErpForms(f => ({ ...f, [erp.key]: { ...getErpForm(erp.key), apiUrl: e.target.value } }))}
                                  placeholder={erp.key === "ixc" ? "https://ixc.seudominio.com.br" : "https://erp.seudominio.com.br"}
                                  className="h-8 text-xs font-mono"
                                  data-testid={`input-api-url-${erp.key}`}
                                />
                              </div>
                              {erp.authType === "basic" && (
                                <div className="space-y-1">
                                  <label className="text-xs font-medium">Usuario</label>
                                  <Input
                                    value={form.apiUser}
                                    onChange={e => setErpForms(f => ({ ...f, [erp.key]: { ...getErpForm(erp.key), apiUser: e.target.value } }))}
                                    placeholder="usuario_api"
                                    className="h-8 text-xs"
                                    data-testid={`input-api-user-${erp.key}`}
                                  />
                                </div>
                              )}
                              <div className={`space-y-1 ${erp.authType === "basic" ? "" : "md:col-span-2"}`}>
                                <label className="text-xs font-medium">Token / Chave de API</label>
                                <div className="relative">
                                  <Input
                                    type={form.showToken ? "text" : "password"}
                                    value={form.apiToken}
                                    onChange={e => setErpForms(f => ({ ...f, [erp.key]: { ...getErpForm(erp.key), apiToken: e.target.value } }))}
                                    placeholder="Token de autenticacao"
                                    className="h-8 text-xs pr-8"
                                    data-testid={`input-api-token-${erp.key}`}
                                  />
                                  <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    onClick={() => setErpForms(f => ({ ...f, [erp.key]: { ...getErpForm(erp.key), showToken: !form.showToken } }))}
                                  >
                                    {form.showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2 pt-1">
                              <Button
                                size="sm" className="h-7 text-xs gap-1.5"
                                onClick={() => saveErpConfigMutation.mutate({ source: erp.key, data: { apiUrl: form.apiUrl, apiUser: form.apiUser, apiToken: form.apiToken } })}
                                disabled={saveErpConfigMutation.isPending || !form.apiUrl || !form.apiToken}
                                data-testid={`button-save-config-${erp.key}`}
                              >
                                {saveErpConfigMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                Salvar Credenciais
                              </Button>
                              <Button
                                size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                                onClick={() => testConnection(erp.key)}
                                disabled={erpPending[erp.key]?.testing || !hasCredentials}
                                data-testid={`button-test-connection-${erp.key}`}
                              >
                                {erpPending[erp.key]?.testing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                                Testar Conexao
                              </Button>
                              <Button
                                size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                                onClick={() => syncNow(erp.key)}
                                disabled={erpPending[erp.key]?.syncing || !hasCredentials || !enabled}
                                data-testid={`button-sync-now-${erp.key}`}
                              >
                                {erpPending[erp.key]?.syncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                Sincronizar Agora
                              </Button>
                            </div>
                            {erpTestResults[erp.key] && (
                              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${erpTestResults[erp.key]!.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`} data-testid={`result-test-${erp.key}`}>
                                {erpTestResults[erp.key]!.ok ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                                {erpTestResults[erp.key]!.msg}
                              </div>
                            )}
                            {erpSyncResults[erp.key] && (
                              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${erpSyncResults[erp.key]!.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`} data-testid={`result-sync-${erp.key}`}>
                                {erpSyncResults[erp.key]!.ok ? <Database className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                                {erpSyncResults[erp.key]!.msg}
                              </div>
                            )}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>

                {/* Sync Logs */}
                <Card className="overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b">
                    <h3 className="font-semibold text-sm flex items-center gap-2"><ClipboardList className="w-4 h-4 text-muted-foreground" />Historico de Sincronizacao</h3>
                    <span className="text-xs text-muted-foreground">{syncLogs.length} registros</span>
                  </div>
                  {syncLogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                      <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                        <Database className="w-6 h-6 text-muted-foreground/40" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">Nenhuma sincronizacao ainda</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Configure as credenciais do ERP e use "Sincronizar Agora" para ver os logs aqui.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                            <TableHead className="text-xs">ERP</TableHead>
                            <TableHead className="text-xs">Data/Hora</TableHead>
                            <TableHead className="text-xs text-right">Sincronizados</TableHead>
                            <TableHead className="text-xs text-right">Erros</TableHead>
                            <TableHead className="text-xs text-center">Status</TableHead>
                            <TableHead className="text-xs hidden md:table-cell">IP</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {syncLogs.slice(0, 20).map((log: any) => (
                            <TableRow key={log.id} className="hover:bg-muted/20" data-testid={`row-sync-log-${log.id}`}>
                              <TableCell>
                                <span className="text-xs font-semibold uppercase">{log.erpSource}</span>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {new Date(log.syncedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </TableCell>
                              <TableCell className="text-right">
                                <span className="text-xs font-semibold text-emerald-600">{log.upserted}</span>
                              </TableCell>
                              <TableCell className="text-right">
                                <span className={`text-xs font-semibold ${log.errors > 0 ? "text-rose-500" : "text-muted-foreground"}`}>{log.errors}</span>
                              </TableCell>
                              <TableCell className="text-center">
                                <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${
                                  log.status === "success" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20" :
                                  log.status === "error" ? "bg-red-100 text-red-700 dark:bg-red-900/20" :
                                  "bg-amber-100 text-amber-700 dark:bg-amber-900/20"
                                }`}>{log.status === "success" ? "Sucesso" : log.status === "error" ? "Erro" : "Parcial"}</span>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground hidden md:table-cell">{log.ipAddress ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
          </>
        </TabsContent>
      </Tabs>
    </div>
  );
}
