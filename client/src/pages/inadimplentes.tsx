import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";

// ─── ERP config ──────────────────────────────────────────────────────────────
const ERP_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  ixc:      { label: "iXC Soft",      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",      dot: "bg-blue-500" },
  sgp:      { label: "SGP",           color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300", dot: "bg-purple-500" },
  mk:       { label: "MK Solutions",  color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",   dot: "bg-green-500" },
  tiacos:   { label: "Tiacos",        color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300", dot: "bg-orange-500" },
  hubsoft:  { label: "Hubsoft",       color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300", dot: "bg-indigo-500" },
  flyspeed: { label: "Fly Speed",     color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",       dot: "bg-cyan-500" },
  netflash: { label: "Netflash",      color: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",       dot: "bg-teal-500" },
  manual:   { label: "Manual",        color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",          dot: "bg-gray-400" },
};

const RISK_CONFIG: Record<string, { label: string; badge: string }> = {
  critical: { label: "Critico",  badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  high:     { label: "Alto",     badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  medium:   { label: "Medio",    badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  low:      { label: "Baixo",    badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" },
};

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  "90+":   { label: "90+ dias",  badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  "60-90": { label: "60–90 dias", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  "30-60": { label: "30–60 dias", badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" },
  "1-30":  { label: "1–30 dias",  badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
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
  const [search, setSearch] = useState("");
  const [filterErp, setFilterErp] = useState("all");
  const [filterRisk, setFilterRisk] = useState("all");

  const { data: stats } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: list = [], isLoading, refetch, isFetching } = useQuery<any[]>({
    queryKey: ["/api/inadimplentes"],
  });

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
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto" data-testid="inadimplentes-page">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center shadow-sm">
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
                            data-testid={`btn-whatsapp-${d.id}`}
                            onClick={() => window.open(`https://wa.me/55${d.phone?.replace(/\D/g, "")}`)}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </Button>
                        )}
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
    </div>
  );
}
