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
  ScanSearch,
  BarChart3,
  ShieldAlert,
  MapPin,
  Upload,
  FileText,
  Globe,
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

      {/* Metricas. O card de creditos leva o CTA embutido: comprar do mesmo lugar
          onde se ve o saldo, sem viagem ate outra tela. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="px-[14px] py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Créditos disponíveis
            </span>
            <p
              className="mt-1.5 font-mono text-[21px] font-medium tracking-[-0.02em] text-[var(--text)] tabular-nums"
              data-testid="value-card-credits"
            >
              {isLoading ? "—" : creditos}
            </p>
          </div>
          <Link href="/creditos">
            <button
              type="button"
              data-testid="button-comprar-creditos"
              className="flex-none min-h-[36px] text-[12.5px] font-medium px-3 py-2 rounded bg-[var(--brand)] text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] motion-safe:transition-opacity active:scale-[0.97]"
            >
              Comprar
            </button>
          </Link>
        </Card>

        <KpiCard icon={Search}     label="Consultas hoje"       value={isLoading ? null : consultasHoje} testId="card-today" />
        <KpiCard icon={TrendingUp} label="Consultas no mês"     value={isLoading ? null : consultasMes}  testId="card-month" />
        <KpiCard icon={Building2}  label="Provedores parceiros" value={provedoresParceiros} sub="compartilhando dados" testId="card-partners" />
      </div>

      {/* Funcionalidades — toda capacidade do sistema vira card com icone, titulo e
          descricao. Antes existiam so 4 "acoes rapidas" e metade do sistema ficava
          invisivel para quem nao conhecia a sidebar de cor. */}
      <div>
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] mb-3">
          Funcionalidades disponíveis
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {FUNCIONALIDADES.map(f => (
            <Link key={f.url} href={f.url}>
              <FeatureCard {...f} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Uma cor de marca so: o ladrilho do icone usa --brand-soft em todos. A pele
   reserva saturacao para risco, entao variar a cor por card seria ruido. */
const FUNCIONALIDADES: Array<{ url: string; titulo: string; desc: string; Icone: any }> = [
  { url: "/consulta-isp",  titulo: "Consulta ISP",  Icone: ScanSearch,  desc: "Score de risco e histórico do CPF em toda a rede de provedores" },
  { url: "/consulta-spc",  titulo: "Consulta SPC",  Icone: BarChart3,   desc: "Consulta oficial no SPC Brasil, com restrições e protestos" },
  { url: "/anti-fraude",   titulo: "Anti-Fraude",   Icone: ShieldAlert, desc: "Alertas de migração e ranking de clientes em risco" },
  { url: "/inadimplentes", titulo: "Inadimplentes", Icone: Users,       desc: "Sua carteira de inadimplentes sincronizada do ERP" },
  { url: "/mapa-calor",    titulo: "Mapa de Calor", Icone: MapPin,      desc: "Concentração geográfica da inadimplência na sua região" },
  { url: "/importacao",    titulo: "Importação",    Icone: Upload,      desc: "Importe clientes e faturas por arquivo CSV" },
  { url: "/importacao-equipamentos", titulo: "Importar Equipamentos", Icone: Package, desc: "Cadastre ONUs e equipamentos em comodato" },
  { url: "/creditos",      titulo: "Comprar Créditos", Icone: CreditCard, desc: "Recarregue o saldo para novas consultas" },
  { url: "/nfse",          titulo: "Notas Fiscais", Icone: FileText,    desc: "Emissão e histórico de notas fiscais de serviço" },
  { url: "/painel-provedor", titulo: "Painel do Provedor", Icone: Building2, desc: "Dados cadastrais, sócios, usuários e documentos" },
  { url: "/configuracoes/regionalizacao", titulo: "Regionalização", Icone: Globe, desc: "Cidades e mesorregiões que seu provedor atende" },
  { url: "/benchmark-regional", titulo: "Localização", Icone: MapPin, desc: "Mapa da carteira, calor de inadimplência e ranking de bairros" },
];

function FeatureCard({ titulo, desc, Icone }: { titulo: string; desc: string; Icone: any }) {
  return (
    <div className="h-full flex flex-col gap-2.5 p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] motion-safe:transition-colors cursor-pointer">
      <div className="w-9 h-9 rounded-lg grid place-items-center bg-[var(--brand-soft)] flex-none">
        <Icone className="w-[18px] h-[18px] text-[var(--brand-ink)]" strokeWidth={2} />
      </div>
      <div>
        <p className="text-[13.5px] font-semibold text-[var(--text)] leading-tight">{titulo}</p>
        <p className="text-[12px] text-[var(--text-muted)] leading-snug mt-1">{desc}</p>
      </div>
    </div>
  );
}
function KpiCard({ icon: Icon, label, value, sub, testId }: {
  icon: any; label: string; value: any; sub?: string; testId: string;
}) {
  return (
    /* Rotulo em mono caixa-alta e numero em mono tabular — mesma voz da sidebar
       e da Consulta ISP. O numero fica em --text: acento e acao, dado e dado.
       O icone e neutro: nesta tela nenhuma metrica e semantica. */
    <Card className="px-[14px] py-3" data-testid={testId}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} />
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


function RiskItem({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className="font-mono text-[17px] font-medium text-[var(--text)] tabular-nums mt-1">{value}</p>
    </div>
  );
}
