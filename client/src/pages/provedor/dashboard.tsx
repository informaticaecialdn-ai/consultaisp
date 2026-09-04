import { useQuery } from "@tanstack/react-query";
import { STALE_DASHBOARD } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import {
  CabecalhoPainel,
  PilulaCabecalho,
  CartaoMetrica,
  KickerSecao,
  CartaoAcao,
  BOTAO_MARCA,
} from "@/components/painel/ui";
import {
  Search,
  CreditCard,
  Package,
  TrendingUp,
  Users,
  ScanSearch,
  BarChart3,
  Shield,
  ShieldAlert,
  MapPin,
  Upload,
  FileText,
  Globe,
  Building2,
} from "lucide-react";

export default function DashboardPage() {
  const { provider, partnerCode } = useAuth();

  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"], staleTime: STALE_DASHBOARD });

  const { data: benchmarkData } = useQuery<any>({ queryKey: ["/api/isp-consultations/benchmark"], staleTime: 5 * 60 * 1000 });
  const provedoresParceiros = benchmarkData?.providersInRegion ?? 0;

  const creditos = stats?.ispCredits ?? 0;
  const consultasHoje = stats?.consultationsToday ?? 0;
  const consultasMes = stats?.consultationsThisMonth ?? 0;

  return (
    <div className="p-4 lg:p-6 space-y-6" data-testid="dashboard-page">

      <CabecalhoPainel
        titulo="Painel do Provedor"
        descricao={(provider as any)?.tradeName || provider?.name}
        testIdTitulo="text-dashboard-title"
        acoes={
          <>
            {partnerCode && (
              <PilulaCabecalho
                Icone={Shield}
                valor={partnerCode}
                rotulo="seu código"
                testIdValor="text-partner-code"
                titleAtributo="Seu código para o suporte. Os provedores parceiros veem outro código para você — ninguém consegue cruzar."
              />
            )}
            <Link href="/creditos">
              <PilulaCabecalho
                Icone={CreditCard}
                tom="marca"
                interativa
                valor={isLoading ? "..." : creditos}
                rotulo="créditos"
                testIdValor="text-credits"
              />
            </Link>
          </>
        }
      />

      {/* Metricas. O card de creditos leva o CTA embutido: comprar do mesmo lugar
          onde se ve o saldo, sem viagem ate outra tela. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Sem skeleton aqui de proposito: o tracinho segura a altura do card e o
            saldo costuma vir do cache, entao piscar um bloco cinza seria pior. */}
        <CartaoMetrica
          rotulo="Créditos disponíveis"
          valor={isLoading ? "—" : creditos}
          testIdValor="value-card-credits"
          /* BOTAO_MARCA em vez das classes soltas: o `min-h-[36px]` cravado que
             estava aqui deixava o alvo abaixo dos 44px no dedo, e a secao 7 do
             DESIGN_SYSTEM chama isso de nao negociavel. A constante preserva
             estes valores letra por letra e soma a media query de ponteiro
             grosso — denso no desktop, 44px no toque. */
          acao={
            <Link href="/creditos">
              <button
                type="button"
                data-testid="button-comprar-creditos"
                className={BOTAO_MARCA}
              >
                Comprar
              </button>
            </Link>
          }
        />

        <CartaoMetrica Icone={Search}     rotulo="Consultas hoje"       valor={consultasHoje} carregando={isLoading} testId="card-today"    testIdValor="value-card-today" />
        <CartaoMetrica Icone={TrendingUp} rotulo="Consultas no mês"     valor={consultasMes}  carregando={isLoading} testId="card-month"   testIdValor="value-card-month" />
        <CartaoMetrica Icone={Building2}  rotulo="Provedores parceiros" valor={provedoresParceiros} sub="compartilhando dados" testId="card-partners" testIdValor="value-card-partners" />
      </div>

      {/* Funcionalidades — toda capacidade do sistema vira card com icone, titulo e
          descricao. Antes existiam so 4 "acoes rapidas" e metade do sistema ficava
          invisivel para quem nao conhecia a sidebar de cor. */}
      <div>
        <KickerSecao>Funcionalidades disponíveis</KickerSecao>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {FUNCIONALIDADES.map(f => (
            <Link key={f.url} href={f.url}>
              <CartaoAcao titulo={f.titulo} descricao={f.desc} Icone={f.Icone} />
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
  { url: "/localizacao",   titulo: "Localização",   Icone: MapPin,      desc: "Mapa da carteira, concentração de inadimplência e ranking de bairros" },
  { url: "/importacao",    titulo: "Importação",    Icone: Upload,      desc: "Importe clientes e faturas por arquivo CSV" },
  { url: "/equipamentos", titulo: "Equipamentos", Icone: Package, desc: "Comodato, recuperação após rescisão e ocorrências validadas" },
  { url: "/creditos",      titulo: "Comprar Créditos", Icone: CreditCard, desc: "Recarregue o saldo para novas consultas" },
  { url: "/nfse",          titulo: "Notas Fiscais", Icone: FileText,    desc: "Emissão e histórico de notas fiscais de serviço" },
  { url: "/painel-provedor", titulo: "Painel do Provedor", Icone: Building2, desc: "Dados cadastrais, sócios, usuários e documentos" },
  { url: "/configuracoes/regionalizacao", titulo: "Regionalização", Icone: Globe, desc: "Cidades e mesorregiões que seu provedor atende" },
];
