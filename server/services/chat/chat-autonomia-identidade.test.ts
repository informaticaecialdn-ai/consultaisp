import { describe, expect, it } from "vitest";
import {
  avaliarIdentidade, contarTentativas, exigirIdentidadeRecente, identidadeVigente, LIMITES_DA_IDENTIDADE, pedirIdentidadeDeNovo,
  protegerHistorico, renovarEpisodio, tentativasDosEstados, type EstadoIdentidade, type EstadoIdentidadeDoEpisodio,
} from "./chat-autonomia-identidade";

const agora = new Date("2026-09-17T15:00:00Z");
const depois = (ms: number) => new Date(agora.getTime() + ms);
const H = 60 * 60_000;
const vinculo = { providerId: 42, conversationId: "c1", customerId: 7, telefone: "5543999990000" };
const cadastro = { nome: "Maria de Souza", documento: "12345678909" };
const avaliar = (estado: EstadoIdentidade | null, texto: string, id = "m2", tempo = agora, vinc = vinculo, tentativasDoCliente?: { em24h: number; em30Dias: number }) =>
  avaliarIdentidade(estado, vinc, cadastro, texto, id, { agora: tempo, tentativasDoCliente });

describe("identidade do cliente validada pelo servidor (D10)", () => {
  it("a abertura é o desafio: a 1ª mensagem com os 4 dígitos já confirma e segue a rodada", () => {
    const r = avaliar(null, "8909", "m1");
    expect(r).toMatchObject({ acao: "confirmada", recemConfirmada: true, tentativaGasta: false, mensagem: "" });
    expect(identidadeVigente(r.estado, agora)).toBe(true);
  });

  it("só os 4 últimos dígitos: o nome não é exigido nem atrapalha (f6)", () => {
    for (const texto of ["8909", "Maria Souza 8909", "sou a maria sousa, final 8909", "MARIA - 8909", "8909."]) expect(avaliar(null, texto, "m1").acao).toBe("confirmada");
  });

  it("e7: 'Maria Souza 8909 pago dia 20/09' confirma e a intenção segue; '1234' gasta; 'pago dia 20' sem dígitos não gasta", () => {
    expect(avaliar(null, "Maria Souza 8909 pago dia 20/09", "m1")).toMatchObject({ acao: "confirmada", recemConfirmada: true });
    expect(avaliar(null, "Maria Souza 8909, posso pagar 150", "m1").acao).toBe("confirmada");
    const errado = avaliar(null, "Maria Souza 1234", "m1");
    expect(errado).toMatchObject({ acao: "desafiar", situacao: "erro_digitos", tentativaGasta: true });
    expect((errado.estado as EstadoIdentidadeDoEpisodio).tentativasEm).toHaveLength(1);
    const semDigito = avaliar(null, "pago dia 20", "m1");
    expect(semDigito).toMatchObject({ acao: "desafiar", tentativaGasta: false });
    expect((semDigito.estado as EstadoIdentidadeDoEpisodio).tentativasEm).toEqual([]);
  });

  it("CPF completo, data, hora, valor e telefone não são tentativa", () => {
    for (const texto of ["12345678909", "123.456.789-09", "dia 20/09/2026", "às 14:00", "R$ 1500", "me liga no 99999-8888"]) {
      const r = avaliar(null, texto, "m1");
      expect(r.tentativaGasta, texto).toBe(false);
      expect(r.acao, texto).not.toBe("confirmada");
    }
  });

  it("cada final diferente é um palpite; mais de 2 numa mensagem nunca confirma e esgota o limite", () => {
    expect(avaliar(null, "8909 ou 8908", "m1").acao).toBe("confirmada");
    const dois = avaliar(null, "1234 ou 4321", "m1");
    expect(dois).toMatchObject({ acao: "desafiar", situacao: "erro_digitos", tentativaGasta: true });
    expect((dois.estado as EstadoIdentidadeDoEpisodio).tentativasEm).toHaveLength(2);
    expect(avaliar(null, "0000 1111 8909", "m1")).toMatchObject({ acao: "humano", situacao: "tentativas_esgotadas", tentativaGasta: true });
  });

  it("mensagem sem dígito não é tentativa: pergunta explica, robô confirma a automação, golpe tranquiliza", () => {
    const desafio = avaliar(null, "oi", "m1");
    expect(desafio).toMatchObject({ acao: "desafiar", situacao: "desafio", tentativaGasta: false });
    expect(desafio.mensagem).toContain("4 últimos dígitos");
    const pergunta = avaliar(desafio.estado, "E sobre o que?", "m2");
    expect(pergunta).toMatchObject({ acao: "desafiar", situacao: "explicacao", tentativaGasta: false });
    expect(pergunta.mensagem).not.toMatch(/d[íi]vida|fatura|boleto|pagamento|cobran/i);
    expect(avaliar(desafio.estado, "você é robô?", "m2")).toMatchObject({ situacao: "pergunta_robo", tentativaGasta: false });
    expect(avaliar(desafio.estado, "é golpe?", "m2")).toMatchObject({ situacao: "duvida_golpe", tentativaGasta: false });
    expect(avaliar(desafio.estado, "pode", "m2")).toMatchObject({ situacao: "re_pedido", tentativaGasta: false });
    expect(avaliar(pergunta.estado, "8909", "m3").acao).toBe("confirmada");
    expect(JSON.stringify(pergunta)).not.toContain("12345678909");
  });

  it("limite nas DUAS janelas: com 1 tentativa sobrando, 2 finais não conferem e o gasto não passa do limite (revisão B3)", () => {
    let e = avaliar(null, "0000", "m1").estado;
    e = avaliar(e, "1111", "m2").estado;
    const ultima = avaliar(e, "2222 8909", "m3");
    expect(ultima).toMatchObject({ acao: "humano", situacao: "tentativas_esgotadas", tentativaGasta: true });
    expect((ultima.estado as EstadoIdentidadeDoEpisodio).tentativasEm).toHaveLength(3);
    const dois = avaliar(null, "0000 1111", "m1").estado;
    const depoisDeDois = avaliar(dois, "2222 8909", "m2");
    expect(depoisDeDois).toMatchObject({ acao: "humano", situacao: "tentativas_esgotadas" });
    expect((depoisDeDois.estado as EstadoIdentidadeDoEpisodio).tentativasEm).toHaveLength(3);
    // 30 dias: 4 de 5 gastas → só 1 final por mensagem confere
    expect(avaliar(null, "2222 8909", "m1", agora, vinculo, { em24h: 0, em30Dias: 4 })).toMatchObject({ acao: "humano", situacao: "tentativas_esgotadas" });
    expect(avaliar(null, "8909", "m1", agora, vinculo, { em24h: 0, em30Dias: 4 }).acao).toBe("confirmada");
    // o telefone com espaço não é palpite: o titular confirma
    expect(avaliar(null, "8909 meu tel 9999 8888", "m1")).toMatchObject({ acao: "confirmada", tentativaGasta: false });
    // contagem do storage estranha não zera nem estoura o limite
    expect(avaliar(null, "8909", "m1", agora, vinculo, { em24h: Number.NaN, em30Dias: -3 }).acao).toBe("confirmada");
  });

  it("terceiro que se declara por posse ou representação não confirma nem gasta tentativa (revisão B3)", () => {
    for (const texto of [
      "o cpf é da minha mãe: 8909", "ela é minha mãe, 8909", "8909 é da minha esposa", "esse whats é da minha mãe, 8909", "respondendo pela minha mãe 8909",
      "falo pela minha mãe, 8909", "o final do cpf da minha esposa é 8909", "a Maria é minha mãe 8909", "Meu nome é João, filho da Maria, 8909",
      "minha mãe pediu pra eu responder, 8909",
    ]) {
      const r = avaliar(null, texto, "m1");
      expect(r, texto).toMatchObject({ acao: "desafiar", situacao: "terceiro", tentativaGasta: false, recemConfirmada: false });
      expect(r.estado?.confirmadaEm ?? null, texto).toBeNull();
      expect((r.estado as EstadoIdentidadeDoEpisodio).tentativasEm, texto).toEqual([]);
    }
  });

  it("terceiro declarado nunca confirma, nem com os dígitos certos, e não gasta tentativa (s6)", () => {
    for (const texto of ["Não, é o marido. Maria Souza 8909", "sou o filho dela 8909", "sou esposo dela, pode falar comigo"]) {
      const r = avaliar(null, texto, "m1");
      expect(r, texto).toMatchObject({ acao: "desafiar", situacao: "terceiro", tentativaGasta: false });
      expect(r.estado?.confirmadaEm ?? null).toBeNull();
    }
  });

  it("número errado, parar e contestação encerram com a frase própria; pessoa, jurídico e vulnerabilidade vão com aviso neutro", () => {
    expect(avaliar(null, "é engano", "m1")).toMatchObject({ acao: "humano", situacao: "numero_errado", decisao: { acao: "encerrar", conferirTelefone: true } });
    expect(avaliar(null, "para de mandar msg", "m1")).toMatchObject({ acao: "humano", situacao: "pediu_para_parar", decisao: { gravarNaoContatar: true } });
    expect(avaliar(null, "não contratei isso", "m1")).toMatchObject({ acao: "humano", situacao: "contesta_titularidade" });
    expect(avaliar(null, "quero falar com atendente", "m1")).toMatchObject({ acao: "humano", situacao: null, mensagem: "", decisao: { aviso: "pedido_pessoa" } });
    expect(avaliar(null, "ela faleceu", "m1")).toMatchObject({ acao: "humano", decisao: { aviso: "vulnerabilidade" } });
    expect(avaliar(null, "👍", "m1")).toMatchObject({ acao: "ignorar", mensagem: "", estado: null });
  });

  it("correção 2: \"não sou a Maria\" encerra sem pedir os dígitos; contestar transfere; terceiro por ausência não confirma", () => {
    for (const texto of ["não sou a Maria", "não sou Maria", "aqui não tem Maria", "não é a Maria"]) {
      const r = avaliar(null, texto, "m1");
      expect(r, texto).toMatchObject({ acao: "humano", situacao: "numero_errado", tentativaGasta: false, decisao: { acao: "encerrar", conferirTelefone: true } });
      expect(r.mensagem, texto).not.toMatch(/d[íi]gitos|CPF/);
    }
    // nem o nome nem o documento aparecem na frase
    expect(avaliar(null, "não sou Maria", "m1").mensagem).not.toMatch(/Maria|12345678909/);
    for (const texto of ["quero contestar essa cobrança", "vou contestar"]) {
      expect(avaliar(null, texto, "m1"), texto).toMatchObject({ acao: "humano", situacao: null, mensagem: "", decisao: { acao: "transferir", aviso: "contestacao" } });
    }
    for (const texto of ["Maria saiu, 8909", "boa tarde, é a esposa, 8909", "Filho aqui, 8909", "meu marido é o titular, 8909"]) {
      const r = avaliar(null, texto, "m1");
      expect(r, texto).toMatchObject({ acao: "desafiar", situacao: "terceiro", tentativaGasta: false, recemConfirmada: false });
      expect(r.estado?.confirmadaEm ?? null, texto).toBeNull();
    }
  });

  it("correção 2: conversa revinculada a outro cliente não apaga as tentativas do anterior", () => {
    let e = avaliar(null, "0000", "m1").estado; e = avaliar(e, "1111", "m2").estado;
    // o operador revinculou a conversa ao cliente 8: o estado novo é dele, e as 2 tentativas do 7 ficam guardadas
    const vinculo8 = { ...vinculo, customerId: 8 };
    const estado8 = avaliar(e, "oi", "m3", agora, vinculo8).estado as EstadoIdentidadeDoEpisodio;
    expect(estado8.customerId).toBe(8);
    expect(estado8.tentativasEm).toEqual([]);
    expect(estado8.tentativasDeOutrosClientes?.["7"]).toHaveLength(2);
    // a contagem por cliente (storage) continua achando as 2 do cliente 7 nessa linha — e nenhuma do 8
    expect(tentativasDosEstados([estado8], 42, 7, agora)).toEqual({ em24h: 2, em30Dias: 2 });
    expect(tentativasDosEstados([estado8], 42, 8, agora)).toEqual({ em24h: 0, em30Dias: 0 });
    expect(tentativasDosEstados([estado8], 43, 7, agora)).toEqual({ em24h: 0, em30Dias: 0 });
    // errar com o 8 não mistura as contas
    const errou8 = avaliar(estado8, "2222", "m4", agora, vinculo8).estado as EstadoIdentidadeDoEpisodio;
    expect(errou8.tentativasEm).toHaveLength(1);
    expect(errou8.tentativasDeOutrosClientes?.["7"]).toHaveLength(2);
    // voltou para o 7: as dele voltam a ser o histórico principal (e a 3ª esgota), as do 8 ficam guardadas
    const de7 = avaliar(errou8, "3333", "m5", agora, vinculo);
    expect(de7).toMatchObject({ acao: "humano", situacao: "tentativas_esgotadas" });
    const estado7 = de7.estado as EstadoIdentidadeDoEpisodio;
    expect(estado7.tentativasEm).toHaveLength(3);
    expect(estado7.tentativasDeOutrosClientes).toEqual({ "8": errou8.tentativasEm });
    // tentativa com mais de 30 dias não é guardada; outro provedor não herda nada
    expect((avaliar(errou8, "oi", "m6", depois(31 * 24 * H), vinculo).estado as EstadoIdentidadeDoEpisodio).tentativasDeOutrosClientes).toBeUndefined();
    expect((avaliar(errou8, "oi", "m6", agora, { ...vinculo, providerId: 43 }).estado as EstadoIdentidadeDoEpisodio).tentativasDeOutrosClientes).toBeUndefined();
  });

  it("três erros em 24 h esgotam: a 3ª já sai com a frase dos canais oficiais e nada confirma até a janela passar", () => {
    let e = avaliar(null, "0000", "m1").estado;
    e = avaliar(e, "1111", "m2").estado;
    const terceira = avaliar(e, "2222", "m3");
    expect(terceira).toMatchObject({ acao: "humano", situacao: "tentativas_esgotadas", motivo: "tentativas_esgotadas", tentativaGasta: true });
    expect(terceira.mensagem).toContain("canais oficiais");
    expect(avaliar(terceira.estado, "8909", "m4", depois(H)).acao).toBe("humano");
    expect(avaliar(terceira.estado, "oi", "m4", depois(H)).situacao).toBe("tentativas_esgotadas");
    // passada a janela de 24 h, o limite de 24 h libera (os 30 dias ainda contam 3 de 5)
    expect(avaliar(terceira.estado, "8909", "m5", depois(25 * H)).acao).toBe("confirmada");
  });

  it("tentativas contam por CLIENTE entre conversas (s7): o storage traz a contagem, e 5 em 30 dias também esgota", () => {
    expect(avaliar(null, "0000", "m1", agora, { ...vinculo, conversationId: "c9" }, { em24h: 2, em30Dias: 2 })).toMatchObject({ acao: "humano", situacao: "tentativas_esgotadas" });
    expect(avaliar(null, "8909", "m1", agora, vinculo, { em24h: 3, em30Dias: 3 }).acao).toBe("humano");
    expect(avaliar(null, "8909", "m1", agora, vinculo, { em24h: 0, em30Dias: 5 }).acao).toBe("humano");
    expect(avaliar(null, "8909", "m1", agora, vinculo, { em24h: 0, em30Dias: 4 }).acao).toBe("confirmada");
    // o que o storage conta vale mesmo quando a conversa não tem histórico; o histórico local nunca é ignorado
    let e = avaliar(null, "0000", "m1").estado; e = avaliar(e, "1111", "m2").estado;
    expect(avaliar(e, "2222", "m3", agora, vinculo, { em24h: 0, em30Dias: 0 }).acao).toBe("humano");
  });

  it("a mesma mensagem reprocessada não gasta outra tentativa", () => {
    const e = avaliar(null, "0000", "m1").estado;
    const repetida = avaliar(e, "0000", "m1");
    expect(repetida).toMatchObject({ acao: "desafiar", situacao: "erro_digitos", tentativaGasta: false });
    expect((repetida.estado as EstadoIdentidadeDoEpisodio).tentativasEm).toHaveLength(1);
    expect(repetida.estado).toBe(e);
  });

  it("reprocessada, a mensagem mantém a decisão original: parar continua parar, transferência continua transferência (revisão B3)", () => {
    const parar = avaliar(null, "para de mandar msg", "m1");
    expect(avaliar(parar.estado, "para de mandar msg", "m1")).toMatchObject({ acao: "humano", situacao: "pediu_para_parar", decisao: { gravarNaoContatar: true } });
    const pessoa = avaliar(null, "quero falar com atendente", "m1");
    expect(avaliar(pessoa.estado, "quero falar com atendente", "m1")).toMatchObject({ acao: "humano", situacao: null, decisao: { aviso: "pedido_pessoa" } });
    const terceiro = avaliar(null, "sou o filho dela", "m1");
    expect(avaliar(terceiro.estado, "sou o filho dela", "m1")).toMatchObject({ acao: "desafiar", situacao: "terceiro" });
    let e = avaliar(null, "0000", "m1").estado; e = avaliar(e, "1111", "m2").estado;
    const esgotou = avaliar(e, "2222", "m3");
    const replay = avaliar(esgotou.estado, "2222", "m3");
    expect(replay).toMatchObject({ acao: "humano", situacao: "tentativas_esgotadas", tentativaGasta: false });
    expect((replay.estado as EstadoIdentidadeDoEpisodio).tentativasEm).toHaveLength(3);
  });

  it("episódio (f4): 'sim' 5 h depois não pede dígitos; 6 h sem mensagem expira; o teto de 24 h vale mesmo renovando", () => {
    const confirmado = avaliar(null, "8909", "m1").estado!;
    const cincoHoras = avaliar(confirmado, "sim", "m2", depois(5 * H));
    expect(cincoHoras).toMatchObject({ acao: "confirmada", recemConfirmada: false });
    expect(Date.parse(cincoHoras.estado!.validaAte!)).toBe(depois(11 * H).getTime());
    expect(avaliar(confirmado, "sim", "m2", depois(6 * H + 1)).acao).toBe("desafiar");
    let e = confirmado;
    for (let h = 5; h <= 20; h += 5) e = avaliar(e, "oi", `r${h}`, depois(h * H)).estado!;
    expect(identidadeVigente(e, depois(23 * H))).toBe(true);
    expect(identidadeVigente(renovarEpisodio(e, depois(23 * H)), depois(24 * H))).toBe(false);
    expect(avaliar(e, "oi", "r25", depois(24 * H)).acao).toBe("desafiar");
  });

  it("confirmação não atravessa cliente, telefone, provedor ou conversa; cadastro alterado pede de novo", () => {
    const e = avaliar(null, "8909", "m1").estado!;
    expect(avaliar(e, "boleto", "m3").acao).toBe("confirmada");
    for (const alterado of [{ customerId: 8 }, { telefone: "5543988880000" }, { providerId: 43 }, { conversationId: "c2" }]) {
      expect(avaliar(e, "boleto", "m3", agora, { ...vinculo, ...alterado }).acao).not.toBe("confirmada");
    }
    expect(avaliarIdentidade(e, vinculo, { ...cadastro, documento: "98765432100" }, "boleto", "m3", agora).acao).not.toBe("confirmada");
  });

  it("aceite de acordo exige confirmação de até 2 h (acordo com identidade de 3 h pede os dígitos)", () => {
    const e = avaliar(null, "8909", "m1").estado!;
    expect(exigirIdentidadeRecente(e, depois(H))).toBe(true);
    const renovado = avaliar(e, "sim", "m2", depois(3 * H)).estado!;
    expect(identidadeVigente(renovado, depois(3 * H))).toBe(true);
    expect(exigirIdentidadeRecente(renovado, depois(3 * H))).toBe(false);
    const deNovo = pedirIdentidadeDeNovo(renovado, depois(3 * H));
    expect(identidadeVigente(deNovo, depois(3 * H))).toBe(false);
    expect(avaliar(deNovo, "8909", "m3", depois(3 * H))).toMatchObject({ acao: "confirmada", recemConfirmada: true });
    expect(exigirIdentidadeRecente(null)).toBe(false);
  });

  it("contagem de tentativas por janela e por cliente; estado antigo sem histórico conta pela quantidade", () => {
    expect(contarTentativas([depois(-H).toISOString(), depois(-25 * H).toISOString(), depois(-31 * 24 * H).toISOString(), "lixo"], agora)).toEqual({ em24h: 1, em30Dias: 2 });
    const antigo: EstadoIdentidade = { ...vinculo, cadastroHash: "x", tentativas: 2, desafiadaEm: depois(-H).toISOString(), ultimaMensagemId: "m", confirmadaEm: null, validaAte: null };
    const outroCliente = { ...antigo, customerId: 8 };
    const outroProvedor = { ...antigo, providerId: 43 };
    expect(tentativasDosEstados([antigo, outroCliente, outroProvedor, null], 42, 7, agora)).toEqual({ em24h: 2, em30Dias: 2 });
    expect(LIMITES_DA_IDENTIDADE).toMatchObject({ tentativasEm24h: 3, tentativasEm30Dias: 5 });
  });

  it("cadastro sem CPF válido ou telefone fora do padrão vai ao atendente; documentos ficam fora do planejador", () => {
    expect(avaliarIdentidade(null, vinculo, { nome: "Maria", documento: "" }, "oi", "m1", agora)).toMatchObject({ acao: "humano", motivo: "cadastro_incompleto", estado: null });
    expect(avaliarIdentidade(null, vinculo, { ...cadastro, documento: "00000000000" }, "oi", "m1", agora).acao).toBe("humano");
    expect(avaliarIdentidade(null, { ...vinculo, telefone: "43999990000" }, cadastro, "8909", "m1", agora).acao).toBe("humano");
    expect(protegerHistorico("Meu CPF 123.456.789-09, final 8909", cadastro.documento)).not.toMatch(/123|8909/);
  });

  it("cadastro incompleto derruba a confirmação sem apagar o histórico de tentativas (correção 2)", () => {
    const comTentativa = avaliar(null, "0000", "m1").estado as EstadoIdentidadeDoEpisodio;
    const r = avaliarIdentidade(comTentativa, vinculo, { nome: "Maria", documento: "" }, "8909", "m2", agora);
    expect(r).toMatchObject({ acao: "humano", motivo: "cadastro_incompleto" });
    expect((r.estado as EstadoIdentidadeDoEpisodio).tentativasEm).toEqual(comTentativa.tentativasEm);
    const confirmado = avaliar(null, "8909", "m1").estado!;
    expect(identidadeVigente(avaliarIdentidade(confirmado, vinculo, { nome: "Maria", documento: "" }, "oi", "m2", agora).estado, agora)).toBe(false);
  });

  it("a frase usa os nomes quando o serviço os passa, e nunca o cadastro", () => {
    const r = avaliarIdentidade(null, vinculo, cadastro, "oi", "m1", { agora, dados: { nomeDaPersona: "Clara", nomeDoProvedor: "NsLink", nomeDoCliente: "MARIA DE SOUZA" } });
    expect(r.mensagem).toContain("Clara");
    expect(r.mensagem).not.toMatch(/Souza|12345678909/);
  });
});
