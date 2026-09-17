import { createHash } from "crypto";
import { validarCPF } from "../../utils/cpf-cnpj-validator";
import type { VinculoIdentidade, EstadoIdentidade } from "@shared/chat-autonomia";
import {
  classificarMensagemPreIdentidade, decidirPreIdentidade, MAX_TOKENS_DE_DIGITOS,
  type CategoriaPreIdentidade, type DecisaoDaTriagem,
} from "@shared/chat-funcionaria-triagem";
import { textoPreIdentidade, type DadosDaConversa, type SituacaoPreIdentidade } from "@shared/chat-funcionaria-textos";
export type { VinculoIdentidade, EstadoIdentidade } from "@shared/chat-autonomia";

/**
 * Identidade do cliente no chat (spec 2026-09-16, D10 e §3.2). Desafio determinístico do SERVIDOR: o modelo
 * nunca confirma identidade nem recebe o documento.
 *
 * O que mudou, e por quê:
 * - Só os 4 últimos dígitos do CPF. O nome saiu (f6): o primeiro nome já vai na abertura, o sobrenome é da
 *   família que segura o telefone, e a grafia (Souza/Sousa) reprovava o titular.
 * - Os dígitos são TOKENS de exatamente 4 dígitos (e7). Antes juntava todos os dígitos da mensagem: "Maria
 *   Souza 8909, pago dia 20" virava "890920", gastava a tentativa e perdia a intenção.
 * - A 1ª mensagem já confirma: a abertura é o desafio.
 * - Tentativas contam por CLIENTE, em janela (3 em 24 h, 5 em 30 dias), e não somem quando o atendente
 *   devolve a conversa nem quando a régua abre outra (s7). O histórico mora no próprio estado
 *   (`tentativasEm`, JSONB, sem migração); quem soma as conversas é o storage.
 * - A confirmação vale pelo EPISÓDIO: expira depois de 6 h sem mensagem do cliente, com teto de 24 h (f4).
 *   Antes eram 15 min fixos, e quem respondia depois do almoço levava o desafio de novo.
 * - Aceite de ACORDO exige confirmação de no máximo 2 h (`exigirIdentidadeRecente`): é o que vira base de
 *   cobrança e de confissão de dívida.
 */
export const LIMITES_DA_IDENTIDADE = {
  tentativasEm24h: 3,
  tentativasEm30Dias: 5,
  episodioSemMensagemMs: 6 * 60 * 60_000,
  tetoDoEpisodioMs: 24 * 60 * 60_000,
  recenciaParaAcordoMs: 2 * 60 * 60_000,
} as const;
const DIA_MS = 24 * 60 * 60_000;

/**
 * O estado gravado ganha o histórico das tentativas (instantes ISO). Opcional: estados antigos não o têm.
 * `tentativasDeOutrosClientes` guarda, por customerId, as tentativas de quem ocupava ESTA conversa antes de
 * um operador revinculá-la a outro cliente (correção 2): sem isso a linha era sobrescrita e as tentativas do
 * cliente anterior sumiam da contagem por cliente — 3 chutes a mais a cada revinculação.
 */
export interface EstadoIdentidadeDoEpisodio extends EstadoIdentidade {
  tentativasEm?: string[];
  tentativasDeOutrosClientes?: Record<string, string[]>;
}
export interface TentativasDoCliente { em24h: number; em30Dias: number }

const normalizarNome = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").trim().replace(/\s+/g, " ");
const instante = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** Os instantes das tentativas de um estado. Estado antigo só tem a contagem: vale como se todas fossem no último desafio. */
function instantesDasTentativas(estado: EstadoIdentidade | null | undefined): string[] {
  if (!estado) return [];
  const historico = (estado as EstadoIdentidadeDoEpisodio).tentativasEm;
  if (Array.isArray(historico)) return historico.filter(t => typeof t === "string" && Number.isFinite(Date.parse(t)));
  const n = Number.isInteger(estado.tentativas) && estado.tentativas > 0 ? Math.min(estado.tentativas, LIMITES_DA_IDENTIDADE.tentativasEm30Dias) : 0;
  return Number.isFinite(instante(estado.desafiadaEm)) ? Array.from({ length: n }, () => estado.desafiadaEm) : [];
}

/** No máximo quantos clientes anteriores uma conversa guarda (os de tentativa mais recente ficam). */
const MAX_CLIENTES_ANTERIORES = 20;
const noPeriodo = (instantes: readonly string[], agora: Date) =>
  instantes.filter(t => typeof t === "string" && Number.isFinite(Date.parse(t)) && agora.getTime() - Date.parse(t) < 30 * DIA_MS);

/** As tentativas de clientes anteriores desta conversa, válidas e dentro de 30 dias. */
function tentativasAnteriores(estado: EstadoIdentidade | null | undefined, agora: Date): Record<string, string[]> {
  const guardadas = (estado as EstadoIdentidadeDoEpisodio | null | undefined)?.tentativasDeOutrosClientes;
  const saida: Record<string, string[]> = {};
  if (!guardadas || typeof guardadas !== "object" || Array.isArray(guardadas)) return saida;
  for (const [cliente, instantes] of Object.entries(guardadas)) {
    if (!/^[0-9]+$/.test(cliente) || !Array.isArray(instantes)) continue;
    const validos = noPeriodo(instantes, agora);
    if (validos.length) saida[cliente] = validos;
  }
  return saida;
}

/**
 * A conversa foi revinculada a outro cliente do MESMO provedor: as tentativas de quem estava nela vão para
 * `tentativasDeOutrosClientes`, e as do cliente atual (se ele já esteve nesta conversa) voltam a ser o
 * histórico principal. Estado de outro provedor não deixa nada — nem é lido.
 */
function historicoAoTrocarDeCliente(estado: EstadoIdentidade, customerId: number, agora: Date): { historico: string[]; outros: Record<string, string[]> } {
  const outros = tentativasAnteriores(estado, agora);
  const anterior = String(estado.customerId);
  const doAnterior = noPeriodo(instantesDasTentativas(estado), agora);
  // sem deduplicar: dois palpites na mesma mensagem têm o mesmo instante e são duas tentativas
  if (doAnterior.length) outros[anterior] = [...(outros[anterior] ?? []), ...doAnterior];
  const atual = String(customerId);
  const historico = outros[atual] ?? [];
  delete outros[atual];
  const ultima = (instantes: string[]) => Math.max(...instantes.map(t => Date.parse(t)));
  const recentes = Object.entries(outros).sort((x, y) => ultima(y[1]) - ultima(x[1])).slice(0, MAX_CLIENTES_ANTERIORES);
  return { historico, outros: Object.fromEntries(recentes) };
}

/** Quantas tentativas erradas caem em 24 h e em 30 dias. Instante no futuro conta (relógio torto não zera o limite). */
export function contarTentativas(instantes: readonly string[], agora = new Date()): TentativasDoCliente {
  const t = agora.getTime();
  let em24h = 0, em30Dias = 0;
  for (const iso of instantes) {
    const idade = t - Date.parse(iso);
    if (!Number.isFinite(idade)) continue;
    if (idade < DIA_MS) em24h++;
    if (idade < 30 * DIA_MS) em30Dias++;
  }
  return { em24h, em30Dias };
}

/**
 * Soma as tentativas do MESMO cliente em todas as conversas do provedor (o storage lê as linhas; aqui só se
 * conta). Linha de outro cliente ou de outro provedor não entra, mesmo que o filtro do banco falhe.
 */
export function tentativasDosEstados(estados: readonly (EstadoIdentidade | null | undefined)[], providerId: number, customerId: number, agora = new Date()): TentativasDoCliente {
  const instantes = estados.filter(e => e && e.providerId === providerId).flatMap(e => e!.customerId === customerId
    ? instantesDasTentativas(e)
    // conversa que hoje é de outro cliente, mas guardou as tentativas deste (revinculação)
    : tentativasAnteriores(e, agora)[String(customerId)] ?? []);
  return contarTentativas(instantes, agora);
}

export const tentativasEsgotadas = (t: TentativasDoCliente) =>
  t.em24h >= LIMITES_DA_IDENTIDADE.tentativasEm24h || t.em30Dias >= LIMITES_DA_IDENTIDADE.tentativasEm30Dias;

/** A confirmação ainda vale: dentro do episódio (6 h desde a última mensagem do cliente) e do teto de 24 h. */
export function identidadeVigente(estado: EstadoIdentidade | null | undefined, agora = new Date()): boolean {
  if (!estado?.confirmadaEm || !estado.validaAte) return false;
  const confirmada = instante(estado.confirmadaEm), valida = instante(estado.validaAte), t = agora.getTime();
  return Number.isFinite(confirmada) && Number.isFinite(valida) && confirmada <= t && valida > t && t - confirmada < LIMITES_DA_IDENTIDADE.tetoDoEpisodioMs;
}

/**
 * Renova o episódio a cada mensagem do cliente: vale mais 6 h a partir de agora, nunca além de 24 h da
 * confirmação. Estado não vigente volta como veio — renovar não ressuscita confirmação vencida.
 */
export function renovarEpisodio<T extends EstadoIdentidade>(estado: T, agora = new Date()): T {
  if (!identidadeVigente(estado, agora)) return estado;
  const teto = instante(estado.confirmadaEm) + LIMITES_DA_IDENTIDADE.tetoDoEpisodioMs;
  const validaAte = Math.min(agora.getTime() + LIMITES_DA_IDENTIDADE.episodioSemMensagemMs, teto);
  return { ...estado, validaAte: new Date(validaAte).toISOString() };
}

/**
 * Aceite de ACORDO (D10, s7): a confirmação precisa ter no máximo 2 h — e continuar vigente. Um "sim" de
 * acordo vira base de cobrança; o aparelho pode ter mudado de mão desde a manhã. `false` = pedir os
 * dígitos de novo (`pedirIdentidadeDeNovo`) antes de gravar.
 */
export function exigirIdentidadeRecente(estado: EstadoIdentidade | null | undefined, agora = new Date(), janelaMs: number = LIMITES_DA_IDENTIDADE.recenciaParaAcordoMs): boolean {
  if (!identidadeVigente(estado, agora)) return false;
  const idade = agora.getTime() - instante(estado!.confirmadaEm);
  return idade >= 0 && idade <= janelaMs;
}

/** Desfaz a confirmação para um novo desafio, mantendo o histórico de tentativas (que é do cliente, não da conversa). */
export function pedirIdentidadeDeNovo<T extends EstadoIdentidade>(estado: T, agora = new Date()): T {
  return { ...estado, confirmadaEm: null, validaAte: null, desafiadaEm: agora.toISOString() };
}

export interface OpcoesDaIdentidade {
  agora?: Date;
  /**
   * Tentativas erradas do MESMO cliente em todas as conversas (`segurancaAutonomiaStorage.tentativasDoCliente`).
   * Ausente: conta só o histórico desta conversa — o limite continua valendo, só não atravessa conversas.
   */
  tentativasDoCliente?: TentativasDoCliente | null;
  /** Nomes para a frase do servidor (persona, provedor, primeiro nome do cliente, canal oficial). */
  dados?: DadosDaConversa;
}

export type AcaoDaIdentidade = "confirmada" | "desafiar" | "humano" | "ignorar";
export interface ResultadoDaIdentidade {
  /**
   * confirmada: segue a rodada (recém-confirmada ou vigente); desafiar: responde a frase e espera; humano: a
   * conversa vai à equipe (com a frase de `situacao` quando houver — número errado, parar, contestação,
   * tentativas esgotadas — ou com o aviso neutro de `decisao.aviso`); ignorar: não responde nem transfere.
   */
  acao: AcaoDaIdentidade;
  /** A frase do servidor (`textoPreIdentidade`) que cabe nesta rodada; null quando não há frase. */
  situacao: SituacaoPreIdentidade | null;
  /** A categoria da triagem desta mensagem (null quando a identidade já estava vigente). */
  triagem: CategoriaPreIdentidade | null;
  decisao: DecisaoDaTriagem | null;
  /** Confirmou NESTA mensagem: o planejador recebe `identidadeRecemConfirmada` e a mensagem segue como intenção. */
  recemConfirmada: boolean;
  tentativaGasta: boolean;
  motivo: "cadastro_incompleto" | "tentativas_esgotadas" | null;
  estado: EstadoIdentidade | null;
  /** A frase pronta (balões unidos por linha em branco). Vazia quando não há o que dizer. */
  mensagem: string;
}

/**
 * Avalia a mensagem do cliente antes (ou durante) a identidade. Ordem: identidade vigente → triagem que
 * precede os dígitos (terceiro, número errado, parar, contestação, pessoa, jurídico, vulnerabilidade, mídia)
 * → limite de tentativas → dígitos → pergunta/robô/golpe/re-pedido. Terceiro declarado nunca confirma, nem
 * com os dígitos certos, e não gasta tentativa.
 */
export function avaliarIdentidade(
  estado: EstadoIdentidade | null,
  vinculo: VinculoIdentidade,
  cadastro: { nome: string; documento: string },
  texto: string,
  messageId: string,
  opcoesOuAgora: Date | OpcoesDaIdentidade = {},
): ResultadoDaIdentidade {
  const opcoes: OpcoesDaIdentidade = opcoesOuAgora instanceof Date ? { agora: opcoesOuAgora } : opcoesOuAgora;
  const agora = opcoes.agora ?? new Date();
  const base = { situacao: null, triagem: null, decisao: null, recemConfirmada: false, tentativaGasta: false, motivo: null, mensagem: "" } as const;
  const documento = cadastro.documento.replace(/\D/g, "");
  const nome = normalizarNome(cadastro.nome);
  // Cadastro incompleto derruba a confirmação, mas NÃO o histórico de tentativas: o serviço grava este
  // estado, e `null` aqui apagava as tentativas da conversa (correção 2).
  if (!validarCPF(documento) || !/^55\d{10,11}$/.test(vinculo.telefone)) {
    return { ...base, acao: "humano", motivo: "cadastro_incompleto", estado: estado ? { ...estado, confirmadaEm: null, validaAte: null } : null };
  }

  const cadastroHash = createHash("sha256").update(`${nome}:${documento}`).digest("hex");
  const mesmoCliente = !!estado && estado.providerId === vinculo.providerId && estado.customerId === vinculo.customerId;
  const mesmoVinculo = mesmoCliente && estado!.conversationId === vinculo.conversationId && estado!.telefone === vinculo.telefone && estado!.cadastroHash === cadastroHash;

  if (mesmoVinculo && identidadeVigente(estado, agora)) {
    const renovado = estado!.ultimaMensagemId === messageId ? estado! : { ...renovarEpisodio(estado!, agora), ultimaMensagemId: messageId };
    return { ...base, acao: "confirmada", estado: renovado };
  }

  const mesmoProvedor = !!estado && estado.providerId === vinculo.providerId;
  const { historico, outros } = mesmoCliente
    ? { historico: noPeriodo(instantesDasTentativas(estado), agora), outros: tentativasAnteriores(estado, agora) }
    : mesmoProvedor ? historicoAoTrocarDeCliente(estado!, vinculo.customerId, agora) : { historico: [] as string[], outros: {} };
  const local = contarTentativas(historico, agora);
  const doStorage = opcoes.tentativasDoCliente;
  const contagem = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const tentativas: TentativasDoCliente = doStorage
    ? { em24h: Math.max(contagem(doStorage.em24h), local.em24h), em30Dias: Math.max(contagem(doStorage.em30Dias), local.em30Dias) }
    : local;
  const novo: EstadoIdentidadeDoEpisodio = {
    ...vinculo, cadastroHash, tentativas: tentativas.em24h,
    desafiadaEm: mesmoVinculo && Number.isFinite(instante(estado!.desafiadaEm)) ? estado!.desafiadaEm : agora.toISOString(),
    ultimaMensagemId: messageId, confirmadaEm: null, validaAte: null, tentativasEm: historico,
    ...(Object.keys(outros).length ? { tentativasDeOutrosClientes: outros } : {}),
  };
  const frase = (situacao: SituacaoPreIdentidade | null): string => {
    if (!situacao) return "";
    const baloes = textoPreIdentidade(situacao, { ...opcoes.dados, funcionariaJaFalou: opcoes.dados?.funcionariaJaFalou ?? !!estado }, { conversationId: vinculo.conversationId });
    return baloes.aprovada === false ? "" : baloes.join("\n\n");
  };
  const responder = (acao: AcaoDaIdentidade, situacao: SituacaoPreIdentidade | null, extra: Partial<ResultadoDaIdentidade> = {}): ResultadoDaIdentidade =>
    ({ ...base, acao, situacao, estado: novo, mensagem: frase(situacao), ...extra });

  // A mesma mensagem reprocessada (fila que voltou) refaz a MESMA triagem, mas não gasta tentativa, não mexe
  // no histórico e não confirma: a decisão original volta (parar continua parar; transferência continua
  // transferência), em vez de pedir o CPF a quem pediu para parar (revisão B3).
  const reprocessada = mesmoVinculo && estado!.ultimaMensagemId === messageId;
  const manter = (r: ResultadoDaIdentidade): ResultadoDaIdentidade => (reprocessada ? { ...r, estado, tentativaGasta: false } : r);

  const { categoria: triagem, digitos } = classificarMensagemPreIdentidade({ texto, nomeDoCliente: cadastro.nome });
  const decisao = decidirPreIdentidade(triagem);
  const daTriagem = { triagem, decisao };
  if (decisao.acao === "ignorar") return { ...base, ...daTriagem, acao: "ignorar", estado };
  if (decisao.acao === "transferir") return manter(responder("humano", null, daTriagem));
  if (decisao.acao === "encerrar") return manter(responder("humano", decisao.situacao, daTriagem));
  if (decisao.acao === "responder" && decisao.situacao === "terceiro") return manter(responder("desafiar", "terceiro", daTriagem));

  if (tentativasEsgotadas(tentativas)) return manter(responder("humano", "tentativas_esgotadas", { ...daTriagem, motivo: "tentativas_esgotadas" }));
  if (decisao.acao === "responder") return manter(responder("desafiar", !estado && decisao.situacao === "re_pedido" ? "desafio" : decisao.situacao, daTriagem));
  if (reprocessada) {
    // Já contada na primeira vez; se ali tivesse confirmado, a identidade estaria vigente e nem chegaria aqui
    // (confirmação vencida desde então não renasce de mensagem velha: pede os dígitos de novo).
    return manter(responder("desafiar", digitos.includes(documento.slice(-4)) ? "re_pedido" : "erro_digitos", daTriagem));
  }

  // Quantos palpites ainda cabem nas DUAS janelas. Uma mensagem com mais finais do que isso não confere nada —
  // senão "2222 8909" com 1 tentativa sobrando testava 2 finais e o limite de 3 em 24 h virava 4 (revisão B3).
  const restantes = Math.min(
    LIMITES_DA_IDENTIDADE.tentativasEm24h - tentativas.em24h,
    LIMITES_DA_IDENTIDADE.tentativasEm30Dias - tentativas.em30Dias,
  );
  // Mais de 2 finais diferentes numa mensagem é chute em lote: gasta e nunca confirma.
  if (digitos.length <= Math.min(MAX_TOKENS_DE_DIGITOS, restantes) && digitos.includes(documento.slice(-4))) {
    const confirmado: EstadoIdentidadeDoEpisodio = { ...novo, confirmadaEm: agora.toISOString(), validaAte: new Date(agora.getTime() + LIMITES_DA_IDENTIDADE.episodioSemMensagemMs).toISOString() };
    return { ...base, ...daTriagem, acao: "confirmada", recemConfirmada: true, estado: confirmado };
  }
  // Cada final diferente é um palpite: "8909 ou 8908" errado gasta 2. Nunca além do que resta nas janelas.
  const gasto = Math.max(1, Math.min(digitos.length, restantes));
  novo.tentativasEm = [...historico, ...Array.from({ length: gasto }, () => agora.toISOString())];
  const depois = { em24h: tentativas.em24h + gasto, em30Dias: tentativas.em30Dias + gasto };
  novo.tentativas = depois.em24h;
  return tentativasEsgotadas(depois)
    ? responder("humano", "tentativas_esgotadas", { ...daTriagem, tentativaGasta: true, motivo: "tentativas_esgotadas" })
    : responder("desafiar", "erro_digitos", { ...daTriagem, tentativaGasta: true });
}

/** A janela do modelo não precisa de documentos nem dos dígitos usados no desafio. */
export function protegerHistorico(texto: string, documento: string): string {
  let protegido = texto.replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, "[documento omitido]");
  const final = documento.replace(/\D/g, "").slice(-4);
  if (final.length === 4) protegido = protegido.replace(new RegExp(`\\b${final}\\b`, "g"), "[confirmação omitida]");
  return protegido;
}
