/**
 * Frases do SERVIDOR na voz da funcionária digital (spec 2026-09-16, §3.1–§3.4 e §7).
 *
 * POR QUE existe: antes da identidade o modelo não escreve nada ao cliente (D5) —
 * quem está do outro lado pode não ser o titular, e uma frase errada ali é
 * vazamento. Depois da identidade, quando o verificador recusa o texto do modelo,
 * sai uma RESERVA daqui (D6). Nos dois casos o texto tem que soar como a
 * funcionária da casa ("Aqui é a Clara, da NsLink 😊"), e não como o bot que o
 * dono pediu para tirar ("O ERP informa R$ 150,00 na leitura de agora…").
 *
 * Puro: sem banco, rede ou relógio (`agora` e `hoje` vêm de fora). Cada situação
 * tem 2–3 variações escolhidas de forma determinística pelo `conversationId`, sem
 * repetir a usada por último: a mesma frase idêntica duas vezes seguidas é o que
 * denuncia o robô (Provedor.ai, CADÊNCIA). O índice escolhido sai em `.variacao`
 * (com a `.chave`), para o serviço guardar e devolver na próxima vez.
 *
 * Travas: toda frase pré-identidade passa por `verificarTextoPreIdentidade` em
 * TESTE (todas as variações) e também aqui, em tempo de montagem — um nome de
 * cadastro que é vocabulário proibido ("Real", "Cobrança") ou um provedor
 * chamado "Logo Net" derrubariam a frase; nesse caso ela sai sem AQUELE nome, e
 * não com a palavra. Se nenhuma voz passa (um sobrenome "Pessoa" bate com a
 * frase fixa), tenta as outras variações; se nada passa, a frase sai com
 * `.aprovada = false` e o serviço não a envia. As reservas pós-identidade passam
 * por `verificarMensagens` com os fatos do caso nos testes.
 */
import type { PlanoResposta } from "./chat-autonomia";
import { nomeDaPersonaValido } from "./chat-agentes";
import { VOCABULARIO, VOCABULARIO_PRE_IDENTIDADE, normalizarParaVerificacao, verificarMensagens, verificarTextoPreIdentidade } from "./chat-funcionaria-digital";
import { feriadosDoChat, janelaDoChat } from "./cobranca/automacao-chat";
import { JanelaContatoSchema, POLITICA_PADRAO } from "./cobranca/politica";

/* ───────────────────────── contrato ───────────────────────── */

export interface SementeDoTexto {
  conversationId: string;
  /** O `.variacao` devolvido da última vez que ESTA situação (mesma `.chave`) foi enviada nesta conversa. */
  ultimaVariacao?: number | null;
}

/**
 * Os balões, na ordem de envio. `variacao`, `chave` e `aprovada` não são enumeráveis: o array continua sendo só
 * texto. `aprovada` só existe nas frases antes da identidade (e no aviso neutro): `false` quando nem a voz mínima,
 * em nenhuma variação, passou em `verificarTextoPreIdentidade` — o serviço NÃO envia, e a conversa vai à equipe
 * em silêncio. Acontece quando um pedaço do nome do cadastro coincide com todas as frases fixas da situação.
 */
export type BaloesDoServidor = string[] & { readonly variacao: number; readonly chave: string; readonly aprovada?: boolean };

export interface DadosDaConversa {
  /** Nome configurado da funcionária ("Clara"). Sem nome válido, fala a equipe do provedor. */
  nomeDaPersona?: string | null;
  nomeDoProvedor?: string | null;
  /** Nome como está no cadastro ("MARIA DE SOUZA"): só o primeiro nome aparece, capitalizado. */
  nomeDoCliente?: string | null;
  /**
   * A funcionária já mandou mensagem nesta conversa? Se não, ela se apresenta primeiro (f18). Antes da
   * identidade, ausente = não falou; depois da identidade, ausente = já falou (ela pediu os dígitos).
   */
  funcionariaJaFalou?: boolean;
  /**
   * Site e telefone do CADASTRO do provedor, para a dúvida de golpe e para quem não confirmou (§3.2). Do site só
   * entra o domínio: o caminho ("/segunda-via") diria o assunto a quem ainda não confirmou a identidade.
   */
  canalOficial?: { site?: string | null; telefone?: string | null } | null;
}

export const SITUACOES_PRE_IDENTIDADE = [
  "abertura",
  "desafio",
  "re_pedido",
  "explicacao",
  "pergunta_robo",
  "duvida_golpe",
  "erro_digitos",
  "tentativas_esgotadas",
  "numero_errado",
  "terceiro",
  "pediu_para_parar",
  "contesta_titularidade",
  "audio",
] as const;
export type SituacaoPreIdentidade = (typeof SITUACOES_PRE_IDENTIDADE)[number];

/** As situações cuja frase pede os 4 últimos dígitos — o único "4" que o verificador aceita antes da identidade. */
export const SITUACOES_COM_DESAFIO: ReadonlySet<SituacaoPreIdentidade> = new Set<SituacaoPreIdentidade>([
  "abertura", "desafio", "re_pedido", "explicacao", "pergunta_robo", "duvida_golpe", "erro_digitos", "audio",
]);

export const CATEGORIAS_DE_TRANSFERENCIA = [
  "pedido_pessoa",
  "juridico",
  "vulnerabilidade",
  "contestacao",
  "pagamento_informado",
  "devolucao_informada",
  "generica",
] as const;
export type CategoriaDeTransferencia = (typeof CATEGORIAS_DE_TRANSFERENCIA)[number];

export interface DadosDoAviso extends DadosDaConversa {
  /** Antes da identidade o aviso é NEUTRO, qualquer que seja a categoria (nada revela o motivo do contato). */
  identidadeConfirmada: boolean;
  agora: Date;
  /** `politica.janelaContato` do provedor; inválida ou ausente vale a padrão (CDC art. 42). */
  janela?: unknown;
  diasPausados?: readonly string[];
  /**
   * A mensagem que levou à transferência (só é lida, nunca entra na frase). Depois da identidade, se ela pergunta
   * quem atende ("já paguei, tem alguém aí?") e caiu numa categoria que não é o pedido de pessoa, o aviso também
   * confirma a automação (D1). Ausente = o aviso da categoria como está.
   */
  ultimaMensagemDoCliente?: string | null;
  /** Só para a conferência acima; ausente vale "ativo" (nenhum aviso fala de dinheiro nem de aparelho com valor). */
  carteira?: CarteiraDoTexto;
}

export type RespostaControlada = NonNullable<PlanoResposta["resposta"]>;
export type CarteiraDoTexto = "ativo" | "ex_cliente" | "equipamentos";

export interface DadosDaReserva extends DadosDaConversa {
  carteira: CarteiraDoTexto;
  /** "AAAA-MM-DD" em Brasília: decide "hoje", "amanhã" e o dia da semana da proposta. */
  hoje: string;
  /** Saldo lido AO VIVO nesta rodada, em centavos. `null` = ninguém leu agora, e a frase não cita valor. */
  saldoCentavos?: number | null;
  permitirPromessa?: boolean;
  permitirSegundaVia?: boolean;
  permitirAgendamento?: boolean;
  /**
   * §3.3: o turno em que a identidade acabou de ser confirmada. Nele o saldo só entra se o cliente perguntou valor;
   * quem julga é a MESMA regra do verificador, sobre `ultimaMensagemDoCliente`. Sem isto, a reserva de
   * `informar_divida` devolveria o valor que o verificador acabou de recusar no texto do modelo.
   */
  identidadeRecemConfirmada?: boolean;
  /** A mensagem que o cliente mandou nesta rodada (só é lida, nunca entra na frase). */
  ultimaMensagemDoCliente?: string | null;
}

export type PedidoDeReserva =
  | { tipo: "resposta"; resposta: RespostaControlada }
  | { tipo: "audio" }
  /** D1 depois da identidade: "você é robô?" vai ao planejador; se o texto dele for recusado, sai esta. */
  | { tipo: "pergunta_robo" }
  | { tipo: "proposta"; proposta: { acao: "promessa"; data: string; valorCentavos?: number } | { acao: "agendar"; data: string; hora: string } }
  | { tipo: "registrado"; gravado: { tipo: "promessa" | "agendamento" | "acordo"; data: string; valorCentavos?: number; hora?: string } }
  | { tipo: "introducao_segunda_via" }
  | { tipo: "introducao_ofertas" };

/* ───────────────────────── variação ───────────────────────── */

function fnv1a(texto: string): number {
  let h = 0x811c9dc5;
  for (const c of texto) {
    h ^= c.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Índice determinístico por conversa e situação; nunca o mesmo da última vez (quando há mais de uma). */
export function escolherVariacao(chave: string, total: number, semente: SementeDoTexto | null | undefined): number {
  if (!Number.isInteger(total) || total <= 1) return 0;
  const base = fnv1a(`${semente?.conversationId ?? ""}|${chave}`) % total;
  return semente?.ultimaVariacao === base ? (base + 1) % total : base;
}

function comMarca(lista: readonly string[], chave: string, variacao: number, aprovada?: boolean): BaloesDoServidor {
  const r = [...lista];
  Object.defineProperties(r, { variacao: { value: variacao, enumerable: false }, chave: { value: chave, enumerable: false } });
  if (aprovada !== undefined) Object.defineProperty(r, "aprovada", { value: aprovada, enumerable: false });
  return r as BaloesDoServidor;
}

/* ───────────────────────── nomes e canais ───────────────────────── */

const INVISIVEIS = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿]/g;
const limpar = (v: string) => v.normalize("NFKC").replace(INVISIVEIS, "").replace(/\s+/g, " ").trim();
const PARTICULAS = new Set(["da", "de", "do", "das", "dos", "e", "di", "du", "del", "della", "van", "von", "der"]);

/** "MARIA DE SOUZA" → "Maria de Souza"; "ANA-CLARA D'ÁVILA" → "Ana-Clara D'Ávila". Partícula só minúscula fora da 1ª palavra. */
export function capitalizarNome(nome: string): string {
  return limpar(nome)
    .split(" ")
    .filter(Boolean)
    .map((palavra, i) => {
      const minuscula = palavra.toLocaleLowerCase("pt-BR");
      if (i > 0 && PARTICULAS.has(minuscula)) return minuscula;
      return minuscula.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, letra: string) => sep + letra.toLocaleUpperCase("pt-BR"));
    })
    .join(" ");
}

/** O primeiro nome do cadastro, capitalizado; `null` quando não é um nome (vazio, dígito, pontuação). */
export function primeiroNomeDoCliente(nome: unknown): string | null {
  if (typeof nome !== "string") return null;
  const primeiro = limpar(nome).split(" ")[0] ?? "";
  if (primeiro.length < 2 || primeiro.length > 40 || !/^\p{L}+(?:['’-]\p{L}+)*$/u.test(primeiro)) return null;
  if (PARTICULAS.has(primeiro.toLocaleLowerCase("pt-BR"))) return null;
  return capitalizarNome(primeiro);
}

/** Mesmas regras da abertura controlada (`nomesSegurosDaAbertura`): nada de domínio, sequência longa de dígito ou símbolo. */
export function nomeDoProvedorSeguro(nome: unknown): string | null {
  if (typeof nome !== "string") return null;
  const s = limpar(nome);
  const ok = s.length >= 2 && s.length <= 80 && /^[\p{L}\p{M}\d &.'’-]+$/u.test(s) && /\p{L}/u.test(s) && !/\d{5}/.test(s) && !/\.\p{L}{2,}/u.test(s);
  return ok ? s : null;
}

// Os termos da pré-identidade compilados como o verificador compila ("#" = fim de palavra), para ler o domínio.
const ASSUNTO_NAS_PALAVRAS_DO_SITE = new RegExp(
  `(?<![a-z0-9])(?:${[...VOCABULARIO_PRE_IDENTIDADE.termos, ...VOCABULARIO_PRE_IDENTIDADE.enderecos, ...VOCABULARIO.ameaca].map(f => f.replace(/#/g, "(?![a-z0-9])")).join("|")})`,
);
// Domínio é palavra grudada ("segundavianslink"): os radicais de dinheiro que não aparecem por acaso em nome de provedor.
const ASSUNTO_GRUDADO_NO_SITE = /cobranc|divid|debit|devedor|fatur|bolet|pagament|pagar|segundavia|2via|inadimpl|financ|negativ|serasa|quitac|acordo|parcel|descont|pix/;
const ROTULO_DE_DOMINIO = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";

/**
 * Só o DOMÍNIO do site do cadastro ("https://www.NsLink.com.br/segunda-via" → "www.nslink.com.br"). O verificador
 * pré-identidade apaga os canais oficiais antes de conferir o vocabulário, então tudo o que vai no canal passa sem
 * ser lido: um caminho "/financeiro" chegaria a quem ainda não confirmou a identidade. Pelo mesmo motivo o domínio
 * com assunto ("financeiro.nslink.com.br", "segunda-via.nslink.com.br") é descartado — exceto as palavras do
 * próprio nome do provedor, que a frase já diz. Porta, usuário ou qualquer coisa fora de um host: descartado.
 */
export function siteOficialSeguro(site: unknown, nomeDoProvedor?: unknown): string | null {
  if (typeof site !== "string") return null;
  const host = limpar(site).replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/\.$/, "").toLowerCase();
  if (host.length > 80 || !new RegExp(`^${ROTULO_DE_DOMINIO}(?:\\.${ROTULO_DE_DOMINIO})+$`).test(host)) return null;
  const doProvedor = new Set(normalizarParaVerificacao(typeof nomeDoProvedor === "string" ? nomeDoProvedor : "").split(/[^a-z0-9]+/).filter(Boolean));
  const palavras = host.split(/[.-]+/).filter(p => p && !doProvedor.has(p));
  if (ASSUNTO_NAS_PALAVRAS_DO_SITE.test(palavras.join(" ")) || palavras.some(p => ASSUNTO_GRUDADO_NO_SITE.test(p))) return null;
  return host;
}

/** Telefone do cadastro do provedor como está escrito, se tiver cara de telefone (10 a 13 dígitos). */
export function telefoneOficialSeguro(telefone: unknown): string | null {
  if (typeof telefone !== "string") return null;
  const s = limpar(telefone);
  const digitos = s.replace(/\D/g, "").length;
  return /^\+?[0-9 ().-]{10,20}$/.test(s) && digitos >= 10 && digitos <= 13 ? s : null;
}

/** Os canais exatamente como entram no texto: o verificador pré-identidade precisa deles em `canaisOficiais`. */
export function canaisOficiaisDoTexto(dados: Pick<DadosDaConversa, "canalOficial" | "nomeDoProvedor">): string[] {
  return [siteOficialSeguro(dados.canalOficial?.site, dados.nomeDoProvedor), telefoneOficialSeguro(dados.canalOficial?.telefone)].filter((c): c is string => !!c);
}

interface Voz {
  persona: string | null;
  provedor: string | null;
  cliente: string | null;
  site: string | null;
  telefone: string | null;
}

function vozDe(dados: DadosDaConversa): Voz {
  return {
    persona: nomeDaPersonaValido(dados.nomeDaPersona),
    provedor: nomeDoProvedorSeguro(dados.nomeDoProvedor),
    cliente: primeiroNomeDoCliente(dados.nomeDoCliente),
    site: siteOficialSeguro(dados.canalOficial?.site, dados.nomeDoProvedor),
    telefone: telefoneOficialSeguro(dados.canalOficial?.telefone),
  };
}

const daEmpresa = (v: Voz) => (v.provedor ? `da ${v.provedor}` : "do seu provedor");
/** "Aqui é a Clara, da NsLink" — quem pergunta "quem é?" ouve o nome, sem emoji e sem o "Oi" da abertura. */
const quemFala = (v: Voz) => (v.persona ? `Aqui é a ${v.persona}, ${daEmpresa(v)}` : `Aqui é da equipe ${daEmpresa(v)}`);
// As funcionárias do dono são mulheres (Clara, Leonora, Eduarda); sem persona quem fala é a equipe.
const obrigada = (v: Voz) => (v.persona ? "Obrigada" : "Obrigado");

/** §3.1 e f18: "Aqui é a <persona>" só enquanto ela ainda não falou na conversa. */
function apresentacao(v: Voz, i: number): string {
  const oi = ["Oi! Aqui", "Olá! Aqui", "Oi, aqui"][i % 3];
  return v.persona ? `${oi} é a ${v.persona}, ${daEmpresa(v)} 😊` : `${oi} é da equipe ${daEmpresa(v)} 😊`;
}

function viaCanais(v: Voz): string | null {
  const partes = [v.site ? `pelo site ${v.site}` : null, v.telefone ? `pelo telefone ${v.telefone}` : null].filter(Boolean);
  return partes.length ? partes.join(" ou ") : null;
}

/* ───────────────────────── antes da identidade ───────────────────────── */

const PEDIDO_DOS_DIGITOS = [
  "Pra sua segurança, antes de continuar, me confirma os 4 últimos dígitos do seu CPF? A gente nunca pede senha nem o CPF completo.",
  "Antes de continuar, pra sua segurança, me passa os 4 últimos dígitos do seu CPF? A gente nunca pede senha nem o CPF completo.",
  "Pra continuar com segurança, me confirma os 4 últimos dígitos do seu CPF? A gente nunca pede senha nem o CPF completo.",
];
// §3.1: "Tô falando com a Maria?" — sem o artigo, que pressupõe o gênero do cadastro (o Provedor.ai também não usa).
const QUEM_ATENDE = (nome: string) => [`Tô falando com ${nome}?`, `Tudo bem, ${nome}?`, `${nome}, tudo bem?`];

function desafioCompleto(v: Voz, i: number): string {
  const pedido = PEDIDO_DOS_DIGITOS[i % PEDIDO_DOS_DIGITOS.length];
  return v.cliente ? `${QUEM_ATENDE(v.cliente)[i % 3]} ${pedido}` : pedido;
}

type Montagem = (v: Voz, i: number) => string[];

const PRE: Record<SituacaoPreIdentidade, { variacoes: number; montar: Montagem; apresenta?: "sempre" }> = {
  // §3.1 — identidade.ts:389-390 do Provedor.ai, sem a prova social do bairro (F-07)
  abertura: { variacoes: 3, apresenta: "sempre", montar: (v, i) => [desafioCompleto(v, i)] },
  desafio: { variacoes: 3, montar: (v, i) => [desafioCompleto(v, i)] },
  // buildDesafioFallback, sem "é rapidinho" (prazo) e sem repetir a abertura
  re_pedido: {
    variacoes: 3,
    montar: (v, i) => [
      [
        v.cliente ? `Pra sua segurança, ${v.cliente}: antes de continuar por aqui, me confirma os 4 últimos dígitos do seu CPF, por favor?` : "Pra sua segurança, antes de continuar por aqui, me confirma os 4 últimos dígitos do seu CPF, por favor?",
        v.cliente ? `Só pra eu ter certeza que falo com ${v.cliente} mesmo: me confirma os 4 últimos dígitos do seu CPF, pode ser?` : "Só pra eu ter certeza que falo com quem eu procuro: me confirma os 4 últimos dígitos do seu CPF, pode ser?",
        "Pra gente continuar com segurança, preciso só que você me confirme os 4 últimos dígitos do seu CPF.",
      ][i],
    ],
  },
  // §3.2 item 9: "é sobre sua conta aqui com a gente", sem dizer o assunto
  explicacao: {
    variacoes: 3,
    montar: (v, i) => [
      [
        `${quemFala(v)}. É sobre um assunto da sua conta aqui com a gente. Pra falar dos detalhes com segurança, me confirma os 4 últimos dígitos do seu CPF?`,
        `${quemFala(v)}, e tô falando sobre um assunto da sua conta com a gente. Antes de entrar nos detalhes, me confirma os 4 últimos dígitos do seu CPF?`,
        `${quemFala(v)}. É um assunto da sua conta com a gente, e por segurança eu só entro nos detalhes depois de confirmar com você. Me passa os 4 últimos dígitos do seu CPF?`,
      ][i],
    ],
  },
  // D1: confirma a automação, oferece alguém da equipe e retoma o pedido
  pergunta_robo: {
    variacoes: 3,
    montar: (v, i) => [
      [
        `É um atendimento automatizado ${daEmpresa(v)}, com supervisão da nossa equipe. Se preferir falar com alguém da equipe, é só me dizer. Pra seguir por aqui, me confirma os 4 últimos dígitos do seu CPF?`,
        "Sim, por aqui é um atendimento automatizado, acompanhado pela nossa equipe. Se quiser falar com alguém da equipe, é só pedir. Ou, se preferir seguir por aqui, me confirma os 4 últimos dígitos do seu CPF?",
        `Esse atendimento é automatizado, sim, com a supervisão da nossa equipe ${daEmpresa(v)}. Se preferir, alguém da equipe continua com você. Pra seguir por aqui, me passa os 4 últimos dígitos do seu CPF?`,
      ][i],
    ],
  },
  // identidade.ts:269 (protocolo anti-golpe) + canal oficial do CADASTRO do provedor
  duvida_golpe: {
    variacoes: 3,
    montar: (v, i) => {
      const quem = v.provedor ?? "a gente";
      const canais = viaCanais(v);
      const conferir = canais
        ? `Se quiser confirmar que é ${v.provedor ? `a ${quem}` : quem} mesmo, fala com a gente ${canais}.`
        : `Se quiser confirmar que é ${v.provedor ? `a ${quem}` : quem} mesmo, procura a gente pelos canais oficiais antes de responder.`;
      return [
        [
          `Faz bem em conferir! A gente nunca pede senha nem o CPF completo por aqui. ${conferir} Se for você mesmo, me confirma os 4 últimos dígitos do seu CPF pra gente seguir?`,
          `Pode ficar à vontade pra conferir. Por aqui a gente nunca pede senha nem o CPF completo. ${conferir} Se for com você mesmo, me confirma os 4 últimos dígitos do seu CPF; se não for, é só ignorar esta mensagem.`,
          `Entendo a desconfiança, e faz bem. A gente nunca pede senha nem o CPF completo. ${conferir} Pra seguir por aqui, só preciso dos 4 últimos dígitos do seu CPF.`,
        ][i],
      ];
    },
  },
  erro_digitos: {
    variacoes: 3,
    montar: (_v, i) => [
      [
        "Esses números não bateram aqui. Pode conferir e me mandar de novo os 4 últimos dígitos do seu CPF?",
        "Não consegui confirmar com esses números. Confere e me manda de novo os 4 últimos dígitos do seu CPF?",
        "Hmm, esses dígitos não conferem aqui. Me manda de novo os 4 últimos do seu CPF, por favor?",
      ][i],
    ],
  },
  // RESPOSTA_IDENTIDADE_NAO_VALIDADA, sem o 🙏 (fora da lista fechada) e sem convite a tentar de novo
  tentativas_esgotadas: {
    variacoes: 2,
    montar: (v, i) => {
      const canais = viaCanais(v);
      const procurar = canais ? `é só procurar a gente ${canais}` : `é só procurar a gente pelos canais oficiais ${daEmpresa(v)}`;
      return [
        [
          `Pela sua segurança, vou parar por aqui: não consegui confirmar que estou falando com a pessoa certa. Se quiser continuar, ${procurar}.`,
          `Pra proteger seus dados, vou encerrar por aqui, porque não consegui confirmar com quem estou falando. Se precisar, ${procurar}.`,
        ][i],
      ];
    },
  },
  // §3.2 item 2: desculpa, sem convite
  numero_errado: {
    variacoes: 3,
    montar: (v, i) => [
      [
        `Entendi, foi engano então. Desculpa o incômodo, e ${obrigada(v).toLowerCase()} por avisar!`,
        `Ah, entendi! Desculpa pelo incômodo. ${obrigada(v)} por avisar.`,
        `Poxa, desculpa o incômodo! ${obrigada(v)} por me avisar.`,
      ][i],
    ],
  },
  // §3.2 item 3: pede que o titular fale; nunca pede os dígitos a quem se declarou outra pessoa
  terceiro: {
    variacoes: 2,
    montar: (v, i) => [
      v.cliente
        ? [
            `Entendi, ${obrigada(v).toLowerCase()}! Esse assunto eu só consigo tratar direto com ${v.cliente}. Quando der, pede pra ${v.cliente} me chamar por aqui?`,
            `${obrigada(v)} por avisar! Como é um assunto pessoal, preciso falar direto com ${v.cliente}. Pode pedir pra ${v.cliente} me responder por aqui quando puder?`,
          ][i]
        : [
            `Entendi, ${obrigada(v).toLowerCase()}! Esse assunto eu só consigo tratar direto com quem eu procuro. Quando der, pede pra essa pessoa me chamar por aqui?`,
            `${obrigada(v)} por avisar! Como é um assunto pessoal, preciso falar direto com quem eu procuro. Pode pedir pra essa pessoa me responder por aqui quando puder?`,
          ][i],
    ],
  },
  // §3.2 item 4: o serviço grava `nao_contatar`; a frase só confirma
  pediu_para_parar: {
    variacoes: 3,
    montar: (_v, i) => [
      [
        "Tudo bem, não vou mais te mandar mensagem por aqui. Desculpa o incômodo.",
        "Certo, entendi. Não te mando mais mensagem por este número. Desculpa o incômodo!",
        "Entendido. Não te mando mais mensagem por aqui, e desculpa o incômodo.",
      ][i],
    ],
  },
  // §3.2 item 5: encerramento neutro; a conversa vai à equipe em silêncio
  contesta_titularidade: {
    variacoes: 2,
    montar: (v, i) => {
      const canais = viaCanais(v);
      const contato = canais ? `Se precisar falar com a gente, é ${canais}.` : `Se precisar falar com a gente, é pelos canais oficiais ${daEmpresa(v)}.`;
      return [["Entendi. Vou parar por aqui e pedir pra nossa equipe verificar esse cadastro.", "Certo, entendi. Vou encerrar por aqui e pedir pra nossa equipe verificar esse cadastro."][i] + ` ${contato}`];
    },
  },
  // f12: áudio pede para escrever (a 2ª vez transfere — decisão do serviço)
  audio: {
    variacoes: 3,
    montar: (_v, i) => [
      [
        "Por aqui eu não consigo ouvir áudio. Consegue me escrever os 4 últimos dígitos do seu CPF?",
        "Não consigo ouvir áudio por aqui. Me escreve, por favor, os 4 últimos dígitos do seu CPF?",
        "Áudio eu não consigo ouvir por aqui. Pode me mandar por escrito os 4 últimos dígitos do seu CPF?",
      ][i],
    ],
  },
};

type ParteDaVoz = keyof Voz;
/** Ordem de desempate entre partes: o cliente (o dado mais sujo do cadastro), os canais, a persona e, por último, o provedor. */
const PARTES_DA_VOZ: readonly ParteDaVoz[] = ["cliente", "site", "telefone", "persona", "provedor"];

/**
 * Da voz completa até a mínima, tirando o MENOR número de partes: primeiro cada parte sozinha, depois de duas em
 * duas… Um provedor "Valor Net" sai sozinho e leva nada junto — nem o "Tô falando com Paulo?" da abertura, nem o
 * site e o telefone da dúvida de golpe, justo onde o cliente precisa conferir. Só as partes presentes contam
 * (no máximo 32 vozes, e só quando a voz completa reprova).
 */
function vozesEmOrdem(v: Voz): Voz[] {
  const presentes = PARTES_DA_VOZ.filter(p => v[p] !== null);
  const conjuntos: number[][] = [];
  for (let m = 0; m < 1 << presentes.length; m++) conjuntos.push(presentes.map((_, k) => k).filter(k => m & (1 << k)));
  // menos partes primeiro; no empate, pela ordem de PARTES_DA_VOZ ([cliente] antes de [provedor])
  const ordemLexica = (a: number[], b: number[]) => {
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k];
    return 0;
  };
  conjuntos.sort((a, b) => a.length - b.length || ordemLexica(a, b));
  return conjuntos.map(tirar => {
    const voz = { ...v };
    for (const k of tirar) voz[presentes[k]] = null;
    return voz;
  });
}

function passaNaPreIdentidade(baloes: readonly string[], v: Voz, dados: DadosDaConversa, desafio: boolean): boolean {
  const nomes = {
    persona: v.persona ?? "",
    provedor: v.provedor ?? "",
    primeiroNomeCliente: v.cliente,
    nomeCompletoCliente: typeof dados.nomeDoCliente === "string" ? dados.nomeDoCliente : null,
    canaisOficiais: [v.site, v.telefone].filter((c): c is string => !!c),
  };
  return baloes.every(b => verificarTextoPreIdentidade(b, { nomes, desafio }).ok);
}

/**
 * A variação escolhida, com a maior voz que passa. Se nenhuma voz passa nela, as outras variações — a usada por
 * último só no fim: repetir a frase é menos grave que a conversa ir à equipe em silêncio. Se nada passa, devolve a
 * escolhida na voz mínima com `aprovada = false`, para o serviço não enviar (nunca a frase reprovada em silêncio).
 */
function montarPre(chave: string, dados: DadosDaConversa, semente: SementeDoTexto, variacoes: number, desafio: boolean, apresentaSempre: boolean, montar: Montagem): BaloesDoServidor {
  const d = dados ?? {};
  const escolhida = escolherVariacao(chave, variacoes, semente);
  const ultima = semente?.ultimaVariacao;
  const ultimaValida = Number.isInteger(ultima) && (ultima as number) >= 0 && (ultima as number) < variacoes && ultima !== escolhida;
  const ordem = [
    escolhida,
    ...Array.from({ length: variacoes }, (_, k) => k).filter(k => k !== escolhida && k !== ultima),
    ...(ultimaValida ? [ultima as number] : []),
  ];
  const vozes = vozesEmOrdem(vozDe(d));
  const baloesDe = (v: Voz, i: number) => [...(apresentaSempre || !d.funcionariaJaFalou ? [apresentacao(v, i)] : []), ...montar(v, i)];
  for (const i of ordem) {
    for (const v of vozes) {
      const baloes = baloesDe(v, i);
      if (passaNaPreIdentidade(baloes, v, d, desafio)) return comMarca(baloes, chave, i, true);
    }
  }
  return comMarca(baloesDe(vozes[vozes.length - 1], escolhida), chave, escolhida, false);
}

/** §3.1–§3.2: a frase do servidor para cada situação antes da identidade. */
export function textoPreIdentidade(situacao: SituacaoPreIdentidade, dados: DadosDaConversa, semente: SementeDoTexto): BaloesDoServidor {
  const def = PRE[situacao];
  if (!def) throw new TypeError("Situação de pré-identidade desconhecida");
  return montarPre(`pre:${situacao}`, dados, semente, def.variacoes, SITUACOES_COM_DESAFIO.has(situacao), def.apresenta === "sempre", def.montar);
}

/* ───────────────────────── horário da equipe ───────────────────────── */

export type AberturaDaEquipe =
  | { noHorario: true }
  | { noHorario: false; data: string; hora: string; diasAte: number; diaDaSemana: number }
  | { noHorario: false; data: null };

const DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const somarDias = (iso: string, dias: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + dias)).toISOString().slice(0, 10);
const semanaDe = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
const doisDigitos = (n: number) => String(n).padStart(2, "0");

/**
 * Quando a equipe volta, pela MESMA regra de `janelaDoChat` (fuso de Brasília, nunca domingo nem feriado
 * nacional, sábado só se a política deixar, 8h–20h e sábado até 14h como teto legal). §3.4 e s11: fora do
 * horário o cliente fica sabendo que a resposta vem na próxima abertura, e não "já já".
 */
export function proximaAberturaDaEquipe(agora: Date, janela: unknown, diasPausados: readonly string[] = []): AberturaDaEquipe {
  if (!(agora instanceof Date) || !Number.isFinite(agora.getTime())) return { noHorario: false, data: null };
  const pausados = [...(diasPausados ?? [])];
  const { permitida, dia: hoje } = janelaDoChat(agora, janela, pausados);
  if (permitida) return { noHorario: true };
  const validada = JanelaContatoSchema.safeParse(janela);
  const j = validada.success ? validada.data : POLITICA_PADRAO.janelaContato;
  const horaAgora = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(agora));
  for (let dias = 0; dias <= 21; dias++) {
    const dia = somarDias(hoje, dias);
    const semana = semanaDe(dia);
    if (semana === 0 || (semana === 6 && !j.sabado)) continue;
    if (feriadosDoChat(Number(dia.slice(0, 4))).includes(dia) || pausados.includes(dia)) continue;
    const inicio = Math.max(8, j.horaInicio);
    const fim = Math.min(semana === 6 ? j.sabadoHoraFim : j.horaFim, semana === 6 ? 14 : 20);
    if (inicio >= fim || (dias === 0 && horaAgora >= inicio)) continue;
    return { noHorario: false, data: dia, hora: `${doisDigitos(inicio)}:00`, diasAte: dias, diaDaSemana: semana };
  }
  return { noHorario: false, data: null };
}

const turnoDaHora = (hora: string) => (Number(hora.slice(0, 2)) < 12 ? "de manhã" : Number(hora.slice(0, 2)) < 18 ? "à tarde" : "à noite");
const horaFalada = (hora: string) => `${Number(hora.slice(0, 2))}h${hora.slice(3, 5) === "00" ? "" : hora.slice(3, 5)}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Antes da identidade não entra dígito: dia por palavra e turno ("a partir de segunda de manhã"). */
function quandoVoltaSemDigito(a: Extract<AberturaDaEquipe, { data: string }>, hoje: string): string {
  const turno = turnoDaHora(a.hora);
  if (a.diasAte === 0) return `a partir de hoje ${turno}`;
  if (a.diasAte === 1) return `a partir de amanhã ${turno}`;
  if (a.diasAte <= 6) return `a partir de ${DIAS_DA_SEMANA[a.diaDaSemana]} ${turno}`;
  const semanas = Math.floor((diasEntre(somarDias(hoje, -((semanaDe(hoje) + 6) % 7)), a.data)) / 7);
  return semanas === 1 ? `a partir de ${DIAS_DA_SEMANA[a.diaDaSemana]} da semana que vem, ${turno}` : "no próximo horário de atendimento";
}

/**
 * Depois da identidade, dia e hora exatos ("a partir do dia 21/09, às 8h"). O verificador só aceita dia da
 * semana por palavra contra a proposta ou o registro; a data e a hora da abertura entram como FATO da rodada.
 */
function quandoVoltaComData(a: Extract<AberturaDaEquipe, { data: string }>): string {
  const hora = `às ${horaFalada(a.hora)}`;
  if (a.diasAte === 0) return `a partir de hoje, ${hora}`;
  if (a.diasAte === 1) return `a partir de amanhã, ${hora}`;
  return `a partir do dia ${ddmm(a.data)}, ${hora}`;
}

/* ───────────────────────── aviso de transferência ───────────────────────── */

/** Dentro do horário: quem continua, sem prazo. Fora: quem continua e QUANDO responde (a próxima abertura). */
interface FrasesDoAviso {
  reconhece: (v: Voz) => string[];
  /** O mesmo reconhecimento dizendo que o atendimento é automatizado (D1). Ausente: o `reconhece` já diz. */
  reconheceComAutomacao?: (v: Voz) => string[];
  dentro: string[];
  fora: string[];
}

const ENTENDI_COM_AUTOMACAO = () => ["Entendi. Esse atendimento é automatizado.", "Certo, entendi. Aqui o atendimento é automatizado."];
const AVISAR_COM_AUTOMACAO = (v: Voz) => [`${obrigada(v)} por avisar! Esse atendimento é automatizado.`, `Certo, ${obrigada(v).toLowerCase()} por avisar. Aqui o atendimento é automatizado.`];

const PASSAR_A_CONVERSA: Pick<FrasesDoAviso, "dentro" | "fora"> = {
  dentro: ["Vou pedir pra alguém da nossa equipe continuar com você", "Vou passar pra nossa equipe seguir com você", "Vou pedir pra nossa equipe continuar a conversa com você"],
  fora: [
    "Vou passar sua conversa pra nossa equipe, que te responde por aqui",
    "Vou deixar seu atendimento com a nossa equipe, que te responde por aqui",
    "Vou pedir pra nossa equipe continuar com você, e ela te responde por aqui",
  ],
};

/** §3.4: reconhecimento + quem continua. Nenhuma frase promete prazo ("já já", "em instantes", "hoje ainda"). */
const AVISOS: Record<CategoriaDeTransferencia, FrasesDoAviso> = {
  // D1: quem pede "uma pessoa" ou "um humano" pergunta, na prática, quem está atendendo. O aviso responde a verdade
  // antes de passar — e é também o que o verificador exige quando a mensagem do cliente fala de pessoa ou humano.
  pedido_pessoa: {
    reconhece: () => ["Claro! Este atendimento é automatizado.", "Tudo bem! Aqui o atendimento é automatizado.", "Certo! Esse atendimento é automatizado."],
    ...PASSAR_A_CONVERSA,
  },
  juridico: {
    reconhece: () => ["Entendi.", "Certo, entendi."],
    reconheceComAutomacao: ENTENDI_COM_AUTOMACAO,
    dentro: ["Vou passar seu atendimento pra nossa equipe responsável continuar com você", "Vou pedir pra nossa equipe responsável seguir com você"],
    fora: ["Vou passar seu atendimento pra nossa equipe responsável, que te responde por aqui", "Vou deixar isso com a nossa equipe responsável, que te responde por aqui"],
  },
  vulnerabilidade: {
    reconhece: () => ["Sinto muito pelo que você está passando.", "Sinto muito, de verdade."],
    reconheceComAutomacao: () => ["Sinto muito pelo que você está passando. Esse atendimento é automatizado.", "Sinto muito, de verdade. Aqui o atendimento é automatizado."],
    dentro: ["Vou pedir pra alguém da nossa equipe cuidar disso com você", "Vou passar pra nossa equipe cuidar disso junto com você"],
    fora: ["Vou pedir pra nossa equipe cuidar disso com você, e ela te responde por aqui", "Vou passar pra nossa equipe cuidar disso junto com você, e ela te responde por aqui"],
  },
  contestacao: {
    reconhece: () => ["Entendi.", "Certo, entendi."],
    reconheceComAutomacao: ENTENDI_COM_AUTOMACAO,
    dentro: ["Vou pedir pra nossa equipe analisar isso com cuidado e continuar com você", "Vou passar isso pra nossa equipe analisar e seguir com você"],
    fora: ["Vou pedir pra nossa equipe analisar isso com cuidado, e ela te responde por aqui", "Vou passar isso pra nossa equipe analisar, e ela te responde por aqui"],
  },
  pagamento_informado: {
    reconhece: v => [`${obrigada(v)} por avisar!`, `Certo, ${obrigada(v).toLowerCase()} por avisar.`],
    reconheceComAutomacao: AVISAR_COM_AUTOMACAO,
    dentro: ["Vou pedir pra nossa equipe conferir e continuar com você", "Vou passar pra nossa equipe conferir e seguir com você"],
    fora: ["Vou pedir pra nossa equipe conferir, e ela te responde por aqui", "Vou passar pra nossa equipe conferir, e ela te responde por aqui"],
  },
  devolucao_informada: {
    reconhece: v => [`${obrigada(v)} por avisar!`, `Certo, ${obrigada(v).toLowerCase()} por avisar.`],
    reconheceComAutomacao: AVISAR_COM_AUTOMACAO,
    dentro: ["Vou pedir pra nossa equipe conferir a devolução e continuar com você", "Vou passar pra nossa equipe conferir a devolução e seguir com você"],
    fora: ["Vou pedir pra nossa equipe conferir a devolução, e ela te responde por aqui", "Vou passar pra nossa equipe conferir a devolução, e ela te responde por aqui"],
  },
  generica: {
    reconhece: () => ["Pra isso eu preciso da nossa equipe.", "Essa parte fica com a nossa equipe."],
    // a automação vem antes, para o "de lá" e o "ela" da frase seguinte continuarem sendo a equipe
    reconheceComAutomacao: () => ["Esse atendimento é automatizado, e pra isso eu preciso da nossa equipe.", "Aqui o atendimento é automatizado, e essa parte fica com a nossa equipe."],
    dentro: ["Vou pedir pra alguém de lá continuar com você", "Vou passar sua conversa pra quem cuida disso seguir com você"],
    fora: ["Vou passar sua conversa pra ela, que te responde por aqui", "Vou deixar sua conversa com ela, que te responde por aqui"],
  },
};
/** Antes da identidade a categoria não aparece: o motivo da transferência já diria qual é o assunto. */
const AVISO_PRE_IDENTIDADE: FrasesDoAviso = { reconhece: () => ["Certo!", "Tudo bem!", "Entendi!"], ...PASSAR_A_CONVERSA };
/** Antes da identidade, para quem contou algo delicado (falecimento, internação): acolhe sem nomear o assunto. */
const AVISO_PRE_IDENTIDADE_SENSIVEL: FrasesDoAviso = { reconhece: () => ["Sinto muito.", "Sinto muito, de verdade.", "Poxa, sinto muito."], ...PASSAR_A_CONVERSA };

/**
 * §3.4: o aviso que sai quando a conversa vai à equipe. QUANDO não avisar (contestação aberta, opt-out, cota,
 * falha de envio, humano assumiu…) é decisão do serviço; esta função só escreve a frase.
 */
export function avisoDeTransferencia(categoria: CategoriaDeTransferencia, dados: DadosDoAviso, semente: SementeDoTexto): BaloesDoServidor {
  const pos = dados?.identidadeConfirmada === true;
  const sensivel = !pos && categoria === "vulnerabilidade";
  const def = pos ? AVISOS[categoria] : sensivel ? AVISO_PRE_IDENTIDADE_SENSIVEL : AVISO_PRE_IDENTIDADE;
  if (!def) throw new TypeError("Categoria de transferência desconhecida");
  const chave = pos ? `aviso:${categoria}` : sensivel ? "aviso:neutro_sensivel" : "aviso:neutro";
  const total = Math.max(def.reconhece(vozDe({})).length, def.dentro.length, def.fora.length);
  const abertura = proximaAberturaDaEquipe(dados?.agora, dados?.janela, dados?.diasPausados ?? []);
  const relogioValido = dados?.agora instanceof Date && Number.isFinite(dados.agora.getTime());
  const hoje = relogioValido ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(dados.agora) : "";
  const frase = (v: Voz, i: number, reconhecer: (v: Voz) => string[]) => {
    const reconhece = reconhecer(v);
    const primeira = reconhece[i % reconhece.length];
    if (abertura.noHorario) return [`${primeira} ${def.dentro[i % def.dentro.length]} por aqui, tá?`];
    const quando = abertura.data === null ? "no próximo horário de atendimento" : pos ? quandoVoltaComData(abertura) : quandoVoltaSemDigito(abertura, hoje);
    return [`${primeira} ${def.fora[i % def.fora.length]} ${quando}.`];
  };
  if (!pos) return montarPre(chave, dados, semente, total, false, false, (v, i) => frase(v, i, def.reconhece));
  const i = escolherVariacao(chave, total, semente);
  const v = vozDe(dados);
  // depois da identidade ela já falou (pediu os dígitos): só se apresenta se o serviço disser explicitamente que não
  const apresenta = dados.funcionariaJaFalou === false ? [apresentacao(v, i)] : [];
  const baloes = [...apresenta, ...frase(v, i, def.reconhece)];
  // D1 com transferência por outra categoria: a regra de "quem atende" é do verificador (sobre a mensagem do
  // cliente), então quem decide é ele — troca só quando o aviso da categoria reprova e o com a automação passa.
  if (def.reconheceComAutomacao && typeof dados.ultimaMensagemDoCliente === "string" && relogioValido) {
    const comAutomacao = [...apresenta, ...frase(v, i, def.reconheceComAutomacao)];
    const ctx: Parameters<typeof verificarMensagens>[1] = {
      fase: "pos_identidade",
      acao: "transferir",
      situacao: "conversa",
      carteira: dados.carteira ?? "ativo",
      fatos: abertura.noHorario || abertura.data === null ? {} : { datas: [{ id: "abertura", data: abertura.data }], horas: [abertura.hora] },
      nomes: { persona: v.persona ?? "", provedor: v.provedor ?? "", primeiroNomeCliente: v.cliente },
      hoje,
      ultimaMensagemDoCliente: dados.ultimaMensagemDoCliente,
      baloesJaEnviados: [],
    };
    if (!verificarMensagens(baloes, ctx).ok && verificarMensagens(comAutomacao, ctx).ok) return comMarca(comAutomacao, chave, i);
  }
  return comMarca(baloes, chave, i);
}

/* ───────────────────────── reservas depois da identidade ───────────────────────── */

const isoValido = (iso: unknown): iso is string =>
  typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) && new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso;

/** "R$ 1.234,56" com espaço comum: é o formato que o verificador lê e o que a pessoa escreve. */
export function formatarReais(centavos: number): string {
  if (!Number.isInteger(centavos) || centavos <= 0) throw new TypeError("Valor em centavos inválido");
  const inteiro = Math.floor(centavos / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${inteiro},${doisDigitos(centavos % 100)}`;
}

/** "pra sexta, dia 20/09" até seis dias; depois só "pro dia 20/09" (o dia da semana ficaria ambíguo). */
function quandoDaData(data: string, hoje: string): string {
  const dias = diasEntre(hoje, data);
  if (dias === 0) return `pra hoje, dia ${ddmm(data)}`;
  if (dias === 1) return `pra amanhã, dia ${ddmm(data)}`;
  if (dias >= 2 && dias <= 6) return `pra ${DIAS_DA_SEMANA[semanaDe(data)]}, dia ${ddmm(data)}`;
  return `pro dia ${ddmm(data)}`;
}

/** §3.3: manhã = 09:00 e tarde = 14:00 são o turno que o cliente disse; outra hora sai por extenso curto ("às 10h30"). */
const turnoOuHora = (hora: string) => (hora === "09:00" ? "de manhã" : hora === "14:00" ? "à tarde" : `às ${horaFalada(hora)}`);

function ajudaDaCobranca(d: DadosDaReserva): string {
  if (d.permitirSegundaVia && d.permitirPromessa) return "Se quiser, posso te mandar a segunda via, ou a gente combina um dia pra você pagar. Como prefere?";
  if (d.permitirSegundaVia) return "Se quiser, posso te mandar a segunda via, é só me dizer.";
  if (d.permitirPromessa) return "Se ficar melhor, a gente combina um dia pra você pagar. Qual dia seria bom?";
  return "Se preferir, alguém da nossa equipe continua com você por aqui.";
}

function pedirDataDaDevolucao(d: DadosDaReserva): string[] {
  return d.permitirAgendamento
    ? [
        "Qual dia fica bom pra devolução do aparelho, de manhã ou à tarde?",
        "Me diz um dia pra devolução do aparelho e se prefere de manhã ou à tarde?",
        "Pra devolução do aparelho, qual dia é melhor pra você, de manhã ou à tarde?",
      ]
    : [
        "Sobre a devolução, quem combina o dia é a nossa equipe. Se preferir, alguém da equipe continua com você por aqui.",
        "O dia da devolução quem combina é a nossa equipe. Se preferir, alguém da equipe segue com você por aqui.",
      ];
}

/**
 * A regra do valor no turno da identidade é do verificador (`perguntaDeValor` sobre a mensagem do cliente); repetir
 * a lista aqui faria as duas divergirem na primeira edição. Então a reserva pergunta a ele, com o saldo como fato, e
 * só olha ESTE motivo: qualquer outra recusa não é sobre o valor.
 */
function valorRecusadoNoTurnoDaIdentidade(texto: string, d: DadosDaReserva, v: Voz): boolean {
  const r = verificarMensagens([texto], {
    fase: "pos_identidade",
    acao: "responder",
    situacao: "identidade_recem_confirmada",
    carteira: d.carteira,
    fatos: { valores: [{ id: "saldo", centavos: d.saldoCentavos as number }] },
    nomes: { persona: v.persona ?? "", provedor: v.provedor ?? "", primeiroNomeCliente: v.cliente },
    hoje: d.hoje,
    ultimaMensagemDoCliente: typeof d.ultimaMensagemDoCliente === "string" ? d.ultimaMensagemDoCliente : null,
    baloesJaEnviados: [],
  });
  return !r.ok && r.motivo === "valor_no_turno_da_identidade";
}

/**
 * Do que se trata o contato, sem número (§3.3). Do ex-cliente é "pendência": a dívida pode ser a fatura de saída ou
 * mensalidades de antes do cancelamento. A de equipamentos não fala de dinheiro (§6.14).
 */
const ASSUNTO_DO_CONTATO: Record<CarteiraDoTexto, string> = {
  ativo: "É sobre a sua mensalidade, que ficou em aberto aqui com a gente.",
  ex_cliente: "É sobre o contrato que foi encerrado: ficou uma pendência em aberto.",
  equipamentos: "É sobre o aparelho que ficou com você depois do encerramento do contrato.",
};

/**
 * O começo da primeira fala depois dos 4 dígitos (§3.3, revisão final): agradece pelo primeiro nome e, quando a fala
 * não cita o valor, diz do que se trata. Sem isto o cliente mandava "8909" e recebia "Vamos ver isso juntos. Se quiser,
 * posso te mandar a segunda via…", sem saber do quê — e com a chave D9 desligada (o padrão) TODA conversa passa por
 * esse turno. A reserva do turno (`reservaPosIdentidade` com `identidadeRecemConfirmada`) e os roteiros da demonstração
 * (`server/demo/chat-simulado.ts`) começam por aqui, para as duas contarem a mesma conversa.
 */
export function confirmacaoDaIdentidade(dados: DadosDaConversa & { carteira: CarteiraDoTexto }, opcoes: { comAssunto: boolean }): string {
  const v = vozDe(dados);
  const agradece = v.cliente ? `${obrigada(v)} por confirmar, ${v.cliente}!` : `${obrigada(v)} por confirmar!`;
  const assunto = ASSUNTO_DO_CONTATO[dados.carteira];
  if (!assunto) throw new TypeError("Carteira desconhecida");
  return opcoes.comAssunto ? `${agradece} ${assunto}` : agradece;
}

/**
 * A resposta controlada. No turno em que a identidade acabou de ser confirmada, toda resposta — menos o agradecimento,
 * que já agradece — começa por `confirmacaoDaIdentidade`: com o assunto, ou só o obrigada quando a frase cita o saldo
 * (o cliente perguntou o valor, e ele já diz do que se trata).
 */
function respostas(resposta: RespostaControlada, d: DadosDaReserva, v: Voz): { chave: string; opcoes: string[] } {
  const base = respostasDaConversa(resposta, d, v);
  if (d.identidadeRecemConfirmada !== true || resposta === "agradecer") return base;
  const saldo = Number.isInteger(d.saldoCentavos) && (d.saldoCentavos as number) > 0 ? formatarReais(d.saldoCentavos as number) : null;
  return { chave: base.chave, opcoes: base.opcoes.map(o => `${confirmacaoDaIdentidade(d, { comAssunto: !(saldo && o.includes(saldo)) })} ${o}`) };
}

function respostasDaConversa(resposta: RespostaControlada, d: DadosDaReserva, v: Voz): { chave: string; opcoes: string[] } {
  const equipamentos = d.carteira === "equipamentos";
  const saldo = Number.isInteger(d.saldoCentavos) && (d.saldoCentavos as number) > 0 ? formatarReais(d.saldoCentavos as number) : null;
  const acolhida = ["Tô aqui pra te ajudar com isso.", "Pode contar comigo por aqui.", "Vamos ver isso juntos."];
  const acolher = (): { chave: string; opcoes: string[] } => {
    if (!equipamentos) return { chave: "pos:acolher", opcoes: acolhida.map(f => `${f} ${ajudaDaCobranca(d)}`) };
    const devolucao = pedirDataDaDevolucao(d);
    return { chave: "pos:acolher", opcoes: acolhida.map((f, i) => `${f} ${devolucao[i % devolucao.length]}`) };
  };
  const pedirData = (chave: string) =>
    equipamentos
      ? { chave, opcoes: pedirDataDaDevolucao(d) }
      : d.permitirPromessa
        ? { chave, opcoes: ["Qual dia fica bom pra você pagar?", "Me fala um dia que fica bom pra você fazer o pagamento?", "Pra quando fica melhor pra você resolver? Me diz o dia."] }
        : {
            chave,
            opcoes: [
              "Pra combinar uma data, preciso da nossa equipe. Se preferir, alguém da equipe continua com você por aqui.",
              "Essa parte de data fica com a nossa equipe. Se preferir, alguém da equipe segue com você por aqui.",
            ],
          };
  switch (resposta) {
    case "informar_divida": {
      // sem leitura ao vivo não há número (a IA não fala valor que não leu); equipamentos nunca fala de dinheiro
      if (equipamentos) return pedirData("pos:informar_divida");
      if (!saldo) return acolher();
      const opcoes = (d.carteira === "ex_cliente"
        ? [`Do contrato que foi encerrado, ficou ${saldo} em aberto.`, `Ficou ${saldo} em aberto do contrato que foi encerrado.`, `Do seu contrato encerrado, o que ficou em aberto é ${saldo}.`]
        : [`Olhando aqui, tem ${saldo} em aberto.`, `O que ficou em aberto é ${saldo}.`, `Tá em aberto ${saldo}.`]
      ).map(f => `${f} ${ajudaDaCobranca(d)}`);
      // §3.3: no turno da identidade recém-confirmada, sem pergunta de valor, a acolhida sem R$
      if (d.identidadeRecemConfirmada === true && valorRecusadoNoTurnoDaIdentidade(opcoes[0], d, v)) return acolher();
      return { chave: "pos:informar_divida", opcoes };
    }
    case "pedir_data":
      return pedirData("pos:pedir_data");
    case "pedir_confirmacao":
      return pedirData("pos:pedir_confirmacao");
    case "orientar_devolucao":
      return equipamentos
        ? pedirData("pos:orientar_devolucao")
        : {
            chave: "pos:orientar_devolucao",
            opcoes: [
              "Sobre o aparelho, quem cuida é a nossa equipe de equipamentos. Se preferir, alguém da equipe continua com você por aqui.",
              "A devolução do aparelho fica com a nossa equipe de equipamentos. Se preferir, alguém de lá segue com você por aqui.",
            ],
          };
    case "agradecer":
      return {
        chave: "pos:agradecer",
        opcoes: [
          `${obrigada(v)} pelo retorno! Se precisar de mais alguma coisa, é só me chamar por aqui.`,
          "Eu que agradeço! Qualquer coisa, é só me chamar por aqui.",
          `${obrigada(v)} por responder! Se precisar, me chama por aqui.`,
        ],
      };
    case "acolher":
    default:
      return acolher();
  }
}

function reservas(pedido: PedidoDeReserva, d: DadosDaReserva, v: Voz): { chave: string; opcoes: string[] } {
  switch (pedido.tipo) {
    case "resposta":
      return respostas(pedido.resposta, d, v);
    case "audio":
      return {
        chave: "pos:audio",
        opcoes: ["Por aqui eu não consigo ouvir áudio. Consegue me mandar por escrito?", "Não consigo ouvir áudio por aqui. Me escreve, por favor?", "Áudio eu não consigo ouvir por aqui. Pode me mandar por escrito?"],
      };
    // D1 depois da identidade: confirma a automação, oferece alguém da equipe e devolve a conversa. Não pede dígitos
    // (a identidade já foi) nem transfere: quem transfere é o pedido de pessoa (§3.3).
    case "pergunta_robo": {
      const agradece = d.identidadeRecemConfirmada === true ? `${confirmacaoDaIdentidade(d, { comAssunto: true })} ` : "";
      return {
        chave: "pos:pergunta_robo",
        opcoes: [
          `${agradece}É um atendimento automatizado ${daEmpresa(v)}, com supervisão da nossa equipe. Se preferir falar com alguém da equipe, é só me dizer. Se não, a gente segue por aqui.`,
          `${agradece}Sim, por aqui é um atendimento automatizado, acompanhado pela nossa equipe. Se quiser falar com alguém da equipe, é só pedir. Ou, se preferir, seguimos por aqui mesmo.`,
          `${agradece}Esse atendimento é automatizado, com a supervisão da nossa equipe ${daEmpresa(v)}. Se preferir, alguém da equipe continua com você. Se não, me diz como posso te ajudar.`,
        ],
      };
    }
    case "proposta": {
      const p = pedido.proposta;
      if (!isoValido(p?.data)) throw new TypeError("Data da proposta inválida");
      const quando = quandoDaData(p.data, d.hoje);
      if (p.acao === "agendar") {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.hora)) throw new TypeError("Hora da proposta inválida");
        const hora = turnoOuHora(p.hora);
        return {
          chave: "pos:proposta_agendamento",
          opcoes: [`Posso marcar a devolução do aparelho ${quando}, ${hora}?`, `Então fica a devolução ${quando}, ${hora}. Posso marcar?`, `Posso anotar a devolução do aparelho ${quando}, ${hora}?`],
        };
      }
      if (p.valorCentavos === undefined) return { chave: "pos:proposta_promessa", opcoes: [`Posso anotar o pagamento ${quando}?`, `Posso anotar que você paga ${quando}?`] };
      const valor = formatarReais(p.valorCentavos);
      return {
        chave: "pos:proposta_promessa",
        opcoes: [`Posso anotar o pagamento de ${valor} ${quando}?`, `Então fica ${valor} ${quando}. Posso anotar?`, `Posso anotar que você paga ${valor} ${quando}?`],
      };
    }
    case "registrado": {
      const g = pedido.gravado;
      if (!isoValido(g?.data)) throw new TypeError("Data do registro inválida");
      const quando = quandoDaData(g.data, d.hoje);
      const o = obrigada(v);
      if (g.tipo === "agendamento") {
        const hora = g.hora && /^([01]\d|2[0-3]):[0-5]\d$/.test(g.hora) ? `, ${turnoOuHora(g.hora)}` : "";
        return {
          chave: "pos:registrado_agendamento",
          opcoes: [`Marquei aqui a devolução do aparelho ${quando}${hora}. ${o}!`, `Anotado! Devolução do aparelho ${quando}${hora}.`, `Tá marcado ${quando}${hora}, pra devolução do aparelho. ${o} pelo retorno!`],
        };
      }
      const valor = g.valorCentavos === undefined ? null : formatarReais(g.valorCentavos);
      if (g.tipo === "acordo") {
        return {
          chave: "pos:registrado_acordo",
          opcoes: valor
            ? [
                `Fechado! Registrei o acordo, com o primeiro pagamento de ${valor} ${quando}. A nossa equipe prepara a cobrança e te orienta por aqui.`,
                `Acordo registrado! Primeiro pagamento de ${valor} ${quando}. A nossa equipe prepara a cobrança e te orienta por aqui.`,
              ]
            : [
                `Fechado! Registrei o acordo, com o primeiro pagamento ${quando}. A nossa equipe prepara a cobrança e te orienta por aqui.`,
                `Acordo registrado! Primeiro pagamento ${quando}. A nossa equipe prepara a cobrança e te orienta por aqui.`,
              ],
        };
      }
      return {
        chave: "pos:registrado_promessa",
        opcoes: valor
          ? [
              `Anotado! Pagamento de ${valor} ${quando}. Até o pagamento ser confirmado, o valor continua em aberto.`,
              `Registrei aqui: ${valor} ${quando}. ${o}!`,
              `Tá anotado ${quando}, no valor de ${valor}. ${o} pelo retorno!`,
            ]
          : [`Anotado! Pagamento ${quando}.`, `Registrei aqui o pagamento ${quando}. ${o}!`],
      };
    }
    // §3.3: sem número e sem nomear o instrumento — o balão seguinte, do servidor, traz a fatura certa
    case "introducao_segunda_via":
      return { chave: "pos:introducao_segunda_via", opcoes: ["Claro! Segue aqui embaixo.", "Pronto, segue aqui pra você.", "Tá aqui embaixo pra você."] };
    // §3.3: sem número; as linhas das opções seguem do servidor num balão próprio
    case "introducao_ofertas":
      return {
        chave: "pos:introducao_ofertas",
        opcoes: [
          "Dentro da nossa política, consegui essas condições pra você. Me diz qual opção prefere e o dia do primeiro pagamento.",
          "Separei as opções que cabem na nossa política. É só me dizer qual fica melhor e o dia do primeiro pagamento.",
          "Olha só as condições que a gente consegue fazer. Me fala a opção e o dia que fica bom pra começar.",
        ],
      };
    default:
      throw new TypeError("Reserva desconhecida");
  }
}

/**
 * D6 e §7: a reserva humanizada que sai quando o texto do modelo é recusado (ou não veio). A AÇÃO já foi
 * executada pelo servidor; esta frase só fala dela. Datas em dd/mm, valor lido ao vivo, nada de "ERP".
 */
export function reservaPosIdentidade(pedido: PedidoDeReserva, dados: DadosDaReserva, semente: SementeDoTexto): BaloesDoServidor {
  if (!dados || !isoValido(dados.hoje)) throw new TypeError("`hoje` inválido");
  const v = vozDe(dados);
  const { chave, opcoes } = reservas(pedido, dados, v);
  const i = escolherVariacao(chave, opcoes.length, semente);
  return comMarca([...(dados.funcionariaJaFalou === false ? [apresentacao(v, i)] : []), opcoes[i]], chave, i);
}
