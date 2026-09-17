/**
 * Triagem da mensagem do CLIENTE para a funcionária digital (spec 2026-09-16, §3.2 e §3.3).
 *
 * POR QUE existe: antes, uma lista só (`exigeHumano`) decidia tudo com palavras soltas, rodando
 * antes da identidade. "é golpe?" e "você é humano?" transferiam sem resposta (f3); "para de mandar
 * msg", "é engano" e "sou o filho dela" seguiam para a IA, que pedia os dígitos de novo (s6); "quem
 * paga é meu marido" transferia porque casava `paga`; e "fiz o pix ontem" não transferia (s10). Aqui
 * cada situação tem o seu detector, na ordem da spec, e os de pagamento sabem a DATA de hoje.
 *
 * Puro: sem banco, rede ou relógio. `hoje` é sempre "AAAA-MM-DD" no calendário de Brasília, vindo de
 * fora (`dataLocal` no servidor). Nada aqui guarda, registra ou devolve o texto do cliente: o que sai
 * é categoria, data ou hora.
 */
import { VOCABULARIO, normalizarParaVerificacao } from "./chat-funcionaria-digital";
import type { CategoriaDeTransferencia, SituacaoPreIdentidade } from "./chat-funcionaria-textos";

/* ───────────────────────── normalização ───────────────────────── */

/**
 * "IA" maiúsculo é a sigla ("é IA?"); minúsculo, "ia" é quase sempre o verbo ("eu ia pagar"). A caixa só
 * existe antes da normalização — o mesmo cuidado do verificador (B1), para que as duas pontas concordem
 * sobre o que é uma pergunta sobre QUEM atende.
 */
const SIGLA_IA = /(?<![\p{L}\p{N}])I\.A\.?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])IA(?![\p{L}\p{N}])/gu;

/** Minúsculas, sem acento e sem invisíveis; "?" e dígitos preservados (o detector de pergunta precisa do "?"). */
export function normalizarMensagemDoCliente(texto: string): string {
  return normalizarParaVerificacao(texto.normalize("NFKC").replace(SIGLA_IA, "inteligência artificial"));
}

// "#" no fim de um fragmento = fim de palavra; o começo é sempre início de palavra.
const FIM = "(?![a-z0-9])";
function compilar(fragmentos: readonly string[]): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${fragmentos.map(f => f.replace(/#/g, FIM)).join("|")})`, "g");
}
const casa = (re: RegExp, t: string) => { re.lastIndex = 0; return re.test(t); };

/**
 * Negação logo antes do trecho ("ainda não paguei", "nem devolvi"): "não paguei" é o contrário de
 * pagamento informado. Uma palavra pode ficar no meio ("não te paguei"); vírgula não ("não esqueci, já paguei").
 */
const NEGACAO_ANTES = /(?<![a-z])(?:nao|nem|nunca|jamais)(?: [a-z]+)? ?$/;
/**
 * Negação do PEDIDO de pessoa (correção 2 da B3): só nega quando vem colada ao pedido ou ao verbo de vontade
 * dele ("não quero falar com…", "não preciso de atendente"). Com a regra genérica, "não entendi, quero falar
 * com atendente" negava o pedido — a palavra do meio era "entendi".
 */
// "precisa": "não precisa passar pra equipe" recusa a oferta da D1, não a aceita
const NEGACAO_DO_PEDIDO = /(?<![a-z])(?:nao|nem|nunca|jamais) (?:(?:quero|queria|preciso|precisa|gostaria|desejo|vou|pode|podem)(?: de)? (?:mais )?)?$/;
function casaSemNegacao(re: RegExp, t: string, negacao: RegExp = NEGACAO_ANTES, sobrepor = false): boolean {
  re.lastIndex = 0;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (!negacao.test(t.slice(Math.max(0, m.index - 24), m.index))) return true;
    // sobrepor: o trecho negado pode conter outro que não é ("não consigo | falar com atendente")
    if (sobrepor || m[0].length === 0) re.lastIndex = m.index + 1;
  }
  return false;
}

/* ───────────────────────── datas e horas (Brasília) ───────────────────────── */

/** Até quantos dias à frente uma data dita pelo cliente vira candidata (spec §3.3). */
export const JANELA_DAS_DATAS_EM_DIAS = 90;

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS_DA_SEMANA = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

function isoValida(ano: number, mes: number, dia: number): string | null {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || !Number.isInteger(dia) || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia, 12));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? d.toISOString().slice(0, 10) : null;
}
/** Soma dias a uma data de CALENDÁRIO (meio-dia UTC: nenhum fuso ou horário de verão muda o dia). */
export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const hojeValido = (hoje: string) => /^\d{4}-\d{2}-\d{2}$/.test(hoje) && isoValida(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), Number(hoje.slice(8, 10))) === hoje;

/** Dia e mês sem ano: a próxima ocorrência a partir de hoje (este ano, senão o que vem). */
function proximaDoDiaMes(dia: number, mes: number, hoje: string): string | null {
  const ano = Number(hoje.slice(0, 4));
  const esteAno = isoValida(ano, mes, dia);
  if (esteAno && esteAno >= hoje) return esteAno;
  return isoValida(ano + 1, mes, dia);
}
/** "dia N": este mês se ainda não passou; senão o próximo mês que TEM o dia N. */
function proximaDoDia(dia: number, hoje: string): string | null {
  const ano = Number(hoje.slice(0, 4)), mes = Number(hoje.slice(5, 7));
  for (let k = 0; k < 4; k++) {
    const m = ((mes - 1 + k) % 12) + 1, a = ano + Math.floor((mes - 1 + k) / 12);
    const iso = isoValida(a, m, dia);
    if (iso && iso >= hoje) return iso;
  }
  return null;
}
const apagar = (t: string, inicio: number, tamanho: number) => t.slice(0, inicio) + " ".repeat(tamanho) + t.slice(inicio + tamanho);

export interface DatasDaMensagem {
  /** "AAAA-MM-DD", de hoje até hoje + 90 dias, sem repetição, em ordem. */
  datas: string[];
  /** "HH:MM" que a mensagem cita ("14h", "14:30", "2 da tarde", "meio-dia"; "manhã" = 09:00, "tarde" = 14:00). */
  horas: string[];
}

/**
 * As datas e horas que o CLIENTE disse, resolvidas para o calendário de Brasília (spec §3.3, f2).
 * Existe para que "pago dia 20", "fechado, quinta então" e "pode buscar sexta de manhã" virem proposta:
 * antes só a data digitada como d/m, "hoje" ou "amanhã" contava, e o resto caía na reserva pedindo
 * "dia/mês". A data que o planejador propuser tem que ser UMA destas — ele não inventa data.
 *
 * Reconhece: dd/mm, dd/mm/aaaa (e aa), AAAA-MM-DD, "20 de setembro", "dia N" (próxima ocorrência), dia
 * da semana (próxima ocorrência; hoje mesmo também vale a da semana seguinte, e "que vem"/"próxima"
 * acrescentam a seguinte), hoje, amanhã, depois de amanhã. Data passada ou além de 90 dias não entra.
 */
export function resolverDatasDaMensagem(texto: string, hoje: string): DatasDaMensagem {
  const { datas, horas } = extrairDatasEHoras(texto, hoje);
  return { datas, horas };
}

export interface DatasEHorasComResto extends DatasDaMensagem {
  /** O texto normalizado com as datas e horas reconhecidas apagadas (espaços). Serve para ler o que SOBRA ("sim, dia 20" → "sim,"). */
  resto: string;
}

/**
 * `resolverDatasDaMensagem` com o que sobra do texto. Existe para a confirmação da proposta (revisão B3):
 * "sim, dia 20" responde à proposta de 20/09 e não é "número novo", mas só se TODA data e hora citada for a
 * da proposta — quem decide isso é quem chama; aqui só se separa o que é data do que é palavra.
 */
export function extrairDatasEHoras(texto: string, hoje: string): DatasEHorasComResto {
  const normalizado = normalizarMensagemDoCliente(texto).replace(/\n/g, " ");
  if (!hojeValido(hoje)) return { datas: [], horas: [], resto: normalizado };
  let t = normalizado;
  const datas = new Set<string>();
  const limite = somarDias(hoje, JANELA_DAS_DATAS_EM_DIAS);
  const aceitar = (iso: string | null) => { if (iso && iso >= hoje && iso <= limite) datas.add(iso); };
  const consumir = (re: RegExp, tratar: (m: RegExpExecArray) => void) => {
    for (let m = re.exec(t); m; m = re.exec(t)) { tratar(m); t = apagar(t, m.index, m[0].length); re.lastIndex = m.index + m[0].length; }
  };

  consumir(/(?<![0-9])(\d{4})-(\d{2})-(\d{2})(?![0-9])/g, m => aceitar(isoValida(Number(m[1]), Number(m[2]), Number(m[3]))));
  // "R$ 3.10" é valor, não 3 de outubro
  consumir(/(?<![0-9]|r\$ ?)(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?![0-9]|[/.-]\d)/g, m => {
    const dia = Number(m[1]), mes = Number(m[2]);
    if (!m[3]) { aceitar(proximaDoDiaMes(dia, mes, hoje)); return; }
    aceitar(isoValida(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mes, dia));
  });
  consumir(new RegExp(`(?<![0-9])(\\d{1,2})o? de (${MESES.join("|")})(?: de (\\d{4}))?(?![a-z])`, "g"), m => {
    const mes = MESES.indexOf(m[2]) + 1;
    aceitar(m[3] ? isoValida(Number(m[3]), mes, Number(m[1])) : proximaDoDiaMes(Number(m[1]), mes, hoje));
  });
  // "dia 20 do mês que vem" é 20/10, não 20/09 (correção 2); "dia 5 do mês passado" já foi
  consumir(/(?<![a-z])dia (primeiro|\d{1,2})(?:o|a)?(?![0-9a-z])(?: (?:do |no |desse |deste )?(mes que vem|proximo mes|mes seguinte|outro mes|mes passado)(?![a-z]))?/g, m => {
    const dia = m[1] === "primeiro" ? 1 : Number(m[1]);
    if (m[2] === "mes passado") return;
    if (!m[2]) { aceitar(proximaDoDia(dia, hoje)); return; }
    const mes = Number(hoje.slice(5, 7));
    aceitar(isoValida(Number(hoje.slice(0, 4)) + (mes === 12 ? 1 : 0), mes === 12 ? 1 : mes + 1, dia));
  });
  // "segunda via", "quinta parcela" e "sexta vez" não são dia da semana; "sexta passada" já foi
  const ORDINAL = "(?:via|vez|parcela|fatura|opcao|boleto|conta|mensalidade|chamada|prestacao)";
  consumir(new RegExp(`(?<![a-z])(${DIAS_DA_SEMANA.join("|")})(?:-feira| feira)?(?! ${ORDINAL}(?![a-z]))(?![a-z])( (?:que vem|passad[oa]|seguinte))?`, "g"), m => {
    if (m[2]?.startsWith(" passad")) return;
    const k = (DIAS_DA_SEMANA.indexOf(m[1]) - diaDaSemana(hoje) + 7) % 7;
    aceitar(somarDias(hoje, k));
    if (k === 0 || m[2] || /(?<![a-z])proxim[ao] $/.test(t.slice(Math.max(0, m.index - 8), m.index))) aceitar(somarDias(hoje, k + 7));
  });
  consumir(/(?<![a-z])depois de amanha(?![a-z])/g, () => aceitar(somarDias(hoje, 2)));
  consumir(/(?<![a-z])amanha(?![a-z])/g, () => aceitar(somarDias(hoje, 1)));
  consumir(/(?<![a-z])(?:hoje|hj)(?![a-z])/g, () => aceitar(hoje));

  // As horas saem do texto ORIGINAL (o resultado de sempre); o resto apaga também as horas do texto já sem datas.
  return { datas: [...datas].sort(), horas: consumirHoras(normalizado).horas, resto: consumirHoras(t).resto };
}

const hhmm = (h: number, m = 0) => (Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : null);

/** Horas citadas. Período sem número: manhã = 09:00, tarde = 14:00 (spec §3.3). "boa tarde" e "mais tarde" não são hora. */
function consumirHoras(normalizado: string): { horas: string[]; resto: string } {
  let t = normalizado;
  const horas = new Set<string>();
  const aceitar = (h: string | null) => { if (h) horas.add(h); };
  const consumir = (re: RegExp, tratar: (m: RegExpExecArray) => void) => {
    for (let m = re.exec(t); m; m = re.exec(t)) { tratar(m); t = apagar(t, m.index, m[0].length); re.lastIndex = m.index + m[0].length; }
  };
  consumir(/(?<![0-9])(\d{1,2}):(\d{2})(?![0-9])/g, m => aceitar(hhmm(Number(m[1]), Number(m[2]))));
  consumir(/(?<![0-9/.-])(\d{1,2}) ?(?:h|hs|hrs|horas?)(?: ?(\d{2}))?(?: (?:da|de) (manha|tarde|noite))?(?![a-z0-9])/g, m => {
    const h = Number(m[1]);
    aceitar(hhmm(m[3] && m[3] !== "manha" && h < 12 ? h + 12 : h, m[2] ? Number(m[2]) : 0));
  });
  // "dia 10 de manhã" é a manhã do dia 10, não 10 horas
  // e "10/9 de tarde" é a tarde do dia 10/9, não 21 horas
  consumir(/(?<![0-9/.-]|dia )(\d{1,2}) (?:da|de) (manha|tarde|noite)(?![a-z])/g, m => {
    const h = Number(m[1]);
    aceitar(hhmm(m[2] !== "manha" && h < 12 ? h + 12 : h));
  });
  consumir(/(?<![a-z])meio[- ]dia(?![a-z])/g, () => aceitar("12:00"));
  // "às 3" sozinho é 15:00: ninguém combina pagamento ou retirada de madrugada (correção 2 — antes entravam
  // 03:00 e 15:00, e "sexta às 3" validava agendamento às 03:00). "às 6" e "às 7" ficam ambíguos de verdade
  // (manhã cedo ou noite): as duas entram, e a pergunta de confirmação cita a hora escolhida.
  consumir(/(?<![a-z])(?:as|a partir das|depois das|antes das|umas) (\d{1,2})(?![0-9:a-z])/g, m => {
    const h = Number(m[1]);
    if (h < 1 || h > 5) aceitar(hhmm(h));
    if (h >= 1 && h <= 7) aceitar(hhmm(h + 12));
  });
  consumir(/(?<![a-z])manha(?![a-z])/g, () => aceitar("09:00"));
  consumir(/(?<![a-z])(?<!boa |mais |fim de |final da |fim da )tarde(?![a-z])/g, () => aceitar("14:00"));
  return { horas: [...horas].sort(), resto: t };
}

/* ───────────────────────── tipo da mensagem ───────────────────────── */

export type TipoDaMensagem = "texto" | "vazia" | "so_emoji" | "figurinha_ou_reacao" | "audio" | "imagem_ou_documento" | "outra_midia";

const SO_EMOJI = /^(?:[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u200d\ufe0f\u20e3]|\s)+$/u;
const TEM_PICTOGRAMA = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/u;

/**
 * O que chegou, pelo `type` do Chat BullQ e pelo texto (f12). Figurinha, reação e mensagem só de emoji não
 * são pedido de nada; áudio pede para escrever; imagem ou documento é possível comprovante. Vídeo,
 * localização, contato e tipo desconhecido vão para `outra_midia` — quem lê é a equipe.
 */
export function tipoDaMensagem(tipo: string | null | undefined, texto: string | null | undefined): TipoDaMensagem {
  const t = String(tipo ?? "").toUpperCase();
  if (t === "STICKER" || t === "REACTION") return "figurinha_ou_reacao";
  if (t === "AUDIO" || t === "VOICE" || t === "PTT") return "audio";
  if (t === "IMAGE" || t === "DOCUMENT") return "imagem_ou_documento";
  if (t !== "TEXT") return "outra_midia";
  const conteudo = (texto ?? "").trim();
  if (!conteudo) return "vazia";
  return SO_EMOJI.test(conteudo) && TEM_PICTOGRAMA.test(conteudo) ? "so_emoji" : "texto";
}

/* ───────────────────────── vocabulário (DADO) ───────────────────────── */

const PARENTES = "(?:marido|esposo|esposa|mulher|filho|filha|mae|pai|irmao|irma|avo|vo|neto|neta|tio|tia|sobrinho|sobrinha|primo|prima|genro|nora|sogro|sogra|cunhado|cunhada|namorado|namorada|noivo|noiva|companheiro|companheira|vizinho|vizinha|amigo|amiga|colega|patrao|patroa|chefe|funcionario|funcionaria|secretaria|responsavel|parente|familiar|enteado|enteada|padrasto|madrasta)";
const EMPRESA = "(?:voces|vcs|vc|voce|essa empresa|esse provedor|a empresa|o provedor|essa internet|isso|essa cobranca|essa divida|esse contrato|esse plano|esse servico|essa conta|esse debito|essa fatura)";
/** "não conheço esse boleto / esse valor / essa pendência": contestação do que se cobra, nunca número errado. */
const OBJETO_FINANCEIRO = "(?:(?:esse|essa|este|esta|esses|essas|o|a|os|as|tal|nenhum|nenhuma|seu|sua) )?(?:valor|valores|boleto|boletos|debito|debitos|divida|dividas|cobranca|cobrancas|fatura|faturas|conta|contas|contrato|plano|servico|pendencia|pendencias|parcela|parcelas|mensalidade|mensalidades|compra|numero de (?:voces|vcs|vc|voce))(?![a-z])";
/** Palavras que, depois de "pelo/pela", são o MEIO da conversa e não a pessoa representada ("falando pelo whats"). */
const MEIO_DA_CONVERSA = "(?:mim|eu|whats|whatsapp|zap|celular|telefone|chat|app|aplicativo|site|numero|mensagem|msg|internet|aqui|ai|favor|enquanto|agora|hoje|sms|email)(?![a-z])";
/**
 * Palavras que, depois de artigo ("a X", "essa X", "nenhuma X"), NÃO são a pessoa procurada: papel, objeto,
 * dinheiro, xingamento, adjetivo, parente (correção 2 da B3). Existe para reconhecer "não sou a Maria" e
 * "não conheço essa Maria" sem o nome do cadastro — e sem transformar "não sou a titular", "não conheço o
 * técnico" ou "o salário saiu" em número errado ou terceiro. Com o nome em mãos, os detectores o usam também.
 */
const NAO_E_A_PESSOA = `(?:titular|dono|dona|responsavel|cliente|clientes|devedor|devedora|caloteiro|caloteira|culpado|culpada|mentiroso|mentirosa|golpista|unico|unica|primeiro|primeira|ultimo|ultima|mesmo|mesma|tipo|favor|contra|obrigado|obrigada|rico|rica|trouxa|otario|otaria|idiota|burro|burra|palhaco|palhaca|bobo|boba|besta|louco|louca|maluco|maluca|pessoa|pessoas|gente|ninguem|tecnico|tecnica|atendente|vendedor|vendedora|moca|moco|rapaz|cara|gerente|instalador|cobrador|cobradora|empresa|provedor|banco|loja|operadora|procedimento|site|link|aplicativo|app|sistema|processo|protocolo|codigo|termo|endereco|lugar|bairro|pix|chave|taxa|multa|juros|encargo|plano|pacote|servico|produto|modelo|aparelho|equipamento|roteador|modem|onu|caminho|jeito|metodo|forma|golpe|assunto|motivo|documento|email|numero|telefone|contato|whats|zap|chip|linha|regra|politica|prazo|valor|valores|boleto|boletos|debito|divida|cobranca|fatura|faturas|conta|contas|contrato|pendencia|parcela|mensalidade|compra|pagamento|salario|dinheiro|auxilio|beneficio|bolsa|ferias|decimo|credito|emprestimo|internet|net|wifi|conexao|rede|sinal|velocidade|luz|energia|agua|tv|senha|pagina|mensagem|msg|carta|visita|entrega|pedido|nota|resultado|carro|onibus|marca|historia|lei|norma|cidade|rua|coisa|situacao|frase|palavra|seu|sua|meu|minha|teu|tua|nosso|nossa|dele|dela|esse|essa|este|esta|aquele|aquela|outro|outra|tal|mais|menos|nada|voce|senhora|senhor|homem|mulher|menina|menino|garota|garoto|${PARENTES.slice(3, -1)})`;
/** A pessoa procurada, dita com artigo e sem ser palavra comum: "a Maria", "o tal João", "dona Maria". */
const ALGUEM_PELO_NOME = `(?:o |a |tal |o tal |a tal |dona |seu |sr |sra |senhora |senhor )(?!${NAO_E_A_PESSOA}(?![a-z]))[a-z]{3,}#`;
/** A pessoa não pode responder agora: saiu, não está, não sabe mexer no celular. */
const PESSOA_AUSENTE = "(?:saiu#|foi trabalhar#|viajou#|nao (?:esta|ta|tah)(?= ?[.,!;]| ?$| (?:em casa|aqui|no momento|agora|disponivel)(?![a-z]))|nao (?:pode|consegue|sabe) (?:responder|atender|falar|mexer|escrever|usar|ver|ler)#|(?:esta|ta) (?:trabalhando|dormindo|viajando|ocupad[oa]|no trabalho)#)";
const SAUDACAO = "(?:nao|oi|ola|opa|alo|bom dia|boa tarde|boa noite|e ai)";
/**
 * A oferta da D1 — "Se preferir falar com alguém da equipe, é só me dizer" — só serve se a resposta natural a ela for
 * entendida (revisão final): "prefiro falar com alguém da equipe", "pode ser alguém da equipe", "me passa pra equipe".
 * Sem isso, quem aceitava recebia o pedido dos dígitos de novo, ou a própria oferta repetida.
 */
const DA_EQUIPE = "d(?:a|o) (?:sua |nossa |vossa )?equipe";
const QUER_OU_PREFERE = "(?:quero|queria|prefiro|preferia|pode ser|podia ser|melhor|aceito)";

/**
 * Cada lista é uma categoria da spec. Os fragmentos casam no INÍCIO de palavra do texto normalizado
 * (sem acento, minúsculo). Exceções ficam no próprio fragmento, com o motivo ao lado.
 */
export const VOCABULARIO_DA_TRIAGEM = {
  /**
   * §3.2 item 2 — o número não é do cliente, dito com palavra que o TITULAR também usa negada: "não é engano"
   * e "não, não é engano" respondem à pergunta da abertura ("Tô falando com a Maria?"). Estes só valem sem
   * negação logo antes (revisão B3); "é engano não" também é o titular.
   */
  numeroErradoNegavel: [
    "engano#(?! nao(?![a-z]))", "numero errado#(?! nao(?![a-z]))", "numero trocado#", "errou (?:o |de )?numero#", "mensagem errada#", "pessoa errada#",
  ],
  /**
   * §3.2 item 2 — o número não é do cliente, dito de forma INEQUÍVOCA (o número mudou de dono). Vale antes e
   * depois da identidade: é o que `classificarEncerramento` aceita para a frase de desculpa por engano.
   */
  numeroErrado: [
    // "anota meu número novo" é o titular atualizando: número novo sozinho não entra (escalation.ts)
    "(?:troquei|trocou|mudei|mudou) de (?:numero|chip|telefone|linha|whats)",
    // "esse número é meu" sozinho é o titular confirmando; só com "agora" o número mudou de dono (escalation.ts)
    "(?:esse|este|o) (?:numero|chip|telefone|whats|zap|linha) (?:(?:e|eh|ja e) meu agora|agora (?:e|eh) meu)#",
    "(?:esse|este|o) (?:numero|chip|telefone|linha|whats) (?:nao e|nao eh|nao pertence) (?:mais(?![a-z])|d(?:a|o|ela|ele)(?![a-z]))",
    "comprei (?:esse|este|o|um|uma) (?:chip|numero|telefone|linha)", "(?:numero|chip|linha|telefone) mudou de dono",
    "(?:chip|numero|telefone|linha|whats) (?:era|foi) de outra pessoa", "era de outra pessoa#",
    "(?:peguei|adquiri) (?:esse|este|o) (?:chip|numero|telefone|linha) (?:faz|ha|tem|recente)",
  ],
  /**
   * §3.2 item 2 — quem escreve nega ser a pessoa procurada ("não sou a Maria", "não conheço essa pessoa").
   * Antes da identidade é número errado, a não ser que a mesma mensagem se declare terceiro ("não sou a
   * Maria, sou o marido dela" pede a titular, não encerra). Depois da identidade vai à equipe SEM a desculpa
   * por engano: quem confirmou os dígitos e diz não ser o cliente precisa de gente olhando (correção 2).
   */
  negaSerOCliente: [
    "nao sou (?:essa pessoa|a pessoa(?! que)|ela#|ele#|eu#|quem (?:voce|vc|voces|vcs) (?:procura|quer|esta procurando|ta procurando))",
    `nao sou ${ALGUEM_PELO_NOME}`, // "não sou a Maria"; "não sou a culpada" e "não sou o seu marido" não
    // antes da identidade é terceiro (que vence); depois, quem confirmou os dígitos e diz isso vai à equipe
    "nao sou (?:o |a )?(?:titular|dono|dona|responsavel)#",
    "nao conheco (?:essa |esta |esse |este |a |o |nenhuma |nenhum |tal )?(?:pessoa|ninguem|mulher|homem|senhora|senhor)#",
    `nao conheco (?:essa |esta |esse |este |nenhuma |nenhum |nenhuma tal |nenhum tal )?${ALGUEM_PELO_NOME}`,
    `nao conheco (?:essa|esta|esse|este|nenhuma|nenhum) (?!${NAO_E_A_PESSOA}(?![a-z]))[a-z]{3,}#`,
  ],
  /**
   * §3.2 item 2 — sinais de número errado que só valem ANTES da identidade (e sem terceiro declarado): a
   * pessoa não mora aqui, "não conheço" solto. Depois da identidade "ela mudou" e "não conheço" falam de
   * outra coisa ("ela mudou de ideia", "não conheço o técnico").
   */
  numeroErradoAntesDaIdentidade: [
    // "não conheço vocês" é contestação de vínculo; "não conheço esse boleto" também; "não conheço esse número"
    // é pergunta — quem escreve não sabe quem chama. Solto (ou "não conheço não"), é número errado.
    "nao conheco(?= ?[.,!;]| ?$| nao(?![a-z]))",
    "nao tem (?:ninguem|nenhuma? [a-z]+) (?:com esse nome|aqui)", "nao (?:e|eh) (?:aqui|daqui)#",
    `(?:aqui|nessa casa|nesta casa|nesse numero|neste numero|nesse telefone|neste telefone) nao tem (?:ninguem (?:com esse nome|chamad[oa])|(?:nenhum|nenhuma) (?!${NAO_E_A_PESSOA}(?![a-z]))[a-z]{3,}#)`,
    "nao mora (?:mais )?(?:aqui|nesse|neste|comigo)",
    // "ela mudou" só com mudança de casa; "ela mudou de ideia" e "ele mudou o plano" não
    "(?:ela|ele) (?:ja )?(?:nao mora|se mudou#|mudou(?= ?[.,!;]| ?$| (?:de (?:casa|endereco|cidade|bairro|estado)|daqui|pra|para)(?![a-z])))",
  ],
  /** §3.2 item 3 — quem escreve se declara outra pessoa. Nunca confirma identidade, não gasta tentativa. */
  terceiro: [
    `sou (?:o |a |seu |sua |o proprio |a propria )?${PARENTES}#`,
    `(?:aqui|quem fala|quem ta falando|quem esta falando|falando|fala|quem responde|quem ta respondendo|quem esta respondendo|quem escreve|quem atende) (?:e |eh )?(?:o |a |seu |sua )${PARENTES}#`,
    // saudação antes (correção 2): "boa tarde, é a esposa, 8909" — bom dia/boa tarde são as aberturas mais comuns
    `^(?:${SAUDACAO}[,.!]* ){0,3}(?:e|eh) (?:o |a )${PARENTES}#`,
    // "Filho aqui, 8909", "oi, a filha dela aqui"
    `(?:^|(?<=[,.!;] ))(?:${SAUDACAO}[,.!]* )?(?:(?:o|a|sou o|sou a|e o|e a) )?${PARENTES} (?:dela |dele |d(?:a|o) [a-z]+ )?aqui#`,
    // "meu marido é o titular, 8909", "quem contratou foi minha esposa" ("quem paga é meu marido" é o titular)
    `(?:minha|meu) ${PARENTES} (?:e|eh) (?:o |a )?(?:titular|dono|dona|responsavel|cliente)#`,
    `quem (?:contratou|assinou|fez o contrato|fez o cadastro|tem o contrato|e o titular|e a titular) (?:e|eh|foi) (?:a |o )?(?:minha|meu) ${PARENTES}#`,
    // "to respondendo pra minha mãe" ("falo pra minha mãe pagar" é o titular: fala/falando fica de fora)
    `(?:respondendo|respondo|responder|escrevendo|escrevo|resolvendo|resolvo) (?:pra|para|p) (?:a |o )?(?:minha|meu) ${PARENTES}#`,
    `(?:ajudando|ajudo|ajudar) (?:a |o )?(?:minha|meu) ${PARENTES}#`,
    // "a Maria saiu", "ela não pode responder agora", "minha mãe não sabe mexer no celular", "vou passar pra ela"
    `(?:ela|ele|(?:minha|meu) ${PARENTES}) ${PESSOA_AUSENTE}`,
    `${ALGUEM_PELO_NOME.slice(0, -1)} ${PESSOA_AUSENTE}`,
    "(?:vou )?(?:passar|repassar|passo|repasso) (?:o recado |a mensagem |isso )?(?:pra|para|a) (?:ela|ele)#",
    "dela#", "dele#", "em nome d(?:e|a|o)#",
    "(?:ela|ele) (?:nao )?(?:esta|ta|to|tah) (?:aqui|em casa|trabalhando|dormindo|viajando|ocupad|no trabalho|no momento|disponivel|internad)",
    "(?:ela|ele) (?:saiu|foi trabalhar|viajou)#",
    "(?:o|a) titular (?:e|eh|nao|esta|ta)#", "nao sou (?:o |a )?(?:titular|dono|dona|responsavel)#",
    "(?:conta|internet|contrato|plano|cadastro|numero|whats|whatsapp|zap|telefone|celular|cpf|documento|chip|linha) (?:e|eh|esta|ta|fica) (?:no nome )?d(?:a|o) (?:minha|meu)#",
    "no nome d(?:a|o) (?:minha|meu)#",
    // Posse e representação (revisão B3): é o parente que segura o telefone quem costuma saber os dígitos, e
    // sem o nome no desafio (D10) a declaração dele é a única barreira. Antes da identidade o falso positivo
    // custa pouco — a mensagem só não confirma e a frase pede a pessoa titular.
    `(?:e|eh|sao|era|fica|ficou|esta|ta) (?:no nome )?d(?:a|o) (?:minha|meu) ${PARENTES}#`, // "o cpf é da minha mãe", "8909 é da minha esposa"
    `(?:cpf|documento|final|whats|whatsapp|zap|telefone|celular|numero|chip|linha|conta|internet|contrato|plano|cadastro|nome|boleto|fatura) d(?:a|o) (?:minha|meu) ${PARENTES}#`,
    `(?:pela|pelo|por) (?:minha|meu) ${PARENTES}#`, // "respondendo pela minha mãe", "falo pela minha mãe"
    `(?:respondendo|respondo|responder|falando|falo|escrevendo|escrevo|atendendo|resolvendo|resolvo) (?:por|pela|pelo) (?!${MEIO_DA_CONVERSA})[a-z]+`,
    `(?:ela|ele|(?:a|o|dona|seu|sr|sra) [a-z]+) (?:e|eh) (?:a |o )?(?:minha|meu) ${PARENTES}#`, // "ela é minha mãe", "a Maria é minha mãe"
    `^(?!quem )[a-z]+ (?:e|eh) (?:a |o )?(?:minha|meu) ${PARENTES}#`, // "Maria é minha mãe"; "quem paga é meu marido" não
    // "filho da Maria", "esposa do João"; "ai meu pai do céu" não
    `${PARENTES} d(?:a|o) (?!(?:ceu|meio|mundo|ano|mes|lado|bairro|puta|caralho|cara|jeito|nada)(?![a-z]))[a-z]+`,
    `(?:minha|meu) ${PARENTES} (?:me )?(?:pediu|mandou|falou|disse) (?:pra |para |que |p )?(?:eu |mim )?(?:responder|responde|respondesse|falar|fala|falasse|ver|visse|olhar|olhasse|resolver|resolvesse|atender|atendesse)#`,
  ],
  /** §3.2 item 4 — pediu para parar de receber. Grava `nao_contatar`. */
  pediuParaParar: [
    "para de (?:me )?(?:mandar|enviar|chamar|ligar|encher|perturbar|incomodar|cobrar|mandando|enviando)",
    "pare(?:m)? de#", "parem#", "param de (?:me )?(?:mandar|enviar|chamar|ligar|encher|perturbar|incomodar|cobrar)",
    "nao (?:quero|desejo) (?:mais )?(?:mensage|msg|contato|que (?:me )?(?:mande|mandem|chame|chamem|ligue|liguem))",
    // "receber" só com objeto de contato ou no fim da frase: "não quero receber o boleto impresso" e "não quero
    // receber visita" não pedem para parar (e gravariam `nao_contatar`)
    "nao (?:quero|desejo) (?:mais )?receber (?:mais )?(?:(?:nenhuma?|essas?|esses?|estas?|estes?|suas?|seus?|as|os|tais|mais) )?(?:mensage|msg|cobranc|contato|whats|zap|ligac|sms|e-?mail|notific|aviso|propaganda|isso#|nada#)",
    "nao (?:quero|desejo) (?:mais )?receber(?: mais)?(?= ?[.,!;]| ?$)",
    "nao me (?:mande|manda|mandem|chame|chama|chamem|ligue|liga|liguem|procure|procurem|contate|contatem|incomode|perturbe|cobre|cobrem|envie|enviem)",
    // "não cobrem mais" (o `exigeHumano` antigo pegava); "vocês não cobrem taxa?" pergunta, não pede para parar
    "nao (?:cobre|cobrem) mais(?= ?[.,!;]| ?$| (?:nada|nao|por favor|pfv|pf|essa|esse|isso|aqui|nesse numero|neste numero|de mim)(?![a-z]))",
    "nao (?:mande|mandem|envie|enviem) (?:mais )?(?:mensage|msg)",
    "(?:me )?(?:tira|tire|tirem|remove|remova|removam|exclui|exclua) (?:dessa |da |desta |do )?(?:lista|cadastro de mensage|contato)",
    "(?:tira|tire|remove|remova|exclui|exclua) (?:meu|esse|este) (?:numero|contato|telefone)",
    "(?:me )?(?:tira|tire|tirem|remove|remova|removam|exclui|exclua) (?:o |meu |o meu )?(?:nome|numero|contato|telefone) (?:dessa|da|desta|do) (?:lista|cadastro de mensage)",
    "descadastr", "sair da lista#", "vou (?:te |lhes? )?bloquear#", "stop#",
  ],
  /** §3.2 item 5 — nega o vínculo ou a titularidade; na fase pós, contestação formal. */
  contestaTitularidade: [
    "nao contratei", "nunca contratei", "nao fiz (?:esse |este |nenhum |o )?(?:contrato|plano|cadastro)", "nunca assinei", "nao assinei",
    "nao reconheco", "desconheco (?:essa|esse|isso|esta|este)", "sofri (?:um )?golpe", "foi (?:um )?golpe#", "cai (?:num|em um|no) golpe",
    "(?:usaram|usou|usando|estao usando|tao usando) (?:o )?(?:meu nome|meus dados|meu cpf|meus documentos)", "uso indevido",
    "fraude", "fraudaram", "fraudulent", "clonaram", "nao sou (?:mais )?cliente", "nunca fui cliente",
    `nao conheco ${EMPRESA}(?![a-z])`, "nao conheco (?:nenhuma? )?(?:empresa|provedor|internet)#", "nunca ouvi falar",
    "nao tenho (?:contrato|internet|plano|nada) com (?:voces|vcs|essa empresa|esse provedor)",
    "cobranca indevida", "cobrando (?:indevidamente|errado)", "nao devo nada#", "nao devo (?:isso|esse valor|essa divida)#",
    `nao conheco ${OBJETO_FINANCEIRO}`, // "não conheço esse boleto", "não conheço esse numero de vcs"
    "ja cancelei (?:e|mas) (?:continuam?|seguem?|voces|vcs|ainda)",
    // "não sou a pessoa que contratou" nega o contrato, não o número
    "nao (?:sou|fui) (?:eu )?(?:a pessoa |o |a |quem )?(?:que )?(?:contratou|contratei|assinou|assinei|fez (?:esse|essa|este|esta|o|a) (?:contrato|plano|cadastro))#",
  ],
  /**
   * §3.3 — contestação formal, dita com o verbo (correção 2 da B3): "quero contestar essa cobrança", "abrir
   * contestação". O `exigeHumano` antigo transferia (`contesta`), e a lista nova tinha perdido a forma — a
   * mensagem ia ao planejador ou recebia o pedido dos dígitos. Contestação nunca fica com a IA. Antes da
   * identidade vai à equipe com o aviso neutro; depois, com o aviso de contestação.
   */
  contestacaoFormal: [
    "contest(?:ar|o|a|as|am|amos|ando|ei|ou|acao|acoes|ado|ada|e|em)#",
  ],
  /** §3.2 item 6 e §3.3 — pedido EXPLÍCITO de pessoa (escalation.ts): "você é humano?" é pergunta, não pedido. */
  pediuPessoa: [
    "(?:quero|queria|preciso|posso|gostaria de|deixa eu|me deixa|tem como|da pra|da para|dá pra|consigo|prefiro|preferia|pode ser|podia ser|melhor) (?:falar|conversar) com (?:um |uma |o |a |algum |alguma |sua |nossa )?(?:atendente|humano|humana|pessoa|gente|alguem|funcionari|gerente|responsavel|supervisor|dono|setor|equipe)",
    "falar com (?:um |uma )?(?:atendente|humano|humana|pessoa de verdade|alguem de verdade)#",
    // "me passa pro atendente" (correção 2: faltava "pro")
    "(?:me )?(?:transfere|transfira|transferir|passa|passe|passar|encaminha|encaminhe|encaminhar|repassa|repassar|coloca|coloque|colocar|joga) (?:pra|para|pro|pra o|para o|pra um|para um|com|ao) (?:um |uma |o |a |sua |nossa |a sua |a nossa )?(?:atendente|humano|pessoa|alguem|setor|gerente|atendimento humano|equipe#)",
    "(?:quero|queria|preciso de|exijo|gostaria de|prefiro|preferia) (?:um |uma |o |a )?(?:atendente|atendimento humano|pessoa de verdade|humano|humana)#",
    // "quero uma pessoa"; "preciso de uma pessoa pra retirar o aparelho" não pede atendimento
    "(?:quero|queria|preciso de|exijo|gostaria de|prefiro|preferia) (?:uma |a )pessoa#(?! (?:pra|para|que) )",
    // o aceite da oferta da D1: "prefiro alguém da equipe", "sim, alguém da equipe", "pode ser a equipe"
    `(?:${QUER_OU_PREFERE}|sim|pode|isso|ok)[,.!]* (?:com )?(?:um |uma |o |a )?(?:alguem|atendente|pessoa|funcionari[oa]|humano|humana) ${DA_EQUIPE}#`,
    `${QUER_OU_PREFERE}[,.!]* (?:com )?(?:a |sua |a sua |nossa |a nossa )equipe#`,
    `${QUER_OU_PREFERE} que (?:alguem ${DA_EQUIPE}|(?:um|uma) atendente|a (?:sua |nossa )?equipe) (?:continue|me atenda|atenda|fale|me responda|responda|resolva|siga|assuma|cuide)#`,
    // a mensagem que é SÓ a resposta à oferta: "alguém da equipe", "alguém da equipe, por favor"
    `^(?:com )?(?:um |uma )?(?:alguem|atendente|pessoa|humano|humana) ${DA_EQUIPE}(?:[,.!]* (?:por favor|pfv|pf|mesmo|entao))?[.!]*$`,
    "chama (?:um |uma |o |a )?(?:atendente|humano|alguem|pessoa|gerente|responsavel)#",
    "cade (?:o |a |os |as |um |uma )?(?:atendente|atendentes|humano|pessoa|alguem|gerente|responsavel|suporte)#",
    // "tem atendente?" pede gente; "tem humano aí?" é a pergunta sobre quem atende (D1)
    "tem (?:algum |alguma |um |uma )?(?:atendente|atendentes)#",
    "atendente humano", "atendimento humano", "nao quero falar com (?:robo|maquina|inteligencia artificial|bot#|sistema)",
    // a mensagem que é SÓ a palavra ("atendente", "humano.") — comum no WhatsApp; com "?" é pergunta de robô
    "^(?:um |uma |o |a )?(?:atendente|atendimento|humano|humana|pessoa|pessoa de verdade|suporte|operador|operadora)(?: (?:por favor|pfv|pf|pls|urgente|agora))?[.!]*$",
    "para de (?:me )?responder (?:com )?(?:robo|bot)", "(?:me )?(?:liga|ligue|ligar) (?:pra mim|para mim)#", "pode me ligar#", "me liga#",
  ],
  /** §3.3 — jurídico (escalation.ts). Antes da identidade também transfere: pedir dígitos a quem fala em Procon não ajuda ninguém. */
  juridico: [
    "procon#", "advogad", "(?:vou|vamos|irei) (?:te |lhes? |voces |vcs )?process", "me processa#", "processar (?:voces|vcs|a empresa)#",
    "processo (?:judicial|contra)#", "acao judicial",
    // a spec lista "processar" solto: "quero processar essa empresa", "vou abrir um processo". Ficam de fora o
    // processo DE pagamento, "processar o pix" e "em processo" (andamento)
    "(?<!em )processar#(?! (?:o |a |meu |minha |seu |sua |esse |essa )?(?:pagamento|pix|boleto|baixa|dados|pedido|cadastro|cancelamento|devolucao|retirada)(?![a-z]))",
    "(?<!em )processo#(?! (?:de|do|da) (?:pagamento|baixa|compensacao|cancelamento|devolucao|retirada|cadastro|instalacao|portabilidade|analise)(?![a-z]))", "(?:vou|irei|vamos) (?:pra|para|na|entrar na) justica", "justica#", "juizado", "pequenas causas",
    "reclame aqui", "anatel#", "delegacia", "boletim de ocorrencia", "defensoria", "consumidor[.]gov",
  ],
  /** §3.3 — vulnerabilidade grave (escalation.ts). Desemprego e aperto NÃO entram: são objeção de capacidade. */
  vulnerabilidade: [
    "faleceu#", "falecimento", "falecid", "obito#", "(?:de|em|estou de|to de|estamos de) luto#", "velorio", "enterro#",
    "internad", "uti#", "hospital", "cancer#", "quimioterapia", "quimio#", "doenca grave", "superendividad", "lei 14[.]?181",
    // "a Maria morreu"; "a internet morreu" é gíria de conexão caída
    "(?<!(?:internet|net|wifi|sinal|conexao|modem|roteador|aparelho|celular|bateria|tv|televisao|computador|pc|notebook|onu|rede|chip|linha) )morreu#", "morte#",
    "nao tenho (?:nem )?(?:pra|para|o que) comer",
  ],
  /** escalation.ts — ameaça física ou grave. Vai à equipe como aviso genérico. */
  ameacaGrave: [
    "sei onde (?:vc|voce|voces|tu) (?:mora|trabalha|fica)", "vou (?:te|ti|lhe) (?:achar|pegar|matar|quebrar|arrebentar)",
    "vou (?:ai|la) (?:na|nessa|nesta) (?:empresa|loja|sede)", "vou atras de (?:vc|voce|ti)",
  ],
  /** §3.2 item 8 — desconfiança da MENSAGEM ("é golpe?"). Quem diz que SOFREU golpe já caiu em contestação. */
  duvidaGolpe: [
    "golpe", "como (?:eu )?(?:sei|vou saber|posso saber|confio) (?:que|se)", "e (?:confiavel|seguro|verdade)#", "fake#", "e falso#",
    "desconfi", "phishing", "quem me garante", "e (?:voces|vcs) mesmo", "e da (?:empresa|operadora) mesmo", "golpista",
  ],
  /** §3.2 item 9 — pergunta sem dígitos. O "?" conta (antes ele sumia na normalização e o detector nunca casava). */
  pergunta: [
    "quem (?:e|eh|fala|ta falando|esta falando|seria|sao)#", "sobre o que#", "do que se trata", "o que (?:e|eh|seria|houve|aconteceu|voce quer|vc quer|voces querem|vcs querem)#",
    "que assunto", "qual (?:o )?assunto", "por que#", "porque (?:me )?(?:mandou|mandaram|chamou|chamaram)", "pra que#", "para que#", "como assim#", "hein#",
    // "não conheço esse número": quem escreve não sabe quem chama — explica e pede os dígitos, não encerra
    "nao conheco (?:esse |este |o |seu |tal )?(?:numero|contato|telefone|whats|zap)#",
  ],
  /** §3.3 — pagamento informado com verbo no passado ou marcador que não deixa dúvida. "pago dia N" é decidido pela data. */
  pagamentoInformado: [
    "paguei#", "pagou#", "pagamos ontem#", "ja pag(?:o|a|amos)#", "(?:ta|esta|estah|to|tou|ficou|foi|ja foi|ja esta|ja ta|tudo) (?:tudo )?pag[oa]#",
    "(?:boleto|fatura|conta|mensalidade|parcela|divida|pix|debito) (?:ja )?(?:foi |esta |ta |ficou )?pag[oa]#",
    "(?:boleto|fatura|conta|mensalidade|parcela|divida|debito) (?:ja )?(?:foi |esta |ta |ficou )?quitad",
    "pagamento (?:feito|efetuado|realizado|confirmado|ja foi)", "(?:fiz|mandei|enviei|realizei|efetuei|mandamos|fizemos) (?:o |um |a |uma |os )?(?:pix|pagamento|transferencia|deposito|ted|doc)#",
    "pix (?:feito|enviado|realizado|pago|efetuado|ja foi)#", "transferi#", "depositei#", "quitei#", "acertei#", "efetuei#",
    "passei (?:no|na) (?:banco|loterica|caixa)#", "comprovante", "ja resolvi#", "(?:ta|esta|ja esta|ja ta|ficou|foi) (?:tudo )?resolvid",
  ],
  /** §3.3 — devolução informada. "Podem retirar amanhã?" é pedido, não informação. */
  devolucaoInformada: [
    "devolvi#", "(?:ja )?(?:foi |esta |ta )?devolvid", "entreguei#", "retiraram#", "recolheram#",
    "(?:buscaram|levaram|pegaram) (?:o|a|os|as) (?:aparelho|equipamento|modem|roteador|onu|antena|caixinha|decodificador)",
    "ja (?:buscaram|levaram|pegaram|recolheram)#", "vieram (?:buscar|retirar|pegar|recolher)", "(?:o )?tecnico (?:ja )?(?:levou|retirou|recolheu|buscou|pegou)#",
    "(?:foi|ja foi|ja esta|ta|esta) retirad[oa]#",
  ],
  /**
   * Regra do Consulta ISP, não do escalation.ts: negativar, baixar, tirar o nome do SPC/Serasa — nunca pela IA
   * (CLAUDE.md, "Três faixas de autonomia"). Vai à equipe como aviso genérico.
   */
  politica: [
    "negativ", "baixa#", "baixar", "baixaram", "baixad[oa]#", "dar baixa", "spc#", "serasa#", "nome (?:(?:esta|ta|ficou|foi) )?sujo",
    // "retirar o meu nome", "limpa meu nome"; "tira meu nome da lista" é pedido para parar, não SPC
    "(?:retira|retirar|retirada|retirem|tira|tirar|tirem|limpa|limpar|limpem) (?:(?:o|a|meu|minha|seu|sua|esse|este|do|da) ){0,2}nome#(?! (?:da|dessa|desta|do) (?:lista|cadastro de mensage))",
  ],
  /** Desconto e parcelamento sem a negociação autônoma ligada: condição fora da política vai à equipe. */
  negociacao: ["desconto", "descontinho", "parcelar#", "parcelamento", "parcelado#"],
} as const;

const RE = {
  numeroErradoNegavel: compilar(VOCABULARIO_DA_TRIAGEM.numeroErradoNegavel),
  numeroErrado: compilar(VOCABULARIO_DA_TRIAGEM.numeroErrado),
  negaSer: compilar(VOCABULARIO_DA_TRIAGEM.negaSerOCliente),
  numeroErradoPre: compilar(VOCABULARIO_DA_TRIAGEM.numeroErradoAntesDaIdentidade),
  terceiro: compilar(VOCABULARIO_DA_TRIAGEM.terceiro),
  parar: compilar(VOCABULARIO_DA_TRIAGEM.pediuParaParar),
  contesta: compilar(VOCABULARIO_DA_TRIAGEM.contestaTitularidade),
  contestacaoFormal: compilar(VOCABULARIO_DA_TRIAGEM.contestacaoFormal),
  pessoa: compilar(VOCABULARIO_DA_TRIAGEM.pediuPessoa),
  juridico: compilar(VOCABULARIO_DA_TRIAGEM.juridico),
  vulnerabilidade: compilar(VOCABULARIO_DA_TRIAGEM.vulnerabilidade),
  ameaca: compilar(VOCABULARIO_DA_TRIAGEM.ameacaGrave),
  golpe: compilar(VOCABULARIO_DA_TRIAGEM.duvidaGolpe),
  pergunta: compilar(VOCABULARIO_DA_TRIAGEM.pergunta),
  pagamento: compilar(VOCABULARIO_DA_TRIAGEM.pagamentoInformado),
  devolucao: compilar(VOCABULARIO_DA_TRIAGEM.devolucaoInformada),
  politica: compilar(VOCABULARIO_DA_TRIAGEM.politica),
  negociacao: compilar(VOCABULARIO_DA_TRIAGEM.negociacao),
  // o MESMO detector que o verificador usa para exigir a confirmação da automação (§6.4)
  robo: compilar(VOCABULARIO.perguntaSobreAtendimento),
};

/* ───────────────────────── detectores ───────────────────────── */

const norm = (texto: string) => normalizarMensagemDoCliente(texto).replace(/\n/g, " ");

/**
 * O primeiro nome do cadastro, pronto para casar no texto normalizado ("MARIA DE SOUZA" → "maria"). Palavra
 * comum ("Dona", "Cliente") não vira nome: casaria em frase que não fala de ninguém.
 */
function primeiroNomeParaTriagem(nome: string | null | undefined): string | null {
  const n = normalizarMensagemDoCliente(nome ?? "").replace(/[^a-z ]/g, " ").trim().split(/\s+/)[0] ?? "";
  return /^[a-z]{3,}$/.test(n) && !new RegExp(`^${NAO_E_A_PESSOA}$`).test(n) ? n : null;
}
const REGEX_DO_NOME = new Map<string, { negaSer: RegExp; ausente: RegExp }>();
/** Frases com o nome SEM artigo ("não sou Maria", "aqui não tem Maria", "Maria saiu"): só com o nome do cadastro. */
function regexDoNome(nome: string) {
  let re = REGEX_DO_NOME.get(nome);
  if (!re) {
    re = {
      negaSer: compilar([
        `nao (?:sou|e|eh) (?:o |a )?(?:tal |dona |seu |senhora |senhor |sr |sra )?${nome}#`,
        `nao tem (?:nenhum |nenhuma |ninguem chamad[oa] |nenhuma pessoa chamada |nenhum [a-z]+ chamad[oa] )?(?:o |a )?${nome}#`,
        `nao conheco (?:nenhum |nenhuma |essa |esse |esta |este |a |o |tal |a tal |o tal |dona |seu )?${nome}#`,
        `${nome} (?:nao mora|nao e daqui|nao eh daqui|se mudou#)`,
      ]),
      ausente: compilar([`${nome} ${PESSOA_AUSENTE}`]),
    };
    if (REGEX_DO_NOME.size > 500) REGEX_DO_NOME.clear();
    REGEX_DO_NOME.set(nome, re);
  }
  return re;
}

/** Número errado dito sem margem: engano, número trocado, "esse chip é meu agora". Vale antes e depois da identidade. */
export const detectarNumeroErradoInequivoco = (texto: string) => {
  const t = norm(texto);
  // "número novo, não conheço essa pessoa" (escalation.ts): "número novo" sozinho é o titular atualizando
  return casaSemNegacao(RE.numeroErradoNegavel, t) || casa(RE.numeroErrado, t)
    || (/(?<![a-z])(?:(?:numero|chip|telefone) nov[oa]|linha nova)(?![a-z])/.test(t) && /(?<![a-z])nao conheco(?![a-z])/.test(t));
};
/** "Não sou a Maria", "não conheço essa pessoa": quem escreve nega ser a pessoa procurada. */
export const detectarNegaSerOCliente = (texto: string, primeiroNome?: string | null) => {
  const t = norm(texto), nome = primeiroNomeParaTriagem(primeiroNome);
  return casa(RE.negaSer, t) || (!!nome && casa(regexDoNome(nome).negaSer, t));
};
/**
 * Antes da identidade: número errado inequívoco, ou a pessoa negada / fora de casa SEM terceiro declarado na
 * mesma mensagem — "não sou a Maria, sou o marido dela" é terceiro (pede a titular), não engano.
 */
export const detectarNumeroErrado = (texto: string, primeiroNome?: string | null) =>
  detectarNumeroErradoInequivoco(texto)
  || ((detectarNegaSerOCliente(texto, primeiroNome) || casa(RE.numeroErradoPre, norm(texto))) && !detectarTerceiro(texto, primeiroNome));
export const detectarTerceiro = (texto: string, primeiroNome?: string | null) => {
  const t = norm(texto), nome = primeiroNomeParaTriagem(primeiroNome);
  return casa(RE.terceiro, t) || (!!nome && casa(regexDoNome(nome).ausente, t));
};
// sem a checagem de negação: "vocês não param de mandar mensagem" também é pedido para parar
export const detectarPedidoParaParar = (texto: string) => casa(RE.parar, norm(texto));
/** Contestação de vínculo/titularidade OU formal ("quero contestar"). */
export const detectarContestacao = (texto: string) => { const t = norm(texto); return casa(RE.contesta, t) || casa(RE.contestacaoFormal, t); };
export const detectarContestacaoFormal = (texto: string) => casa(RE.contestacaoFormal, norm(texto));
export const detectarPedidoDePessoa = (texto: string) => casaSemNegacao(RE.pessoa, norm(texto), NEGACAO_DO_PEDIDO, true);
export const detectarJuridico = (texto: string) => casa(RE.juridico, norm(texto));
export const detectarVulnerabilidade = (texto: string) => casa(RE.vulnerabilidade, norm(texto));
export const detectarAmeacaGrave = (texto: string) => casa(RE.ameaca, norm(texto));
/** "é robô?", "tem alguém aí?", "é IA?" — a pergunta sobre QUEM atende (D1). Não é pedido de pessoa. */
export const detectarPerguntaDeRobo = (texto: string) => casa(RE.robo, norm(texto));
export const detectarDuvidaDeGolpe = (texto: string) => casa(RE.golpe, norm(texto));
// o "?" fica fora da lista: colado na palavra ("oi?") ele não abre começo de palavra
export const detectarPergunta = (texto: string) => { const t = norm(texto); return t.includes("?") || casa(RE.pergunta, t); };
export const detectarDevolucaoInformada = (texto: string) => casaSemNegacao(RE.devolucao, norm(texto));

// só a 1ª pessoa "pago": "a gente paga dia 5" é hábito, e "quem paga dia 10 é meu marido" não informa nada
const PAGO_COM_DATA = /(?<![a-z])pago(?![a-z])/g;
const MARCA_DE_PASSADO = /(?<![a-z])(?:ontem|anteontem|passad[oa]|hoje cedo|mais cedo|agora pouco|agorinha|ha pouco|a pouco)(?![a-z])/;

/**
 * Pagamento informado (spec §3.3, s10). "paguei", "fiz o pix", "tá pago" e o comprovante transferem sempre.
 * "pago dia N" depende da data: N até hoje, no mês corrente, é "paguei dia N" (transfere); N depois de hoje
 * é promessa (vai ao planejador). "pago amanhã", "pago sexta" e "pago quando receber" são promessa. "quem
 * paga é meu marido" não é nada disso. Negação logo antes ("ainda não paguei") não é pagamento.
 */
export function detectarPagamentoInformado(texto: string, hoje: string): boolean {
  const t = norm(texto);
  if (casaSemNegacao(RE.pagamento, t)) return true;
  PAGO_COM_DATA.lastIndex = 0;
  for (let m = PAGO_COM_DATA.exec(t); m; m = PAGO_COM_DATA.exec(t)) {
    if (NEGACAO_ANTES.test(t.slice(Math.max(0, m.index - 16), m.index))) continue;
    const depois = t.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (MARCA_DE_PASSADO.test(depois.slice(0, 28))) return true;
    if (!hojeValido(hoje)) continue;
    const dia = /^ ?(?:no |ate |até )?dia (\d{1,2})(?![0-9/.-])/.exec(depois);
    if (dia) {
      const n = Number(dia[1]);
      const resto = depois.slice(dia[0].length);
      // "pago no dia 5 do mês que vem" é promessa, mesmo com 5 ≤ hoje; "dia 5 do mês passado" é pagamento
      if (/^ ?(?:do |no |desse |deste )?mes passado(?![a-z])/.test(resto)) return true;
      if (/^ ?(?:do |no |desse |deste )?(?:mes que vem|proximo mes|mes seguinte|outro mes)(?![a-z])/.test(resto)) continue;
      const mesDito = new RegExp(`^ ?(?:de|do mes de) (${MESES.join("|")})(?![a-z])`).exec(resto);
      if (mesDito) {
        // com o mês dito, a data decide: até hoje e nos últimos 62 dias é "paguei"; o resto é promessa
        const iso = isoValida(Number(hoje.slice(0, 4)), MESES.indexOf(mesDito[1]) + 1, n);
        if (iso && iso <= hoje && iso >= somarDias(hoje, -62)) return true;
        continue;
      }
      if (n >= 1 && n <= Number(hoje.slice(8, 10))) return true;
      continue;
    }
    const dm = /^ ?(?:no |em |dia )?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?![0-9])/.exec(depois);
    if (dm) {
      const ano = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(hoje.slice(0, 4));
      const iso = isoValida(ano, Number(dm[2]), Number(dm[1]));
      if (iso && iso <= hoje) return true;
    }
  }
  return false;
}

/* ───────────────────────── dígitos da identidade ───────────────────────── */

/** Quantos tokens distintos de 4 dígitos uma mensagem pode trazer e ainda confirmar. Mais que isso é chute em lote. */
export const MAX_TOKENS_DE_DIGITOS = 2;

const TELEFONE_COM_CONTEXTO = /(?<![a-z])(?:tel|telefone|fone|cel|celular|whats|whatsapp|zap|numero|contato|ligar|liga|ligue|chama)(?![a-z])[^0-9]{0,12}(?:\+?55 ?)?(?:\(?\d{2}\)? ?)?\d{4,5}[ -]?\d{4}(?![0-9])/g;
const TELEFONE_COM_DDD = /(?:\+?55 ?)?\(\d{2}\) ?\d{4,5}[ -]?\d{4}(?![0-9])|(?<![0-9])(?:\+?55 ?)?\d{2} 9 ?\d{4}[ -]?\d{4}(?![0-9])/g;

/**
 * Tokens de EXATAMENTE 4 dígitos que podem ser o final do CPF (spec §3.2 item 10, e7). Ficam de fora os
 * que fazem parte de data ("20/09/2026"), hora ("14:00"), valor ("R$ 1500", "1500,00", "1500 reais"),
 * telefone ("99999-8888") ou ano citado como ano ("desde 2019"). Antes juntava TODOS os dígitos da
 * mensagem: "Maria Souza 8909, pago dia 20" virava "890920", não conferia e gastava a tentativa.
 */
export function tokensDeDigitos(texto: string): string[] {
  // Telefone com espaço ("meu tel 9999 8888", "(43) 99999 8888") sai inteiro antes: senão viram dois "finais",
  // a mensagem do titular passa de 2 tokens, não confirma e gasta as tentativas de uma vez (revisão B3). Sem
  // palavra de telefone nem DDD, "0000 1111" continua sendo dois palpites.
  let t = normalizarMensagemDoCliente(texto).replace(/\n/g, " ");
  for (const re of [TELEFONE_COM_CONTEXTO, TELEFONE_COM_DDD]) {
    re.lastIndex = 0;
    t = t.replace(re, m => " ".repeat(m.length));
  }
  const tokens: string[] = [];
  const re = /(?<![0-9])\d{4}(?![0-9])/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const antes = t.slice(Math.max(0, m.index - 12), m.index), depois = t.slice(m.index + 4, m.index + 14);
    if (/\d[/.:,-]$/.test(antes) || /^[/.:,-]\d/.test(depois)) continue; // data, hora, valor, telefone
    if (/r\$ ?$/.test(antes) || /^ ?(?:reais|real|conto|contos|pila|mil|k)(?![a-z])/.test(depois)) continue; // valor
    if (/(?<![a-z])(?:as|às|desde|ano de|anos de|ano|em (?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?: de)?) $/.test(antes)) continue;
    if (/^ ?(?:h|hs|hrs|horas?)(?![a-z])/.test(depois)) continue;
    tokens.push(m[0]);
  }
  return [...new Set(tokens)];
}

/* ───────────────────────── antes da identidade ───────────────────────── */

export const CATEGORIAS_PRE_IDENTIDADE = [
  "ignorar", "audio", "audio_repetido", "midia", "outra_midia",
  "vulnerabilidade", "numero_errado", "terceiro", "pediu_para_parar", "contesta_titularidade", "juridico", "ameaca", "contestacao", "pediu_pessoa",
  "digitos", "pergunta_robo", "duvida_golpe", "pergunta", "sem_digitos",
] as const;
export type CategoriaPreIdentidade = (typeof CATEGORIAS_PRE_IDENTIDADE)[number];

export interface MensagemParaTriagem {
  /** `type` da mensagem no Chat BullQ ("TEXT", "AUDIO", "IMAGE"…). Ausente = texto. */
  tipo?: string | null;
  texto?: string | null;
  /** O cliente já recebeu, neste episódio, o pedido para escrever em vez de mandar áudio. */
  audioJaRespondido?: boolean;
  /**
   * O nome do cliente no cadastro (só o primeiro nome é usado, e nunca sai daqui). Reconhece "não sou Maria",
   * "aqui não tem Maria" e "Maria saiu" — frases sem artigo que, sem o nome, não dá para separar de outras.
   */
  nomeDoCliente?: string | null;
}
export interface TriagemPreIdentidade {
  categoria: CategoriaPreIdentidade;
  /** Os tokens candidatos a final do CPF (só em texto). Nunca vão a log. */
  digitos: string[];
}

/**
 * Antes da identidade, o que a mensagem é (spec §3.2, na ordem). Acréscimos à lista da spec, com o porquê:
 * - `vulnerabilidade` vem PRIMEIRO: "a titular faleceu, sou o filho dela" não pode receber "pede pra ela
 *   falar comigo", nem os dígitos do CPF.
 * - `juridico` e `ameaca` transferem antes da identidade, como já faziam: pedir dígitos a quem ameaça
 *   Procon não resolve nada e o escalation.ts do Provedor.ai também escala sem identidade.
 * - Os dígitos vêm ANTES de robô, golpe e pergunta (itens 7–9): quem manda "é robô? 8909" já respondeu ao
 *   desafio. Confirmando, a pergunta segue ao planejador, e o verificador exige a confirmação da automação
 *   (D1) naquele turno — nada se perde, e a conversa não trava pedindo o que já veio.
 * - `contestacao` (formal: "quero contestar") transfere com aviso neutro: não nega o vínculo — quem nega
 *   cai em `contesta_titularidade`, que encerra —, mas também não fica com a IA (correção 2).
 * - Número errado "ambíguo" ("não sou a Maria", "ela não mora mais aqui") só vale sem terceiro declarado na
 *   mesma mensagem: "não sou a Maria, sou o marido dela" pede a titular.
 * Pagamento informado sem dígitos NÃO transfere aqui: "já paguei" pede os dígitos primeiro (a conferência
 * precisa saber de quem é), e com a identidade confirmada a regra do §3.3 transfere com o aviso certo.
 */
export function classificarMensagemPreIdentidade(msg: MensagemParaTriagem): TriagemPreIdentidade {
  const tipo = tipoDaMensagem(msg.tipo ?? "TEXT", msg.texto);
  const nada = (categoria: CategoriaPreIdentidade): TriagemPreIdentidade => ({ categoria, digitos: [] });
  if (tipo === "figurinha_ou_reacao" || tipo === "so_emoji" || tipo === "vazia") return nada("ignorar");
  if (tipo === "audio") return nada(msg.audioJaRespondido ? "audio_repetido" : "audio");
  if (tipo === "imagem_ou_documento") return nada("midia");
  if (tipo === "outra_midia") return nada("outra_midia");
  const texto = msg.texto ?? "";
  if (detectarVulnerabilidade(texto)) return nada("vulnerabilidade");
  const nome = msg.nomeDoCliente ?? null;
  if (detectarNumeroErrado(texto, nome)) return nada("numero_errado");
  if (detectarTerceiro(texto, nome)) return nada("terceiro");
  if (detectarPedidoParaParar(texto)) return nada("pediu_para_parar");
  if (casa(RE.contesta, norm(texto))) return nada("contesta_titularidade");
  if (detectarJuridico(texto)) return nada("juridico");
  if (detectarAmeacaGrave(texto)) return nada("ameaca");
  if (detectarContestacaoFormal(texto)) return nada("contestacao");
  if (detectarPedidoDePessoa(texto)) return nada("pediu_pessoa");
  const digitos = tokensDeDigitos(texto);
  if (digitos.length) return { categoria: "digitos", digitos };
  if (detectarPerguntaDeRobo(texto)) return nada("pergunta_robo");
  if (detectarDuvidaDeGolpe(texto)) return nada("duvida_golpe");
  if (detectarPergunta(texto)) return nada("pergunta");
  return nada("sem_digitos");
}

export type DecisaoDaTriagem =
  /** não responde, não transfere, não conta turno */
  | { acao: "ignorar" }
  /** frase do servidor (B2) e a conversa segue com a funcionária */
  | { acao: "responder"; situacao: SituacaoPreIdentidade }
  /** frase própria do servidor e a conversa vai à equipe EM SILÊNCIO (sem aviso de transferência, §3.4) */
  | { acao: "encerrar"; situacao: SituacaoPreIdentidade; gravarNaoContatar?: true; conferirTelefone?: true }
  /** aviso de transferência NEUTRO (antes da identidade, nada revela o motivo) */
  | { acao: "transferir"; aviso: CategoriaDeTransferencia }
  /** avaliar os dígitos (`avaliarIdentidade`) */
  | { acao: "identidade" };

/** O que fazer com cada categoria antes da identidade (spec §3.2 e §3.4). */
export function decidirPreIdentidade(categoria: CategoriaPreIdentidade): DecisaoDaTriagem {
  switch (categoria) {
    case "ignorar": return { acao: "ignorar" };
    case "audio": return { acao: "responder", situacao: "audio" };
    case "audio_repetido": return { acao: "transferir", aviso: "generica" };
    case "midia": return { acao: "transferir", aviso: "pagamento_informado" };
    case "outra_midia": return { acao: "transferir", aviso: "generica" };
    case "vulnerabilidade": return { acao: "transferir", aviso: "vulnerabilidade" };
    case "numero_errado": return { acao: "encerrar", situacao: "numero_errado", conferirTelefone: true };
    case "terceiro": return { acao: "responder", situacao: "terceiro" };
    case "pediu_para_parar": return { acao: "encerrar", situacao: "pediu_para_parar", gravarNaoContatar: true };
    case "contesta_titularidade": return { acao: "encerrar", situacao: "contesta_titularidade" };
    case "juridico": return { acao: "transferir", aviso: "juridico" };
    case "ameaca": return { acao: "transferir", aviso: "generica" };
    case "contestacao": return { acao: "transferir", aviso: "contestacao" };
    case "pediu_pessoa": return { acao: "transferir", aviso: "pedido_pessoa" };
    case "digitos": return { acao: "identidade" };
    case "pergunta_robo": return { acao: "responder", situacao: "pergunta_robo" };
    case "duvida_golpe": return { acao: "responder", situacao: "duvida_golpe" };
    case "pergunta": return { acao: "responder", situacao: "explicacao" };
    case "sem_digitos": return { acao: "responder", situacao: "re_pedido" };
  }
}

/* ───────────────────────── depois da identidade ───────────────────────── */

export interface OpcoesDaTransferencia {
  /** "AAAA-MM-DD" em Brasília: decide se "pago dia N" já passou. */
  hoje: string;
  /** Negociação autônoma ligada (e fora da recuperação): desconto e parcelamento vão ao motor de ofertas. */
  permitirNegociacao?: boolean;
  /** O nome do cliente no cadastro, quando o serviço o tiver: reconhece "não sou Maria" sem artigo. */
  nomeDoCliente?: string | null;
}

/**
 * Depois da identidade, o que tira a conversa da funcionária e com QUAL aviso (spec §3.3, categorias do
 * escalation.ts + exceções do Consulta ISP). `null` = segue ao planejador. Não transferem, de propósito:
 * "é golpe?" (desconfiança), "você é robô?" (D1), "tô desempregado"/"tô sem dinheiro" (capacidade),
 * "pago dia N" com N depois de hoje, "pago amanhã/sexta/quando receber" (promessa), "quero cancelar"
 * (objeção) e "quem paga é meu marido" (terceiro pagador).
 *
 * Terceiro declarado ("sou a filha dela", "o cpf é da minha mãe") transfere (revisão final, LGPD e CDC art. 42): antes
 * dos dígitos ele recebe a frase que pede o titular, mas nada ficava marcado — mandava "8909" na mensagem seguinte,
 * confirmava e a triagem de depois, que também lê os pedidos anteriores (s10), não o via; com a identidade vigente,
 * "sou o marido dela, quanto deve?" ia ao planejador. É o MESMO detector de antes da identidade: os falsos positivos
 * do titular já foram calibrados lá, e o que sobra custa uma conversa com a equipe, nunca um dado com um estranho.
 */
export function classificarTransferencia(texto: string, opcoes: OpcoesDaTransferencia): CategoriaDeTransferencia | null {
  if (detectarAmeacaGrave(texto)) return "generica";
  if (detectarJuridico(texto)) return "juridico";
  if (detectarPedidoDePessoa(texto)) return "pedido_pessoa";
  if (detectarVulnerabilidade(texto)) return "vulnerabilidade";
  if (detectarPagamentoInformado(texto, opcoes.hoje)) return "pagamento_informado";
  if (detectarDevolucaoInformada(texto)) return "devolucao_informada";
  if (detectarContestacao(texto)) return "contestacao";
  // quem confirmou os dígitos e diz não ser o cliente vai à equipe — sem a desculpa por engano (correção 2)
  if (detectarNegaSerOCliente(texto, opcoes.nomeDoCliente)) return "generica";
  if (detectarTerceiro(texto, opcoes.nomeDoCliente)) return "generica";
  const t = norm(texto);
  if (casa(RE.politica, t)) return "generica";
  if (!opcoes.permitirNegociacao && casa(RE.negociacao, t)) return "generica";
  return null;
}

/**
 * Depois da identidade, o que ENCERRA sem aviso de transferência (§3.4): número errado e pedido para parar
 * têm frase própria. `null` = nada disso. Só o número errado INEQUÍVOCO (engano, troquei de número, "esse
 * chip é meu agora"): o titular que acabou de confirmar e diz "não conheço o técnico" ou "ela mudou de ideia"
 * não pode receber a desculpa por engano nem ter o telefone marcado para conferir (correção 2).
 */
export function classificarEncerramento(texto: string): "numero_errado" | "pediu_para_parar" | null {
  if (detectarNumeroErradoInequivoco(texto)) return "numero_errado";
  if (detectarPedidoParaParar(texto)) return "pediu_para_parar";
  return null;
}
