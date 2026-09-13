/**
 * O HISTÓRICO de faturas do sandbox: as mensalidades pagas, a fatura do mês e
 * a recuperação dos últimos 30 dias — o que a semeadura de `sandbox.service.ts`
 * não gravava (auditoria da demo, 13/09/2026: nenhum dos 1.125 clientes em dia
 * tinha fatura; a realidade mensal abria 1.325 ativos "sem fatura", recebido 0;
 * Histórico de pagamento e Pontualidade do 360 vazios; o prejuízo de TODO
 * ex-cliente "estimado"; e os dois indicadores de "recuperado 30 d" sem base).
 *
 * Módulo PURO, no molde dos outros semeadores: recebe os clientes que a
 * semeadura já montou e devolve linhas `InsertInvoice` — quem insere, em
 * blocos e na mesma transação, é `tentarCriarSandbox`. Nada de banco aqui, e
 * por isso nada de `faturas.storage.ts` (que carrega o banco): as poucas
 * regras de calendário de lá estão repetidas abaixo, com o nome de onde vêm.
 *
 * Três regras que valem para o arquivo inteiro:
 *
 * 1. A DÍVIDA SÓ MUDA DECLARADA. Nenhuma linha nova vence durante as 24 h de
 *    vida do sandbox, e as duas mudanças de dívida saem DECLARADAS para a
 *    fiação ajustar fatura, agregado e caso juntos: a recuperação
 *    (`recuperacoes`) e a mensalidade do mês do inadimplente que já venceu
 *    (`dividasDoMes`) — é a única linha nova aberta e vencida.
 * 2. A PONTUALIDADE NÃO É SORTEIO. O perfil de pagamento de cada cliente é a
 *    confiabilidade do DNA (`classificarConfiabilidade`, shared/cobranca/dna.ts)
 *    calculada com a dívida de hoje e sem histórico — a mesma que os casos
 *    semeados já carregam (`dnaDoCaso` sem pagamentos). Quantas pagas saem com
 *    atraso é escolhido pelos limiares DAQUELA função, então quando a régua
 *    recalcula o DNA com este histórico o quadrante não muda.
 * 3. DATA É DIA DE CALENDÁRIO. Vencimento e pagamento entram como meia-noite
 *    UTC do dia, a forma de `diaComoTimestamp` (faturas.storage.ts), e "hoje" é
 *    o dia LOCAL de `agora`, o `corte` de `resumoDoMes`.
 */
import type { InsertInvoice } from "@shared/schema";
import type { cobrancaQuitacoes } from "@shared/schema-cobranca-faturas";
import {
  CRONICO_TAXA_ATRASO_ACIMA_DE,
  EM_DIA_TAXA_ATRASO_MAX,
  classificarConfiabilidade,
  type Confiabilidade,
} from "@shared/cobranca/dna";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";

const DIA_MS = 86_400_000;

/** Meses de mensalidade paga antes da fatura do mês (em dia), da dívida (inadimplente) ou do corte (cancelado). */
export const MESES_DE_HISTORICO = 6;
/** O corte de volume, só nos em dia: 3 meses ainda dão pontualidade e recebido, com metade das linhas. */
export const MESES_DE_HISTORICO_REDUZIDO = 3;
/**
 * Teto de linhas NOVAS por sandbox. A carteira de 1.500 clientes gera ~9 mil
 * com 6 meses; o teto dá folga sem deixar a porta da demonstração pagar por
 * uma carteira que cresceu sem ninguém rever o orçamento de `criarSandbox`.
 */
export const TETO_DE_FATURAS_HISTORICAS = 11_000;

/**
 * Dias de vencimento que um ISP oferece. Para em dia e cancelado o dia sai do
 * id do cliente; o inadimplente vence no dia da própria fatura em aberto, que
 * é o dia do contrato dele.
 */
const DIAS_DE_VENCIMENTO = [5, 10, 15, 20, 25] as const;
/** Fevereiro: o dia 29, 30 ou 31 da dívida vira 28 nos meses anteriores. */
const ULTIMO_DIA_SEGURO = 28;

/**
 * O a vencer precisa continuar a vencer até o sandbox morrer (24 h,
 * `VIDA_DO_SANDBOX_MS`): um vencimento hoje ou amanhã viraria dívida no meio da
 * visita, sem o agregado do cliente acompanhar.
 */
const FOLGA_DO_A_VENCER_DIAS = 2;
/** Um em cada três vencimentos ainda futuros fica a vencer; os outros já foram pagos adiantados. */
const UM_A_VENCER_A_CADA = 3;

/** Atraso de quem oscila (3 a 10 dias) e de quem é crônico (12 a 20) — sempre antes da fatura seguinte. */
const ATRASO_OSCILA = { minimo: 3, amplitude: 8 };
const ATRASO_CRONICO = { minimo: 12, amplitude: 9 };

/** Até 3 recuperações por carteira: o bastante para os indicadores terem base, pouco para mudar a carteira. */
export const RECUPERACOES_POR_CARTEIRA = 3;
/**
 * A janela do contato que pode virar recuperação. A baixa é UM dia depois do
 * contato (`recuperacaoAposContato` conta contatos até 7 dias antes da baixa):
 * contato de ao menos 2 dias deixa a baixa no passado mesmo lida como dia de
 * calendário, e contato de no máximo 28 dias mantém os dois indicadores de
 * "30 dias" acesos durante as 24 h do sandbox.
 */
const CONTATO_MAIS_RECENTE_DIAS = 2;
const CONTATO_MAIS_ANTIGO_DIAS = 28;
const DIAS_DO_CONTATO_ATE_A_RECUPERACAO = 1;

export interface ClienteDoHistorico {
  customerId: number;
  categoria: "em_dia" | "inadimplente" | "cancelado";
  /** A mensalidade do plano — `valorMensalidade(indice)` da semeadura, a mesma de `precoPorPlano`. */
  mensalidade: number;
  /** `customers.contractStartDate` ('AAAA-MM-DD'). Nenhuma fatura vence antes dele. */
  contractStartDate: string | null;
  /** `customers.cortadoEm` — só cancelado. */
  cortadoEm: Date | null;
  /** `customers.maxDaysOverdue`. */
  maxDaysOverdue: number;
  /** `customers.overdueInvoicesCount`. */
  overdueInvoicesCount: number;
  /**
   * A fatura VENCIDA que a semeadura já grava para este cliente (a mensalidade
   * do inadimplente, a saída do ex-cliente que não pagou). `null` para quem não
   * deve. É o limite do histórico do inadimplente e a única fatura que uma
   * recuperação fecha.
   */
  faturaEmAberto: { erpRef: string; valor: number; vencimento: Date } | null;
}

export interface ContatoDoHistorico {
  customerId: number;
  /** `cobranca_eventos.ocorrido_em` do evento `contato`. */
  contatoEm: Date;
}

/** O recibo de `cobranca_quitacoes` sem `faturaId`, que só existe depois do insert: casar por `erpRef`. */
export type QuitacaoDaDemo = Omit<typeof cobrancaQuitacoes.$inferInsert, "faturaId"> & { erpRef: string };

export interface RecuperacaoDaDemo {
  customerId: number;
  carteira: "ativo" | "ex_cliente";
  /**
   * `baixada_no_erp` acende o "recuperado 30d" da esteira
   * (`recuperacaoAposContato`); `quitacao` acende o "Recuperado 30 d" da
   * carteira (`kpisDaCobranca` soma `cobranca_quitacoes`). Uma fatura não
   * serve aos dois: a quitação a deixa `paid`, e a esteira só lê a baixada.
   */
  mecanismo: "baixada_no_erp" | "quitacao";
  /** O `erpRef` da `faturaEmAberto` do cliente. */
  erpRef: string;
  valor: number;
  contatoEm: Date;
  recuperadoEm: Date;
  /** O que aplicar na linha daquela fatura antes do insert — os campos que o fluxo real grava. */
  alteracaoDaFatura: Partial<InsertInvoice>;
}

/**
 * A mensalidade do mês corrente de um inadimplente ativo que JÁ venceu: uma
 * linha de `faturas` com status vencido que a dívida do cliente ainda não
 * conta. A fiação soma `valor` em `totalOverdueAmount` e 1 em
 * `overdueInvoicesCount` antes de montar casos, conversas, consultas e alertas.
 */
export interface DividaDoMes {
  customerId: number;
  erpRef: string;
  valor: number;
  vencimento: Date;
}

export interface FaturasHistoricasDoSandbox {
  /** Linhas NOVAS, todas `demo-mens-*`: nenhuma substitui as faturas que a semeadura já grava. */
  faturas: InsertInvoice[];
  /** Clientes que DEIXAM DE DEVER — a fiação zera o agregado e fecha o caso. */
  recuperacoes: RecuperacaoDaDemo[];
  quitacoes: QuitacaoDaDemo[];
  /** Clientes que PASSAM A DEVER mais uma mensalidade — a fiação soma no agregado. */
  dividasDoMes: DividaDoMes[];
  /** 6, ou 3 quando o teto de volume cortou o histórico dos em dia. */
  mesesDeHistoricoEmDia: number;
}

/** O status da fatura vencida do inadimplente — o mesmo de `linhaDaFatura` (sandbox.service.ts). */
const STATUS_DA_MENSALIDADE_VENCIDA = "overdue";

export function faturasHistoricasDoSandbox(entrada: {
  providerId: number;
  /** O administrador do sandbox — quem "conferiu" o comprovante da quitação. */
  adminId: number;
  clientes: readonly ClienteDoHistorico[];
  /** A ORDEM decide quem vira recuperação: os 3 primeiros elegíveis de cada carteira. */
  contatos: readonly ContatoDoHistorico[];
  agora: Date;
  /**
   * Meses de histórico dos em dia — `MESES_DE_HISTORICO` quando não vem. A
   * fiação pede menos quando o orçamento de `criarSandbox` não comporta a
   * carteira inteira com 6 meses (as linhas dos em dia são o grosso do volume);
   * o teto continua valendo por cima.
   */
  mesesDeHistoricoEmDia?: number;
}): FaturasHistoricasDoSandbox {
  const hoje = diaLocal(entrada.agora);
  // A recuperação sai primeiro: quem pagou a dívida nos últimos 30 dias pagou
  // também a mensalidade do mês, e não pode nascer devendo ela.
  const { recuperacoes, quitacoes } = recuperacoesDoSandbox(entrada);
  const recuperados = new Set(recuperacoes.map((r) => r.customerId));
  const gerar = (mesesEmDia: number) =>
    entrada.clientes.flatMap((c) =>
      historicoDoCliente(entrada.providerId, c, hoje, c.categoria === "em_dia" ? mesesEmDia : MESES_DE_HISTORICO, recuperados.has(c.customerId)));

  let mesesDeHistoricoEmDia = entrada.mesesDeHistoricoEmDia ?? MESES_DE_HISTORICO;
  let faturas = gerar(mesesDeHistoricoEmDia);
  if (faturas.length > TETO_DE_FATURAS_HISTORICAS) {
    mesesDeHistoricoEmDia = MESES_DE_HISTORICO_REDUZIDO;
    faturas = gerar(mesesDeHistoricoEmDia);
  }
  // A carteira do sandbox tem tamanho fixo: passar do teto mesmo cortado é
  // deriva de quem mexeu nela, e falhar alto é melhor que estourar o orçamento
  // da porta da demonstração em silêncio.
  if (faturas.length > TETO_DE_FATURAS_HISTORICAS) {
    throw new Error(`faturasHistoricasDoSandbox: ${faturas.length} faturas passam do teto de ${TETO_DE_FATURAS_HISTORICAS} mesmo com ${MESES_DE_HISTORICO_REDUZIDO} meses nos em dia`);
  }

  const dividasDoMes = faturas
    .filter((f) => f.status === STATUS_DA_MENSALIDADE_VENCIDA)
    .map((f): DividaDoMes => ({ customerId: f.customerId, erpRef: f.erpRef!, valor: Number(f.value), vencimento: f.dueDate }));
  return { faturas, recuperacoes, quitacoes, dividasDoMes, mesesDeHistoricoEmDia };
}

// ── Calendário ──

function meiaNoiteUtc(ano: number, mes0: number, dia: number): Date {
  // `Date.UTC` resolve mês negativo ou acima de 11 — é o que vira o ano.
  return new Date(Date.UTC(ano, mes0, dia));
}

/** O dia LOCAL de `d` como meia-noite UTC — o `diaDeHoje` de faturas.storage.ts, na forma de `due_date`. */
function diaLocal(d: Date): Date {
  return meiaNoiteUtc(d.getFullYear(), d.getMonth(), d.getDate());
}

/** O dia UTC de um timestamp já gravado (o vencimento da fatura em aberto, o corte). */
function diaUtc(d: Date): Date {
  return meiaNoiteUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function maisDias(d: Date, dias: number): Date {
  return new Date(d.getTime() + dias * DIA_MS);
}

const menor = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
const maior = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

function dataDoContrato(valor: string | null): Date | null {
  const m = valor ? /^(\d{4})-(\d{2})-(\d{2})/.exec(valor) : null;
  return m ? meiaNoiteUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** 'AAAA-MM-DD' do dia LOCAL — o `pagoEm` que o administrador digita na confirmação da quitação. */
function dataLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Mensalidades ──

/**
 * A confiabilidade do DNA com a dívida de hoje e sem histórico. A fidelidade
 * (meses de casa) não entra na confiabilidade — o zero só preenche o campo.
 */
function perfilDePagamento(c: ClienteDoHistorico): Confiabilidade {
  return classificarConfiabilidade({ mesesComoCliente: 0, diasAtrasoMax: c.maxDaysOverdue, faturasAbertas: c.overdueInvoicesCount, historicoInsuficiente: true });
}

/**
 * Quantas das `pagas` saem com atraso sem mudar o perfil. Em dia tolera até
 * `EM_DIA_TAXA_ATRASO_MAX` (com 6 pagas, nenhuma); quem oscila fica no máximo
 * em `CRONICO_TAXA_ATRASO_ACIMA_DE` (ele já oscila pela dívida de 31 a 90
 * dias); o crônico passa dela, como o histórico de quem chegou lá.
 */
function quantasComAtraso(perfil: Confiabilidade, pagas: number): number {
  if (perfil === "em_dia") return Math.floor(pagas * EM_DIA_TAXA_ATRASO_MAX);
  if (perfil === "oscila") return Math.floor(pagas * CRONICO_TAXA_ATRASO_ACIMA_DE);
  return Math.min(pagas, Math.floor(pagas * CRONICO_TAXA_ATRASO_ACIMA_DE) + 1);
}

function linhaDaMensalidade(providerId: number, c: ClienteDoHistorico, vencimento: Date, pagoEm: Date | null): InsertInvoice {
  const valor = c.mensalidade.toFixed(2);
  const ano = vencimento.getUTCFullYear();
  const mes = String(vencimento.getUTCMonth() + 1).padStart(2, "0");
  return {
    customerId: c.customerId,
    providerId,
    value: valor,
    dueDate: vencimento,
    // "aberta" é o pendente do ERP (0027) — a fonte demo é um ERP.
    status: pagoEm ? "paid" : "aberta",
    // O padrão que a leitura de mensalidade reconhece como fatura comum, e não
    // de saída (`PADRAO_DE_LEITURA_DE_FATURAS`, shared/cobranca/multa.ts).
    descricao: `Mensalidade ${mes}/${ano}`,
    erpSource: FONTE_ERP_DEMO,
    // Único por cliente e mês de vencimento; nunca colide com `demo-fatura-*`/`demo-saida-*`.
    erpRef: `demo-mens-${c.customerId}-${ano}${mes}`,
    // O valor pago que o ERP confirma (0036): é o `recebido` da Economia.
    ...(pagoEm ? { paidDate: pagoEm, paidValue: valor } : {}),
  };
}

function historicoDoCliente(providerId: number, c: ClienteDoHistorico, hoje: Date, meses: number, recuperado: boolean): InsertInvoice[] {
  const inicioDoContrato = dataDoContrato(c.contractStartDate);
  const ontem = maisDias(hoje, -1);
  const noContrato = (vencimento: Date) => !inicioDoContrato || vencimento.getTime() >= inicioDoContrato.getTime();
  /** Quem paga em dia paga no vencimento ou até 2 dias antes — nunca antes de o contrato existir. */
  const pontual = (vencimento: Date, semente: number, ate: Date) => {
    const pago = menor(maisDias(vencimento, -((c.customerId + semente) % 3)), maisDias(ate, -((c.customerId + semente) % 3)));
    return inicioDoContrato ? maior(pago, inicioDoContrato) : pago;
  };

  if (c.categoria === "em_dia") {
    const dia = DIAS_DE_VENCIMENTO[c.customerId % DIAS_DE_VENCIMENTO.length];
    const linhas: InsertInvoice[] = [];
    // Do mais antigo à fatura do mês corrente (k = 0). Todo mês passado já
    // venceu — o dia mais tardio (25) do mês anterior é antes de hoje.
    for (let k = meses; k >= 0; k--) {
      const vencimento = meiaNoiteUtc(hoje.getUTCFullYear(), hoje.getUTCMonth() - k, dia);
      if (!noContrato(vencimento)) continue;
      const aVencer = vencimento.getTime() >= maisDias(hoje, FOLGA_DO_A_VENCER_DIAS).getTime() && c.customerId % UM_A_VENCER_A_CADA === 0;
      linhas.push(linhaDaMensalidade(providerId, c, vencimento, aVencer ? null : pontual(vencimento, k, ontem)));
    }
    return linhas;
  }

  // Inadimplente: pagou até a fatura que ficou em aberto. Cancelado: pagou até
  // o corte (a fatura de saída cobra o proporcional do último mês).
  const limite = c.categoria === "inadimplente" ? c.faturaEmAberto?.vencimento : c.cortadoEm;
  if (!limite) return [];
  const diaDoLimite = diaUtc(limite);
  const dia = c.categoria === "inadimplente"
    ? Math.min(diaDoLimite.getUTCDate(), ULTIMO_DIA_SEGURO)
    : DIAS_DE_VENCIMENTO[c.customerId % DIAS_DE_VENCIMENTO.length];
  const pagoAte = menor(maisDias(diaDoLimite, -1), ontem);

  // A mensalidade do mês corrente do inadimplente ativo (revisão da fase B,
  // 13/09/2026): sem ela a carteira do mês contava 200 ativos "sem fatura" e 25
  // inadimplentes, contra 222 ativos devendo — um provedor fatura todo ativo
  // todo mês. Quando a dívida em aberto já é do mês, ela é a fatura do mês. No
  // dia da dívida (o dia do contrato), se o dia já passou ela venceu: dívida
  // nova, declarada em `dividasDoMes` — ou paga, para quem pagou a dívida nos
  // últimos 30 dias. Senão fica a vencer; se venceria hoje ou amanhã, prorrogada
  // para depois de amanhã, como o ERP faz com vencimento em dia sem expediente:
  // a vencer não pode virar dívida no meio da visita. O dia é no máximo 28, e a
  // prorrogação nunca sai do mês.
  let doMes: InsertInvoice | null = null;
  if (c.categoria === "inadimplente" && (diaDoLimite.getUTCFullYear() !== hoje.getUTCFullYear() || diaDoLimite.getUTCMonth() !== hoje.getUTCMonth())) {
    const vencimento = meiaNoiteUtc(hoje.getUTCFullYear(), hoje.getUTCMonth(), dia);
    if (vencimento.getTime() >= hoje.getTime()) {
      doMes = linhaDaMensalidade(providerId, c, maior(vencimento, maisDias(hoje, FOLGA_DO_A_VENCER_DIAS)), null);
    } else if (recuperado) {
      doMes = linhaDaMensalidade(providerId, c, vencimento, pontual(vencimento, 0, ontem));
    } else {
      doMes = { ...linhaDaMensalidade(providerId, c, vencimento, null), status: STATUS_DA_MENSALIDADE_VENCIDA };
    }
  }

  // Do mais recente (k = 1) ao mais antigo: os atrasos ficam nos meses que
  // antecederam a dívida — o pagamento piora antes de parar.
  const vencimentos: Date[] = [];
  for (let k = 1; k <= meses; k++) {
    const vencimento = meiaNoiteUtc(diaDoLimite.getUTCFullYear(), diaDoLimite.getUTCMonth() - k, dia);
    if (noContrato(vencimento)) vencimentos.push(vencimento);
  }
  // O perfil com a dívida que o cliente TERÁ: a mensalidade do mês vencida conta como mais uma aberta.
  const perfil = perfilDePagamento(doMes?.status === STATUS_DA_MENSALIDADE_VENCIDA ? { ...c, overdueInvoicesCount: c.overdueInvoicesCount + 1 } : c);
  const comAtraso = quantasComAtraso(perfil, vencimentos.length);
  const atraso = perfil === "cronico" ? ATRASO_CRONICO : ATRASO_OSCILA;

  return vencimentos.map((vencimento, i) => {
    // O limite corta o atraso sem apagá-lo: o último dia antes da dívida ou do
    // corte fica sempre depois do dia 28 do mês anterior.
    const pagoEm = i < comAtraso
      ? menor(maisDias(vencimento, atraso.minimo + ((c.customerId + i) % atraso.amplitude)), pagoAte)
      : pontual(vencimento, i, pagoAte);
    return linhaDaMensalidade(providerId, c, vencimento, pagoEm);
  }).reverse().concat(doMes ? [doMes] : []);
}

// ── Recuperação dos últimos 30 dias ──

/**
 * Até 3 clientes que devem, por carteira, na ordem dos contatos: a fatura em
 * aberto de cada um fecha UM dia depois do contato. Alternando o mecanismo
 * (baixa, quitação, baixa) cada carteira acende os dois indicadores.
 *
 * Quem entra em `contatos` é decisão da fiação — o cliente precisa poder sair
 * devedor: a quitação real recusa cliente com acordo ou parcela recebida
 * (`registrarQuitacaoConfirmada`), e um recibo depois da abertura do caso
 * trava o aceite de acordo (`conferirQuitacoesDoCaso`).
 */
function recuperacoesDoSandbox(entrada: {
  providerId: number;
  adminId: number;
  clientes: readonly ClienteDoHistorico[];
  contatos: readonly ContatoDoHistorico[];
  agora: Date;
}): Pick<FaturasHistoricasDoSandbox, "recuperacoes" | "quitacoes"> {
  const { providerId, adminId, agora } = entrada;
  const cliente = new Map(entrada.clientes.map((c) => [c.customerId, c]));
  const escolhidos = new Set<number>();
  const porCarteira = { ativo: 0, ex_cliente: 0 };
  const recuperacoes: RecuperacaoDaDemo[] = [];
  const quitacoes: QuitacaoDaDemo[] = [];

  for (const { customerId, contatoEm } of entrada.contatos) {
    const c = cliente.get(customerId);
    const divida = c?.faturaEmAberto;
    if (!c || !divida || c.categoria === "em_dia" || escolhidos.has(customerId)) continue;
    const idade = agora.getTime() - contatoEm.getTime();
    if (idade < CONTATO_MAIS_RECENTE_DIAS * DIA_MS || idade > CONTATO_MAIS_ANTIGO_DIAS * DIA_MS) continue;
    // Contato antes do vencimento não cobrou esta dívida.
    if (contatoEm.getTime() < divida.vencimento.getTime()) continue;
    const carteira = c.categoria === "inadimplente" ? "ativo" : "ex_cliente";
    const ordem = porCarteira[carteira];
    if (ordem >= RECUPERACOES_POR_CARTEIRA) continue;
    porCarteira[carteira] += 1;
    escolhidos.add(customerId);

    const recuperadoEm = maisDias(contatoEm, DIAS_DO_CONTATO_ATE_A_RECUPERACAO);
    const base = { customerId, carteira, erpRef: divida.erpRef, valor: divida.valor, contatoEm, recuperadoEm } as const;

    if (ordem % 2 === 0) {
      // Como `baixarFaturasSumidas` grava: sumiu dos pendentes, e baixadaEm é quando notamos.
      recuperacoes.push({ ...base, mecanismo: "baixada_no_erp", alteracaoDaFatura: { status: "baixada_no_erp", baixadaEm: recuperadoEm } });
      continue;
    }
    // Como a rota de confirmação grava (`registerCobrancaRecebimentosRoutes`):
    // comprovante conferido pelo administrador, valor integral, e a fatura paga
    // na data do recibo.
    const pagoEm = dataLocal(recuperadoEm);
    const [ano, mes, dia] = pagoEm.split("-").map(Number);
    recuperacoes.push({ ...base, mecanismo: "quitacao", alteracaoDaFatura: { status: "paid", paidDate: meiaNoiteUtc(ano, mes - 1, dia) } });
    quitacoes.push({
      providerId,
      customerId,
      erpRef: divida.erpRef,
      origem: "comprovante_conferido",
      referencia: `demo-comprovante-${customerId}`,
      pagoEm,
      valorPago: divida.valor.toFixed(2),
      userId: adminId,
      confirmadoEm: recuperadoEm,
    });
  }

  return { recuperacoes, quitacoes };
}
