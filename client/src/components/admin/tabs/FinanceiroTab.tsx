import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Wallet, TrendingUp, DollarSign, AlertCircle, TrendingDown, BarChart3, Crown,
  Plus, RefreshCw, Zap, FileText, Clock, ArrowUpDown, CreditCard,
} from "lucide-react";
import { usePrecos, camposDaFatura } from "@/hooks/use-precos";
import { PLAN_LABELS } from "../constants";
import InvoiceTable from "../InvoiceTable";
import {
  CartaoMetrica, KickerSecao, Selo, EstadoVazio, LinhasSkeleton, LadrilhoIcone,
  BotaoLink, TabelaPainel, Th, Td, Campo, AvisoNaoCarregou, TITULO_CARTAO,
  BOTAO_SECUNDARIO, BOTAO_MARCA, DESABILITAVEL,
} from "@/components/painel/ui";
import {
  Dinheiro, ChipFiltro, ModalCobrancaAsaas, ModalPixAsaas, CONTROLE_CAMPO,
  textoDeReal,
} from "../financeiro-ui";

/**
 * Faturas e Cobranças do superadmin, vestida na MESMA linguagem do Painel do
 * Provedor.
 *
 * Nada de dado, rota, consulta, permissão ou `data-testid` mudou nesta rodada —
 * só o vocabulário visual. Esta era a maior tela do painel SaaS ainda escrita na
 * API antiga de token, com quatro classes da paleta default do Tailwind soltas
 * (azul em dois tons, índigo e roxo) e com as cinco peças da linguagem — cartão
 * de métrica, selo, estado vazio, esqueleto de carregamento e botão —
 * redigitadas à mão em cada bloco. Agora tudo fala por `@/components/painel/ui`,
 * e os literais antigos não aparecem nem em comentário: uma auditoria futura de
 * token é feita por grep, e citar a classe proibida envenena o resultado.
 *
 * AS DECISÕES QUE VALEM COMENTÁRIO
 *
 * 1. DINHEIRO. Todo valor monetário passa por `<Dinheiro>`: mono tabular, duas
 *    casas, e `--money-neg` quando o número é negativo (DESIGN_SYSTEM §3, "sinal
 *    de valor"). Antes o mesmo real aparecia de três jeitos na mesma tela — sem
 *    centavos no cartão de KPI, com centavos na barra do Asaas e cru (`R$${n}`,
 *    sem separador de milhar) no gráfico. Coluna de dinheiro desalinhada é o
 *    defeito que a §2 chama de leitura destruída.
 *
 * 2. O VERMELHO DO ATRASO. O único valor que sai da tinta de corpo é a receita
 *    vencida, e não por ser negativa: `--past` é literalmente o token de
 *    "atraso, negativação" (index.css:54). A §3 reserva saturação para risco, e
 *    fatura vencida é risco. Receita em aberto NÃO recebe cor: ela ainda pode
 *    ser paga no prazo.
 *
 * 3. SEM COR POR CARTÃO. Os quatro KPIs tinham cada um uma faixa colorida no
 *    topo e um ladrilho de ícone da mesma cor — quatro saturações lado a lado
 *    para quatro métricas igualmente informativas. É o mesmo ruído que a
 *    primitiva já resolveu no painel do provedor: ícone neutro, número herói.
 *
 * 4. "MRR"/"ARR" SAÍRAM DA TELA. §8 proíbe jargão exposto, e as duas siglas são
 *    jargão em inglês. O rótulo passa a dizer o que a conta é, e a sublinha diz
 *    de onde ela vem — inclusive que a receita anual é a mensal projetada em 12
 *    meses (`arr = mrr * 12`, financial.storage.ts:136), que a tela antes
 *    apresentava como se fosse uma medição independente.
 *
 * 5. "EM ABERTO" INCLUI AS VENCIDAS. O servidor soma `pending` E `overdue` em
 *    `pendingRevenue` (financial.storage.ts:137-143), então os dois cartões se
 *    sobrepõem. Isso agora está escrito na sublinha em vez de o leitor somar os
 *    dois e chegar a um total que não existe.
 *
 * 6. O QUE ERA LOCAL E FICOU DIVERGENTE MUDOU DE ENDEREÇO. Cabeçalho e célula de
 *    tabela, rótulo de campo e estado desabilitado eram cópias manuscritas e
 *    agora vêm de `@/components/painel/ui` — a mesma tabela dos dois painéis.
 *    Dinheiro, chip de filtro, altura de campo e os dois modais do Asaas eram
 *    cópias compartilhadas com a PÁGINA `admin-financeiro` e mudaram para
 *    `../financeiro-ui`, que existe para isso. Nenhuma cópia local sobrou aqui:
 *    é por onde a divergência voltaria.
 */

/* ------------------------------------------------------------------ */
/* Vocabulário desta tela                                              */
/* ------------------------------------------------------------------ */

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** Carregamento do gráfico. `LinhasSkeleton` mostra a forma de uma LISTA, e o
 *  que vem aqui são seis colunas — mostrar a forma errada é quase tão ruim
 *  quanto o spinner que estava no lugar. */
function EsqueletoGrafico() {
  const alturas = ["45%", "70%", "35%", "85%", "55%", "95%"];
  return (
    <div className="flex items-end gap-2 h-32" aria-hidden>
      {alturas.map((h, i) => (
        <div key={i} className="flex-1 flex flex-col justify-end h-full">
          <Skeleton className="w-full rounded-t-[3px]" style={{ height: h }} />
        </div>
      ))}
    </div>
  );
}

const FILTROS_DE_FATURA = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "Pendentes" },
  { value: "paid", label: "Pagas" },
  { value: "overdue", label: "Vencidas" },
  { value: "cancelled", label: "Canceladas" },
];

/* ------------------------------------------------------------------ */

export default function FinanceiroTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [invoiceFilter, setInvoiceFilter] = useState("all");
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    providerId: "", period: "", amount: "", planAtTime: "pro",
    ispCreditsIncluded: "0", spcCreditsIncluded: "0",
    dueDate: "", notes: "",
  });

  /**
   * Valor e creditos do formulario saem do servidor, que e quem cobra. A
   * tabela cravada aqui tinha envelhecido: o seletor oferecia "Pro — R$ 399"
   * e o formulario preenchia outro valor.
   */
  const { data: precos, isLoading: carregandoPrecos, isError: erroPrecos, refetch: recarregarPrecos } = usePrecos();
  const planosDoSeletor = precos?.planos ?? [];
  /**
   * Sem tabela o preenchimento nao acontece: `camposDaFatura` devolve `null` e
   * o campo fica intocado. O `?? 0` anterior gravava fatura de R$ 0,00 para
   * provedor pagante quando a leitura de preco falhava — e como a query nao
   * refaz a leitura ao voltar o foco, ela ficava indisponivel ate a pagina
   * recarregar. Ausencia de preco nao e gratuidade.
   */
  const camposDoPlano = (chave: string | null | undefined) => camposDaFatura(precos, chave) ?? {};
  const podeEmitirFatura = Boolean(precos);

  const [asaasChargeModal, setAsaasChargeModal] = useState<{ invoiceId: number; invoiceNumber: string } | null>(null);
  const [asaasPixModal, setAsaasPixModal] = useState<{ invoiceId: number; pixData: any } | null>(null);

  const { data: allProviders = [], isLoading: carregandoProvedores } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
  });
  const { data: planHistory = [], isLoading: carregandoHistorico } = useQuery<any[]>({
    queryKey: ["/api/admin/plan-history"],
  });
  const { data: financialSummary, isLoading: carregandoResumo } = useQuery<any>({
    queryKey: ["/api/admin/financial/summary"],
  });
  const { data: allInvoices = [], isLoading: invoicesLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/invoices"],
  });
  const { data: asaasStatus } = useQuery<any>({
    queryKey: ["/api/admin/asaas/status"],
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
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      setShowNewInvoice(false);
      setInvoiceForm({ providerId: "", period: "", amount: "", planAtTime: "pro", ispCreditsIncluded: "0", spcCreditsIncluded: "0", dueDate: "", notes: "" });
      toast({ title: "Fatura emitida com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao emitir fatura", description: e.message, variant: "destructive" }),
  });

  const updateInvoiceStatusMutation = useMutation({
    mutationFn: async ({ id, status, paidAmount }: { id: number; status: string; paidAmount?: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/invoices/${id}/status`, { status, paidAmount });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Situação da fatura atualizada" });
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
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Faturas geradas", description: data.message });
    },
    onError: (e: any) => toast({ title: "Erro ao gerar faturas", description: e.message, variant: "destructive" }),
  });

  const cancelInvoiceMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/invoices/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Fatura cancelada" });
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
      qc.invalidateQueries({ queryKey: ["/api/admin/financial/summary"] });
      toast({ title: "Situação sincronizada com o Asaas" });
    },
    onError: (e: any) => toast({ title: "Erro ao sincronizar", description: e.message, variant: "destructive" }),
  });

  const pixMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("GET", `/api/admin/invoices/${id}/asaas/pix`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data, id) => {
      setAsaasPixModal({ invoiceId: id as number, pixData: data });
    },
    onError: (e: any) => toast({ title: "Erro ao buscar PIX", description: e.message, variant: "destructive" }),
  });

  /* Fora do map: o cálculo do máximo estava dentro dele e refazia a varredura
     dos seis meses uma vez por barra. */
  const mesesDeReceita: any[] = financialSummary?.last6Months ?? [];
  const receitaMaxima = Math.max(...mesesDeReceita.map((m: any) => m.revenue ?? 0), 1);

  const distribuicaoDePlanos = Object.entries(financialSummary?.planDistribution ?? {}) as [string, number][];
  const totalDistribuido = distribuicaoDePlanos.reduce((soma, [, n]) => soma + Number(n), 0);

  const totalDeFaturas = allInvoices.length;
  const vencidas = Number(financialSummary?.overdueCount ?? 0);

  return (
    <div className="space-y-6" data-testid="admin-financeiro">

      {/* Gateway de cobrança ------------------------------------------------
          Era uma faixa inteira pintada de verde ou âmbar. A profundidade deste
          sistema é hairline (§5.2), então o cartão volta a ser superfície e só
          a BORDA muda de tom; quem afirma o estado é o selo. */}
      {asaasStatus && (
        <Card
          className={cn(
            "p-4 flex items-center justify-between gap-4 flex-wrap",
            asaasStatus.configured ? "border-[var(--ok-border)]" : "border-[var(--gated-border)]",
          )}
          data-testid="card-asaas-status"
        >
          <div className="flex items-center gap-3 min-w-0">
            {/* Nunca `marca`: esse tom promete que o bloco leva a algum lugar, e
                esta faixa não navega. Conectado usa `vazio` (neutro, o estado
                fica no selo); sem chave usa `risco`, que é a porta fechada — não
                há como cobrar ninguém por aqui. */}
            <LadrilhoIcone Icone={Wallet} tom={asaasStatus.configured ? "vazio" : "risco"} />
            <div className="min-w-0">
              <p className={TITULO_CARTAO}>
                {asaasStatus.configured ? "Asaas conectado" : "Asaas não configurado"}
              </p>
              <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                {asaasStatus.configured ? (
                  <>Saldo disponível: <Dinheiro valor={asaasStatus.balance?.balance ?? 0} /></>
                ) : (
                  <>
                    Sem a chave{" "}
                    <code className="font-mono text-[11px] text-[var(--text-2)]">ASAAS_API_KEY</code>{" "}
                    no servidor, as cobranças precisam ser lançadas à mão.
                  </>
                )}
              </p>
            </div>
          </div>
          {asaasStatus.configured && (
            /* "Sandbox"/"Producao" era valor cru do gateway. O que o superadmin
               precisa saber é se o dinheiro é real. */
            asaasStatus.mode === "sandbox" ? (
              <Selo tom="gated" testId="selo-asaas-modo">Ambiente de testes</Selo>
            ) : (
              <Selo tom="ok" testId="selo-asaas-modo">Cobrança real</Selo>
            )
          )}
        </Card>
      )}

      {/* Métricas ---------------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <CartaoMetrica
          testId="kpi-mrr"
          testIdValor="value-kpi-mrr"
          rotulo="Receita mensal"
          Icone={TrendingUp}
          carregando={carregandoResumo}
          valor={<Dinheiro valor={financialSummary?.mrr ?? 0} />}
          sub="recorrente, dos provedores ativos"
        />
        <CartaoMetrica
          testId="kpi-arr"
          testIdValor="value-kpi-arr"
          rotulo="Receita anual"
          Icone={DollarSign}
          carregando={carregandoResumo}
          valor={<Dinheiro valor={financialSummary?.arr ?? 0} />}
          sub="a mensal projetada em 12 meses"
        />
        <CartaoMetrica
          testId="kpi-pending"
          testIdValor="value-kpi-pending"
          rotulo="Em aberto"
          Icone={AlertCircle}
          carregando={carregandoResumo}
          valor={<Dinheiro valor={financialSummary?.pendingRevenue ?? 0} />}
          sub={
            <>
              <span className="font-mono tabular-nums">{financialSummary?.pendingCount ?? 0}</span>{" "}
              faturas a receber, vencidas incluídas
            </>
          }
        />
        <CartaoMetrica
          testId="kpi-overdue"
          testIdValor="value-kpi-overdue"
          rotulo="Em atraso"
          Icone={TrendingDown}
          carregando={carregandoResumo}
          /* O único número da tela fora da tinta de corpo, e só quando há
             atraso de verdade: `--past` é o token de atraso/negativação. */
          valor={
            <Dinheiro
              valor={financialSummary?.overdueRevenue ?? 0}
              className={vencidas > 0 ? "text-[var(--past)]" : undefined}
            />
          }
          sub={
            <span className={vencidas > 0 ? "text-[var(--past)]" : undefined}>
              <span className="font-mono tabular-nums">{vencidas}</span> faturas vencidas
            </span>
          }
        />
      </div>

      {/* Receita e planos --------------------------------------------------- */}
      <section>
        <KickerSecao>Receita e composição da base</KickerSecao>
        <div className="grid lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2 p-4">
            <h3 className={`${TITULO_CARTAO} flex items-center gap-2 mb-4`}>
              <BarChart3 className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
              Recebido por mês
              <span className="font-mono text-[11px] font-normal tabular-nums text-[var(--text-muted)]">
                últimos 6
              </span>
            </h3>
            {carregandoResumo ? (
              <EsqueletoGrafico />
            ) : mesesDeReceita.length === 0 ? (
              <EstadoVazio
                Icone={BarChart3}
                titulo="Ainda sem faturas pagas"
                descricao="Assim que a primeira fatura for quitada, o valor recebido em cada mês aparece nesta série."
                testId="empty-receita-mensal"
              />
            ) : (
              <div className="flex items-end gap-2 h-32">
                {mesesDeReceita.map((m: any) => {
                  const receita = m.revenue ?? 0;
                  const pct = (receita / receitaMaxima) * 100;
                  const mes = MESES[parseInt(String(m.period).split("-")[1], 10) - 1] ?? m.period;
                  return (
                    <div key={m.period} className="flex flex-col items-center flex-1 gap-1 min-w-0">
                      <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)] truncate w-full text-center">
                        {receita > 0 ? <Dinheiro valor={receita} curto /> : ""}
                      </span>
                      <div
                        /* Barra: uma cor de marca só, sem gradiente. O título
                           nativo devolve o valor exato que o rótulo arredonda. */
                        className="w-full rounded-t-[3px] bg-[var(--brand)] motion-safe:transition-all"
                        style={{ height: `${Math.max(pct, 4)}%` }}
                        title={`${m.period}: ${textoDeReal(receita)}`}
                      />
                      <span className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">
                        {mes}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h3 className={`${TITULO_CARTAO} flex items-center gap-2 mb-4`}>
              <Crown className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
              Provedores por plano
            </h3>
            {carregandoResumo ? (
              <LinhasSkeleton linhas={3} />
            ) : distribuicaoDePlanos.length === 0 ? (
              <EstadoVazio
                Icone={Crown}
                titulo="Nenhum provedor cadastrado"
                descricao="A divisão por plano aparece aqui quando o primeiro provedor concluir o cadastro."
                cta={<BotaoLink href="#provedores">Abrir provedores</BotaoLink>}
                testId="empty-distribuicao-planos"
              />
            ) : (
              <div className="space-y-3">
                {distribuicaoDePlanos.map(([plano, quantidade]) => {
                  const n = Number(quantidade);
                  const pct = totalDistribuido > 0 ? Math.round((n / totalDistribuido) * 100) : 0;
                  return (
                    <div key={plano} data-testid={`distribuicao-plano-${plano}`}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        {/* Selo pela primitiva, com o `tom` do catálogo — a
                            última cópia manuscrita de pílula de plano nesta
                            tela morre aqui. */}
                        <Selo tom={PLAN_LABELS[plano]?.tom}>{PLAN_LABELS[plano]?.label ?? plano}</Selo>
                        <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                          {n} · {pct}%
                        </span>
                      </div>
                      {/* Trilha em --surface-inset, que é o token da trilha de
                          barra. Raio de 4px: a trilha e o preenchimento eram
                          arredondados por inteiro, e a geometria deste sistema
                          é seca — nada acima de 8px, e canto de pílula só em
                          avatar, ponto e spinner (§5.1). */}
                      <div className="h-1.5 rounded bg-[var(--surface-inset)] overflow-hidden">
                        <div className="h-full rounded bg-[var(--brand)]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* Faturas ------------------------------------------------------------ */}
      <section>
        <KickerSecao>Faturas</KickerSecao>
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-[var(--border)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className={`${TITULO_CARTAO} flex items-center gap-2`}>
                  <FileText className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                  Faturas emitidas
                </h3>
                <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                  <span className="font-mono tabular-nums">{totalDeFaturas}</span>{" "}
                  {totalDeFaturas === 1 ? "fatura no sistema" : "faturas no sistema"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={cn(BOTAO_SECUNDARIO, DESABILITAVEL)}
                  onClick={() => {
                    const period = new Date().toISOString().slice(0, 7);
                    if (confirm(`Gerar faturas mensais para ${period}?`)) generateMonthlyMutation.mutate(period);
                  }}
                  disabled={generateMonthlyMutation.isPending}
                  data-testid="button-generate-monthly-invoices"
                >
                  {generateMonthlyMutation.isPending
                    ? <RefreshCw className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} />
                    : <Zap className="w-3.5 h-3.5 flex-none" strokeWidth={2} />}
                  Gerar mensais
                </button>
                <button
                  type="button"
                  className={BOTAO_MARCA}
                  onClick={() => setShowNewInvoice(!showNewInvoice)}
                  aria-expanded={showNewInvoice}
                  data-testid="button-new-invoice"
                >
                  <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                  Nova fatura
                </button>
              </div>
            </div>

            {/* Filtro por situação */}
            <div className="flex gap-1.5 mt-4 flex-wrap" role="group" aria-label="Filtrar faturas por situação">
              {FILTROS_DE_FATURA.map((f) => (
                <ChipFiltro
                  key={f.value}
                  ativo={invoiceFilter === f.value}
                  /* "Todas" não leva contagem aqui: o total já está escrito
                     acima, em "N faturas no sistema". */
                  contagem={
                    f.value === "all"
                      ? undefined
                      : allInvoices.filter((i: any) => i.status === f.value).length
                  }
                  onClick={() => setInvoiceFilter(f.value)}
                  testId={`button-invoice-filter-${f.value}`}
                >
                  {f.label}
                </ChipFiltro>
              ))}
            </div>
          </div>

          {/* Emissão de fatura */}
          {showNewInvoice && (
            <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <h4 className={`${TITULO_CARTAO} mb-4`}>Emitir nova fatura</h4>
              {carregandoPrecos && (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3" data-testid="skeleton-precos-fatura">
                  {[0, 1, 2].map(i => (
                    <Skeleton key={i} className="h-12 rounded" />
                  ))}
                </div>
              )}
              {/* A faixa e a mesma da pagina `admin-financeiro` porque agora e a
                  MESMA peca: `AvisoNaoCarregou`. Enquanto ela estava escrita a
                  mao dos dois lados, a diferenca que sobrou entre as copias foi
                  o anel de foco — e o defeito comum a elas era o alvo do
                  "Tentar de novo", que a primitiva resolve. */}
              {erroPrecos && (
                <AvisoNaoCarregou
                  className="mb-3"
                  aoTentarDeNovo={() => recarregarPrecos()}
                  testId="erro-precos-fatura"
                >
                  Não foi possível carregar a tabela de preços. A fatura não pode ser emitida sem ela.
                </AvisoNaoCarregou>
              )}
              {/* `Campo` põe o controle DENTRO do rótulo: sem isso, clicar no
                  nome do campo não foca a caixa e o leitor de tela anuncia a
                  caixa sem dizer o que ela é. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Campo rotulo="provedor">
                  <Select value={invoiceForm.providerId} onValueChange={(v) => {
                    const p = allProviders.find((x: any) => x.id.toString() === v);
                    // Sem tabela `camposDoPlano` e vazio: grava so o provedor e
                    // deixa valor e creditos como estao.
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
                  <Input className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} placeholder="2026-03" value={invoiceForm.period} onChange={(e) => setInvoiceForm(f => ({ ...f, period: e.target.value }))} data-testid="input-invoice-period" />
                </Campo>
                <Campo rotulo="plano cobrado">
                  <Select value={invoiceForm.planAtTime} disabled={!precos} onValueChange={(v) => {
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
                  <Input className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} type="number" value={invoiceForm.amount} onChange={(e) => setInvoiceForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-invoice-amount" />
                </Campo>
                <Campo rotulo="vencimento">
                  <Input className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")} type="date" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))} data-testid="input-invoice-due-date" />
                </Campo>
                <Campo rotulo="observações (opcional)">
                  <Input className={CONTROLE_CAMPO} placeholder="Observação…" value={invoiceForm.notes} onChange={(e) => setInvoiceForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-invoice-notes" />
                </Campo>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  className={cn(BOTAO_MARCA, DESABILITAVEL)}
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

          {/* Lista de faturas. O spinner centralizado que estava aqui virou
              esqueleto: acima de 300ms a tela mostra a forma do que vem (§6). */}
          {invoicesLoading ? (
            <div className="p-4">
              <LinhasSkeleton linhas={5} />
            </div>
          ) : (
            <InvoiceTable
              invoices={allInvoices}
              filter={invoiceFilter}
              asaasConfigured={!!asaasStatus?.configured}
              onOpenAsaasCharge={setAsaasChargeModal}
              onSyncCharge={(id) => syncChargeMutation.mutate(id)}
              onOpenPix={(id) => pixMutation.mutate(id)}
              onMarkPaid={(id, amount) => updateInvoiceStatusMutation.mutate({ id, status: "paid", paidAmount: amount })}
              onCancel={(id) => cancelInvoiceMutation.mutate(id)}
              syncChargePending={syncChargeMutation.isPending}
              pixPending={pixMutation.isPending}
            />
          )}
        </Card>
      </section>

      {/* Créditos e histórico ------------------------------------------------ */}
      <section>
        <KickerSecao>Créditos e histórico</KickerSecao>
        <div className="grid lg:grid-cols-2 gap-3">
          <Card className="overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <h3 className={`${TITULO_CARTAO} flex items-center gap-2`}>
                <CreditCard className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                Créditos por provedor
              </h3>
            </div>
            {carregandoProvedores ? (
              <div className="p-4"><LinhasSkeleton linhas={4} /></div>
            ) : allProviders.length === 0 ? (
              <EstadoVazio
                Icone={CreditCard}
                titulo="Nenhum provedor cadastrado"
                descricao="O saldo de cada provedor aparece aqui assim que o primeiro cadastro for concluído."
                cta={<BotaoLink href="#provedores">Abrir provedores</BotaoLink>}
                testId="empty-creditos-provedores"
              />
            ) : (
              /* Vira TABELA de verdade: nome + duas colunas de número. Como
                 lista, os saldos ficavam soltos no meio do texto e não havia
                 coluna para alinhar — que é o que o `.num` da §6 existe para
                 resolver.
                 O `sticky top-0` do cabeçalho SAIU junto com o TH local, e não
                 por gosto: `TabelaPainel` traz o próprio container de rolagem
                 horizontal, que vira o container de rolagem do cabeçalho — e
                 ele não é o que rola aqui (quem rola é a caixa de fora, com a
                 altura máxima). Grudado num container que não se move, o
                 `sticky` não gruda em nada. Ver o aviso da entrega. */
              <div className="max-h-64 overflow-y-auto">
                <TabelaPainel>
                  <thead>
                    <tr>
                      <Th>Provedor</Th>
                      <Th alinhamento="direita">ISP</Th>
                      <Th alinhamento="direita">SPC</Th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child_td]:border-0">
                    {allProviders.map((p: any) => (
                      <tr key={p.id} data-testid={`credit-row-${p.id}`}>
                        <Td className="text-[13px] font-medium text-[var(--text)] w-full">
                          {p.name}
                        </Td>
                        <Td num className="text-[var(--text)]">{p.ispCredits}</Td>
                        <Td num className="text-[var(--text)]">{p.spcCredits}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TabelaPainel>
              </div>
            )}
            <p className="text-[12px] text-[var(--text-muted)] px-4 py-3 border-t border-[var(--border)] mt-auto">
              {/* "drawer" era jargão de quem construiu a tela, não de quem a lê. */}
              Para lançar créditos a um provedor, abra a ficha dele na aba Provedores.
            </p>
          </Card>

          <Card className="overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <h3 className={`${TITULO_CARTAO} flex items-center gap-2`}>
                <ArrowUpDown className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                Alterações de plano e crédito
              </h3>
            </div>
            {carregandoHistorico ? (
              <div className="p-4"><LinhasSkeleton linhas={4} /></div>
            ) : planHistory.length === 0 ? (
              <EstadoVazio
                Icone={Clock}
                titulo="Nenhum histórico ainda"
                descricao="Toda troca de plano e todo crédito lançado por aqui ficam registrados nesta lista."
                cta={<BotaoLink href="#provedores">Abrir provedores</BotaoLink>}
                testId="empty-historico-financeiro"
              />
            ) : (
              /* Mesmo dado do Painel Geral, agora com a MESMA forma: data mono
                 no topo, o que mudou embaixo. Duas telas do mesmo painel não
                 podem contar a mesma linha de dois jeitos. */
              <div className="max-h-64 overflow-y-auto">
                {planHistory.map((h: any) => (
                  <div
                    key={h.id}
                    className="px-4 py-2.5 border-b border-[var(--border-faint)] last:border-0"
                    data-testid={`plan-history-row-${h.id}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                      <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                        {new Date(h.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    {h.newPlan ? (
                      <p className="text-[12.5px] text-[var(--text-2)] mt-1">
                        Plano: <strong className="text-[var(--text)] font-medium">{PLAN_LABELS[h.oldPlan]?.label ?? h.oldPlan}</strong>
                        {" → "}
                        <strong className="text-[var(--text)] font-medium">{PLAN_LABELS[h.newPlan]?.label ?? h.newPlan}</strong>
                      </p>
                    ) : (
                      <p className="text-[12.5px] text-[var(--text-2)] mt-1">
                        Créditos: ISP{" "}
                        <strong className="font-mono tabular-nums text-[var(--text)] font-medium">+{h.ispCreditsAdded}</strong>
                        {" / SPC "}
                        <strong className="font-mono tabular-nums text-[var(--text)] font-medium">+{h.spcCreditsAdded}</strong>
                      </p>
                    )}
                    {h.notes && (
                      <p className="text-[12px] text-[var(--text-muted)] truncate mt-0.5">{h.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* Os dois modais do Asaas vivem em `../financeiro-ui`: eram a mesma peça
          escrita aqui e na página `admin-financeiro`, e divergiam no ícone do
          boleto, no corpo do título e na acessibilidade. */}
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
    </div>
  );
}
