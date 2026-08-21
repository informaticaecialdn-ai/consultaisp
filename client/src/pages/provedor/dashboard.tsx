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
    <div className="p-4 lg:p-6 space-y-6" data-testid="dashboard-page">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-[19px] font-medium tracking-[-0.02em] text-[var(--text)] leading-tight"
            data-testid="text-dashboard-title"
          >
            Painel do Provedor
          </h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
            {(provider as any)?.tradeName || provider?.name}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {partnerCode && (
            <div className="flex items-center gap-2 border border-[var(--border)] rounded-lg px-2.5 py-1.5 bg-[var(--surface)]">
              <Shield className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} />
              <div>
                <p className="font-mono text-[12px] font-medium text-[var(--text)] tabular-nums leading-none" data-testid="text-partner-code">
                  {partnerCode}
                </p>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] leading-tight mt-1">
                  seu código
                </p>
              </div>
            </div>
          )}
          <Link href="/creditos">
            <div className="flex items-center gap-2 border border-[var(--border)] rounded-lg px-2.5 py-1.5 bg-[var(--surface)] cursor-pointer hover:border-[var(--border-strong)] motion-safe:transition-colors">
              <CreditCard className="w-4 h-4 flex-none text-[var(--brand)]" strokeWidth={2} />
              <div className="text-right">
                <p className="font-mono text-[15px] font-medium text-[var(--brand)] tabular-nums leading-none" data-testid="text-credits">
                  {isLoading ? "..." : creditos}
                </p>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] leading-tight mt-1">
                  créditos
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* Identidade na Rede */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="px-[14px] py-3">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 flex-none" strokeWidth={2} style={{ color: "var(--brand)" }} />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Seu provedor na rede
            </span>
          </div>
          <p className="mt-1.5 text-[15px] font-medium text-[var(--text)]">
            {(provider as any)?.tradeName || provider?.name}
          </p>
          {partnerCode && (
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
              Código: <span className="font-mono tabular-nums text-[var(--brand)]">{partnerCode}</span>
            </p>
          )}
        </Card>
        <Card className="px-[14px] py-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 flex-none" strokeWidth={2} style={{ color: "var(--brand)" }} />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Provedores parceiros
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[21px] font-medium tracking-[-0.02em] text-[var(--text)] tabular-nums">
            {provedoresParceiros}
          </p>
          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">compartilhando dados na sua região</p>
        </Card>
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          icon={Search}
          label="Consultas Hoje"
          value={isLoading ? null : consultasHoje}
          color="var(--color-brand)"
          testId="card-today"
        />
        <KpiCard
          icon={TrendingUp}
          label="Consultas no Mes"
          value={isLoading ? null : consultasMes}
          color="var(--color-brand)"
          testId="card-month"
        />
        <KpiCard
          icon={CreditCard}
          label="Creditos Restantes"
          value={isLoading ? null : creditos}
          color={creditos < 10 ? "var(--color-danger)" : "var(--color-brand)"}
          testId="card-credits"
        />
      </div>

      {/* Acoes rapidas */}
      <div>
        <Card className="p-0">
          {/* Cabecalho de card leva separador --border-faint, nao --border */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-faint)]">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Ações rápidas
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
            <Link href="/consulta-isp">
              <ActionCard
                icon={Search}
                title="Consultar CPF/CNPJ"
                desc="Verificar score e historico"
                color="var(--color-brand)"
              />
            </Link>
            <Link href="/consulta-spc">
              <ActionCard
                icon={Users}
                title="Consulta SPC"
                desc="Score de credito SPC"
                color="var(--color-brand)"
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
    /* Rotulo em mono caixa-alta e numero em mono tabular — mesma voz da sidebar
       e da Consulta ISP. O numero fica em --text: acento e acao, dado e dado.
       A cor semantica vive no icone. */
    <Card className="px-[14px] py-3" data-testid={testId}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 flex-none" strokeWidth={2} style={{ color }} />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {label}
        </span>
      </div>
      {value === null ? (
        <Skeleton className="h-7 w-16 mt-1.5" />
      ) : (
        <>
          <p
            className="mt-1.5 font-mono text-[21px] font-medium tracking-[-0.02em] text-[var(--text)] tabular-nums"
            data-testid={`value-${testId}`}
          >
            {value}
          </p>
          {sub && <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
        </>
      )}
    </Card>
  );
}

function ActionCard({ icon: Icon, title, desc, color }: {
  icon: any; title: string; desc: string; color: string;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] motion-safe:transition-colors cursor-pointer">
      <div className="w-8 h-8 rounded-lg grid place-items-center flex-none" style={{ background: `${color}14` }}>
        <Icon className="w-4 h-4" strokeWidth={2} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-[var(--text)] truncate">{title}</p>
        <p className="text-[12px] text-[var(--text-muted)] truncate">{desc}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-[var(--text-faint)] ml-auto flex-none" strokeWidth={2} />
    </div>
  );
}

function RiskItem({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className="font-mono text-[17px] font-medium text-[var(--text)] tabular-nums mt-1">{value}</p>
    </div>
  );
}
