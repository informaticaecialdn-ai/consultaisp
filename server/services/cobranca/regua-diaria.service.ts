/**
 * A RÉGUA DIÁRIA — o que a cobrança faz sozinha, para o funcionário só
 * trabalhar a fila.
 *
 * No Provedor.ai (mesmo dono) o relógio da régua acorda agentes de IA. Aqui o
 * pedido, nas palavras dele (05/09/2026), é "ao invés de agentes vai ser o
 * funcionário, usuário do sistema". Então o job NÃO fala com cliente nenhum:
 * ele mantém a carteira honesta — abre o caso de quem entrou em atraso, move a
 * etapa de quem envelheceu, encerra quem pagou, quebra o acordo de quem parou
 * de pagar, cancela o caso de quem cancelou o contrato no ERP e tira de cena a
 * dívida prescrita — e o funcionário abre o kanban de manhã com tudo no lugar.
 *
 * ── Fase 1: por CLIENTE, sobre `max_days_overdue` ────────────────────────────
 *
 * Medido em produção em 05/09/2026: não existe fatura a fatura. O sync grava
 * só agregados em `customers`, então cada decisão daqui lê a foto de HOJE do
 * cliente (dívida, dias de atraso, faturas abertas, status no ERP) e o caso
 * guarda a foto da abertura. A etapa preventiva (D-7..D0) fica no catálogo mas
 * nunca dispara — `etapaParaAtraso` a pula com `depende_de_fatura`.
 *
 * ── Idempotente por construção ───────────────────────────────────────────────
 *
 * A passada roda no boot do worker E às 05:00; um restart às 05:10 roda duas
 * vezes no mesmo dia, e isso não pode duplicar caso nem evento. Cada escrita
 * só acontece quando o estado gravado DIFERE do calculado: candidato sem caso
 * vivo (o storage e o índice único parcial garantem), etapa que mudou, valor
 * que mudou, DNA que mudou, acordo que ainda está ativo. Encerrar e cancelar
 * são terminais: o caso sai da lista de vivos e não volta a ser examinado.
 * Rodar de novo sem nada ter mudado não escreve nada.
 *
 * A primeira passada em produção abre ~7.200 casos (559 ativos + 6.637
 * ex-clientes, R$ 4,59 mi; 685 prescritos nunca entram). Ela é a mesma passada
 * de todo dia: a paginação lê os vivos antes de escrever, a abertura respeita
 * o índice único, e o resumo por provedor vai para o log.
 *
 * ── O que NÃO é decidido aqui ────────────────────────────────────────────────
 *
 * QUANDO (a janela de cada etapa) mora em `shared/cobranca/regua.ts`; COMO
 * falar (o DNA 3×3) em `shared/cobranca/dna.ts`; quais status existem e o que
 * vai para onde em `shared/cobranca/estados.ts`; o que o provedor configura em
 * `shared/cobranca/politica.ts`. Este arquivo só liga os quatro ao banco — e
 * toda mudança de status passa pelo storage, dono da trilha mecânica.
 *
 * Só o worker chama isto (ver server/worker.ts). Uma rota que queira "rodar
 * agora" pelo processo da API precisa de uma trava compartilhada (advisory
 * lock, como a cobertura geo) — o sinal `emAndamento` daqui só enxerga um
 * processo.
 */
import { storage as storageBase } from "../../storage";
import { logger } from "../../logger";
import { proximaExecucao } from "../erp-agenda";
import { carteiraDoStatusErp } from "../../storage/cobranca.storage";
import type { CandidatoACaso, DnaDoCaso, LinhaDaCarteira, PatchDeCaso } from "../../storage/cobranca.storage";
import type { CobrancaCaso } from "@shared/schema";
import { etapaParaAtraso, prescrita, resolverEtapas, type Etapa, type EtapaId } from "@shared/cobranca/regua";
import { TOM_VULNERAVEL, classificarDna, mesesDeContrato, tomEfetivo } from "@shared/cobranca/dna";
import type { Carteira, Prioridade } from "@shared/cobranca/estados";

/**
 * Contrato da frente do storage (05/09/2026), já implementado em
 * `CobrancaStorage` mas ainda não delegado por `IStorage`:
 *
 * · `cancelarCaso` leva o caso ao terminal `cancelamento` (motivo
 *   obrigatório), grava o evento `cancelamento` com o motivo e
 *   `sugerirRecuperacao: true` e desfaz a negociação viva — encerrar por
 *   qualquer motivo passa pelo storage, dono da trilha mecânica.
 * · `atualizarDnaDoCaso` grava quadrante e tom. `arbitrado: true` quer dizer
 *   "fidelidade assumida sem a data" e deixa uma nota de aviso no caso; o job
 *   NUNCA manda true — sem data, o quadrante vai nulo (ver `dnaDoCaso`).
 *
 * A assinatura mora aqui para o tsc não depender da ordem em que as duas
 * frentes chegam; quando `IStorage` delegar os dois, esta interseção é
 * redundante e sai.
 */
interface ContratoNovoDoStorage {
  cancelarCaso(providerId: number, id: number, motivo: string, userId?: number | null): Promise<CobrancaCaso | undefined>;
  atualizarDnaDoCaso(providerId: number, casoId: number, dna: DnaDoCaso, userId?: number | null): Promise<CobrancaCaso | undefined>;
}
const storage = storageBase as typeof storageBase & ContratoNovoDoStorage;

/* ── Constantes do motor ─────────────────────────────────────────────────── */

/**
 * Abaixo disto não se abre caso: é resíduo (arredondamento de juros, uma
 * diferença de centavos que o ERP arrasta), o mesmo piso que o anti-fraude usa
 * para "fatura vencida de verdade". NÃO é o `saldoMinimoParcelar` da política:
 * aquele (R$ 150 por padrão) decide se a dívida pode ser PARCELADA, e usá-lo
 * aqui deixaria fora da régua uma mensalidade de R$ 89,90 com dez dias de
 * atraso — exatamente a fatura que o lembrete existe para resolver.
 */
export const DIVIDA_MINIMA_PARA_CASO = 20;

/**
 * Parcela atrasada há MAIS de cinco dias quebra o acordo. Constante, e não
 * campo da política: o JSONB `negociacao` autorizado tem só os quatro campos
 * de parcelamento. Cinco dias absorve o fim de semana e a compensação de
 * boleto sem deixar o funcionário esperando um acordo morto por semanas.
 */
export const TOLERANCIA_QUEBRA_DE_ACORDO_DIAS = 5;

/**
 * Teto de aberturas por provedor por passada. Medido em 05/09/2026: a NG
 * sozinha abre ~7.200 casos na primeira passada (559 ativos + 6.637
 * ex-clientes); dez mil cobre a passada inteira, e o que sobrar (não deve
 * sobrar) entra na seguinte.
 */
export const LIMITE_DE_CANDIDATOS_POR_PASSADA = 10_000;

/**
 * Às 05:00, todo dia. A varredura do ERP roda às 03:00 (seg/qua/sex) e leva
 * ~30 min; às cinco a foto de `customers` já é a da madrugada, e o funcionário
 * que entra às oito encontra a fila pronta.
 */
export const HORA_DA_PASSADA = 5;

/**
 * A passada de boot espera vinte segundos, como o sync de boot espera quinze
 * e a retenção LGPD trinta: os três subindo no mesmo instante disputariam o
 * pool de conexões logo depois do `verifySchema`.
 */
export const ATRASO_DA_PASSADA_DE_BOOT_MS = 20_000;

/** Motivos gravados em `motivo_encerramento` — a tela lê estas chaves. */
export const MOTIVO_PRESCRITA = "prescrita";
export const MOTIVO_DIVIDA_ZERADA = "divida_zerada_no_sync";
/** Motivo do `cancelamento` automático — frase, como o motivo que o funcionário digita no kanban. */
export const MOTIVO_CANCELADO_NO_ERP = "contrato cancelado no ERP";

/** Limiares da prioridade sugerida. Ver `prioridadeSugerida`. */
export const VALOR_QUE_SOBE_PRIORIDADE = 1000;
export const VALOR_QUE_DESCE_PRIORIDADE = 100;

/**
 * Fase 1: não há de onde ler "vulnerável" (Lei 14.181) — nem `customers` nem
 * as cinco tabelas autorizadas têm o campo. O motor calcula o tom com
 * `false`, mas RESPEITA o tom `humanizado_vulneravel` quando já está no caso:
 * se um funcionário o marcou pela rota, o job não o sobrescreve.
 */
const VULNERAVEL_NA_FASE_1 = false;

/**
 * Status em que o ACORDO (ou a proposta na mesa) governa o caso, e não a
 * dívida do ERP. Ver o comentário em `revisarCaso`.
 */
const STATUS_GOVERNADOS_PELO_ACORDO: readonly string[] = ["negociando", "acordo_ativo"];

const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6];
const CASOS_POR_PAGINA = 200;
/** 500 páginas × 200 = 100 mil casos vivos num provedor só — muito acima da NG. Guarda contra laço infinito. */
const MAXIMO_DE_PAGINAS = 500;

/* ── Prioridade sugerida ─────────────────────────────────────────────────── */

const NIVEIS: readonly Prioridade[] = ["baixa", "normal", "alta", "critica"];

/**
 * A base vem da etapa: o aviso de suspensão tem um prazo legal correndo
 * (Anatel 765: os 15 dias contam da entrega do aviso) e a negociação é onde
 * o cliente ainda se recupera — as duas são "alta". O lembrete é cedo e
 * barato: "normal". Dívida antiga e fim de linha são campanha, não urgência.
 */
const PRIORIDADE_BASE_DA_ETAPA: Record<EtapaId, Prioridade> = {
  lembrete_pre_vencimento: "baixa",
  lembrete_atraso: "normal",
  aviso_suspensao: "alta",
  negociacao_recuperacao: "alta",
  pre_negativacao: "normal",
  divida_antiga: "baixa",
  fim_de_linha: "baixa",
};

/**
 * Prioridade por etapa e valor: a etapa dá a base, e o valor sobe um nível a
 * partir de R$ 1.000 ou desce um abaixo de R$ 100. É sugestão de abertura —
 * o funcionário muda pela rota e o job não volta a mexer.
 */
export function prioridadeSugerida(valor: number, etapa: EtapaId | null): Prioridade {
  let nivel = NIVEIS.indexOf(etapa ? PRIORIDADE_BASE_DA_ETAPA[etapa] : "normal");
  if (valor >= VALOR_QUE_SOBE_PRIORIDADE) nivel += 1;
  else if (valor < VALOR_QUE_DESCE_PRIORIDADE) nivel -= 1;
  return NIVEIS[Math.max(0, Math.min(NIVEIS.length - 1, nivel))];
}

/* ── DNA do caso ─────────────────────────────────────────────────────────── */

/**
 * O DNA com os agregados da fase 1, na forma que `atualizarDnaDoCaso` grava.
 * `historicoInsuficiente` é sempre true: sem fatura paga não há taxa de
 * atraso, e a confiabilidade sai só do atraso atual e das faturas abertas
 * (`dna.ts` explica).
 *
 * Sem a data do contrato NÃO há DNA — é a regra de `dna.ts` e a da casa (só
 * dado real). Arbitrar "médio" mandaria o funcionário ligar com o tom de
 * cliente regular para alguém de dez anos de casa, ou de dez dias. Quadrante e
 * tom ficam nulos (sem DNA e sem vulnerabilidade não há tom a sugerir): a
 * grade mostra "sem DNA (sem data de contrato no ERP)" e quem conhece o
 * cliente decide. Por isso `arbitrado` sai sempre false daqui — o job nunca
 * assume fidelidade, e a nota "o tom veio de um chute" que o storage escreve
 * para `arbitrado: true` não tem quando nascer.
 */
export function dnaDoCaso(
  cliente: { contractStartDate: string | null; diasAtraso: number; faturasAbertas: number },
  hoje: Date,
): DnaDoCaso {
  const meses = mesesDeContrato(cliente.contractStartDate, hoje);
  if (meses === null) return { quadranteDna: null, tom: null, arbitrado: false };
  const dna = classificarDna({
    mesesComoCliente: meses,
    diasAtrasoMax: cliente.diasAtraso,
    faturasAbertas: cliente.faturasAbertas,
    historicoInsuficiente: true,
  });
  return { quadranteDna: dna.quadrante, tom: tomEfetivo(dna, VULNERAVEL_NA_FASE_1), arbitrado: false };
}

/* ── Resultado ───────────────────────────────────────────────────────────── */

export interface ResultadoDoProvedor {
  providerId: number;
  /** Política pausada ou provedor que falhou inteiro: nada foi tocado. */
  pulado: boolean;
  motivo: string | null;
  abertos: number;
  /** Outro processo abriu antes (corrida no índice único): não é erro. */
  jaAbertos: number;
  naoAbertosPrescritos: number;
  etapasMudadas: number;
  valoresEspelhados: number;
  dnaAtualizados: number;
  pagos: number;
  prescritosEncerrados: number;
  /** Contrato cancelado no ERP com o caso vivo: caso levado a `cancelamento`. */
  cancelados: number;
  parcelasAtrasadas: number;
  acordosQuebrados: number;
  erros: number;
}

export type TotaisDaPassada = Omit<ResultadoDoProvedor, "providerId" | "pulado" | "motivo"> & { provedores: number; pulados: number };

export interface ResultadoDaPassada {
  iniciadoEm: Date;
  terminadoEm: Date;
  provedores: ResultadoDoProvedor[];
  totais: TotaisDaPassada;
}

function resultadoVazio(providerId: number): ResultadoDoProvedor {
  return {
    providerId, pulado: false, motivo: null,
    abertos: 0, jaAbertos: 0, naoAbertosPrescritos: 0, etapasMudadas: 0, valoresEspelhados: 0, dnaAtualizados: 0,
    pagos: 0, prescritosEncerrados: 0, cancelados: 0, parcelasAtrasadas: 0, acordosQuebrados: 0, erros: 0,
  };
}

function somarTotais(provedores: ResultadoDoProvedor[]): TotaisDaPassada {
  const t: TotaisDaPassada = {
    provedores: provedores.length, pulados: 0,
    abertos: 0, jaAbertos: 0, naoAbertosPrescritos: 0, etapasMudadas: 0, valoresEspelhados: 0, dnaAtualizados: 0,
    pagos: 0, prescritosEncerrados: 0, cancelados: 0, parcelasAtrasadas: 0, acordosQuebrados: 0, erros: 0,
  };
  for (const p of provedores) {
    if (p.pulado) t.pulados++;
    t.abertos += p.abertos; t.jaAbertos += p.jaAbertos; t.naoAbertosPrescritos += p.naoAbertosPrescritos;
    t.etapasMudadas += p.etapasMudadas; t.valoresEspelhados += p.valoresEspelhados; t.dnaAtualizados += p.dnaAtualizados;
    t.pagos += p.pagos; t.prescritosEncerrados += p.prescritosEncerrados; t.cancelados += p.cancelados;
    t.parcelasAtrasadas += p.parcelasAtrasadas; t.acordosQuebrados += p.acordosQuebrados; t.erros += p.erros;
  }
  return t;
}

/* ── Utilidades ──────────────────────────────────────────────────────────── */

/** A coluna é texto livre por decisão do schema; aqui só duas carteiras existem. */
function carteiraDaLinha(carteira: string): Carteira {
  return carteira === "ex_cliente" ? "ex_cliente" : "ativo";
}

/**
 * Dias entre uma DATE do banco ("AAAA-MM-DD") e hoje, em dias de calendário
 * locais. Sem `new Date(iso)`: ele leria a data como UTC e, em qualquer fuso
 * brasileiro, o vencimento do dia 5 viraria dia 4 à noite.
 */
function diasDesde(iso: string, hoje: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const vencimento = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((dia.getTime() - vencimento.getTime()) / 86_400_000);
}

/**
 * A pré-checagem do storage e o índice único parcial protegem a mesma coisa;
 * o índice fala em 23505 e o storage em "ja tem caso". Os dois significam
 * "outro processo chegou antes" — contado, nunca tratado como falha.
 */
function jaTinhaCaso(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === "23505" || /ja tem caso/i.test(e?.message ?? "");
}

/**
 * Todos os casos vivos do provedor, lidos ANTES de qualquer escrita. A
 * paginação é por offset sobre `valor_atual desc`; encerrar um caso no meio
 * da leitura deslocaria as páginas seguintes e pularia um vizinho.
 */
async function todosOsCasosVivos(providerId: number): Promise<LinhaDaCarteira[]> {
  const linhas: LinhaDaCarteira[] = [];
  for (let pagina = 1; pagina <= MAXIMO_DE_PAGINAS; pagina++) {
    const r = await storage.listarCasosDeCobranca(providerId, {}, { pagina, porPagina: CASOS_POR_PAGINA });
    linhas.push(...r.linhas);
    if (r.linhas.length < CASOS_POR_PAGINA || linhas.length >= r.total) break;
  }
  return linhas;
}

/* ── Abertura ────────────────────────────────────────────────────────────── */

async function abrirCaso(
  providerId: number,
  c: CandidatoACaso,
  etapas: readonly Etapa[],
  hoje: Date,
  r: ResultadoDoProvedor,
): Promise<void> {
  // Vigia da prescrição (CC art. 206 §5º I): dívida com cinco anos NUNCA
  // entra na cobrança — nem para o funcionário "só dar uma olhada".
  if (prescrita(c.diasAtraso)) {
    r.naoAbertosPrescritos++;
    return;
  }

  const decisao = etapaParaAtraso(c.diasAtraso, c.carteira, etapas);
  const etapa = decisao.etapa?.id ?? null;
  const dna = dnaDoCaso(c, hoje);

  let casoId: number;
  try {
    const caso = await storage.abrirCasoDeCobranca(providerId, {
      customerId: c.customerId,
      carteira: c.carteira,
      diasAtrasoAbertura: c.diasAtraso,
      valorAbertura: c.dividaAtual,
      etapaAtual: etapa,
      prioridade: prioridadeSugerida(c.dividaAtual, etapa),
      // Vence hoje: entra na fila como "vencido", no topo da prioridade dele.
      proximoContatoEm: hoje,
      quadranteDna: dna.quadranteDna,
      tom: dna.tom,
    });
    casoId = caso.id;
  } catch (err) {
    if (jaTinhaCaso(err)) {
      r.jaAbertos++;
      return;
    }
    throw err;
  }

  // O storage só grava `etapa_mudou` em mudança de etapa; na abertura a etapa
  // nasce junto com o caso, então o rastro é escrito aqui — é a primeira
  // linha da vida do cliente na cobrança, e a que guarda de onde o DNA saiu
  // (quadrante nulo = o ERP não deu a data do contrato).
  await storage.registrarEventoDeCobranca(providerId, {
    casoId,
    userId: null,
    tipo: "etapa_mudou",
    canal: "sistema",
    metadata: {
      abertura: true,
      de: null,
      para: etapa,
      motivoSemEtapa: decisao.motivo,
      carteira: c.carteira,
      diasAtraso: c.diasAtraso,
      valor: c.dividaAtual,
      quadrante: dna.quadranteDna,
      tom: dna.tom,
    },
    ocorridoEm: hoje,
  });
  r.abertos++;
}

/* ── Revisão dos casos vivos ─────────────────────────────────────────────── */

/**
 * Acordo com parcela atrasada há mais de `TOLERANCIA` dias é quebrado. O
 * storage faz a cascata (cancela as parcelas pendentes, devolve o caso a
 * `aberto`, grava `acordo_quebrado`). Devolve se algum acordo quebrou — o
 * chamador então revisa o caso como aberto na mesma passada, em vez de
 * deixá-lo um dia sem etapa.
 */
async function quebrarAcordoVencido(
  providerId: number,
  linha: LinhaDaCarteira,
  hoje: Date,
  r: ResultadoDoProvedor,
): Promise<boolean> {
  const negociacoes = await storage.listarNegociacoesDoCaso(providerId, linha.id);
  let quebrou = false;
  for (const n of negociacoes) {
    if (n.status !== "aceita" && n.status !== "ativa") continue;
    const maisAntiga = n.parcelamento
      .filter(p => p.status === "atrasada")
      .reduce((max, p) => Math.max(max, diasDesde(p.vencimento, hoje) ?? 0), 0);
    if (maisAntiga > TOLERANCIA_QUEBRA_DE_ACORDO_DIAS) {
      await storage.atualizarStatusDaNegociacao(providerId, n.id, "quebrada", null);
      r.acordosQuebrados++;
      quebrou = true;
    }
  }
  return quebrou;
}

/**
 * O contrato foi cancelado no ERP DEPOIS de o caso abrir como cliente ativo.
 * Decisão do dono (05/09/2026): o caso vai ao terminal `cancelamento` — não há
 * serviço a suspender nem cliente a reter, e o funcionário não pode ligar
 * oferecendo religar. O cancelamento passa pelo storage (motivo obrigatório,
 * trilha mecânica dele), que grava o evento `cancelamento` com o motivo e
 * `sugerirRecuperacao: true` — é dali que a tela oferece abrir a recuperação
 * do equipamento em /recuperacao, porque quem cancela devendo costuma ficar
 * com a ONU. O job não escreve nota nenhuma por cima: a antiga ("o caso segue
 * na carteira de ativos") descrevia um caso que continuava, e este acabou. A
 * carteira do caso NÃO muda: ele guarda a foto da abertura.
 *
 * Só carteira `ativo`: o caso de ex-cliente já nasceu com o contrato
 * cancelado, e é justamente a régua dele que cobra essa dívida. Caso governado
 * por acordo ou proposta não chega aqui (a blindagem em `revisarCaso` o
 * devolve antes): o acordo é o compromisso real do devedor e não some porque
 * o contrato acabou — cancelar é decisão do funcionário, pelo kanban.
 *
 * Idempotente porque é terminal: cancelado, o caso sai da lista de vivos e
 * nada se repete. A dívida que ficou é do storage decidir se volta como caso
 * de ex-cliente (`clientesParaAbrirCaso`) — mas não HOJE: o cliente entra em
 * `canceladosNestaPassada` e a abertura desta passada o pula, senão o
 * funcionário abriria o kanban com o card cancelado e um card novo da mesma
 * pessoa, abertos no mesmo minuto.
 */
async function cancelarPeloErp(
  providerId: number,
  linha: LinhaDaCarteira,
  r: ResultadoDoProvedor,
  canceladosNestaPassada: Set<number>,
): Promise<void> {
  await storage.cancelarCaso(providerId, linha.id, MOTIVO_CANCELADO_NO_ERP, null);
  canceladosNestaPassada.add(linha.cliente.id);
  r.cancelados++;
}

async function revisarCaso(
  providerId: number,
  linha: LinhaDaCarteira,
  etapas: readonly Etapa[],
  hoje: Date,
  r: ResultadoDoProvedor,
  canceladosNestaPassada: Set<number>,
): Promise<void> {
  const cliente = linha.cliente;

  /**
   * O ACORDO MANDA NO CASO. Enquanto há acordo ativo, a dívida no ERP não
   * descreve o caso: quem renegocia no ERP vê as faturas velhas canceladas e
   * `total_overdue_amount` cair a zero antes de a primeira parcela vencer —
   * encerrar como "pago" aí seria mentira. E reconhecer a dívida interrompe a
   * prescrição (CC art. 202 VI), então o relógio dela também não corre. O que
   * governa o caso é a parcela: cumprida encerra (`marcarParcelaPaga`),
   * atrasada demais quebra (abaixo) — e só então o caso volta à régua.
   *
   * `negociando` com a proposta na mesa é blindado do mesmo jeito: o
   * funcionário está no meio da conversa, e o ERP pode já ter cancelado as
   * faturas velhas em cima da proposta. Nem a etapa anda, nem a dívida zerada
   * encerra, nem o contrato cancelado cancela — até a proposta virar acordo ou
   * ser cancelada pelo storage (o caso volta a `aberto` e a régua o retoma).
   * Uma negociação `ativa` presa num caso `negociando` (deriva de pagar
   * parcela de proposta, já corrigida no storage) ainda é examinada pela
   * parcela: se quebrar, o caso volta agora.
   */
  if (STATUS_GOVERNADOS_PELO_ACORDO.includes(linha.status)) {
    const quebrou = await quebrarAcordoVencido(providerId, linha, hoje, r);
    if (!quebrou) return;
  }

  // Daqui em diante o caso está em `aberto`, `em_contato` (o funcionário já
  // falou e aguarda — o relógio da régua não para por isso) ou `negativado`.

  if (prescrita(cliente.diasAtraso)) {
    await storage.fecharCasoDeCobranca(providerId, linha.id, "encerrado", MOTIVO_PRESCRITA, null);
    r.prescritosEncerrados++;
    return;
  }

  // Antes do cancelamento de propósito: quem pagou tudo e cancelou o contrato
  // pagou — `pago` é o desfecho verdadeiro, e o que a recuperação em 30 dias conta.
  if (cliente.dividaAtual <= 0) {
    await storage.fecharCasoDeCobranca(providerId, linha.id, "pago", MOTIVO_DIVIDA_ZERADA, null);
    r.pagos++;
    return;
  }

  if (carteiraDaLinha(linha.carteira) === "ativo" && carteiraDoStatusErp(cliente.statusErp) === "ex_cliente") {
    await cancelarPeloErp(providerId, linha, r, canceladosNestaPassada);
    return;
  }

  const decisao = etapaParaAtraso(cliente.diasAtraso, carteiraDaLinha(linha.carteira), etapas);
  const etapa = decisao.etapa?.id ?? null;

  const patch: PatchDeCaso = {};
  if (etapa !== linha.etapaAtual) patch.etapaAtual = etapa;
  // DECIMAL vai e volta como string; meio centavo é o que separa "mudou" de "ruído de arredondamento".
  if (Math.abs(cliente.dividaAtual - linha.valorAtual) >= 0.005) patch.valorAtual = cliente.dividaAtual;

  if (Object.keys(patch).length > 0) {
    // `userId` nulo = foi o motor; o storage grava o `etapa_mudou` {de, para}.
    await storage.atualizarCasoDeCobranca(providerId, linha.id, patch, null);
    if (patch.etapaAtual !== undefined) r.etapasMudadas++;
    if (patch.valorAtual !== undefined) r.valoresEspelhados++;
  }

  // O DNA vai por `atualizarDnaDoCaso`, sempre com `arbitrado: false` (ver
  // `dnaDoCaso`). O tom de vulnerável posto pelo funcionário é respeitado
  // aqui, antes de chamar: o quadrante acompanha o atraso, o tom não. Sem
  // data de contrato o quadrante calculado é nulo, e nulo é o que se grava —
  // "sem DNA" é dado, e é o que a grade conta.
  const dna = dnaDoCaso(cliente, hoje);
  const tom = linha.tom === TOM_VULNERAVEL ? TOM_VULNERAVEL : dna.tom;
  if (dna.quadranteDna !== linha.quadranteDna || tom !== linha.tom) {
    await storage.atualizarDnaDoCaso(providerId, linha.id, { ...dna, tom }, null);
    r.dnaAtualizados++;
  }
}

/* ── A passada de um provedor ────────────────────────────────────────────── */

/**
 * Um provedor, do começo ao fim. Lança só o que impede a passada dele inteira
 * (política ilegível, banco fora); um caso ou um candidato que falha é
 * contado em `erros` e o laço segue — um cliente estranho não pode segurar os
 * outros sete mil. No fim, o resumo do provedor vai para o log: na primeira
 * passada de produção é ele que diz quantos dos ~7.200 abriram.
 */
export async function rodarReguaDoProvedor(providerId: number, hoje: Date = new Date()): Promise<ResultadoDoProvedor> {
  const r = resultadoVazio(providerId);

  const politica = await storage.getPoliticaDeCobranca(providerId);
  if (politica?.pausada) {
    r.pulado = true;
    r.motivo = politica.pausadaMotivo?.trim() || "política pausada";
    logger.info({ providerId, motivo: r.motivo }, "Régua de cobrança: provedor pausado — nada foi aberto nem movido");
    return r;
  }
  // Sem linha de política vale o catálogo inteiro; config de outra versão cai no padrão (regua.ts explica).
  const etapas = resolverEtapas(politica);

  // Parcelas ANTES dos casos: a quebra do acordo devolve o caso a `aberto`, e
  // a revisão logo abaixo já o coloca na etapa certa na mesma passada.
  const atrasadas = await storage.marcarParcelasAtrasadas(providerId, hoje);
  r.parcelasAtrasadas = atrasadas.marcadas;

  // Revisão ANTES da abertura: o que abrir agora já nasce na etapa certa e não
  // precisa ser relido; e quem foi encerrado aqui (pago, prescrito) não volta
  // como candidato — `clientesParaAbrirCaso` exclui os dois. O cancelado pelo
  // ERP é terminal e o cliente virou ex-cliente com dívida: o storage decide
  // se ele volta amanhã; hoje o job não reabre o que acabou de cancelar.
  const canceladosNestaPassada = new Set<number>();
  const casos = await todosOsCasosVivos(providerId);
  for (const caso of casos) {
    try {
      await revisarCaso(providerId, caso, etapas, hoje, r, canceladosNestaPassada);
    } catch (err) {
      r.erros++;
      logger.warn({ err, providerId, casoId: caso.id }, "Régua de cobrança: caso não pôde ser revisado");
    }
  }

  const candidatos = await storage.clientesParaAbrirCaso(providerId, DIVIDA_MINIMA_PARA_CASO, LIMITE_DE_CANDIDATOS_POR_PASSADA);
  for (const c of candidatos) {
    if (canceladosNestaPassada.has(c.customerId)) continue;
    try {
      await abrirCaso(providerId, c, etapas, hoje, r);
    } catch (err) {
      r.erros++;
      logger.warn({ err, providerId, customerId: c.customerId }, "Régua de cobrança: caso não pôde ser aberto");
    }
  }

  // `movidos` e `fechados` são as palavras do operador; os contadores finos
  // seguem junto para quem depurar a passada.
  logger.info(
    { ...r, movidos: r.etapasMudadas, fechados: r.pagos + r.prescritosEncerrados },
    "Régua de cobrança: provedor concluído",
  );
  return r;
}

/* ── A passada inteira ───────────────────────────────────────────────────── */

let emAndamento = false;

/** Há passada rodando NESTE processo. */
export function reguaEmAndamento(): boolean {
  return emAndamento;
}

/**
 * Todos os provedores, um a um. NUNCA lança: quem chama é um timer. Devolve
 * `null` quando já havia uma passada em voo — o boot às 05:00 dispara as duas
 * quase juntas, e a segunda tem de sair na hora em vez de abrir caso em cima
 * da primeira.
 */
export async function rodarReguaDiaria(hoje: Date = new Date()): Promise<ResultadoDaPassada | null> {
  if (emAndamento) {
    logger.info("Régua de cobrança: passada já em andamento — esta sai");
    return null;
  }
  emAndamento = true;
  const iniciadoEm = new Date();
  const provedores: ResultadoDoProvedor[] = [];
  try {
    const todos = await storage.getAllProviders();
    for (const p of todos) {
      // Suspenso pode voltar, e a passada é idempotente; cancelado é terminal.
      if (p.status === "cancelled") continue;
      try {
        provedores.push(await rodarReguaDoProvedor(p.id, hoje));
      } catch (err) {
        logger.warn({ err, providerId: p.id }, "Régua de cobrança: provedor falhou inteiro — os outros seguem");
        provedores.push({ ...resultadoVazio(p.id), pulado: true, motivo: "falhou", erros: 1 });
      }
    }
    const totais = somarTotais(provedores);
    logger.info(totais, "Régua de cobrança: passada concluída");
    return { iniciadoEm, terminadoEm: new Date(), provedores, totais };
  } catch (err) {
    logger.warn({ err }, "Régua de cobrança: a passada inteira falhou — a próxima tenta de novo");
    return { iniciadoEm, terminadoEm: new Date(), provedores, totais: somarTotais(provedores) };
  } finally {
    emAndamento = false;
  }
}

/* ── Agenda ──────────────────────────────────────────────────────────────── */

let ligada = false;
let timerDoBoot: ReturnType<typeof setTimeout> | null = null;
let timerDiario: ReturnType<typeof setTimeout> | null = null;

function agendarProximaPassada(): void {
  const agora = new Date();
  const proxima = proximaExecucao(agora, TODOS_OS_DIAS, HORA_DA_PASSADA);
  logger.info({ proxima: proxima.toISOString() }, "Régua de cobrança: próxima passada agendada");
  timerDiario = setTimeout(() => {
    rodarReguaDiaria()
      .catch(err => logger.warn({ err }, "Régua de cobrança: passada agendada falhou"))
      .finally(() => agendarProximaPassada());
  }, proxima.getTime() - agora.getTime());
  // Sem `unref`, o relógio de até 24h seguraria o desligamento do worker.
  timerDiario.unref?.();
}

/**
 * Liga o relógio: uma passada de boot (depois de `ATRASO_DA_PASSADA_DE_BOOT_MS`)
 * e uma por dia às `HORA_DA_PASSADA`. A de boot existe porque o worker pode
 * ter estado fora do ar às cinco; a idempotência garante que, se não esteve,
 * a passada extra não escreve nada.
 */
export function iniciarAgendaDaRegua(): void {
  if (ligada) return;
  ligada = true;
  timerDoBoot = setTimeout(() => {
    timerDoBoot = null;
    rodarReguaDiaria().catch(err => logger.warn({ err }, "Régua de cobrança: passada de boot falhou"));
  }, ATRASO_DA_PASSADA_DE_BOOT_MS);
  timerDoBoot.unref?.();
  agendarProximaPassada();
}

/** O estado é de módulo; sem isto um teste enxerga o relógio do anterior. */
export function _reiniciarReguaParaTestes(): void {
  if (timerDoBoot) clearTimeout(timerDoBoot);
  if (timerDiario) clearTimeout(timerDiario);
  timerDoBoot = null;
  timerDiario = null;
  ligada = false;
  emAndamento = false;
}
