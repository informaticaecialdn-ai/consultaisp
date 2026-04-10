import { useQuery } from "@tanstack/react-query";
import { STALE_DASHBOARD } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Search,
  CreditCard,
  Shield,
  AlertTriangle,
  DollarSign,
  Package,
  TrendingUp,
  Clock,
  Users,
  Activity,
  ChevronRight,
  Building2,
  Wifi,
} from "lucide-react";

const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardPage() {
  const { provider, partnerCode } = useAuth();

  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"], staleTime: STALE_DASHBOARD });

  const { data: benchmarkData } = useQuery<any>({ queryKey: ["/api/isp-consultations/benchmark"], staleTime: 5 * 60 * 1000 });
  const provedoresParceiros = benchmarkData?.providersInRegion ?? 0;

  const creditos = stats?.ispCredits ?? 0;
  const inadimplentes = stats?.defaulters ?? 0;
  const totalAberto = Number(stats?.overdueTotal ?? 0);
  const equipRetidos = stats?.unreturnedEquipmentCount ?? 0;
  const valorEquip = Number(stats?.unreturnedEquipmentValue ?? 0);
  const consultasHoje = stats?.consultationsToday ?? 0;
  const consultasMes = stats?.consultationsThisMonth ?? 0;
  const alertasAtivos = stats?.activeAlerts ?? 0;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl mx-auto" data-testid="dashboard-page">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-ink)]" data-testid="text-dashboard-title">
            Painel do Provedor
          </h1>
          <p className="text-sm text-[var(--color-muted)]">{provider?.name}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {partnerCode && (
            <div className="flex items-center gap-2 border border-[var(--color-danger)] rounded-lg px-3 py-2 bg-[var(--color-danger-bg)]">
              <Shield className="w-4 h-4 text-[var(--color-danger)]" />
              <div>
                <p className="font-mono text-sm font-bold text-[var(--color-danger)] leading-none" data-testid="text-partner-code">
                  {partnerCode}
                </p>
                <p className="text-[10px] text-[var(--color-muted)] leading-tight mt-0.5">seu codigo</p>
              </div>
            </div>
          )}
          <Link href="/creditos">
            <div className="flex items-center gap-2 border border-[var(--color-navy)] rounded-lg px-3 py-2 bg-[var(--color-navy-bg)] cursor-pointer hover:opacity-90 transition-opacity">
              <CreditCard className="w-4 h-4 text-[var(--color-navy)]" />
              <div className="text-right">
                <p className="font-mono text-lg font-bold text-[var(--color-navy)] leading-none" data-testid="text-credits">
                  {isLoading ? "..." : creditos}
                </p>
                <p className="text-xs text-[var(--color-muted)] leading-tight">creditos</p>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* Identidade na Rede */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 flex items-center gap-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800">
          <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Wifi className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Seu Provedor na Rede</p>
            <p className="font-bold text-lg text-[var(--color-ink)]">{provider?.name}</p>
            {partnerCode && (
              <p className="text-xs text-muted-foreground mt-0.5">Codigo: <span className="font-mono font-bold text-blue-600">{partnerCode}</span></p>
            )}
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200 dark:border-green-800">
          <div className="w-12 h-12 rounded-xl bg-green-500 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Provedores Parceiros</p>
            <p className="font-bold text-lg text-[var(--color-ink)]">{provedoresParceiros} provedores</p>
            <p className="text-xs text-muted-foreground mt-0.5">compartilhando dados na sua regiao</p>
          </div>
        </Card>
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          icon={Search}
          label="Consultas Hoje"
          value={isLoading ? null : consultasHoje}
          color="var(--color-navy)"
          testId="card-today"
        />
        <KpiCard
          icon={TrendingUp}
          label="Consultas no Mes"
          value={isLoading ? null : consultasMes}
          color="var(--color-navy)"
          testId="card-month"
        />
        <KpiCard
          icon={CreditCard}
          label="Creditos Restantes"
          value={isLoading ? null : creditos}
          color={creditos < 10 ? "var(--color-danger)" : "var(--color-navy)"}
          testId="card-credits"
        />
      </div>

      {/* Acoes rapidas */}
      <div>
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-[var(--color-navy)]" />
            <h2 className="font-semibold text-sm text-[var(--color-ink)]">Acoes rapidas</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link href="/consulta-isp">
              <ActionCard
                icon={Search}
                title="Consultar CPF/CNPJ"
                desc="Verificar score e historico"
                color="var(--color-navy)"
              />
            </Link>
            <Link href="/consulta-spc">
              <ActionCard
                icon={Users}
                title="Consulta SPC"
                desc="Score de credito SPC"
                color="#8e44ad"
              />
            </Link>
            <Link href="/anti-fraude">
              <ActionCard
                icon={Shield}
                title="Anti-Fraude"
                desc="Alertas e migradores"
                color="var(--color-danger)"
              />
            </Link>
            <Link href="/creditos">
              <ActionCard
                icon={CreditCard}
                title="Comprar Creditos"
                desc="Recarregar consultas"
                color="var(--color-gold)"
              />
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color, testId }: {
  icon: any; label: string; value: any; sub?: string; color: string; testId: string;
}) {
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color }} />
        <span className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">{label}</span>
      </div>
      {value === null ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <>
          <p className="font-mono text-2xl font-bold" style={{ color }} data-testid={`value-${testId}`}>{value}</p>
          {sub && <p className="text-xs text-[var(--color-muted)] mt-1">{sub}</p>}
        </>
      )}
    </Card>
  );
}

function ActionCard({ icon: Icon, title, desc, color }: {
  icon: any; title: string; desc: string; color: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}15` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
        <p className="text-xs text-[var(--color-muted)]">{desc}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-[var(--color-muted)] ml-auto" />
    </div>
  );
}

function RiskItem({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
      <p className="font-mono text-lg font-bold text-[var(--color-ink)] mt-1">{value}</p>
    </div>
  );
}
