import { describe, expect, it } from "vitest";
import {
  confirmacaoDeAcordo, confirmacaoTolerante, exigeHumano, propostaConfirmada, reservaDaProposta, reservaDaResposta, respostaControlada, textoDaProposta, validarProposta,
  VALIDADE_DA_PROPOSTA_MS,
} from "./chat-autonomia-politica";

const agora = new Date("2026-09-06T15:00:00Z");
describe("limites do motor autônomo", () => {
  it("requer consentimento inequívoco posterior a oferta, dentro do episódio (6 h)", () => {
    expect(confirmacaoDeAcordo("sim, mas só metade")).toBe(false);
    const p = validarProposta({ acao: "promessa", data: "2026-09-10", valor: 100 }, "pago 10/9", 100, "m1", agora);
    expect(propostaConfirmada(p, "sim", "m1", agora)).toBe(false);
    expect(propostaConfirmada(p, "sim", "m2", agora)).toBe(true);
    // f4: o cliente responde depois do almoço — 5 h depois ainda vale; passou do episódio, não
    expect(propostaConfirmada(p, "sim", "m2", new Date(agora.getTime() + 5 * 60 * 60_000))).toBe(true);
    expect(propostaConfirmada(p, "sim", "m2", new Date(agora.getTime() + VALIDADE_DA_PROPOSTA_MS))).toBe(false);
    // um "ok" a outra pergunta não confirma a proposta que ficou para trás
    expect(propostaConfirmada(p, "ok", "m2", agora, { ultimoBalaoEraAPergunta: false })).toBe(false);
    expect(propostaConfirmada(p, "ok", "m2", agora, { ultimoBalaoEraAPergunta: true })).toBe(true);
  });
  it("bloqueia desconto, data inventada, impossível e passada", () => {
    expect(validarProposta({ acao: "promessa", data: "2026-09-10", valor: 90 }, "10/9", 100, "m", agora)).toBeNull();
    expect(validarProposta({ acao: "promessa", data: "2026-09-10" }, "amanhã", 100, "m", agora)).toBeNull();
    expect(validarProposta({ acao: "promessa", data: "2026-09-31" }, "31/9", 100, "m", agora)).toBeNull();
    expect(validarProposta({ acao: "promessa", data: "2026-09-05" }, "5/9", 100, "m", agora)).toBeNull();
  });
  it("agenda apenas data e hora que o cliente disse; manhã = 09:00 e tarde = 14:00", () => {
    expect(validarProposta({ acao: "agendar", data: "2026-09-10T14:00:00-03:00" }, "10/9 às 14:00", 0, "m", agora)?.acao).toBe("agendar");
    expect(validarProposta({ acao: "agendar", data: "2026-09-10T14:00:00-03:00" }, "10/9 de tarde", 0, "m", agora)?.acao).toBe("agendar");
    expect(validarProposta({ acao: "agendar", data: "2026-09-10T14:00:00-03:00" }, "10/9 de manhã", 0, "m", agora)).toBeNull();
    expect(validarProposta({ acao: "agendar", data: "2026-09-10T15:00:00-03:00" }, "10/9 às 14:00", 0, "m", agora)).toBeNull();
    expect(validarProposta({ acao: "agendar", data: "2026-09-10T14:00:00-03:00" }, "10/9", 0, "m", agora)).toBeNull();
  });
  it("aceita datas com zero à esquerda e pedidos normais de retirada", () => {
    for (const texto of ["Quero agendar a retirada amanhã às 14:00", "Podem retirar amanhã às 14:00?"]) expect(exigeHumano(texto)).toBe(false);
    for (const dia of ["09/09", "9/9"]) expect(validarProposta({ acao: "agendar", data: "2026-09-09T14:00:00-03:00" }, `${dia} às 14:00`, null, "m", new Date("2026-09-08T15:00:00Z"))?.data).toBe("2026-09-09T14:00:00-03:00");
  });
  it("negociação autorizada remove só o bloqueio de desconto e mantém contestação e pagamento informado", () => {
    expect(exigeHumano("tem desconto ou parcelamento?", true)).toBe(false);
    expect(exigeHumano("tem desconto? já paguei", true)).toBe(true);
    expect(exigeHumano("quero desconto e meu advogado vai entrar", true)).toBe(true);
  });
  it("a reserva é a voz da funcionária (D6): o tom não põe prefixo corporativo nem muda o fato lido", () => {
    const plano = { acao: "responder" as const, resposta: "informar_divida" as const };
    const firme = respostaControlada(plano, 150, false, { tom: "firme_objetivo" });
    const acolhedor = respostaControlada(plano, 150, false, { tom: "firme_objetivo", vulneravel: true });
    for (const r of [firme, acolhedor]) {
      expect(r).toContain("R$ 150,00");
      expect(r).not.toMatch(/Vamos conferir a situação e definir o próximo passo|ERP|leitura de agora|assistente virtual/);
    }
  });
  it("a variação segue a conversa e não repete a última usada (f13)", () => {
    const plano = { acao: "responder" as const, resposta: "informar_divida" as const };
    const primeira = reservaDaResposta(plano, 150, false, { semente: { conversationId: "conv_9" } });
    const outra = reservaDaResposta(plano, 150, false, { semente: { conversationId: "conv_9", ultimaVariacao: primeira.variacao } });
    expect(outra.variacao).not.toBe(primeira.variacao);
    expect(outra.join()).not.toBe(primeira.join());
  });
  it("com a persona e o provedor, a reserva fala como a funcionária; do cliente, só o primeiro nome", () => {
    const r = reservaDaResposta({ acao: "responder", resposta: "acolher" }, 150, false, { nomeDaPersona: "Clara", nomeDoProvedor: "NsLink", nomeDoCliente: "MARIA DE SOUZA", funcionariaJaFalou: false, permitirPromessa: true, permitirSegundaVia: true });
    expect(r[0]).toMatch(/Clara, da NsLink/);
    expect(r.join(" ")).not.toMatch(/SOUZA|Souza/);
  });
  it("no turno da identidade recém-confirmada, sem pergunta de valor, a reserva não cita R$ (f20)", () => {
    const plano = { acao: "responder" as const, resposta: "informar_divida" as const };
    expect(respostaControlada(plano, 150, false, { identidadeRecemConfirmada: true, ultimaMensagemDoCliente: "8909" })).not.toContain("R$");
    expect(respostaControlada(plano, 150, false, { identidadeRecemConfirmada: true, ultimaMensagemDoCliente: "8909 quanto devo?" })).toContain("R$ 150,00");
  });
  it("a proposta pergunta com a data em dd/mm e o valor integral; o agendamento com o turno — nunca data ISO", () => {
    const hoje = "2026-09-17";
    const promessa = textoDaProposta({ acao: "promessa", data: "2026-09-18", valor: 150, criadaEm: "", messageId: "m" }, { hoje });
    expect(promessa).toMatch(/R\$ 150,00/);
    expect(promessa).toContain("18/09");
    expect(promessa).toMatch(/\?$/);
    expect(promessa).not.toMatch(/2026-09-18|ERP|Responda/);
    const agendar = reservaDaProposta({ acao: "agendar", data: "2026-09-19T14:00:00-03:00", criadaEm: "", messageId: "m" }, { hoje });
    expect(agendar.join(" ")).toMatch(/19\/09, à tarde/);
    expect(agendar.join(" ")).not.toMatch(/R\$|valor/);
  });
  it("ex-cliente recebe recuperação de contrato encerrado mesmo se o tom legado pedir retenção", () => {
    const r = respostaControlada({ acao: "responder", resposta: "informar_divida" }, 150, false, { carteira: "ex_cliente", tom: "negociar_reter" });
    expect(r).toMatch(/contrato (que foi )?encerrado/);
    expect(r).toContain("150,00");
    expect(r).not.toMatch(/preserve nossa relação|boas-vindas|suspensão|reativa|contrato vigente/i);
  });
  it.each(["informar_divida", "acolher", "pedir_data", "pedir_confirmacao"] as const)("%s não oferece funções desligadas", (resposta) => {
    const r = respostaControlada({ acao: "responder", resposta }, 150, false, { permitirPromessa: false, permitirSegundaVia: false });
    expect(r).not.toMatch(/segunda via|dia pra você pagar|qual dia|fazer o pagamento|pagar\?/i);
  });
  it("oferece só a função habilitada: segunda via sem promessa nem coleta de data", () => {
    const r = respostaControlada({ acao: "responder", resposta: "informar_divida" }, 150, false, { carteira: "ativo", permitirPromessa: false, permitirSegundaVia: true });
    expect(r).toContain("segunda via");
    expect(r).not.toMatch(/promessa|qual data|dia pra você pagar/i);
  });
  it.each(["orientar_devolucao", "acolher", "pedir_data", "pedir_confirmacao"] as const)("equipamento em %s não oferece agendamento desligado", (resposta) => {
    const r = respostaControlada({ acao: "responder", resposta }, null, true, { permitirAgendamento: false });
    expect(r).not.toMatch(/registrar um agendamento|qual dia|qual data|informe.*horário|combinar a data|me diz um dia/i);
  });
  it.each(["já paguei", "quero atendente", "não reconheço", "número errado", "desconto", "já devolvi", "pare de mandar mensagens"])("transfere exceção: %s", texto => expect(exigeHumano(texto)).toBe(true));
  // Negativar, baixar, retirar o nome, SPC/Serasa, Procon e advogado: nunca pela IA.
  it.each([
    "vocês vão me negativar?", "meu nome foi negativado", "quero a negativação retirada", "pode dar baixa na fatura", "vocês baixaram o título?",
    "quero retirar meu nome", "a retirada do meu nome do SPC", "estou no Serasa por causa de vocês", "estou no SPC", "vou no Procon", "meu advogado vai entrar em contato",
  ])("transfere exceção de política: %s", texto => expect(exigeHumano(texto)).toBe(true));
  it.each(["consigo pagar dia 10/9", "vou pagar amanhã", "posso devolver dia 10/9 às 14:00", "qual o valor?"])("não transfere o fluxo normal: %s", texto => expect(exigeHumano(texto)).toBe(false));
  // Correção 2 da B3: travas que o `exigeHumano` antigo tinha e a lista nova tinha perdido.
  it.each([
    "quero contestar essa cobrança", "vou contestar", "quero abrir uma contestação", "contestação", "estou contestando essa cobrança",
    "não sou a Maria", "não sou essa pessoa", "não conheço essa pessoa",
    "quero um humano", "me passa pro atendente", "cadê o atendente?", "tem atendente?", "nao entendi quero falar com atendente",
    "o boleto já foi baixado?", "não cobrem mais", "a Maria morreu",
  ])("transfere (correção 2): %s", texto => expect(exigeHumano(texto)).toBe(true));
  it("com o nome do cadastro, \"não sou Maria\" sem artigo também transfere", () => {
    expect(exigeHumano("não sou Maria")).toBe(false);
    expect(exigeHumano("não sou Maria", false, new Date(), "MARIA DE SOUZA")).toBe(true);
  });
  it.each(["não conheço o técnico", "não conheço esse procedimento", "ela mudou de ideia", "não quero falar com atendente, quero resolver aqui"])("não transfere (correção 2): %s", texto => expect(exigeHumano(texto)).toBe(false));
  it("jamais transmite texto livre ou link do modelo", () => {
    const r = respostaControlada({ acao: "responder", resposta: "informar_divida", texto: "pague R$999 em https://malicioso" }, 100, false);
    expect(r).toContain("100,00"); expect(r).not.toContain("999"); expect(r).not.toContain("malicioso");
  });
  // Saldo não lido agora = `null`. Não é zero e não é o valor da varredura das 03:00.
  it("sem saldo lido no ERP não cita valor nenhum: a reserva acolhe, sem número", () => {
    const r = respostaControlada({ acao: "responder", resposta: "informar_divida" }, null, false);
    expect(r).not.toMatch(/\d|R\$/);
    expect(r).not.toMatch(/ERP|atendente/);
  });
  it("sem saldo lido no ERP não existe promessa, nem com data citada pelo cliente", () => {
    expect(validarProposta({ acao: "promessa", data: "2026-09-10", valor: 150 }, "pago 10/9", null, "m1", agora)).toBeNull();
    // A devolução não fala em valor: o agendamento continua válido.
    expect(validarProposta({ acao: "agendar", data: "2026-09-10T14:00:00-03:00" }, "10/9 às 14:00", null, "m", agora)?.acao).toBe("agendar");
  });
});

// 17/09/2026, quinta-feira, 12:00 em Brasília
const quinta = new Date("2026-09-17T15:00:00Z");
describe("datas que o cliente disse viram proposta (f2)", () => {
  const promessa = (data: string, texto: string) => validarProposta({ acao: "promessa", data }, texto, 150, "m1", quinta)?.data ?? null;
  it.each([
    ["2026-09-20", "pago dia 20"],
    ["2026-09-18", "fechado, sexta então"],
    ["2026-09-17", "consigo pagar hoje"],
    ["2026-09-24", "quinta que vem"],
    ["2026-09-18", "pago amanhã"],
    ["2026-09-19", "depois de amanhã"],
    ["2026-10-10", "pode ser dia 10"],
    ["2026-09-21", "segunda-feira eu pago"],
    ["2026-09-30", "30/09"],
  ])("%s ← %s", (data, texto) => expect(promessa(data, texto)).toBe(data));
  it.each([
    ["2026-09-25", "pago dia 20"], // data que o cliente não disse
    ["2026-09-18", "pago quando receber"], // sem data não há proposta
    ["2026-12-20", "20/12"], // além de 90 dias
    ["2026-09-14", "segunda"], // já passou
  ])("recusa %s ← %s", (data, texto) => expect(promessa(data, texto)).toBeNull());
  it("\"pago dia 20 do mês que vem\" é 20/10, e agendamento de madrugada não existe (correção 2)", () => {
    expect(promessa("2026-10-20", "pago dia 20 do mês que vem")).toBe("2026-10-20");
    expect(promessa("2026-09-20", "pago dia 20 do mês que vem")).toBeNull();
    expect(validarProposta({ acao: "agendar", data: "2026-09-18T15:00:00-03:00" }, "sexta às 3", null, "m", quinta)?.acao).toBe("agendar");
    expect(validarProposta({ acao: "agendar", data: "2026-09-18T03:00:00-03:00" }, "sexta às 3", null, "m", quinta)).toBeNull();
    expect(validarProposta({ acao: "agendar", data: "2026-09-18T03:00:00-03:00" }, "sexta 03:00", null, "m", quinta)).toBeNull();
    expect(validarProposta({ acao: "agendar", data: "2026-09-18T06:00:00-03:00" }, "sexta às 6", null, "m", quinta)?.acao).toBe("agendar");
  });
  it("'pode buscar sexta de manhã' vira agendamento às 09:00, nunca às 14:00", () => {
    expect(validarProposta({ acao: "agendar", data: "2026-09-18T09:00:00-03:00" }, "pode buscar sexta de manhã", null, "m", quinta)?.data).toBe("2026-09-18T09:00:00-03:00");
    expect(validarProposta({ acao: "agendar", data: "2026-09-18T14:00:00-03:00" }, "pode buscar sexta de manhã", null, "m", quinta)).toBeNull();
    expect(validarProposta({ acao: "agendar", data: "2026-09-18T14:00:00-03:00" }, "sexta à tarde", null, "m", quinta)?.acao).toBe("agendar");
    expect(validarProposta({ acao: "agendar", data: "2026-09-18T14:30:00-03:00" }, "sexta 14h30", null, "m", quinta)?.acao).toBe("agendar");
  });
});

describe("confirmação tolerante (promessa e agendamento) e estrita (acordo) — s8", () => {
  it.each(["sim", "Sim!", "isso", "isso mesmo", "pode", "pode sim", "pode anotar", "fechado", "combinado", "confirmo", "ok", "Ok, obrigada",
    "beleza", "blz", "certo", "tá bom", "perfeito", "👍", "👍🏻", "sim 😊", "pode ser", "ok 👍", "sim, pode registrar"])("tolerante aceita: %s", texto => expect(confirmacaoTolerante(texto)).toBe(true));
  it.each(["sim, mas só metade", "não", "ok?", "pode não", "sim, dia 25", "ok, mas amanhã", "obrigada", "tá", "valeu", "entendi", "vou ver",
    "talvez", "sim só que no outro mês", "", "😡", "beleza, mas quero desconto"])("tolerante recusa: %s", texto => expect(confirmacaoTolerante(texto)).toBe(false));
  it.each(["sim", "Sim.", "aceito", "confirmo", "fechado", "sim, aceito", "eu aceito", "aceito o acordo"])("acordo aceita: %s", texto => expect(confirmacaoDeAcordo(texto)).toBe(true));
  it.each(["ok", "beleza", "isso", "pode", "👍", "sim 👍", "sim, mas só que parcelado", "aceito?", "combinado", "tá bom", "sim, dia 10", "confirmo, mas",
    // revisão B3: no estrito nenhum emoji sai do texto
    "sim 😊", "aceito 🙏", "fechado 😉"])("acordo recusa: %s", texto => expect(confirmacaoDeAcordo(texto)).toBe(false));

  it("a proposta aceita a própria data ou hora repetida, nunca outra nem número novo (revisão B3)", () => {
    const quintaDia17 = new Date("2026-09-17T15:00:00Z");
    const promessa = validarProposta({ acao: "promessa", data: "2026-09-20", valor: 100 }, "pago dia 20", 100, "m1", quintaDia17);
    expect(promessa).not.toBeNull();
    for (const texto of ["sim, dia 20", "pode ser dia 20", "ok, 20/09", "fechado, dia 20 então", "sim dia 20 de setembro"]) {
      expect(propostaConfirmada(promessa, texto, "m2", quintaDia17), texto).toBe(true);
    }
    for (const texto of ["sim, dia 25", "ok, mas dia 20", "sim dia 20 ou 21", "sim, dia 20, 150", "sim, dia 20 às 10h", "sim, amanhã", "sim, dia 20?"]) {
      expect(propostaConfirmada(promessa, texto, "m2", quintaDia17), texto).toBe(false);
    }
    const agendamento = validarProposta({ acao: "agendar", data: "2026-09-18T14:00:00-03:00" }, "sexta às 14h", null, "m1", quintaDia17);
    expect(agendamento).not.toBeNull();
    for (const texto of ["sim, sexta às 14h", "pode ser sexta", "ok, às 14h", "combinado, sexta-feira à tarde"]) {
      expect(propostaConfirmada(agendamento, texto, "m2", quintaDia17), texto).toBe(true);
    }
    for (const texto of ["sim, sexta às 15h", "sim, sábado", "ok, de manhã"]) {
      expect(propostaConfirmada(agendamento, texto, "m2", quintaDia17), texto).toBe(false);
    }
  });
});

describe("exigeHumano por categorias (f3, s10) — frases dos achados", () => {
  it.each([
    "fiz o pix ontem", "transferi hoje cedo", "depositei na conta de vcs", "quitei semana passada", "já acertei com a moça", "mandei o pix",
    "pix feito", "tá pago", "foi pago", "passei no banco", "efetuei o pagamento", "segue o comprovante", "pago dia 10", "pago dia 17",
    "quero falar com um atendente", "vou processar vocês", "minha mãe faleceu", "tô internado", "meu filho está na UTI", "tenho câncer",
    "tô no hospital", "estou de luto", "não reconheço essa dívida", "não contratei isso", "é engano", "troquei de número",
    "para de mandar msg", "não quero mais receber", "me tira dessa lista", "entreguei o aparelho", "já retiraram",
  ])("transfere: %s", texto => expect(exigeHumano(texto, false, quinta)).toBe(true));
  it.each([
    "é golpe?", "isso é golpe?", "você é humano?", "você é robô?", "tô desempregado", "estou sem dinheiro", "pago dia 20", "pago amanhã",
    "pago sexta", "pago quando receber", "quero cancelar", "quem paga é meu marido", "ainda não paguei",
  ])("segue ao planejador: %s", texto => expect(exigeHumano(texto, false, quinta)).toBe(false));
  // revisão final: terceiro declarado não fica com a IA depois da identidade — ela falaria da dívida com ele
  it.each(["sou o filho dela", "sou o marido dela, quanto deve?"])("terceiro declarado transfere: %s", texto => expect(exigeHumano(texto, false, quinta)).toBe(true));
});
