import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  CabecalhoPainel, CartaoMetrica, KickerSecao, Selo, EstadoVazio, LinhasSkeleton,
  TabelaPainel, Th, Td, Campo, BotaoIcone, AvisoNaoCarregou, BOTAO_ICONE,
  TITULO_CARTAO, BOTAO_SECUNDARIO, BOTAO_MARCA,
  type TomSelo, type Icone,
} from "@/components/painel/ui";
import {
  Dinheiro, ChipFiltro, ModalCobrancaAsaas, ModalPixAsaas, CONTROLE_CAMPO,
  textoDeReal,
} from "@/components/admin/financeiro-ui";
import { PLAN_LABELS } from "@/components/admin/constants";
import {
  TrendingUp, TrendingDown, Users, BarChart3,
  CheckCircle, ArrowUpRight, RefreshCw, FileText, Plus, Eye, Ban,
  Wallet, RotateCcw, ExternalLink, ArrowLeft, Zap, Crown,
  Target, Activity, PieChart, ChevronRight, ArrowUp, ArrowDown, Minus,
  Shield,
} from "lucide-react";
import { usePrecos, camposDaFatura } from "@/hooks/use-precos";

/**
 * Financeiro do superadmin, na MESMA linguagem do Painel do Provedor.
 *
 * Rodada de LINGUAGEM VISUAL: nenhuma rota, queryKey, mutação, permissão ou
 * `data-testid` mudou. O que mudou é quem fala — a tela consome
 * `@/components/painel/ui` e os tokens canônicos, no lugar da API antiga de
 * token e da paleta default do Tailwind. (O literal da API antiga não aparece
 * escrito aqui de propósito: a auditoria que confere se ela sumiu é feita por
 * grep, e o comentário que conta a história envenenaria o resultado.)
 *
 * O QUE SAIU DAQUI, E POR QUÊ
 *
 * 1. O QUINTO MAPA DE PLANO. Este arquivo mantinha um `PLAN_LABELS` próprio
 *    ({ label, color, bg }) — a cópia que `lib/planos.ts` e o catálogo do
 *    admin foram criados para acabar. Agora importa `PLAN_LABELS` de
 *    `@/components/admin/constants`, que devolve `{ label, tom }`, e o plano
 *    aparece como `<Selo tom>` em vez de duas classes coladas à mão.
 *
 * 2. TREZE GRADIENTES E A PALETA DEFAULT. Cada cartão de métrica tinha uma
 *    faixa em gradiente no topo e um ladrilho de ícone também em gradiente; as
 *    barras dos dois gráficos usavam cinza-azulado, rosa e azul da paleta
 *    default, uma delas com gradiente vertical; e o texto de valor negativo,
 *    de alerta e de número de fatura usava rosa, âmbar e azul crus. Três
 *    proibições da seção 7 convivendo. Tudo virou token.
 *
 * 3. O `MetricCard` LOCAL, com `trend`/`trendValue` que NENHUMA chamada
 *    passava — parâmetro morto que só existia para justificar a seta colorida.
 *    Virou `CartaoMetrica`, a primitiva compartilhada.
 *
 * 4. AS FAIXAS DE JULGAMENTO INVENTADAS. Churn e taxa de cobrança pintavam a
 *    tela de verde/âmbar/vermelho por limiares cravados no JSX (churn 0 e 3%,
 *    cobrança 90% e 70%). Esses números não existem no servidor, não são
 *    configuráveis e não estão escritos em lugar nenhum do produto: eram
 *    opinião pintada de medição. Um instrumento mostra a medida; o número
 *    continua inteiro na tela, em `--text`, e a saturação fica reservada para
 *    o que é risco de verdade — dinheiro vencido, fatura em atraso, situação
 *    de cobrança do provedor (seção 3).
 *
 * 5. SPINNER CENTRALIZADO e "Nenhuma fatura encontrada" solto: viraram
 *    `LinhasSkeleton` e `EstadoVazio` (seção 6).
 *
 * TODO NÚMERO É MONO TABULAR (seção 2), e todo valor NEGATIVO — contração,
 * cancelamento, rebaixamento de plano, dívida vencida — leva o token de
 * dinheiro negativo, hoje aplicado pelo componente `Dinheiro`.
 *
 * O QUE MUDOU NA RODADA SEGUINTE (unificação com a aba Faturas e Cobranças)
 *
 * 6. AS SIGLAS SAÍRAM DA TELA. Esta página dizia "MRR", "ARR", "ARPU", "LTV" e
 *    "NRR"; a aba do painel do sistema, que mostra a MESMA receita, já dizia
 *    "Receita mensal" e "Receita anual". Duas telas do mesmo painel nomeando a
 *    mesma medida de dois jeitos é pior do que qualquer um dos dois nomes, e a
 *    §8 proíbe jargão técnico exposto — as cinco eram jargão em inglês. Venceu
 *    a versão em português; a definição de cada uma continua na sublinha.
 *
 * 7. AS CÓPIAS MORRERAM. Cabeçalho e célula de tabela, rótulo de campo, botão
 *    só de ícone e estado desabilitado eram cópias manuscritas e agora vêm de
 *    `@/components/painel/ui`. Dinheiro, chip de filtro, altura de campo e os
 *    dois modais do Asaas eram cópias compartilhadas com a ABA e mudaram para
 *    `@/components/admin/financeiro-ui`. Não sobrou cópia local nenhuma: é por
 *    onde a divergência voltaria.
 */

/* ------------------------------------------------------------------ */
/* Vocabulário de domínio desta tela                                   */
/* ------------------------------------------------------------------ */

/** Situação da fatura. `overdue` fica em `danger` porque é o único dos quatro
 *  que pede ação hoje; `cancelled` fica neutro — fatura cancelada pelo próprio
 *  superadmin não é acidente. */
const SITUACAO_FATURA: Record<string, { rotulo: string; tom: TomSelo }> = {
  pending: { rotulo: "Pendente", tom: "gated" },
  paid: { rotulo: "Paga", tom: "ok" },
  overdue: { rotulo: "Vencida", tom: "danger" },
  cancelled: { rotulo: "Cancelada", tom: "neutro" },
};

/** Situação de cobrança do provedor. Aqui a saturação É legítima: `overdue` é
 *  provedor devendo, que é exatamente o eixo de risco. */
const SITUACAO_COBRANCA: Record<string, { rotulo: string; tom: TomSelo }> = {
  good: { rotulo: "Em dia", tom: "ok" },
  overdue: { rotulo: "Inadimplente", tom: "danger" },
  new: { rotulo: "Sem histórico", tom: "neutro" },
};

/* ------------------------------------------------------------------ */
/* Vocabulário desta tela                                              */
/* ------------------------------------------------------------------ */

/** Mono tabular para número que NÃO é dinheiro nem célula de tabela — contagem
 *  de provedores, porcentagem, período. Dinheiro é `<Dinheiro>` e célula é
 *  `<Td num>`; as duas já trazem isto. */
const MONO = "font-mono tabular-nums";

/** Contagem inteira. Dinheiro NÃO passa por aqui. */
function fmtInt(n: number) {
  return n.toLocaleString("pt-BR");
}
function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}
function periodLabel(p: string) {
  const [y, m] = p.split("-");
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${months[parseInt(m) - 1]}/${y.slice(2)}`;
}

/** Uma barra da composição da receita mensal.
 *
 *  A cor diz o PAPEL da parcela, não o gosto: início e fim são a mesma medida
 *  em dois momentos (identidade, seção 3.5 — daí o neutro e a marca), soma é
 *  `--ok` e subtração é `--past`, o token do dinheiro negativo. */
const COR_DA_BARRA = {
  start: "bg-[var(--cat-slate)]",
  add: "bg-[var(--ok)]",
  sub: "bg-[var(--past)]",
  end: "bg-[var(--brand)]",
} as const;

/** O sinal da parcela. O servidor manda toda parcela como magnitude positiva,
 *  então quem sabe que ela subtrai é o papel dela — e é o sinal que faz
 *  `Dinheiro` pintar o valor com o token de dinheiro negativo. */
const SINAL_DA_BARRA: Record<keyof typeof COR_DA_BARRA, "+" | "−" | undefined> = {
  start: undefined,
  add: "+",
  sub: "−",
  end: undefined,
};

function WaterfallBar({ label, value, type, max }: { label: string; value: number; type: keyof typeof COR_DA_BARRA; max: number }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 2;
  const negativa = type === "sub";
  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <Dinheiro
        valor={Math.round(value)}
        curto
        sinal={SINAL_DA_BARRA[type]}
        /* A tinta só entra quando a parcela NÃO é negativa: sobre uma negativa
           ela apagaria o token de dinheiro negativo que o componente aplica. */
        className={cn("text-[10px] font-medium text-center", !negativa && "text-[var(--text-muted)]")}
      />
      <div
        className={cn("w-full rounded-t-sm motion-safe:transition-all", COR_DA_BARRA[type])}
        style={{ height: `${pct}%`, minHeight: 8 }}
      />
      <span className="text-[10.5px] text-[var(--text-muted)] text-center leading-tight">{label}</span>
    </div>
  );
}

/** Operador entre duas barras do waterfall. */
function Operador({ Icone: I }: { Icone: Icone }) {
  return (
    <div className="flex items-end self-center pb-4 text-[var(--text-faint)]" aria-hidden>
      <I className="w-3 h-3" strokeWidth={2} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function AdminFinanceiroPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const isSuperAdmin = user?.role === "superadmin";

  const [invoiceFilter, setInvoiceFilter] = useState("all");
  const [asaasChargeModal, setAsaasChargeModal] = useState<{ invoiceId: number; invoiceNumber: string } | null>(null);
  const [asaasPixModal, setAsaasPixModal] = useState<{ invoiceId: number; pixData: any } | null>(null);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    providerId: "", period: "", amount: "", planAtTime: "pro",
    ispCreditsIncluded: "0", spcCreditsIncluded: "0", dueDate: "", notes: "",
  });

  /**
   * O formulario de fatura preenchia valor e creditos de uma tabela cravada
   * aqui, e ela tinha envelhecido: o seletor oferecia "Pro — R$ 399" e
   * preenchia outro valor. Agora tudo vem do servidor, que e quem cobra.
   */
  const { data: precos, isLoading: carregandoPrecos, isError: erroPrecos, refetch: recarregarPrecos } = usePrecos();
  const planosDoSeletor = precos?.planos ?? [];
  /**
   * O formulario so pode preencher valor a partir da tabela. Enquanto ela nao
   * chegou — ou se a leitura falhou — `camposDaFatura` devolve `null` e o
   * campo fica INTOCADO, em vez de cair para "0".
   *
   * O `?? 0` que morava aqui gravava fatura de R$ 0,00 para provedor pagante:
   * bastava um 500 na leitura de preco, e como a query nao refaz a leitura ao
   * voltar o foco, ela ficava indisponivel ate a pagina recarregar. Ausencia
   * de preco nao e gratuidade.
   */
  const camposDoPlano = (chave: string | null | undefined) => camposDaFatura(precos, chave) ?? {};
  /** Sem tabela nao ha valor confiavel para gravar numa fatura. */
  const podeEmitirFatura = Boolean(precos);

  const { data: metrics, isLoading: metricsLoading } = useQuery<any>({
    queryKey: ["/api/admin/financial/saas-metrics"],
    enabled: isSuperAdmin,
    refetchInterval: 60000,
  });

  const { data: allProviders = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    enabled: isSuperAdmin,
  });

  const { data: allInvoices = [], isLoading: invoicesLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/invoices"],
    enabled: isSuperAdmin,
  });

  const { data: asaasStatus } = useQuery<any>({
    queryKey: ["/api/admin/asaas/status"],
    enabled: isSuperAdmin,
    staleTime: 60000,
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/invoices", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
      setShowNewInvoice(false);
      setInvoiceForm({ providerId: "", period: "", amount: "", planAtTime: "pro", ispCreditsIncluded: "0", spcCreditsIncluded: "0", dueDate: "", notes: "" });
      toast({ title: "Fatura emitida com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateInvoiceStatusMutation = useMutation({
    mutationFn: async ({ id, status, paidAmount }: { id: number; status: string; paidAmount?: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/invoices/${id}/status`, { status, paidAmount });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
      toast({ title: "Situação atualizada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const cancelInvoiceMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/invoices/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
      toast({ title: "Fatura cancelada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const generateMonthlyMutation = useMutation({
    mutationFn: async (period: string) => {
      const res = await apiRequest("POST", "/api/admin/invoices/generate-monthly", { period });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
      toast({ title: "Faturas geradas", description: data.message });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const createChargeMutation = useMutation({
    mutationFn: async ({ id, billingType }: { id: number; billingType: string }) => {
      const res = await apiRequest("POST", `/api/admin/invoices/${id}/asaas/charge`, { billingType });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      setAsaasChargeModal(null);
      toast({ title: "Cobrança Asaas criada", description: `ID: ${data.charge?.id}` });
    },
    onError: (e: any) => toast({ title: "Erro Asaas", description: e.message, variant: "destructive" }),
  });

  const syncChargeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/invoices/${id}/asaas/sync`, {});
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
      toast({ title: "Sincronizado com o Asaas" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const pixMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("GET", `/api/admin/invoices/${id}/asaas/pix`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data, id) => setAsaasPixModal({ invoiceId: id as number, pixData: data }),
    onError: (e: any) => toast({ title: "Erro ao buscar o PIX", description: e.message, variant: "destructive" }),
  });

  if (!isSuperAdmin) {
    return (
      <div className="p-4 lg:p-5">
        <Card>
          <EstadoVazio
            Icone={Shield}
            titulo="Acesso restrito"
            descricao="Esta tela é do administrador da plataforma. Sua conta não tem esse acesso."
          />
        </Card>
      </div>
    );
  }

  const snap = metrics?.snapshot || {};
  const waterfall = metrics?.waterfall || {};
  const last12 = metrics?.last12Months || [];
  const invoiceHealth = metrics?.invoiceHealth || {};
  const planDist = metrics?.planDistribution || {};
  const provHealth = metrics?.providerBillingHealth || [];

  const maxWaterfall = Math.max(waterfall.startingMrr || 0, waterfall.endingMrr || 0, 1);
  const maxRevenue = Math.max(...last12.map((m: any) => m.billedRevenue || 0), 1);

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const filteredInvoices = invoiceFilter === "all"
    ? allInvoices
    : allInvoices.filter((i: any) => {
        if (invoiceFilter === "overdue") return i.status === "overdue" || (i.status === "pending" && new Date(i.dueDate) < now);
        return i.status === invoiceFilter;
      });

  const semMovimentacao =
    !waterfall.upgrades?.length && !waterfall.downgrades?.length && !waterfall.churns?.length;

  return (
    <div className="p-4 lg:p-6 pb-10 space-y-6">
      {/* Os dois modais do Asaas vivem em `@/components/admin/financeiro-ui`:
          eram a mesma peça escrita aqui e na aba Faturas e Cobranças, e
          divergiam no ícone do boleto, no corpo do título e na acessibilidade. */}
      {asaasChargeModal && (
        <ModalCobrancaAsaas
          numeroDaFatura={asaasChargeModal.invoiceNumber}
          emAndamento={createChargeMutation.isPending}
          onEscolher={(formaDeCobranca) =>
            createChargeMutation.mutate({ id: asaasChargeModal.invoiceId, billingType: formaDeCobranca })
          }
          onFechar={() => setAsaasChargeModal(null)}
        />
      )}

      {asaasPixModal && (
        <ModalPixAsaas pix={asaasPixModal.pixData} onFechar={() => setAsaasPixModal(null)} />
      )}

      <div className="flex items-start gap-3">
        <BotaoIcone
          Icone={ArrowLeft}
          rotulo="Voltar ao painel do sistema"
          className="mt-0.5"
          onClick={() => navigate("/admin-sistema#financeiro")}
          testId="button-back"
        />
        <div className="flex-1 min-w-0">
          <CabecalhoPainel
            titulo="Financeiro"
            descricao={`Receita recorrente, faturas e cobrança dos provedores · ${now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`}
            acoes={
              <>
                {asaasStatus?.configured && (
                  /* "Sandbox"/"Producao" era valor cru do gateway. O que
                     importa para quem emite é se a cobrança vale dinheiro. */
                  <Selo tom={asaasStatus.mode === "sandbox" ? "gated" : "ok"} Icone={Wallet}>
                    {asaasStatus.mode === "sandbox" ? "Asaas em teste" : "Asaas em produção"}
                  </Selo>
                )}
                <button
                  type="button"
                  className={BOTAO_SECUNDARIO}
                  onClick={() => {
                    qc.invalidateQueries({ queryKey: ["/api/admin/financial/saas-metrics"] });
                    qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
                  }}
                  data-testid="button-refresh-metrics"
                >
                  <RefreshCw className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                  Atualizar
                </button>
              </>
            }
          />
        </div>
      </div>

      {metricsLoading ? (
        /* Carregamento mostra a FORMA do que vem (seção 6): os mesmos quatro
           cartões, com o rótulo já legível e o número em skeleton. O spinner
           centralizado que estava aqui não dizia nada sobre a tela que ia
           aparecer. */
        <section>
          <KickerSecao>Receita recorrente</KickerSecao>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { rotulo: "Receita mensal", Icone: TrendingUp },
              { rotulo: "Receita anual", Icone: Target },
              { rotulo: "Receita por provedor", Icone: Users },
              { rotulo: "Valor por cliente", Icone: Crown },
            ].map(m => (
              <CartaoMetrica key={m.rotulo} rotulo={m.rotulo} Icone={m.Icone} valor="" carregando />
            ))}
          </div>
        </section>
      ) : (
        <>
          <section>
            <KickerSecao>Receita recorrente</KickerSecao>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* As sublinhas dizem o que cada sigla dizia. Nenhuma conta mudou:
                  a receita anual continua sendo a mensal projetada, e o valor
                  por cliente continua saindo da receita por provedor dividida
                  pelo cancelamento (admin.storage.ts). */}
              <CartaoMetrica rotulo="Receita mensal" Icone={TrendingUp} valor={<Dinheiro valor={snap.mrr || 0} />} sub="recorrente, dos provedores pagantes" testId="metric-mrr" testIdValor="value-metric-mrr" />
              <CartaoMetrica rotulo="Receita anual" Icone={Target} valor={<Dinheiro valor={snap.arr || 0} curto />} sub="a mensal projetada em 12 meses" testId="metric-arr" testIdValor="value-metric-arr" />
              <CartaoMetrica
                rotulo="Receita por provedor"
                Icone={Users}
                valor={<Dinheiro valor={snap.arpu || 0} />}
                sub={<>média entre <span className={MONO}>{snap.payingProviders || 0}</span> provedores pagantes</>}
                testId="metric-arpu"
                testIdValor="value-metric-arpu"
              />
              <CartaoMetrica rotulo="Valor por cliente" Icone={Crown} valor={<Dinheiro valor={snap.ltv || 0} curto />} sub="o que um provedor rende enquanto fica" testId="metric-ltv" testIdValor="value-metric-ltv" />
            </div>
          </section>

          <section>
            <KickerSecao>Saúde do negócio</KickerSecao>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <CartaoMetrica
                rotulo="Cancelamento no mês"
                Icone={TrendingDown}
                valor={fmtPct(snap.monthlyChurnRate || 0)}
                sub={<>no ano: <span className={MONO}>{fmtPct(snap.annualChurnRate || 0)}</span></>}
                testId="metric-churn"
                testIdValor="value-metric-churn"
              />
              <CartaoMetrica
                rotulo="Retenção de receita"
                Icone={Activity}
                valor={`${snap.nrr || 100}%`}
                sub="da base do mês passado, com expansões e cancelamentos"
                testId="metric-nrr"
                testIdValor="value-metric-nrr"
              />
              <CartaoMetrica
                rotulo="Provedores ativos"
                Icone={Users}
                valor={fmtInt(snap.activeProviders || 0)}
                sub={<>
                  <span className={MONO}>{snap.payingProviders || 0}</span> pagantes ·{" "}
                  <span className={MONO}>{(snap.activeProviders || 0) - (snap.payingProviders || 0)}</span> no gratuito
                </>}
                testId="metric-active-providers"
                testIdValor="value-metric-active-providers"
              />
              <CartaoMetrica
                rotulo="Cobrança recebida"
                Icone={CheckCircle}
                valor={`${invoiceHealth.collectionRate || 0}%`}
                sub={<><Dinheiro valor={invoiceHealth.totalCollected || 0} /> recebidos</>}
                testId="metric-collection-rate"
                testIdValor="value-metric-collection-rate"
              />
            </div>
          </section>

          <section>
            <KickerSecao>Composição da receita</KickerSecao>
            <div className="grid lg:grid-cols-5 gap-3">
              <Card className="lg:col-span-2 p-4">
                <h3 className={`${TITULO_CARTAO} flex items-center gap-2`}>
                  <BarChart3 className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                  Como a receita mensal chegou até aqui
                </h3>
                <p className="text-[12px] text-[var(--text-muted)] mb-4 mt-0.5">
                  {now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </p>
                <div className="flex items-end gap-2 h-36">
                  <WaterfallBar label="Início" value={waterfall.startingMrr || 0} type="start" max={maxWaterfall} />
                  <Operador Icone={Plus} />
                  <WaterfallBar label="Novo" value={waterfall.newMrr || 0} type="add" max={maxWaterfall} />
                  <Operador Icone={Plus} />
                  <WaterfallBar label="Expansão" value={waterfall.expansionMrr || 0} type="add" max={maxWaterfall} />
                  <Operador Icone={Minus} />
                  <WaterfallBar label="Contração" value={waterfall.contractionMrr || 0} type="sub" max={maxWaterfall} />
                  <Operador Icone={Minus} />
                  <WaterfallBar label="Cancelamento" value={waterfall.churnedMrr || 0} type="sub" max={maxWaterfall} />
                  <div className="flex items-center self-center pb-4 text-[var(--text-faint)] text-[11px]" aria-hidden>=</div>
                  <WaterfallBar label="Final" value={waterfall.endingMrr || 0} type="end" max={maxWaterfall} />
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--border)] grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {[
                    { label: "Receita nova", value: waterfall.newMrr || 0, negativa: false, Icone: ArrowUp },
                    { label: "Expansão", value: waterfall.expansionMrr || 0, negativa: false, Icone: ArrowUp },
                    { label: "Contração", value: waterfall.contractionMrr || 0, negativa: true, Icone: ArrowDown },
                    { label: "Cancelamento", value: waterfall.churnedMrr || 0, negativa: true, Icone: ArrowDown },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0">
                        <item.Icone
                          className={cn("w-3 h-3 flex-none", item.negativa ? "text-[var(--past)]" : "text-[var(--ok)]")}
                          strokeWidth={2}
                          aria-hidden
                        />
                        <span className="text-[12px] text-[var(--text-muted)] truncate">{item.label}</span>
                      </div>
                      <Dinheiro
                        valor={item.value}
                        curto
                        sinal={item.negativa ? "−" : "+"}
                        className={cn("text-[12px] font-medium", !item.negativa && "text-[var(--ok)]")}
                      />
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="lg:col-span-3 p-4">
                <h3 className={`${TITULO_CARTAO} flex items-center gap-2`}>
                  <TrendingUp className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                  Receita recebida nos últimos 12 meses
                </h3>
                <p className="text-[12px] text-[var(--text-muted)] mb-4 mt-0.5">Faturas pagas, por período</p>
                <div className="flex items-end gap-1.5 h-36">
                  {last12.map((m: any) => {
                    const pct = maxRevenue > 0 ? (m.collectedRevenue / maxRevenue) * 100 : 0;
                    const isCurrent = m.period === currentPeriod;
                    return (
                      <div
                        key={m.period}
                        className="flex flex-col items-center flex-1 gap-1 group"
                        title={`${periodLabel(m.period)}: ${textoDeReal(m.collectedRevenue)}`}
                      >
                        <Dinheiro
                          valor={Math.round(m.collectedRevenue)}
                          curto
                          className="text-[10px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 motion-safe:transition-opacity"
                        />
                        {/* O mês corrente é o único na cor da marca — é o
                            estado ativo da série, não decoração. Os demais
                            ficam em hairline forte: barra de dado, sem voz. */}
                        <div
                          className={cn(
                            "w-full rounded-t-sm motion-safe:transition-all",
                            isCurrent ? "bg-[var(--brand)]" : "bg-[var(--border-strong)]",
                          )}
                          style={{ height: `${Math.max(pct, 3)}%` }}
                        />
                        <span className={cn(MONO, "text-[10px]", isCurrent ? "text-[var(--brand)] font-medium" : "text-[var(--text-muted)]")}>
                          {periodLabel(m.period)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between flex-wrap gap-2 text-[12px] text-[var(--text-muted)]">
                  <span>
                    Recebido em 12 meses:{" "}
                    <Dinheiro
                      valor={last12.reduce((s: number, m: any) => s + m.collectedRevenue, 0)}
                      className="font-medium text-[var(--text)]"
                    />
                  </span>
                  <span>
                    Faturado:{" "}
                    <Dinheiro
                      valor={last12.reduce((s: number, m: any) => s + m.billedRevenue, 0)}
                      className="font-medium text-[var(--text)]"
                    />
                  </span>
                </div>
              </Card>
            </div>
          </section>

          <section>
            <KickerSecao>Planos, cobrança e movimentação</KickerSecao>
            <div className="grid lg:grid-cols-3 gap-3">
              <Card className="p-4">
                <h3 className={`${TITULO_CARTAO} flex items-center gap-2 mb-4`}>
                  <PieChart className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                  Receita por plano
                </h3>
                {Object.keys(planDist).length === 0 ? (
                  <EstadoVazio
                    Icone={PieChart}
                    titulo="Nenhuma receita por plano"
                    descricao="Assim que houver provedor em plano pago, a divisão da receita aparece aqui."
                    testId="empty-receita-por-plano"
                  />
                ) : (
                  <div className="space-y-3">
                    {Object.entries(planDist).sort(([, a]: any, [, b]: any) => b.mrr - a.mrr).map(([plan, data]: any) => {
                      const total = Object.values(planDist).reduce((s: number, d: any) => s + d.mrr, 0) as number;
                      const pct = total > 0 ? Math.round((data.mrr / total) * 100) : 0;
                      const pl = PLAN_LABELS[plan];
                      return (
                        <div key={plan}>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              {/* O selo já identifica o plano: o ponto colorido
                                  que existia aqui era um segundo marcador para
                                  a mesma coisa. */}
                              <Selo tom={pl?.tom ?? "neutro"}>{pl?.label ?? plan}</Selo>
                              <span className={cn(MONO, "text-[12px] text-[var(--text-muted)]")}>{data.count}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-none">
                              <Dinheiro valor={data.mrr} curto className="text-[12.5px] font-medium text-[var(--text)]" />
                              <span className={cn(MONO, "text-[12px] text-[var(--text-muted)]")}>{pct}%</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-[var(--surface-inset)] rounded overflow-hidden">
                            <div className="h-full bg-[var(--brand)] motion-safe:transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <h3 className={`${TITULO_CARTAO} flex items-center gap-2 mb-4`}>
                  <Activity className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                  Situação das faturas
                </h3>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between py-2 border-b border-[var(--border-faint)]">
                    <span className="text-[12px] text-[var(--text-muted)]">Taxa de recebimento</span>
                    <span className={cn(MONO, "text-[13px] font-medium text-[var(--text)]")}>
                      {invoiceHealth.collectionRate || 0}%
                    </span>
                  </div>
                  {/* Aqui a saturação é legítima: paga / pendente / vencida é o
                      próprio eixo de risco que a seção 3 reserva para ela. */}
                  {[
                    { rotulo: "Pagas", tom: "ok" as TomSelo, count: invoiceHealth.counts?.paid || 0, amount: invoiceHealth.totalCollected || 0, tinta: "text-[var(--ok)]" },
                    { rotulo: "Pendentes", tom: "gated" as TomSelo, count: invoiceHealth.counts?.pending || 0, amount: 0, tinta: "text-[var(--gated)]" },
                    { rotulo: "Vencidas", tom: "danger" as TomSelo, count: invoiceHealth.counts?.overdue || 0, amount: invoiceHealth.totalOverdue || 0, tinta: "text-[var(--past)]" },
                  ].map(row => (
                    <div key={row.rotulo} className="flex items-center justify-between gap-3 py-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Selo tom={row.tom}>{row.rotulo}</Selo>
                        <span className={cn(MONO, "text-[12px] text-[var(--text-muted)]")}>{row.count}</span>
                      </div>
                      {row.amount > 0 && (
                        <Dinheiro valor={row.amount} className={cn("text-[12.5px] font-medium flex-none", row.tinta)} />
                      )}
                    </div>
                  ))}
                  {invoiceHealth.totalOverdue > 0 && (
                    <div className="mt-2 pt-2 border-t border-[var(--border-faint)]">
                      {/* "Aging" era jargão em inglês numa tela em português. */}
                      <KickerSecao className="mb-2">Atraso por faixa</KickerSecao>
                      {Object.entries(invoiceHealth.agingBuckets || {}).map(([range, val]: any) => (
                        val > 0 && (
                          <div key={range} className="flex items-center justify-between py-0.5">
                            <span className={cn(MONO, "text-[12px] text-[var(--text-muted)]")}>{range} dias</span>
                            {/* `--past` pelo papel de ATRASO, e não pelo sinal:
                                o valor é positivo, alguém deve. */}
                            <Dinheiro valor={val} className="text-[12px] font-medium text-[var(--past)]" />
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              <Card className="p-4">
                <h3 className={`${TITULO_CARTAO} flex items-center gap-2 mb-4`}>
                  <ArrowUpRight className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                  Movimentação do mês
                </h3>
                {semMovimentacao ? (
                  <EstadoVazio
                    Icone={CheckCircle}
                    titulo="Nenhuma movimentação este mês"
                    descricao="Nenhum provedor trocou de plano nem saiu neste período. Trocas e saídas aparecem aqui assim que acontecem."
                    testId="empty-movimentacao-mes"
                  />
                ) : (
                  <div className="space-y-3">
                    {/* As linhas eram retângulos tintos de verde/âmbar/vermelho
                        inteiros. O evento já é dito pelo grupo, e o sinal do
                        dinheiro pela cor do valor — repetir nos dois lugares
                        transformava a lista num semáforo. */}
                    {waterfall.upgrades?.length > 0 && (
                      <div>
                        <KickerSecao className="mb-1.5">Subiram de plano</KickerSecao>
                        {waterfall.upgrades.map((u: any, i: number) => (
                          <LinhaMovimento
                            key={`up-${i}`}
                            provedor={u.provider}
                            de={PLAN_LABELS[u.from]?.label ?? u.from}
                            para={PLAN_LABELS[u.to]?.label ?? u.to}
                            valor={u.delta}
                            negativa={false}
                          />
                        ))}
                      </div>
                    )}
                    {waterfall.downgrades?.length > 0 && (
                      <div>
                        <KickerSecao className="mb-1.5">Desceram de plano</KickerSecao>
                        {waterfall.downgrades.map((d: any, i: number) => (
                          <LinhaMovimento
                            key={`down-${i}`}
                            provedor={d.provider}
                            de={PLAN_LABELS[d.from]?.label ?? d.from}
                            para={PLAN_LABELS[d.to]?.label ?? d.to}
                            valor={d.delta}
                            negativa
                          />
                        ))}
                      </div>
                    )}
                    {waterfall.churns?.length > 0 && (
                      <div>
                        <KickerSecao className="mb-1.5">Deixaram de pagar</KickerSecao>
                        {waterfall.churns.map((c: any, i: number) => (
                          <LinhaMovimento
                            key={`churn-${i}`}
                            provedor={c.provider}
                            de={PLAN_LABELS[c.oldPlan]?.label ?? c.oldPlan}
                            para={PLAN_LABELS.free.label}
                            valor={c.mrr}
                            negativa
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          </section>

          <section>
            <KickerSecao>Cobrança por provedor</KickerSecao>
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between gap-3">
                <h3 className={`${TITULO_CARTAO} flex items-center gap-2`}>
                  <Users className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                  Situação de cada provedor
                </h3>
                <span className={cn(MONO, "text-[11px] text-[var(--text-muted)]")}>
                  {provHealth.length} provedores
                </span>
              </div>
              {provHealth.length === 0 ? (
                <EstadoVazio
                  Icone={Users}
                  titulo="Nenhum provedor com cobrança"
                  descricao="Assim que houver fatura emitida, cada provedor aparece aqui com o que já pagou e o que está em atraso."
                  testId="empty-cobranca-por-provedor"
                />
              ) : (
                <TabelaPainel>
                  <thead>
                    <tr>
                      <Th>Provedor</Th>
                      <Th>Plano</Th>
                      <Th alinhamento="direita">Receita mensal</Th>
                      <Th alinhamento="centro">Faturas pagas</Th>
                      <Th alinhamento="centro">Em atraso</Th>
                      <Th alinhamento="centro">Situação</Th>
                      <Th alinhamento="centro">Asaas</Th>
                      <Th alinhamento="centro">Ação</Th>
                    </tr>
                  </thead>
                  {/* O hairline de cada linha agora vem da célula (a primitiva
                      já o traz, como manda a §6); a última perde o dela para
                      não desenhar uma risca colada na borda do cartão. */}
                  <tbody className="[&_tr:last-child_td]:border-0">
                    {provHealth.slice().sort((a: any, b: any) => b.mrr - a.mrr).map((p: any) => {
                      const pl = PLAN_LABELS[p.plan];
                      const sit = SITUACAO_COBRANCA[p.health];
                      return (
                        <tr
                          key={p.id}
                          className="hover:bg-[var(--surface-2)] motion-safe:transition-colors"
                          data-testid={`provider-health-row-${p.id}`}
                        >
                          <Td className="font-medium text-[var(--text)]">{p.name}</Td>
                          <Td>
                            <Selo tom={pl?.tom ?? "neutro"}>{pl?.label ?? p.plan}</Selo>
                          </Td>
                          <Td num className="font-medium text-[var(--text)]">
                            {p.mrr > 0
                              ? <Dinheiro valor={p.mrr} curto />
                              : <span className="text-[var(--text-muted)] font-normal">Gratuito</span>}
                          </Td>
                          <Td num alinhamento="centro" className="text-[var(--text-muted)]">
                            {p.paidCount}/{p.invoicesCount}
                          </Td>
                          <Td alinhamento="centro">
                            {p.overdueCount > 0 ? (
                              <span className={cn(MONO, "font-medium text-[var(--past)]")}>
                                {p.overdueCount} · <Dinheiro valor={p.overdueAmount} curto className="text-[var(--past)]" />
                              </span>
                            ) : (
                              <span className="text-[var(--text-faint)]">—</span>
                            )}
                          </Td>
                          <Td alinhamento="centro">
                            {sit ? <Selo tom={sit.tom}>{sit.rotulo}</Selo> : <span className="text-[var(--text-faint)]">—</span>}
                          </Td>
                          <Td alinhamento="centro">
                            {p.hasAsaas ? (
                              /* O `title` ia direto no ícone do lucide, que
                                 não aceita a prop — não virava tooltip e era
                                 um dos erros de tsc deste arquivo. Num
                                 elemento de verdade, funciona. */
                              <span title="Cobrança Asaas ativa" className="inline-flex text-[var(--text-muted)]">
                                <Wallet className="w-3.5 h-3.5" strokeWidth={2} />
                              </span>
                            ) : (
                              <span className="text-[var(--text-faint)]">—</span>
                            )}
                          </Td>
                          <Td alinhamento="centro">
                            <button
                              type="button"
                              className={cn(BOTAO_SECUNDARIO, "px-2.5")}
                              onClick={() => navigate(`/admin/provedor/${p.id}`)}
                              data-testid={`button-go-provider-${p.id}`}
                            >
                              Abrir
                              <ChevronRight className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                            </button>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TabelaPainel>
              )}
            </Card>
          </section>

          <section>
            <KickerSecao>Faturas</KickerSecao>
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className={`${TITULO_CARTAO} flex items-center gap-2`}>
                      <FileText className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                      Faturas emitidas
                    </h3>
                    <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                      <span className={MONO}>{allInvoices.length}</span> no sistema
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={BOTAO_SECUNDARIO}
                      onClick={() => {
                        const period = currentPeriod;
                        if (confirm(`Gerar faturas mensais para ${period}?`)) generateMonthlyMutation.mutate(period);
                      }}
                      disabled={generateMonthlyMutation.isPending}
                      data-testid="button-generate-monthly"
                    >
                      {generateMonthlyMutation.isPending
                        ? <RefreshCw className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} />
                        : <Zap className="w-3.5 h-3.5 flex-none" strokeWidth={2} />}
                      Gerar as do mês
                    </button>
                    <button
                      type="button"
                      className={BOTAO_MARCA}
                      onClick={() => setShowNewInvoice(!showNewInvoice)}
                      data-testid="button-new-invoice"
                    >
                      <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                      Nova fatura
                    </button>
                  </div>
                </div>

                <div className="flex gap-1.5 mt-4 flex-wrap" role="group" aria-label="Filtrar faturas por situação">
                  {[
                    { value: "all", label: "Todas", count: allInvoices.length },
                    { value: "pending", label: "Pendentes", count: allInvoices.filter((i: any) => i.status === "pending" && new Date(i.dueDate) >= now).length },
                    { value: "paid", label: "Pagas", count: allInvoices.filter((i: any) => i.status === "paid").length },
                    { value: "overdue", label: "Vencidas", count: allInvoices.filter((i: any) => i.status === "overdue" || (i.status === "pending" && new Date(i.dueDate) < now)).length },
                    { value: "cancelled", label: "Canceladas", count: allInvoices.filter((i: any) => i.status === "cancelled").length },
                  ].map(f => (
                    <ChipFiltro
                      key={f.value}
                      ativo={invoiceFilter === f.value}
                      contagem={f.count}
                      onClick={() => setInvoiceFilter(f.value)}
                      testId={`button-filter-${f.value}`}
                    >
                      {f.label}
                    </ChipFiltro>
                  ))}
                </div>
              </div>

              {showNewInvoice && (
                <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
                  <h4 className={`${TITULO_CARTAO} mb-4`}>Emitir nova fatura</h4>
                  {carregandoPrecos && (
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3" data-testid="skeleton-precos-fatura">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="h-12 rounded bg-[var(--surface-inset)] motion-safe:animate-pulse" />
                      ))}
                    </div>
                  )}
                  {erroPrecos && (
                    /* Sem a tabela o formulario nao sabe quanto cobrar. Dizer
                       isso e melhor do que um seletor de plano vazio ao lado de
                       um campo de valor zerado.
                       A FAIXA vem de `AvisoNaoCarregou`: o bloco estava escrito
                       a mao aqui e em mais cinco pontos do painel, e o defeito
                       comum as seis era o alvo do "Tentar de novo" — texto
                       sublinhado de ~16px de altura, menos de metade dos 44px
                       que a secao 7 exige no dedo. So a FRASE fica aqui, porque
                       o que falhou muda o que dizer. */
                    <AvisoNaoCarregou
                      className="mb-3"
                      aoTentarDeNovo={() => recarregarPrecos()}
                      testId="erro-precos-fatura"
                    >
                      Não foi possível carregar a tabela de preços. A fatura não pode ser emitida sem ela.
                    </AvisoNaoCarregou>
                  )}
                  {/* `Campo` põe o controle DENTRO do rótulo: os `<label>` que
                      estavam aqui eram irmãos do controle, sem `htmlFor` —
                      clicar no nome não focava a caixa e o leitor de tela não
                      dizia o nome do campo. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <Campo rotulo="provedor">
                      <Select value={invoiceForm.providerId} onValueChange={(v) => {
                        const p = allProviders.find((x: any) => x.id.toString() === v);
                        // Sem tabela `camposDoPlano` e vazio: grava so o provedor
                        // e deixa valor e creditos como estao.
                        setInvoiceForm(f => ({ ...f, providerId: v, ...camposDoPlano(p?.plan) }));
                      }}>
                        <SelectTrigger className={CONTROLE_CAMPO} data-testid="select-invoice-provider">
                          <SelectValue placeholder="Selecionar provedor" />
                        </SelectTrigger>
                        <SelectContent>
                          {allProviders.map((p: any) => (
                            <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Campo>
                    <Campo rotulo="período (aaaa-mm)">
                      <Input className={cn(CONTROLE_CAMPO, MONO)} placeholder={currentPeriod} value={invoiceForm.period} onChange={e => setInvoiceForm(f => ({ ...f, period: e.target.value }))} data-testid="input-invoice-period" />
                    </Campo>
                    <Campo rotulo="plano cobrado">
                      <Select value={invoiceForm.planAtTime} disabled={!precos} onValueChange={v => {
                        setInvoiceForm(f => ({ ...f, ...camposDoPlano(v) }));
                      }}>
                        <SelectTrigger className={CONTROLE_CAMPO} data-testid="select-invoice-plan">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {planosDoSeletor.map(p => (
                            <SelectItem key={p.chave} value={p.chave}>{p.rotulo} — {p.precoLabel}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Campo>
                    <Campo rotulo="valor (R$)">
                      {/* Sem placeholder de preco: "199" era a tabela antiga. */}
                      <Input className={cn(CONTROLE_CAMPO, MONO)} type="number" value={invoiceForm.amount} onChange={e => setInvoiceForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-invoice-amount" />
                    </Campo>
                    <Campo rotulo="vencimento">
                      <Input className={cn(CONTROLE_CAMPO, MONO)} type="date" value={invoiceForm.dueDate} onChange={e => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))} data-testid="input-invoice-due-date" />
                    </Campo>
                    <Campo rotulo="observações">
                      <Input className={CONTROLE_CAMPO} placeholder="Opcional…" value={invoiceForm.notes} onChange={e => setInvoiceForm(f => ({ ...f, notes: e.target.value }))} />
                    </Campo>
                  </div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button
                      type="button"
                      className={BOTAO_MARCA}
                      disabled={!podeEmitirFatura || createInvoiceMutation.isPending}
                      onClick={() => createInvoiceMutation.mutate(invoiceForm)}
                      data-testid="button-submit-invoice"
                    >
                      {createInvoiceMutation.isPending
                        ? <RefreshCw className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} />
                        : <FileText className="w-3.5 h-3.5 flex-none" strokeWidth={2} />}
                      Emitir fatura
                    </button>
                    <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setShowNewInvoice(false)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {invoicesLoading ? (
                <div className="p-4">
                  <LinhasSkeleton linhas={5} />
                </div>
              ) : filteredInvoices.length === 0 ? (
                /* Não há fatura nenhuma e o filtro escondeu todas são fatos
                   diferentes; a tela não pode dizer um pelo outro. */
                <EstadoVazio
                  Icone={FileText}
                  titulo={allInvoices.length === 0 ? "Nenhuma fatura emitida" : "Nenhuma fatura neste filtro"}
                  descricao={
                    allInvoices.length === 0
                      ? "Emita uma fatura avulsa ou gere as do mês para começar a cobrar os provedores."
                      : "Existem faturas no sistema, mas nenhuma atende ao filtro escolhido. Volte para “Todas” para ver a lista inteira."
                  }
                  cta={
                    allInvoices.length === 0 ? (
                      <button type="button" className={BOTAO_MARCA} onClick={() => setShowNewInvoice(true)}>
                        <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                        Nova fatura
                      </button>
                    ) : (
                      <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setInvoiceFilter("all")}>
                        Ver todas
                      </button>
                    )
                  }
                  testId="empty-faturas"
                />
              ) : (
                <TabelaPainel>
                  <thead>
                    <tr>
                      <Th>Número</Th>
                      <Th>Provedor</Th>
                      <Th>Período</Th>
                      <Th>Plano</Th>
                      <Th alinhamento="direita">Valor</Th>
                      <Th>Vencimento</Th>
                      <Th alinhamento="centro">Situação</Th>
                      <Th alinhamento="centro">Ações</Th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child_td]:border-0">
                    {filteredInvoices.map((inv: any) => {
                      const isOverdue = inv.status === "pending" && new Date(inv.dueDate) < now;
                      const displayStatus = isOverdue ? "overdue" : inv.status;
                      const sit = SITUACAO_FATURA[displayStatus] ?? SITUACAO_FATURA.pending;
                      const pl = PLAN_LABELS[inv.planAtTime];
                      return (
                        <tr
                          key={inv.id}
                          className="hover:bg-[var(--surface-2)] motion-safe:transition-colors"
                          data-testid={`invoice-row-${inv.id}`}
                        >
                          {/* Número, período e vencimento são mono mas se leem
                              da esquerda: identificador não forma coluna de
                              grandeza, então `alinhamento="esquerda"` junto do
                              `num` — e o mesmo alinhamento no cabeçalho. */}
                          <Td num alinhamento="esquerda" className="text-[12px] font-medium text-[var(--text)]">
                            {inv.invoiceNumber}
                          </Td>
                          <Td className="font-medium text-[var(--text)]">{inv.providerName}</Td>
                          <Td num alinhamento="esquerda" className="text-[var(--text-muted)]">{inv.period}</Td>
                          <Td>
                            <Selo tom={pl?.tom ?? "neutro"}>{pl?.label ?? inv.planAtTime}</Selo>
                          </Td>
                          <Td num className="font-medium text-[var(--text)]">
                            <Dinheiro valor={parseFloat(inv.paidAmount || inv.amount)} />
                          </Td>
                          <Td num alinhamento="esquerda" className="text-[var(--text-muted)] whitespace-nowrap">
                            {new Date(inv.dueDate).toLocaleDateString("pt-BR")}
                          </Td>
                          <Td alinhamento="centro">
                            <div className="inline-flex flex-col items-center gap-1">
                              <Selo tom={sit.tom}>{sit.rotulo}</Selo>
                              {inv.asaasChargeId && (
                                <span title="Cobrança emitida no Asaas" className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                                  <Wallet className="w-2.5 h-2.5" strokeWidth={2} />
                                  Asaas
                                </span>
                              )}
                            </div>
                          </Td>
                          <Td>
                            {/* Seis botões só de ícone por linha: fantasmas em
                                repouso, pela primitiva. O verde permanente do
                                "marcar como paga" e o vermelho permanente do
                                "cancelar" saíram — a §3 reserva saturação para
                                risco, e um par de semáforos repetido em toda
                                linha ensina o operador a não ver nenhum. O
                                risco continua no cancelar, no hover. */}
                            <div className="flex items-center justify-center gap-1">
                              <BotaoIcone
                                Icone={Eye}
                                rotulo="Ver a fatura"
                                onClick={() => navigate(`/admin/fatura/${inv.id}`)}
                                testId={`button-view-invoice-${inv.id}`}
                              />
                              {(inv.status === "pending" || isOverdue) && !inv.asaasChargeId && asaasStatus?.configured && (
                                <BotaoIcone
                                  Icone={Wallet}
                                  rotulo="Cobrar via Asaas"
                                  onClick={() => setAsaasChargeModal({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber })}
                                  testId={`button-asaas-charge-${inv.id}`}
                                />
                              )}
                              {inv.asaasChargeId && (
                                <BotaoIcone
                                  Icone={RotateCcw}
                                  rotulo="Sincronizar com o Asaas"
                                  girando={syncChargeMutation.isPending}
                                  disabled={syncChargeMutation.isPending}
                                  onClick={() => syncChargeMutation.mutate(inv.id)}
                                  testId={`button-asaas-sync-${inv.id}`}
                                />
                              )}
                              {inv.asaasInvoiceUrl && (
                                <a
                                  href={inv.asaasInvoiceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  /* Âncora, e não botão: `BotaoIcone` renderiza
                                     um `<button>`, então aqui vale a constante
                                     da mesma primitiva. */
                                  className={BOTAO_ICONE}
                                  title="Abrir o link de pagamento"
                                  aria-label="Abrir o link de pagamento"
                                  data-testid={`link-asaas-payment-${inv.id}`}
                                >
                                  <ExternalLink className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                                </a>
                              )}
                              {(inv.status === "pending" || isOverdue) && (
                                <BotaoIcone
                                  Icone={CheckCircle}
                                  rotulo="Marcar como paga"
                                  onClick={() => updateInvoiceStatusMutation.mutate({ id: inv.id, status: "paid", paidAmount: inv.amount })}
                                  testId={`button-mark-paid-${inv.id}`}
                                />
                              )}
                              {(inv.status === "pending" || isOverdue) && (
                                <BotaoIcone
                                  Icone={Ban}
                                  tom="risco"
                                  rotulo="Cancelar a fatura"
                                  onClick={() => { if (confirm("Cancelar esta fatura?")) cancelInvoiceMutation.mutate(inv.id); }}
                                  testId={`button-cancel-invoice-${inv.id}`}
                                />
                              )}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TabelaPainel>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

/** Uma troca de plano do mês. O sinal do dinheiro é a única cor da linha. */
function LinhaMovimento({
  provedor, de, para, valor, negativa,
}: {
  provedor: string; de: string; para: string; valor: number | string; negativa: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--border-faint)] last:border-0">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-[var(--text)] truncate">{provedor}</p>
        <p className="text-[11.5px] text-[var(--text-muted)] truncate">{de} → {para}</p>
      </div>
      <Dinheiro
        valor={valor}
        curto
        sinal={negativa ? "−" : "+"}
        className={cn("text-[12.5px] font-medium flex-none", !negativa && "text-[var(--ok)]")}
      />
    </div>
  );
}
