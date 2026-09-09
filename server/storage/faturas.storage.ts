import type { CarteiraDeCobranca } from "@shared/schema";
/**
 * As faturas do ERP, fatura a fatura, e o resumo do MES de vencimento.
 *
 * Ate a fase 2 da cobranca (05/09/2026) o sync gravava so o agregado por
 * cliente — quanto deve, ha quantos dias — e `invoices` recebia linha apenas
 * do import CSV. A pergunta "como fechou o mes de setembro?" exige a fatura
 * com o vencimento dela: quanto foi faturado, quanto esta vencido, quanto
 * ainda vence, quanto sumiu dos pendentes (pagamento provavel) e quem ficou
 * SEM fatura — o buraco de faturamento que ninguem ve no agregado.
 *
 * A semantica e a do Provedor.ai (packages/scoring/src/cockpit/safra.ts):
 * universo = faturas que VENCEM no mes [de, ate). Sobre ele:
 *   inadimplente   = abertas com vencimento antes de hoje
 *   aVencer        = abertas com vencimento hoje ou depois
 *   recebido       = explicitamente pagas COM data, incluindo quitações
 *                    com recibo conferido; sem evidência não se afirma pagamento
 *   emConciliacao  = sumiram dos pendentes numa varredura completa
 *                    (`baixada_no_erp`) — pagamento provavel, sem prova
 *   faturado       = tudo do universo
 *
 * Regra do dono (memoria "integridade do dado"): so dado real e verificavel,
 * nunca zero enganoso. Sem fatura vinda do ERP o resumo diz `base: false`, e
 * a tela mostra "—", nao "R$ 0".
 *
 * Tres decisoes valem para a classe inteira:
 *
 * 1. TODA consulta filtra por `provider_id`, na tabela alvo e em cada
 *    subconsulta. Ha teste que le o SQL e confere.
 * 2. A BAIXA E PROVA NEGATIVA, e prova negativa exige leitura completa. Quem
 *    decide se a varredura foi completa e o sync; aqui so ha uma trava de
 *    fundo: sem nenhuma referencia vista nao se baixa nada.
 * 3. DATA E DIA DE CALENDARIO. `due_date` e timestamp sem fuso e o Drizzle o
 *    grava como ISO UTC; toda fatura entra como meia-noite UTC do dia do
 *    vencimento e toda comparacao usa a mesma forma, para que "vence em
 *    setembro" nao escorregue tres horas para agosto.
 */
import { and, desc, eq, gte, inArray, isNotNull, lt, max, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { cobrancaEventos, cobrancaNegociacoes, cobrancaParcelas, customers, invoices, users } from "@shared/schema";
import type { FaturaAbertaDoErp, FaturaPagaDoErp } from "../erp/types";
import { STATUS_DE_CLIENTE_ATUAL, clienteDaCarteira, comDivida } from "./cobranca.storage";
import type { DevedorDaCarteira } from "@shared/cobranca/prejuizo";
import { cobrancaQuitacoes } from "@shared/schema-cobranca-faturas";
import { resumirHistoricoDePagamentos, type HistoricoDePagamentos } from "@shared/cobranca/historico-pagamentos";
import { z } from "zod";

const QuitacaoConfirmadaSchema = z.object({
  faturaId: z.number().int().positive(),
  origem: z.enum(["erp_confirmado", "comprovante_conferido"]),
  referencia: z.string().trim().min(3).max(200),
  pagoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => {
    const data = new Date(`${d}T00:00:00Z`);
    return Number.isFinite(data.getTime()) && data.toISOString().slice(0, 10) === d;
  }, "Data de recebimento inválida"),
  valorPago: z.number().finite().positive().max(9999999999.99),
  userId: z.number().int().positive().optional(),
}).refine(d => d.origem !== "comprovante_conferido" || !!d.userId, "A conferência exige o operador responsável");
export type QuitacaoConfirmada = z.infer<typeof QuitacaoConfirmadaSchema>;

/** Pendente no ERP (ou, nas linhas legadas do CSV, pending/overdue). */
export const STATUS_FATURA_ABERTA = ["aberta", "pending", "overdue"] as const;
/** Paga explicitamente; histórico/recebido também exigem data de pagamento. */
export const STATUS_FATURA_PAGA = ["paid"] as const;
/** Sumiu dos pendentes do ERP numa varredura completa: pagamento provavel. */
export const STATUS_FATURA_CONCILIACAO = ["baixada_no_erp"] as const;
const UNIVERSO_DO_MES = [...STATUS_FATURA_ABERTA, ...STATUS_FATURA_PAGA, ...STATUS_FATURA_CONCILIACAO];
/**
 * O que PROVA que um valor de fatura e mensalidade de verdade: a fatura paga
 * que o ERP confirmou (0036) ou a que sumiu dos pendentes numa varredura
 * completa (baixa provavel). Sem uma delas, N faturas iguais em aberto podem
 * ser N parcelas de um saldo — e o ex-cliente nao ganha ARPU por isso.
 */
const PROVA_DE_PAGAMENTO = [...STATUS_FATURA_PAGA, ...STATUS_FATURA_CONCILIACAO];

export type GrupoDoMes = "pago" | "inadimplente" | "a_vencer" | "sem_fatura";

export interface ResumoDoMes {
  mes: string;
  /** O provedor tem alguma fatura vinda do ERP. Sem isso, os numeros nao existem. */
  base: boolean;
  faturado: number;
  recebido: number;
  /** true quando o valor recebido tem registros explicitamente pagos e datados. */
  recebidoConfirmado: boolean;
  emConciliacao: number;
  inadimplente: number;
  numInadimplentes: number;
  aVencer: number;
  numAVencer: number;
  /** Clientes atuais (contrato ativo/suspenso) sem NENHUMA fatura vencendo no mes. */
  semFatura: number;
  clientes: { emDia: number; inadimplentes: number };
  /** Ultima varredura que tocou uma fatura do ERP deste provedor. */
  atualizadoEm: Date | null;
}

/** Quem conduziu o contato que antecedeu a baixa — ver `recuperacaoAposContato`. */
export const ORIGENS_DE_CONTATO = ["assistente", "operador", "indefinido"] as const;
export type OrigemDeContato = (typeof ORIGENS_DE_CONTATO)[number];

/** Uma quebra do recuperado: por origem do contato ou por canal. */
export interface RecorteDaRecuperacao {
  chave: string;
  valor: number;
  faturas: number;
  clientes: number;
}

export interface RecuperacaoAposContato {
  /** Ha do que falar: fatura vinda do ERP E alguma baixa de varredura completa. */
  base: boolean;
  /** Por que nao ha base. `null` quando ha. */
  motivo: string | null;
  /** Periodo medido, em dias, terminando em `ate`. */
  dias: number;
  /** Quantos dias antes da baixa um contato ainda conta como o que a antecedeu. */
  janelaDias: number;
  desde: Date;
  ate: Date;
  /** `null` quando `base` e false — a tela mostra "—", nunca R$ 0,00. */
  valor: number | null;
  faturas: number | null;
  clientes: number | null;
  porOrigem: RecorteDaRecuperacao[];
  porCanal: RecorteDaRecuperacao[];
}

const LOTE_DE_UPSERT = 500;
const LIMITE_PADRAO = 20_000;
/** O painel abre UM caso: 200 faturas ja e mais historico do que se le numa sentada. */
const TETO_DE_FATURAS_DO_CLIENTE = 200;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Uma fatura do cliente como o painel do caso a mostra — nada alem disso. */
export interface FaturaDoCliente {
  id: number;
  /** `null` = veio do import CSV; "mk"/"ixc"/"sgp" = gravada pela varredura. */
  erpSource: string | null;
  /** O id da fatura no ERP. E a chave que a segunda via do chat pede. */
  erpRef: string | null;
  vencimento: Date;
  valor: number;
  descricao: string | null;
  /** aberta | baixada_no_erp | pending | overdue | paid — ver o cabecalho. */
  status: string;
  baixadaEm: Date | null;
}

/**
 * A MENSALIDADE que o ERP cobra deste cliente, LIDA das faturas dele.
 *
 * Por que existe (06/09/2026). A Economia do cliente (R24) no 360 mostrava
 * tudo "—" para toda a base, e o motivo era um so: sem ARPU nao ha calculo. O
 * ARPU vinha de UM caminho — o nome do plano casado com um preco que o admin
 * digitasse em Politica > Economia — e esse caminho esta cortado dos dois
 * lados: `customers` nao guarda o plano (o `contractPlan` do conector e
 * descartado no upsert) e o mapa de precos nasce vazio.
 *
 * Mas o valor esta no banco desde a migracao 0027: as faturas do ERP, fatura a
 * fatura, com o valor que o provedor REALMENTE cobra deste assinante. E o
 * mesmo recurso que o Provedor.ai usa quando o ERP nao expoe o preco do plano
 * (`sync/faturas.ts`, semeadura por MODA do valor faturado).
 *
 * A regra e a MODA — o valor que mais se repete —, e nao a media nem a maior:
 * a media sobe com multa, juros e servico avulso; a maior pega o acordo
 * inteiro numa fatura so. O valor que se repete mes a mes e a mensalidade.
 * Empate na contagem: vence o mais recente.
 *
 * Nada disso e chute, e por isso a leitura devolve a EVIDENCIA junto
 * (quantas faturas foram olhadas, quantas concordam): a tela mostra de onde o
 * numero saiu, e o preco cadastrado pelo admin sempre vence este aqui.
 */
export interface MensalidadeDoCliente {
  /** O valor que mais se repete nas faturas do ERP. */
  valor: number;
  /** Quantas faturas trazem esse mesmo valor. */
  concordam: number;
  /** Quantas faturas do ERP foram olhadas. */
  faturas: number;
  /** O vencimento mais recente entre as que concordam — a idade da evidencia. */
  maisRecente: Date | null;
  /**
   * Quantas faturas DO VALOR DA MODA ja foram vistas abertas e depois sumiram
   * dos pendentes (`baixada_no_erp`). E a evidencia de que ESTE valor foi PAGO
   * repetidas vezes — o que separa mensalidade de saldo para ex-cliente.
   * Contar baixadas de qualquer valor deixaria um saldo parcelado em duas
   * faturas iguais passar como mensalidade por causa de uma mensalidade antiga
   * baixada.
   */
  baixadas: number;
}

/**
 * Quantos clientes do provedor tem mensalidade legivel — o sinal de prontidao
 * da Economia, mostrado na propria tela onde ela se configura.
 *
 * Sem isto o provedor configura no escuro: preenche os custos e so descobre
 * se funcionou abrindo cliente por cliente no 360.
 */
export interface CoberturaDaMensalidade {
  /** Clientes com contrato vivo (ativo ou suspenso). */
  ativos: number;
  /** Destes, quantos tem ao menos uma fatura vinda da varredura do ERP. */
  comMensalidade: number;
  /** Destes, quantos tambem tem data de contrato — o outro insumo do calculo. */
  comDataDeContrato: number;
}

export interface FaturasDoCliente {
  linhas: FaturaDoCliente[];
  /** Quantas existem, mesmo que `linhas` tenha parado no teto. */
  total: number;
  limite: number;
  /** Quantas vieram da varredura do ERP. Zero com `total > 0` = so import CSV. */
  doErp: number;
  /** Abertas e ja vencidas: quantas, quanto somam, e o vencimento mais antigo. */
  vencidas: number;
  valorVencido: number;
  /**
   * A data em que a fatura mais antiga venceu, LIDA das faturas. `null`
   * quando nao ha nenhuma fatura vencida gravada — e ai a tela mostra "—".
   * Derivar "hoje menos os dias de atraso" seria inventar um vencimento que
   * ninguem gravou (regra do dono: integridade do dado).
   */
  vencimentoMaisAntigo: Date | null;
  /**
   * A fatura vencida mais RECENTE — a ultima que o ERP emitiu antes de o
   * cliente sair. E o fim do ciclo do ex-cliente na Economia quando
   * `cortado_em` nao veio (o MK nunca o preenche).
   */
  vencimentoMaisRecente: Date | null;
}

/**
 * AAAA-MM-DD como o timestamp que o Drizzle grava: meia-noite UTC. Quem le
 * `due_date` de volta recebe o mesmo instante, entao o dia nunca muda de mao.
 */
export function diaComoTimestamp(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

/** O dia de calendario de `hoje` (relogio local do servidor), na mesma forma. */
export function diaDeHoje(hoje: Date): string {
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  const dd = String(hoje.getDate()).padStart(2, "0");
  return `${hoje.getFullYear()}-${mm}-${dd}`;
}

/** [de, ate) do mes "AAAA-MM". Recusa o que nao e mes. */
export function janelaDoMes(mes: string): { de: string; ate: string } {
  const m = mes.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Mes invalido: ${mes} (esperado AAAA-MM)`);
  const ano = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) throw new Error(`Mes invalido: ${mes}`);
  const proximo = mm === 12 ? `${ano + 1}-01` : `${ano}-${String(mm + 1).padStart(2, "0")}`;
  return { de: `${mes}-01`, ate: `${proximo}-01` };
}

/** Um dia AAAA-MM-DD como parametro de comparacao com `due_date`. */
const ts = (dia: string): SQL => sql`${dia}::timestamp`;

/**
 * Fatura ABERTA e ja vencida no dia `corte` (AAAA-MM-DD) — a regua da casa,
 * escrita uma vez: fatura que vence hoje ainda nao venceu. E o predicado do
 * `vencimentoMaisAntigo` do 360 e do eixo "devem desde" do card de prejuizo;
 * os dois tem de concordar sobre a mesma fatura.
 */
export const faturaVencidaAte = (corte: string): SQL =>
  and(inArray(invoices.status, [...STATUS_FATURA_ABERTA]), lt(invoices.dueDate, ts(corte)))!;

export class FaturasStorage {
  async clienteExiste(providerId: number, customerId: number, carteira?: CarteiraDeCobranca): Promise<boolean> {
    const [r] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.providerId, providerId), eq(customers.id, customerId), clienteDaCarteira(carteira))).limit(1);
    return !!r;
  }

  async clienteDaFatura(providerId: number, faturaId: number): Promise<number | null> {
    const [r] = await db.select({ customerId: invoices.customerId }).from(invoices).where(and(eq(invoices.providerId, providerId), eq(invoices.id, faturaId))).limit(1);
    return r?.customerId ?? null;
  }

  async listarQuitacoesDoCliente(providerId: number, customerId: number) {
    return db.select({ faturaId: cobrancaQuitacoes.faturaId, valorPago: cobrancaQuitacoes.valorPago,
      pagoEm: cobrancaQuitacoes.pagoEm, origem: cobrancaQuitacoes.origem, referencia: cobrancaQuitacoes.referencia,
      divergenciaErpEm: cobrancaQuitacoes.divergenciaErpEm }).from(cobrancaQuitacoes)
      .where(and(eq(cobrancaQuitacoes.providerId, providerId), eq(cobrancaQuitacoes.customerId, customerId)))
      .orderBy(desc(cobrancaQuitacoes.pagoEm)).limit(200);
  }

  /** Divergência positiva: o ERP ao vivo ainda oferece título com recibo local. */
  async faturasQuitadasAindaAbertas(providerId: number, customerId: number, refs: readonly string[], erpSource?: string): Promise<boolean> {
    const referencias = [...new Set(refs.map(r => r.trim()).filter(Boolean))];
    if (!referencias.length) return false;
    const [r] = await db.select({ id: invoices.id }).from(invoices)
      .innerJoin(cobrancaQuitacoes, and(eq(cobrancaQuitacoes.faturaId, invoices.id), eq(cobrancaQuitacoes.providerId, providerId), eq(cobrancaQuitacoes.customerId, customerId)))
      .where(and(eq(invoices.providerId, providerId), eq(invoices.customerId, customerId), inArray(invoices.erpRef, referencias),
        erpSource ? eq(invoices.erpSource, erpSource) : undefined)).limit(1);
    return !!r;
  }
  /** Leitura em lote para o job: uma consulta por provedor, sem N+1 por caso. */
  async historicosDePagamentosDoProvedor(providerId: number, customerId?: number | readonly number[]): Promise<Map<number, HistoricoDePagamentos>> {
    // Recorte por ids (os devedores do card): lista vazia e recorte vazio.
    if (Array.isArray(customerId) && customerId.length === 0) return new Map();
    const linhas = await db.select({
      customerId: invoices.customerId,
      pagas: sql<number>`count(*)`.mapWith(Number),
      atrasadas: sql<number>`count(*) filter (where ${invoices.paidDate}::date > ${invoices.dueDate}::date)`.mapWith(Number),
      // O valor pago que o ERP registrou; sem ele (quitacao conferida a mao), o da fatura.
      recebido: sql<number>`coalesce(sum(coalesce(${invoices.paidValue}, ${invoices.value})), 0)`.mapWith(Number),
      ultima: max(invoices.paidDate),
    }).from(invoices).where(and(
      eq(invoices.providerId, providerId), eq(invoices.status, "paid"), isNotNull(invoices.paidDate),
      customerId === undefined ? undefined
        : Array.isArray(customerId) ? inArray(invoices.customerId, [...customerId])
        : eq(invoices.customerId, customerId as number),
    )).groupBy(invoices.customerId);
    return new Map(linhas.map(l => [l.customerId, {
      historicoInsuficiente: false, faturasPagas: l.pagas, faturasPagasComAtraso: l.atrasadas,
      recebido: Math.round(Number(l.recebido) * 100) / 100,
      taxaAtraso: l.atrasadas / l.pagas, ultimaConfirmacaoEm: l.ultima ? new Date(l.ultima) : null,
      fonte: "pagamentos_com_data" as const,
    }]));
  }

  /**
   * AS FATURAS PAGAS que o ERP confirma — status `paid`, com a data e o valor
   * pago que ELE registrou. E prova POSITIVA: vence `aberta` e
   * `baixada_no_erp` na mesma referencia (a baixa era "sumiu dos pendentes";
   * isto e o ERP dizendo que recebeu).
   *
   * O cliente e casado pelo id no ERP (customers.erp_customer_id, 0036) ou pelo
   * documento — o que o conector tiver. Fatura de quem nao esta na base conta
   * em `semCliente` e nao e gravada: sem cliente nao ha carteira.
   */
  async upsertFaturasPagasDoErp(
    providerId: number,
    erpSource: string,
    faturas: FaturaPagaDoErp[],
  ): Promise<{ gravadas: number; semCliente: number }> {
    const validas = faturas.filter(f =>
      f && String(f.ref ?? "").trim() && DIA.test(f.vencimento ?? "") && DIA.test(f.pagoEm ?? "")
      && Number.isFinite(f.valor) && Number.isFinite(f.valorPago));
    if (validas.length === 0) return { gravadas: 0, semCliente: faturas.length };

    const ids = Array.from(new Set(validas.map(f => String(f.erpCustomerId ?? "").trim()).filter(Boolean)));
    const docs = Array.from(new Set(validas.map(f => String(f.cpfCnpj ?? "").replace(/\D/g, "")).filter(Boolean)));
    const porId = new Map<string, number>();
    const porDoc = new Map<string, number>();
    if (ids.length > 0) {
      const linhas = await db.select({ id: customers.id, erpId: customers.erpCustomerId }).from(customers)
        .where(and(eq(customers.providerId, providerId), eq(customers.erpSource, erpSource), inArray(customers.erpCustomerId, ids)));
      for (const l of linhas) if (l.erpId) porId.set(l.erpId, l.id);
    }
    if (docs.length > 0) {
      const linhas = await db.select({ id: customers.id, doc: customers.cpfCnpj }).from(customers)
        .where(and(eq(customers.providerId, providerId), inArray(customers.cpfCnpj, docs)));
      for (const l of linhas) porDoc.set(l.doc.replace(/\D/g, ""), l.id);
    }

    const agora = new Date();
    let gravadas = 0;
    let semCliente = faturas.length - validas.length;
    const porRef = new Map<string, FaturaPagaDoErp & { customerId: number }>();
    for (const f of validas) {
      const customerId = (f.erpCustomerId && porId.get(String(f.erpCustomerId).trim()))
        ?? (f.cpfCnpj && porDoc.get(String(f.cpfCnpj).replace(/\D/g, "")));
      if (!customerId) { semCliente++; continue; }
      porRef.set(String(f.ref).trim(), { ...f, ref: String(f.ref).trim(), customerId });
    }
    const linhas = Array.from(porRef.values());
    for (let i = 0; i < linhas.length; i += LOTE_DE_UPSERT) {
      const lote = linhas.slice(i, i + LOTE_DE_UPSERT);
      await db.insert(invoices)
        .values(lote.map(f => ({
          providerId,
          customerId: f.customerId,
          contractId: null,
          erpSource,
          erpRef: f.ref,
          value: f.valor.toFixed(2),
          dueDate: diaComoTimestamp(f.vencimento),
          paidDate: diaComoTimestamp(f.pagoEm),
          paidValue: f.valorPago.toFixed(2),
          descricao: f.descricao ?? null,
          status: "paid",
          baixadaEm: null,
          updatedAt: agora,
        })))
        .onConflictDoUpdate({
          target: [invoices.providerId, invoices.erpSource, invoices.erpRef],
          targetWhere: sql`erp_ref IS NOT NULL`,
          set: {
            customerId: sql`excluded.customer_id`,
            value: sql`excluded.value`,
            dueDate: sql`excluded.due_date`,
            paidDate: sql`excluded.paid_date`,
            paidValue: sql`excluded.paid_value`,
            descricao: sql`excluded.descricao`,
            status: "paid",
            updatedAt: agora,
          },
        });
      gravadas += lote.length;
    }
    return { gravadas, semCliente };
  }

  /**
   * O dia do ultimo pagamento que o ERP confirmou para este provedor/fonte —
   * de onde a proxima leitura incremental parte. `null` = nunca leu: a
   * proxima leitura e a historia inteira.
   */
  async ultimoPagamentoLido(providerId: number, erpSource: string): Promise<string | null> {
    const [r] = await db.select({ dia: sql<string | null>`to_char(max(${invoices.paidDate}), 'YYYY-MM-DD')` })
      .from(invoices)
      .where(and(eq(invoices.providerId, providerId), eq(invoices.erpSource, erpSource), eq(invoices.status, "paid"), isNotNull(invoices.paidValue)));
    return r?.dia ?? null;
  }

  async historicoDePagamentosDoCliente(providerId: number, customerId: number): Promise<HistoricoDePagamentos> {
    return (await this.historicosDePagamentosDoProvedor(providerId, customerId)).get(customerId) ?? resumirHistoricoDePagamentos([]);
  }

  /**
   * Registra prova positiva de quitação integral. O chamador do ERP precisa de
   * resposta explícita de liquidação; ausência nas abertas nunca chama isto.
   * O operador informa referência do comprovante que conferiu. A fatura e a
   * prova são gravadas juntas, sob lock, tornando replay idempotente.
   */
  async registrarQuitacaoConfirmada(providerId: number, customerId: number, entrada: QuitacaoConfirmada,
    contexto?: { suporteProviderId: number }): Promise<{ faturaId: number; repetida: boolean }> {
    const d = QuitacaoConfirmadaSchema.parse(entrada);
    if (d.pagoEm > diaDeHoje(new Date())) throw new Error("Recebimento não pode ter data futura");
    return db.transaction(async tx => {
      // A mesma ordem é usada no aceite/criação do acordo; as duas vias de
      // recebimento não podem passar na checagem antes uma da outra gravar.
      const [cliente] = await tx.select({ id: customers.id }).from(customers)
        .where(and(eq(customers.providerId, providerId), eq(customers.id, customerId))).for("update");
      if (!cliente) throw new Error("Fatura não encontrada neste cliente e provedor");
      if (d.userId) {
        const suporteAutorizado = contexto?.suporteProviderId === providerId;
        const [operador] = await tx.select({ id: users.id, role: users.role, providerId: users.providerId }).from(users)
          .where(and(eq(users.id, d.userId), or(eq(users.providerId, providerId), suporteAutorizado ? eq(users.role, "superadmin") : undefined))).for("share");
        if (!operador || !(operador.role === "admin" && operador.providerId === providerId) && !(operador.role === "superadmin" && suporteAutorizado)) {
          throw new Error("A confirmação exige administrador atual do provedor ou suporte autorizado");
        }
      }
      const [fatura] = await tx.select({ id: invoices.id, valor: invoices.value, status: invoices.status, erpSource: invoices.erpSource })
        .from(invoices).where(and(eq(invoices.providerId, providerId), eq(invoices.customerId, customerId), eq(invoices.id, d.faturaId))).for("update");
      if (!fatura) throw new Error("Fatura não encontrada neste cliente e provedor");
      if (Math.round(d.valorPago * 100) < Math.round(Number(fatura.valor) * 100)) throw new Error("A quitação exige o valor integral; registre pagamentos parciais no acordo");
      if (d.origem === "erp_confirmado" && !fatura.erpSource) throw new Error("Fatura sem origem ERP para confirmação integrada");
      const [prova] = await tx.select().from(cobrancaQuitacoes)
        .where(and(eq(cobrancaQuitacoes.providerId, providerId), eq(cobrancaQuitacoes.faturaId, d.faturaId)));
      if (prova) {
        if (prova.origem !== d.origem || prova.referencia !== d.referencia || prova.pagoEm !== d.pagoEm || Math.round(Number(prova.valorPago) * 100) !== Math.round(d.valorPago * 100)) {
          throw new Error("Esta fatura já tem outra confirmação de recebimento");
        }
        return { faturaId: d.faturaId, repetida: true };
      }
      if (fatura.status === "paid") throw new Error("Esta fatura já está paga; confira o registro existente");
      if (![...STATUS_FATURA_ABERTA, ...STATUS_FATURA_CONCILIACAO].includes(fatura.status as typeof STATUS_FATURA_ABERTA[number] | typeof STATUS_FATURA_CONCILIACAO[number])) {
        throw new Error("Esta fatura não permite confirmação de recebimento");
      }
      const [acordo] = await tx.select({ id: cobrancaNegociacoes.id }).from(cobrancaNegociacoes)
        .where(and(eq(cobrancaNegociacoes.providerId, providerId), eq(cobrancaNegociacoes.customerId, customerId), inArray(cobrancaNegociacoes.status, ["aceita", "ativa", "cumprida"]))).limit(1);
      if (acordo) throw new Error("Cliente com acordo: confirme o recebimento pelas parcelas ou concilie a origem para evitar duplicidade");
      const [parcelaRecebida] = await tx.select({ id: cobrancaParcelas.id }).from(cobrancaParcelas)
        .innerJoin(cobrancaNegociacoes, and(eq(cobrancaNegociacoes.id, cobrancaParcelas.negociacaoId), eq(cobrancaNegociacoes.providerId, providerId)))
        .where(and(eq(cobrancaParcelas.providerId, providerId), eq(cobrancaNegociacoes.customerId, customerId), sql`coalesce(${cobrancaParcelas.valorPago}, 0) > 0`)).limit(1);
      if (parcelaRecebida) throw new Error("Cliente tem recebimento em acordo; concilie a origem antes de confirmar a mesma dívida novamente");
      await tx.insert(cobrancaQuitacoes).values({ providerId, customerId, ...d, valorPago: d.valorPago.toFixed(2) });
      await tx.update(invoices).set({ status: "paid", paidDate: diaComoTimestamp(d.pagoEm), updatedAt: new Date() })
        .where(and(eq(invoices.providerId, providerId), eq(invoices.customerId, customerId), eq(invoices.id, d.faturaId)));
      return { faturaId: d.faturaId, repetida: false };
    }).catch((erro: unknown) => {
      type ErroPg = { code?: unknown; constraint?: unknown; cause?: unknown };
      const pg = erro as ErroPg | null;
      const causas = [pg, pg?.cause as ErroPg | null | undefined];
      if (causas.some(e => e?.code === "23505" && e.constraint === "cobranca_quitacoes_referencia_uq")) {
        throw new Error("Esta referência de recebimento já foi usada");
      }
      throw erro;
    });
  }
  /**
   * Grava (ou regrava) as faturas ABERTAS de um cliente, vindas do ERP.
   *
   * Chave (provider_id, erp_source, erp_ref): a mesma fatura, na varredura
   * seguinte, atualiza valor, vencimento e descricao, volta a `aberta` e
   * limpa `baixada_em` — uma fatura que reapareceu nos pendentes nao esta
   * mais baixada, por mais que tenhamos achado que estava.
   *
   * O que nao serve nao entra: referencia vazia, vencimento fora de
   * AAAA-MM-DD ou valor que nao e numero. Repetida no mesmo lote fica a
   * ultima — o Postgres recusa tocar a mesma linha duas vezes num INSERT.
   *
   * Devolve quantas foram gravadas.
   */
  async upsertFaturasDoErp(
    providerId: number,
    erpSource: string,
    customerId: number,
    faturas: FaturaAbertaDoErp[],
  ): Promise<number> {
    const porRef = new Map<string, FaturaAbertaDoErp>();
    for (const f of faturas) {
      const ref = String(f?.ref ?? "").trim();
      if (!ref || !DIA.test(f.vencimento ?? "") || !Number.isFinite(f.valor)) continue;
      porRef.set(ref, { ...f, ref });
    }
    const validas = Array.from(porRef.values());
    if (validas.length === 0) return 0;

    const agora = new Date();
    for (let i = 0; i < validas.length; i += LOTE_DE_UPSERT) {
      const lote = validas.slice(i, i + LOTE_DE_UPSERT);
      await db.insert(invoices)
        .values(lote.map(f => ({
          providerId,
          customerId,
          contractId: null,
          erpSource,
          erpRef: f.ref,
          value: f.valor.toFixed(2),
          dueDate: diaComoTimestamp(f.vencimento),
          descricao: f.descricao ?? null,
          status: "aberta",
          baixadaEm: null,
          updatedAt: agora,
        })))
        .onConflictDoUpdate({
          target: [invoices.providerId, invoices.erpSource, invoices.erpRef],
          // O predicado tem de ser o do indice parcial da 0027, palavra por
          // palavra, senao o Postgres nao o reconhece como alvo do conflito.
          targetWhere: sql`erp_ref IS NOT NULL`,
          // Lista de abertas pode estar defasada; jamais apaga recibo positivo.
          setWhere: ne(invoices.status, "paid"),
          set: {
            customerId: sql`excluded.customer_id`,
            value: sql`excluded.value`,
            dueDate: sql`excluded.due_date`,
            descricao: sql`excluded.descricao`,
            status: "aberta",
            baixadaEm: null,
            updatedAt: agora,
          },
        });
      // Abertas do ERP que contradizem prova positiva ficam para conciliação;
      // preservamos a quitação e deixamos a divergência visível no recibo.
      await db.update(cobrancaQuitacoes).set({ divergenciaErpEm: agora }).where(and(
        eq(cobrancaQuitacoes.providerId, providerId), eq(cobrancaQuitacoes.customerId, customerId),
        inArray(cobrancaQuitacoes.faturaId, db.select({ id: invoices.id }).from(invoices).where(and(
          eq(invoices.providerId, providerId), eq(invoices.customerId, customerId), eq(invoices.erpSource, erpSource),
          eq(invoices.status, "paid"), inArray(invoices.erpRef, lote.map(f => f.ref)),
        ))),
      ));
    }
    return validas.length;
  }

  /**
   * O mesmo upsert, para quem o conector so identifica pelo DOCUMENTO — o
   * cliente em dia, que nao passa pelo upsert de inadimplente e por isso nao
   * tem o id na mao do sync (`faturasDeClientesEmDia`).
   *
   * Resolve o cliente na base DESTE provedor. `null` = ele nao esta na base
   * (cadastro sem contrato, que a porteira barrou) — nada gravado, e nao e
   * erro.
   */
  async upsertFaturasDoErpPorDocumento(
    providerId: number,
    erpSource: string,
    cpfCnpj: string,
    faturas: FaturaAbertaDoErp[],
  ): Promise<number | null> {
    const doc = String(cpfCnpj ?? "").replace(/\D/g, "");
    if (!doc) return null;
    const [cliente] = await db.select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.providerId, providerId), eq(customers.cpfCnpj, doc)))
      .limit(1);
    if (!cliente) return null;
    return this.upsertFaturasDoErp(providerId, erpSource, cliente.id, faturas);
  }

  /**
   * Marca `baixada_no_erp` toda fatura `aberta` deste provedor/fonte cuja
   * referencia NAO apareceu nesta varredura.
   *
   * E prova negativa, e so vale depois de uma varredura COMPLETA — quem decide
   * isso e o sync (a mesma condicao de `baixarDividaQuitada`). Aqui ha duas
   * travas de fundo: sem nenhuma referencia vista nao se baixa nada (uma lista
   * vazia nao e "ninguem tem fatura", e leitura que nao serviu — foi assim que
   * a divida da O L I sumiu em 31/08/2026); e os clientes que o conector
   * declarou NAO LIDOS (`docsProtegidos`, por documento) ficam como estavam:
   * a fatura deles nao sumiu, so nao foi olhada.
   *
   * `baixada_em` e quando NOTAMOS, nao quando foi paga. Devolve quantas.
   */
  async baixarFaturasSumidas(
    providerId: number,
    erpSource: string,
    refsVistas: Set<string>,
    docsProtegidos: string[] = [],
  ): Promise<number> {
    const refs = Array.from(refsVistas).map(r => String(r).trim()).filter(Boolean);
    if (refs.length === 0) return 0;
    const docs = docsProtegidos.map(d => String(d ?? "").replace(/\D/g, "")).filter(Boolean);

    const condicoes: SQL[] = [
      eq(invoices.providerId, providerId),
      eq(invoices.erpSource, erpSource),
      eq(invoices.status, "aberta"),
      isNotNull(invoices.erpRef),
      // Um parametro so, como array: a O L I tem 42.883 faturas abertas, e
      // `NOT IN ($1, ..., $42883)` encosta no teto de parametros do protocolo.
      sql`not (${invoices.erpRef} = any(${sql.param(refs)}::text[]))`,
    ];
    if (docs.length > 0) {
      condicoes.push(sql`not exists (
        select 1 from ${customers}
        where ${customers.id} = ${invoices.customerId}
          and ${customers.providerId} = ${providerId}
          and ${customers.cpfCnpj} = any(${sql.param(docs)}::text[])
      )`);
    }

    const agora = new Date();
    const baixadas = await db.update(invoices)
      .set({ status: "baixada_no_erp", baixadaEm: agora, updatedAt: agora })
      .where(and(...condicoes))
      .returning({ id: invoices.id });
    return baixadas.length;
  }

  /**
   * O mes de vencimento, fechado com a regra do Provedor.ai — ver o cabecalho.
   *
   * `hoje` decide o que e vencido: fatura que vence HOJE ainda nao venceu
   * (mesma regua de `diasDesdeVencimento`, por dia de calendario). Tres
   * consultas, todas com provider_id: as faturas do mes, os clientes atuais
   * contra elas, e a existencia de base.
   */
  async resumoDoMes(providerId: number, mes: string, hoje: Date): Promise<ResumoDoMes> {
    const { de, ate } = janelaDoMes(mes);
    const corte = diaDeHoje(hoje);

    const aberta = inArray(invoices.status, [...STATUS_FATURA_ABERTA]);
    const vencida = and(aberta, lt(invoices.dueDate, ts(corte)))!;
    const aVencer = and(aberta, gte(invoices.dueDate, ts(corte)))!;
    const soma = (cond: SQL) => sql<number>`coalesce(sum(${invoices.value}) filter (where ${cond}), 0)`.mapWith(Number);
    const conta = (cond: SQL) => sql<number>`count(*) filter (where ${cond})`.mapWith(Number);

    const [f] = await db.select({
      faturado: sql<number>`coalesce(sum(${invoices.value}), 0)`.mapWith(Number),
      recebido: soma(and(inArray(invoices.status, [...STATUS_FATURA_PAGA]), isNotNull(invoices.paidDate))!),
      emConciliacao: soma(inArray(invoices.status, [...STATUS_FATURA_CONCILIACAO])),
      inadimplente: soma(vencida),
      numInadimplentes: conta(vencida),
      aVencer: soma(aVencer),
      numAVencer: conta(aVencer),
    })
      .from(invoices)
      .where(and(
        eq(invoices.providerId, providerId),
        gte(invoices.dueDate, ts(de)),
        lt(invoices.dueDate, ts(ate)),
        inArray(invoices.status, UNIVERSO_DO_MES),
      ));

    // Cliente ATUAL contra as faturas dele no mes. Tres grupos que se somam
    // ao total de clientes atuais: sem fatura, inadimplente (alguma aberta
    // vencida no mes) e em dia (tem fatura no mes e nenhuma vencida).
    const doClienteNoMes = sql`select 1 from ${invoices}
      where ${invoices.providerId} = ${providerId}
        and ${invoices.customerId} = ${customers.id}
        and ${invoices.dueDate} >= ${ts(de)} and ${invoices.dueDate} < ${ts(ate)}`;
    const temFaturaNoMes = sql`exists (${doClienteNoMes} and ${invoices.status} in ${UNIVERSO_DO_MES})`;
    const deveNoMes = sql`exists (${doClienteNoMes} and ${aberta} and ${invoices.dueDate} < ${ts(corte)})`;

    const [c] = await db.select({
      semFatura: conta(sql`not ${temFaturaNoMes}`),
      inadimplentes: conta(deveNoMes),
      emDia: conta(sql`${temFaturaNoMes} and not ${deveNoMes}`),
    })
      .from(customers)
      .where(and(
        eq(customers.providerId, providerId),
        inArray(customers.status, [...STATUS_DE_CLIENTE_ATUAL]),
      ));

    const [b] = await db.select({
      total: sql<number>`count(*)`.mapWith(Number),
      atualizadoEm: max(invoices.updatedAt),
    })
      .from(invoices)
      .where(and(eq(invoices.providerId, providerId), isNotNull(invoices.erpSource)));

    return {
      mes,
      base: (b?.total ?? 0) > 0,
      faturado: f?.faturado ?? 0,
      recebido: f?.recebido ?? 0,
      recebidoConfirmado: (f?.recebido ?? 0) > 0,
      emConciliacao: f?.emConciliacao ?? 0,
      inadimplente: f?.inadimplente ?? 0,
      numInadimplentes: f?.numInadimplentes ?? 0,
      aVencer: f?.aVencer ?? 0,
      numAVencer: f?.numAVencer ?? 0,
      semFatura: c?.semFatura ?? 0,
      clientes: { emDia: c?.emDia ?? 0, inadimplentes: c?.inadimplentes ?? 0 },
      atualizadoEm: b?.atualizadoEm ?? null,
    };
  }

  /**
   * Os ids de `customers` de um grupo do mes — para a tela listar quem esta
   * atras de cada numero do resumo.
   *
   *   pago          fatura do mes paga ou baixada no ERP
   *   inadimplente  fatura do mes aberta e vencida
   *   a_vencer      fatura do mes aberta, vencendo hoje ou depois
   *   sem_fatura    cliente ATUAL sem nenhuma fatura no mes
   *
   * Um cliente pode estar em mais de um grupo (pagou uma, deve outra): sao
   * listas, nao uma particao. Limite para a resposta nao virar a carteira
   * inteira num JSON.
   */
  async clientesDoMes(
    providerId: number,
    mes: string,
    grupo: GrupoDoMes,
    opcoes: { hoje?: Date; limite?: number } = {},
  ): Promise<number[]> {
    const { de, ate } = janelaDoMes(mes);
    const corte = diaDeHoje(opcoes.hoje ?? new Date());
    const limite = Math.max(1, Math.min(opcoes.limite ?? LIMITE_PADRAO, LIMITE_PADRAO));

    if (grupo === "sem_fatura") {
      const linhas = await db.select({ id: customers.id })
        .from(customers)
        .where(and(
          eq(customers.providerId, providerId),
          inArray(customers.status, [...STATUS_DE_CLIENTE_ATUAL]),
          sql`not exists (select 1 from ${invoices}
            where ${invoices.providerId} = ${providerId}
              and ${invoices.customerId} = ${customers.id}
              and ${invoices.dueDate} >= ${ts(de)} and ${invoices.dueDate} < ${ts(ate)}
              and ${invoices.status} in ${UNIVERSO_DO_MES})`,
        ))
        .limit(limite);
      return linhas.map(l => l.id);
    }

    const aberta = inArray(invoices.status, [...STATUS_FATURA_ABERTA]);
    const doGrupo: SQL = grupo === "pago"
      ? inArray(invoices.status, [...STATUS_FATURA_PAGA, ...STATUS_FATURA_CONCILIACAO])
      : grupo === "inadimplente"
        ? and(aberta, lt(invoices.dueDate, ts(corte)))!
        : and(aberta, gte(invoices.dueDate, ts(corte)))!;

    const linhas = await db.selectDistinct({ id: invoices.customerId })
      .from(invoices)
      .where(and(
        eq(invoices.providerId, providerId),
        gte(invoices.dueDate, ts(de)),
        lt(invoices.dueDate, ts(ate)),
        doGrupo,
      ))
      .limit(limite);
    return linhas.map(l => l.id);
  }

  /**
   * AS FATURAS DE UM CLIENTE, uma a uma — o que o painel do caso abre quando
   * o operador clica no card.
   *
   * Ate aqui a tela so tinha o AGREGADO do sync (quanto deve, ha quantos dias,
   * quantas faturas) e derivava o vencimento mais antigo de "hoje menos os
   * dias de atraso". Desde a 0027 as faturas estao gravadas: a data sai da
   * coluna, ou nao sai.
   *
   * Duas consultas, as duas com `provider_id` E `customer_id`:
   *   1. a pagina — mais recentes primeiro por vencimento, teto de 200;
   *   2. os agregados sobre a carteira INTEIRA do cliente — porque a fatura
   *      mais antiga e justamente a que o teto corta.
   *
   * `hoje` decide o que esta vencido, pela mesma regua do resumo do mes:
   * fatura que vence hoje ainda nao venceu.
   */
  async faturasDoCliente(
    providerId: number,
    customerId: number,
    opcoes: { limite?: number; hoje?: Date } = {},
  ): Promise<FaturasDoCliente> {
    const limite = Math.max(
      1,
      Math.min(Math.trunc(opcoes.limite ?? TETO_DE_FATURAS_DO_CLIENTE) || TETO_DE_FATURAS_DO_CLIENTE, TETO_DE_FATURAS_DO_CLIENTE),
    );
    const corte = diaDeHoje(opcoes.hoje ?? new Date());
    const doCliente = and(eq(invoices.providerId, providerId), eq(invoices.customerId, customerId))!;
    const vencida = faturaVencidaAte(corte);

    const [linhas, agregado] = await Promise.all([
      db.select({
        id: invoices.id,
        erpSource: invoices.erpSource,
        erpRef: invoices.erpRef,
        vencimento: invoices.dueDate,
        valor: invoices.value,
        descricao: invoices.descricao,
        status: invoices.status,
        baixadaEm: invoices.baixadaEm,
      })
        .from(invoices)
        .where(doCliente)
        .orderBy(desc(invoices.dueDate), desc(invoices.id))
        .limit(limite),
      db.select({
        total: sql<number>`count(*)`.mapWith(Number),
        doErp: sql<number>`count(*) filter (where ${invoices.erpSource} is not null)`.mapWith(Number),
        vencidas: sql<number>`count(*) filter (where ${vencida})`.mapWith(Number),
        valorVencido: sql<number>`coalesce(sum(${invoices.value}) filter (where ${vencida}), 0)`.mapWith(Number),
        // `mapWith(due_date)` usa o MESMO decodificador da coluna: o agregado
        // volta como Date exatamente como a linha volta, e nao como o texto
        // cru do driver (que viraria dia local e escorregaria de mes).
        vencimentoMaisAntigo: sql<Date | null>`min(${invoices.dueDate}) filter (where ${vencida})`.mapWith(invoices.dueDate),
        vencimentoMaisRecente: sql<Date | null>`max(${invoices.dueDate}) filter (where ${vencida})`.mapWith(invoices.dueDate),
      })
        .from(invoices)
        .where(doCliente),
    ]);

    const a = agregado[0];
    return {
      linhas: linhas.map(l => ({
        id: l.id,
        erpSource: l.erpSource,
        erpRef: l.erpRef,
        vencimento: l.vencimento,
        valor: Number(l.valor ?? 0),
        descricao: l.descricao,
        status: l.status,
        baixadaEm: l.baixadaEm,
      })),
      total: a?.total ?? 0,
      limite,
      doErp: a?.doErp ?? 0,
      vencidas: a?.vencidas ?? 0,
      valorVencido: a?.valorVencido ?? 0,
      vencimentoMaisAntigo: a?.vencimentoMaisAntigo ?? null,
      vencimentoMaisRecente: a?.vencimentoMaisRecente ?? null,
    };
  }

  /**
   * A mensalidade observada nas faturas do ERP deste cliente — ver
   * `MensalidadeDoCliente`. `null` quando o cliente nao tem NENHUMA fatura
   * vinda da varredura: sem fatura nao ha valor, e a ficha diz isso em vez de
   * inventar um.
   *
   * So faturas do ERP (`erp_source is not null`): a linha de import CSV foi
   * digitada por alguem e nao prova o que o provedor cobra hoje. Todos os
   * status entram — a fatura de meses atras, ja baixada, e justamente a que
   * prova a recorrencia.
   */
  /**
   * A cobertura da mensalidade na carteira viva. Uma consulta agregada, nunca
   * N+1: em producao a maior carteira tem 29 mil clientes.
   */
  async coberturaDaMensalidade(providerId: number): Promise<CoberturaDaMensalidade> {
    const temFatura = sql`exists (
      select 1 from ${invoices}
      where ${invoices.customerId} = ${customers.id}
        and ${invoices.providerId} = ${providerId}
        and ${invoices.erpSource} is not null
    )`;
    const [linha] = await db.select({
        ativos: sql<number>`count(*)`.mapWith(Number),
        comMensalidade: sql<number>`count(*) filter (where ${temFatura})`.mapWith(Number),
        comDataDeContrato: sql<number>`count(*) filter (where ${temFatura} and ${customers.contractStartDate} is not null)`.mapWith(Number),
      })
      .from(customers)
      .where(and(
        eq(customers.providerId, providerId),
        inArray(customers.status, [...STATUS_DE_CLIENTE_ATUAL]),
      ));
    return {
      ativos: linha?.ativos ?? 0,
      comMensalidade: linha?.comMensalidade ?? 0,
      comDataDeContrato: linha?.comDataDeContrato ?? 0,
    };
  }

  /**
   * A mensalidade observada de TODA a carteira numa consulta — a mesma moda de
   * `mensalidadeDoCliente`, cliente a cliente, sem N+1 (a maior carteira tem
   * 29 mil clientes). Nasceu com o card "Prejuízo acumulado" (09/09/2026), que
   * precisa do ARPU de cada cliente para somar a Economia da carteira.
   *
   * Uma linha por cliente que tem ao menos uma fatura vinda do ERP; quem nao
   * tem nao aparece no mapa — e a Economia dele fica pendente, como no 360.
   */
  async mensalidadesDoProvedor(providerId: number, ids?: readonly number[]): Promise<Map<number, MensalidadeDoCliente>> {
    // Recorte por ids (os devedores do card): lista vazia e recorte vazio, nao
    // "a carteira inteira" — e poupa agrupar a tabela toda para somar 20 devedores.
    if (ids && ids.length === 0) return new Map();
    const porValor = db.select({
        customerId: invoices.customerId,
        valor: invoices.value,
        n: sql<number>`count(*)`.as("n"),
        maisRecente: sql<Date | null>`max(${invoices.dueDate})`.as("mais_recente"),
        total: sql<number>`sum(count(*)) over (partition by ${invoices.customerId})`.as("total"),
        // Do MESMO grupo (cliente, valor): baixada ou paga de outro valor nao prova este.
        baixadas: sql<number>`count(*) filter (where ${invoices.status} in ${PROVA_DE_PAGAMENTO})`.as("baixadas"),
        // A MODA: mais repeticoes primeiro; empate, o vencimento mais novo.
        posicao: sql<number>`row_number() over (partition by ${invoices.customerId} order by count(*) desc, max(${invoices.dueDate}) desc)`.as("posicao"),
      })
      .from(invoices)
      .where(and(
        eq(invoices.providerId, providerId),
        isNotNull(invoices.erpSource),
        ids ? inArray(invoices.customerId, [...ids]) : undefined,
      ))
      .groupBy(invoices.customerId, invoices.value)
      .as("por_valor");
    const linhas = await db.select({
        customerId: porValor.customerId,
        valor: porValor.valor,
        n: porValor.n,
        maisRecente: porValor.maisRecente,
        total: porValor.total,
        baixadas: porValor.baixadas,
      })
      .from(porValor)
      .where(eq(porValor.posicao, 1));

    const mapa = new Map<number, MensalidadeDoCliente>();
    for (const l of linhas) {
      const valor = Number(l.valor ?? 0);
      if (!Number.isFinite(valor) || valor <= 0) continue;
      mapa.set(l.customerId, {
        valor: Math.round(valor * 100) / 100,
        concordam: Number(l.n),
        faturas: Number(l.total ?? l.n),
        maisRecente: l.maisRecente ? new Date(l.maisRecente) : null,
        baixadas: Number(l.baixadas ?? 0),
      });
    }
    return mapa;
  }

  /**
   * OS DEVEDORES DA CARTEIRA com as duas datas que o card de prejuizo precisa,
   * numa consulta: a fatura vencida mais ANTIGA em aberto ("devem desde", o
   * eixo do periodo) e a vencida em aberto mais RECENTE (o fim do ciclo do
   * ex-cliente — o ultimo mes que o ERP cobrou e ninguem pagou; baixada
   * posterior seria pagamento, e ai o fim seria outro assunto).
   *
   * A populacao e a do KPI "Vencido" — `comDivida()` dentro de
   * `clienteDaCarteira` —, por isso a soma dos periodos + "sem data" fecha
   * com ele por construcao. Quem tem divida e nenhuma fatura vencida gravada
   * volta com as datas nulas: e o balde "sem data", nunca uma data inventada.
   *
   * As datas saem como DIA EM TEXTO (`to_char`), nunca como Date: `due_date` e
   * meia-noite UTC e um Date lido no fuso do servidor escorregaria de mes na
   * fronteira (01/09 viraria 31/08 em Sao Paulo). O periodo e atribuido em
   * texto, ano-na-frente, sem getMonth() no caminho.
   */
  async devedoresComVencimento(providerId: number, carteira: CarteiraDeCobranca, hoje: Date): Promise<DevedorDaCarteira[]> {
    const vencida = faturaVencidaAte(diaDeHoje(hoje));
    const datas = db.select({
        customerId: invoices.customerId,
        devemDesde: sql<string | null>`to_char(min(${invoices.dueDate}) filter (where ${vencida}), 'YYYY-MM-DD')`.as("devem_desde"),
        ultimaFatura: sql<string | null>`to_char(max(${invoices.dueDate}) filter (where ${vencida}), 'YYYY-MM-DD')`.as("ultima_fatura"),
      })
      .from(invoices)
      .where(eq(invoices.providerId, providerId))
      .groupBy(invoices.customerId)
      .as("datas");
    const linhas = await db.select({
        id: customers.id,
        statusErp: customers.status,
        dividaAtual: customers.totalOverdueAmount,
        contractStartDate: sql<string | null>`to_char(${customers.contractStartDate}, 'YYYY-MM-DD')`,
        cortadoEm: sql<string | null>`to_char(${customers.cortadoEm}, 'YYYY-MM-DD')`,
        devemDesde: datas.devemDesde,
        ultimaFatura: datas.ultimaFatura,
      })
      .from(customers)
      .leftJoin(datas, eq(datas.customerId, customers.id))
      .where(and(eq(customers.providerId, providerId), clienteDaCarteira(carteira), comDivida()));
    return linhas.map(l => ({
      id: l.id,
      statusErp: l.statusErp,
      dividaAtual: Math.round(Number(l.dividaAtual ?? 0) * 100) / 100,
      contractStartDate: l.contractStartDate ?? null,
      cortadoEm: l.cortadoEm ?? null,
      devemDesde: l.devemDesde ?? null,
      ultimaFatura: l.ultimaFatura ?? null,
    }));
  }

  /**
   * Ha fatura vinda do ERP, e quando a varredura tocou uma pela ultima vez —
   * o `live`/`atualizadoEm` de toda faixa que le `invoices`. O incidente de
   * 31/08 zerou divida numa leitura vazia; a data e o que deixa o operador
   * datar o numero.
   */
  async baseDeFaturas(providerId: number): Promise<{ total: number; atualizadoEm: Date | null }> {
    const [b] = await db.select({
      total: sql<number>`count(*)`.mapWith(Number),
      atualizadoEm: max(invoices.updatedAt),
    })
      .from(invoices)
      .where(and(eq(invoices.providerId, providerId), isNotNull(invoices.erpSource)));
    return { total: b?.total ?? 0, atualizadoEm: b?.atualizadoEm ?? null };
  }

  async mensalidadeDoCliente(providerId: number, customerId: number): Promise<MensalidadeDoCliente | null> {
    const linhas = await db.select({
        valor: invoices.value,
        n: sql<number>`count(*)`.mapWith(Number),
        maisRecente: sql<Date | null>`max(${invoices.dueDate})`.mapWith(invoices.dueDate),
      })
      .from(invoices)
      .where(and(
        eq(invoices.providerId, providerId),
        eq(invoices.customerId, customerId),
        isNotNull(invoices.erpSource),
      ))
      .groupBy(invoices.value)
      // A MODA: mais repeticoes primeiro; empate, o vencimento mais novo.
      .orderBy(desc(sql`count(*)`), desc(sql`max(${invoices.dueDate})`))
      .limit(1);

    const moda = linhas[0];
    if (!moda) return null;
    const valor = Number(moda.valor ?? 0);
    if (!Number.isFinite(valor) || valor <= 0) return null;

    const [contagem] = await db.select({
        total: sql<number>`count(*)`.mapWith(Number),
        // So as baixadas ou pagas DO VALOR da moda — a mesma regra do lote.
        baixadas: sql<number>`count(*) filter (where ${invoices.status} in ${PROVA_DE_PAGAMENTO} and ${invoices.value} = ${moda.valor})`.mapWith(Number),
      })
      .from(invoices)
      .where(and(
        eq(invoices.providerId, providerId),
        eq(invoices.customerId, customerId),
        isNotNull(invoices.erpSource),
      ));

    return {
      valor: Math.round(valor * 100) / 100,
      concordam: moda.n,
      faturas: contagem?.total ?? moda.n,
      maisRecente: moda.maisRecente ?? null,
      // `mapWith(Number)` faz NaN de coluna ausente; NaN nao e "nenhuma baixada".
      baixadas: Number.isFinite(Number(contagem?.baixadas)) ? Number(contagem!.baixadas) : 0,
    };
  }

  /**
   * QUANTO A COBRANCA RECUPEROU DEPOIS DE UM CONTATO (C6 do 2Safe).
   *
   * A pergunta do dono e "o contato adiantou alguma coisa?". A resposta
   * possivel com o dado que existe: as faturas que SUMIRAM dos pendentes do
   * ERP (`baixada_no_erp`) num periodo, cujo cliente tinha recebido um contato
   * registrado nos dias anteriores.
   *
   * SO VARREDURA COMPLETA CONTA — e nao ha filtro aqui para isso, de
   * proposito. Quem grava `baixada_no_erp` e `baixarFaturasSumidas` (acima), e
   * o unico chamador dela e o sync, sob esta condicao
   * (`server/services/erp-sync.service.ts`, passo 3c):
   *
   *     const varreduraCompleta = leituraCompleta && errors === 0
   *       && !falhaNaCarteira && !faturasNaoLidas;
   *     if (varreduraCompleta && refsVistas.size > 0) { ... }
   *
   * Ou seja: leitura completa da carteira, zero erros, nenhuma carteira que
   * falhou e nenhuma fatura nao lida. Em varredura parcial nada e baixado,
   * entao toda linha `baixada_no_erp` ja nasceu de uma varredura completa. Se
   * um dia outro caminho gravar esse status, a conta aqui passa a mentir — por
   * isso a regra esta escrita, e nao so subentendida.
   *
   * A baixa e PAGAMENTO PROVAVEL, nunca confirmado: nenhum ERP nos diz o valor
   * pago (o mesmo motivo de `recebidoConfirmado: false` no resumo do mes).
   *
   * ATRIBUICAO DE ULTIMO TOQUE: cada fatura conta UMA vez, para o contato mais
   * recente dentro da janela. Sem isso, um cliente contatado por dois canais
   * somaria a mesma fatura duas vezes e o total nao fecharia com a realidade.
   *
   * ORIGEM DO CONTATO — o que o dado permite afirmar, e nada alem:
   *   `assistente` = a MENSAGEM foi escrita pela maquina (o agente de IA ou um
   *      template aprovado). E o que `origemTexto` marca em
   *      `chat-ponte.service.ts`; vale tanto para a rodada automatica quanto
   *      para o operador que clicou "Enviar p/ cobranca" — o evento gravado e
   *      o mesmo, e o banco NAO distingue as duas iniciativas.
   *   `operador` = a pessoa escreveu o texto ou registrou o contato a mao.
   *   `indefinido` = nem um nem outro (linha antiga, sem usuario e sem chat).
   */
  async recuperacaoAposContato(
    providerId: number,
    opcoes: { dias?: number; janelaDias?: number; hoje?: Date; carteira?: CarteiraDeCobranca } = {},
  ): Promise<RecuperacaoAposContato> {
    const doEscopo = opcoes.carteira ? inArray(invoices.customerId, db.select({ id: customers.id }).from(customers).where(and(eq(customers.providerId, providerId), clienteDaCarteira(opcoes.carteira)))) : undefined;
    const hoje = opcoes.hoje ?? new Date();
    const dias = Math.max(1, Math.min(Math.trunc(opcoes.dias ?? 30), 365));
    const janelaDias = Math.max(1, Math.min(Math.trunc(opcoes.janelaDias ?? 7), 90));
    const desde = new Date(hoje.getTime() - dias * 86_400_000);

    // A base: existe fatura vinda do ERP, e alguma varredura completa ja
    // baixou alguma? Sem uma das duas o KPI e "—" com motivo, nunca R$ 0,00.
    const [b] = await db.select({
      doErp: sql<number>`count(*) filter (where ${invoices.erpSource} is not null)`.mapWith(Number),
      baixadas: sql<number>`count(*) filter (where ${invoices.status} = 'baixada_no_erp')`.mapWith(Number),
    })
      .from(invoices)
      .where(and(eq(invoices.providerId, providerId), doEscopo));

    const vazio = (motivo: string): RecuperacaoAposContato => ({
      base: false, motivo, dias, janelaDias, desde, ate: hoje,
      valor: null, faturas: null, clientes: null, porOrigem: [], porCanal: [],
    });
    if ((b?.doErp ?? 0) === 0) return vazio("Nenhuma fatura veio do ERP deste provedor; nao ha o que conciliar.");
    if ((b?.baixadas ?? 0) === 0) return vazio("Nenhuma varredura completa fechou fatura ainda; sem baixa nao ha recuperacao para medir.");

    // Fatura baixada no periodo x contato do MESMO provedor ao MESMO cliente,
    // nos `janelaDias` que antecederam a baixa. `ordem = 1` e o ultimo toque.
    const pares = db.select({
      faturaId: invoices.id,
      customerId: invoices.customerId,
      valor: invoices.value,
      canal: sql<string>`coalesce(${cobrancaEventos.canal}, 'nao_informado')`.as("canal"),
      origem: sql<string>`case
        when ${cobrancaEventos.metadata}->'chat' is not null
         and coalesce(${cobrancaEventos.metadata}->>'origemTexto', '') in ('agente_ia', 'template_aprovado') then 'assistente'
        when ${cobrancaEventos.userId} is not null then 'operador'
        else 'indefinido' end`.as("origem"),
      ordem: sql<number>`row_number() over (partition by ${invoices.id} order by ${cobrancaEventos.ocorridoEm} desc, ${cobrancaEventos.id} desc)`.as("ordem"),
    })
      .from(invoices)
      .innerJoin(cobrancaEventos, and(
        eq(cobrancaEventos.providerId, providerId),
        eq(cobrancaEventos.customerId, invoices.customerId),
        eq(cobrancaEventos.tipo, "contato"),
        sql`${cobrancaEventos.ocorridoEm} <= ${invoices.baixadaEm}`,
        sql`${cobrancaEventos.ocorridoEm} >= ${invoices.baixadaEm} - make_interval(days => ${janelaDias})`,
      ))
      .where(and(
        eq(invoices.providerId, providerId),
        doEscopo,
        eq(invoices.status, "baixada_no_erp"),
        isNotNull(invoices.erpSource),
        isNotNull(invoices.baixadaEm),
        gte(invoices.baixadaEm, desde),
      ))
      .as("pares");

    const soma = {
      valor: sql<number>`coalesce(sum(${pares.valor}), 0)`.mapWith(Number),
      faturas: sql<number>`count(*)`.mapWith(Number),
      clientes: sql<number>`count(distinct ${pares.customerId})`.mapWith(Number),
    };
    const doUltimoToque = eq(pares.ordem, 1);
    // Tres agregacoes sobre o MESMO recorte: o total, e as duas quebras. Os
    // clientes distintos nao se somam entre grupos (o mesmo cliente pode ter
    // sido tocado por dois canais), entao cada quebra conta os seus.
    const [total, porOrigem, porCanal] = await Promise.all([
      db.select(soma).from(pares).where(doUltimoToque),
      db.select({ chave: pares.origem, ...soma }).from(pares).where(doUltimoToque).groupBy(pares.origem),
      db.select({ chave: pares.canal, ...soma }).from(pares).where(doUltimoToque).groupBy(pares.canal),
    ]);

    const ordenar = (linhas: RecorteDaRecuperacao[]) => linhas.slice().sort((a, c) => c.valor - a.valor);
    return {
      base: true,
      motivo: null,
      dias,
      janelaDias,
      desde,
      ate: hoje,
      valor: total[0]?.valor ?? 0,
      faturas: total[0]?.faturas ?? 0,
      clientes: total[0]?.clientes ?? 0,
      porOrigem: ordenar(porOrigem),
      porCanal: ordenar(porCanal),
    };
  }
}
