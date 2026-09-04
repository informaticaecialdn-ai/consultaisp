import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, STALE_DASHBOARD } from "@/lib/queryClient";
import { useState, useRef, useEffect } from "react";
import { CUSTO_EM_CREDITOS } from "@shared/schema";
import { usePrecos, precoCurto, linhaDeCreditosDoPlano } from "@/hooks/use-precos";
import { useLocation } from "wouter";
import { useMarca } from "@/lib/marca";
import {
  Building2, Globe, Users, CreditCard, Settings, Copy, CheckCircle,
  ExternalLink, Plus, Trash2, Shield, User, Mail, Phone, Link2,
  BarChart3, Search, AlertTriangle, Save, RefreshCw, Crown,
  Lock, Star, FileText, Upload, Download, MapPin, Calendar,
  Briefcase, X, Pencil, ClipboardList, UserCheck, Wand2, Info,
  Zap, Database, CheckCheck, Clock, Headset,
} from "lucide-react";
import { AbaAntiFraude } from "@/components/painel/AbaAntiFraude";
import { AbaSuporte } from "@/components/painel/AbaSuporte";
import { mensagemDoErro } from "@/components/recuperacao/DialogoContato";
import { rotuloDoPlano } from "@/lib/planos";
import { ERP_OPTIONS } from "@/components/admin/constants";

const MAIN_DOMAIN = "consultaisp.com.br";

const PLAN_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  free: { label: rotuloDoPlano("free"), color: "bg-[var(--color-tag-bg)] text-gray-700 dark:text-gray-300", icon: Star },
  pro: { label: rotuloDoPlano("pro"), color: "bg-[var(--color-brand-bg)] text-[var(--color-brand)] dark:bg-purple-900 dark:text-purple-300", icon: Crown },
  basic: { label: rotuloDoPlano("basic"), color: "bg-[var(--color-tag-bg)] text-gray-700 dark:text-gray-300", icon: Star },
  enterprise: { label: rotuloDoPlano("enterprise"), color: "bg-[var(--color-tag-bg)] text-gray-700 dark:text-gray-300", icon: Star },
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
  pending:  { label: "Pendente",  color: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]" },
  approved: { label: "Aprovado",  color: "bg-[var(--color-success-bg)] text-[var(--color-success)]" },
  rejected: { label: "Rejeitado", color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
};

const KYC_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending:  { label: "Verificacao Pendente", color: "bg-[var(--color-gold-bg)] text-[var(--color-gold)] border-amber-200", icon: ClipboardList },
  approved: { label: "Verificado",           color: "bg-[var(--color-success-bg)] text-[var(--color-success)] border-[var(--color-success)]", icon: UserCheck },
  rejected: { label: "Verificacao Rejeitada",color: "bg-red-100 text-red-700 border-red-200", icon: X },
};

/**
 * ERP: a lista local morreu — o catalogo agora e um so.
 *
 * O que existia aqui era a TERCEIRA copia da mesma lista de ERPs (as outras
 * duas: `components/admin/constants.ts` e `pages/operacional/inadimplentes.tsx`),
 * e as tres ja discordavam entre si. Esta trazia tres nomes que NAO existem
 * como conector no servidor — `tiacos`, `flyspeed` e `netflash` — enquanto
 * faltavam quatro que existem (`topsapp`, `radiusnet`, `gere`, `receitanet`).
 * Conferido contra `server/erp/index.ts`: sao dez conectores registrados, nem
 * mais nem menos.
 *
 * Aqui a lista TRADUZ, nao oferece: ela e o ultimo recurso de `nomeDoErp()`
 * para uma chave que ja esta gravada, quando nem o catalogo do superadmin nem o
 * registry do servidor souberam dizer o nome. Por isso ela leva as dez chaves,
 * inclusive as quatro cujo conector ainda nao conversa com a API — quem tiver
 * uma delas gravada precisa ler "TopSApp", nunca `topsapp`. O criterio e o
 * mesmo escrito em `constants.ts`: casca entra em lista que traduz, e fica de
 * fora de lista que oferece.
 *
 * TAMBEM SAIRAM `grad`, `authType` e `authHint` do mapeamento abaixo: nenhum
 * dos tres tinha consumidor (grep no arquivo inteiro), e o padrao de `grad`
 * era um gradiente de duas paradas na paleta default do Tailwind — duas
 * proibicoes da secao 7 do DESIGN_SYSTEM num campo morto. (O literal nao e
 * repetido aqui: uma auditoria por grep nao pode ser envenenada pelo
 * comentario que conta que ele saiu.)
 *
 * `ERP_OPTIONS` e importado no topo, junto dos demais imports.
 */

/**
 * O que a aba de integracao do provedor recebe hoje.
 *
 * A rota devolve um RESUMO — nunca apiUrl, apiToken, apiUser, clientId,
 * clientSecret, mkContraSenha, extraConfig ou notes. Antes ela mandava as
 * credenciais decifradas para o navegador e esta tela as editava; a
 * configuracao passou para o painel do superadmin, e aqui so se exibe.
 * `configurado` ja vem calculado no servidor como apiUrl E apiToken.
 */
type ResumoErp = {
  erpSource: string;
  isEnabled: boolean;
  configurado: boolean;
  status: string;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  totalSynced: number;
  totalErrors: number;
};

type TomEstado = "ok" | "gated" | "past" | "info" | "neutro";

/**
 * O estado que o provedor le. Sem os botoes de salvar, testar e sincronizar,
 * este selo virou o unico sinal que resta — entao ele nao pode arredondar nada
 * para cima. `configurado` e um E (url E token) vindo do servidor; um OU aqui
 * mostraria "Integrada" para quem tem so metade da credencial.
 *
 * A ordem importa e e defensiva de proposito: `isEnabled` manda, `status` so
 * qualifica. A pausa por falhas e gravada como isEnabled=false + status
 * 'pausado_por_falhas', e o religar limpa o status — mas se um dia a marca
 * ficar presa por qualquer outro motivo (migracao pela metade, escrita perdida,
 * bug de servidor), uma integracao LIGADA e sincronizando seria exibida como
 * pausada. O provedor pararia de confiar no dado que esta chegando, e abriria
 * chamado para um problema que nao existe. Por isso 'pausado_por_falhas' so e
 * lido dentro do ramo em que a integracao ja esta desligada.
 *
 * `conectorPendente` vem do registry do servidor e manda em tudo o mais. Ha ERP
 * cujo conector so figura no catalogo: ele nunca conversa com a API, entao a
 * linha nasce "Integrada" em verde e, depois da primeira varredura automatica,
 * fica para sempre em "Falha na ultima sincronizacao" — a tela atribuindo ao
 * sistema do provedor uma falha que e nossa. Como o corte automatico por falhas
 * foi suprimido justamente para esses conectores, nada tira a linha desse
 * estado, e o provedor abre chamado sobre um ERP que esta perfeito. O parametro
 * e opcional e o padrao preserva o comportamento de antes: quem nao sabe do
 * conector nao pode ser obrigado a informa-lo.
 */
export function estadoDaIntegracao(
  intg: ResumoErp,
  conectorPendente = false,
): { texto: string; tom: TomEstado; detalhe?: string } {
  if (conectorPendente) {
    return {
      texto: "Em desenvolvimento",
      tom: "neutro",
      detalhe: "A ligacao com este ERP ainda esta sendo construida pela nossa equipe. Nao ha falha no seu sistema e nao ha nada a ajustar do seu lado: assim que ela ficar pronta, a sincronizacao comeca sozinha e o historico aparece aqui.",
    };
  }
  if (!intg.configurado) {
    return {
      texto: "Aguardando configuracao",
      tom: "gated",
      detalhe: "As credenciais deste ERP ainda nao foram cadastradas pelo suporte.",
    };
  }
  if (!intg.isEnabled) {
    if (intg.status === "pausado_por_falhas") {
      return {
        texto: "Pausada por falhas",
        tom: "gated",
        detalhe: "A sincronizacao foi pausada automaticamente depois de falhas seguidas do ERP. O suporte religa apos verificar a causa.",
      };
    }
    return { texto: "Desativada", tom: "neutro", detalhe: "Esta integracao esta configurada, mas nao esta sincronizando." };
  }
  if (intg.lastSyncStatus === "error") {
    return { texto: "Falha na ultima sincronizacao", tom: "past" };
  }
  return { texto: "Integrada", tom: "ok" };
}

/**
 * Quais linhas de integracao o PROVEDOR ve nesta aba.
 *
 * A tabela guarda uma linha por ERP que o suporte ja tocou, e o provedor viu
 * seis delas de uma vez. Aqui ele nao configura nada — entao a lista so pode
 * conter o que fala sobre a conta dele hoje:
 *
 * - `configurado` e obrigatorio porque linha sem credencial nao e integracao,
 *   e cadastro pela metade: assunto interno, nao estado do provedor.
 * - `configurado` sozinho tambem nao basta. Uma linha com credencial e
 *   desligada de proposito pelo suporte e assunto do suporte — o provedor nao
 *   tem como liga-la, e ficar olhando para ela so gera duvida.
 * - `pausado_por_falhas` entra MESMO desligada, e e a razao de a regra nao ser
 *   apenas `isEnabled`: e o unico aviso que o provedor recebe de que a
 *   sincronizacao dele parou e que o ERP dele precisa de conserto. Esconder
 *   isso seria esconder justamente aquilo sobre o que ele tem de agir.
 *
 * A linha de um ERP cujo conector ainda esta sendo construido FICA VISIVEL, e o
 * criterio nao a consulta. Esconde-la deixaria a conta que so tem essa linha
 * caindo no estado vazio, cujo texto manda procurar o suporte para cadastrar a
 * integracao — exatamente o chamado que se quer evitar, agora sobre um ERP que o
 * suporte ja cadastrou. O provedor tambem foi avisado de que a integracao dele
 * estava sendo ligada; sumir com ela produz "cade meu ERP?", que e o mesmo
 * chamado com outro assunto. Visivel e dizendo a verdade, ele le que existe,
 * que o atraso e nosso e que nao ha o que fazer — e nao liga. O que a linha nao
 * pode e ser contada como sincronizacao no ar; disso cuida `integracaoNoAr`.
 */
export function integracaoVisivelAoProvedor(intg: ResumoErp): boolean {
  if (!intg.configurado) return false;
  return intg.isEnabled || intg.status === "pausado_por_falhas";
}

/**
 * Se esta integracao conta como sincronizacao acontecendo agora.
 *
 * O cartao "integracoes ativas" imprime esse numero em 21px. Uma linha de
 * conector ainda em construcao chega aqui com isEnabled=true — a coluna diz
 * ligada, e nenhuma varredura consegue ler nada — e somaria 1 logo acima da
 * propria linha que se declara em desenvolvimento. Numero grande contradizendo
 * o texto abaixo dele e o jeito mais rapido de o operador parar de acreditar na
 * tela inteira.
 */
export function integracaoNoAr(intg: ResumoErp, conectorPendente = false): boolean {
  return intg.isEnabled && !conectorPendente;
}

/**
 * Selo de estado — o mesmo componente que a tela do superadmin imprime para a
 * mesma integracao (o PILL_BASE de admin-provedor). Label mono em caixa alta na
 * abertura do token: com a medida cravada aqui, suporte e provedor liam a mesma
 * marca em duas formas diferentes durante a mesma conversa.
 */
const SELO_ESTADO = "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[var(--track-wide)]";

/** Cabecalho da tabela do historico: mesma abertura dos rotulos dos cartoes acima. */
const COLUNA_HISTORICO = "text-[10px] tracking-[var(--track-wide)]";

const TOM_ESTADO: Record<TomEstado, { fg: string; bg: string; bd: string }> = {
  ok:     { fg: "var(--ok)",        bg: "var(--ok-bg)",     bd: "var(--ok-border)" },
  gated:  { fg: "var(--gated)",     bg: "var(--gated-bg)",  bd: "var(--gated-border)" },
  past:   { fg: "var(--past)",      bg: "var(--past-bg)",   bd: "var(--past-border)" },
  info:   { fg: "var(--info)",      bg: "var(--info-bg)",   bd: "var(--info-border)" },
  neutro: { fg: "var(--text-muted)", bg: "var(--surface-inset)", bd: "var(--border)" },
};

/**
 * Desfecho de cada linha do historico.
 *
 * 'reativado' nao e sucesso nem erro: e o registro de que o suporte religou a
 * integracao, e ele existe para servir de parada na contagem de falhas
 * consecutivas do servidor. Sem estar mapeado aqui, cairia no ramo generico e
 * seria mostrado como "Parcial" — inventando um desfecho de varredura para uma
 * linha que nao e varredura nenhuma.
 *
 * O ramo desconhecido mostra o codigo cru em tom neutro de proposito: rotular
 * de "Parcial" um status que esta tela ainda nao conhece e mentir com mais
 * confianca do que nao saber.
 */
const DESFECHO_DO_LOG: Record<string, { rotulo: string; tom: TomEstado }> = {
  success:   { rotulo: "Sucesso",   tom: "ok" },
  partial:   { rotulo: "Parcial",   tom: "gated" },
  error:     { rotulo: "Erro",      tom: "past" },
  reativado: { rotulo: "Reativada", tom: "info" },
};

export function desfechoDoLog(status: string): { rotulo: string; tom: TomEstado } {
  return DESFECHO_DO_LOG[status] ?? { rotulo: status, tom: "neutro" };
}

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
      {copied ? <CheckCircle className="w-4 h-4 text-[var(--color-success)]" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function PainelProvedorPage() {
  const marca = useMarca();
  const { user, provider, personificando } = useAuth();
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

  /**
   * Os planos vinham cravados aqui: R$ 199/399/799 com 1000 consultas ISP, uma
   * tabela que a fatura mensal nunca cobrou. Agora saem do servidor, que e
   * quem cobra — e que, com o white label, resolve o preco da marca.
   */
  const { data: precos, isLoading: carregandoPrecos, isError: erroPrecos, refetch: recarregarPrecos } = usePrecos();
  const planosVisiveis = (precos?.planos ?? []).filter(
    p => p.naVitrine || p.chave === provider?.plan,
  );

  /**
   * `isError` nao e detalhe: o default `= []` mais o `retry: false` do
   * queryClient fazem QUALQUER falha do GET virar lista vazia, e lista vazia
   * aqui significa "voce nao tem ERP nenhum". Um provedor integrado leria que
   * perdeu a integracao e abriria chamado; o suporte olharia e veria tudo no
   * lugar. Sem ler o erro, a tela nao consegue separar "nao ha" de "nao deu
   * para saber".
   */
  const {
    data: erpIntegrationsList = [],
    isLoading: carregandoErps,
    isError: erroErps,
    error: falhaErps,
    refetch: refetchErpList,
  } = useQuery<ResumoErp[]>({
    queryKey: ["/api/provider/erp-integrations"],
    enabled: activeTab === "integracao",
  });

  const {
    data: syncLogs = [],
    isLoading: carregandoLogs,
    isError: erroLogs,
    refetch: refetchSyncLogs,
  } = useQuery<any[]>({
    queryKey: ["/api/provider/erp-sync-logs"],
    enabled: activeTab === "integracao",
  });

  const { data: erpCatalogData = [] } = useQuery<any[]>({
    queryKey: ["/api/erp-catalog"],
    staleTime: 5 * 60 * 1000,
  });

  /* Segunda fonte de rotulo humano.
     O catalogo acima so lista o que o superadmin cadastrou; o registry de
     conectores lista o que o servidor sabe falar. Um ERP integrado e ausente do
     catalogo — caso real, porque quem integra e o suporte — cairia no
     identificador cru ("RBX", "HUBSOFT") no cartao e nas linhas. Muda so com
     deploy do servidor, entao a validade e longa de proposito.

     `naoImplementado` ja vinha nesta resposta e esta tela nao o declarava, entao
     nao o lia: e a marca do conector que ainda nao conversa com a API do ERP, e
     sem ela a linha aparecia como "Integrada". */
  const { data: erpConectores = [] } = useQuery<Array<{ name: string; label: string; naoImplementado?: boolean }>>({
    queryKey: ["/api/erp-connectors"],
    staleTime: 30 * 60 * 1000,
  });

  const activeErpList = (erpCatalogData.length > 0 ? erpCatalogData.filter((e: any) => e.active) : ERP_OPTIONS).map((e: any) => ({
    key: e.key,
    name: e.name,
    desc: e.description ?? e.desc ?? e.name,
    logoBase64: e.logoBase64 ?? e.logo_base64 ?? null,
  }));

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
  const { data: dashStats } = useQuery<any>({ queryKey: ["/api/dashboard/stats"], staleTime: STALE_DASHBOARD });
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
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/provider/users"] });
      toast({ title: "Usuario excluido" });
    },
    // `apiRequest` lanca `409: {"message":"..."}`; sem extrair a frase o admin
    // le o JSON cru no toast — e o 409 mais comum aqui (usuario com historico)
    // e justamente o que ele precisa entender.
    onError: (err: unknown) => toast({ title: "Nao foi possivel excluir", description: mensagemDoErro(err), variant: "destructive" }),
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

  /**
   * Quem pode mexer na ficha da empresa.
   *
   * ESPELHA `podeAdministrarOProvedor` (server/routes/provider.routes.ts), e a
   * copia tem de ser fiel nas duas pontas: mais frouxa aqui e um botao que
   * aparece e recusa ao salvar; mais estrita e uma acao permitida que ninguem
   * consegue alcancar.
   *
   * A regra do servidor tem duas metades:
   *   · `admin` do provedor, sempre;
   *   · `superadmin` SO dentro de uma janela de acesso de suporte — fora dela,
   *     ser da plataforma nao autoriza escrever na conta de nenhum tenant, e a
   *     liberacao que o provedor assinou viraria decoracao.
   *
   * A guarda anterior comparava so com "admin", e escondia todo botao de escrita
   * desta aba justamente do suporte conectado: na personificacao o papel
   * continua "superadmin" de proposito (e o que separa um suporte de um admin de
   * verdade no log e na faixa vermelha). O resultado era o aviso "clique em
   * buscar" acima de um lugar sem botao nenhum.
   */
  const podeEditarEmpresa =
    user?.role === "admin" || (user?.role === "superadmin" && personificando);


  /**
   * Preenche a ficha com o cadastro da Receita.
   *
   * Quem consulta e o SERVIDOR (GET /api/provider/cnpj), que tenta tres fontes
   * em ordem e cai para a seguinte quando uma recusa. Antes isto era um fetch
   * daqui direto para a BrasilAPI: uma fonte so, sem queda, e um segundo
   * tradutor de campos que ja divergia do do servidor — o daqui nem juntava
   * "RUA" ao nome da rua. Bastava a BrasilAPI recusar por cota para a tela
   * dizer "servico indisponivel" e o provedor concluir que o sistema nao busca
   * nada.
   *
   * A rota NAO recebe CNPJ: usa o do provedor da sessao. Conferir o numero aqui
   * so serviria para o botao recusar antes de perguntar, e a rota faz isso
   * melhor — ela sabe qual CNPJ esta gravado de verdade.
   */
  const handleCnpjLookup = async () => {
    setCnpjLookupStatus("loading");
    try {
      const res = await apiRequest("GET", "/api/provider/cnpj");
      const data = await res.json();

      const naturezaToLegal: Record<string, string> = {
        "Empresario Individual": "MEI",
        "Empres\u00e1rio Individual": "MEI",
        "Microempresario Individual (MEI)": "MEI",
        "Empresa Individual de Responsabilidade Limitada (EIRELI)": "EIRELI",
        "Sociedade Limitada": "LTDA",
        "Sociedade Empres\u00e1ria Limitada": "LTDA",
        "Sociedade Anonima Aberta": "S/A",
        "Sociedade Anonima Fechada": "S/A",
      };
      const legalGuess = naturezaToLegal[data.naturezaJuridica || ""] || "";

      /* O que a Receita traz SUBSTITUI o que esta na ficha; o que ela nao traz e
         mantido. O contrario deixaria de pe o defeito que motivou este botao: a
         razao social gravada com o nome da pessoa em vez do da empresa nunca
         seria corrigida por ele. */
      const atual = getEmpresa();
      setEmpresa({
        ...atual,
        name: data.razaoSocial || atual.name,
        tradeName: data.nomeFantasia || atual.tradeName,
        legalType: legalGuess || atual.legalType,
        openingDate: data.dataAbertura || atual.openingDate,
        contactPhone: data.telefone || atual.contactPhone,
        contactEmail: data.email || atual.contactEmail,
        addressZip: data.cep || atual.addressZip,
        addressStreet: data.logradouro || atual.addressStreet,
        addressNumber: data.numero || atual.addressNumber,
        addressComplement: data.complemento || atual.addressComplement,
        addressNeighborhood: data.bairro || atual.addressNeighborhood,
        addressCity: data.cidade || atual.addressCity,
        addressState: data.uf || atual.addressState,
      });

      const socios = Array.isArray(data.socios) ? data.socios : [];
      if (socios.length > 0) {
        setImportedQsa(socios.map((s: any) => ({
          name: s.nome || "",
          cpf: s.cpf || "",
          role: s.qualificacao || "",
          email: "",
          phone: "",
          birthDate: "",
          sharePercentage: "",
        })));
        setShowQsaImport(true);
      }

      setCnpjLookupStatus("done");
      toast({
        title: "Dados importados",
        description: `Ficha preenchida com o cadastro da Receita Federal${data.fonte ? ` (${data.fonte})` : ""}. Revise e salve.`,
      });
    } catch (err: any) {
      setCnpjLookupStatus("error");
      /* Repetir a frase do servidor e melhor que uma generica: "as tres fontes
         recusaram, tente em alguns minutos" e "este provedor nao tem CNPJ
         valido" pedem acoes diferentes. `apiRequest` ja poe a frase dele em
         `message`. */
      toast({
        title: "Nao foi possivel consultar",
        description: err?.message || "A Receita nao respondeu. Tente novamente em alguns minutos.",
        variant: "destructive",
      });
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

  /* Uma lista so para a tela inteira: cartoes, estado vazio e linhas contam e
     mostram exatamente o mesmo conjunto. Contar sobre a lista crua enquanto se
     exibe a filtrada publicaria "5 integracoes ativas" acima de uma unica
     linha — numero que nao bate com o que esta logo abaixo dele, e uma tela
     que o operador para de acreditar. */
  const erpsVisiveis    = erpIntegrationsList.filter(integracaoVisivelAoProvedor);
  /* Enquanto a lista de conectores nao chegou, nenhum ERP e tratado como
     pendente: e um render de diferenca, e supor pendente o que ainda nao se sabe
     rotularia de "em desenvolvimento" a integracao que esta sincronizando. */
  const conectorPendente = (source: string) =>
    erpConectores.some(c => c.name === source && c.naoImplementado === true);
  const erpTotalEnabled = erpsVisiveis.filter(i => integracaoNoAr(i, conectorPendente(i.erpSource))).length;
  const erpTotalErrors  = erpsVisiveis.reduce((s, i) => s + (i.totalErrors ?? 0), 0);
  const erpLastSync     = erpsVisiveis.reduce((latest: string | null, i) => {
    if (!i.lastSyncAt) return latest;
    return !latest || i.lastSyncAt > latest ? i.lastSyncAt : latest;
  }, null as string | null);
  /** O catalogo so entra para o nome bonito e o logo; a lista quem manda e o resumo. */
  const erpDoCatalogo = (source: string) => activeErpList.find((e: any) => e.key === source);
  /**
   * O identificador de banco so vai a tela quando nao existe rotulo humano em
   * lugar nenhum — nem no catalogo do superadmin, nem no registry de conectores
   * do servidor. Fora desse caso o provedor le "IXC Soft", nunca "ixc".
   */
  const nomeDoErp = (source: string) =>
    erpDoCatalogo(source)?.name
    ?? erpConectores.find(c => c.name === source)?.label
    ?? source.toUpperCase();

  return (
    <div className="p-4 lg:p-6 space-y-6" data-testid="painel-provedor-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold" data-testid="text-painel-title">{provider?.tradeName || provider?.name}</h1>
              <Badge className={`text-xs gap-1.5 ${planInfo.color}`}>
                <PlanIcon className="w-4 h-4" />
                {planInfo.label}
              </Badge>
              <Badge className={`text-xs gap-1.5 border ${kycConfig.color}`}>
                <KycIcon className="w-4 h-4" />
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
          <TabsTrigger value="anti-fraude" className="gap-1.5" data-testid="tab-anti-fraude">
            <Shield className="w-3.5 h-3.5" />Anti-Fraude
          </TabsTrigger>
          {/* A aba nao aparece para o OPERADOR do provedor (role `user`): a rota
              que le o estado exige admin, entao para ele a aba seria uma caixa
              vermelha de falha — um erro onde na verdade nao ha permissao. O
              superadmin passa (`requireAdmin` o deixa entrar) e precisa ver o
              estado enquanto esta conectado. */}
          {user?.role !== "user" && (
            <TabsTrigger value="suporte" className="gap-1.5" data-testid="tab-suporte">
              <Headset className="w-3.5 h-3.5" />Suporte
            </TabsTrigger>
          )}
        </TabsList>

        {/* ======================== VISAO GERAL ======================== */}
        <TabsContent value="visao-geral" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Clientes", value: dashStats?.totalCustomers ?? "-", icon: Users, color: "bg-blue-500" },
              { label: "Inadimplentes", value: dashStats?.defaulters ?? "-", icon: AlertTriangle, color: "bg-red-500" },
              { label: "Consultas ISP", value: ispConsultations.length, icon: Search, color: "bg-indigo-500" },
              { label: "Consultas SPC", value: spcConsultations.length, icon: BarChart3, color: "bg-purple-500" },
            ].map((s) => (
              <Card key={s.label} className="p-5">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.color}`}>
                    <s.icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xl font-bold" data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>{s.value}</p>
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Shield className="w-5 h-5" />Informações do Plano
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Plano atual</span>
                  <Badge className={planInfo.color}>{planInfo.label}</Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge className={provider?.status === "active" ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" : "bg-red-100 text-red-700"}>
                    {provider?.status === "active" ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Verificacao KYC</span>
                  <Badge className={`border ${kycConfig.color}`}>{kycConfig.label}</Badge>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-muted-foreground">Creditos</span>
                  <span className="font-semibold" data-testid="text-isp-credits">{(provider?.ispCredits ?? 0)}</span>
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
                    <div className="w-8 h-8 rounded-lg bg-[var(--color-brand)] flex items-center justify-center flex-shrink-0 mt-0.5">
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
                  {/* Aparece para quem consegue SALVAR a ficha. A guarda era
                      role === "admin" e escondia o botao do superadmin — que e
                      justamente quem abre esta tela num acesso de suporte, e o
                      papel dele NAO muda na personificacao (server/auth.ts). O
                      resultado era um aviso mandando "clique em buscar" acima de
                      um lugar sem botao nenhum. `podeEditarEmpresa` e a mesma
                      condicao que o servidor aplica no PATCH do perfil. */}
                  {podeEditarEmpresa && (
                    <Button
                      size="sm"
                      className="gap-2 bg-[var(--color-brand)] hover:bg-blue-700 text-white flex-shrink-0"
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
                  <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-success)] dark:text-emerald-400">
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
              <div className="bg-muted/40 rounded-lg p-5 mb-5 border space-y-4">
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
                          className="h-8 w-8 p-0 text-[var(--color-danger)] hover:text-red-700 hover:bg-red-50"
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
                              className="h-8 w-8 p-0 text-[var(--color-danger)] hover:text-red-700 hover:bg-red-50"
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
                <Globe className="w-5 h-5" />Seu Subdominio no {marca.nomeProduto}
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                Este e o endereco exclusivo do seu provedor na plataforma {marca.nomeProduto}.
              </p>
              {provider?.subdomain ? (
                <>
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-lg p-5 border border-blue-100 dark:border-blue-900 mb-4">
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
                        <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />Como usar o subdominio
                      </h3>
                      <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
                        <li>Compartilhe o link com sua equipe</li>
                        <li>Faca login com suas credenciais normais</li>
                        <li>Acesse todas as funcionalidades do {marca.nomeProduto}</li>
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
              <h3 className="font-semibold mb-2 flex items-center gap-2 text-[var(--color-gold)]">
                <Settings className="w-4 h-4" />DNS e Configuracao de Producao
              </h3>
              <p className="text-sm text-[var(--color-gold)] dark:text-amber-400 mb-3">
                Para o subdominio funcionar em producao, o administrador do sistema deve configurar o DNS wildcard:
              </p>
              <div className="bg-white dark:bg-gray-900 rounded-lg p-3 space-y-2 text-xs font-mono">
                <div className="flex items-center gap-3 border-t pt-2">
                  <span className="w-16 font-bold text-blue-600">A</span>
                  <span className="w-24">*.consultaisp</span>
                  <span className="text-[var(--color-success)]">IP_DO_SERVIDOR</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-16 font-bold text-blue-600">CNAME</span>
                  <span className="w-24">www</span>
                  <span className="text-[var(--color-success)]">consultaisp.com.br</span>
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
                  Gerencie quem tem acesso ao painel do {provider?.tradeName || provider?.name}
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
                      <Badge className={`text-xs ${u.role === "admin" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-[var(--color-tag-bg)] text-gray-700 dark:text-gray-300"}`}>
                        {u.role === "admin" ? "Admin" : "Usuario"}
                      </Badge>
                      {u.emailVerified ? (
                        <CheckCircle className="w-4 h-4 text-[var(--color-success)]" title="Email verificado" />
                      ) : (
                        <Mail className="w-4 h-4 text-amber-500" title="Email pendente" />
                      )}
                      {user?.role === "admin" && u.id !== user?.id && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 w-8 p-0 text-[var(--color-danger)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
                          title="Excluir usuario"
                          aria-label={`Excluir usuario ${u.name}`}
                          // A rota apaga a linha de vez — nao ha "desativado" no
                          // banco. A confirmacao precisa dizer isso, senao o
                          // admin descobre depois de clicar. E precisa avisar do
                          // caso mais comum: quem ja consultou tem historico, o
                          // historico e do provedor, e a exclusao e recusada.
                          onClick={() => {
                            if (confirm(`Excluir o usuario ${u.name} (${u.email})?\n\nA conta e apagada em definitivo e as sessoes abertas dele caem na hora. Nao ha como desfazer — para devolver o acesso sera preciso cadastrar de novo.\n\nSe ele ja tiver historico no sistema (consultas ou mensagens de suporte), a exclusao e recusada: esse historico e do provedor e nao pode ser apagado junto.`)) {
                              deleteUserMutation.mutate(u.id);
                            }
                          }}
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
                    <p className="text-xs text-muted-foreground">Saldo de Creditos</p>
                    <p className="text-3xl font-bold" data-testid="text-isp-credits-tab">{(provider?.ispCredits ?? 0)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {`Consulta ISP (rede colaborativa): ${CUSTO_EM_CREDITOS.isp} credito. Consulta na propria base: gratuita. Consulta cadastral: ${CUSTO_EM_CREDITOS.cadastral} credito${CUSTO_EM_CREDITOS.cadastral === 1 ? "" : "s"}. Consulta SPC: ${CUSTO_EM_CREDITOS.spc} creditos.`}
                </p>
              </Card>
            </div>
            <Card className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <CreditCard className="w-4 h-4" />Planos
              </h3>
              {carregandoPrecos && planosVisiveis.length === 0 ? (
                <div className="grid md:grid-cols-2 gap-4">
                  {[0, 1].map(i => (
                    <div key={i} className="h-32 rounded-lg bg-[var(--surface-inset)] animate-pulse" />
                  ))}
                </div>
              ) : planosVisiveis.length === 0 ? (
                /* Card de planos vazio nao explica nada — e o provedor conclui
                   que perdeu o plano. */
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-6 text-center" data-testid="empty-planos">
                  <p className="text-sm font-medium">
                    {erroPrecos ? "Nao foi possivel carregar os planos" : "Nenhum plano disponivel"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {erroPrecos
                      ? "A tabela de precos nao respondeu. Seu plano atual continua valendo."
                      : "Fale com o suporte."}
                  </p>
                  {erroPrecos && (
                    <Button variant="outline" size="sm" className="mt-3 text-xs" onClick={() => recarregarPrecos()} data-testid="button-recarregar-planos">
                      Tentar de novo
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {planosVisiveis.map((p) => {
                    const atual = provider?.plan === p.chave;
                    return (
                      <div key={p.chave} data-testid={`plan-${p.chave}`}
                        className={`rounded-lg border p-4 ${atual ? "border-[var(--brand)]" : "border-[var(--border)]"}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="font-bold">{p.rotulo}</p>
                          {atual && (
                            <Badge>Plano atual</Badge>
                          )}
                        </div>
                        <p className="text-2xl font-bold font-mono tabular-nums mb-3">
                          {precoCurto(p)}
                          {p.precoCentavos > 0 && (
                            <span className="text-sm font-normal text-muted-foreground">/mes</span>
                          )}
                        </p>
                        <ul className="space-y-1.5 text-sm text-muted-foreground">
                          {/* "N creditos inclusos por mes" so para plano que
                              gera fatura. `generate-monthly` pula preco zero,
                              entao no free nenhuma fatura nasce e nenhum
                              credito e somado — os 50 vem uma vez so, no
                              cadastro. O card prometia uma recorrencia que
                              nunca acontece. */}
                          <li className="tabular-nums">
                            {linhaDeCreditosDoPlano(p)}
                          </li>
                          <li>Subdominio proprio e usuarios da equipe</li>
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* O botao "Assinar" daqui nunca teve acao: nao existe rota de
                  troca de plano para o provedor — so POST /api/admin/providers/:id/plan,
                  do superadmin. Botao que nao faz nada ensina o provedor a
                  desconfiar da tela; enquanto a rota nao existir, o caminho
                  honesto e o suporte. */}
              <p className="text-xs text-muted-foreground mt-4">
                Para mudar de plano, fale com o suporte.
              </p>
            </Card>
          </div>
        </TabsContent>

        {/* ======================== INTEGRACAO ======================== */}
        {/* Somente exibicao. A configuracao das credenciais mora no painel do
            superadmin; aqui o provedor so ve o que esta integrado e como anda a
            sincronizacao. Nao ha campo, liga/desliga, teste nem "sincronizar
            agora": a rota que gravava credencial daqui exigia apenas sessao, e
            qualquer operador de papel "user" trocava o token do ERP. Esconder o
            JSX nao resolveria — as rotas de escrita do provedor sairam junto. */}
        <TabsContent value="integracao" className="space-y-4" data-testid="tab-content-integracao">
          {/* Cabecalho */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}>
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold leading-tight" style={{ color: "var(--text)", letterSpacing: "var(--track-tight)" }}>
                  Integracao com ERPs
                </h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  O sistema busca os inadimplentes direto na API do seu ERP. As credenciais sao cadastradas pela equipe de suporte.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => { refetchErpList(); refetchSyncLogs(); }}
              data-testid="button-refresh-integrations"
            >
              <RefreshCw className="w-3.5 h-3.5" />Atualizar
            </Button>
          </div>

          {/* Estatisticas.
              Os quatro numeros saem de `erpsVisiveis`, que e `[]` tanto
              quando nao ha integracao quanto quando o GET falhou. Publicar
              "0 integracoes ativas / Nenhum" em cima de um erro de rede e a
              mesma mentira do estado vazio, so que em fonte grande — entao,
              carregando e no erro, a grade nao afirma nada. */}
          {carregandoErps ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="loading-stats-erp">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="rounded-lg px-3.5 py-3 space-y-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <div className="h-2.5 w-24 rounded animate-pulse" style={{ background: "var(--surface-inset)" }} />
                  <div className="h-5 w-16 rounded animate-pulse" style={{ background: "var(--surface-inset)" }} />
                </div>
              ))}
            </div>
          ) : erroErps ? null : (() => {
            /* Conta sobre `erpsVisiveis` inteiro, e nao so sobre as habilitadas.
               Uma integracao pausada por falhas continua integrada: ela aparece
               logo abaixo, com o selo "Pausada por falhas" e o nome do ERP. Ler
               "Nenhum" aqui em cima da propria linha que nomeia o ERP era a
               contradicao que fazia o operador desconfiar da tela. Quantas estao
               no ar e o que o cartao ao lado ja mede. */
            const integrados = erpsVisiveis.map(i => nomeDoErp(i.erpSource));
            const cartoes: Array<{ id: string; rotulo: string; valor: string; mono: boolean; cor: string; icone: any }> = [
              { id: "ativas",  rotulo: "integracoes ativas",   valor: erpTotalEnabled.toLocaleString("pt-BR"), mono: true,  cor: erpTotalEnabled > 0 ? "var(--ok)" : "var(--text-muted)", icone: CheckCheck },
              { id: "nomes",   rotulo: "erps integrados",      valor: integrados.length > 0 ? integrados.join(", ") : "Nenhum", mono: false, cor: "var(--text)", icone: Database },
              { id: "ultima",  rotulo: "ultima sincronizacao", valor: relDate(erpLastSync), mono: true, cor: "var(--text)", icone: Clock },
              { id: "erros",   rotulo: "erros acumulados",     valor: erpTotalErrors.toLocaleString("pt-BR"), mono: true, cor: erpTotalErrors > 0 ? "var(--past)" : "var(--text)", icone: AlertTriangle },
            ];
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {cartoes.map(c => (
                  <div
                    key={c.id}
                    className="rounded-lg px-3.5 py-3"
                    style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                    data-testid={`stat-erp-${c.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-[10px] uppercase truncate" style={{ fontFamily: "var(--font-mono)", letterSpacing: "var(--track-wide)", color: "var(--text-muted)" }}>
                        {c.rotulo}
                      </p>
                      <c.icone className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-faint)" }} />
                    </div>
                    <p
                      className="text-[21px] leading-tight truncate"
                      title={c.valor}
                      style={{
                        fontFamily: c.mono ? "var(--font-mono)" : "var(--font-sans)",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 500,
                        letterSpacing: "var(--track-tight)",
                        color: c.cor,
                      }}
                    >
                      {c.valor}
                    </p>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Uma linha por integracao que o provedor TEM E QUE FALA COM ELE — a
              lista vem do resumo, nao do catalogo de conectores: o catalogo diz o
              que existe no mundo, nao o que esta ligado nesta conta. O recorte
              esta em `integracaoVisivelAoProvedor`. */}
          <Card className="overflow-hidden" data-testid="card-erp-integrations">
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Suas integracoes</p>
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                Estado de cada ERP ligado a esta conta. Para ligar, trocar ou desligar um ERP, fale com o suporte.
              </p>
            </div>

            {carregandoErps ? (
              <div data-testid="loading-erp-integrations">
                {[0, 1].map(i => (
                  <div key={i} className="px-4 py-4 flex items-center gap-3" style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                    <div className="w-8 h-8 rounded animate-pulse shrink-0" style={{ background: "var(--surface-inset)" }} />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-40 rounded animate-pulse" style={{ background: "var(--surface-inset)" }} />
                      <div className="h-2.5 w-64 rounded animate-pulse" style={{ background: "var(--surface-inset)" }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : erroErps ? (
              /* Erro NAO e vazio. O texto do vazio manda procurar o suporte
                 para cadastrar a integracao — dito a quem ja tem uma, vira um
                 chamado que termina com "esta tudo certo aqui". Aqui a tela
                 admite o que aconteceu de verdade: nao deu para ler o estado. */
              <div className="flex flex-col items-center justify-center text-center px-6 py-14" data-testid="error-erp-integrations">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ background: "var(--past-bg)", border: "1px solid var(--past-border)" }}>
                  <AlertTriangle className="w-6 h-6" style={{ color: "var(--past)" }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Nao foi possivel ler o estado da integracao</p>
                <p className="text-xs mt-1.5 max-w-md leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Esta e uma falha ao consultar esta tela, nao uma falha do seu ERP. Se voce ja tem uma integracao
                  ligada, ela continua sincronizando normalmente — so o painel nao conseguiu carregar o estado agora.
                </p>
                <p className="text-[10px] uppercase mt-3 max-w-md break-words" style={{ fontFamily: "var(--font-mono)", letterSpacing: "var(--track-wide)", color: "var(--text-faint)" }}>
                  {mensagemDoErro(falhaErps)}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 h-8 text-xs gap-1.5"
                  onClick={() => refetchErpList()}
                  data-testid="button-retry-erp-integrations"
                >
                  <RefreshCw className="w-3.5 h-3.5" />Tentar de novo
                </Button>
              </div>
            ) : erpsVisiveis.length === 0 ? (
              /* Este vazio agora vale por dois casos: conta sem nenhuma linha, e
                 conta com linhas que o recorte tirou da tela (sem credencial ou
                 desligadas pelo suporte). O texto tem de ser verdadeiro nos dois
                 — dizer "nenhum ERP cadastrado" a quem tem uma linha desativada
                 seria mentira, entao ele afirma so o que o provedor de fato nao
                 tem: sincronizacao acontecendo. */
              <div className="flex flex-col items-center justify-center text-center px-6 py-14" data-testid="empty-erp-integrations">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ background: "var(--surface-inset)" }}>
                  <Database className="w-6 h-6" style={{ color: "var(--text-faint)" }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Nenhuma integracao ativa</p>
                <p className="text-xs mt-1.5 max-w-md leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Nenhum ERP esta sincronizando com esta conta no momento. A integracao com iXC, MK Solutions, SGP,
                  Hubsoft, Voalle ou RBX e cadastrada e ligada pela equipe de suporte, com as credenciais que voce gera
                  no painel do seu proprio ERP. Assim que ela estiver ativa, o estado e o historico de sincronizacao
                  aparecem aqui.
                </p>
                {marca.suporteEmail ? (
                  <Button asChild size="sm" className="mt-4 h-8 text-xs gap-1.5">
                    <a
                      href={`mailto:${marca.suporteEmail}?subject=${encodeURIComponent("Integracao com ERP")}`}
                      data-testid="link-suporte-erp"
                    >
                      <Mail className="w-3.5 h-3.5" />Falar com o suporte
                    </a>
                  </Button>
                ) : (
                  /* Sem e-mail de suporte na marca nao ha link honesto a oferecer:
                     o chat existe e e o caminho real. Botao que nao leva a lugar
                     nenhum ensina o provedor a desconfiar da tela. */
                  <p className="text-xs mt-4" style={{ color: "var(--text-faint)" }}>
                    Abra o chat de suporte no canto da tela para solicitar a integracao.
                  </p>
                )}
              </div>
            ) : (
              <div>
                {erpsVisiveis.map((intg, idx) => {
                  const catalogo = erpDoCatalogo(intg.erpSource);
                  const nome = nomeDoErp(intg.erpSource);
                  const estado = estadoDaIntegracao(intg, conectorPendente(intg.erpSource));
                  const tom = TOM_ESTADO[estado.tom];
                  /* Havia aqui uma medida "intervalo Xh", lida de
                     sync_interval_hours. Nenhum agendador le essa coluna: a
                     cadencia real e a agenda de madrugada do servidor, que
                     ainda por cima e ajustavel por ambiente. Publicar "12h"
                     era publicar um numero que o sistema nao honra, e cravar a
                     agenda aqui apenas trocaria de numero errado. A verdade que
                     esta tela consegue provar e "ultima sync" — o resto o
                     provedor le no historico logo abaixo. */
                  const medidas = [
                    { id: "sincronizados", rotulo: "sincronizados", valor: (intg.totalSynced ?? 0).toLocaleString("pt-BR"), cor: "var(--text)" },
                    { id: "erros",         rotulo: "erros",         valor: (intg.totalErrors ?? 0).toLocaleString("pt-BR"), cor: (intg.totalErrors ?? 0) > 0 ? "var(--past)" : "var(--text)" },
                    { id: "ultima-sync",   rotulo: "ultima sync",   valor: relDate(intg.lastSyncAt), cor: "var(--text)" },
                  ];
                  return (
                    <div
                      key={intg.erpSource}
                      className="px-4 py-4"
                      style={{ borderTop: idx > 0 ? "1px solid var(--border)" : undefined }}
                      data-testid={`erp-connector-${intg.erpSource}`}
                    >
                      <div className="flex items-start gap-3">
                        {catalogo?.logoBase64 ? (
                          <img
                            src={catalogo.logoBase64}
                            alt={nome}
                            className="w-8 h-8 object-contain rounded shrink-0"
                            style={{ border: "1px solid var(--border)" }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded flex items-center justify-center shrink-0" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}>
                            <span className="text-xs font-semibold" style={{ fontFamily: "var(--font-mono)" }}>{nome.charAt(0)}</span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold leading-tight" style={{ color: "var(--text)" }}>{nome}</p>
                            <span
                              className={SELO_ESTADO}
                              style={{
                                fontFamily: "var(--font-mono)",
                                color: tom.fg,
                                background: tom.bg,
                                border: `1px solid ${tom.bd}`,
                              }}
                              data-testid={`erp-status-${intg.erpSource}`}
                            >
                              {estado.texto}
                            </span>
                          </div>
                          {estado.detalhe && (
                            <p className="text-xs mt-1 leading-snug max-w-xl" style={{ color: estado.tom === "gated" ? "var(--gated)" : "var(--text-muted)" }}>
                              {estado.detalhe}
                            </p>
                          )}
                          {/* Os contadores viviam dentro do formulario expandido.
                              Sem formulario, o card nao expande mais — eles sobem
                              para a linha principal, que e onde o provedor olha. */}
                          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
                            {medidas.map(m => (
                              <div key={m.id}>
                                <p className="text-[10px] uppercase" style={{ fontFamily: "var(--font-mono)", letterSpacing: "var(--track-wide)", color: "var(--text-faint)" }}>
                                  {m.rotulo}
                                </p>
                                <p
                                  className="text-sm leading-tight mt-0.5"
                                  style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontWeight: 500, color: m.cor }}
                                  data-testid={`erp-${intg.erpSource}-${m.id}`}
                                >
                                  {m.valor}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Historico de sincronizacao */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
                <ClipboardList className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
                Historico de sincronizacao
              </h3>
              <span className="text-xs" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--text-muted)" }}>
                {erroLogs || carregandoLogs ? "—" : `${syncLogs.length} registros`}
              </span>
            </div>
            {carregandoLogs ? (
              <div data-testid="loading-sync-logs">
                {[0, 1, 2].map(i => (
                  <div key={i} className="px-4 py-3.5" style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                    <div className="h-3 w-full max-w-md rounded animate-pulse" style={{ background: "var(--surface-inset)" }} />
                  </div>
                ))}
              </div>
            ) : erroLogs ? (
              /* Mesmo raciocinio do estado vazio das integracoes: `= []` no
                 default esconde a falha, e "nenhuma sincronizacao ainda" diz ao
                 provedor que o ERP nunca rodou. */
              <div className="flex flex-col items-center justify-center text-center px-6 py-14" data-testid="error-sync-logs">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ background: "var(--past-bg)", border: "1px solid var(--past-border)" }}>
                  <AlertTriangle className="w-6 h-6" style={{ color: "var(--past)" }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Nao foi possivel carregar o historico</p>
                <p className="text-xs mt-1.5 max-w-md leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  As varreduras que ja rodaram continuam registradas — o painel e que nao conseguiu le-las agora.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 h-8 text-xs gap-1.5"
                  onClick={() => refetchSyncLogs()}
                  data-testid="button-retry-sync-logs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />Tentar de novo
                </Button>
              </div>
            ) : syncLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center px-6 py-14" data-testid="empty-sync-logs">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ background: "var(--surface-inset)" }}>
                  <Clock className="w-6 h-6" style={{ color: "var(--text-faint)" }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Nenhuma sincronizacao ainda</p>
                <p className="text-xs mt-1.5 max-w-md leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Assim que a primeira varredura do seu ERP rodar, cada tentativa aparece aqui com quantos
                  registros entraram, quantos falharam e a que horas.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow style={{ background: "var(--surface-2)" }}>
                      {/* O TableHead compartilhado ja e mono em caixa alta, mas com
                          a abertura cravada em 0.08em — mais larga que a dos rotulos
                          dos cartoes desta mesma aba, que usam o token. Duas aberturas
                          de label na mesma tela desalinham a leitura. */}
                      <TableHead className={COLUNA_HISTORICO}>ERP</TableHead>
                      <TableHead className={COLUNA_HISTORICO}>Data/Hora</TableHead>
                      <TableHead className={`${COLUNA_HISTORICO} text-right`}>Sincronizados</TableHead>
                      <TableHead className={`${COLUNA_HISTORICO} text-right`}>Erros</TableHead>
                      <TableHead className={`${COLUNA_HISTORICO} text-center`}>Status</TableHead>
                      <TableHead className={`${COLUNA_HISTORICO} hidden md:table-cell`}>IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {syncLogs.slice(0, 20).map((log: any) => {
                      const desfecho = desfechoDoLog(String(log.status ?? ""));
                      const tomLog = TOM_ESTADO[desfecho.tom];
                      return (
                        <TableRow key={log.id} data-testid={`row-sync-log-${log.id}`}>
                          <TableCell>
                            {/* Nome humano, na mesma forma que o resto da aba e que
                                a tela do superadmin usam. Sem caixa alta e sem
                                tracking cravado: isto virou nome proprio, e nao um
                                label mono — a abertura de `--track-wide` existe para
                                label em caixa alta, e aplicada a um nome so o afasta. */}
                            <span className="text-xs font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                              {nomeDoErp(log.erpSource)}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--text-muted)" }}>
                            {new Date(log.syncedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs font-semibold" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
                              {/* Linha de religamento nao contou registro nenhum;
                                  "0" ali leria como varredura que nao trouxe nada. */}
                              {log.status === "reativado" ? "—" : log.upserted}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs font-semibold" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: log.errors > 0 ? "var(--past)" : "var(--text-muted)" }}>
                              {log.status === "reativado" ? "—" : log.errors}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span
                              className={SELO_ESTADO}
                              style={{ fontFamily: "var(--font-mono)", color: tomLog.fg, background: tomLog.bg, border: `1px solid ${tomLog.bd}` }}
                            >
                              {desfecho.rotulo}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs hidden md:table-cell" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--text-muted)" }}>
                            {log.ipAddress ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ======================== ANTI-FRAUDE ======================== */}
        <TabsContent value="anti-fraude">
          <AbaAntiFraude podeEditar={user?.role === "admin"} />
        </TabsContent>

        {/* ========================= SUPORTE ========================= */}
        {/* `podeEditar` e `role === "admin"` de proposito, e nao um `!== "user"`:
            durante uma sessao de suporte a role da sessao e `superadmin`, entao
            quem esta USANDO o acesso ve esta aba somente para ler. Um superadmin
            conectado nao renova a propria janela nem a fecha — abrir e fechar a
            porta e do dono da conta, senao a liberacao de 2 horas deixa de ter
            fim. */}
        {user?.role !== "user" && (
          <TabsContent value="suporte">
            <AbaSuporte podeEditar={user?.role === "admin"} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
