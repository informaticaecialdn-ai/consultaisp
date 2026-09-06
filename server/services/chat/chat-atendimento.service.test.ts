import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  getConversaDoChat: vi.fn(), getIntegracaoDoChat: vi.fn(),
  atualizarConversaDoChat: vi.fn(), registrarEventoDoChat: vi.fn(),
  moverConversaDoChat: vi.fn(),
  obterCasoDeCobranca: vi.fn(), getRecoveryCaseById: vi.fn(),
  getCustomerById: vi.fn(), getEquipmentByCustomer: vi.fn(),
  clienteDoAtendimento: vi.fn(), getPoliticaDeCobranca: vi.fn(),
  atualizarCasoDeCobranca: vi.fn(),
}));
const remoto = vi.hoisted(() => ({
  desligarIa: vi.fn(), atribuir: vi.fn(), enviarTexto: vi.fn(),
  encerrar: vi.fn(), listarMensagens: vi.fn(), obterMidia: vi.fn(),
}));
const autonomia = vi.hoisted(() => ({ cancelar: vi.fn() }));
vi.mock("../../storage", () => ({ storage: fake }));
vi.mock("../../storage/chat-autonomia.storage", () => ({ autonomiaStorage: autonomia }));
vi.mock("./chat-trava", () => ({ comTravaDoChat: async (_k: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("./chat-ponte.service", () => ({
  clienteDoChat: () => remoto,
  ErroDaPonteDoChat: class extends Error { constructor(public codigo: string, m: string) { super(m); } },
}));
import {
  ACAO_AO_RECEBER_MENSAGEM, ACAO_PADRAO_APOS_RESPOSTA, MOTIVO_ENCERRAR_SEM_FOLLOW_UP,
  acaoNaConversa, detalheDoAtendimento, followUpAoEncerrar, followUpAoResponder, lerFollowUp, midiaDoAtendimento, proximoDiaUtil, receberRespostaDoCliente,
} from "./chat-atendimento.service";

/** Um caso vivo, como `obterCasoDeCobranca` devolve (so o que o servico le). */
const casoAberto = (extra: Record<string, unknown> = {}) => ({
  id: 10, status: "aberto", carteira: "ativo", valorAtual: 120, responsavelUserId: null, responsavelNome: null,
  proximaAcao: null, proximoContatoEm: null, quadranteDna: null, tom: null, cliente: { diasAtraso: 12 }, ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  fake.getConversaDoChat.mockResolvedValue({ conversationId: "c1", providerId: 6, customerId: 42, casoId: 10, recuperacaoId: null, status: "WAITING" });
  fake.getIntegracaoDoChat.mockResolvedValue({ organizationId: "org6" });
  fake.atualizarConversaDoChat.mockImplementation(async (_p, _c, d) => d);
  fake.moverConversaDoChat.mockResolvedValue({ status: "PENDING" });
  fake.getEquipmentByCustomer.mockResolvedValue([]);
  fake.obterCasoDeCobranca.mockResolvedValue(casoAberto());
  fake.atualizarCasoDeCobranca.mockResolvedValue(casoAberto());
  for (const fn of Object.values(remoto)) fn.mockResolvedValue({ ok: true, valor: {} });
});

const emAtendimento = () => fake.getConversaDoChat.mockResolvedValue({ conversationId: "c1", providerId: 6, customerId: 42, casoId: 10, recuperacaoId: null, status: "OPEN" });
const amanha = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

describe("atendimento dentro do módulo", () => {
  it("mostra nome e idioma do template preservando o tipo sem inventar seu corpo", async () => {
    remoto.listarMensagens.mockResolvedValue({ ok: true, valor: [
      { id: "t1", type: "TEMPLATE", content: { name: "abertura_ativos", language: { code: "pt_BR" } } },
      { id: "t2", type: "TEMPLATE", content: { name: "abertura_ex", language: { code: "pt_BR" }, text: "Olá, posso falar com Maria?" } },
      { id: "t3", type: "TEMPLATE", content: {} },
    ] });
    const detalhe = await detalheDoAtendimento(6, "c1");
    expect(detalhe.mensagens).toMatchObject([
      { id: "t1", tipo: "TEMPLATE", texto: "Template de abertura: abertura_ativos (pt_BR)" },
      { id: "t2", tipo: "TEMPLATE", texto: "Olá, posso falar com Maria?" },
      { id: "t3", tipo: "TEMPLATE", texto: "Template de abertura" },
    ]);
  });
  it("o detalhe leva o follow-up do caso para a tela mostrar o que esta combinado", async () => {
    remoto.listarMensagens.mockResolvedValue({ ok: true, valor: [] });
    const quando = amanha();
    fake.obterCasoDeCobranca.mockResolvedValue(casoAberto({ proximaAcao: "Cobrar a promessa", proximoContatoEm: quando }));
    const detalhe = await detalheDoAtendimento(6, "c1");
    expect(detalhe.cobranca).toMatchObject({ id: 10, proximaAcao: "Cobrar a promessa", proximoContatoEm: quando });
  });
  it("template não é oferecido como mídia mesmo pela rota direta", async () => {
    remoto.listarMensagens.mockResolvedValue({ ok: true, valor: [{ id: "t1", type: "TEMPLATE", content: { name: "abertura_ativos" } }] });
    await expect(midiaDoAtendimento(6, "c1", "t1", 1)).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(remoto.obterMidia).not.toHaveBeenCalled();
  });
  it("anexo deve pertencer à conversa autorizada antes de buscar sua URL", async () => {
    remoto.listarMensagens.mockResolvedValue({ ok: true, valor: [{ id: "outra" }] });
    await expect(midiaDoAtendimento(6, "c1", "m1", 2)).rejects.toMatchObject({ codigo: "CASO_NAO_ENCONTRADO" });
    expect(remoto.obterMidia).not.toHaveBeenCalled();
    expect(remoto.listarMensagens).toHaveBeenCalledWith("org6", "c1", { page: 2, limit: 40 });
  });
  it("rejeita URLs de anexo executáveis ou com credenciais", async () => {
    remoto.listarMensagens.mockResolvedValue({ ok: true, valor: [{ id: "m1" }] });
    for (const url of ["javascript:alert(1)", "https://usuario:senha@exemplo.com/x"]) {
      remoto.obterMidia.mockResolvedValue({ ok: true, valor: { url } });
      await expect(midiaDoAtendimento(6, "c1", "m1", 1)).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
    }
    remoto.obterMidia.mockResolvedValue({ ok: true, valor: { url: "https://exemplo.com/audio", mimeType: "audio/ogg" } });
    expect(await midiaDoAtendimento(6, "c1", "m1", 1)).toEqual({ url: "https://exemplo.com/audio", mimeType: "audio/ogg" });
  });
  it("não acessa a API remota com conversa de outro provedor", async () => {
    fake.getConversaDoChat.mockResolvedValue(undefined);
    await expect(acaoNaConversa(7, "c1", 4, { acao: "assumir" })).rejects.toMatchObject({ codigo: "CASO_NAO_ENCONTRADO" });
    expect(fake.getConversaDoChat).toHaveBeenCalledWith(7, "c1");
    expect(remoto.desligarIa).not.toHaveBeenCalled();
  });
  it("pausa IA antes de assumir; registra quem assumiu", async () => {
    await acaoNaConversa(6, "c1", 4, { acao: "assumir" });
    expect(remoto.desligarIa).toHaveBeenCalledWith("org6", "c1");
    expect(remoto.desligarIa.mock.invocationCallOrder[0]).toBeLessThan(remoto.atribuir.mock.invocationCallOrder[0]);
    expect(fake.registrarEventoDoChat).toHaveBeenCalledWith(6, expect.objectContaining({ casoId: 10 }), 4, expect.stringContaining("assumiu"), undefined);
  });
  it("não envia texto se o operador ainda não assumiu", async () => {
    await expect(acaoNaConversa(6, "c1", 4, { acao: "enviar", texto: "Olá" })).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(remoto.enviarTexto).not.toHaveBeenCalled();
  });
  it("falha ao pausar IA bloqueia o envio e mantém o estado", async () => {
    emAtendimento();
    remoto.desligarIa.mockResolvedValue({ ok: false, erro: "indisponível" });
    await expect(acaoNaConversa(6, "c1", 4, { acao: "enviar", texto: "Olá" })).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
    expect(remoto.enviarTexto).not.toHaveBeenCalled();
    expect(fake.atualizarConversaDoChat).not.toHaveBeenCalled();
    expect(fake.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });
  it("primeira resposta pausa IA e vai para PENDING; repetição não duplica evento", async () => {
    await receberRespostaDoCliente(6, "c1");
    expect(remoto.atribuir).toHaveBeenCalledWith("org6", "c1", { status: "PENDING" });
    fake.getConversaDoChat.mockResolvedValue({ conversationId: "c1", status: "PENDING", casoId: 10 });
    await receberRespostaDoCliente(6, "c1");
    expect(fake.registrarEventoDoChat).toHaveBeenCalledTimes(1);
  });
  /**
   * Conversa encerrada e o cliente escreve de novo: e este caminho — e so ele —
   * que reabre a conversa em PENDING, grava a linha do tempo e devolve o caso a
   * fila. Com a autonomia ligada ele deixou de rodar por um tempo, e a mensagem
   * do cliente sumia; a rota do webhook agora garante que ele rode.
   */
  it("conversa encerrada volta a PENDING com o histórico, o evento e o caso pedindo resposta", async () => {
    fake.getConversaDoChat.mockResolvedValue({ conversationId: "c1", providerId: 6, customerId: 42, casoId: 10, recuperacaoId: null, status: "CLOSED" });
    await receberRespostaDoCliente(6, "c1");
    expect(remoto.desligarIa).toHaveBeenCalledWith("org6", "c1");
    expect(remoto.atribuir).toHaveBeenCalledWith("org6", "c1", { status: "PENDING" });
    expect(fake.moverConversaDoChat).toHaveBeenCalledWith(6, "c1", "CLOSED", "PENDING");
    expect(fake.registrarEventoDoChat).toHaveBeenCalledWith(6, expect.objectContaining({ casoId: 10 }), null, expect.stringContaining("Cliente respondeu"));
    expect(fake.atualizarCasoDeCobranca).toHaveBeenCalledWith(6, 10, expect.objectContaining({ proximaAcao: ACAO_AO_RECEBER_MENSAGEM, responsavelUserId: null }), null);
  });
  it("resposta durante atendimento humano não devolve o chat à fila", async () => {
    emAtendimento();
    await receberRespostaDoCliente(6, "c1");
    expect(remoto.atribuir).not.toHaveBeenCalled();
  });
  it("não duplica evento se outro webhook já moveu a conversa", async () => {
    fake.moverConversaDoChat.mockResolvedValue(undefined);
    await receberRespostaDoCliente(6, "c1");
    expect(fake.registrarEventoDoChat).not.toHaveBeenCalled();
    expect(fake.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });
  it("encerrar conversa não encerra dívida nem recuperação", async () => {
    emAtendimento();
    await acaoNaConversa(6, "c1", 4, { acao: "encerrar", proximaAcao: "Ligar de novo", proximoContatoEm: amanha().toISOString() });
    expect(remoto.encerrar).toHaveBeenCalledWith("org6", "c1");
    expect(fake.atualizarConversaDoChat).toHaveBeenCalledWith(6, "c1", { status: "CLOSED" });
    const patch = fake.atualizarCasoDeCobranca.mock.calls[0][2];
    expect(patch).not.toHaveProperty("status");
  });
});

/* ── Follow-up: todo contato pelo chat termina com a proxima acao, o dono e o quando ── */

describe("proximoDiaUtil", () => {
  it("sexta pula o fim de semana; quarta vira quinta; sabado vai para segunda — mesma hora", () => {
    const sexta = new Date(2026, 8, 4, 15, 30); // 04/09/2026 e sexta
    expect(proximoDiaUtil(sexta)).toEqual(new Date(2026, 8, 7, 15, 30));
    expect(proximoDiaUtil(new Date(2026, 8, 2, 9, 0))).toEqual(new Date(2026, 8, 3, 9, 0));
    expect(proximoDiaUtil(new Date(2026, 8, 5, 9, 0))).toEqual(new Date(2026, 8, 7, 9, 0));
  });
  /**
   * O dia da semana e o de Brasilia, nao o do processo. Com o processo em UTC
   * — que e como a VPS roda —, a sexta 23:30 de Brasilia ja e sabado la, e o
   * "proximo dia util" caia em DOMINGO. O fuso e trocado aqui de proposito: na
   * maquina do dev (America/Sao_Paulo) o defeito nao apareceria.
   */
  it("decide o dia da semana em Brasilia mesmo com o servidor em UTC", () => {
    // `delete process.env.TZ` NAO devolve o fuso do sistema: o processo fica em
    // UTC e contamina os testes seguintes. Guarda-se o nome resolvido.
    const fusoDoProcesso = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "UTC";
    try {
      // Sexta 04/09 23:30 BRT — em UTC ja e sabado 05/09 02:30.
      expect(proximoDiaUtil(new Date("2026-09-05T02:30:00Z"))).toEqual(new Date("2026-09-08T02:30:00Z")); // segunda 07/09 23:30 BRT
      // Quinta 03/09 22:00 BRT (sexta 04/09 01:00 UTC) → sexta, nao segunda.
      expect(proximoDiaUtil(new Date("2026-09-04T01:00:00Z"))).toEqual(new Date("2026-09-05T01:00:00Z"));
      // Sabado 05/09 10:00 BRT → segunda 07/09 10:00 BRT.
      expect(proximoDiaUtil(new Date("2026-09-05T13:00:00Z"))).toEqual(new Date("2026-09-07T13:00:00Z"));
      // Domingo 06/09 20:00 BRT (segunda 07/09 23:00 UTC) → segunda 07/09 20:00 BRT.
      expect(proximoDiaUtil(new Date("2026-09-06T23:00:00Z"))).toEqual(new Date("2026-09-07T23:00:00Z"));
    } finally {
      process.env.TZ = fusoDoProcesso;
    }
  });
});

describe("leitura do follow-up", () => {
  const agora = new Date(2026, 8, 4, 15, 0);
  it("vazio e 'nao informado'; acao longa e data ilegivel ou passada sao recusadas", () => {
    expect(lerFollowUp(undefined, agora)).toEqual({});
    expect(lerFollowUp({ proximaAcao: "  ", proximoContatoEm: "" }, agora)).toEqual({});
    expect(() => lerFollowUp({ proximaAcao: "x".repeat(121) }, agora)).toThrow(/120/);
    expect(() => lerFollowUp({ proximoContatoEm: "ontem" }, agora)).toThrow(/inválida/);
    expect(() => lerFollowUp({ proximoContatoEm: new Date(2026, 8, 3) }, agora)).toThrow(/daqui para a frente/);
  });
  it("ao responder, o que faltou ganha o padrao: aguardar o cliente no proximo dia util", () => {
    expect(followUpAoResponder(undefined, agora)).toEqual({ proximaAcao: ACAO_PADRAO_APOS_RESPOSTA, proximoContatoEm: new Date(2026, 8, 7, 15, 0) });
    expect(followUpAoResponder({ proximaAcao: "Cobrar a promessa" }, agora)).toEqual({ proximaAcao: "Cobrar a promessa", proximoContatoEm: new Date(2026, 8, 7, 15, 0) });
    const quando = new Date(2026, 8, 10, 9, 0);
    expect(followUpAoResponder({ proximoContatoEm: quando.toISOString() }, agora)).toEqual({ proximaAcao: ACAO_PADRAO_APOS_RESPOSTA, proximoContatoEm: quando });
  });
  it("ao encerrar nao ha padrao: sem acao ou sem data, recusa", () => {
    expect(() => followUpAoEncerrar(undefined, agora)).toThrow(MOTIVO_ENCERRAR_SEM_FOLLOW_UP);
    expect(() => followUpAoEncerrar({ proximaAcao: "Ligar de novo" }, agora)).toThrow(MOTIVO_ENCERRAR_SEM_FOLLOW_UP);
    expect(() => followUpAoEncerrar({ proximoContatoEm: new Date(2026, 8, 8) }, agora)).toThrow(MOTIVO_ENCERRAR_SEM_FOLLOW_UP);
    expect(followUpAoEncerrar({ proximaAcao: "Ligar de novo", proximoContatoEm: new Date(2026, 8, 8, 9, 0) }, agora)).toEqual({ proximaAcao: "Ligar de novo", proximoContatoEm: new Date(2026, 8, 8, 9, 0) });
  });
});

describe("o chat grava o follow-up no caso", () => {
  it("mensagem do cliente na fila: 'Responder no chat', agora, sem dono (volta a fila); o motor e o autor", async () => {
    const antes = Date.now();
    await receberRespostaDoCliente(6, "c1");
    expect(fake.atualizarCasoDeCobranca).toHaveBeenCalledTimes(1);
    const [providerId, casoId, patch, userId] = fake.atualizarCasoDeCobranca.mock.calls[0];
    expect([providerId, casoId, userId]).toEqual([6, 10, null]);
    expect(patch).toMatchObject({ proximaAcao: ACAO_AO_RECEBER_MENSAGEM, responsavelUserId: null });
    expect(patch.proximoContatoEm.getTime()).toBeGreaterThanOrEqual(antes);
    expect(fake.obterCasoDeCobranca).toHaveBeenCalledWith(6, 10);
  });
  it("mensagem do cliente com atendente na conversa: o dono continua quem assumiu", async () => {
    emAtendimento();
    await receberRespostaDoCliente(6, "c1");
    const patch = fake.atualizarCasoDeCobranca.mock.calls[0][2];
    expect(patch).toMatchObject({ proximaAcao: ACAO_AO_RECEBER_MENSAGEM });
    expect(patch).not.toHaveProperty("responsavelUserId");
  });
  it("mensagem do cliente com o caso ja pago: nada a pedir", async () => {
    fake.obterCasoDeCobranca.mockResolvedValue(casoAberto({ status: "pago" }));
    await receberRespostaDoCliente(6, "c1");
    expect(fake.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });
  it("assumir torna o atendente o dono do caso; quem ja e dono nao gera evento", async () => {
    await acaoNaConversa(6, "c1", 4, { acao: "assumir" });
    expect(fake.atualizarCasoDeCobranca).toHaveBeenCalledWith(6, 10, { responsavelUserId: 4 }, 4);
    fake.atualizarCasoDeCobranca.mockClear();
    fake.obterCasoDeCobranca.mockResolvedValue(casoAberto({ responsavelUserId: 4 }));
    await acaoNaConversa(6, "c1", 4, { acao: "assumir" });
    expect(fake.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });
  it("responder sem dizer o depois: 'Aguardar resposta do cliente' no proximo dia util, no evento e no caso", async () => {
    emAtendimento();
    const r = await acaoNaConversa(6, "c1", 4, { acao: "enviar", texto: "Olá" });
    const esperado = { proximaAcao: ACAO_PADRAO_APOS_RESPOSTA, proximoContatoEm: expect.any(Date) };
    expect(fake.registrarEventoDoChat).toHaveBeenCalledWith(6, expect.objectContaining({ casoId: 10 }), 4, expect.stringContaining("enviou"), expect.objectContaining(esperado));
    expect(fake.atualizarCasoDeCobranca).toHaveBeenCalledWith(6, 10, expect.objectContaining(esperado), 4);
    const quando: Date = fake.atualizarCasoDeCobranca.mock.calls[0][2].proximoContatoEm;
    expect(quando.getTime()).toBeGreaterThan(Date.now());
    expect([0, 6]).not.toContain(quando.getDay());
    expect(r).toMatchObject({ statusConversa: "OPEN", followUp: esperado });
  });
  it("responder dizendo o depois: o que o atendente escreveu vale, com a data que ele deu", async () => {
    emAtendimento();
    const quando = amanha();
    await acaoNaConversa(6, "c1", 4, { acao: "enviar", texto: "Segue o boleto", proximaAcao: "Confirmar o pagamento", proximoContatoEm: quando.toISOString() });
    expect(fake.atualizarCasoDeCobranca).toHaveBeenCalledWith(6, 10, { proximaAcao: "Confirmar o pagamento", proximoContatoEm: quando }, 4);
  });
  it("responder com data no passado e recusado antes de enviar", async () => {
    emAtendimento();
    await expect(acaoNaConversa(6, "c1", 4, { acao: "enviar", texto: "Olá", proximoContatoEm: "2020-01-01T10:00:00.000Z" })).rejects.toMatchObject({ codigo: "DADOS_INVALIDOS" });
    expect(remoto.enviarTexto).not.toHaveBeenCalled();
    expect(fake.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });
  it("encerrar sem proxima acao e data e recusado ANTES de encerrar no Chat BullQ, como DADO invalido", async () => {
    emAtendimento();
    // Nao e conflito de estado (409): faltou o que o atendente tinha de escrever.
    await expect(acaoNaConversa(6, "c1", 4, { acao: "encerrar" })).rejects.toMatchObject({ codigo: "DADOS_INVALIDOS", message: MOTIVO_ENCERRAR_SEM_FOLLOW_UP });
    await expect(acaoNaConversa(6, "c1", 4, { acao: "encerrar", proximaAcao: "Ligar de novo" })).rejects.toMatchObject({ codigo: "DADOS_INVALIDOS" });
    await expect(acaoNaConversa(6, "c1", 4, { acao: "encerrar", proximoContatoEm: amanha().toISOString() })).rejects.toMatchObject({ codigo: "DADOS_INVALIDOS" });
    expect(remoto.desligarIa).not.toHaveBeenCalled();
    expect(remoto.encerrar).not.toHaveBeenCalled();
    expect(fake.atualizarConversaDoChat).not.toHaveBeenCalled();
    expect(fake.registrarEventoDoChat).not.toHaveBeenCalled();
  });
  it("o encerrar recusado nao deixa efeito gravado: o assistente so e bloqueado depois da validacao", async () => {
    emAtendimento();
    await expect(acaoNaConversa(6, "c1", 4, { acao: "encerrar" })).rejects.toMatchObject({ codigo: "DADOS_INVALIDOS" });
    expect(autonomia.cancelar).not.toHaveBeenCalled();
    // Com o follow-up escrito, a acao segue e o assistente e bloqueado antes do envio.
    await acaoNaConversa(6, "c1", 4, { acao: "encerrar", proximaAcao: "Cobrar a promessa", proximoContatoEm: amanha().toISOString() });
    expect(autonomia.cancelar).toHaveBeenCalledWith(6, "c1", expect.stringContaining("Operador assumiu"));
    expect(autonomia.cancelar.mock.invocationCallOrder[0]).toBeLessThan(remoto.encerrar.mock.invocationCallOrder[0]);
  });
  it("encerrar com o follow-up grava a acao e a data no caso, com o atendente como autor", async () => {
    emAtendimento();
    const quando = amanha();
    const r = await acaoNaConversa(6, "c1", 4, { acao: "encerrar", proximaAcao: "Cobrar a promessa", proximoContatoEm: quando.toISOString() });
    expect(remoto.encerrar).toHaveBeenCalledWith("org6", "c1");
    expect(fake.registrarEventoDoChat).toHaveBeenCalledWith(6, expect.objectContaining({ casoId: 10 }), 4, expect.stringContaining("encerrada"), { proximaAcao: "Cobrar a promessa", proximoContatoEm: quando });
    expect(fake.atualizarCasoDeCobranca).toHaveBeenCalledWith(6, 10, { proximaAcao: "Cobrar a promessa", proximoContatoEm: quando }, 4);
    expect(r).toEqual({ statusConversa: "CLOSED", followUp: { proximaAcao: "Cobrar a promessa", proximoContatoEm: quando } });
  });
  it.each(["pago", "cancelamento", "baixado", "encerrado"])("caso %s dispensa o follow-up ao encerrar: a conversa fecha e o caso nao e tocado", async (status) => {
    emAtendimento();
    fake.obterCasoDeCobranca.mockResolvedValue(casoAberto({ status }));
    const r = await acaoNaConversa(6, "c1", 4, { acao: "encerrar" });
    expect(remoto.encerrar).toHaveBeenCalledWith("org6", "c1");
    expect(fake.atualizarCasoDeCobranca).not.toHaveBeenCalled();
    expect(r).toEqual({ statusConversa: "CLOSED", followUp: null });
  });
  it("conversa so de recuperacao (sem caso de cobranca) nao tem onde gravar: encerra sem exigir", async () => {
    fake.getConversaDoChat.mockResolvedValue({ conversationId: "c1", providerId: 6, customerId: 42, casoId: null, recuperacaoId: 7, status: "OPEN" });
    await acaoNaConversa(6, "c1", 4, { acao: "encerrar" });
    expect(fake.obterCasoDeCobranca).not.toHaveBeenCalled();
    expect(fake.atualizarCasoDeCobranca).not.toHaveBeenCalled();
    expect(remoto.encerrar).toHaveBeenCalled();
  });
});
