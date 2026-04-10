import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useState, useMemo } from "react";
import {
  Users,
  Search,
  Download,
  AlertTriangle,
  Phone,
  MessageSquare,
  RefreshCw,
  Package,
  Wifi,
  Clock,
  Filter,
  MapPin,
  Database,
  Bell,
  Network,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { apiRequest, STALE_DASHBOARD, STALE_LISTS } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── ERP config ──────────────────────────────────────────────────────────────
const ERP_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  ixc:            { label: "iXC Soft",        color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",        dot: "bg-blue-500" },
  sgp:            { label: "SGP",             color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300", dot: "bg-purple-500" },
  mk:             { label: "MK Solutions",    color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",     dot: "bg-green-500" },
  tiacos:         { label: "Tiacos",          color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300", dot: "bg-orange-500" },
  hubsoft:        { label: "Hubsoft",         color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300", dot: "bg-indigo-500" },
  flyspeed:       { label: "Fly Speed",       color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",         dot: "bg-cyan-500" },
  netflash:       { label: "Netflash",        color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",         dot: "bg-teal-500" },
  voalle:         { label: "Voalle",          color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", dot: "bg-violet-500" },
  rbx:            { label: "RBX",             color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",         dot: "bg-rose-500" },
  unisat:         { label: "Unisat",          color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",     dot: "bg-amber-500" },
  clickisp:       { label: "ClickISP",        color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",             dot: "bg-sky-500" },
  radius_manager: { label: "Radius Manager",  color: "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300",         dot: "bg-lime-500" },
  manual:         { label: "Manual",          color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",            dot: "bg-gray-400" },
};

const RISK_CONFIG: Record<string, { label: string; badge: string }> = {
  critical: { label: "Critico",  badge: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]" },
  high:     { label: "Alto",     badge: "bg-[var(--color-gold-bg)] text-[var(--score-low)]" },
  medium:   { label: "Medio",    badge: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]" },
  low:      { label: "Baixo",    badge: "bg-[var(--color-success-bg)] text-[var(--color-success)]" },
};

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  "90+":   { label: "90+ dias",  badge: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]" },
  "60-90": { label: "60–90 dias", badge: "bg-[var(--color-gold-bg)] text-[var(--score-low)]" },
  "30-60": { label: "30–60 dias", badge: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]" },
  "1-30":  { label: "1–30 dias",  badge: "bg-[var(--color-navy-bg)] text-[var(--color-steel)]" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const formatCpfCnpj = (v: string) => {
  if (!v) return "—";
  const d = v.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return v;
};
const relativeDate = (d: string | null) => {
  if (!d) return "Nunca";
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (diff < 60) return `${diff}min atrás`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h atrás`;
  return `${Math.floor(diff / 1440)}d atrás`;
};

function ErpBadge({ source }: { source: string }) {
  const cfg = ERP_CONFIG[source] ?? ERP_CONFIG.manual;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} flex-shrink-0`} />
      {cfg.label}
    </span>
  );
}

function RiskBadge({ tier }: { tier: string }) {
  const cfg = RISK_CONFIG[tier] ?? RISK_CONFIG.low;
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
      {cfg.label}
    </span>
  );
}

function DaysBadge({ days }: { days: number }) {
  const cfg = days >= 90 ? STATUS_CONFIG["90+"]
    : days >= 60 ? STATUS_CONFIG["60-90"]
    : days >= 30 ? STATUS_CONFIG["30-60"]
    : STATUS_CONFIG["1-30"];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
      <Clock className="w-3 h-3" />
      {days}d
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function InadimplentesPage() {
  const { provider } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterErp, setFilterErp] = useState("all");
  const [filterRisk, setFilterRisk] = useState("all");

  const [lgpdTarget, setLgpdTarget] = useState<any | null>(null);
  const [redeTarget, setRedeTarget] = useState<any | null>(null);
  const [redeData, setRedeData] = useState<any | null>(null);
  const [redeLoading, setRedeLoading] = useState(false);

  const { data: stats } = useQuery<any>({ queryKey: ["/api/dashboard/stats"], staleTime: STALE_DASHBOARD });
  const { data: list = [], isLoading, refetch, isFetching } = useQuery<any[]>({
    queryKey: ["/api/inadimplentes"],
    staleTime: STALE_LISTS,
  });

  const lgpdMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/inadimplentes/${id}/notificar-lgpd`, { canal: "whatsapp" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Notificação registrada", description: "O contato LGPD/CDC foi registrado com sucesso." });
      setLgpdTarget(null);
    },
    onError: async (err: any) => {
      let msg = "Erro ao registrar notificação";
      try { const d = await err.json?.(); msg = d?.message ?? msg; } catch {}
      toast({ title: "Atenção", description: msg, variant: "destructive" });
      setLgpdTarget(null);
    },
  });

  const handleVerRede = async (customer: any) => {
    setRedeTarget(customer);
    setRedeData(null);
    setRedeLoading(true);
    try {
      const res = await apiRequest("GET", `/api/inadimplentes/${customer.cpfCnpj}/historico-rede`);
      const data = await res.json();
      setRedeData(data);
    } catch {
      setRedeData(null);
    } finally {
      setRedeLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return list.filter(d => {
      if (term && !d.name?.toLowerCase().includes(term) && !d.cpfCnpj?.includes(term) && !d.city?.toLowerCase().includes(term)) return false;
      if (filterErp !== "all" && (d.erpSource ?? "manual") !== filterErp) return false;
      if (filterRisk !== "all" && (d.riskTier ?? "low") !== filterRisk) return false;
      return true;
    });
  }, [list, search, filterErp, filterRisk]);

  const totalAberto = filtered.reduce((s, d) => s + Number(d.totalOverdueAmount || 0), 0);
  const totalEquip  = filtered.reduce((s, d) => s + (d.unreturnedEquipmentCount || 0), 0);
  const totalEquipVal = filtered.reduce((s, d) => s + (d.unreturnedEquipmentValue || 0), 0);

  const erpSources = [...new Set(list.map(d => d.erpSource ?? "manual"))];

  const handleExport = () => {
    const rows = [
      ["Nome", "CPF/CNPJ", "Cidade", "UF", "ERP", "Valor em Aberto", "Dias Atraso", "Risco", "Equipamentos", "Ultimo Sync"],
      ...filtered.map(d => [
        d.name, d.cpfCnpj, d.city ?? "", d.state ?? "",
        ERP_CONFIG[d.erpSource ?? "manual"]?.label ?? "Manual",
        Number(d.totalOverdueAmount || 0).toFixed(2),
        d.maxDaysOverdue ?? 0,
        RISK_CONFIG[d.riskTier ?? "low"]?.label ?? "Baixo",
        d.unreturnedEquipmentCount ?? 0,
        d.lastSyncAt ?? "",
      ]),
    ];
    const csv = rows.map(r => r.join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "inadimplentes.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 lg:p-6 space-y-5" data-testid="inadimplentes-page">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center shadow-sm">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight" data-testid="text-inadimplentes-title">Base de Inadimplentes</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Clientes importados via integracao com ERPs · {provider?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-xs"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-sync"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Sincronizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 text-xs"
            onClick={handleExport}
            data-testid="button-export"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Inadimplentes",
            value: isLoading ? null : filtered.length,
            sub: `de ${list.length} total`,
            icon: Users,
            accent: "from-rose-500 to-red-600",
            iconBg: "bg-rose-100 dark:bg-rose-900/30",
            iconColor: "text-rose-600",
            testId: "stat-defaulters",
          },
          {
            label: "Total em Aberto",
            value: isLoading ? null : `R$ ${fmt(totalAberto)}`,
            sub: "valor acumulado",
            icon: AlertTriangle,
            accent: "from-orange-500 to-amber-500",
            iconBg: "bg-orange-100 dark:bg-orange-900/30",
            iconColor: "text-orange-600",
            testId: "stat-total",
          },
          {
            label: "Equipamentos Retidos",
            value: isLoading ? null : totalEquip,
            sub: "nao devolvidos",
            icon: Wifi,
            accent: "from-violet-500 to-indigo-600",
            iconBg: "bg-violet-100 dark:bg-violet-900/30",
            iconColor: "text-violet-600",
            testId: "stat-equipment",
          },
          {
            label: "Valor em Risco",
            value: isLoading ? null : `R$ ${fmt(totalEquipVal)}`,
            sub: "equipamentos retidos",
            icon: Package,
            accent: "from-sky-500 to-blue-600",
            iconBg: "bg-sky-100 dark:bg-sky-900/30",
            iconColor: "text-sky-600",
            testId: "stat-equip-value",
          },
        ].map(card => (
          <Card key={card.testId} className="relative overflow-hidden p-4" data-testid={card.testId}>
            <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${card.accent}`} />
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
              <div className={`w-7 h-7 rounded-lg ${card.iconBg} flex items-center justify-center flex-shrink-0`}>
                <card.icon className={`${card.iconColor}`} style={{ width: 14, height: 14 }} />
              </div>
            </div>
            {card.value === null ? (
              <Skeleton className="h-6 w-20" />
            ) : (
              <p className="text-lg font-bold tracking-tight" data-testid={`value-${card.testId}`}>{card.value}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              data-testid="input-search"
              placeholder="Nome, CPF/CNPJ ou cidade..."
              className="pl-8 h-8 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Select value={filterErp} onValueChange={setFilterErp} data-testid="select-erp">
            <SelectTrigger className="h-8 w-[150px] text-xs" data-testid="select-trigger-erp">
              <Filter className="w-3 h-3 mr-1" />
              <SelectValue placeholder="ERP Origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os ERPs</SelectItem>
              {Object.entries(ERP_CONFIG).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterRisk} onValueChange={setFilterRisk} data-testid="select-risk">
            <SelectTrigger className="h-8 w-[140px] text-xs" data-testid="select-trigger-risk">
              <AlertTriangle className="w-3 h-3 mr-1" />
              <SelectValue placeholder="Risco" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os riscos</SelectItem>
              {Object.entries(RISK_CONFIG).map(([key, cfg]) => (
                <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(search || filterErp !== "all" || filterRisk !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => { setSearch(""); setFilterErp("all"); setFilterRisk("all"); }}
              data-testid="button-clear-filters"
            >
              Limpar filtros
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} registro{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-44" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-14" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
              <Database className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <p className="font-semibold text-muted-foreground">Nenhum inadimplente encontrado</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
              {list.length === 0
                ? "Configure as integracoes ERP para importar automaticamente os clientes inadimplentes."
                : "Tente ajustar os filtros para ver mais resultados."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold w-[240px]">Cliente</TableHead>
                  <TableHead className="text-xs font-semibold">Origem ERP</TableHead>
                  <TableHead className="text-xs font-semibold">Localidade</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Faturas</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Em Aberto</TableHead>
                  <TableHead className="text-xs font-semibold text-center">Atraso</TableHead>
                  <TableHead className="text-xs font-semibold text-center">Risco</TableHead>
                  <TableHead className="text-xs font-semibold text-center hidden lg:table-cell">Equip.</TableHead>
                  <TableHead className="text-xs font-semibold hidden xl:table-cell">Sincronizado</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(d => (
                  <TableRow
                    key={d.id}
                    className="hover:bg-muted/20 transition-colors"
                    data-testid={`row-inadimplente-${d.id}`}
                  >
                    {/* Cliente */}
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-xs font-bold text-muted-foreground uppercase">
                          {d.name?.charAt(0) ?? "?"}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate max-w-[160px]" data-testid={`text-name-${d.id}`}>{d.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{formatCpfCnpj(d.cpfCnpj)}</p>
                        </div>
                      </div>
                    </TableCell>

                    {/* ERP */}
                    <TableCell>
                      <ErpBadge source={d.erpSource ?? "manual"} />
                    </TableCell>

                    {/* Localidade */}
                    <TableCell>
                      {d.city ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          {d.city}{d.state ? `, ${d.state}` : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </TableCell>

                    {/* Faturas */}
                    <TableCell className="text-right">
                      <span className="inline-flex items-center justify-center bg-muted text-xs font-semibold w-7 h-6 rounded-md">
                        {d.overdueInvoicesCount ?? 0}
                      </span>
                    </TableCell>

                    {/* Em Aberto */}
                    <TableCell className="text-right">
                      <span className="text-sm font-bold text-rose-600 dark:text-rose-400" data-testid={`text-amount-${d.id}`}>
                        R$ {fmt(Number(d.totalOverdueAmount || 0))}
                      </span>
                    </TableCell>

                    {/* Atraso */}
                    <TableCell className="text-center">
                      <DaysBadge days={d.maxDaysOverdue ?? 0} />
                    </TableCell>

                    {/* Risco */}
                    <TableCell className="text-center">
                      <RiskBadge tier={d.riskTier ?? "low"} />
                    </TableCell>

                    {/* Equipamentos */}
                    <TableCell className="text-center hidden lg:table-cell">
                      {(d.unreturnedEquipmentCount ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 dark:text-violet-400">
                          <Wifi className="w-3 h-3" />
                          {d.unreturnedEquipmentCount}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </TableCell>

                    {/* Sincronizado */}
                    <TableCell className="hidden xl:table-cell">
                      <span className="text-xs text-muted-foreground">{relativeDate(d.lastSyncAt)}</span>
                    </TableCell>

                    {/* Ações */}
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {d.phone && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title={`Ligar: ${d.phone}`}
                            aria-label={`Ligar para ${d.phone}`}
                            data-testid={`btn-phone-${d.id}`}
                            onClick={() => window.open(`tel:${d.phone}`)}
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {d.phone && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                            title="WhatsApp"
                            aria-label="Enviar WhatsApp"
                            data-testid={`btn-whatsapp-${d.id}`}
                            onClick={() => window.open(`https://wa.me/55${d.phone?.replace(/\D/g, "")}`)}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                          title="Notificar LGPD/CDC"
                          aria-label="Notificar LGPD/CDC"
                          data-testid={`btn-lgpd-${d.id}`}
                          onClick={() => setLgpdTarget(d)}
                        >
                          <Bell className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          title="Ver histórico na rede"
                          aria-label="Ver histórico na rede"
                          data-testid={`btn-rede-${d.id}`}
                          onClick={() => handleVerRede(d)}
                        >
                          <Network className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* ERP integration info banner */}
      {list.length === 0 && !isLoading && (
        <Card className="p-4 border-dashed bg-muted/20">
          <div className="flex items-start gap-3">
            <RefreshCw className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Integracao com ERPs</p>
              <p className="text-xs text-muted-foreground mt-1">
                Configure a integracao com seu ERP (iXC Soft, SGP, MK Solutions, Tiacos, Hubsoft, Fly Speed) para importar automaticamente os clientes inadimplentes. Os dados serao sincronizados periodicamente e exibidos aqui com origem identificada.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {Object.entries(ERP_CONFIG).filter(([k]) => k !== "manual").map(([key, cfg]) => (
                  <ErpBadge key={key} source={key} />
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── LGPD Notification Modal (GAP 1) ── */}
      <Dialog open={!!lgpdTarget} onOpenChange={(o) => { if (!o) setLgpdTarget(null); }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-lgpd">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-600" />
              Registrar Notificação LGPD/CDC
            </DialogTitle>
            <DialogDescription>
              Registra que este cliente foi notificado sobre a negativação conforme exigido pela LGPD e Código de Defesa do Consumidor. Pode ser reenviada após 10 dias.
            </DialogDescription>
          </DialogHeader>
          {lgpdTarget && (
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3 text-sm">
              <p className="font-semibold">{lgpdTarget.name}</p>
              <p className="text-muted-foreground text-xs mt-0.5">{lgpdTarget.cpfCnpj}</p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setLgpdTarget(null)} data-testid="btn-lgpd-cancel">Cancelar</Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => lgpdTarget && lgpdMutation.mutate(lgpdTarget.id)}
              disabled={lgpdMutation.isPending}
              data-testid="btn-lgpd-confirm"
            >
              {lgpdMutation.isPending ? "Registrando..." : "Confirmar Notificação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Historico Rede Modal (GAP 4) ── */}
      <Dialog open={!!redeTarget} onOpenChange={(o) => { if (!o) { setRedeTarget(null); setRedeData(null); } }}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-rede">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="w-4 h-4 text-blue-600" />
              Histórico na Rede Colaborativa
            </DialogTitle>
            <DialogDescription>
              Dados de consultas e registros deste CPF/CNPJ nos últimos 90 dias entre todos os provedores da rede.
            </DialogDescription>
          </DialogHeader>
          {redeTarget && (
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3 text-sm mb-2">
              <p className="font-semibold">{redeTarget.name}</p>
              <p className="text-muted-foreground text-xs mt-0.5 font-mono">{redeTarget.cpfCnpj}</p>
            </div>
          )}
          {redeLoading && (
            <div className="space-y-2 py-2">
              <div className="h-4 bg-muted rounded animate-pulse" />
              <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
            </div>
          )}
          {!redeLoading && redeData && (
            <div className="space-y-3" data-testid="rede-data">
              {redeData.alerta_alta_frequencia && (
                <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                    Alta frequência de consultas — possível tentativa de contratação simultânea em múltiplos provedores.
                  </p>
                </div>
              )}
              {!redeData.alerta_alta_frequencia && (
                <div className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                  <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">Sem alertas de alta frequência nos últimos 90 dias.</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white dark:bg-slate-800 border rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-800 dark:text-slate-200" data-testid="text-rede-registros">{redeData.registros_externos}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Registros externos</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-800 dark:text-slate-200" data-testid="text-rede-consultas">{redeData.consultas_90d}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Consultas (90d)</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{redeData.provedores_distintos}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Provedores registradores</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{redeData.provedores_consultantes}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Provedores consultantes</p>
                </div>
              </div>
              {redeData.ultima_consulta && (
                <p className="text-xs text-muted-foreground text-center">
                  Última consulta: {new Date(redeData.ultima_consulta).toLocaleString("pt-BR")}
                </p>
              )}
            </div>
          )}
          {!redeLoading && !redeData && (
            <p className="text-sm text-muted-foreground text-center py-4">Não foi possível carregar os dados da rede.</p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setRedeTarget(null); setRedeData(null); }} data-testid="btn-rede-fechar">Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
