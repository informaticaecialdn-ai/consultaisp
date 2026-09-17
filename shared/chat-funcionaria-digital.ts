/**
 * Verificador das mensagens da funcionária digital (spec 2026-09-16, §6).
 *
 * POR QUE existe: depois da identidade o modelo escreve ao cliente, e o texto
 * dele é NÃO CONFIÁVEL — sob injeção ou só por imitar os exemplos do
 * Provedor.ai, ele promete desconto, garante que não corta, afirma promessa que
 * ninguém gravou, cita valor que ninguém leu ou se diz gente. O planejador pode
 * errar; esta função é a última porta antes do WhatsApp e não depende do prompt.
 * Recusou → o serviço usa a reserva humanizada; a AÇÃO da rodada nunca depende
 * deste texto (D6).
 *
 * Puro: sem banco, sem rede, sem relógio (o `hoje` vem de fora, em Brasília) e
 * sem import de server. `motivo` é um código FECHADO — nunca trecho, valor, nome
 * ou telefone —, para poder ir a log e a evento sem vazar a conversa (achado s13).
 *
 * Regras e vocabulário são DADO (as constantes abaixo). Mudar uma lista é mudar a
 * política: o teste adversarial ao lado diz o preço de cada mudança.
 */
import type { OfertaDeAcordo } from "./cobranca/acordo";

/* ───────────────────────── códigos de recusa ───────────────────────── */

export const CODIGOS_DE_RECUSA = [
  "contexto_invalido",
  "fase_invalida",
  // forma
  "quantidade_de_baloes",
  "tamanho_do_balao",
  "tamanho_total",
  "markdown",
  "caractere_invalido",
  // conteúdo proibido sempre
  "link_ou_contato",
  "sequencia_de_digitos",
  "marcacao_de_modelo",
  "rotulo_interno",
  "meta_talk",
  "apresentacao_robotica",
  "presenca_humana",
  "negou_automacao",
  "faltou_confirmar_automacao",
  "ameaca",
  "pedido_de_dado_sensivel",
  "concessao",
  "consequencia_ou_garantia",
  "compromisso_sem_acao",
  "prazo_ou_imediatez",
  "quitacao_ou_devolucao",
  "gravacao_sem_registro",
  "gravacao_divergente",
  "proposta_sem_data",
  "proposta_sem_pergunta",
  "segunda_via_com_detalhe",
  // números
  "numero_por_extenso",
  "milhar",
  "dinheiro_sem_numero",
  "valor_fora_dos_fatos",
  "data_fora_dos_fatos",
  "data_relativa_divergente",
  "hora_fora_da_proposta",
  "parcelas_fora_das_ofertas",
  "percentual_fora_das_ofertas",
  "valor_e_data_de_fatos_diferentes",
  "inteiro_nao_permitido",
  "valor_no_turno_da_identidade",
  // carteira e conversa
  "termo_financeiro_em_equipamentos",
  "repeticao",
  // antes da identidade (frases do servidor)
  "termo_pre_identidade",
  "digito_pre_identidade",
  "nome_pre_identidade",
  "endereco_pre_identidade",
  "emoji_ou_simbolo_pre_identidade",
] as const;
export type CodigoRecusa = (typeof CODIGOS_DE_RECUSA)[number];

/* ───────────────────────── contrato ───────────────────────── */

export const ACOES_DA_RODADA = ["responder", "transferir", "segunda_via", "promessa", "agendar"] as const;
export type AcaoDaRodada = (typeof ACOES_DA_RODADA)[number];

export const SITUACOES_DA_RODADA = [
  "conversa",
  "identidade_recem_confirmada",
  "apresentar_ofertas",
  "promessa_registrada",
  "agendamento_registrado",
  "acordo_registrado",
] as const;
export type SituacaoDaRodada = (typeof SITUACOES_DA_RODADA)[number];

export type CarteiraDaConversa = "ativo" | "ex_cliente" | "equipamentos";

/** Um fato lido nesta rodada. Valor e data com o MESMO `id` são do mesmo fato (ex.: uma fatura). */
export interface FatosDaRodada {
  valores?: readonly { id: string; centavos: number }[];
  datas?: readonly { id: string; data: string }[];
  /** "HH:MM" — ex.: retirada já combinada. */
  horas?: readonly string[];
}
/** Uma oferta calculada pelo SERVIDOR (valores em centavos, datas "AAAA-MM-DD"). */
export interface OfertaVerificavel {
  valoresCentavos: readonly number[];
  parcelas: number;
  percentual: number;
  datas: readonly string[];
}
/** O que o cliente disse e o servidor resolveu: data "AAAA-MM-DD", hora "HH:MM". */
export interface PropostaVerificavel {
  data: string;
  valorCentavos?: number;
  hora?: string;
}
export interface GravadoVerificavel extends PropostaVerificavel {
  tipo: "promessa" | "agendamento" | "acordo";
}
export interface NomesDaVerificacao {
  persona: string;
  provedor: string;
  primeiroNomeCliente?: string | null;
}
export interface ContextoDaVerificacao {
  /** A pré-identidade não recebe texto do modelo (D5): qualquer outra fase é recusada. */
  fase: "pos_identidade" | "pre_identidade";
  acao: AcaoDaRodada;
  situacao?: SituacaoDaRodada;
  carteira: CarteiraDaConversa;
  fatos?: FatosDaRodada;
  ofertas?: readonly OfertaVerificavel[];
  proposta?: PropostaVerificavel | null;
  gravado?: GravadoVerificavel | null;
  ultimaMensagemDoCliente?: string | null;
  baloesJaEnviados?: readonly string[];
  nomes: NomesDaVerificacao;
  /** "AAAA-MM-DD", no fuso de Brasília. */
  hoje: string;
}
export type ResultadoDaVerificacao = { ok: true; mensagens: string[] } | { ok: false; motivo: CodigoRecusa };

export const LIMITES_DAS_MENSAGENS = { baloes: 3, caracteresPorBalao: 600, caracteresNoTotal: 1200 } as const;

/** Converte a oferta do motor de acordo (reais) no formato do verificador (centavos). */
export function ofertaVerificavel(oferta: OfertaDeAcordo): OfertaVerificavel {
  const c = (v: number) => Math.round(v * 100);
  return {
    valoresCentavos: [oferta.valor, oferta.valorParcela, oferta.entrada].filter(v => Number.isFinite(v) && v > 0).map(c),
    parcelas: oferta.parcelas,
    percentual: oferta.descontoPct,
    datas: [...oferta.vencimentos],
  };
}

/* ───────────────────────── normalização ───────────────────────── */

// Caracteres invisíveis, de controle bidi, seletores de variação e TAGS Unicode
// (U+E0000–E007F: Script=Common, então a checagem de escrita não os vê, e o
// WhatsApp não os desenha): servem para quebrar palavra ("co​brança") sem mudar
// o que o cliente lê.
const INVISIVEIS = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

/** Minúsculas, sem acento, sem invisíveis, espaços colapsados; quebras de linha preservadas. */
export function normalizarParaVerificacao(texto: string): string {
  return texto
    .normalize("NFKC")
    .replace(INVISIVEIS, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
}

/** Letra de outra escrita ("cоbrança" com o cirílico) é a forma mais barata de escapar de lista. */
const ESCRITA_ESTRANHA = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\s]/u;
/**
 * Depois da normalização (sem acento, minúsculas) toda letra tem que ser a–z. O latim estendido
 * ("ɗesconto" com U+0257, "humanɑ" com U+0251) é Script=Latin e a NFD não o decompõe: sem isto ele
 * passava por todas as listas de uma vez. Português legítimo não chega aqui — o acento já saiu.
 */
const LETRA_FORA_DO_ALFABETO = /[^\P{L}a-z]/u;

/**
 * "IA" maiúsculo é a sigla; minúsculo, "ia" é quase sempre o verbo ("eu ia pagar"). A caixa só existe
 * antes da normalização, então a sigla vira a expressão por extenso aqui, e a partir daí as mesmas
 * listas de "inteligencia artificial" valem para ela — inclusive as de negação ("IA não", "nada de IA").
 */
const SIGLA_IA = /(?<![\p{L}\p{N}])I\.A\.?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])IA(?![\p{L}\p{N}])/gu;
function comSiglaPorExtenso(texto: string): string {
  return texto.normalize("NFKC").replace(INVISIVEIS, "").replace(SIGLA_IA, "inteligência artificial");
}
/** Normalização com a sigla IA lida antes de perder a caixa. */
const normalizarComSigla = (texto: string) => normalizarParaVerificacao(comSiglaPorExtenso(texto));

// "#" no fim de um fragmento = fim de palavra. Fragmentos já vêm normalizados
// (sem acento, minúsculos) e evitam barra invertida: [0-9], [$], [?], [.].
const FIM = "(?![a-z0-9])";
function compilar(fragmentos: readonly string[]): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${fragmentos.map(f => f.replace(/#/g, FIM)).join("|")})`);
}
const escapar = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ───────────────────────── vocabulário (DADO) ───────────────────────── */

/**
 * Cada lista é uma classe fechada do §6. Os fragmentos casam no INÍCIO de
 * palavra do texto normalizado, então "descont" pega desconto, descontinho e
 * descontar. Exceções ficam no próprio fragmento, com o motivo ao lado.
 */
export const VOCABULARIO = {
  /** §6.2 — rótulos de bloco importado do Provedor.ai. */
  rotulosInternos: ["modo validacao", "voz e estilo", "escada#", "uso interno", "cadencia de conversa", "taxonomia de objec", "handoff", "gate#"],
  /** §6.3 — a funcionária não fala da própria máquina. */
  metaTalk: [
    "prompt", "instruc(?:ao|oes)#", "json#", "sistema interno", "erp#", "servidor", "planejador", "modelo de linguagem",
    "llm#", "gpt", "chat ?gpt", "open ?ai#", "token", "chat ?bullq", "bullq", "allowed ?actions",
    // a mesma máquina em outras palavras
    "minha programac", "fui (?:treinad|programad|configurad)", "(?:regras|orientacoes|diretrizes) que (?:recebi|me deram|eu tenho|tenho)#",
  ],
  /** D1 — "assistente virtual" é exatamente a voz de bot que o dono pediu para tirar. */
  apresentacaoRobotica: ["assistente virtual", "sac automatico"],
  /** §6.4 — afirmar ser gente ou presença física. "supervisao humana" e "colega humano" passam (f11). */
  presencaHumana: [
    // "não sou uma pessoa: é um atendimento automatizado" é o disclosure honesto da D1, não afirmação de gente
    "(?<!(?:nao|nem) )sou (?:uma |um )?(?:pessoa|humana|humano|gente)#", "(?<!(?:nao|nem) )sou (?:a |uma |o |um )?atendente#",
    "(?<!(?:nao|nem) )sou (?:uma |um )?(?:pessoa |humana |humano |gente )?(?:real|de verdade)#",
    "funcionari[oa] de verdade", "de carne e osso", "(?:atendente|pessoa|gente|humana|humano) (?:de verdade|real#)",
    // quem fala + (nome, aposto, artigo) + gente: "Sou a Clara, uma pessoa da equipe" chega aqui como "sou a , uma
    // pessoa" (o nome sai antes). A janela para em negação, em palavra de automação e em oferta ("se preferir falar
    // com uma pessoa"), e "a gente" é pronome.
    "(?:(?<!(?:nao|nem) )(?:eu )?(?:sou|somos)|aqui (?:e|eh)|quem (?:fala|responde|escreve|atende|te atende|te responde|(?:esta|ta) (?:falando|respondendo|escrevendo|te atendendo)) (?:aqui )?(?:e|eh)|(?:voce|vc) (?:ta|esta) (?:falando|conversando) com)" +
      "(?:(?!nao#|nem#|jamais|automat|sistema|digital|virtual|rob|bot|inteligen|atendimento|canal|falar|chamar|chamo#|chama#|com#|pra#|para#|se#|quer|prefer|pode#|mas#)[^.!?;\\n]){0,24}?" +
      "(?<![a-z])(?:pessoas?|human[oa]s?|(?<!(?<![a-z])a )gente|atendente|moc[ao]|mulher|homem|menina|rapaz|garota|funcionari[oa]|colaborador(?:a)?)#",
    "(?<!(?:nao|nem) )(?:eu )?sou(?:(?!nao#|nem#|automat|sistema|digital|virtual|atendimento|canal)[^.!?;\\n]){0,24}?(?<![a-z])(?:real#|de verdade|de carne)",
    "(?:tem|ha) (?:uma |um )?(?:pessoa|gente|atendente|humano|humana)(?: de verdade| real)? (?:aqui|do outro lado|falando|respondendo|atendendo|escrevendo|lendo|conversando|te atendendo|te respondendo)#",
    // "humana/humano" quase só aparece para afirmar gente: recusa fora de uma lista curta — supervisão/colega/equipe
    // humana, falar com um humano, e a negação ("não sou humana")
    "(?<!(?:supervisao|atendimento|atendente|colega|colegas|equipe|time|acompanhamento|revisao|contato|apoio|suporte|ajuda|analise|avaliacao|intervencao|operador|operadora|alguem|olhar|toque) )(?<!com (?:um |uma |o |a |os |as )?)(?<!(?:nao|nem) (?:sou |e |eh |somos |estou |to |tem |ha )?(?:um |uma |o |a |nenhum |nenhuma )?)human[oa]s?#",
    "escritorio", "almoc", "cafezinho", "cafe#", "minha mesa#", "meu turno#", "meu expediente", "plantao",
    "(?:meu|minha) (?:computador|pc|notebook|celular|cadeira|sala|baia)#",
    "(?:meu|minha) (?:gerente|chefe|supervisor|supervisora|coordenador|coordenadora|colega de mesa)#",
    // "o trabalho na sua casa" é substantivo; "trabalho aqui na NsLink" é gente
    "(?<!(?<![a-z])(?:o|um|esse|este|seu|do|no|de|pelo|bom) )trabalho (?:aqui|na|no|em|pra|para|com|ha|faz)#",
    "te ligo#", "ligo pra (?:voce|vc|ti)#", "ja volto#", "volto ja#", "eu mesm[ao] (?:vou|verifico|confiro|passo|busco|levo)#",
  ],
  /** §6.4 — negar a automação, com ou sem pergunta do cliente. */
  negacaoDeAutomacao: [
    "(?:nao|nem) (?:sou|e|eh|estou|to|ta|esta|somos)(?: (?:um|uma|nenhum|nenhuma|o|a))? (?:robo|robozinho|bot|chatbot|maquina|inteligencia artificial|automatic|automatiz|sistema|gravac|virtual)",
    "(?:nao|nem) (?:tem|ha|existe|usa|usamos|uso) (?:nenhum |nenhuma |uma |um )?(?:robo|bot#|maquina|inteligencia artificial|automac)",
    "(?:nada de|nenhum|nenhuma|sem(?: nenhum| nenhuma| uma| um)?) (?:robo|robozinho|bots?#|chatbot|maquina|inteligencia artificial|automac|gravac)",
    "(?:sou|e|eh) (?:um |uma )?(?:robo|robozinho|bot|maquina|sistema|gravacao) nao#",
    // negação ATÉ ~20 caracteres ANTES do radical ("nem de longe sou robô", "longe de ser um atendimento
    // automatizado"), na mesma frase e sem falar de gente no meio ("não sou uma pessoa, sou automatizada" é
    // disclosure). "ia" minúsculo fica fora: "não ia dar" é verbo; a sigla chega aqui por extenso.
    "(?:nao|nem|jamais|nunca|imagina|que nada|de jeito nenhum|negativo|longe de ser|longe disso)(?![a-z])(?:(?!pessoa|human|gente|atendente|preocup)[^.!?;:\\n]){0,20}?(?<![a-z])(?:rob(?:o|ot)|chatbot|bots?#|maquina|automat|inteligencia artificial|gravac)",
    // "que IA o quê", "que robô, sou a Clara": o "que" de desdém fecha a negação
    "que (?:rob(?:o|ot)[a-z]*|bots?|chatbot|maquina|inteligencia artificial|automat[a-z]*|gravac[a-z]*)(?= o que#| que nada#| nada#|[^a-z\\n]*(?:$|[,.!;\\n]))",
    // radical ANTES da negação ("robô não, sou a Clara", "eu? robô? jamais!"): a negação fecha a fala. "automatizado,
    // não uma pessoa" e "automatizado, não precisa esperar" seguem com palavra e passam.
    "(?:rob(?:o|ot)[a-z]*|chatbot|bots?|maquina[a-z]*|automat[a-z]*|inteligencia artificial|ia(?=[?!]))[^a-z\\n]{0,6}(?:(?:eu|aqui|isso|mesmo|que|sou|e)[^a-z\\n]{1,4}){0,2}(?:nao|nem|jamais|nunca|imagina|que nada|de jeito nenhum|negativo)(?=[^a-z\\n]*(?:$|[,.!?;:\\n])|(?: (?:nao|mesmo|viu|ne|kk+|haha)(?![a-z])))",
  ],
  /** §6.4 — radicais que tornam a mensagem do cliente uma pergunta sobre QUEM atende (detector que falha fechado). */
  perguntaSobreAtendimento: [
    // prefixo amplo de propósito (robozin, robozão, robótico): o custo é um "Roboredo" exigir confirmar a automação
    "rob(?:o|ot)", "bot(?:s|zinho|zin)?#", "chatbot", "chat ?gpt", "gpt", "open ?ai#", "inteligen", "automat", "maquina",
    "gravac", "gravad[oa]#", "humano", "humana", "pessoa#", "alguem (?:ai|aqui|lendo|vendo|respondendo|atendendo)#", "tem alguem#",
    "atendente (?:de verdade|real)", "(?:e|eh|vc e|voce e|isso e|falo com|falando com) (?:um |uma |o |a )?atendente#",
    // "a gente paga sexta" é pronome; "é gente?", "tem gente aí?" e "gente me atendendo" são a pergunta
    "(?:e|eh|sao|voce e|vc e|isso e|uma?|tem|ter|ha) gente#", "gente (?:de verdade|mesmo|real|ai|aqui|atendendo|me atendendo|falando|lendo|respondendo)#",
    "(?<!(?:a|da|pra|com a|na) )gente ?[?]",
    // "o sistema de vocês cobrou errado" não pergunta nada; "é sistema?" e "é o sistema que responde?" perguntam
    "(?:e|eh|um|isso e|vc e|voce e|com o|com um) sistema#", "(?:e|eh|isso e|quem responde e) o sistema#", "sistema ?[?]",
    // "eu ia pagar" é verbo; "é IA?", "tô falando com ia", "vcs usam ia" e "resposta de ia" são a pergunta — depois
    // de "com/de/por" e de "usar", "ia" nunca é o verbo
    "(?:e|eh|uma|com a|com uma|com|de|por|pela|numa|isso e|vc e|voce e) ia#", "(?:usa|usam|usando|usar|utiliza|utilizam|utilizando) (?:uma |a )?ia#",
    "ia (?:que )?(?:responde|respondendo|escreve|escrevendo|atende|atendendo)#",
    "ia ?[?]", "i[.]a[.]?", "(?:e|eh|voce e|vc e|isso e) real ?[?]", "de verdade ?[?]",
    // "é mensagem do sistema", "isso é do sistema?", "responde sozinho?"
    "(?:mensagem|msg|resposta|texto|isso|e|eh|vem|veio) (?:e |eh )?do sistema#", "(?:mensagem|msg|resposta|texto)s? (?:pronta|padrao|gerada)#",
    "(?:responde|respondendo|responder|escreve|escrevendo|funciona) sozinh",
  ],
  /**
   * §6.4 — o que conta como confirmar a automação. A sigla IA chega por extenso e só confirma como predicado
   * ("é uma IA", "com IA"): citada solta, ou num nome de provedor ("IA Net", removido antes), não diz o que o
   * atendimento É. A negação ("aqui não tem IA") já foi recusada antes desta conferência.
   */
  confirmacaoDeAutomacao: [
    "automatizad",
    "(?:sou|e|eh|somos|aqui e|isso e|esse e|este e|trata-se de|com|de|por|via|usando|pela|pelo|numa|uma|a) (?:(?:uma|a|um|o|nossa|nosso|sistema|atendimento|assistente|ferramenta|tecnologia) ){0,2}inteligencia artificial#",
    // "sistema", "digital" e "virtual" só confirmam quando dizem o que É o atendimento: "no nosso sistema aparece a
    // fatura" responde "é robô?" sem confirmar nada
    "(?:sou|e|eh|somos|aqui e|isso e|esse e|este e|trata-se de|falando com|fala com|via|pelo|por um|por uma|com um|com uma) (?:um |uma |o |a |nosso |nossa )?(?:[a-z]+ ){0,2}(?:sistema|digital|virtual|automatic[oa])#",
  ],
  /** §6.5 — ameaça. "processo" sozinho não: só o judicial (f11). */
  ameaca: [
    "negativ", "spc#", "serasa", "protest", "cartorio", "justica#", "judicia", "processar", "processo (?:judicial|contra|na justica)",
    "advogad", "nome sujo", "sujar (?:o |seu |teu )?nome", "policia", "delegacia", "orgaos? de protecao",
    // a ameaça vaga pesa igual: "medidas cabíveis" e "restrição no CPF" são o SPC sem dizer SPC
    "medidas (?:cabive|legais|judiciais|necessarias|administrativas)", "providencias (?:cabive|legais|judiciais|necessarias)",
    "restric", "restrit", "execuc", "protecao ao credito", "cadastro (?:de|dos) (?:inadimpl|devedor|mau)", "bir[oo] de credito",
    // a dívida "no nome" sem dizer SPC: "não devolvendo, vai pro seu nome"
    "(?:vai|vao|ir|fica|ficar|cai|cair) (?:pro|pra|no|para o) (?:seu|teu) nome#", "(?:pro|pra) (?:seu|teu) nome#",
  ],
  /**
   * §6.6 — polaridade invertida: QUALQUER objeto sensível recusa, com ou sem verbo de pedido ("me dá a senha",
   * "coloca aqui o cartão", "a foto do RG ajuda"). Só passa o objeto que a própria frase NEGA ("a gente nunca pede
   * senha", "não precisa mandar documento", "sem foto") — e a negação não atravessa adversativa: "não precisa
   * mandar a senha, só a foto do RG" pede o RG. Depois da identidade, "CPF" solto é o CPF inteiro; só os 4 últimos
   * dígitos do desafio ficam de fora.
   */
  objetoSensivel:
    "(?:senhas?|fotos?|fotograf[a-z]*|selfies?|documentos?|rg|cartao|cartoes|cnh|cpf|todos os digitos|codigo (?:de verificacao|de seguranca|que chegou|do sms|enviado|recebido)|comprovante de (?:residencia|endereco))",
  /** O que pode ficar entre a negação e o objeto negado: auxiliar, verbo de pedido, pronome e determinante. Vírgula, "de" solto ou verbo de lembrar ("não esquece de mandar") quebram. */
  negacaoDoObjetoSensivel: {
    negadores: "(?:nunca|jamais|nao|nem|sem)",
    ligacoes:
      "(?:precisa|precisam|precisamos|precisar|preciso|vai|vamos|vou|vao|deve|devemos|podemos|costuma|costumamos|costumam|iremos|mais|e preciso|e necessario|tem que|temos que|" +
      "pede|pedimos|pedem|pedir|peco|solicita|solicitamos|solicitam|solicitar|exige|exigimos|exigem|exigir|manda|mandar|mande|mandamos|envia|enviar|envie|enviamos|" +
      "passa|passar|passe|informa|informar|informe|digita|digitar|digite|compartilha|compartilhar|compartilhe|fornece|fornecer|forneca|mostra|mostrar|mostre|" +
      // sem "pode", "dá" e "do": "não pode me mandar a senha?" e "não dá pra passar o RG?" pedem
      "confirma|confirmar|confirme|anexa|anexar|anexe|coloca|colocar|coloque|escreve|escrever|escreva|usa|usar|use|dar|de|pra|para|por aqui|aqui|" +
      "me|te|lhe|se|nos|vos|a|o|as|os|sua|seu|suas|seus|tua|teu|nenhum|nenhuma|nenhum tipo de|nada de|qualquer|uma|um)",
    /** Entre dois objetos da mesma lista negada ("senha, foto ou o CPF", "foto do documento"). Adversativa (só, mas, além) não entra. */
    continuacao: "(?:,? (?:ou|nem|e|com|segurando|junto com)|,|(?: d[oa]s?| de))(?: (?:a|o|as|os|sua|seu|suas|seus|tua|teu|uma|um|nenhum|nenhuma|qualquer))* ?",
  },
  /** §6.7 — concessão: só na introdução das ofertas, e sem número. */
  concessao: [
    "descont", "abat", "juros", "multa", "isen", "perdo", "perdao", "anist", "abon", "zerar", "zera#",
    // "tirar a dúvida" é a única exceção: "tirar a mora", "tiro o acréscimo" concedem
    "tir(?:ar|o|amos|a|e) (?:a|o|os|as|essa|esse|essas|esses)#(?! (?:(?:sua|tua|essa|esta|minha|mais uma|uma|outra|qualquer) )?duvidas?#)",
    "acrescim", "encarg", "(?:a|da|de|sem) mora#", "abr(?:ir|o|imos|e) mao", "precinho",
    "(?:valor|preco) (?:menor|mais baixo|melhor|especial|camarada|reduzido|diferenciado)#", "pag(?:ar|a|ue|amos|ando) menos#",
    "melhor(?:ar|o|amos|e) (?:(?:o|a|esse|essa|este|esta|seu|sua|teu|tua) )?(?:valor|preco|condic|proposta|oferta|pagamento)",
    "condic(?:ao|oes) especia", "parcel", "reparcel", "refinanc",
    // pagamento parcial vai à equipe (inventário C-32)
    "pagamento parcial", "(?:paga|pagar|pague) (?:so )?(?:uma )?parte",
    "(?:paga|pagar|pague|acerta|acertar|acerte|quita|quitar|quite) so#", "um terco", "dois tercos",
    "o que (?:voce |vc )?(?:conseguir|der|puder|couber)#",
    // paráfrases que concedem sem a palavra "desconto" (CDC art. 30: a oferta escrita vincula). "segue abaixo" não é baixar preço.
    "reduz", "diminu", "divid(?:ir|o|e|imos|indo)#", "abaix(?:ar|amos)#",
    // "o que posso fazer por você?" é gentileza; "fazer por cinquentinha" é preço
    "(?:fazer|faco|deixo|deixar) por(?! (?:voce|vc|ti|aqui|la|isso|mim|nos|favor|enquanto|agora|hoje|conta|mensagem|whatsapp)#)#",
    // "às vezes", "algumas vezes" não são parcelas
    "(?<!(?<![a-z])(?:as|algumas|varias|muitas|outras|poucas|tantas|das|mil) )vezes#",
    "gratis", "gratuit", "de graca", "sem (?:nenhum )?custo", "metade",
    // retenção que o Provedor.ai prometia (inventário F-05): oferta que o servidor não calculou
    "igualar", "cobrir a (?:oferta|proposta)", "plano (?:mais barato|melhor|que (?:encaixe|caiba))", "(?:trocar|mudar|troca|mudanca) (?:de |o |do )?plano", "downgrade", "mais barat",
  ],
  /** §6.8 — consequência ou garantia: nunca. */
  consequencia: [
    "cort(?!esia|ina)", "suspen", "bloque", "deslig", "religa", "liber", "desbloque", "rescis", "rescind", "restabelec", "reativ", "reconect", "volta(?:r)? a funcionar",
    "(?:internet|sinal|conexao|servico|wi ?-?fi) (?:volta|continua|segue|vai continuar|vai voltar)#",
    // "se não vai dar sexta, qual dia?" não é garantia; "não vai ser cortada" é
    "nao vai(?! (?:dar|conseguir|poder|rolar)#)",
    "(?:pode )?fica(?:r)? tranquil", "fique tranquil", "(?:pode )?fica(?:r)? sossegad", "fique sossegad", "garant",
    // a mesma garantia em outras palavras; "tudo de boa por aí?" pergunta
    "de boa(?! ?[?]| por (?:ai|aqui))#", "despreocupad", "nada (?:de ruim |de mais |demais )?(?:vai|vao|ira) (?:acontecer|mudar|mexer)", "ninguem vai", "nao corre (?:nenhum )?risco", "sem (?:nenhum )?risco",
  ],
  /** §6.9 — compromisso que só a ação da rodada autoriza. */
  compromissoDeTransferir: [
    "vou pedir", "(?:eu )?peco pra#", "vou (?:te )?passar", "te passo#", "vou encaminhar", "encaminho#", "vou transferir", "transfiro#",
    "(?:a|nossa|o|nosso) (?:equipe|time|pessoal|financeiro|suporte|setor|atendimento) (?:te )?(?:responde|continua)#",
    // o mesmo retorno prometido por "alguém" ou "um colega", com ou sem "da equipe" ("alguém da equipe te chama")
    "(?:alguem|um colega|uma colega|colegas?)(?: human[oa])?(?: (?:da|de|do) (?:nossa |nosso )?(?:equipe|time|atendimento|financeiro|suporte|setor))? (?:ja |logo |tambem )?(?:te |com voce )?" +
      "(?:vai|vao|continua|continuam|responde|respondem|chama|chamam|fala|falam|entra|retorna|assume|atende|ajuda|segue|resolve)#",
    "(?:da|de) (?:nossa |nosso )?(?:equipe|time) (?:ja |logo )?(?:te )?(?:vai|vao|continua|responde|chama|fala|retorna|assume|atende|ajuda|segue)#",
  ],
  compromissoDeSegundaVia: ["te mando#", "vou (?:te )?mandar", "vou (?:te )?enviar", "te envio#", "mando (?:o|a|os|as|aqui|agora|ja)#", "envio (?:o|a|os|as|aqui|agora|ja)#", "segue (?:o|a|abaixo|aqui)#", "seguem (?:os|as|abaixo|aqui)#"],
  compromissoNunca: [
    "vou verificar", "vou conferir", "vou checar", "vou ver#", "verifico#", "confiro#", "confirmo (?:aqui|no sistema|pra voce|e te)",
    "te ligar#", "te liga(?:mos)?#", "(?:vamos|vai|vao) te ligar", "(?:a|nossa) equipe (?:te )?(?:chama|liga|retorna|procura|entra em contato)", "entra(?:mos)? em contato", "te lembro#", "(?:vou )?te lembrar#", "te aviso#", "vou te avisar", "lembrete",
    "(?:o|nosso|um) tecnico (?:vai|passa|vem|chega|leva|busca|consegue)", "(?:a|nossa) equipe vai", "abro (?:um |o )?chamado", "vou abrir",
    "te retorno#", "vou te retornar", "retorno (?:hoje|amanha|ainda)", "te procuro#", "vou te procurar",
    // o mesmo compromisso sem o verbo da lista: quem promete olhar promete um retorno que a rodada não executa.
    // "deixa eu te ajudar" é convite; "deixa eu verificar" é promessa
    "deixa comigo", "vou (?:resolver|dar uma olhada|dar uma checada|olhar|analisar|ver isso|ver aqui|ver com)#", "deixa eu (?:ver|verificar|conferir|olhar|checar|dar uma olhada|confirmar|consultar)#",
    "te chamo#", "te respondo#", "te dou (?:um )?retorno", "te falo (?:depois|amanha|mais tarde|assim que|quando souber)#", "vou falar com (?:o|a|os|as|meu|minha|nosso|nossa)#",
    "(?:o|nosso) (?:time|pessoal|financeiro|suporte|setor) (?:te )?(?:chama|liga|retorna|procura|vai)#",
    // providenciar e solicitar são o mesmo "vou fazer" que a rodada não executa
    "providenci", "vou solicitar", "solicito (?:a|o|aqui|pra|para)#",
    // "quinta a gente se fala" marca um contato que ninguém agendou
    "(?:a gente|nos) se fala(?:mos)?#", "falamos (?:depois|amanha|mais tarde|na|no|dia)#",
  ],
  /** §6.10 — prazo ou imediatez que a funcionária não controla. */
  prazo: [
    "ja,? ?-?ja#", "jaja#", "em instantes", "num instante", "em breve", "brevemente", "minutinho", "segundinho", "(?:fim|final) do dia",
    // "dentro de casa" é lugar; "dentro de 2 dias" é prazo
    "dentro (?:de|do|da) (?:[0-9]+|um|uma|dois|duas|tres|poucos|poucas|alguns|algumas|umas|uns|instantes|minutos|horas|dias|prazo|semana|mes)#",
    "o quanto antes", "o mais rapido", "num piscar", "(?:agora mesmo|agorinha)(?! ?[?])","em (?:alguns |poucos |[0-9]+ )?minutos", "daqui (?:a |uns |a uns )?(?:pouco|pouquinho|instantes|minutos|[0-9]+)",
    // "te falo rapidinho de um assunto" é cadência, não prazo
    "(?<!(?:falar|falo|perguntar|pergunto|conversar|explicar|explico|contar|conto) )rapidinh",
    "hoje ainda", "ainda hoje", "logo#", "imediatament",
    "em (?:[0-9]+|uma|um|duas|dois|tres|quatro|cinco|umas|uns|algumas|alguns|poucas|poucos) (?:horas?|dias?|semanas?|minutos?)#",
    "ate (?:[0-9]+|um|uma|dois|duas|tres|cinco|sete|dez) dias?(?: uteis)?#",
    "(?:leva|levam|demora|demoram) (?:umas |uns |algumas |alguns |ate )?(?:[0-9]+ )?(?:horas?|dias?|minutos?)#",
    "prazo de (?:[0-9]+|uma|um|duas|dois|tres|cinco|sete) (?:horas?|dias?)", "[0-9]+ ?h(?:oras)? uteis",
  ],
  /** §6.11 — quitação ou devolução afirmadas. "regularizar" é o verbo que o Provedor.ai recomenda; só o particípio afirma. */
  quitacao: [
    "quitad", "(?<!(?<![a-z])(?:colocar|deixar|por|botar|ficar|voltar|volte|fique) )em dia#", "regularizad", "regularizou",
    // "tudo certo com a internet por aí?" pergunta do serviço; "tá tudo certo com a sua conta, beleza?" afirma com tag
    "tudo cert(?:o|inho|issimo)(?! ?[?]| por (?:ai|aqui)| com (?:voce|vc)| contigo| (?:com|na|no) (?:a |o |sua |seu )?(?:internet|conexao|sinal|servico|wi ?-?fi)[^.!;?\\n]*[?])", "nao consta",
    // o efeito afirmado em paráfrase: o pagamento que chegou, a conta cancelada, a cobrança para ignorar
    "(?:pagamento|pix|comprovante|transferencia|deposito)(?: [a-z]+){0,2} (?:chegou|caiu|entrou|apareceu|compensou|constou|bateu)(?! ?[?])#",
    "(?:chegou|caiu|entrou|apareceu) (?:aqui )?(?:o |a )?(?:seu |sua )?(?:pagamento|pix|comprovante|transferencia|deposito)(?! ?[?])#",
    "(?<!(?:nao|ainda nao|nem) )vi (?:aqui )?(?:o |a )?(?:seu |sua )?(?:pagamento|pix|comprovante|transferencia|deposito)(?! ?[?])#",
    // "seu contrato foi cancelado" é fato do ex-cliente; a fatura cancelada é quitação
    "cancel(?:ei|amos)#", "(?<!(?:contrato|plano|assinatura|servico|internet|pedido) (?:foi |ja foi |esta |ta |ficou |ja esta )?)cancelad[oa]s?#",
    "estorn", "liquidad", "(?<!(?:nao|nem) )ignor(?:a|ar|e) (?:a|o|as|os|essa|esse|essas|esses|aquela|aquele|aquelas|aqueles|isso|essa)#",
    "(?<!(?:nao|nem) )esquec(?:e|er|a) (?:a|o|as|os|essa|esse|essas|esses|aquela|aquele|aquelas|aqueles|isso)#",
    "nada (?:mais )?(?:pra|para|a) pagar", "ja resolvi", "resolvi (?:aqui|pra (?:voce|vc)|tudo|isso|o problema|sua)#", "(?:ta|esta|ja esta|ja ta|ficou|foi) (?:tudo )?resolvid", "desconsider", "perdoad",
    "recebemos (?:o|a|os|as|seu|sua|seus|suas)#", "chegou (?:aqui )?(?:o|a|seu|sua) (?:aparelho|equipamento|roteador|onu|modem|pagamento|pix)",
    "pode ficar com", "nao precisa (?:mais )?(?:devolver|entregar|pagar (?:a|o|as|os|essa|esse|mais))", "dispensad",
    "pagamento (?:foi )?(?:confirmado|caiu|compensado|identificado|recebido|aprovado)", "caiu (?:aqui|o pagamento|o pix|certinho)", "pra cair#",
    "compensad", "baix(?:a|ar|ei|ado|ada|amos|ou)#", "(?:esta|ta|foi|consta) pag[oa]#", "nao deve (?:mais )?nada",
    "nada (?:em aberto|pendente)", "sem pendencia", "(?:fatura|conta|mensalidade|pendencia|parcela) (?:esta |ta |ja )?paga#", "obrigad[oa] pelo pagamento",
    "recebi (?:o |a |seu |sua )?(?:comprovante|pagamento|pix|aparelho|equipamento|roteador|modem)", "quitou#", "zerad", "divida (?:cancelada|encerrada)",
    // substantivo + estado, nas duas ordens: "pendência resolvida", "seu débito foi encerrado", "sua conta tá limpa",
    // "seu roteador já chegou aqui", "tá tudo ok com a sua conta". "contrato encerrado" é fato do ex-cliente e fica fora.
    "nada consta",
    "(?:pagamento|pix|debito|pendencia|divida|conta|fatura|boleto|mensalidade|saldo|situacao|cadastro|devolucao|aparelho|roteador|modem|equipamento|onu)s?(?: [a-z]+){0,3} " +
      "(?:resolvid|encerrad|concluid|finalizad|identificad|recebid|limp[oa]s?#|ok#|normalizad|em ordem|certinh|baixad|compensad)",
    "(?:pagamento|pix|comprovante|devolucao|aparelho|roteador|modem|equipamento|onu)s?(?: [a-z]+){0,3} (?:chegou|chegaram|entrou|caiu)#",
    "(?:ok|limp[oa]|em ordem|resolvid[oa]|normalizad[oa]|certinh[oa]|regular) com (?:a |o )?(?:sua |seu |tua |teu )?(?:conta|fatura|pagamento|situacao|cadastro|pendencia|divida|debito|mensalidade)#",
    "(?<!(?:nao|ainda nao|nem) )(?:identific|localiz|encontr|confirm)(?:amos|ei|ou|ado|ada)? (?:aqui )?(?:o |a )?(?:seu |sua )?(?:pagamento|pix|comprovante|transferencia|deposito|aparelho|roteador|modem|equipamento|devolucao)#",
    "(?:ja )?(?:entrou|chegou|caiu|recebi|recebemos)(?: aqui)?[,.! ]+(?:obrigad|valeu|agradec)", "nao precisa mais[,.!]",
  ],
  /** §6.12 — afirmação de gravação (passado/particípio): só com o registro feito. */
  gravacaoAfirmada: [
    "anotei", "anotad", "registrei", "registrad", "agendei", "agendad", "marquei", "marcad", "lancei", "lancad", "salvei", "salv[oa]#",
    "combinad[oa]#", "fechad[oa]#", "fica(?:mos)? pra#", "ficou pra#", "confirmad",
    "guardei", "guardad[oa]#", "coloquei (?:aqui|no sistema|na agenda|pra|para)#",
  ],
  /** §6.12 — gravação no presente/infinitivo: em pergunta passa ("posso anotar?"), em afirmação não. */
  gravacaoOferecida: ["anot(?:ar|o|amos)#", "registr(?:ar|o|amos)#", "agend(?:ar|o|amos)#", "marc(?:ar|amos)#", "(?<!(?:de|em|ate|[0-9]) )marco#", "lanc(?:ar|o|amos)#", "salv(?:ar|amos)#"],
  /** §6.14 — termos financeiros proibidos na carteira de equipamentos. */
  financeiroEmEquipamentos: [
    "valor", "r[$]", "multa", "divid", "debit", "fatur", "mensalidad", "boleto", "pix#", "saldo", "juros", "reais#", "reposic", "em aberto",
    // toda forma de cobrar e de pagar ("vai ser cobrado", "a gente cobra", "vai ter que pagar"); "cobrir" e "cobertura" são sinal
    "cobr(?!ir|indo|iu|e#|es#|ertura)", "pag(?!in)", "custo", "custa#", "custar", "caro#", "preco", "ressarc", "indeniz", "prejuiz", "arcar",
    // "o aparelho vai pra conta": a cobrança sem a palavra. "me conta" é o verbo e fica fora.
    "(?:vai|vao|pra|pro|para|na|no) (?:a |sua |tua )?conta#",
  ],
  /** f11 — o custo zero DA DEVOLUÇÃO é fato da Mariana, não concessão: só vale com assunto de devolução e sem dívida no balão. */
  custoZeroDaDevolucao: [
    "(?:nao tem|sem) (?:nenhum )?custo(?: nenhum)?", "nao custa nada", "(?:e|sai|fica) de graca", "e gratis", "gratuit[a-z]*",
    "nao precisa pagar nada", "nao (?:e|eh) (?:uma )?cobranca",
  ],
  /** §6.13 — número por extenso a partir de "quatro". */
  numeroPorExtenso: [
    "quatro#", "cinco#", "seis#", "sete#", "oito#", "nove#", "dez#", "onze#", "doze#", "treze#", "catorze#", "quatorze#", "quinze#",
    "dezesseis#", "dezessete#", "dezoito#", "dezenove#", "vinte#", "trinta#", "quarenta#", "cinquenta#", "sessenta#", "setenta#",
    "oitenta#", "noventa#", "cem#", "cento#", "duzent[oa]s#", "trezent[oa]s#", "quatrocent[oa]s#", "quinhent[oa]s#", "seiscent[oa]s#",
    "setecent[oa]s#", "oitocent[oa]s#", "novecent[oa]s#", "mil#", "milhao#", "milhoes#", "meia#", "metade#", "dobro#", "por cento#",
    // diminutivo e aumentativo: "cinquentinha", "trezentão", "cenzinho", "dezão"
    "cinquent", "sessent", "setent", "oitent", "novent", "quarent", "trint", "vint(?:inho|inha|ao|ona|e)", "duzent", "trezent", "quatrocent",
    "quinhent", "seiscent", "setecent", "oitocent", "novecent", "cenz", "cent(?:inho|ao|ona)#", "dez(?:inho|inha|ao|ona)#", "cinq(?:uinho|uinha|ao|ona)#",
    "mil(?:zinho|zinha|zao|ao|ona)#", "quinz(?:inho|inha|ao|ona)#",
  ],
} as const;

/** Vocabulário da pré-identidade: nada que diga cobrança, contrato ou equipamento (achado s1). */
export const VOCABULARIO_PRE_IDENTIDADE = {
  termos: [
    // cobrança e dinheiro
    "cobranc", "cobra(?:r|mos|do|da|ndo)#", "divid", "debit", "devedor", "devendo", "pendenc", "pendent", "fatur", "bolet", "pix#",
    // diminutivo e sinônimo: "boletinho", "a taxa", "o reembolso", "a promessa", "o combinado", "ficou pendurado"
    "tax(?:a|as)#", "reembols", "promessa", "combinad", "pendur", "em haver", "assin", "notas?#", "compra#", "comprou#", "faltand", "meses#", "aviso#",
    "pagament", "paga(?:r|mos|ndo)?#", "pague", "pagou", "pago#", "quit", "acordo", "negoci", "parcel", "descont", "juros", "multa",
    "valor", "reais#", "real#", "saldo", "conta d[ae] internet", "continha", "em abert[oa]s?#", "atras", "vencid", "vencim", "venc(?:e|eu|er)#",
    "credito", "spc#", "serasa", "negativ", "protest", "cartorio", "juridic", "judicia", "justica#", "process", "advog", "nome sujo",
    "mensalidad", "segunda via", "codigo de barras", "p(?:a)?ra tras#", "dinheir", "grana#", "financ", "renegoci", "reparcel", "refinanc",
    "inadimpl", "regulariz", "recupera", "carne#", "cobro#",
    // "o que você deve" é dívida; "deve ter sido engano" é modal (verbo no infinitivo logo depois)
    "dev(?:e|o|ia|er|eria|emos|em|ido|ida)#(?! [a-z]+(?:ar|er|ir)#)", "receb",
    // o serviço e a pressa pelo nome de outra coisa
    "velocidade", "pacote", "megas?#", "urgent", "mora#", "morando",
    // vínculo passado sem a palavra contrato: "quando você era da NsLink" (o nome do provedor sai antes)
    "(?:era|foi|usava|usou|tinha|teve|assinava) (?:da|de|do|com|a gente|nosso|nossa)#",
    // contrato e serviço
    "contrat", "plano#", "planos#", "assinatura", "assinant", "cliente", "ex-cliente", "excliente", "encerramento", "servico",
    "internet", "conexao", "sinal#", "cort(?!esia|ina)", "suspens", "suspend", "bloque", "deslig", "religa", "reativ", "cancel", "rescis", "rescind", "desbloque", "restabelec", "reconect",
    // equipamento
    "equipament", "aparelh", "roteador", "modem", "onu#", "wi ?-?fi#", "caixinha", "caixa#", "comodato", "devolu", "devolv", "chip#", "chips#", "antena", "fiac", "cabo#", "cabos#",
    "retirad", "retirar", "recolh", "busca(?:r|mos)?#", "coleta", "tecnico", "instalac", "fibra#", "visita#", "agend", "(?:passar|passa|ir|vai|vou|vamos) ai#",
  ],
  enderecos: [
    "rua#", "avenida", "av#", "travessa", "alameda", "rodovia", "estrada#", "bairro", "cep#", "condominio", "apartamento", "apto#",
    "bloco#", "quadra#", "lote#", "residencia", "endereco", "logradouro",
  ],
  /** Numerais escritos: de "um" a "tres" é fala comum; "quatro" só no desafio. */
  numeroPorExtenso: [
    "cinco#", "seis#", "sete#", "oito#", "nove#", "dez#", "onze#", "doze#", "treze#", "catorze#", "quatorze#", "quinze#", "dezesseis#",
    "dezessete#", "dezoito#", "dezenove#", "vinte#", "trinta#", "quarenta#", "cinquenta#", "sessenta#", "setenta#", "oitenta#", "noventa#",
    "cem#", "cento#", "duzent", "trezent", "quatrocent", "quinhent", "seiscent", "setecent", "oitocent", "novecent", "mil#", "milha",
    "metade#", "dobro#", "por cento#",
  ],
  /** Único emoji permitido antes da identidade. */
  emojis: ["😊"],
} as const;

const RE = {
  rotulos: compilar(VOCABULARIO.rotulosInternos),
  meta: compilar(VOCABULARIO.metaTalk),
  apresentacao: compilar(VOCABULARIO.apresentacaoRobotica),
  presenca: compilar(VOCABULARIO.presencaHumana),
  negacao: compilar(VOCABULARIO.negacaoDeAutomacao),
  perguntaAtendimento: compilar(VOCABULARIO.perguntaSobreAtendimento),
  confirmacao: compilar(VOCABULARIO.confirmacaoDeAutomacao),
  ameaca: compilar(VOCABULARIO.ameaca),
  objetoSensivel: new RegExp(`(?<![a-z])${VOCABULARIO.objetoSensivel}(?![a-z])`, "g"),
  objetoNegado: new RegExp(`(?:^|[^a-z])${VOCABULARIO.negacaoDoObjetoSensivel.negadores}(?: ${VOCABULARIO.negacaoDoObjetoSensivel.ligacoes}){0,6} ?$`),
  objetoNegadoSemNao: new RegExp(`(?:^|[^a-z])(?:nunca|jamais|nem|sem)(?: ${VOCABULARIO.negacaoDoObjetoSensivel.ligacoes}){0,6} ?$`),
  continuacaoDaLista: new RegExp(`^${VOCABULARIO.negacaoDoObjetoSensivel.continuacao}$`),
  // o desafio pede os 4 ÚLTIMOS dígitos; "os primeiros" ou "o CPF" não
  desafioDoCpf: /(?<![a-z0-9])(?:4|quatro) ultimos (?:digitos |numeros )?(?:do|de) (?:seu |teu )?$/,
  // o link ditado por extenso ("nslink ponto com ponto br", "financeiro arroba nslink") é link
  linkPorExtenso: /(?<![a-z])(?:ponto (?:com|br|net|org|app|io|me)|arroba)(?![a-z])/,
  // §3.3: a introdução da segunda via não nomeia o instrumento — quem sabe se é boleto ou PIX é o servidor
  instrumentoDePagamento: /(?<![a-z])(?:boleto|pix|qr|qrcode|codigo (?:de barras|pix)|linha digitavel|link|copia e cola|chave)(?![a-z])/,
  concessao: compilar(VOCABULARIO.concessao),
  consequencia: compilar(VOCABULARIO.consequencia),
  compromissoTransferir: compilar(VOCABULARIO.compromissoDeTransferir),
  compromissoSegundaVia: compilar(VOCABULARIO.compromissoDeSegundaVia),
  compromissoNunca: compilar(VOCABULARIO.compromissoNunca),
  prazo: compilar(VOCABULARIO.prazo),
  quitacao: compilar(VOCABULARIO.quitacao),
  gravacaoAfirmada: compilar(VOCABULARIO.gravacaoAfirmada),
  gravacaoOferecida: compilar(VOCABULARIO.gravacaoOferecida),
  financeiroEquipamentos: compilar(VOCABULARIO.financeiroEmEquipamentos),
  custoZero: new RegExp(`(?<![a-z0-9])(?:${VOCABULARIO.custoZeroDaDevolucao.join("|")})(?![a-z0-9])`, "g"),
  assuntoDeDevolucao: /(?<![a-z])(?:devol|retir|colet|busc|visita|tecnico|aparelho|equipament|roteador|modem|onu(?![a-z]))/,
  dividaNoBalao: /(?<![a-z])(?:divid|debit|fatur|mensalid|saldo|boleto|pix|multa|juros|reais|r\$)/,
  extenso: compilar(VOCABULARIO.numeroPorExtenso),
  perguntaDeValor: /(?<![a-z])(?:quanto|valor|devo(?![a-z])|devendo|debit|divid|saldo|total|r\$|preco|mensalid|fatura|boleto|pix|segunda via)/,
  preTermos: compilar(VOCABULARIO_PRE_IDENTIDADE.termos),
  preEnderecos: compilar(VOCABULARIO_PRE_IDENTIDADE.enderecos),
  preExtenso: compilar(VOCABULARIO_PRE_IDENTIDADE.numeroPorExtenso),
  // forma e contato (texto normalizado)
  // "nslink . com . br" e "nslink,com,br": separador com espaço ou vírgula só conta em domínio de dois níveis, ou com
  // espaço dos dois lados do ponto — "Tudo bem. Com certeza" e "sim, com calma" não são link
  url: /https?:|www\.|wa\.me|(?<![a-z0-9@])[a-z0-9-]+ ?[.,] ?(?:com|net|org|gov|edu) ?[.,] ?br(?![a-z0-9])|(?<![a-z0-9@])[a-z0-9-]+ \. (?:com|br|net|org|io|app)(?![a-z0-9])|(?<![a-z0-9@])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|br|net|org|io|me|app|link|ly|site|online|info|gov|edu|co|pix|pay|bio)(?![a-z0-9])|\.(?:com|br|net|org)(?![a-z0-9])/,
  email: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|@[a-z0-9_]/,
  telefone: /\(?\b[0-9]{2}\)?\s?9?[0-9]{4}[\s.-]?[0-9]{4}\b/,
  marcacao: /\{|\}|\[|\]|<[^<>\n]{0,200}>/,
} as const;

/* ───────────────────────── datas (puras, sem relógio) ───────────────────────── */

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
const DIAS_DA_SEMANA = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"] as const;
const ABREVIACOES_DA_SEMANA: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };

function isoValido(iso: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}
const emUTC = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
function somarDias(iso: string, dias: number): string {
  return new Date(emUTC(iso) + dias * 86_400_000).toISOString().slice(0, 10);
}
const diferencaEmDias = (de: string, ate: string) => Math.round((emUTC(ate) - emUTC(de)) / 86_400_000);
const diaDaSemana = (iso: string) => new Date(emUTC(iso)).getUTCDay();
const ultimoDiaDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
function horaValida(h: string): boolean {
  const m = /^([0-9]{2}):([0-9]{2})$/.exec(h);
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}
const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** Como o texto citou uma data. As relativas só podem apontar para a proposta ou o registro. */
type DataCitada =
  | { tipo: "exata"; iso: string }
  | { tipo: "dia_mes"; dia: number; mes: number }
  | { tipo: "dia"; dia: number }
  | { tipo: "deslocamento"; dias: number }
  | { tipo: "semana"; dow: number; proxima: boolean }
  | { tipo: "proxima_semana" }
  | { tipo: "proximo_mes" }
  | { tipo: "fim_do_mes" }
  | { tipo: "mes"; mes: number }
  // "venceu semana passada", "mês passado": não são relativas da proposta — só um FATO com data nesse período sustenta
  | { tipo: "semana_passada" }
  | { tipo: "mes_passado" };
const RELATIVAS: ReadonlySet<DataCitada["tipo"]> = new Set(["semana", "proxima_semana", "proximo_mes", "fim_do_mes", "mes"]);

function dataCasa(c: DataCitada, iso: string, hoje: string): boolean {
  const ano = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  const dia = Number(iso.slice(8, 10));
  const distancia = diferencaEmDias(hoje, iso);
  const hojeAno = Number(hoje.slice(0, 4));
  const hojeMes = Number(hoje.slice(5, 7));
  const mesSeguinte = hojeMes === 12 ? { ano: hojeAno + 1, mes: 1 } : { ano: hojeAno, mes: hojeMes + 1 };
  switch (c.tipo) {
    case "exata": return c.iso === iso;
    case "dia_mes": return c.dia === dia && c.mes === mes;
    case "dia": return c.dia === dia;
    case "deslocamento": return distancia === c.dias;
    // "sexta" é a próxima sexta (ou hoje); "próxima sexta" é a seguinte a hoje, até duas semanas
    case "semana": return diaDaSemana(iso) === c.dow && (c.proxima ? distancia >= 1 && distancia <= 13 : distancia >= 0 && distancia <= 7);
    case "proxima_semana": {
      const segundaDestaSemana = somarDias(hoje, -((diaDaSemana(hoje) + 6) % 7));
      const inicio = diferencaEmDias(hoje, somarDias(segundaDestaSemana, 7));
      return distancia >= inicio && distancia <= inicio + 6;
    }
    case "proximo_mes": return ano === mesSeguinte.ano && mes === mesSeguinte.mes;
    case "fim_do_mes":
      return dia >= ultimoDiaDoMes(ano, mes) - 6 && distancia >= 0 && ((ano === hojeAno && mes === hojeMes) || (ano === mesSeguinte.ano && mes === mesSeguinte.mes));
    case "mes": return c.mes === mes && distancia >= 0 && distancia <= 366;
    case "semana_passada": {
      const segundaPassada = somarDias(hoje, -((diaDaSemana(hoje) + 6) % 7) - 7);
      const inicio = diferencaEmDias(hoje, segundaPassada);
      return distancia >= inicio && distancia <= inicio + 6;
    }
    case "mes_passado": {
      const anterior = hojeMes === 1 ? { ano: hojeAno - 1, mes: 12 } : { ano: hojeAno, mes: hojeMes - 1 };
      return ano === anterior.ano && mes === anterior.mes;
    }
  }
}

/** Turno citado sem número ("sexta de manhã"): §3.3 resolve manhã = 09:00 e tarde = 14:00. */
type Turno = "manha" | "tarde" | "noite" | "madrugada";
function turnoCasa(turno: Turno, hora: string): boolean {
  const h = Number(hora.slice(0, 2));
  switch (turno) {
    case "madrugada": return h < 6;
    case "manha": return h < 12;
    case "tarde": return h >= 12 && h < 18;
    case "noite": return h >= 18;
  }
}

/* ───────────────────────── extração de números ───────────────────────── */

interface NumerosDaFrase {
  valores: number[];
  /** Cláusula de cada valor e de cada data (mesma ordem dos arrays), e a posição no texto: é o que pareia valor com data (s3). */
  lugarDosValores: { pos: number; clausula: number }[];
  lugarDasDatas: { pos: number; clausula: number }[];
  datas: DataCitada[];
  horas: string[];
  turnos: Turno[];
  parcelas: number[];
  percentuais: number[];
  inteiros: number[];
  extenso: boolean;
  milhar: boolean;
  dinheiroSemNumero: boolean;
  invalido: "data" | "hora" | "valor" | null;
}

/** "150", "150,00", "1.500,00", "150.00", "1,500.00" → centavos; formato que não se lê → null. */
function centavosDe(bruto: string): number | null {
  const s = bruto.replace(/[.,]+$/, "");
  let n: string;
  if (/^[0-9]{1,3}(\.[0-9]{3})+(,[0-9]{1,2})?$/.test(s)) n = s.replace(/\./g, "").replace(",", ".");
  else if (/^[0-9]+,[0-9]{1,2}$/.test(s)) n = s.replace(",", ".");
  else if (/^[0-9]+(\.[0-9]{1,2})?$/.test(s)) n = s;
  else if (/^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]{1,2})?$/.test(s)) n = s.replace(/,/g, "");
  else return null;
  const v = Math.round(Number(n) * 100);
  return Number.isFinite(v) ? v : null;
}

const EXTENSO_HORA: Record<string, number> = { uma: 1, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12 };
const EXTENSO_PEQUENO: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3 };
function horaDoTurno(h: number, turno: string): number {
  return (turno === "tarde" || turno === "noite") && h < 12 ? h + 12 : h;
}

/**
 * Extrai de UMA frase (normalizada, nomes já removidos) tudo que é número ou
 * data. Cada forma reconhecida é consumida, para não ser contada duas vezes:
 * o "20" de "20/09" não sobra como inteiro solto.
 */
function extrairNumeros(frase: string): NumerosDaFrase {
  const r: NumerosDaFrase = {
    valores: [], lugarDosValores: [], datas: [], lugarDasDatas: [], horas: [], turnos: [], parcelas: [], percentuais: [], inteiros: [],
    extenso: false, milhar: false, dinheiroSemNumero: false, invalido: null,
  };
  let s = ` ${frase} `;
  // o trecho consumido vira espaço do MESMO tamanho: as posições continuam valendo para parear valor com data
  let posicao = 0;
  const posValores: number[] = [];
  const posDatas: number[] = [];
  const consumir = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    s = s.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      posicao = args[args.length - 2] as number;
      fn(m);
      return " ".repeat(m[0].length);
    });
  };
  const hora = (h: number, min: number) => {
    const v = `${doisDigitos(h)}:${doisDigitos(min)}`;
    if (horaValida(v)) r.horas.push(v);
    else r.invalido ??= "hora";
  };
  const data = (c: DataCitada, valida: boolean) => {
    if (valida) {
      r.datas.push(c);
      posDatas.push(posicao);
    } else r.invalido ??= "data";
  };
  const valor = (v: number | null) => {
    if (v === null) r.invalido ??= "valor";
    else {
      r.valores.push(v);
      posValores.push(posicao);
    }
  };

  // horas escritas antes do extenso: "meio-dia" e "duas da tarde" são hora, não valor
  consumir(/(?<![a-z])meio[- ]?dia(?![a-z])/g, () => hora(12, 0));
  consumir(/(?<![a-z])meia[- ]?noite(?![a-z])/g, () => hora(0, 0));
  consumir(/(?<![a-z])(uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze) (?:horas? )?(?:da|de) (manha|tarde|noite|madrugada)(?![a-z])/g,
    m => hora(horaDoTurno(EXTENSO_HORA[m[1]], m[2]), 0));
  if (RE.extenso.test(s)) r.extenso = true;
  if (/[0-9] ?(?:mil|k)(?![a-z])/.test(s)) r.milhar = true;

  // datas com dígitos
  consumir(/(?<![0-9])([0-9]{4})-([0-9]{2})-([0-9]{2})(?:t[0-9:.+-]*z?)?(?![0-9])/g, m => {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    data({ tipo: "exata", iso }, isoValido(iso));
  });
  consumir(/(?<![0-9/])([0-9]{1,2})\/([0-9]{1,2})(?:\/([0-9]{4}|[0-9]{2}))?(?![0-9/])/g, m => {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (m[3]) {
      const iso = `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
      data({ tipo: "exata", iso }, isoValido(iso));
    } else data({ tipo: "dia_mes", dia, mes }, dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12);
  });
  consumir(new RegExp(`(?<![0-9])([0-9]{1,2})o? de (${MESES.join("|")})(?: de ([0-9]{4}))?(?![a-z0-9])`, "g"), m => {
    const dia = Number(m[1]);
    const mes = MESES.indexOf(m[2] as (typeof MESES)[number]) + 1;
    if (m[3]) {
      const iso = `${m[3]}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
      data({ tipo: "exata", iso }, isoValido(iso));
    } else data({ tipo: "dia_mes", dia, mes }, dia >= 1 && dia <= 31);
  });

  // dinheiro
  consumir(/r\$ ?([0-9][0-9.,]*)/g, m => valor(centavosDe(m[1])));
  // "99,90 reais" antes do "x,yy": senão sobra "reais" sem número
  consumir(/(?<![0-9.,])([0-9]+(?:[.,][0-9]{1,3})*) ?(?:reais|real|conto|contos|pila|pilas|pratas?)(?![a-z])/g, m => valor(centavosDe(m[1])));
  consumir(/(?<![a-z])um real(?![a-z])/g, () => valor(100));
  consumir(/(?<![0-9.,])([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+),([0-9]{2})(?![0-9])/g, m => valor(centavosDe(`${m[1]},${m[2]}`)));

  // percentual e parcelas
  consumir(/(?<![0-9.,])([0-9]+(?:,[0-9]+)?) ?(?:%|por cento(?![a-z]))/g, m => r.percentuais.push(Number(m[1].replace(",", "."))));
  consumir(/(?<![0-9.,])([0-9]{1,2}) ?(?:x|vezes|vez|parcelas?|prestac(?:ao|oes)|meses|mes|boletos?)(?![a-z0-9])/g, m => r.parcelas.push(Number(m[1])));
  consumir(/(?<![a-z])(um|uma|dois|duas|tres) (?:vezes|parcelas?|prestac(?:ao|oes)|meses|boletos)(?![a-z])/g, m => r.parcelas.push(EXTENSO_PEQUENO[m[1]]));

  // horas com dígitos
  consumir(/(?<![0-9])([0-9]{1,2}):([0-9]{2})(?![0-9])/g, m => hora(Number(m[1]), Number(m[2])));
  consumir(/(?<![0-9])([0-9]{1,2}) ?(?:h|hs|hrs?|horas?) ?([0-9]{2})?(?![a-z0-9])/g, m => hora(Number(m[1]), Number(m[2] ?? 0)));
  consumir(/(?<![0-9])([0-9]{1,2}) (?:(?:da|de) )?(manha|tarde|noite|madrugada)(?![a-z])/g, m => hora(horaDoTurno(Number(m[1]), m[2]), 0));
  // "às 9?" é hora; "as 2 faturas" não
  consumir(/(?<![a-z])(?:as|pelas|ate as|a partir das) ([0-9]{1,2})(?![0-9/:%]|[.,][0-9]| ?[a-z])/g, m => hora(Number(m[1]), 0));
  // turno sem número: com preposição ("de manhã", "à tarde", "pela noite"), colado ao dia ("sexta manhã") ou na
  // escolha ("manhã ou tarde"). "Boa tarde", "mais tarde" e o "manha" de "amanhã" não são turno.
  const turno = (t: string) => r.turnos.push(t.replace(/(?:zinha|inha)$/, "") as Turno);
  consumir(/(?<![a-z])(?:de|pela|na|a|as|pra|para|durante a|no periodo da|no turno da|parte da) (manha|tarde|noite|madrugada)(?:zinha|inha)?(?![a-z])/g, m => turno(m[1]));
  consumir(/(?<=(?<![a-z])(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|hoje)(?:[- ]feira)? )(manha|tarde|noite)(?![a-z])/g, m => turno(m[1]));
  consumir(/(?<![a-z])(manha|tarde|noite)(?= ou (?:a |de |pela )?(?:manha|tarde|noite)(?![a-z]))/g, m => turno(m[1]));
  consumir(/(?<=(?<![a-z])(?:manha|tarde|noite|[ ]{4,}) ou (?:a |de |pela )?)(manha|tarde|noite)(?![a-z])/g, m => turno(m[1]));

  // "dia primeiro" e "primeiro de outubro" são o dia 1 — sem isto, a data passava sem conferência
  consumir(new RegExp(`(?<![a-z])primeiro de (${MESES.join("|")})(?![a-z])`, "g"), m => data({ tipo: "dia_mes", dia: 1, mes: MESES.indexOf(m[1] as (typeof MESES)[number]) + 1 }, true));
  consumir(/(?<![a-z])dia primeiro(?![a-z])/g, () => data({ tipo: "dia", dia: 1 }, true));
  // "dia 20"
  consumir(/(?<![a-z])dia ([0-9]{1,2})(?![0-9/:]|[.,][0-9])/g, m => {
    const dia = Number(m[1]);
    data({ tipo: "dia", dia }, dia >= 1 && dia <= 31);
  });

  // datas por palavra
  consumir(/(?<![a-z])hoje em dia(?![a-z])/g, () => undefined);
  // o passado também é data: "venceu ontem" sem fato com essa data é data fabricada (s3)
  consumir(/(?<![a-z])(?:anteontem|antes de ontem)(?![a-z])/g, () => data({ tipo: "deslocamento", dias: -2 }, true));
  consumir(/(?<![a-z])ontem(?![a-z])/g, () => data({ tipo: "deslocamento", dias: -1 }, true));
  consumir(/(?<![a-z])(?:semana passada|semana anterior|ultima semana)(?![a-z])/g, () => data({ tipo: "semana_passada" }, true));
  consumir(/(?<![a-z])(?:mes passado|mes anterior|ultimo mes)(?![a-z])/g, () => data({ tipo: "mes_passado" }, true));
  consumir(/(?<![a-z])depois de amanha(?![a-z])/g, () => data({ tipo: "deslocamento", dias: 2 }, true));
  consumir(/(?<![a-z])amanha(?![a-z])/g, () => data({ tipo: "deslocamento", dias: 1 }, true));
  consumir(/(?<![a-z])hoje(?![a-z])/g, () => data({ tipo: "deslocamento", dias: 0 }, true));
  consumir(/(?<![a-z])(?:proxima semana|semana que vem)(?![a-z])/g, () => data({ tipo: "proxima_semana" }, true));
  consumir(/(?<![a-z])(?:proximo mes|mes que vem)(?![a-z])/g, () => data({ tipo: "proximo_mes" }, true));
  consumir(/(?<![a-z])(?:fim|final) do mes(?![a-z])/g, () => data({ tipo: "fim_do_mes" }, true));
  // "segunda via", "quarta tentativa" e "quinta vez" não são dia da semana
  consumir(/(?<![a-z])(proxim[ao] )?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[- ]feira)?(?! (?:via|vez|parcela|opcao|tentativa|mensagem|fatura|chance|conta|etapa|semana|pessoa|feira)(?![a-z]))(?![a-z-])/g,
    m => data({ tipo: "semana", dow: DIAS_DA_SEMANA.indexOf(m[2] as (typeof DIAS_DA_SEMANA)[number]), proxima: !!m[1] }, true));
  // abreviações ("pode ser na sex?"). "ter" só depois de "na/nessa/próxima": "vai ter" e "pra ter" são o verbo
  consumir(/(?<![a-z])(proxim[ao] )?(seg|qua|qui|sex|sab|dom)(?![a-z])\.?/g, m => data({ tipo: "semana", dow: ABREVIACOES_DA_SEMANA[m[2]], proxima: !!m[1] }, true));
  consumir(/(?<![a-z])(?:(?:na|nessa) (proxima )?|(proxima) )ter(?![a-z])\.?/g, m => data({ tipo: "semana", dow: 2, proxima: !!(m[1] || m[2]) }, true));
  // "marco" sozinho é verbo ("marco pra quinta"); mês só com preposição
  consumir(/(?<![a-z])(?:(?:de|em|ate|pra|para|no inicio de|no fim de) marco|janeiro|fevereiro|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?![a-z])/g,
    m => data({ tipo: "mes", mes: MESES.indexOf((/marco$/.test(m[0]) ? "marco" : m[0]) as (typeof MESES)[number]) + 1 }, true));

  if (/r\$|(?<![a-z])(?:reais|centavos)(?![a-z])/.test(s)) r.dinheiroSemNumero = true;
  for (const m of s.matchAll(/[0-9]+/g)) r.inteiros.push(Number(m[0]));
  // cláusulas no texto JÁ consumido: a vírgula de "R$ 1.500,00" e a barra de "10/09" viraram espaço
  const cortes = [...s.matchAll(SEPARADOR_DE_CLAUSULA)].map(m => m.index ?? 0);
  const lugar = (pos: number) => ({ pos, clausula: cortes.filter(c => c < pos).length });
  r.lugarDosValores = posValores.map(lugar);
  r.lugarDasDatas = posDatas.map(lugar);
  return r;
}

/** Frases: fecha em ! ? ; quebra de linha, e em ponto seguido de espaço ("R$ 1.500,00" não quebra). */
function frasesDe(texto: string): string[] {
  return texto.split(/(?<=[!?;\n])|(?<=\.)(?=\s)/).map(f => f.trim()).filter(Boolean);
}
const ehPergunta = (frase: string) => /[?]\s*["')]*\s*$/.test(frase);

/* ───────────────────────── nomes ───────────────────────── */

// Um nome que já é vocabulário de regra ("Pix Telecom", cliente "Graça", provedor
// "Logo Net") não é removido: sumir com ele esconderia exatamente a palavra que a
// regra procura ("dá pra fazer de graça"). Só entra aqui palavra cuja presença
// RECUSA; "sistema", "digital" e "virtual" ficam de fora de propósito, porque
// mantê-las confirmaria a automação com o nome do provedor.
// Radical para o vocabulário de dívida (nenhum nome comum começa assim); palavra INTEIRA
// para o resto, senão "Marco", "Cortez" e "Liberato" nunca sairiam e toda mensagem com
// eles cairia na reserva.
const NOME_COM_ASSUNTO_RESTRITO = new RegExp(
  "(?<![a-z])(?:cobranc|divid|debit|fatur|boleto|pix|pagament|valor|reais|saldo|pendenc|atras|vencid|negativ|spc|serasa|multa|juros|descont|acordo|quit|robo|humano|pessoa)" +
    "|(?<![a-z])(?:graca|gratis|gratuito|gratuita|metade|logo|breve|rapido|rapida|rapidinho|instante|imediato|livre|liberado|liberada|garantia|garantido|" +
    "corte|cortado|suspenso|bloqueio|bloqueado|religa|perdao|isento|zero|zerado|cancelado|estorno|liquidado|tranquilo|tranquila|sossego|certo|certinho|" +
    "gente|atendente|real|plantao|senha|foto|documento|cartao|processo|justica|advogado|policia|restricao|custo|preco|caro|pago|paga|anotado|registrado|" +
    "agendado|marcado|fechado|combinado|confirmado|agora|ja)(?![a-z])",
);

function removerLiterais(texto: string, literais: readonly (string | null | undefined)[]): string {
  const lista = literais
    .map(l => normalizarParaVerificacao(l ?? "").replace(/\n/g, " "))
    .filter(l => l.length >= 2 && /[a-z0-9]/.test(l) && !NOME_COM_ASSUNTO_RESTRITO.test(l))
    .sort((a, b) => b.length - a.length);
  let t = texto;
  for (const l of lista) t = t.replace(new RegExp(`(?<![a-z0-9])${escapar(l)}(?![a-z0-9])`, "g"), " ");
  return t.replace(/[^\S\n]+/g, " ");
}
// cada nome também na forma com a sigla por extenso: o provedor "IA Net" chega ao texto como "inteligencia artificial net"
const comVarianteDaSigla = (nomes: readonly (string | null | undefined)[]) => nomes.flatMap(n => (n ? [n, comSiglaPorExtenso(n)] : []));
const nomesDoContexto = (n: NomesDaVerificacao) => comVarianteDaSigla([n.persona, n.provedor, n.primeiroNomeCliente]);

/* ───────────────────────── verificador pós-identidade ───────────────────────── */

const recusa = (motivo: CodigoRecusa): { ok: false; motivo: CodigoRecusa } => ({ ok: false, motivo });

/**
 * Objeto sensível que a frase não nega (polaridade invertida, §6.6). Frase a frase: cada objeto herda a
 * negação do anterior quando só uma continuação de lista os separa ("nunca pede senha, foto ou o CPF"); fora
 * disso, precisa da própria negação logo antes ("não precisa mandar a senha"). Adversativa quebra a herança.
 */
function pediuDadoSensivel(texto: string): boolean {
  for (const frase of frasesDe(texto)) {
    // "Não pode me mandar a senha?" e "não vai me passar o RG?" pedem: numa pergunta de verdade (não a tag "tá?"),
    // o "não" deixa de liberar; "nunca", "jamais", "nem" e "sem" continuam negando
    const perguntaDeVerdade = ehPergunta(frase) && !PERGUNTA_TAG.test(frase);
    const negacao = perguntaDeVerdade ? RE.objetoNegadoSemNao : RE.objetoNegado;
    let fimDoAnterior = -1;
    for (const m of frase.matchAll(RE.objetoSensivel)) {
      const inicio = m.index ?? 0;
      const antes = frase.slice(0, inicio);
      // "me confirma os 4 últimos dígitos do seu CPF" é o desafio, não o CPF inteiro — e não empresta negação ao seguinte
      if (m[0] === "cpf" && RE.desafioDoCpf.test(antes)) {
        fimDoAnterior = -1;
        continue;
      }
      const herdou = fimDoAnterior >= 0 && RE.continuacaoDaLista.test(frase.slice(fimDoAnterior, inicio));
      if (!herdou && !negacao.test(antes)) return true;
      fimDoAnterior = inicio + m[0].length;
    }
  }
  return false;
}

const REGISTRO_DA_SITUACAO: Partial<Record<SituacaoDaRodada, GravadoVerificavel["tipo"]>> = {
  promessa_registrada: "promessa",
  agendamento_registrado: "agendamento",
  acordo_registrado: "acordo",
};

function contextoValido(ctx: ContextoDaVerificacao): boolean {
  if (!ctx || typeof ctx !== "object") return false;
  if (typeof ctx.hoje !== "string" || !isoValido(ctx.hoje)) return false;
  if (!(ACOES_DA_RODADA as readonly string[]).includes(ctx.acao)) return false;
  if (ctx.situacao !== undefined && !(SITUACOES_DA_RODADA as readonly string[]).includes(ctx.situacao)) return false;
  if (!["ativo", "ex_cliente", "equipamentos"].includes(ctx.carteira)) return false;
  if (!ctx.nomes || typeof ctx.nomes.persona !== "string" || typeof ctx.nomes.provedor !== "string") return false;
  const pontual = (p: PropostaVerificavel | null | undefined) =>
    p == null || (typeof p.data === "string" && isoValido(p.data) && (p.hora === undefined || horaValida(p.hora)) && (p.valorCentavos === undefined || (Number.isInteger(p.valorCentavos) && p.valorCentavos > 0)));
  if (!pontual(ctx.proposta) || !pontual(ctx.gravado)) return false;
  const esperado = ctx.situacao ? REGISTRO_DA_SITUACAO[ctx.situacao] : undefined;
  // afirmação de gravação sem o registro correspondente é o erro que esta função existe para barrar
  if (esperado && ctx.gravado?.tipo !== esperado) return false;
  return true;
}

type Modo = "registrada" | "proposta" | "livre";
interface ItemCitado { pos: number; clausula: number; ids: Set<string> }

const temIdEmComum = (a: Set<string>, b: Set<string>) => [...a].some(id => b.has(id));

/**
 * Valor e data na mesma frase vêm do MESMO fato (§6.13, s3). Primeiro no conjunto da frase ("3 boletos de
 * R$ 50,00, o primeiro em 10/09?" não tem fato com os dois). Depois dentro de cada cláusula, na ordem do texto:
 * com tantos valores quanto datas, o 1º valor vai com a 1ª data ("R$ 99,90 venceu 10/08 e R$ 120,50 vence
 * 10/10"); com contagens diferentes, cada um precisa de par na cláusula. O conjunto sozinho aceitava a troca
 * entre duas faturas: "a de R$ 120,50 venceu 10/09 e a de R$ 99,90 vence 10/10".
 */
function valorEDataDoMesmoFato(valores: ItemCitado[], datas: ItemCitado[]): boolean {
  if (!valores.length || !datas.length) return true;
  const idsDasDatas = new Set(datas.flatMap(d => [...d.ids]));
  const idsDosValores = new Set(valores.flatMap(v => [...v.ids]));
  if (valores.some(v => !temIdEmComum(v.ids, idsDasDatas)) || datas.some(d => !temIdEmComum(d.ids, idsDosValores))) return false;
  const porPosicao = (a: ItemCitado, b: ItemCitado) => a.pos - b.pos;
  for (const clausula of new Set(valores.map(v => v.clausula))) {
    const vs = valores.filter(v => v.clausula === clausula).sort(porPosicao);
    const ds = datas.filter(d => d.clausula === clausula).sort(porPosicao);
    if (!ds.length) continue;
    if (vs.length === ds.length) {
      if (vs.some((v, i) => !temIdEmComum(v.ids, ds[i].ids))) return false;
    } else if (vs.some(v => !ds.some(d => temIdEmComum(v.ids, d.ids))) || ds.some(d => !vs.some(v => temIdEmComum(v.ids, d.ids)))) {
      return false;
    }
  }
  return true;
}
interface Grupo { id: string; valores: Set<number>; datas: string[]; aceitaRelativa: boolean }

/** Quais fatos esta rodada pode citar. Registrada: só o gravado; pergunta de proposta: só a proposta. */
function gruposDaRodada(ctx: ContextoDaVerificacao, modo: Modo): { grupos: Grupo[]; horas: Set<string> } {
  const grupos = new Map<string, Grupo>();
  const grupo = (id: string, aceitaRelativa = false) => {
    if (!grupos.has(id)) grupos.set(id, { id, valores: new Set(), datas: [], aceitaRelativa });
    return grupos.get(id)!;
  };
  const horas = new Set<string>();
  const pontual = (id: string, p: PropostaVerificavel) => {
    const g = grupo(id, true);
    g.datas.push(p.data);
    if (p.valorCentavos !== undefined) g.valores.add(p.valorCentavos);
    if (p.hora) horas.add(p.hora);
  };
  if (modo === "registrada") {
    if (ctx.gravado) pontual("gravado", ctx.gravado);
  } else if (modo === "proposta") {
    if (ctx.proposta) pontual("proposta", ctx.proposta);
  } else {
    for (const v of ctx.fatos?.valores ?? []) if (Number.isInteger(v?.centavos) && v.centavos > 0) grupo(`fato:${v.id}`).valores.add(v.centavos);
    for (const d of ctx.fatos?.datas ?? []) if (typeof d?.data === "string" && isoValido(d.data)) grupo(`fato:${d.id}`).datas.push(d.data);
    for (const h of ctx.fatos?.horas ?? []) if (horaValida(h)) horas.add(h);
    (ctx.ofertas ?? []).forEach((o, i) => {
      const g = grupo(`oferta:${i}`);
      for (const v of o.valoresCentavos ?? []) if (Number.isInteger(v) && v > 0) g.valores.add(v);
      for (const d of o.datas ?? []) if (isoValido(d)) g.datas.push(d);
    });
    if (ctx.proposta) pontual("proposta", ctx.proposta);
    if (ctx.gravado) pontual("gravado", ctx.gravado);
  }
  return { grupos: [...grupos.values()], horas };
}

// balão só de emoji ("😊") não some da conferência: sem letra nem dígito, a chave é o próprio balão
const chaveDeRepeticao = (texto: string) => normalizarParaVerificacao(texto).replace(/[^a-z0-9]+/g, " ").trim() || texto.replace(/\s+/g, "");
const dividirEmBaloes = (texto: string) => texto.split(/\n[^\S\n]*\n\s*/).map(b => b.trim());
const OFERTA_CONDICIONAL = /(?<![a-z])(?:se (?:preferir|quiser)|caso (?:prefira|queira))(?![a-z])/;
// "tá anotado pra sexta, beleza?" afirma com cara de pergunta, como a 1ª pessoa do passado
const GRAVACAO_EM_PRIMEIRA_PESSOA =
  /(?<![a-z])(?:anotei|registrei|agendei|marquei|lancei|salvei|guardei|coloquei|deixei (?:anotad|registrad|agendad|marcad|salv|guardad)|(?:ta|esta|ja esta|ja ta|ficou|foi) (?:tudo )?(?:anotad|registrad|agendad|marcad|lancad|salv|guardad))/;
const TAG_DE_CONCORDANCIA = /(?<![a-z])(?:combinad[oa]|fechad[oa])(?![a-z])/g;
const PARCELAS_POR_EXTENSO = /(?<![a-z])(?:um|uma|dois|duas|tres) (?:vezes|parcelas?|prestac|meses|boletos)/;
// "hoje/amanhã" sem fato com essa data só passa quando a frase PEDE uma ação ao cliente ("consegue resolver hoje?").
// Pergunta-tag ("amanhã aumenta, sabia?") e agravamento ("hoje é o último dia") fabricam urgência: a do
// Provedor.ai é factual, e o fato sem data não sustenta.
const PEDIDO_DE_ACAO = /(?<![a-z])(?:consegue|conseguiria|consegui|pode|podemos|poderia|da pra|daria pra|quer|queria|topa|prefere|fica bom|seria possivel|bora|vamos|rola)(?![a-z])/;
const PERGUNTA_TAG = /(?<![a-z])(?:sabia|ne|ta|viu|certo|ok|beleza|entendeu|tudo bem|combinado|blz|sacou)\s*[?]\s*["')]*\s*$/;
const AGRAVAMENTO = /(?<![a-z])(?:venc|prazo|valid|expir|limite|aument|ultim|soma|acumul|piora|encerr|perde|juros|multa|urgent|corre)/;
// Com a pergunta do cliente sobre quem atende, nenhum balão abre negando — nem depois de "kkk", "imagina" ou "oi".
// "não sou uma pessoa" nega ser GENTE: é a confirmação da D1, não a negação da automação.
const INICIO_NEGANDO =
  /^[^a-z]*(?:(?:k{2,}|(?:ha){2,}h?|(?:he){2,}|(?:hi){2,}|rs+|eita|opa|oi|ola|poxa|puxa|ah+|oh+|hum+|hm+|nossa|ue|ixi|olha|entao|bom|ei|eu|ai|oxe|vixe)(?![a-z])[^a-z]*){0,3}(?:claro que nao|que nada|de jeito nenhum|nao|imagina|negativo|jamais|nunca|nem)(?![a-z])/;
const NEGA_SER_GENTE = /^ (?:sou|e|eh|somos|to|estou)(?: (?:uma|um|a|o))? (?:pessoa|humana|humano|gente|atendente)(?![a-z])/;
const SEPARADOR_DE_CLAUSULA = /[,;:]| - | e (?=(?:a|o|as|os|um|uma|tambem|mais|depois)(?![a-z]))| mas | ou | porem /g;

/**
 * §6 inteiro. Devolve os balões (já divididos por linha em branco dupla) ou o
 * primeiro motivo de recusa, na ordem das regras.
 */
export function verificarMensagens(mensagens: readonly string[], ctx: ContextoDaVerificacao): ResultadoDaVerificacao {
  if (!contextoValido(ctx)) return recusa("contexto_invalido");
  if (ctx.fase !== "pos_identidade") return recusa("fase_invalida");
  if (!Array.isArray(mensagens)) return recusa("quantidade_de_baloes");

  // 1. forma
  const baloes: string[] = [];
  for (const m of mensagens) {
    if (typeof m !== "string") return recusa("tamanho_do_balao");
    baloes.push(...dividirEmBaloes(m));
  }
  if (baloes.length < 1 || baloes.length > LIMITES_DAS_MENSAGENS.baloes) return recusa("quantidade_de_baloes");
  let total = 0;
  for (const b of baloes) {
    if (b.length < 1 || b.length > LIMITES_DAS_MENSAGENS.caracteresPorBalao) return recusa("tamanho_do_balao");
    total += b.length;
  }
  if (total > LIMITES_DAS_MENSAGENS.caracteresNoTotal) return recusa("tamanho_total");
  for (const b of baloes) {
    if (/^\s*(?:[-*•+]\s|[0-9]{1,2}[.)]\s|#{1,6}\s|>\s)/m.test(b) || /```|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\|[^|\n]*\|/.test(b)) return recusa("markdown");
    if (ESCRITA_ESTRANHA.test(b.normalize("NFKC")) || LETRA_FORA_DO_ALFABETO.test(normalizarParaVerificacao(b))) return recusa("caractere_invalido");
  }

  // 15. repetição (antes de tudo o mais: é barata e independe do conteúdo)
  const jaEnviados = new Set((ctx.baloesJaEnviados ?? []).flatMap(t => (typeof t === "string" ? dividirEmBaloes(t) : [])).map(chaveDeRepeticao).filter(Boolean));
  for (const b of baloes) {
    const chave = chaveDeRepeticao(b);
    if (!chave) continue;
    if (jaEnviados.has(chave)) return recusa("repeticao");
    jaEnviados.add(chave);
  }

  const registrada = !!(ctx.situacao && REGISTRO_DA_SITUACAO[ctx.situacao]);
  const modo: Modo = registrada ? "registrada" : (ctx.acao === "promessa" || ctx.acao === "agendar") && ctx.proposta ? "proposta" : "livre";
  const { grupos, horas } = gruposDaRodada(ctx, modo);
  const ofertas = ctx.ofertas ?? [];
  // os nossos nomes saem da fala do cliente também: "é da IA Net?" pergunta do provedor, não de quem atende
  const clienteNormalizado = removerLiterais(normalizarComSigla(ctx.ultimaMensagemDoCliente ?? ""), nomesDoContexto(ctx.nomes));
  const clientePerguntouValor = RE.perguntaDeValor.test(clienteNormalizado);
  const gruposCitadosPorData = new Set<string>();
  let citouGravacao = false;

  for (const balao of baloes) {
    const normalizado = normalizarComSigla(balao);
    let texto = removerLiterais(normalizado, nomesDoContexto(ctx.nomes));

    // 2. link, contato, marcação e rótulo (contato também antes de tirar os nomes: "@nslink" sem o nome vira "@")
    if ([normalizado, texto].some(t => RE.url.test(t) || RE.email.test(t) || RE.telefone.test(t) || RE.linkPorExtenso.test(t))) return recusa("link_ou_contato");
    // data ISO tem 8 dígitos e não é documento nem telefone
    if (/(?:[0-9][.-]?){8,}/.test(texto.replace(/(?<![0-9])[0-9]{4}-[0-9]{2}-[0-9]{2}(?![0-9])/g, " "))) return recusa("sequencia_de_digitos");
    if (RE.marcacao.test(texto)) return recusa("marcacao_de_modelo");
    if (RE.rotulos.test(texto)) return recusa("rotulo_interno");
    // 3. meta-talk
    if (RE.meta.test(texto)) return recusa("meta_talk");
    if (RE.apresentacao.test(texto)) return recusa("apresentacao_robotica");
    // 4. presença humana e negação da automação
    if (RE.presenca.test(texto)) return recusa("presenca_humana");
    if (RE.negacao.test(texto)) return recusa("negou_automacao");
    // 5. ameaça
    if (RE.ameaca.test(texto)) return recusa("ameaca");
    // 6. pedido de dado sensível (só a negação do próprio verbo libera: "a gente nunca pede senha")
    if (pediuDadoSensivel(texto)) return recusa("pedido_de_dado_sensivel");
    // 14. equipamentos: nenhum termo financeiro; o custo zero da devolução é fato, não concessão (f11)
    if (ctx.carteira === "equipamentos") {
      if (RE.assuntoDeDevolucao.test(texto) && !RE.dividaNoBalao.test(texto)) texto = texto.replace(RE.custoZero, " ").replace(/[^\S\n]+/g, " ");
      if (RE.financeiroEquipamentos.test(texto)) return recusa("termo_financeiro_em_equipamentos");
    }
    // 7. concessão: só na introdução das ofertas do servidor, e sem número
    if (RE.concessao.test(texto)) {
      const introducaoDasOfertas = ctx.situacao === "apresentar_ofertas" && ofertas.length > 0 && !/[0-9]/.test(texto) && !RE.extenso.test(texto) && !PARCELAS_POR_EXTENSO.test(texto);
      if (!introducaoDasOfertas) return recusa("concessao");
    }
    // 8–11. consequência, prazo, quitação
    if (RE.consequencia.test(texto)) return recusa("consequencia_ou_garantia");
    if (RE.prazo.test(texto)) return recusa("prazo_ou_imediatez");
    if (RE.quitacao.test(texto)) return recusa("quitacao_ou_devolucao");
    // 9. compromisso só com a ação da rodada
    if (RE.compromissoNunca.test(texto)) return recusa("compromisso_sem_acao");
    // "se preferir, um colega da nossa equipe continua com você" oferece (D1); não promete
    if (ctx.acao !== "transferir" && frasesDe(texto).some(f => RE.compromissoTransferir.test(f) && !OFERTA_CONDICIONAL.test(f))) return recusa("compromisso_sem_acao");
    if (RE.compromissoSegundaVia.test(texto) && ctx.acao !== "segunda_via") return recusa("compromisso_sem_acao");
    // §3.3: a introdução da segunda via vai sem número e sem nomear o instrumento — o valor e o tipo (boleto ou PIX)
    // saem do balão do SERVIDOR, que leu a fatura; a IA citaria a de 99,90 errada entre duas iguais
    if (ctx.acao === "segunda_via" && (/[0-9]/.test(texto) || RE.extenso.test(texto) || RE.instrumentoDePagamento.test(texto) || /(?<![a-z])(?:r\$|reais|centavos)/.test(texto))) {
      return recusa("segunda_via_com_detalhe");
    }

    for (const frase of frasesDe(texto)) {
      const numeros = extrairNumeros(frase);

      // 12. gravação
      const semAgradecimento = frase.replace(/(?<![a-z])fechad[oa][,.! ]+(?=obrigad)/g, " ");
      const afirmada = RE.gravacaoAfirmada.test(semAgradecimento);
      const oferecida = RE.gravacaoOferecida.test(semAgradecimento);
      if (afirmada || oferecida) {
        const temNumero = numeros.valores.length + numeros.datas.length + numeros.horas.length > 0 || /[0-9]/.test(frase);
        if (modo === "registrada") citouGravacao = true;
        else if (!ehPergunta(frase) || GRAVACAO_EM_PRIMEIRA_PESSOA.test(semAgradecimento)) return recusa("gravacao_sem_registro");
        // pergunta: "posso anotar?" sempre; "combinado?" sem número; "fica pra sexta, dia 18?" só confirmando a proposta.
        // "marquei a retirada, tá?" e "ficou agendado?" afirmam com cara de pergunta: fora da proposta, só a tag passa.
        else if (afirmada && modo !== "proposta" && (temNumero || RE.gravacaoAfirmada.test(semAgradecimento.replace(TAG_DE_CONCORDANCIA, " ")))) {
          return recusa("gravacao_sem_registro");
        }
      }

      // 13. números
      if (numeros.milhar) return recusa("milhar");
      if (numeros.extenso) return recusa("numero_por_extenso");
      if (numeros.invalido === "valor") return recusa("valor_fora_dos_fatos");
      if (numeros.invalido === "data") return recusa("data_fora_dos_fatos");
      if (numeros.invalido === "hora") return recusa("hora_fora_da_proposta");
      if (numeros.dinheiroSemNumero) return recusa("dinheiro_sem_numero");
      if (ctx.situacao === "identidade_recem_confirmada" && numeros.valores.length > 0 && !clientePerguntouValor) return recusa("valor_no_turno_da_identidade");

      // §3.3: nem data por palavra ("a segunda via de sexta") na introdução da segunda via
      if (ctx.acao === "segunda_via" && numeros.valores.length + numeros.datas.length + numeros.horas.length + numeros.parcelas.length + numeros.percentuais.length > 0) {
        return recusa("segunda_via_com_detalhe");
      }

      const valoresCitados: ItemCitado[] = [];
      for (const [i, v] of numeros.valores.entries()) {
        const ids = new Set(grupos.filter(g => g.valores.has(v)).map(g => g.id));
        if (!ids.size) return recusa("valor_fora_dos_fatos");
        valoresCitados.push({ ...numeros.lugarDosValores[i], ids });
      }
      const datasCitadas: ItemCitado[] = [];
      for (const [i, c] of numeros.datas.entries()) {
        const relativa = RELATIVAS.has(c.tipo);
        const ids = new Set(grupos.filter(g => (!relativa || g.aceitaRelativa) && g.datas.some(d => dataCasa(c, d, ctx.hoje))).map(g => g.id));
        if (!ids.size) {
          // "consegue resolver hoje?" pede; "vence hoje", "amanhã aumenta, sabia?" e "hoje é o último dia" afirmam —
          // a afirmação precisa de um fato com essa data
          const pedidoSemFato = c.tipo === "deslocamento" && c.dias >= 0 && modo === "livre" && ehPergunta(frase)
            && PEDIDO_DE_ACAO.test(frase) && !PERGUNTA_TAG.test(frase) && !AGRAVAMENTO.test(frase);
          if (pedidoSemFato) continue;
          return recusa(relativa ? "data_relativa_divergente" : "data_fora_dos_fatos");
        }
        ids.forEach(id => gruposCitadosPorData.add(id));
        datasCitadas.push({ ...numeros.lugarDasDatas[i], ids });
      }
      for (const h of numeros.horas) if (!horas.has(h)) return recusa("hora_fora_da_proposta");
      // turno sem número: na proposta e no registro tem que caber na hora deles (sem hora, não há turno a citar);
      // na conversa livre só é conferido contra as horas dos fatos, quando há ("manhã ou tarde?" pergunta)
      for (const t of numeros.turnos) {
        const cabe = [...horas].some(h => turnoCasa(t, h));
        if (!cabe && (modo !== "livre" || horas.size > 0)) return recusa("hora_fora_da_proposta");
      }
      for (const n of numeros.parcelas) if (!ofertas.some(o => o.parcelas === n)) return recusa("parcelas_fora_das_ofertas");
      for (const p of numeros.percentuais) if (!ofertas.some(o => o.percentual === p)) return recusa("percentual_fora_das_ofertas");
      // valor e data na mesma frase vêm do MESMO fato (s3): no conjunto da frase e, par a par, dentro de cada cláusula
      if (!valorEDataDoMesmoFato(valoresCitados, datasCitadas)) return recusa("valor_e_data_de_fatos_diferentes");
      if (numeros.inteiros.some(n => n < 1 || n > 3)) return recusa("inteiro_nao_permitido");
    }
  }

  // 4. pergunta sobre quem atende: confirma a automação e não começa negando
  if (RE.perguntaAtendimento.test(clienteNormalizado)) {
    for (const b of baloes) {
      const inicio = removerLiterais(normalizarComSigla(b), nomesDoContexto(ctx.nomes));
      const negando = INICIO_NEGANDO.exec(inicio);
      if (negando && !(/(?:nao|nem)$/.test(negando[0]) && NEGA_SER_GENTE.test(inicio.slice(negando[0].length)))) return recusa("negou_automacao");
    }
    const confirmou = baloes.some(b => RE.confirmacao.test(removerLiterais(normalizarComSigla(b), nomesDoContexto(ctx.nomes))));
    if (!confirmou) return recusa("faltou_confirmar_automacao");
  }
  // pergunta de confirmação da proposta: cita a data e termina perguntando
  if (modo === "proposta") {
    if (!gruposCitadosPorData.has("proposta")) return recusa("proposta_sem_data");
    if (!ehPergunta(baloes[baloes.length - 1])) return recusa("proposta_sem_pergunta");
  }
  // afirmação de gravação cita exatamente a data gravada
  if (citouGravacao && !gruposCitadosPorData.has("gravado")) return recusa("gravacao_divergente");

  return { ok: true, mensagens: baloes };
}

/* ───────────────────────── verificador pré-identidade ───────────────────────── */

export interface NomesDaPreIdentidade extends NomesDaVerificacao {
  /** Nome como está no cadastro: nenhum pedaço além do primeiro pode aparecer (s1). */
  nomeCompletoCliente?: string | null;
  /** Rua, bairro, cidade do cadastro: nenhum pode aparecer. */
  endereco?: readonly string[];
  /** Site ou telefone do CADASTRO do provedor (dúvida de golpe, §3.2 item 8): removidos antes das checagens, como os nomes. */
  canaisOficiais?: readonly string[];
}
export type ResultadoDaPreIdentidade = { ok: true } | { ok: false; motivo: CodigoRecusa };

const CONECTIVOS_DE_NOME = new Set(["da", "de", "do", "das", "dos", "di", "du", "del", "van", "von", "e"]);
const SIMBOLO_FORA_DA_LISTA = /[^a-z0-9\s.,!?;:()'"\-😊]/u;

/**
 * Lista FECHADA para as frases do SERVIDOR antes da identidade (§3.2 e §7): a
 * pessoa do outro lado pode não ser o titular, então nada pode dizer que há
 * cobrança, contrato ou equipamento, nem dar dígito, sobrenome ou endereço.
 * O modelo não escreve nesta fase (D5); esta função é a trava de teste das
 * frases em `chat-funcionaria-textos.ts` e a conferência em tempo de envio.
 */
export function verificarTextoPreIdentidade(texto: string, opcoes: { nomes: NomesDaPreIdentidade; desafio: boolean }): ResultadoDaPreIdentidade {
  if (typeof texto !== "string" || !opcoes?.nomes || typeof opcoes.nomes.persona !== "string" || typeof opcoes.nomes.provedor !== "string") {
    return recusa("contexto_invalido");
  }
  const bruto = texto.trim();
  if (!bruto || bruto.length > LIMITES_DAS_MENSAGENS.caracteresPorBalao) return recusa("tamanho_do_balao");
  if (ESCRITA_ESTRANHA.test(bruto.normalize("NFKC")) || LETRA_FORA_DO_ALFABETO.test(normalizarParaVerificacao(bruto))) return recusa("caractere_invalido");
  if (/^\s*(?:[-*•+]\s|[0-9]{1,2}[.)]\s|#{1,6}\s|>\s)/m.test(bruto) || /```|\*\*|__|`/.test(bruto)) return recusa("markdown");

  const { nomes, desafio } = opcoes;
  let t = normalizarComSigla(bruto);
  t = removerLiterais(t, nomes.canaisOficiais ?? []);
  t = removerLiterais(t, comVarianteDaSigla([nomes.persona, nomes.provedor]));

  const completo = normalizarParaVerificacao(nomes.nomeCompletoCliente ?? "");
  const primeiro = normalizarParaVerificacao(nomes.primeiroNomeCliente ?? "") || completo.split(/[^a-z]+/).find(Boolean) || "";
  const sobrenomes = completo.split(/[^a-z]+/).filter(p => p.length >= 2 && p !== primeiro && !CONECTIVOS_DE_NOME.has(p));
  if (sobrenomes.some(p => new RegExp(`(?<![a-z])${escapar(p)}(?![a-z])`).test(t))) return recusa("nome_pre_identidade");
  const pedacosDoEndereco = (nomes.endereco ?? []).flatMap(e => {
    const n = normalizarParaVerificacao(e ?? "").replace(/\n/g, " ");
    return [n, ...n.split(/[^a-z0-9]+/).filter(p => p.length >= 4 && !CONECTIVOS_DE_NOME.has(p))];
  }).filter(p => p.length >= 2);
  if (pedacosDoEndereco.some(p => new RegExp(`(?<![a-z0-9])${escapar(p)}(?![a-z0-9])`).test(t))) return recusa("endereco_pre_identidade");
  if (primeiro) t = removerLiterais(t, [primeiro]);

  if (RE.url.test(t) || RE.email.test(t) || RE.telefone.test(t) || RE.linkPorExtenso.test(t)) return recusa("link_ou_contato");
  if (RE.marcacao.test(t)) return recusa("marcacao_de_modelo");
  if (RE.rotulos.test(t)) return recusa("rotulo_interno");
  if (RE.meta.test(t)) return recusa("meta_talk");
  if (RE.apresentacao.test(t)) return recusa("apresentacao_robotica");
  if (RE.presenca.test(t)) return recusa("presenca_humana");
  if (RE.negacao.test(t)) return recusa("negou_automacao");
  if (pediuDadoSensivel(t)) return recusa("pedido_de_dado_sensivel");
  if (RE.prazo.test(t)) return recusa("prazo_ou_imediatez");
  // o único dígito é o "4" dos últimos dígitos do CPF, e só na frase do desafio
  for (const m of t.matchAll(/[0-9]+/g)) if (!(desafio && m[0] === "4")) return recusa("digito_pre_identidade");
  if (RE.preExtenso.test(t) || (!desafio && /(?<![a-z])quatro(?![a-z])/.test(t))) return recusa("numero_por_extenso");
  if (SIMBOLO_FORA_DA_LISTA.test(t)) return recusa("emoji_ou_simbolo_pre_identidade");
  if (RE.preTermos.test(t) || RE.ameaca.test(t)) return recusa("termo_pre_identidade");
  if (RE.preEnderecos.test(t)) return recusa("endereco_pre_identidade");
  return { ok: true };
}
