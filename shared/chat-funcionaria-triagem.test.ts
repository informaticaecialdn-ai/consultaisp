import { describe, expect, it } from "vitest";
import {
  classificarEncerramento, classificarMensagemPreIdentidade, classificarTransferencia, decidirPreIdentidade,
  detectarPagamentoInformado, extrairDatasEHoras, resolverDatasDaMensagem, tipoDaMensagem, tokensDeDigitos, CATEGORIAS_PRE_IDENTIDADE,
} from "./chat-funcionaria-triagem";
import { SITUACOES_PRE_IDENTIDADE, reservaPosIdentidade, textoPreIdentidade, type BaloesDoServidor, type SementeDoTexto } from "./chat-funcionaria-textos";

// 17/09/2026 é uma quinta-feira
const HOJE = "2026-09-17";
const pre = (texto: string, tipo = "TEXT") => classificarMensagemPreIdentidade({ tipo, texto }).categoria;

describe("datas e horas que o cliente disse (Brasília, até 90 dias)", () => {
  it.each([
    ["pago dia 20", ["2026-09-20"]],
    ["pago dia 20/09", ["2026-09-20"]],
    ["posso pagar 5/10/2026", ["2026-10-05"]],
    ["dia 10", ["2026-10-10"]], // o dia 10 deste mês já passou: próxima ocorrência
    ["dia 17", ["2026-09-17"]],
    ["20 de outubro", ["2026-10-20"]],
    ["pago amanhã", ["2026-09-18"]],
    ["depois de amanhã", ["2026-09-19"]],
    ["hoje mesmo", ["2026-09-17"]],
    ["fechado, sexta então", ["2026-09-18"]],
    ["pode ser segunda", ["2026-09-21"]],
    ["quinta", ["2026-09-17", "2026-09-24"]], // hoje é quinta: vale hoje e a da semana que vem
    ["sexta que vem", ["2026-09-18", "2026-09-25"]],
    ["2026-09-30", ["2026-09-30"]],
    // correção 2: o mês seguinte dito depois de "dia N"
    ["dia 20 do mês que vem", ["2026-10-20"]],
    ["pago dia 20 do próximo mês", ["2026-10-20"]],
    ["dia 5 do mês seguinte", ["2026-10-05"]],
  ])("%s", (texto, datas) => expect(resolverDatasDaMensagem(texto, HOJE).datas).toEqual(datas));

  it.each([
    "manda a segunda via", "a quinta parcela", "paguei sexta passada", "dia 10/09", "31/09", "01/01/2026", "dia 32", "R$ 3.10",
    "20/12/2026", // além de 90 dias
    "dia 5 do mês passado",
  ])("não vira data: %s", texto => expect(resolverDatasDaMensagem(texto, HOJE).datas).toEqual([]));

  it("hoje inválido não resolve nada", () => expect(resolverDatasDaMensagem("amanhã", "17/09/2026")).toEqual({ datas: [], horas: [] }));

  it("extrairDatasEHoras devolve o que sobra sem as datas e horas (para a confirmação da proposta)", () => {
    expect(extrairDatasEHoras("sim, dia 20", HOJE)).toEqual({ datas: ["2026-09-20"], horas: [], resto: "sim,       " });
    expect(extrairDatasEHoras("ok amanhã às 14h", HOJE)).toMatchObject({ datas: ["2026-09-18"], horas: ["14:00"] });
    expect(extrairDatasEHoras("ok amanhã às 14h", HOJE).resto.trim().split(/\s+/)).toEqual(["ok", "as"]);
    expect(extrairDatasEHoras("pode ser dia 20 de manhã", HOJE).resto.trim().split(/\s+/)).toEqual(["pode", "ser", "de"]);
    expect(extrairDatasEHoras("sim, 150", HOJE).resto).toContain("150");
  });

  it.each([
    ["pode buscar sexta de manhã", ["09:00"]],
    ["à tarde", ["14:00"]],
    ["às 14:30", ["14:30"]],
    ["14h", ["14:00"]],
    ["14h30", ["14:30"]],
    ["2 da tarde", ["14:00"]],
    ["meio-dia", ["12:00"]],
    ["às 9", ["09:00"]],
    // correção 2: "às 3" é 15:00 (ninguém combina de madrugada); 6 e 7 continuam ambíguos
    ["às 3", ["15:00"]],
    ["sexta às 3", ["15:00"]],
    ["às 6", ["06:00", "18:00"]],
    ["dia 10 de manhã", ["09:00"]],
    ["10/9 de tarde", ["14:00"]],
    ["boa tarde, pode ser sexta", []],
    ["pago mais tarde", []],
    ["pago amanhã", []],
  ])("hora de %s", (texto, horas) => expect(resolverDatasDaMensagem(texto, HOJE).horas).toEqual(horas));
});

describe("tipo da mensagem (f12)", () => {
  it.each([
    ["STICKER", "", "figurinha_ou_reacao"], ["REACTION", "👍", "figurinha_ou_reacao"], ["TEXT", "👍", "so_emoji"], ["TEXT", "👍🏻😊", "so_emoji"],
    ["TEXT", "1234", "texto"], ["TEXT", "  ", "vazia"], ["AUDIO", "", "audio"], ["IMAGE", "", "imagem_ou_documento"],
    ["DOCUMENT", "", "imagem_ou_documento"], ["VIDEO", "", "outra_midia"], ["LOCATION", "", "outra_midia"], ["text", "oi", "texto"],
  ])("%s %s → %s", (tipo, texto, esperado) => expect(tipoDaMensagem(tipo, texto)).toBe(esperado));
});

describe("tokens de 4 dígitos (e7)", () => {
  it.each([
    ["Maria Souza 8909 pago dia 20/09", ["8909"]],
    ["final 8909", ["8909"]],
    ["8909.", ["8909"]],
    ["Maria Souza 8909, pago dia 20", ["8909"]],
    ["pago dia 20/09/2026", []],
    ["às 14:00", []],
    ["R$ 1500", []],
    ["1500,00", []],
    ["1500 reais", []],
    ["meu número é 99999-8888", []],
    ["sou cliente desde 2019", []],
    ["123.456.789-09", []],
    ["12345678909", []],
    ["8909 ou 8908", ["8909", "8908"]],
    ["8909 8909", ["8909"]],
    // telefone com espaço sai inteiro; sem contexto nem DDD, dois grupos são dois palpites
    ["8909 meu tel 9999 8888", ["8909"]],
    ["(43) 99999 8888", []],
    ["43 9 9999 8888 final 8909", ["8909"]],
    ["0000 1111", ["0000", "1111"]],
  ])("%s", (texto, tokens) => expect(tokensDeDigitos(texto)).toEqual(tokens));
});

describe("triagem antes da identidade (§3.2, na ordem)", () => {
  it.each([
    // tipo
    ["👍", "ignorar"], ["kkk 😊", "sem_digitos"],
    // número errado (s6)
    ["é engano", "numero_errado"], ["foi engano", "numero_errado"], ["número errado", "numero_errado"], ["não conheço", "numero_errado"],
    ["não conheço essa pessoa", "numero_errado"], ["troquei de número", "numero_errado"], ["ela não mora mais aqui", "numero_errado"],
    ["não sou essa pessoa", "numero_errado"], ["esse chip é meu agora", "numero_errado"],
    // terceiro (s6): nunca confirma, nem com os dígitos
    ["sou o filho dela", "terceiro"], ["sou esposo dela, pode falar comigo", "terceiro"], ["Não, é o marido. Maria Souza 8909", "terceiro"],
    ["aqui é a filha", "terceiro"], ["falo em nome dela", "terceiro"], ["ela tá trabalhando", "terceiro"], ["a conta é da minha mãe", "terceiro"],
    // parar (s6)
    ["para de mandar msg", "pediu_para_parar"], ["não quero mais receber", "pediu_para_parar"], ["me tira dessa lista", "pediu_para_parar"],
    ["não me chama mais", "pediu_para_parar"], ["pare de mandar mensagem", "pediu_para_parar"], ["vcs não param de mandar mensagem", "pediu_para_parar"],
    // contestação de titularidade (s6)
    ["não contratei", "contesta_titularidade"], ["não reconheço", "contesta_titularidade"], ["sofri um golpe, não fiz esse contrato", "contesta_titularidade"],
    ["usaram meu nome", "contesta_titularidade"], ["isso é fraude", "contesta_titularidade"], ["não conheço vocês", "contesta_titularidade"],
    // pessoa, jurídico, vulnerabilidade
    ["quero falar com atendente", "pediu_pessoa"], ["chama alguém", "pediu_pessoa"], ["me passa pra uma pessoa", "pediu_pessoa"],
    ["vou no Procon", "juridico"], ["meu advogado vai te ligar", "juridico"], ["ela faleceu", "vulnerabilidade"],
    ["a titular faleceu, sou o filho dela", "vulnerabilidade"], ["tô internado", "vulnerabilidade"],
    // D1 e golpe
    ["você é robô?", "pergunta_robo"], ["é gente?", "pergunta_robo"], ["tem alguém aí?", "pergunta_robo"], ["é IA?", "pergunta_robo"],
    ["é automático?", "pergunta_robo"], ["é gravação?", "pergunta_robo"], ["isso é chatgpt", "pergunta_robo"],
    ["é golpe?", "duvida_golpe"], ["como sei que é vocês?", "duvida_golpe"],
    // pergunta, dígitos, resto
    ["quem é?", "pergunta"], ["é sobre o quê?", "pergunta"], ["oi?", "pergunta"], ["E sobre o que", "pergunta"],
    ["8909", "digitos"], ["Maria Souza 8909 pago dia 20/09", "digitos"], ["é robô? 8909", "digitos"],
    ["oi", "sem_digitos"], ["pode", "sem_digitos"], ["pago dia 20", "sem_digitos"], ["já paguei", "sem_digitos"], ["eu ia pagar", "sem_digitos"],
    ["quero falar com meu marido antes", "sem_digitos"],
  ])("%s → %s", (texto, categoria) => expect(pre(texto)).toBe(categoria));

  it.each([
    // revisão B3 (alta): terceiro que se declara por posse ou representação e manda os dígitos NÃO confirma
    "o cpf é da minha mãe: 8909", "ela é minha mãe, 8909", "8909 é da minha esposa", "esse whats é da minha mãe, 8909",
    "respondendo pela minha mãe 8909", "falo pela minha mãe, 8909", "o final do cpf da minha esposa é 8909", "a Maria é minha mãe 8909",
    "Meu nome é João, filho da Maria, 8909", "minha mãe pediu pra eu responder, 8909", "aqui quem responde é o filho, 8909",
    "é a filha da Maria, final 8909", "respondendo por ela 8909", "o telefone é do meu marido, 8909",
  ])("terceiro com os dígitos: %s", texto => {
    expect(classificarMensagemPreIdentidade({ texto })).toEqual({ categoria: "terceiro", digitos: [] });
  });

  it.each([
    // o titular falando de si continua confirmando
    "8909", "sou eu mesma 8909", "sou a maria 8909", "8909 mas quem usa é meu filho", "quem paga é meu marido 8909",
    "8909 falando pelo whats", "falo por mim 8909", "ai meu pai do céu, 8909", "8909 meu tel 9999 8888",
  ])("titular com os dígitos: %s", texto => expect(pre(texto)).toBe("digitos"));

  it.each([
    // revisão B3: negação e objeto financeiro não são número errado
    ["não é engano", "sem_digitos"], ["não, não é engano", "sem_digitos"], ["é engano não, sou eu", "sem_digitos"], ["não, número errado", "numero_errado"],
    ["não conheço esse boleto", "contesta_titularidade"], ["não conheço esse valor", "contesta_titularidade"],
    ["não conheço esse numero de vcs", "contesta_titularidade"], ["não conheço esse número", "pergunta"],
    // pessoa em uma palavra, "processar" solto
    ["atendente", "pediu_pessoa"], ["Atendente.", "pediu_pessoa"], ["humano", "pediu_pessoa"], ["atendente por favor", "pediu_pessoa"], ["humano?", "pergunta_robo"],
    ["quero processar essa empresa", "juridico"], ["vou abrir um processo", "juridico"], ["processo de pagamento", "sem_digitos"], ["o pagamento tá em processo", "sem_digitos"],
    // "receber" só com objeto de contato
    ["não quero receber o boleto impresso", "sem_digitos"], ["não quero receber visita", "sem_digitos"], ["não quero receber mensagem", "pediu_para_parar"],
    ["não quero receber, obrigado", "pediu_para_parar"], ["tira meu nome da lista", "pediu_para_parar"],
  ])("revisão B3: %s → %s", (texto, categoria) => expect(pre(texto)).toBe(categoria));

  it("mídia: figurinha ignora, áudio pede para escrever e na 2ª transfere, imagem é possível comprovante", () => {
    expect(pre("", "STICKER")).toBe("ignorar");
    expect(pre("", "AUDIO")).toBe("audio");
    expect(classificarMensagemPreIdentidade({ tipo: "AUDIO", audioJaRespondido: true }).categoria).toBe("audio_repetido");
    expect(pre("", "IMAGE")).toBe("midia");
    expect(decidirPreIdentidade("midia")).toEqual({ acao: "transferir", aviso: "pagamento_informado" });
    expect(decidirPreIdentidade("ignorar")).toEqual({ acao: "ignorar" });
  });

  it("os dígitos só saem na categoria de dígitos", () => {
    expect(classificarMensagemPreIdentidade({ texto: "Maria 8909" }).digitos).toEqual(["8909"]);
    expect(classificarMensagemPreIdentidade({ texto: "sou o marido, 8909" }).digitos).toEqual([]);
  });

  it("toda categoria tem decisão, e toda frase citada existe nos textos do servidor (B2)", () => {
    for (const c of CATEGORIAS_PRE_IDENTIDADE) {
      const d = decidirPreIdentidade(c);
      expect(d).toBeTruthy();
      if (d.acao === "responder" || d.acao === "encerrar") expect(SITUACOES_PRE_IDENTIDADE).toContain(d.situacao);
    }
    expect(decidirPreIdentidade("pediu_para_parar")).toMatchObject({ acao: "encerrar", gravarNaoContatar: true });
    expect(decidirPreIdentidade("numero_errado")).toMatchObject({ acao: "encerrar", conferirTelefone: true });
    expect(decidirPreIdentidade("pediu_pessoa")).toEqual({ acao: "transferir", aviso: "pedido_pessoa" });
  });
});

describe("correção 2 da B3: travas de transferência que tinham se perdido", () => {
  const NOME = "MARIA DE SOUZA";
  const preComNome = (texto: string) => classificarMensagemPreIdentidade({ texto, nomeDoCliente: NOME }).categoria;
  const cat = (texto: string) => classificarTransferencia(texto, { hoje: HOJE });

  const CONTESTAR = ["quero contestar essa cobrança", "vou contestar", "contesto esse valor", "quero abrir uma contestação", "abrir contestação", "estou contestando essa cobrança", "contestação"];
  it.each(CONTESTAR)("contestação formal transfere nos dois lados da identidade: %s", texto => {
    expect(pre(texto)).toBe("contestacao");
    expect(decidirPreIdentidade("contestacao")).toEqual({ acao: "transferir", aviso: "contestacao" });
    expect(cat(texto)).toBe("contestacao");
  });
  it("quem nega o contrato continua em titularidade (encerra), não em contestação formal", () => {
    for (const texto of ["não sou a pessoa que contratou", "não fui eu que contratei", "não contratei, quero contestar"]) expect(pre(texto), texto).toBe("contesta_titularidade");
  });

  it.each([
    // s6: quem responde "não sou a Maria" à abertura não recebe o pedido dos dígitos do CPF de outra pessoa
    ["não sou a Maria", "numero_errado"], ["não sou Maria", "numero_errado"], ["não, aqui não é a Maria", "numero_errado"], ["não é a Maria", "numero_errado"],
    ["aqui não tem nenhuma Maria", "numero_errado"], ["aqui não tem Maria", "numero_errado"], ["não conheço essa Maria", "numero_errado"],
    ["número novo, era de outra pessoa", "numero_errado"], ["número novo, não conheço essa pessoa", "numero_errado"], ["esse número é meu agora", "numero_errado"],
    ["ela mudou de casa", "numero_errado"],
    // declarou terceiro na mesma mensagem: pede a titular, não encerra
    ["não sou a Maria, sou o marido dela", "terceiro"], ["não sou ela, sou a filha", "terceiro"], ["não sou a titular", "terceiro"],
    // não é número errado
    ["não sou a culpada", "sem_digitos"], ["não sou o seu marido", "sem_digitos"], ["esse número é meu", "sem_digitos"], ["não conheço o técnico", "sem_digitos"],
    ["não conheço esse procedimento", "sem_digitos"], ["não conheço esse site", "sem_digitos"], ["ela mudou de ideia", "sem_digitos"], ["ele mudou o plano", "sem_digitos"],
  ])("antes da identidade, com o nome do cadastro: %s → %s", (texto, categoria) => expect(preComNome(texto)).toBe(categoria));

  it("sem o nome do cadastro, a forma com artigo ainda é reconhecida", () => {
    for (const texto of ["não sou a Maria", "aqui não tem nenhuma Maria", "não conheço essa Maria"]) expect(pre(texto), texto).toBe("numero_errado");
  });

  it("depois da identidade: negar ser o cliente vai à equipe SEM a desculpa por engano; engano inequívoco encerra", () => {
    for (const texto of ["não sou a Maria", "não conheço essa pessoa", "não sou essa pessoa", "não sou a titular", "não sou eu, é minha mãe"]) {
      expect(cat(texto), texto).toBe("generica");
      expect(classificarEncerramento(texto), texto).toBeNull();
    }
    expect(classificarTransferencia("não sou Maria", { hoje: HOJE, nomeDoCliente: NOME })).toBe("generica");
    for (const texto of ["é engano", "esse número é meu agora", "comprei esse chip", "troquei de número", "número novo, era de outra pessoa"]) {
      expect(classificarEncerramento(texto), texto).toBe("numero_errado");
    }
    // o titular confirmado falando de outra coisa: nem desculpa por engano, nem transferência
    for (const texto of ["não conheço o técnico", "não conheço esse procedimento", "não conheço esse site", "ela mudou de ideia", "ele mudou o plano", "ela não mora mais aqui", "não conheço"]) {
      expect(classificarEncerramento(texto), texto).toBeNull();
      expect(cat(texto), texto).toBeNull();
    }
  });

  it.each([
    "quero um humano", "quero uma pessoa", "me passa pro atendente", "cadê o atendente?", "tem atendente?", "nao entendi quero falar com atendente",
    "não sei quero falar com uma pessoa", "não consigo falar com atendente", "não, quero falar com atendente",
  ])("pedido de pessoa transfere nos dois lados: %s", texto => {
    expect(pre(texto)).toBe("pediu_pessoa");
    expect(cat(texto)).toBe("pedido_pessoa");
  });
  it.each(["não quero falar com atendente, quero resolver aqui", "não preciso de atendente", "não quero um atendente"])("negação colada ao pedido não pede pessoa: %s", texto => {
    expect(pre(texto)).not.toBe("pediu_pessoa");
    expect(cat(texto)).toBeNull();
  });
  it("\"tem humano aí?\" continua sendo a pergunta sobre quem atende (D1)", () => expect(pre("tem humano aí?")).toBe("pergunta_robo"));

  it.each([
    // terceiro que manda os dígitos certos NÃO confirma (s6, correção 2)
    "boa tarde, é a esposa, 8909", "bom dia, é o marido. 8909", "Filho aqui, 8909", "oi, filha dela aqui 8909", "sim, filho aqui 8909",
    "meu marido é o titular, 8909", "quem contratou foi minha esposa 8909", "to respondendo pra minha mae 8909", "estou ajudando minha mãe 8909",
    "a maria saiu, final 8909", "a Maria não está, 8909", "ela não pode responder agora, 8909", "vou passar pra ela, 8909",
    "minha mãe não sabe mexer no celular, 8909",
  ])("terceiro com os dígitos: %s", texto => {
    expect(classificarMensagemPreIdentidade({ texto, nomeDoCliente: NOME })).toEqual({ categoria: "terceiro", digitos: [] });
  });
  it("sem artigo, \"Maria saiu\" só é terceiro com o nome do cadastro", () => {
    expect(preComNome("Maria saiu, 8909")).toBe("terceiro");
    expect(pre("Maria saiu, 8909")).toBe("digitos");
  });
  it.each([
    "boa tarde 8909", "o salário saiu, 8909", "a internet não está, 8909", "a fatura saiu? 8909", "o técnico saiu 8909", "8909 falo pra minha mãe pagar",
    "8909, meu filho aqui tá sem internet", "esse número é meu mesmo, 8909", "quem paga é meu marido 8909",
  ])("titular com os dígitos continua confirmando: %s", texto => expect(preComNome(texto)).toBe("digitos"));

  it("casos menores: fatura baixada, \"não cobrem mais\", \"morreu\"", () => {
    expect(cat("o boleto já foi baixado?")).toBe("generica");
    expect(pre("não cobrem mais")).toBe("pediu_para_parar");
    expect(classificarEncerramento("não cobrem mais")).toBe("pediu_para_parar");
    expect(pre("vocês não cobrem taxa?")).toBe("pergunta");
    expect(pre("a Maria morreu")).toBe("vulnerabilidade");
    expect(cat("minha mãe morreu")).toBe("vulnerabilidade");
    expect(pre("a internet morreu")).toBe("sem_digitos");
    expect(cat("a internet morreu de novo")).toBeNull();
  });
});

/**
 * Revisão final (voz): a D1 oferece "falar com alguém da equipe", e a resposta natural a essa oferta tem que ser
 * entendida como pedido de pessoa. Antes, "prefiro falar com alguém da equipe" recebia o pedido dos dígitos de novo, e
 * "prefiro falar com uma pessoa" caía em pergunta de robô — a funcionária repetia a própria oferta, em laço.
 */
describe("a oferta de alguém da equipe (D1) é entendida quando o cliente aceita", () => {
  const DADOS = { nomeDaPersona: "Clara", nomeDoProvedor: "NsLink", nomeDoCliente: "MARIA DE SOUZA", funcionariaJaFalou: true };
  /** Todas as variações da frase, pelas conversas c0..c29. */
  const variacoesDe = (fn: (s: SementeDoTexto) => BaloesDoServidor) => {
    const mapa = new Map<number, string>();
    for (let c = 0; c < 30; c++) { const b = fn({ conversationId: `c${c}` }); if (!mapa.has(b.variacao)) mapa.set(b.variacao, b.join(" ")); }
    return [...mapa.values()];
  };
  /** O aceite que cada forma da oferta pede, nas palavras dela. */
  const aceitesDaOferta = (frase: string): string[] => {
    if (/Se preferir falar com alguém da equipe/.test(frase)) return ["prefiro falar com alguém da equipe", "prefiro falar com alguém da equipe, por favor"];
    if (/Se quiser falar com alguém da equipe/.test(frase)) return ["quero falar com alguém da equipe", "quero sim, alguém da equipe"];
    if (/Se preferir, alguém da equipe continua com você/.test(frase)) return ["prefiro que alguém da equipe continue", "pode ser alguém da equipe"];
    throw new Error(`variação sem oferta reconhecida: ${frase}`);
  };
  const ACEITES_EM_GERAL = [
    "prefiro alguém da equipe", "sim, alguém da equipe", "alguém da equipe", "quero falar com a equipe", "me passa pra equipe",
    "pode passar pra equipe", "pode me passar pra equipe", "prefiro atendente", "prefiro falar com uma pessoa", "prefiro a equipe",
  ];

  const pre = variacoesDe(s => textoPreIdentidade("pergunta_robo", DADOS, s));
  const pos = variacoesDe(s => reservaPosIdentidade({ tipo: "pergunta_robo" }, { ...DADOS, carteira: "ativo", hoje: HOJE }, s));
  it("as três variações, antes e depois da identidade, trazem a oferta", () => {
    expect(pre).toHaveLength(3);
    expect(pos).toHaveLength(3);
  });
  it.each([...pre.map(frase => ["antes", frase] as const), ...pos.map(frase => ["depois", frase] as const)])("%s da identidade — %s", (fase, frase) => {
    for (const aceite of [...aceitesDaOferta(frase), ...ACEITES_EM_GERAL]) {
      if (fase === "antes") expect(classificarMensagemPreIdentidade({ texto: aceite, nomeDoCliente: DADOS.nomeDoCliente }).categoria, aceite).toBe("pediu_pessoa");
      else expect(classificarTransferencia(aceite, { hoje: HOJE, nomeDoCliente: DADOS.nomeDoCliente }), aceite).toBe("pedido_pessoa");
    }
  });
  it.each([
    "não precisa passar pra equipe", "não, prefiro seguir por aqui", "pode seguir por aqui", "não quero falar com a equipe",
    "alguém da equipe me ligou ontem", "prefiro pagar dia 10", "prefiro resolver por aqui", "quero falar com meu marido antes",
  ])("recusar a oferta ou falar de outra coisa não pede pessoa: %s", texto => {
    expect(classificarMensagemPreIdentidade({ texto, nomeDoCliente: DADOS.nomeDoCliente }).categoria).not.toBe("pediu_pessoa");
    expect(classificarTransferencia(texto, { hoje: HOJE })).not.toBe("pedido_pessoa");
  });
});

describe("pagamento informado sabe a data de hoje (s10)", () => {
  it.each([
    "já paguei", "paguei ontem", "fiz o pix ontem", "transferi hoje cedo", "depositei na conta de vcs", "quitei semana passada",
    "já acertei com a moça", "mandei o pix", "pix feito", "tá pago", "está pago", "foi pago", "o boleto já tá pago", "passei no banco",
    "efetuei o pagamento", "segue o comprovante", "pago dia 10", "pago dia 17", "pago dia 10/09", "já resolvi", "pago ontem",
    "pago dia 5 do mês passado", "pago dia 5 de setembro",
  ])("transfere: %s", texto => expect(detectarPagamentoInformado(texto, HOJE)).toBe(true));
  it.each([
    "pago dia 20", "pago dia 20/09", "pago amanhã", "pago sexta", "pago quando receber", "quem paga é meu marido", "ainda não paguei",
    "não paguei ainda", "vou pagar", "a gente paga dia 5", "consigo pagar dia 10/9", "eu ia pagar hoje", "pago",
    // o mês futuro dito depois de "dia N" é promessa, mesmo com N ≤ hoje
    "pago no dia 5 do mês que vem", "pago dia 5 do próximo mês", "pago dia 5 de outubro",
  ])("não transfere: %s", texto => expect(detectarPagamentoInformado(texto, HOJE)).toBe(false));
});

describe("transferência depois da identidade (§3.3, f3)", () => {
  const cat = (texto: string, permitirNegociacao = false) => classificarTransferencia(texto, { hoje: HOJE, permitirNegociacao });
  it.each([
    ["quero falar com um atendente", "pedido_pessoa"], ["quero atendente", "pedido_pessoa"], ["vou no procon", "juridico"],
    ["meu advogado vai entrar em contato", "juridico"], ["vou processar vocês", "juridico"], ["vou entrar na justiça", "juridico"],
    ["minha mãe faleceu", "vulnerabilidade"], ["estou de luto", "vulnerabilidade"], ["tô internado", "vulnerabilidade"],
    ["meu pai está na UTI", "vulnerabilidade"], ["faço tratamento de câncer", "vulnerabilidade"], ["tô no hospital", "vulnerabilidade"],
    ["não reconheço essa dívida", "contestacao"], ["cobrança indevida", "contestacao"], ["não contratei isso", "contestacao"],
    ["já paguei", "pagamento_informado"], ["fiz o pix ontem", "pagamento_informado"], ["pago dia 10", "pagamento_informado"],
    ["já devolvi", "devolucao_informada"], ["entreguei o aparelho", "devolucao_informada"], ["já retiraram", "devolucao_informada"],
    ["o técnico já levou", "devolucao_informada"], ["vocês vão me negativar?", "generica"], ["estou no SPC", "generica"],
    ["pode dar baixa na fatura", "generica"], ["tem desconto?", "generica"], ["sei onde você mora", "generica"],
    // revisão B3: cobertura que tinha encolhido
    ["quero processar essa empresa", "juridico"], ["vou abrir um processo", "juridico"], ["atendente", "pedido_pessoa"],
    ["retirar o meu nome", "generica"], ["limpa meu nome", "generica"], ["não conheço esse boleto", "contestacao"],
  ])("%s → %s", (texto, categoria) => expect(cat(texto)).toBe(categoria));

  it.each([
    "é golpe?", "isso é golpe?", "você é robô?", "você é humano?", "é gente?", "tô desempregado", "estou sem dinheiro", "pago dia 20",
    "pago amanhã", "pago sexta", "pago quando receber", "quero cancelar", "quem paga é meu marido", "consigo pagar dia 10/9",
    "Quero agendar a retirada amanhã às 14:00", "Podem retirar amanhã às 14:00?", "qual o valor?", "ainda não devolvi",
    "não quero falar com atendente, quero resolver aqui", "pago no dia 5 do mês que vem", "o pagamento tá em processo", "vai processar o pix hoje?",
    "tira meu nome da lista",
  ])("segue ao planejador: %s", texto => expect(cat(texto)).toBeNull());

  // revisão final (LGPD, CDC art. 42): quem se declarou terceiro não recebe dado da dívida, nem com a identidade vigente
  it.each([
    "sou a filha dela, quanto tá a conta?", "sou a filha dela 8909", "o cpf é da minha mãe, quanto deve?", "to respondendo pela minha mãe",
    "sou o marido dela, quanto deve?", "a conta é da minha mãe", "falo em nome dela",
  ])("terceiro declarado vai à equipe: %s", texto => expect(cat(texto)).toBe("generica"));
  it.each(["quem paga é meu marido", "falo pra minha mãe pagar", "meu filho aqui tá sem internet", "o salário saiu", "o técnico saiu", "esse número é meu mesmo"])(
    "o titular falando da família ou de outra coisa não vira terceiro: %s", texto => expect(cat(texto)).toBeNull());
  it("com o nome do cadastro, \"Maria saiu\" também é terceiro depois da identidade", () => {
    expect(classificarTransferencia("Maria saiu, quanto deve?", { hoje: HOJE, nomeDoCliente: "MARIA DE SOUZA" })).toBe("generica");
  });

  it("negociação ligada libera só desconto e parcelamento", () => {
    expect(cat("tem desconto ou parcelamento?", true)).toBeNull();
    expect(cat("tem desconto? já paguei", true)).toBe("pagamento_informado");
    expect(cat("quero desconto e meu advogado vai entrar", true)).toBe("juridico");
  });

  it("número errado e pedido para parar encerram sem aviso", () => {
    expect(classificarEncerramento("número errado")).toBe("numero_errado");
    expect(classificarEncerramento("pare de mandar mensagens")).toBe("pediu_para_parar");
    expect(classificarEncerramento("pago amanhã")).toBeNull();
    // o titular confirmado que diz "não é engano" ou contesta o boleto não recebe a desculpa por engano (revisão B3)
    for (const texto of ["não é engano", "não, não é engano", "não conheço esse boleto", "não conheço esse valor", "não conheço esse numero de vcs", "não quero receber o boleto impresso"]) {
      expect(classificarEncerramento(texto), texto).toBeNull();
    }
    expect(classificarEncerramento("tira meu nome da lista")).toBe("pediu_para_parar");
  });
});
