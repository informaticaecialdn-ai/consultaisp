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
} from "lucide-react";

const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardPage() {
  const { provider, partnerCode } = useAuth();

  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"], staleTime: STALE_DASHBOARD });

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

      {/* KPIs principais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={AlertTriangle}
          label="Inadimplentes"
          value={isLoading ? null : inadimplentes}
          color="var(--color-danger)"
          testId="card-defaulters"
        />
        <KpiCard
          icon={DollarSign}
          label="Total em Aberto"
          value={isLoading ? null : `R$ ${fmt(totalAberto)}`}
          color="var(--color-gold)"
          testId="card-overdue"
        />
        <KpiCard
          icon={Package}
          label="Equip. Retidos"
          value={isLoading ? null : equipRetidos}
          sub={valorEquip > 0 ? `R$ ${fmt(valorEquip)}` : undefined}
          color="var(--color-navy)"
          testId="card-equipment"
        />
        <KpiCard
          icon={Activity}
          label="Alertas Ativos"
          value={isLoading ? null : alertasAtivos}
          color="#e67e22"
          testId="card-alerts"
        />
      </div>

      {/* Consultas + Acoes rapidas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Consultas do periodo */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[var(--color-navy)]" />
            <h2 className="font-semibold text-sm text-[var(--color-ink)]">Consultas</h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-muted)]">Hoje</span>
              <span className="font-mono text-lg font-bold text-[var(--color-ink)]">{isLoading ? "..." : consultasHoje}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-muted)]">Este mes</span>
              <span className="font-mono text-lg font-bold text-[var(--color-ink)]">{isLoading ? "..." : consultasMes}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-muted)]">Creditos restantes</span>
              <span className={`font-mono text-lg font-bold ${creditos < 10 ? "text-[var(--color-danger)]" : "text-[var(--color-navy)]"}`}>
                {isLoading ? "..." : creditos}
              </span>
            </div>
          </div>
        </Card>

        {/* Acoes rapidas */}
        <Card className="p-5 space-y-3 lg:col-span-2">
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

      {/* Resumo de risco */}
      {inadimplentes > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[var(--color-danger)]" />
              <h2 className="font-semibold text-sm text-[var(--color-ink)]">Resumo de Risco</h2>
            </div>
            <Link href="/consulta-isp">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                Ver detalhes <ChevronRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <RiskItem label="Inadimplentes" value={inadimplentes} />
            <RiskItem label="Valor em aberto" value={`R$ ${fmt(totalAberto)}`} />
            <RiskItem label="Equip. retidos" value={equipRetidos} />
            <RiskItem label="Valor equipamentos" value={`R$ ${fmt(valorEquip)}`} />
          </div>
        </Card>
      )}
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
