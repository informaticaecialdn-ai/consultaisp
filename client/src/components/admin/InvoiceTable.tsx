import { useLocation } from "wouter";
import {
  Eye, Wallet, RefreshCw, RotateCcw, QrCode, CheckCircle, Ban, ExternalLink, Receipt,
} from "lucide-react";
import {
  Selo, EstadoVazio, TabelaPainel, Th, Td, BotaoIcone, Dinheiro,
  BOTAO_ICONE, TABELA_NUM,
  type TomSelo,
} from "@/components/painel/ui";
import { PLAN_LABELS } from "./constants";

/**
 * Tabela de faturas do superadmin, na MESMA linguagem do Painel do Provedor.
 *
 * Rodada de LINGUAGEM VISUAL: nenhuma rota, consulta, permissao, prop ou
 * data-testid mudou. O que mudou foi de que vocabulario a tabela fala.
 *
 * O QUE ESTAVA ERRADO, E POR QUE ISSO IMPORTA NUMA TABELA DE DINHEIRO
 * 1. Nenhum numero era tabular. Valor, vencimento, periodo e o proprio numero
 *    da fatura desciam em fonte proporcional: as colunas nao alinhavam, e ler
 *    "R$ 1.499,00" contra "R$ 149,00" virava contagem de digito. A secao 2 do
 *    DESIGN_SYSTEM manda `tabular-nums` em TODO numero, e uma tabela de fatura
 *    e o caso em que a regra se paga sozinha.
 * 2. O cabecalho era Inter 12px semibold — nao a `.ds-table th` da secao 6
 *    (mono, caixa alta, tracking aberto). Era o unico rotulo do painel que nao
 *    soava como os outros.
 * 3. Tres cores da paleta default do Tailwind, cruas: um azul no selo do
 *    gateway, um indigo no botao de sincronizar e um azul de tema escuro no
 *    numero da fatura. (Os literais nao sao repetidos aqui de proposito: uma
 *    auditoria por grep nao pode ser envenenada pelo comentario que conta que
 *    eles sairam.)
 * 4. Botao de acao com `h-7 w-7` (28px). A secao 7 nao negocia 44x44 no
 *    ponteiro grosso — sao seis botoes lado a lado numa linha de 40px de
 *    altura, exatamente o caso em que o dedo erra e o operador cancela uma
 *    fatura querendo abrir outra.
 * 5. O vazio era uma frase solta no meio do card. Estado vazio e estado real
 *    (secao 6): icone, titulo, descricao — e a descricao agora distingue "nao
 *    ha fatura" de "o filtro escondeu as faturas", que sao coisas diferentes.
 *
 * MIGRACAO PEDIDA PELO CATALOGO, JA CONCLUIDA: o plano saiu de `<Badge
 * className={PLAN_LABELS[...].color}>` para `<Selo tom={PLAN_LABELS[...].tom}>`.
 * O campo `color` era @deprecated em `constants.ts` com um contrato explicito —
 * sai quando o ultimo consumidor migrar — e o contrato foi cumprido: o campo
 * NAO EXISTE MAIS. Hoje a unica forma de pintar um plano e o `tom`, e nao ha
 * mais dois campos que possam discordar.
 *
 * SEGUNDA RODADA — AS COPIAS LOCAIS SAIRAM
 * Este arquivo tinha `TH`, `TD`, `NUM` e um `BOTAO_ICONE` proprios, escritos
 * aqui porque `painel/ui` ainda nao os tinha. Agora tem, e a copia foi apagada:
 * enquanto ela existisse, o proximo ajuste de tabela seria feito de um lado so
 * e a divergencia voltaria pelo mesmo caminho.
 *
 * O que MUDA de aparencia com a troca, de proposito:
 * - o cabecalho cai de 10px para 9,5px (a secao 6 crava 9.5 no `th`; 10px e o
 *   corpo do selo, e cabecalho no mesmo corpo do selo deixa de ser cabecalho);
 * - o separador entre linhas passa a ser o hairline estrutural da primitiva,
 *   desenhado na propria celula em vez da linha;
 * - os seis botoes de acao ganham ANEL DE FOCO. Era o defeito de verdade: este
 *   arquivo manteve o `<Button>` do shadcn com uma classe que nao declarava
 *   foco nenhum, entao a fila inteira de acoes era invisivel ao teclado. A
 *   secao 7 chama isso de nao negociavel.
 * - o "Cancelar fatura" deixa de ser vermelho em repouso e passa a vestir a
 *   tinta de risco so no hover, como a primitiva define: um icone vermelho
 *   repetido em toda linha vira alarme continuo, e o operador para de ver o
 *   alarme que importa.
 *
 * TERCEIRA RODADA — O DINHEIRO TAMBEM SAIU DAQUI
 * A coluna de valor era a ultima peca manuscrita: um "R$ " com espaco comum
 * mais `toLocaleString`, escrito nesta tabela porque o formatador do painel
 * morava no vocabulario financeiro do superadmin e nao dava para consumir de
 * um componente compartilhado. Hoje `Dinheiro` mora em `painel/ui`, e a tabela
 * consome a mesma peca que o resto do produto.
 */

export interface InvoiceTableProps {
  invoices: any[];
  filter: string;
  asaasConfigured: boolean;
  onOpenAsaasCharge: (inv: { invoiceId: number; invoiceNumber: string }) => void;
  onSyncCharge: (id: number) => void;
  onOpenPix: (id: number) => void;
  onMarkPaid: (id: number, amount: string) => void;
  onCancel: (id: number) => void;
  syncChargePending: boolean;
  pixPending: boolean;
}

/**
 * Situacao da fatura, em portugues e com tom pelo significado.
 * `pending` e a porta que ainda nao abriu (gated), `overdue` e risco de
 * verdade (danger), `cancelled` nao afirma nada (neutro) — a saturacao fica
 * reservada para risco, como manda a secao 3.
 */
const SITUACAO: Record<string, { rotulo: string; tom: TomSelo }> = {
  pending: { rotulo: "Pendente", tom: "gated" },
  paid: { rotulo: "Paga", tom: "ok" },
  overdue: { rotulo: "Vencida", tom: "danger" },
  cancelled: { rotulo: "Cancelada", tom: "neutro" },
};

/** Valor cru fora do catalogo (linha antiga, escrita por fora) nao vira selo
 *  colorido: cai em neutro com o proprio valor, que ao menos e verdade. */
const situacaoDe = (chave: string) => SITUACAO[chave] ?? { rotulo: chave, tom: "neutro" as TomSelo };

export default function InvoiceTable({
  invoices, filter, asaasConfigured,
  onOpenAsaasCharge, onSyncCharge, onOpenPix, onMarkPaid, onCancel,
  syncChargePending, pixPending,
}: InvoiceTableProps) {
  const [, navigate] = useLocation();
  const filtered = filter === "all" ? invoices : invoices.filter((i: any) => i.status === filter);

  if (filtered.length === 0) {
    return (
      <EstadoVazio
        Icone={Receipt}
        titulo="Nenhuma fatura encontrada"
        descricao={
          filter === "all"
            ? "Assim que a primeira fatura for gerada, ela aparece aqui com provedor, valor, vencimento e situação."
            : "Nenhuma fatura corresponde ao filtro escolhido. Troque o filtro para ver as demais."
        }
        testId="empty-faturas"
      />
    );
  }

  return (
    <TabelaPainel>
      <thead>
        <tr>
          {/* Numero e vencimento sao mono mas se LEEM da esquerda (um
              identificador que se dita, uma data que se compara por dia), entao
              cabeca e celula apontam para o mesmo lado. So o valor, que se
              compara digito a digito, alinha a direita. */}
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
      {/* A celula da primitiva ja traz o hairline; a ultima linha o devolve para
          nao desenhar uma borda sobrando na base do card. */}
      <tbody className="[&>tr:last-child>td]:border-b-0">
        {filtered.map((inv: any) => {
          const isOverdue = inv.status === "pending" && new Date(inv.dueDate) < new Date();
          const displayStatus = isOverdue ? "overdue" : inv.status;
          const situacao = situacaoDe(displayStatus);
          const plano = PLAN_LABELS[inv.planAtTime];
          const vencimento = new Date(inv.dueDate);
          const emAberto = inv.status === "pending" || displayStatus === "overdue";
          return (
            <tr
              key={inv.id}
              className="hover:bg-[var(--surface-2)] motion-safe:transition-colors"
              data-testid={`invoice-row-${inv.id}`}
            >
              <Td num alinhamento="esquerda" className="text-[12px] font-medium text-[var(--text)]">
                {/* O numero da fatura e dado, nao acao: fica na tinta do
                    corpo. Antes vinha na cor da marca (e em azul no escuro),
                    e a cor de acao num identificador que nao clica promete um
                    link que nao existe. */}
                {inv.invoiceNumber}
              </Td>
              <Td className="text-[13px] font-medium text-[var(--text)]">{inv.providerName}</Td>
              <Td num alinhamento="esquerda" className="text-[12px] text-[var(--text-muted)]">
                {inv.period}
              </Td>
              <Td>
                <Selo tom={plano?.tom ?? "neutro"}>{plano?.label ?? inv.planAtTime}</Selo>
              </Td>
              <Td num className="text-[13px] font-medium text-[var(--text)]">
                {/* O "R$" escrito a mao ao lado de um `toLocaleString` saiu: era
                    um dos quatro formatadores de real do produto, e um dos dois
                    que separavam simbolo e numero com espaco COMUM onde o Intl
                    usa o inquebravel — ou seja, o mesmo valor podia quebrar
                    linha aqui e nao quebrar na tela ao lado. `Dinheiro` e a
                    peca unica, e ela ja traz o mono tabular da secao 2. */}
                <Dinheiro valor={inv.paidAmount || inv.amount} />
              </Td>
              <Td>
                <time
                  dateTime={vencimento.toISOString()}
                  className={`${TABELA_NUM} text-[12px] text-[var(--text-muted)]`}
                >
                  {vencimento.toLocaleDateString("pt-BR")}
                </time>
              </Td>
              <Td alinhamento="centro">
                <div className="flex flex-col items-center gap-1">
                  <Selo tom={situacao.tom}>{situacao.rotulo}</Selo>
                  {inv.asaasChargeId && (
                    /* Marca de PROVENIENCIA: esta fatura tem cobranca no
                       gateway. Nao e situacao nem risco, entao nao ganha cor
                       propria — vive na tinta mais fraca, abaixo do selo que
                       de fato diz se foi paga. */
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]">
                      <Wallet className="w-2.5 h-2.5 flex-none" strokeWidth={2} aria-hidden />
                      Asaas
                    </span>
                  )}
                </div>
              </Td>
              <Td>
                <div className="flex items-center justify-center gap-0.5">
                  <BotaoIcone
                    Icone={Eye}
                    rotulo="Ver fatura"
                    onClick={() => navigate(`/admin/fatura/${inv.id}`)}
                    testId={`button-view-invoice-${inv.id}`}
                  />
                  {emAberto && !inv.asaasChargeId && asaasConfigured && (
                    <BotaoIcone
                      Icone={Wallet}
                      rotulo="Cobrar via Asaas"
                      onClick={() => onOpenAsaasCharge({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber })}
                      testId={`button-asaas-charge-${inv.id}`}
                    />
                  )}
                  {inv.asaasChargeId && (
                    <BotaoIcone
                      Icone={syncChargePending ? RefreshCw : RotateCcw}
                      girando={syncChargePending}
                      rotulo="Sincronizar situação com o Asaas"
                      onClick={() => onSyncCharge(inv.id)}
                      disabled={syncChargePending}
                      testId={`button-asaas-sync-${inv.id}`}
                    />
                  )}
                  {inv.asaasChargeId && inv.asaasBillingType === "PIX" && inv.status !== "paid" && (
                    <BotaoIcone
                      Icone={QrCode}
                      rotulo="QR Code PIX"
                      onClick={() => onOpenPix(inv.id)}
                      disabled={pixPending}
                      testId={`button-asaas-pix-${inv.id}`}
                    />
                  )}
                  {inv.asaasInvoiceUrl && (
                    /* Ancora de verdade (abre outro site), entao continua <a> e
                       nao vira `BotaoIcone`, que e um <button>. Veste a mesma
                       constante da primitiva para ter alvo de toque, hover e
                       anel de foco identicos aos botoes ao lado. */
                    <a
                      href={inv.asaasInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={BOTAO_ICONE}
                      title="Link de pagamento Asaas"
                      aria-label="Link de pagamento Asaas"
                      data-testid={`link-asaas-payment-${inv.id}`}
                    >
                      <ExternalLink className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                    </a>
                  )}
                  {emAberto && (
                    <BotaoIcone
                      Icone={CheckCircle}
                      rotulo="Marcar como paga manualmente"
                      onClick={() => onMarkPaid(inv.id, inv.amount)}
                      testId={`button-mark-paid-${inv.id}`}
                    />
                  )}
                  {emAberto && (
                    <BotaoIcone
                      Icone={Ban}
                      tom="risco"
                      rotulo="Cancelar fatura"
                      onClick={() => { if (confirm("Cancelar esta fatura?")) onCancel(inv.id); }}
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
  );
}
