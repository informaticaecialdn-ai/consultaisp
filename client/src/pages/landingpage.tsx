import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Shield,
  Search,
  BarChart3,
  Users,
  Zap,
  Lock,
  Globe,
  CheckCircle,
  ArrowRight,
  Flame,
  AlertTriangle,
  CreditCard,
  Building2,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Eye,
  Database,
  Bot,
  MapPin,
} from "lucide-react";

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="text-3xl sm:text-4xl font-black text-white leading-none">{value}</p>
      <p className="text-sm text-blue-200 mt-1">{label}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  color,
}: {
  icon: any;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <Card className="p-6 hover:shadow-lg transition-shadow border border-slate-200 bg-white group" data-testid={`feature-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${color} group-hover:scale-110 transition-transform`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
    </Card>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <button
        className="w-full text-left py-4 flex items-center justify-between gap-4"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-semibold text-slate-900">{question}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
      </button>
      {open && <p className="text-sm text-slate-600 pb-4 leading-relaxed">{answer}</p>}
    </div>
  );
}

export default function LandingPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-white" data-testid="landing-page">
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold text-slate-900">Consulta ISP</span>
              <span className="text-xs text-slate-500 ml-1.5 hidden sm:inline">Analise de Credito</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="text-sm"
              onClick={() => setLocation("/login")}
              data-testid="button-landing-login"
            >
              Login
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm gap-1.5"
              onClick={() => setLocation("/login")}
              data-testid="button-landing-cadastro"
            >
              Criar Conta Gratis
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_-20%,rgba(59,130,246,0.08),transparent_50%)]" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 relative">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
              <Zap className="w-3.5 h-3.5" />
              Plataforma colaborativa para provedores de internet
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-900 leading-tight tracking-tight" data-testid="text-hero-title">
              Proteja seu provedor contra a
              <span className="text-blue-600"> inadimplencia</span>
            </h1>
            <p className="text-lg sm:text-xl text-slate-600 mt-6 max-w-2xl mx-auto leading-relaxed">
              Consulte CPF/CNPJ em uma base colaborativa de provedores, obtenha score de credito, detecte fraudes e tome decisoes mais seguras antes de ativar novos clientes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
              <Button
                size="lg"
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 gap-2 text-base h-12"
                onClick={() => setLocation("/login")}
                data-testid="button-hero-cta"
              >
                Criar Conta Gratis
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="px-8 gap-2 text-base h-12"
                onClick={() => document.getElementById("funcionalidades")?.scrollIntoView({ behavior: "smooth" })}
                data-testid="button-hero-features"
              >
                Ver Funcionalidades
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-r from-blue-700 to-blue-900 py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <StatCard value="100+" label="Provedores conectados" />
            <StatCard value="50K+" label="Consultas realizadas" />
            <StatCard value="98%" label="Precisao no score" />
            <StatCard value="< 2s" label="Tempo de resposta" />
          </div>
        </div>
      </section>

      <section id="funcionalidades" className="py-16 sm:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">
              Tudo que seu provedor precisa
            </h2>
            <p className="text-slate-600 mt-3 max-w-xl mx-auto">
              Uma plataforma completa de analise de credito e gestao de risco para provedores de internet.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={Search}
              title="Consulta ISP"
              description="Consulte CPF ou CNPJ na base colaborativa de provedores. Verifique historico de pagamentos, equipamentos pendentes e restricoes em tempo real."
              color="bg-blue-600"
            />
            <FeatureCard
              icon={BarChart3}
              title="Score de Credito"
              description="Score de 0 a 100 calculado automaticamente com base em atrasos, valores, equipamentos nao devolvidos e historico em multiplos provedores."
              color="bg-emerald-600"
            />
            <FeatureCard
              icon={Shield}
              title="Anti-Fraude"
              description="Deteccao automatica de padroes suspeitos, alertas em tempo real quando seus clientes sao consultados por outros provedores."
              color="bg-red-600"
            />
            <FeatureCard
              icon={Flame}
              title="Mapa de Calor"
              description="Visualize geograficamente as areas de maior concentracao de inadimplencia. Identifique zonas de risco antes de expandir a cobertura."
              color="bg-orange-500"
            />
            <FeatureCard
              icon={Bot}
              title="Analise com IA"
              description="Inteligencia artificial analisa cada consulta e gera recomendacoes personalizadas para aprovacao, revisao ou rejeicao de novos clientes."
              color="bg-indigo-600"
            />
            <FeatureCard
              icon={Database}
              title="Base Colaborativa"
              description="Quanto mais provedores na rede, mais completa a base. Dados compartilhados de forma anonimizada garantem maior protecao para todos."
              color="bg-purple-600"
            />
            <FeatureCard
              icon={CreditCard}
              title="Consulta SPC"
              description="Acesse dados do SPC Brasil diretamente pela plataforma. Score de credito, restricoes financeiras e protestos em um unico lugar."
              color="bg-teal-600"
            />
            <FeatureCard
              icon={Globe}
              title="Integracao com ERP"
              description="Conecte seu sistema de gestao (IXC, SGP, MK Solutions) e mantenha a base de inadimplentes sempre atualizada automaticamente."
              color="bg-cyan-600"
            />
            <FeatureCard
              icon={TrendingUp}
              title="Relatorios e Metricas"
              description="Dashboards completos com indicadores de inadimplencia, volume de consultas, creditos consumidos e distribuicao de risco."
              color="bg-amber-600"
            />
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">
              Como funciona
            </h2>
            <p className="text-slate-600 mt-3 max-w-xl mx-auto">
              Em apenas 3 passos, proteja seu provedor contra clientes inadimplentes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Cadastre seu provedor",
                description: "Crie sua conta, informe os dados do provedor e conecte seu sistema de gestao (ERP) para importar a base de clientes automaticamente.",
                icon: Building2,
                color: "from-blue-500 to-blue-600",
              },
              {
                step: "02",
                title: "Consulte antes de ativar",
                description: "Antes de ativar um novo cliente, consulte o CPF/CNPJ na plataforma. Em segundos, receba o score de credito, alertas e sugestao de decisao.",
                icon: Search,
                color: "from-emerald-500 to-emerald-600",
              },
              {
                step: "03",
                title: "Reduza a inadimplencia",
                description: "Com decisoes baseadas em dados reais de toda a rede de provedores, reduza significativamente perdas com inadimplencia e equipamentos nao devolvidos.",
                icon: TrendingUp,
                color: "from-amber-500 to-amber-600",
              },
            ].map((item) => (
              <div key={item.step} className="text-center" data-testid={`step-${item.step}`}>
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${item.color} flex items-center justify-center mx-auto mb-5 shadow-lg`}>
                  <item.icon className="w-8 h-8 text-white" />
                </div>
                <div className="text-xs font-bold text-blue-600 tracking-widest uppercase mb-2">Passo {item.step}</div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{item.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900">
              Vantagens para seu provedor
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                icon: Lock,
                title: "Dados protegidos e anonimizados",
                description: "Informacoes de outros provedores sao compartilhadas de forma anonimizada. Voce ve que existe inadimplencia, mas os dados pessoais do cliente so sao visiveis para o provedor de origem.",
              },
              {
                icon: Eye,
                title: "Visibilidade completa do risco",
                description: "Score de credito, composicao detalhada com bonus e penalidades, alertas do sistema, equipamentos pendentes e historico de consultas — tudo em uma unica tela.",
              },
              {
                icon: AlertTriangle,
                title: "Alertas anti-fraude em tempo real",
                description: "Receba notificacoes quando seus clientes inadimplentes sao consultados por outros provedores, indicando possivel tentativa de contratacao em outro local.",
              },
              {
                icon: MapPin,
                title: "Mapa de calor geografico",
                description: "Identifique areas com alta concentracao de inadimplencia na sua regiao. Dados estrategicos para expansao de rede e politicas de credito regionalizadas.",
              },
              {
                icon: Users,
                title: "Rede colaborativa crescente",
                description: "A cada novo provedor que entra na plataforma, a base de dados fica mais completa e a protecao de todos aumenta. Efeito de rede a favor do seu negocio.",
              },
              {
                icon: Zap,
                title: "Resultado em menos de 2 segundos",
                description: "Consultas processadas instantaneamente com score, sugestao de decisao e analise de IA. Sem espera, sem burocracia — ative clientes com seguranca.",
              },
            ].map((item, i) => (
              <div key={i} className="flex gap-4 p-5 rounded-xl border border-slate-200 bg-white hover:border-blue-200 hover:shadow-md transition-all" data-testid={`benefit-${i}`}>
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <item.icon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">{item.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20 bg-slate-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-black text-slate-900">Perguntas Frequentes</h2>
          </div>

          <Card className="p-6 sm:p-8 bg-white" data-testid="faq-section">
            <FaqItem
              question="Quanto custa utilizar a plataforma?"
              answer="O cadastro do provedor e gratuito. Consultas de clientes do proprio provedor sao gratuitas (custo zero). Consultas de dados de outros provedores custam 1 credito. Creditos podem ser adquiridos em pacotes com precos acessiveis."
            />
            <FaqItem
              question="Como funciona o compartilhamento de dados?"
              answer="Cada provedor importa sua base de inadimplentes. Quando outro provedor consulta um CPF, ele ve que existe um registro de inadimplencia com informacoes como dias de atraso, faixa de valor e equipamentos pendentes, mas os dados pessoais (nome, endereco) ficam restritos ao provedor de origem."
            />
            <FaqItem
              question="Quais ERPs sao compatíveis?"
              answer="A plataforma possui integracao nativa com os principais ERPs do mercado ISP: IXC Provedor, SGP (Sistema Gerencial Provedor) e MK Solutions. A conexao e feita via API/webhook de forma automatizada."
            />
            <FaqItem
              question="O score de credito e confiavel?"
              answer="O score e calculado com base em dados reais de pagamento, atrasos, equipamentos e historico em multiplos provedores. Quanto mais provedores na rede, mais preciso o score. A analise com IA complementa a avaliacao com recomendacoes contextuais."
            />
            <FaqItem
              question="Meus dados estao seguros?"
              answer="Sim. A plataforma utiliza criptografia em transito e em repouso, autenticacao segura, e segue as melhores praticas de seguranca de dados. Cada provedor acessa apenas seus proprios dados e informacoes anonimizadas da rede."
            />
            <FaqItem
              question="Como funciona o sistema anti-fraude?"
              answer="O sistema monitora em tempo real quando seus clientes inadimplentes sao consultados por outros provedores. Voce recebe alertas automaticos que indicam possivel tentativa de contratacao em outro local, permitindo acoes preventivas."
            />
          </Card>
        </div>
      </section>

      <section className="py-16 sm:py-24 bg-gradient-to-r from-blue-700 to-blue-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
            Proteja seu provedor hoje mesmo
          </h2>
          <p className="text-lg text-blue-200 mb-8 max-w-2xl mx-auto">
            Junte-se a rede de provedores que ja reduzem perdas com inadimplencia usando dados colaborativos e inteligencia artificial.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              className="bg-white text-blue-700 hover:bg-blue-50 px-8 gap-2 text-base h-12 font-bold"
              onClick={() => setLocation("/login")}
              data-testid="button-cta-bottom"
            >
              Criar Conta Gratis
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10 px-8 gap-2 text-base h-12"
              onClick={() => setLocation("/login")}
              data-testid="button-login-bottom"
            >
              Ja tenho conta — Login
            </Button>
          </div>
        </div>
      </section>

      <footer className="bg-slate-900 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <span className="text-white font-bold">Consulta ISP</span>
              <span className="text-slate-500 text-sm">Analise de Credito para Provedores</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-slate-400">
              <span>Seguranca e privacidade garantidas</span>
              <span className="hidden sm:inline">|</span>
              <span className="hidden sm:inline">Dados protegidos por criptografia</span>
            </div>
          </div>
          <div className="border-t border-slate-800 mt-6 pt-6 text-center">
            <p className="text-xs text-slate-500">
              Consulta ISP — Plataforma colaborativa de analise de credito para provedores de internet do Brasil
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
