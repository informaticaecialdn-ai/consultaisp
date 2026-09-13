/**
 * A TRILHA MECÂNICA dos casos vivos do sandbox da demonstração: a negociação
 * que a conversa promete, as mudanças de etapa da régua e o pré-aviso formal
 * antes da negativação.
 *
 * Até 12/09/2026 os casos semeados em `negociando` e `acordo_ativo` não tinham
 * nenhuma linha em `cobranca_negociacoes`: o painel do caso dizia "Nenhum
 * acordo proposto" enquanto a conversa terminava em "Acordo registrado", e a
 * linha do tempo só tinha contato e nota — nem a régua andando, nem o aviso
 * que a Súmula 359 do STJ exige antes do negativado.
 *
 * O que NÃO sai daqui: os eventos de transição de status (`negociacao_proposta`,
 * `acordo_aceito`, `negativacao`). Quem os grava é `eventosDaTransicaoNaCobranca`
 * (sandbox.service.ts); duplicá-los contaria duas propostas na linha do tempo.
 * `eventosDaNegociacao` devolve a metadata que o storage real grava nesses
 * eventos, para o semeador MESCLAR sobre a dele depois de conhecer o id da
 * negociação.
 *
 * Tudo sai das funções reais: ofertas de `ofertasDaPolitica` filtradas pelo
 * mesmo "dentro" do acordo automático (`validarNegociacao` +
 * `avaliarPedidoDeAcordo`), parcelas de `gerarParcelas`, etapas de
 * `etapaParaAtraso`, janela de contato de `janelaDoChat`. Um plano que o
 * produto recusaria falha alto aqui, com o motivo.
 *
 * Módulo puro: sem banco, sem rede, sem relógio (o `agora` entra).
 */
import { avaliarPedidoDeAcordo, ofertasDaPolitica, somarDias, type FaixaResolvida } from "@shared/cobranca/acordo";
import { feriadosDoChat, janelaDoChat } from "@shared/cobranca/automacao-chat";
import { casoFechado, type Carteira, type StatusDeCaso } from "@shared/cobranca/estados";
import { arredondar, etapasDaPolitica, gerarParcelas, validarNegociacao, type Politica } from "@shared/cobranca/politica";
import { etapaParaAtraso, etapasDaCarteira, prescrita, type Etapa, type EtapaId } from "@shared/cobranca/regua";
import type { InsertCobrancaEvento, InsertCobrancaNegociacao, InsertCobrancaParcela } from "@shared/schema";
import { dataLocal } from "../services/chat/chat-autonomia-politica";

const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

/**
 * Prazo mínimo entre o pré-aviso de negativação e a inscrição, em dias ÚTEIS
 * (Súmula 359 do STJ; CDC art. 43 §2).
 *
 * AIDEV-QUESTION: o ConsultaISP não tem este número em lugar nenhum — a régua
 * (`shared/cobranca/regua.ts`, etapa `pre_negativacao`) só diz "Só negativar
 * depois do prazo". O 10 é o piso da origem do porte da régua, o Provedor.ai
 * (`packages/policy/src/hard-limits.ts`, `NEGATIVACAO_FLOOR.diasAvisoPrevioMin`,
 * contado da entrega do aviso). Deve ir para `shared/cobranca/regua.ts` e ser
 * conferido no PATCH status=negativado? Até lá vale só para a semeadura.
 */
export const DIAS_UTEIS_ENTRE_PRE_AVISO_E_NEGATIVACAO = 10;

/** Nota do contato que registra o pré-aviso — a ação da etapa de pré-negativação, pelo canal sugerido dela. */
const NOTA_DO_PRE_AVISO = "Pré-aviso formal de negativação enviado por e-mail, com o prazo para pagar antes da inscrição.";

/** A política que a trilha lê: régua, envelope da negociação, acordo por carteira e janela de contato. */
export type PoliticaDaTrilha = Pick<Politica, "etapas" | "negociacao" | "acordo" | "janelaContato">;

/** Um caso JÁ inserido (com id), no estado final que o semeador gravou. */
export interface CasoDaTrilha {
  id: number;
  customerId: number;
  status: StatusDeCaso;
  carteira: Carteira;
  etapaAtual: EtapaId | null;
  quadranteDna: string | null;
  tom: string | null;
  abertoEm: Date;
  statusDesde: Date;
  /**
   * Só `acordo_ativo`: o instante do `negociacao_proposta` que a transição
   * gravou (o meio da conversa). `null` = o acordo nasceu aceito, sem proposta
   * antes. Nos outros status é ignorado.
   */
  propostaEm: Date | null;
  /** A dívida de hoje (`valor_atual`) — é a `valorOriginal` da negociação. */
  valorAtual: number;
  /** O atraso de HOJE (`maxDaysOverdue`), como a régua lê. */
  diasAtraso: number;
}

export interface EntradaDaTrilha {
  providerId: number;
  adminId: number;
  politica: PoliticaDaTrilha;
  casos: CasoDaTrilha[];
  agora: Date;
}

export interface NegociacaoDaTrilha {
  casoId: number;
  linha: InsertCobrancaNegociacao;
  /** Na ordem de inserção; `negociacaoId` entra com o id devolvido pelo insert da `linha`. */
  parcelas: Array<Omit<InsertCobrancaParcela, "negociacaoId">>;
  /** O que o registro da proposta guarda e a linha não tem. */
  carteira: Carteira;
  faixa: FaixaResolvida | null;
  /** Acordo que nasceu aceito (POST com `aceita`), sem proposta antes. */
  aceitaNaCriacao: boolean;
}

export interface TrilhaDosCasos {
  negociacoes: NegociacaoDaTrilha[];
  /** `etapa_mudou` de todo caso vivo e o `contato` do pré-aviso de todo negativado, em ordem por caso. */
  eventos: InsertCobrancaEvento[];
}

/**
 * AIDEV-NOTE: não há `preAvisos` na saída. `cobranca_pre_avisos` é a fila do
 * PREVENTIVO (D-7/D-3/D-1 de fatura a vencer de cliente ativo sem dívida —
 * migração 0035, `CHECK (dias_atraso IN (-7, -3, -1))`); o pré-aviso de
 * negativação não mora lá. No produto ele é a ação da etapa `pre_negativacao`,
 * registrada como contato pelo funcionário (POST /casos/:id/eventos).
 */
export function trilhaDosCasos(entrada: EntradaDaTrilha): TrilhaDosCasos {
  const etapas = etapasDaPolitica(entrada.politica);
  const negociacoes: NegociacaoDaTrilha[] = [];
  const eventos: InsertCobrancaEvento[] = [];

  for (const caso of entrada.casos) {
    if (casoFechado(caso.status)) continue;
    // CC art. 206 §5º I: dívida prescrita não se cobra, não se negocia por
    // iniciativa do credor e não se negativa — a régua encerra o caso na
    // primeira passada (`revisarCaso`). Caso vivo assim é deriva do plano.
    if (prescrita(caso.diasAtraso)) {
      throw new Error(`trilhaDosCasos: caso ${caso.id} (${caso.status}) com ${caso.diasAtraso} dias de atraso — divida prescrita nao fica viva`);
    }
    const doCaso = eventosDeEtapa(entrada, caso, etapas);
    if (caso.status === "negativado") doCaso.push(preAvisoDaNegativacao(entrada, caso));
    if (caso.status === "negociando" || caso.status === "acordo_ativo") negociacoes.push(negociacaoDoCaso(entrada, caso));

    for (const e of doCaso) {
      const t = (e.ocorridoEm as Date).getTime();
      if (t < caso.abertoEm.getTime() || t > entrada.agora.getTime()) {
        throw new Error(`trilhaDosCasos: ${e.tipo} do caso ${caso.id} em ${(e.ocorridoEm as Date).toISOString()} fora da vida do caso (aberto em ${caso.abertoEm.toISOString()}, agora ${entrada.agora.toISOString()})`);
      }
    }
    eventos.push(...doCaso.sort((a, b) => (a.ocorridoEm as Date).getTime() - (b.ocorridoEm as Date).getTime()));
  }
  return { negociacoes, eventos };
}

/* ── Régua ────────────────────────────────────────────────────────────── */

/** O atraso num instante do passado, pela mesma conta que o semeador usa para `diasAtrasoAbertura`. */
function atrasoEm(caso: Pick<CasoDaTrilha, "diasAtraso">, instante: Date, agora: Date): number {
  return caso.diasAtraso - Math.floor((agora.getTime() - instante.getTime()) / DIA_MS);
}

/** O instante em que o atraso do caso chegou a `dias` — a abertura mais dias inteiros. */
function instanteDoAtraso(caso: Pick<CasoDaTrilha, "abertoEm" | "diasAtraso">, dias: number, agora: Date): Date {
  return new Date(caso.abertoEm.getTime() + (dias - atrasoEm(caso, caso.abertoEm, agora)) * DIA_MS);
}

/**
 * O que a régua diária deixa: na abertura, o `etapa_mudou` com a foto do caso
 * (`abrirCaso` em regua-diaria.service.ts); a cada virada de faixa, o
 * `{ de, para }` de `atualizarCasoDeCobranca`. `userId` nulo = foi o motor.
 */
function eventosDeEtapa(entrada: EntradaDaTrilha, caso: CasoDaTrilha, etapas: readonly Etapa[]): InsertCobrancaEvento[] {
  const { providerId, agora } = entrada;
  const base = { providerId, casoId: caso.id, customerId: caso.customerId, userId: null, tipo: "etapa_mudou", canal: "sistema" };
  const diasNaAbertura = atrasoEm(caso, caso.abertoEm, agora);
  const decisao = etapaParaAtraso(diasNaAbertura, caso.carteira, etapas);
  let atual: EtapaId | null = decisao.etapa?.id ?? null;
  const eventos: InsertCobrancaEvento[] = [{
    ...base,
    metadata: {
      abertura: true, de: null, para: atual, motivoSemEtapa: decisao.motivo, carteira: caso.carteira,
      diasAtraso: diasNaAbertura, valor: caso.valorAtual, quadrante: caso.quadranteDna, tom: caso.tom,
    },
    ocorridoEm: caso.abertoEm,
  }];
  for (let dias = diasNaAbertura + 1; dias <= caso.diasAtraso; dias++) {
    const para = etapaParaAtraso(dias, caso.carteira, etapas).etapa?.id ?? null;
    if (para === atual) continue;
    eventos.push({ ...base, metadata: { de: atual, para }, ocorridoEm: instanteDoAtraso(caso, dias, agora) });
    atual = para;
  }
  if (atual !== caso.etapaAtual) {
    throw new Error(`trilhaDosCasos: caso ${caso.id} gravado na etapa ${caso.etapaAtual}, mas a regua poe ${atual} para ${caso.diasAtraso} dias de atraso`);
  }
  return eventos;
}

/* ── Pré-aviso de negativação ─────────────────────────────────────────── */

/**
 * O pré-aviso vai quando o caso entra na pré-negativação (ou na abertura, se
 * ele já abriu depois dela), na primeira hora dentro da janela de contato da
 * política — é um contato, e o CDC art. 42 vale para ele.
 */
function instanteDoPreAviso(
  caso: Pick<CasoDaTrilha, "id" | "carteira" | "abertoEm" | "diasAtraso">,
  politica: PoliticaDaTrilha,
  agora: Date,
): Date {
  const pre = etapasDaCarteira(caso.carteira, etapasDaPolitica(politica)).find((e) => e.id === "pre_negativacao");
  if (!pre) throw new Error(`trilhaDosCasos: caso ${caso.id} negativado sem etapa de pre-negativacao ativa na carteira ${caso.carteira}`);
  if (caso.diasAtraso < pre.diaMin) {
    throw new Error(`trilhaDosCasos: caso ${caso.id} negativado com ${caso.diasAtraso} dias, antes da pre-negativacao (D+${pre.diaMin}) — negativar exige o pre-aviso da etapa (Sumula 359 do STJ)`);
  }
  const desde = atrasoEm(caso, caso.abertoEm, agora) >= pre.diaMin ? caso.abertoEm : instanteDoAtraso(caso, pre.diaMin, agora);
  const em = primeiraHoraNaJanela(desde, politica.janelaContato);
  if (em.getTime() > agora.getTime()) {
    throw new Error(`trilhaDosCasos: pre-aviso do caso ${caso.id} so caberia na janela de contato em ${em.toISOString()}, depois de agora`);
  }
  return em;
}

function primeiraHoraNaJanela(desde: Date, janela: PoliticaDaTrilha["janelaContato"]): Date {
  let t = desde;
  // Quinze dias de horas cobre qualquer janela válida, com sábado, domingo e feriado emendados.
  for (let i = 0; i < 15 * 24; i++) {
    if (janelaDoChat(t, janela).permitida) return t;
    t = new Date((Math.floor(t.getTime() / HORA_MS) + 1) * HORA_MS);
  }
  throw new Error(`trilhaDosCasos: nenhuma hora dentro da janela de contato em 15 dias a partir de ${desde.toISOString()}`);
}

function diaUtil(dia: string): boolean {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return semana >= 1 && semana <= 5 && !feriadosDoChat(Number(dia.slice(0, 4))).includes(dia);
}

/**
 * O primeiro instante em que o caso pode estar negativado: o começo (00:00 de
 * São Paulo) do 10º dia útil depois do dia do pré-aviso. O semeador chama isto
 * para escolher `abertoEm`/`statusDesde` do negativado — nunca replica a regra.
 */
export function primeiraNegativacaoPermitida(
  caso: Pick<CasoDaTrilha, "id" | "carteira" | "abertoEm" | "diasAtraso">,
  politica: PoliticaDaTrilha,
  agora: Date,
): Date {
  let dia = dataLocal(instanteDoPreAviso(caso, politica, agora));
  for (let uteis = 0; uteis < DIAS_UTEIS_ENTRE_PRE_AVISO_E_NEGATIVACAO;) {
    dia = somarDias(dia, 1);
    if (diaUtil(dia)) uteis++;
  }
  return new Date(`${dia}T00:00:00-03:00`);
}

/** O contato no formato do POST /casos/:id/eventos: canal da etapa, sem resultado nem metadata. */
function preAvisoDaNegativacao(entrada: EntradaDaTrilha, caso: CasoDaTrilha): InsertCobrancaEvento {
  const { providerId, adminId, politica, agora } = entrada;
  const em = instanteDoPreAviso(caso, politica, agora);
  const permitida = primeiraNegativacaoPermitida(caso, politica, agora);
  if (caso.statusDesde.getTime() < permitida.getTime()) {
    throw new Error(`trilhaDosCasos: caso ${caso.id} negativado em ${caso.statusDesde.toISOString()}, a menos de ${DIAS_UTEIS_ENTRE_PRE_AVISO_E_NEGATIVACAO} dias uteis do pre-aviso de ${em.toISOString()} (Sumula 359 do STJ; CDC art. 43 §2) — primeira data permitida ${permitida.toISOString()}`);
  }
  return {
    providerId, casoId: caso.id, customerId: caso.customerId, userId: adminId,
    tipo: "contato", canal: "email", resultado: null, notas: NOTA_DO_PRE_AVISO, metadata: null, ocorridoEm: em,
  };
}

/* ── Negociação ───────────────────────────────────────────────────────── */

const dinheiro = (v: number): string => v.toFixed(2);

/**
 * A negociação do caso, como a rota POST /negociacoes a registraria no dia da
 * proposta: a oferta da política DENTRO da faixa (sem exceção a aprovar),
 * com o primeiro vencimento no fim da janela do credor — o mais longe que a
 * política deixa, para a parcela não vencer na frente do visitante. Parcelado
 * quando a faixa permite; senão, à vista.
 *
 * Proposta fica `proposta`. Acordo parcelado fica `ativa`, com a entrada paga
 * no aceite (é a entrada que leva aceita → ativa em `marcarParcelaPaga`);
 * acordo à vista fica `aceita`, com a única parcela a vencer.
 */
function negociacaoDoCaso(entrada: EntradaDaTrilha, caso: CasoDaTrilha): NegociacaoDaTrilha {
  const { providerId, adminId, politica, agora } = entrada;
  const acordo = caso.status === "acordo_ativo";
  const propostaEm = acordo ? caso.propostaEm ?? caso.statusDesde : caso.statusDesde;
  const aceitaEm = acordo ? caso.statusDesde : null;
  if (propostaEm.getTime() < caso.abertoEm.getTime() || (aceitaEm && aceitaEm.getTime() < propostaEm.getTime())) {
    throw new Error(`trilhaDosCasos: caso ${caso.id} com proposta em ${propostaEm.toISOString()} fora da ordem abertura -> proposta -> aceite`);
  }

  const hoje = dataLocal(propostaEm);
  const diasAtraso = atrasoEm(caso, propostaEm, agora);
  const { ofertas } = ofertasDaPolitica({
    saldo: caso.valorAtual, diasAtraso, carteira: caso.carteira, hoje,
    primeiroVencimento: somarDias(hoje, politica.acordo[caso.carteira].janelaVencimentoDias),
  }, politica);
  const dentro = ofertas.flatMap((oferta) => {
    const pedido = {
      tipo: oferta.tipo === "parcelado" ? "parcelamento" as const : "quitacao_desconto" as const,
      valorOriginal: caso.valorAtual, valorNegociado: oferta.valor, entrada: oferta.entrada, parcelas: oferta.parcelas,
    };
    const decisao = avaliarPedidoDeAcordo({ ...pedido, carteira: caso.carteira, diasAtraso }, politica);
    return validarNegociacao(politica, pedido, { vulneravel: false }).ok && decisao.decisao === "dentro"
      ? [{ pedido, faixa: decisao.faixa, primeiroVencimento: oferta.vencimentos[0] }]
      : [];
  });
  const escolhida = dentro.find((d) => d.pedido.tipo === "parcelamento") ?? dentro[0];
  if (!escolhida) throw new Error(`trilhaDosCasos: nenhuma oferta dentro da politica para o caso ${caso.id} (${caso.valorAtual} com ${diasAtraso} dias)`);

  const { pedido, primeiroVencimento } = escolhida;
  const geradas = pedido.tipo === "parcelamento"
    ? gerarParcelas(pedido.valorNegociado, pedido.parcelas, pedido.entrada, primeiroVencimento)
    : [{ numero: 1, valor: arredondar(pedido.valorNegociado), vencimento: primeiroVencimento }];
  const entradaPaga = acordo && pedido.entrada > 0;
  const status = !acordo ? "proposta" : entradaPaga ? "ativa" : "aceita";

  const parcelas: NegociacaoDaTrilha["parcelas"] = [
    ...(pedido.entrada > 0
      ? [entradaPaga
        ? { providerId, numero: 0, valor: dinheiro(pedido.entrada), vencimento: primeiroVencimento, status: "paga", pagoEm: aceitaEm, valorPago: dinheiro(pedido.entrada) }
        : { providerId, numero: 0, valor: dinheiro(pedido.entrada), vencimento: primeiroVencimento, status: "pendente" }]
      : []),
    ...geradas.map((p) => ({ providerId, numero: p.numero, valor: dinheiro(p.valor), vencimento: p.vencimento, status: "pendente" })),
  ];
  const hojeDeVerdade = dataLocal(agora);
  for (const p of parcelas) {
    if (p.status === "pendente" && p.vencimento <= hojeDeVerdade) {
      throw new Error(`trilhaDosCasos: parcela ${p.numero} do caso ${caso.id} vence em ${p.vencimento}, nao depois de hoje (${hojeDeVerdade}) — a regua a marcaria atrasada e quebraria o acordo`);
    }
  }

  return {
    casoId: caso.id,
    linha: {
      providerId, casoId: caso.id, customerId: caso.customerId, tipo: pedido.tipo,
      valorOriginal: dinheiro(caso.valorAtual), valorNegociado: dinheiro(pedido.valorNegociado),
      // A mesma conta da rota: desconto efetivo, nunca negativo.
      descontoPct: dinheiro(Math.max(0, arredondar(((caso.valorAtual - pedido.valorNegociado) / caso.valorAtual) * 100))),
      entrada: dinheiro(pedido.entrada), parcelas: geradas.length, valorParcela: dinheiro(geradas[0].valor),
      primeiroVencimento, status, criadoPorUserId: adminId, aceitaEm, quebradaEm: null,
      createdAt: propostaEm, updatedAt: aceitaEm ?? propostaEm,
    },
    parcelas,
    carteira: caso.carteira,
    faixa: escolhida.faixa,
    aceitaNaCriacao: acordo && caso.propostaEm === null,
  };
}

export interface EventosDaNegociacao {
  /** Mesclar sobre a metadata do `negociacao_proposta` do caso; `null` = o acordo nasceu aceito, sem proposta. */
  metadataDaProposta: Record<string, unknown> | null;
  /** Mesclar sobre a metadata do `acordo_aceito` do caso; `null` = ainda é proposta. */
  metadataDoAceite: Record<string, unknown> | null;
  /** Eventos novos (o `parcela_paga` da entrada), para inserir junto com os demais. */
  eventos: InsertCobrancaEvento[];
}

/**
 * O que só pode ser escrito DEPOIS do insert, porque carrega os ids: a
 * metadata que `criarNegociacao`/`atualizarStatusDaNegociacao` gravam e o
 * `parcela_paga` de `marcarParcelaPaga`. Sem o registro com
 * `versaoAprovacao: 1, exigeAprovacao: false`, o portão do aceite trataria a
 * proposta semeada como exceção e só um administrador conseguiria aceitá-la.
 *
 * `parcelaIds` na mesma ordem de `negociacao.parcelas`.
 */
export function eventosDaNegociacao(
  negociacao: NegociacaoDaTrilha,
  ids: { negociacaoId: number; parcelaIds: number[] },
): EventosDaNegociacao {
  const { linha, parcelas } = negociacao;
  if (ids.parcelaIds.length !== parcelas.length) {
    throw new Error(`eventosDaNegociacao: ${ids.parcelaIds.length} ids para ${parcelas.length} parcelas do caso ${negociacao.casoId}`);
  }
  const entrada = Number(linha.entrada);
  const registro = {
    negociacaoId: ids.negociacaoId, tipo: linha.tipo,
    valorNegociado: Number(linha.valorNegociado), parcelas: linha.parcelas,
    versaoAprovacao: 1, exigeAprovacao: false, motivos: [], faixa: negociacao.faixa, carteira: negociacao.carteira,
    entrada: entrada > 0 ? { numero: 0, valor: entrada, vencimento: linha.primeiroVencimento, origem: "acordo", recebimentoConfirmado: false } : null,
  };
  const proposta = linha.status === "proposta";
  return {
    metadataDaProposta: negociacao.aceitaNaCriacao ? null : registro,
    metadataDoAceite: proposta
      ? null
      : negociacao.aceitaNaCriacao
        ? registro
        : { negociacaoId: ids.negociacaoId, status: "aceita", aprovacaoConferida: true, aprovadoPorUserId: linha.criadoPorUserId },
    eventos: parcelas.flatMap((p, i) => p.status !== "paga" ? [] : [{
      providerId: linha.providerId, casoId: linha.casoId, customerId: linha.customerId, userId: linha.criadoPorUserId,
      tipo: "parcela_paga",
      metadata: {
        negociacaoId: ids.negociacaoId, parcelaId: ids.parcelaIds[i], numero: p.numero,
        valorPago: Number(p.valorPago), acumulado: Number(p.valorPago), parcial: false,
        origem: "confirmacao_operador", recebimentoConfirmado: true,
      },
      ocorridoEm: p.pagoEm as Date,
    }]),
  };
}
