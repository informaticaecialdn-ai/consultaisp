import type { PlanoResposta, PropostaAutonomia } from "@shared/chat-autonomia";
import { reservaPosIdentidade, type BaloesDoServidor, type CarteiraDoTexto, type DadosDaReserva, type SementeDoTexto } from "@shared/chat-funcionaria-textos";
import type { Carteira } from "@shared/cobranca/estados";
import { classificarEncerramento, classificarTransferencia, extrairDatasEHoras, normalizarMensagemDoCliente, resolverDatasDaMensagem } from "@shared/chat-funcionaria-triagem";
export { classificarTransferencia, resolverDatasDaMensagem } from "@shared/chat-funcionaria-triagem";

/**
 * Tira do texto do cliente a pontuação — e, no modo tolerante, os emojis que não mudam o sentido. O que
 * sobra são palavras; qualquer palavra fora da lista derruba a confirmação — "sim, mas só metade" não é sim.
 * No modo estrito (acordo) nenhum emoji sai: "sim 😊" sobra com o emoji e não confirma.
 */
function palavrasDaConfirmacao(texto: string, modo: "tolerante" | "estrito"): string[] | null {
  let t = normalizarMensagemDoCliente(texto).replace(/\n/g, " ");
  if (!t || t.length > 80 || /[?0-9]/.test(t)) return null;
  if (modo === "tolerante") {
    t = t.replace(/(?:\u{1F44D}[\u{1F3FB}-\u{1F3FF}]?|\u{2705})\u{FE0F}?/gu, " sim ")
      .replace(/[\u{1F642}\u{1F60A}\u{1F64F}\u{1F609}\u{263A}]\u{FE0F}?/gu, " ");
  }
  t = t.replace(/[.,!;:~()"'-]+/g, " ").trim();
  if (!t || /[^a-z ]/.test(t)) return null;
  return t.split(/\s+/);
}

const CONFIRMA_TOLERANTE = new Set(["sim", "isso", "pode", "fechado", "fechou", "combinado", "confirmo", "confirmado", "ok", "okay", "okey", "okk", "beleza", "blz", "certo", "certinho", "perfeito"]);
const COMPLEMENTOS_TOLERANTES = new Set(["anotar", "registrar", "agendar", "confirmar", "marcar", "ser", "mesmo", "ai", "entao", "ta", "bom", "obrigado", "obrigada", "obg", "brigado", "brigada", "valeu", "claro", "exato", "correto", "show", "otimo", "senhora", "senhor", "por", "favor", "pfv", "eu"]);
/** Sobram quando a data ou a hora saem do texto ("sim, dia 20", "pode ser sexta às 14h", "ok, na sexta"). */
const COMPLEMENTOS_DA_DATA = new Set(["dia", "de", "a", "as", "o", "no", "na", "pra", "para", "em", "ate", "feira", "que", "vem", "proxima", "proximo", "do", "da"]);
/**
 * "Sim" de PROMESSA ou AGENDAMENTO (spec §3.3, f2): como se responde no WhatsApp — sim, isso, pode, pode
 * sim, pode anotar, fechado, combinado, confirmo, ok, beleza, certo, tá bom, perfeito, 👍. Sem negação, sem
 * pergunta e sem número novo: "ok, mas dia 25" traz outra data e não confirma a anterior. Promessa não cria
 * dívida nova nem muda valor — por isso tolera. Acordo não (`confirmacaoDeAcordo`). A data IGUAL à da
 * proposta ("sim, dia 20") é conferida em `propostaConfirmada`, que sabe qual é a proposta.
 */
export function confirmacaoTolerante(texto: string): boolean {
  return confirmaPalavras(palavrasDaConfirmacao(texto, "tolerante"), COMPLEMENTOS_TOLERANTES);
}
function confirmaPalavras(palavras: string[] | null, complementos: ReadonlySet<string>, extras: ReadonlySet<string> = new Set()): boolean {
  if (!palavras) return false;
  const juntas = ` ${palavras.join(" ")} `;
  const temNucleo = palavras.some(p => CONFIRMA_TOLERANTE.has(p)) || juntas.includes(" ta bom ");
  return temNucleo && palavras.every(p => CONFIRMA_TOLERANTE.has(p) || complementos.has(p) || extras.has(p));
}

/**
 * A resposta à proposta que repete a data ou a hora DELA ("sim, dia 20", "pode ser sexta", "ok, às 14h").
 * Toda data citada tem que ser a da proposta e, no agendamento, toda hora a hora dela; promessa com hora não
 * passa. Tirada a data, o resto precisa ser uma confirmação tolerante — qualquer outro número derruba.
 */
function confirmacaoComADataDaProposta(proposta: PropostaAutonomia, texto: string, hoje: string): boolean {
  const { datas, horas, resto } = extrairDatasEHoras(texto, hoje);
  if (!datas.length && !horas.length) return false;
  if (datas.some(d => d !== proposta.data.slice(0, 10))) return false;
  if (proposta.acao === "agendar" ? horas.some(h => h !== proposta.data.slice(11, 16)) : horas.length > 0) return false;
  return confirmaPalavras(palavrasDaConfirmacao(resto, "tolerante"), COMPLEMENTOS_TOLERANTES, COMPLEMENTOS_DA_DATA);
}

const CONFIRMA_ACORDO = new Set(["sim", "aceito", "confirmo", "fechado"]);
const COMPLEMENTOS_DO_ACORDO = new Set(["eu", "o", "a", "acordo", "proposta"]);
/**
 * Aceite de ACORDO (s8): só "sim", "aceito", "confirmo" ou "fechado", sem ressalva ("mas", "só que", "?")
 * e sem emoji (nenhum: "sim 😊" não aceita). O aceite grava negociação com desconto e parcelas, que vira
 * base da cobrança e da confissão de dívida: um "ok" de "entendi" ou um 👍 não podem virar isso.
 */
export function confirmacaoDeAcordo(texto: string): boolean {
  const palavras = palavrasDaConfirmacao(texto, "estrito");
  if (!palavras) return false;
  return palavras.some(p => CONFIRMA_ACORDO.has(p)) && palavras.every(p => CONFIRMA_ACORDO.has(p) || COMPLEMENTOS_DO_ACORDO.has(p));
}

/**
 * O que tira a conversa da IA e entrega à equipe depois da identidade (spec §3.3). As categorias vêm de
 * `classificarTransferencia` (pedido de pessoa, jurídico, vulnerabilidade grave, contestação, pagamento e
 * devolução informados, e as regras do Consulta ISP: negativar, baixar, SPC/Serasa e desconto sem a
 * negociação autônoma) e de `classificarEncerramento` (número errado, pedido para parar).
 *
 * NÃO transferem mais (f3, s10): "é golpe?", "você é robô?", "tô desempregado", "quero cancelar", "quem
 * paga é meu marido", "pago dia N" com N depois de hoje e "pago amanhã/sexta". "pago dia N" com N até hoje
 * transfere: é "paguei dia N". Por isso a data de hoje entra (`agora`, calendário de Brasília).
 *
 * Correção 2 da B3: contestação dita com o verbo ("quero contestar") volta a transferir; quem diz não ser o
 * cliente ("não sou a Maria", "não conheço essa pessoa") vai à equipe sem a desculpa por engano; e o
 * encerramento por número errado só aceita a forma inequívoca. `nomeDoCliente` (opcional) reconhece o nome
 * sem artigo ("não sou Maria").
 */
export function exigeHumano(texto: string, permitirNegociacao = false, agora = new Date(), nomeDoCliente?: string | null): boolean {
  return classificarTransferencia(texto, { hoje: dataLocal(agora), permitirNegociacao, nomeDoCliente }) !== null || classificarEncerramento(texto) !== null;
}
export function dataLocal(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}
/** Antes disso nenhum agendamento vale (horário de Brasília, "HH:MM"). */
export const HORA_MINIMA_DO_AGENDAMENTO = "06:00";
/** A proposta pendente vale pelo EPISÓDIO (6 h), como a identidade (f4): o cliente responde depois do almoço. */
export const VALIDADE_DA_PROPOSTA_MS = 6 * 60 * 60_000;
/**
 * `saldo` é `null` quando NINGUÉM leu o valor agora no ERP (cliente que pagou
 * tudo devolve zero fatura, e a ficha cai para a varredura das 03:00). Null não
 * é zero e não é o saldo antigo: sem leitura ao vivo não existe proposta.
 *
 * A data do plano tem que ser uma das datas que o CLIENTE disse, resolvidas pelo servidor
 * (`resolverDatasDaMensagem`: dd/mm, "dia N", dia da semana, hoje/amanhã/depois de amanhã), de hoje até
 * 90 dias (f2). No agendamento, a hora também: "manhã" = 09:00, "tarde" = 14:00, ou a hora que ele escreveu —
 * nunca antes das 06:00.
 */
export function validarProposta(plano: PlanoResposta, mensagem: string, saldo: number | null, messageId: string, agora = new Date()): PropostaAutonomia | null {
  if (!["promessa", "agendar"].includes(plano.acao) || !plano.data) return null;
  const dia = plano.data.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const hoje = dataLocal(agora);
  const data = new Date(`${dia}T12:00:00-03:00`);
  if (!Number.isFinite(data.getTime()) || data.toISOString().slice(0, 10) !== dia || dia < hoje || data.getTime() > agora.getTime() + 90 * 86400000) return null;
  const citadas = resolverDatasDaMensagem(mensagem, hoje);
  if (!citadas.datas.includes(dia)) return null;
  if (plano.acao === "promessa") {
    if (saldo === null || !Number.isFinite(saldo) || saldo <= 0 || (plano.valor !== undefined && Math.round(plano.valor * 100) !== Math.round(saldo * 100))) return null;
    return { acao: "promessa", data: dia, valor: saldo, criadaEm: agora.toISOString(), messageId };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-03:00$/.test(plano.data)) return null;
  const horario = plano.data.slice(11, 16);
  // retirada de madrugada não existe: "03:00" digitado é erro de digitação, não combinado (correção 2)
  if (horario < HORA_MINIMA_DO_AGENDAMENTO) return null;
  if (!citadas.horas.includes(horario) || new Date(plano.data).getTime() <= agora.getTime()) return null;
  return { acao: "agendar", data: plano.data, criadaEm: agora.toISOString(), messageId };
}
/**
 * O "sim" de promessa ou agendamento: mensagem posterior à proposta, dentro do episódio, com confirmação
 * tolerante — que pode repetir a data ou a hora da própria proposta ("sim, dia 20"), nunca outra.
 * `ultimoBalaoEraAPergunta` (quando o serviço sabe) exige que a última coisa enviada tenha sido a pergunta de
 * confirmação — um "ok" a outra pergunta não confirma a proposta que ficou para trás.
 */
export function propostaConfirmada(proposta: PropostaAutonomia | null, texto: string, messageId: string, agora = new Date(), opcoes: { ultimoBalaoEraAPergunta?: boolean } = {}): proposta is PropostaAutonomia {
  if (!proposta || proposta.messageId === messageId || opcoes.ultimoBalaoEraAPergunta === false) return false;
  const idade = agora.getTime() - new Date(proposta.criadaEm).getTime();
  if (!Number.isFinite(idade) || idade < 0 || idade >= VALIDADE_DA_PROPOSTA_MS) return false;
  return confirmacaoTolerante(texto) || confirmacaoComADataDaProposta(proposta, texto, dataLocal(agora));
}
/**
 * Os dados que a reserva precisa, a partir do que a rodada leu. `saldo` só chega aqui quando foi lido AGORA no ERP;
 * `null` significa que ninguém mediu nesta rodada, e a frase não cita valor. Na recuperação o saldo nunca entra: a
 * carteira de equipamentos não fala de dinheiro.
 */
export interface ContextoDaResposta {
  /** Mantidos por compatibilidade: a voz agora é da funcionária (variações), não um prefixo por tom (D6, f18). */
  tom?: string | null;
  vulneravel?: boolean;
  carteira?: Carteira | null;
  permitirPromessa?: boolean;
  permitirSegundaVia?: boolean;
  permitirAgendamento?: boolean;
  nomeDaPersona?: string | null;
  nomeDoProvedor?: string | null;
  nomeDoCliente?: string | null;
  /** Depois da identidade ela já falou (pediu os dígitos); só `false` explícito a faz se apresentar. */
  funcionariaJaFalou?: boolean;
  /** "AAAA-MM-DD" em Brasília; ausente = hoje. */
  hoje?: string;
  /** §3.3/f20: no turno em que a identidade acabou de ser confirmada, o saldo só entra se o cliente perguntou valor. */
  identidadeRecemConfirmada?: boolean;
  ultimaMensagemDoCliente?: string | null;
  /** A variação escolhida por conversa; sem ela, a reserva escolhe como se fosse a primeira vez. */
  semente?: SementeDoTexto;
}
const centavos = (valor: number | null | undefined) => (typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) : null);
export function dadosDaReserva(saldo: number | null, recuperacao: boolean, o: ContextoDaResposta = {}): DadosDaReserva {
  const carteira: CarteiraDoTexto = recuperacao ? "equipamentos" : o.carteira === "ex_cliente" ? "ex_cliente" : "ativo";
  return {
    carteira,
    hoje: o.hoje ?? dataLocal(new Date()),
    saldoCentavos: recuperacao ? null : centavos(saldo),
    permitirPromessa: o.permitirPromessa === true,
    permitirSegundaVia: o.permitirSegundaVia === true,
    permitirAgendamento: o.permitirAgendamento === true,
    nomeDaPersona: o.nomeDaPersona ?? null,
    nomeDoProvedor: o.nomeDoProvedor ?? null,
    nomeDoCliente: o.nomeDoCliente ?? null,
    ...(o.funcionariaJaFalou === undefined ? {} : { funcionariaJaFalou: o.funcionariaJaFalou }),
    identidadeRecemConfirmada: o.identidadeRecemConfirmada === true,
    ultimaMensagemDoCliente: o.ultimaMensagemDoCliente ?? null,
  };
}
/**
 * D6: a reserva humanizada de `respostaControlada`, em balões (`shared/chat-funcionaria-textos.ts`). O LLM escolhe a
 * intenção; fatos, links e compromissos são do servidor — o `texto` e o link do modelo nunca chegam aqui. Saiu a voz
 * de bot ("O ERP informa R$ X na leitura de agora", "Sou o assistente virtual"), que o dono pediu para tirar.
 */
export function reservaDaResposta(plano: PlanoResposta, saldo: number | null, recuperacao: boolean, o: ContextoDaResposta = {}): BaloesDoServidor {
  return reservaPosIdentidade({ tipo: "resposta", resposta: plano.resposta ?? "acolher" }, dadosDaReserva(saldo, recuperacao, o), o.semente ?? { conversationId: "" });
}
/** A mesma reserva numa mensagem só (balões unidos por linha em branco), para quem ainda manda texto único. */
export function respostaControlada(plano: PlanoResposta, saldo: number | null, recuperacao: boolean, o: ContextoDaResposta = {}): string {
  return reservaDaResposta(plano, saldo, recuperacao, o).join("\n\n");
}
/** A pergunta de confirmação da proposta, na voz da funcionária: data em dd/mm e, na promessa, o valor integral lido. */
export function reservaDaProposta(p: PropostaAutonomia, o: ContextoDaResposta = {}): BaloesDoServidor {
  const proposta = p.acao === "promessa"
    ? { acao: "promessa" as const, data: p.data.slice(0, 10), ...(centavos(p.valor) === null ? {} : { valorCentavos: centavos(p.valor)! }) }
    : { acao: "agendar" as const, data: p.data.slice(0, 10), hora: p.data.slice(11, 16) };
  return reservaPosIdentidade({ tipo: "proposta", proposta }, dadosDaReserva(p.valor ?? null, p.acao === "agendar", o), o.semente ?? { conversationId: "" });
}
export function textoDaProposta(p: PropostaAutonomia, o: ContextoDaResposta = {}): string {
  return reservaDaProposta(p, o).join("\n\n");
}
