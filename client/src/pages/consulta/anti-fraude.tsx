import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCO } from "@/components/painel/ui";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Link } from "wouter";
import {
  Settings2,
  ShieldAlert, AlertTriangle, DollarSign,
  CheckCircle, XCircle,
  Search, Clock, Package, Users, RefreshCw,
} from "lucide-react";

type AntiFraudAlert = {
  id: number;
  providerId: number;
  customerId: number | null;
  customerProviderId?: number;
  consultingProviderId: number | null;
  consultingProviderName: string | null;
  customerName: string | null;
  customerCpfCnpj: string | null;
  type: string;
  severity: string;
  message: string;
  riskScore: number | null;
  riskLevel: string | null;
  riskFactors: string[] | null;
  daysOverdue: number | null;
  overdueAmount: string | null;
  equipmentNotReturned: number | null;
  equipmentValue: string | null;
  recentConsultations: number | null;
  resolved: boolean;
  status: string;
  createdAt: string | null;
  /* Vem da regra de fuga (server/services/antifraude-rules.ts). O rótulo do
     card sai daqui, não de uma contagem de dias de atraso. */
  motivos?: string[];
  motivoLabel?: string;
  diasDeContrato?: number | null;
  /* A situação de HOJE do cliente, ao lado da foto que o alerta guardou:
     é o que diz se ele pagou ou saiu desde o aviso. */
  atual?: {
    contractStatus: string | null;
    daysOverdue: number;
    overdueAmount: string;
    emRisco: boolean;
  } | null;
  _source?: "fuga" | "proactive" | "legado";
};

const rotuloContrato = (s: string | null | undefined): string =>
  s === "active" ? "Ativo" : s === "suspended" ? "Suspenso" : s === "cancelled" ? "Encerrado" : "—";

const fmt = (v: number | string | null | undefined): string => {
  const num = typeof v === "string" ? parseFloat(v) : (v || 0);
  return `R$ ${num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtCpf = (doc: string): string => {
  const d = doc.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return doc;
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}min atras`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h atras`;
  const days = Math.floor(diff / 86400000);
  return `${days}d atras`;
}

// Custo de instalacao padrao (configuravel futuramente pelo provedor)
const CUSTO_INSTALACAO = 150;

export default function AntiFraudePage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "resolved">("active");

  const { data: alerts = [], isLoading: alertsLoading, refetch } = useQuery<AntiFraudAlert[]>({
    queryKey: ["/api/anti-fraud/alerts"],
    staleTime: 30000,
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/anti-fraud/alerts/${id}/status`, { status: "resolved" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] }); toast({ title: "Alerta resolvido" }); },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/anti-fraud/alerts/${id}/status`, { status: "dismissed" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/anti-fraud/alerts"] }); toast({ title: "Alerta ignorado" }); },
  });

  const activeAlerts = alerts.filter(a => a.status === "new" || a.status === "active");
  const resolvedAlerts = alerts.filter(a => a.status === "resolved" || a.status === "dismissed");
  const displayAlerts = filter === "active" ? activeAlerts : filter === "resolved" ? resolvedAlerts : alerts;

  const filtered = search
    ? displayAlerts.filter(a =>
        (a.customerName || "").toLowerCase().includes(search.toLowerCase()) ||
        (a.customerCpfCnpj || "").includes(search)
      )
    : displayAlerts;

  /* KPIs — só somam o que é MEU e está em risco de fugir agora.
     Antes entrava qualquer alerta da lista, inclusive dívida de cliente de
     outro provedor: o total dizia "prejuízo" sobre dinheiro que não era do
     provedor que estava olhando a tela. */
  const emRisco = activeAlerts.filter(a => a.customerProviderId === undefined || a.customerProviderId === a.providerId);
  const totalDivida = emRisco.reduce((s, a) => s + parseFloat(a.overdueAmount || "0"), 0);
  const totalEquip = emRisco.reduce((s, a) => s + parseFloat(a.equipmentValue || "0"), 0);
  const qtdEquip = emRisco.reduce((s, a) => s + (a.equipmentNotReturned || 0), 0);
  const totalInstalacao = emRisco.length * CUSTO_INSTALACAO;
  const totalPrejuizo = totalDivida + totalEquip + totalInstalacao;

  return (
    <div className="p-4 lg:p-6 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-[var(--color-danger)]" />
            Protecao Anti-Fraude
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cliente ativo seu que outro provedor da rede consultou — por padrão, só quem está devendo.
            O que vigiar você escolhe em Regras.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/painel-provedor?tab=anti-fraude">
            <Button variant="outline" size="sm" className="gap-2" data-testid="link-regras-anti-fraude">
              <Settings2 className="w-4 h-4" />
              Regras
            </Button>
          </Link>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 bg-[var(--color-danger-bg)]">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-[var(--color-danger)]" />
            <span className="text-sm font-medium text-[var(--color-muted)] uppercase">Alertas Ativos</span>
          </div>
          <p className="text-2xl font-bold text-[var(--color-danger)] tabular-nums">{emRisco.length}</p>
        </Card>
        <Card className="p-5 bg-[var(--color-gold-bg)]">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-5 h-5 text-[var(--color-gold)]" />
            <span className="text-sm font-medium text-[var(--color-muted)] uppercase">Dívidas em Risco</span>
          </div>
          <p className="text-2xl font-bold text-[var(--color-gold)] tabular-nums">{fmt(totalDivida)}</p>
        </Card>
        <Card className="p-5 bg-[var(--color-gold-bg)]">
          <div className="flex items-center gap-2 mb-3">
            <Package className="w-5 h-5 text-[var(--color-gold)]" />
            <span className="text-sm font-medium text-[var(--color-muted)] uppercase">Equipamentos</span>
          </div>
          {/* Era activeAlerts.length: mostrava a contagem de ALERTAS no card de
              equipamentos, então 8 alertas viravam "8 equipamentos". */}
          <p className="text-2xl font-bold text-[var(--color-gold)] tabular-nums">{qtdEquip}</p>
          <p className="text-sm text-[var(--color-muted)] tabular-nums">{fmt(totalEquip)} em comodato</p>
        </Card>
        <Card className="p-5 bg-[var(--color-danger-bg)] border-[var(--color-danger)]/20">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-[var(--color-danger)]" />
            <span className="text-sm font-medium text-[var(--color-muted)] uppercase">Prejuízo Total Estimado</span>
          </div>
          <p className="text-2xl font-bold text-[var(--color-danger)] tabular-nums">{fmt(totalPrejuizo)}</p>
          <p className="text-sm text-[var(--color-muted)]">dívida + equip + instalação</p>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant={filter === "active" ? "default" : "outline"} size="sm" onClick={() => setFilter("active")}>
            Ativos ({activeAlerts.length})
          </Button>
          <Button variant={filter === "resolved" ? "default" : "outline"} size="sm" onClick={() => setFilter("resolved")}>
            Resolvidos ({resolvedAlerts.length})
          </Button>
          <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>
            Todos ({alerts.length})
          </Button>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome ou CPF..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-3 py-1.5 text-sm border rounded-md bg-background w-full sm:w-64"
          />
        </div>
      </div>

      {/* Cards de Alertas */}
      {alertsLoading ? (
        /* Skeleton em vez de texto — DESIGN_SYSTEM.md secao 6 */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="alerts-loading">
          {[0, 1].map(i => (
            <div key={i} className="rounded-lg bg-[var(--color-surface)] shadow-[0_0_0_1px_var(--ring-subtle)] p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="w-9 h-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg bg-[var(--color-surface)] shadow-[0_0_0_1px_var(--ring-subtle)] px-6 py-12 text-center" data-testid="alerts-empty">
          <ShieldAlert className="w-8 h-8 mx-auto mb-4 text-[var(--color-success)]" />
          <h3 className="font-display font-semibold text-base text-[var(--color-ink)]">
            Nenhum alerta ativo
          </h3>
          <p className="mt-2 mb-6 mx-auto max-w-[46ch] text-sm text-[var(--color-muted)]">
            Nenhum cliente seu, ativo e com fatura vencida, foi consultado por outro provedor.
            Você é avisado aqui, por e-mail e por WhatsApp assim que acontecer.
          </p>
          <a
            href="/inadimplentes"
            data-testid="link-empty-inadimplentes"
            className={`inline-flex items-center min-h-[44px] font-mono text-[11px] tracking-[0.06em] px-4 py-2 rounded-lg bg-[var(--color-tag-bg)] text-[var(--color-ink)] hover:shadow-[0_0_0_1px_var(--ring-warm)] ${FOCO} motion-safe:transition-shadow`}
          >
            VER INADIMPLENTES
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((alert) => (
            <AlertCard key={alert.id} alert={alert} onResolve={resolveMutation.mutate} onDismiss={dismissMutation.mutate} />
          ))}
        </div>
      )}

      {/* Aqui havia um ranking com TODOS os clientes do provedor ordenados por
          dívida — o oposto do que esta tela é. Removido junto com a chamada a
          /api/anti-fraud/customer-risk, que fazia 1+3N queries sequenciais
          sobre a base inteira a cada abertura. A carteira de inadimplentes tem
          página própria; a sidebar já leva até ela. */}
    </div>
  );
}

function AlertCard({ alert, onResolve, onDismiss }: {
  alert: AntiFraudAlert;
  onResolve: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const daysOverdue = alert.daysOverdue || 0;
  const overdueAmt = parseFloat(alert.overdueAmount || "0");
  const equipCount = alert.equipmentNotReturned || 0;
  const equipValue = parseFloat(alert.equipmentValue || "0");
  const totalPrejuizo = overdueAmt + equipValue + CUSTO_INSTALACAO;
  const isResolved = alert.status === "resolved" || alert.status === "dismissed";
  const atual = alert.atual ?? null;
  /* O cliente pagou ou saiu depois do aviso: a foto do alerta continua, e a
     situação de hoje é dita ao lado — quem decide resolver é o provedor. */
  const mudouDesdeOAviso = !isResolved && alert._source === "fuga" && atual !== null && !atual.emRisco;

  return (
    <Card className={`overflow-hidden ${isResolved ? "opacity-60" : ""}`}>
      {/* Header do card — a cor é a severidade, que vem do prejuízo em jogo */}
      <div className={`px-4 py-2 flex items-center justify-between ${
        alert.severity === "critical" ? "bg-[var(--color-danger)] text-white" :
        alert.severity === "high" ? "bg-[var(--score-low)] text-white" :
        "bg-[var(--color-gold)] text-white"
      }`}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-semibold text-sm">
            {(alert.motivoLabel || "Fuga · dívida ativa").toUpperCase()}
          </span>
        </div>
        <span className="text-xs opacity-90">
          {alert.createdAt ? new Date(alert.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : ""}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* Nome + CPF (dados completos — cliente proprio) */}
        <div>
          <p className="font-bold text-lg">{alert.customerName || "Cliente"}</p>
          <p className="font-mono text-sm text-muted-foreground">{alert.customerCpfCnpj ? fmtCpf(alert.customerCpfCnpj) : ""}</p>
        </div>

        {/* Info do contrato */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <DollarSign className="w-3 h-3" />
              Divida
            </div>
            <p className="font-bold text-[var(--color-danger)]">{fmt(overdueAmt)}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Clock className="w-3 h-3" />
              Dias de Atraso
            </div>
            <p className={`font-bold ${daysOverdue > 90 ? "text-[var(--color-danger)]" : "text-[var(--score-low)]"}`}>{daysOverdue} dias</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Package className="w-3 h-3" />
              Equipamento
            </div>
            {equipCount > 0 ? (
              <>
                <p className="font-bold">{equipCount} un.</p>
                <p className="text-xs text-muted-foreground">{fmt(equipValue)}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sem registro</p>
            )}
          </div>
          {/* Aqui havia um "score" inventado por uma fórmula local. O que o
              provedor precisa saber é se o contrato ainda está de pé. */}
          <div className="bg-muted/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <ShieldAlert className="w-3 h-3" />
              Contrato
            </div>
            <p className={`font-bold ${atual?.contractStatus === "cancelled" ? "text-muted-foreground" : ""}`}>
              {rotuloContrato(atual?.contractStatus)}
            </p>
            <p className="text-xs text-muted-foreground">
              {atual ? "na última sincronização" : "sem sincronização"}
            </p>
          </div>
        </div>

        {mudouDesdeOAviso && (
          <div className="rounded-lg px-3 py-2 text-sm bg-[var(--surface-2)] text-[var(--text-2)]" data-testid="alerta-mudou">
            <span className="font-semibold">Hoje:</span>{" "}
            {atual!.contractStatus === "cancelled"
              ? "contrato encerrado"
              : atual!.daysOverdue > 0
                ? `${fmt(atual!.overdueAmount)} vencidos · ${atual!.daysOverdue} dias`
                : "sem fatura vencida"}
            {" "}— já pode resolver o alerta.
          </div>
        )}

        {/* Quem consultou + data */}
        {alert.consultingProviderName && (
          <div className="flex items-center justify-between gap-2 bg-[var(--color-brand-bg)] rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[var(--color-brand)]" />
              <span className="text-sm">Consultado por</span>
              <span className="font-semibold text-sm">{alert.consultingProviderName}</span>
            </div>
            {alert.createdAt && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(alert.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        )}

        {/* Prejuizo: o que se perde SE o cliente migrar */}
        <div className="bg-[var(--color-danger-bg)] border border-[var(--color-danger)] rounded-lg p-3">
          <p className="text-xs font-semibold text-[var(--color-danger)] uppercase mb-2">Prejuizo Estimado se Migrar</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Divida</p>
              <p className="font-semibold text-sm">{fmt(overdueAmt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Equipamento</p>
              <p className="font-semibold text-sm">{fmt(equipValue)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Instalacao</p>
              <p className="font-semibold text-sm">{fmt(CUSTO_INSTALACAO)}</p>
            </div>
          </div>
          <div className="border-t border-[var(--color-danger)] mt-2 pt-2 text-center">
            <p className="text-lg font-bold text-[var(--color-danger)]">{fmt(totalPrejuizo)}</p>
          </div>
        </div>

        {/* Acoes */}
        {!isResolved && (
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" className="gap-1.5 flex-1 bg-[var(--color-success)] hover:opacity-90" onClick={() => onResolve(alert.id)}>
              <CheckCircle className="w-3.5 h-3.5" /> Resolvido
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 flex-1" onClick={() => onDismiss(alert.id)}>
              <XCircle className="w-3.5 h-3.5" /> Ignorar
            </Button>
            {/* Havia aqui um botão "Ligar" com href={`tel:${CPF}`}: discava o
                documento do cliente como se fosse telefone. O alerta não traz
                telefone, então o caminho honesto é levar para a consulta do
                documento, onde o cadastro está. */}
            <Link href={`/consulta-isp?doc=${(alert.customerCpfCnpj || "").replace(/\D/g, "")}`} className="flex-1">
              <Button size="sm" variant="outline" className="gap-1.5 w-full">
                <Search className="w-3.5 h-3.5" /> Abrir consulta
              </Button>
            </Link>
          </div>
        )}
        {isResolved && (
          <div className="text-center py-1">
            <Badge variant="outline" className="text-xs">{alert.status === "resolved" ? "Resolvido" : "Ignorado"}</Badge>
          </div>
        )}
      </div>
    </Card>
  );
}

function RiskBadge({ level }: { level: string }) {
  const config: Record<string, string> = {
    critical: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
    high: "bg-[var(--color-gold-bg)] text-[var(--score-low)]",
    medium: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]",
    low: "bg-[var(--color-success-bg)] text-[var(--color-success)]",
  };
  const labels: Record<string, string> = { critical: "Critico", high: "Alto", medium: "Medio", low: "Baixo" };
  return <Badge className={`text-xs ${config[level] || config.low}`}>{labels[level] || level}</Badge>;
}
