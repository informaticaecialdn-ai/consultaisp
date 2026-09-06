import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O motor controlado da autonomia, rodada a rodada: o LLM so escolhe a
 * intencao; texto, valor e data sao do servidor. Uma rodada normal responde
 * com o saldo do ERP (nunca o texto nem o link do modelo); uma promessa e
 * oferta + confirmacao explicita, gravada pelo valor integral; excecao na
 * mensagem transfere ao humano sem responder; o atendente devolve a conversa
 * ao assistente (humano=false) sob a mesma trava; e o laco so sobe se as
 * tabelas da 0028 existem.
 */
const armazem = vi.hoisted(() => ({
  getConversaDoChat: vi.fn(async (): Promise<any> => ({ id: 1, providerId: 42, customerId: 7, casoId: 10, recuperacaoId: null, conversationId: "conv_1", status: "BOT" })),
  getIntegracaoDoChat: vi.fn(async (): Promise<any> => ({ providerId: 42, organizationId: "org_42" })),
  obterCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 10, carteira: "ativo", status: "aberto" })),
  atualizarCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 10 })),
  getRecoveryCaseById: vi.fn(async (): Promise<any> => null),
  atualizarConversaDoChat: vi.fn(async (_p: number, _c: string, m: any): Promise<any> => ({ id: 1, providerId: 42, customerId: 7, casoId: 10, conversationId: "conv_1", status: m.status ?? "BOT" })),
  registrarEventoDoChat: vi.fn(async () => undefined),
}));
vi.mock("../../storage", () => ({ storage: armazem }));

const fila = vi.hoisted(() => ({
  config: vi.fn(async (): Promise<any> => ({ ativa: true, maxTurnos: 12, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos", "cobranca_ex_clientes", "recuperacao_equipamentos"] })),
  estado: vi.fn(async (): Promise<any> => ({ turnos: 0, humano: false, proposta: null, motivo: null })),
  enfileirar: vi.fn(async () => undefined),
  proximos: vi.fn(async (): Promise<any[]> => []),
  assumir: vi.fn(async () => true),
  marcar: vi.fn(async () => undefined),
  turno: vi.fn(async () => undefined),
  proposta: vi.fn(async () => undefined),
  cancelar: vi.fn(async () => undefined),
  devolver: vi.fn(async () => undefined),
  agendar: vi.fn(async () => true),
  resumo: vi.fn(async () => ({ pendente: 0, processando: 0, enviando: 0, concluido: 0, humano: 0, cancelado: 0 })),
  tabelasExistem: vi.fn(async (): Promise<any> => ({ ok: true, faltam: [] })),
  salvarConfig: vi.fn(async () => undefined),
}));
vi.mock("../../storage/chat-autonomia.storage", () => ({ autonomiaStorage: fila }));

const cliente = vi.hoisted(() => ({
  listarMensagens: vi.fn(async (): Promise<any> => ({ ok: true, valor: [] })),
  planejarAutonomia: vi.fn(async (): Promise<any> => ({ ok: true, valor: { acao: "responder", resposta: "informar_divida", texto: "pague R$999 em https://malicioso" } })),
  enviarTexto: vi.fn(async (): Promise<any> => ({ ok: true, valor: { messageId: "out_1", status: "SENT" } })),
  desligarIa: vi.fn(async (): Promise<any> => ({ ok: true, valor: undefined })),
  atribuir: vi.fn(async (): Promise<any> => ({ ok: true, valor: {} })),
}));
vi.mock("./chat-ponte.service", async () => {
  const real = await vi.importActual<typeof import("./chat-ponte.service")>("./chat-ponte.service");
  return { clienteDoChat: () => cliente, ErroDaPonteDoChat: real.ErroDaPonteDoChat };
});
vi.mock("./chat-trava", () => ({ comTravaDoChat: async (_chave: string, fn: () => Promise<unknown>) => fn() }));
const agentes = vi.hoisted(() => ({
  listarAgentesDoChat: vi.fn(async (): Promise<any> => ({ agentes: [
    { tipo: "cobranca_ativos", habilitado: true, etapa: "pronto", id: "ag_ativos", modelo: "openai/gpt-4o-mini" },
    { tipo: "cobranca_ex_clientes", habilitado: true, etapa: "pronto", id: "ag_ex", modelo: "openai/gpt-4o-mini" },
    { tipo: "recuperacao_equipamentos", habilitado: false, etapa: "configurado", id: null, modelo: null },
  ] })),
  modelosDosAgentesDoChat: vi.fn(async () => ({ configured: true, models: [{ id: "openai/gpt-4o-mini" }] })),
  comTravaDaConfiguracaoDoChat: async (_p: number, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("./chat-agentes.service", () => agentes);
const AO_VIVO = { status: "disponivel", financeiroAoVivo: true, valoresDe: "ao_vivo", lidoEm: "2026-09-06T15:00:00Z" };
const contexto = vi.hoisted(() => ({
  contextoDoAtendimento: vi.fn(async (): Promise<any> => ({ cliente: { divida: 150, diasAtraso: 20, telefone: "43999990000" }, erp: { status: "disponivel", financeiroAoVivo: true, valoresDe: "ao_vivo", lidoEm: "2026-09-06T15:00:00Z" }, faturas: [{ ref: "f1", valor: 150, vencimento: "2026-08-10" }] })),
  segundaViaDoAtendimento: vi.fn(async (): Promise<any> => ({ ref: "f1", valor: 150, vencimento: "2026-08-10", linhaDigitavel: null, pix: null, link: "https://erp.example/boleto/f1" })),
}));
vi.mock("./chat-contexto.service", () => contexto);
const agente = vi.hoisted(() => ({
  casoParaAgente: vi.fn(async (): Promise<any> => ({ ok: true, encontrado: true, caso: { id: 10, prescrita: false }, promessaAberta: false })),
  registrarPromessaDoAgente: vi.fn(async (): Promise<any> => ({ ok: true, mensagem: "registrada", promessaId: 900 })),
}));
vi.mock("./chat-agente.service", () => agente);
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../../logger", () => ({ logger: loggerMock }));

import { devolverAoAssistente, executarFilaAutonomia, iniciarAutonomia, pararAutonomia, receberMensagemAutonoma } from "./chat-autonomia.service";
import { ErroDaPonteDoChat } from "./chat-ponte.service";

const AGORA = new Date("2026-09-06T15:00:00Z");
const JOB = { id: 15, provider_id: 42, conversation_id: "conv_1", message_id: "m1", status: "pendente" };
const inbound = (id: string, text: string, createdAt = "2026-09-06T14:59:00Z") => ({ id, direction: "INBOUND", type: "TEXT", content: { text }, createdAt });
const outbound = (id: string, text: string, createdAt = "2026-09-06T14:00:00Z") => ({ id, direction: "OUTBOUND", type: "TEXT", content: { text }, createdAt });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
  fila.proximos.mockResolvedValue([JOB]);
});
afterEach(() => { vi.useRealTimers(); });

const textoEnviado = () => String(cliente.enviarTexto.mock.calls.at(-1)?.[2] ?? "");
const statusMarcados = () => fila.marcar.mock.calls.map(c => c[1]);

describe("uma rodada", () => {
  it("responde com o saldo do ERP, nunca com o texto ou o link do modelo; debita a rodada antes e marca enviando → concluido", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", "Olá"), inbound("m1", "quanto estou devendo?")] });
    await executarFilaAutonomia();
    expect(fila.assumir).toHaveBeenCalledWith(JOB);
    expect(fila.turno).toHaveBeenCalledWith(42, "conv_1");
    expect(cliente.planejarAutonomia).toHaveBeenCalledTimes(1);
    const [org, agenteId, pedido] = cliente.planejarAutonomia.mock.calls[0] as any[];
    expect(org).toBe("org_42"); expect(agenteId).toBe("ag_ativos");
    expect(pedido.allowedActions).toEqual(["responder", "transferir", "segunda_via", "promessa"]);
    expect(pedido.operation).toBe("cobranca");
    expect(textoEnviado()).toContain("150,00");
    expect(textoEnviado()).not.toContain("999");
    expect(textoEnviado()).not.toContain("malicioso");
    expect(statusMarcados()).toEqual(["enviando", "concluido"]);
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.objectContaining({ conversationId: "conv_1" }), null, expect.stringContaining("Assistente autônomo respondeu"));
    expect(fila.cancelar).not.toHaveBeenCalled();
  });
  it("mensagem sem texto (áudio) ou rodada estourada: transfere sem chamar o modelo", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [{ id: "m1", direction: "INBOUND", type: "AUDIO", content: {}, createdAt: "2026-09-06T14:59:00Z" }] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("leitura humana"));
    vi.clearAllMocks(); fila.proximos.mockResolvedValue([JOB]);
    fila.estado.mockResolvedValueOnce({ turnos: 12, humano: false, proposta: null, motivo: null });
    await executarFilaAutonomia();
    expect(cliente.listarMensagens).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", "Limite de rodadas atingido");
  });
  it("plano fora das permissões do provedor (agendar numa cobrança) transfere, não executa", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "posso devolver dia 10/9 às 14:00")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "agendar", data: "2026-09-10T14:00:00-03:00" } });
    await executarFilaAutonomia();
    expect(fila.agendar).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", "Plano fora das permissões do provedor");
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
  });
});

describe("proposta e confirmação", () => {
  it("promessa: primeiro a OFERTA pelo valor integral na data citada; depois o “sim” grava — sem chamar o modelo de novo", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "consigo pagar dia 10/9")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "promessa", data: "2026-09-10", valor: 150 } });
    await executarFilaAutonomia();
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: AGORA.toISOString(), messageId: "m1" };
    expect(fila.proposta).toHaveBeenCalledWith(42, "conv_1", proposta);
    // O Intl separa "R$" do valor com espaço inquebrável; o que importa é o valor integral e a data citada.
    expect(textoEnviado()).toMatch(/Você confirma a promessa de pagamento de R\$\s150,00 para 2026-09-10\?/);
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const JOB2 = { ...JOB, id: 16, message_id: "m2" };
    fila.proximos.mockResolvedValue([JOB2]);
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    vi.setSystemTime(new Date(AGORA.getTime() + 5 * 60_000));
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "consigo pagar dia 10/9"), inbound("m2", "sim", "2026-09-06T15:04:00Z")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(agente.registrarPromessaDoAgente).toHaveBeenCalledWith(42, expect.objectContaining({ telefone: "43999990000", dataPrometida: "2026-09-10", valor: 150, conversaId: "conv_1" }));
    expect(fila.proposta).toHaveBeenCalledWith(42, "conv_1", null);
    expect(textoEnviado()).toContain("Promessa de pagamento registrada para 2026-09-10");
    expect(statusMarcados()).toEqual(["enviando", "concluido"]);
  });
  it("modelo propõe desconto (valor menor que o saldo) ou data não citada: transfere, nada é gravado", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "consigo pagar dia 10/9")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "promessa", data: "2026-09-10", valor: 100 } });
    await executarFilaAutonomia();
    expect(fila.proposta).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("Data, valor ou horário não confirmados"));
  });
  /**
   * 21:30 em Brasília já é o dia seguinte em UTC. A oferta de datas usa o
   * calendário de São Paulo (`dataLocal`); a confirmação comparava com o dia em
   * UTC, então toda promessa feita para HOJE, à noite, era recusada como passada
   * e a conversa ia ao atendente sem motivo.
   */
  it("às 21:30 de Brasília, a promessa para HOJE ainda é hoje: grava", async () => {
    vi.setSystemTime(new Date("2026-09-10T00:30:00Z"));
    const proposta = { acao: "promessa", data: "2026-09-09", valor: 150, criadaEm: new Date("2026-09-10T00:25:00Z").toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim", "2026-09-10T00:29:00Z")] });
    await executarFilaAutonomia();
    expect(agente.registrarPromessaDoAgente).toHaveBeenCalledWith(42, expect.objectContaining({ dataPrometida: "2026-09-09", valor: 150 }));
    expect(textoEnviado()).toContain("Promessa de pagamento registrada para 2026-09-09");
    expect(fila.cancelar).not.toHaveBeenCalled();
  });
  it("a confirmação tardia (oferta com mais de 30 min) não grava: vira nova intenção e a oferta antiga cai", async () => {
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 31 * 60_000).toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim")] });
    await executarFilaAutonomia();
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();
    expect(fila.proposta).toHaveBeenCalledWith(42, "conv_1", null);
    expect(cliente.planejarAutonomia).toHaveBeenCalledTimes(1);
  });
});

describe("transferir em exceção", () => {
  it.each(["já paguei ontem", "quero falar com atendente", "vocês vão me negativar?", "vou no Procon"])("“%s”: bloqueia local, PENDING no chat, IA de lá desligada, sem resposta", async texto => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", texto)] });
    await executarFilaAutonomia();
    expect(fila.turno).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("exige conferência"));
    expect(armazem.atualizarConversaDoChat).toHaveBeenCalledWith(42, "conv_1", { status: "PENDING" });
    expect(cliente.desligarIa).toHaveBeenCalledWith("org_42", "conv_1");
    expect(cliente.atribuir).toHaveBeenCalledWith("org_42", "conv_1", { status: "PENDING" });
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.anything(), null, expect.stringContaining("transferiu ao atendente"));
  });
  it("ao transferir, o caso ganha o mesmo follow-up do caminho humano e volta à fila", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quero falar com atendente")] });
    const antes = Date.now();
    await executarFilaAutonomia();
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledTimes(1);
    const [providerId, casoId, patch, autor] = armazem.atualizarCasoDeCobranca.mock.calls[0] as any[];
    expect([providerId, casoId, autor]).toEqual([42, 10, null]);
    expect(patch).toMatchObject({ proximaAcao: "Responder no chat", responsavelUserId: null });
    expect(patch.proximoContatoEm.getTime()).toBeGreaterThanOrEqual(antes);
  });
  it("a conversa saiu do assistente antes da rodada: o trabalho é cancelado e o caso pede resposta no chat", async () => {
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: 10, conversationId: "conv_1", status: "PENDING" });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "cancelado", "Autonomia pausada ou atendimento humano");
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Responder no chat", responsavelUserId: null }), null);
  });
  it("caso já fechado (pago) não recebe follow-up; a transferência acontece igual", async () => {
    armazem.obterCasoDeCobranca.mockResolvedValue({ id: 10, carteira: "ativo", status: "pago" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quero falar com atendente")] });
    await executarFilaAutonomia();
    expect(armazem.atualizarCasoDeCobranca).not.toHaveBeenCalled();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
    armazem.obterCasoDeCobranca.mockResolvedValue({ id: 10, carteira: "ativo", status: "aberto" });
  });
  it("falha ao gravar o follow-up não impede a entrega ao atendente", async () => {
    armazem.atualizarCasoDeCobranca.mockRejectedValueOnce(new Error("banco fora"));
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quero falar com atendente")] });
    await executarFilaAutonomia();
    expect(armazem.atualizarConversaDoChat).toHaveBeenCalledWith(42, "conv_1", { status: "PENDING" });
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
    expect(loggerMock.warn).toHaveBeenCalled();
  });
  it("saldo não confirmado no ERP: transfere antes de gastar rodada", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    contexto.contextoDoAtendimento.mockResolvedValueOnce({ cliente: { divida: 150, diasAtraso: 20, telefone: "43999990000" }, erp: { status: "indisponivel", financeiroAoVivo: false, valoresDe: "base_sincronizada", lidoEm: null }, faturas: [] });
    await executarFilaAutonomia();
    expect(fila.turno).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("Saldo não confirmado no ERP"));
  });

  /**
   * O caso que motivou a guarda: o cliente PAGOU e o ERP passou a devolver zero
   * fatura. `status` continua "disponivel" — o que muda é `financeiroAoVivo`.
   * Sem a guarda, o saldo mostrado era o da varredura das 03:00 e a IA cobrava,
   * sozinha, por WhatsApp, quem já tinha pago.
   */
  it("cliente sem fatura ao vivo, base com R$ 150: a IA não fala o valor, não gasta rodada e vai ao atendente", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto estou devendo?")] });
    contexto.contextoDoAtendimento.mockResolvedValueOnce({
      cliente: { divida: 150, diasAtraso: 20, telefone: "43999990000" },
      erp: { status: "disponivel", financeiroAoVivo: false, valoresDe: "base_sincronizada", lidoEm: "2026-09-03T06:00:00.000Z", mensagem: "Faturas detalhadas não disponíveis no ERP. Valores financeiros da base sincronizada (varredura de 03/09/2026 03:00)." },
      faturas: [{ ref: "f1", valor: 150, vencimento: "2026-08-10" }],
    });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.turno).not.toHaveBeenCalled();
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();
    expect(fila.proposta).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("não fala valor que não leu"));
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
    // O 150 da varredura não sai em lugar nenhum: nem no texto, nem no pedido ao modelo.
    expect(JSON.stringify(cliente.enviarTexto.mock.calls)).not.toContain("150");
    expect(JSON.stringify(cliente.planejarAutonomia.mock.calls)).not.toContain("150");
  });

  it("a confirmação de uma promessa não grava se, na hora do “sim”, o valor não veio da leitura ao vivo", async () => {
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 5 * 60_000).toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    contexto.contextoDoAtendimento.mockResolvedValueOnce({
      cliente: { divida: 150, diasAtraso: 20, telefone: "43999990000" },
      erp: { status: "disponivel", financeiroAoVivo: false, valoresDe: "base_sincronizada", lidoEm: "2026-09-03T06:00:00.000Z" },
      faturas: [],
    });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim")] });
    await executarFilaAutonomia();
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("não fala valor que não leu"));
  });
  it("trabalho interrompido (não pendente) nunca é reenviado: vai ao humano com o aviso de conferir histórico", async () => {
    fila.proximos.mockResolvedValue([{ ...JOB, status: "enviando" }]);
    await executarFilaAutonomia();
    expect(fila.assumir).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("conferir histórico antes de qualquer reenvio"));
  });
});

describe("devolver ao assistente", () => {
  it("humano=false: o chat vai a BOT primeiro, a IA de lá fica desligada, o estado volta e a linha do tempo registra quem devolveu", async () => {
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: 10, conversationId: "conv_1", status: "OPEN" });
    const r = await devolverAoAssistente(42, "conv_1", 8);
    expect(r).toEqual({ conversationId: "conv_1", status: "BOT", humano: false });
    expect(cliente.desligarIa).toHaveBeenCalledWith("org_42", "conv_1");
    expect(cliente.atribuir).toHaveBeenCalledWith("org_42", "conv_1", { status: "BOT" });
    expect(fila.devolver).toHaveBeenCalledWith(42, "conv_1", expect.any(String));
    expect(armazem.atualizarConversaDoChat).toHaveBeenCalledWith(42, "conv_1", { status: "BOT" });
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.objectContaining({ conversationId: "conv_1" }), 8, expect.stringContaining("devolveu a conversa ao assistente"));
  });
  it("conversa de outro provedor: 404 da ponte; encerrada ou autonomia desligada: conflito; nada muda", async () => {
    armazem.getConversaDoChat.mockResolvedValueOnce(undefined);
    await expect(devolverAoAssistente(42, "conv_x", 8)).rejects.toMatchObject({ codigo: "CASO_NAO_ENCONTRADO" });
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: 10, conversationId: "conv_1", status: "CLOSED" });
    await expect(devolverAoAssistente(42, "conv_1", 8)).rejects.toBeInstanceOf(ErroDaPonteDoChat);
    fila.config.mockResolvedValueOnce({ ativa: false, maxTurnos: 12, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] });
    await expect(devolverAoAssistente(42, "conv_1", 8)).rejects.toMatchObject({ codigo: "CONFLITO", message: expect.stringContaining("Ative a autonomia") });
    expect(fila.devolver).not.toHaveBeenCalled();
    expect(cliente.atribuir).not.toHaveBeenCalled();
  });
  it("se o Chat BullQ não confirmar o BOT, o humano continua dono: o estado local não muda", async () => {
    cliente.atribuir.mockResolvedValueOnce({ ok: false, erro: "fora do ar" });
    await expect(devolverAoAssistente(42, "conv_1", 8)).rejects.toThrow();
    expect(fila.devolver).not.toHaveBeenCalled();
    expect(armazem.atualizarConversaDoChat).not.toHaveBeenCalled();
  });
});

describe("a chegada da mensagem e o laço", () => {
  it("receber: autonomia desligada devolve false (fluxo humano); ligada e conversa em BOT enfileira; humano no comando não enfileira", async () => {
    fila.config.mockResolvedValueOnce({ ativa: false });
    expect(await receberMensagemAutonoma(42, "conv_1", "m1")).toBe(false);
    expect(fila.enfileirar).not.toHaveBeenCalled();
    expect(await receberMensagemAutonoma(42, "conv_1", "m1")).toBe(true);
    expect(fila.enfileirar).toHaveBeenCalledWith(42, "conv_1", "m1");
    fila.estado.mockResolvedValueOnce({ turnos: 2, humano: true, proposta: null, motivo: "Operador assumiu" });
    expect(await receberMensagemAutonoma(42, "conv_1", "m2")).toBe(true);
    expect(fila.enfileirar).toHaveBeenCalledTimes(1);
  });
  it("mensagem que o assistente não vai responder deixa o caso pedindo resposta, como no fluxo humano", async () => {
    // Conversa já com o humano: o dono continua sendo quem assumiu.
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: 10, conversationId: "conv_1", status: "OPEN" });
    expect(await receberMensagemAutonoma(42, "conv_1", "m1")).toBe(true);
    expect(fila.enfileirar).not.toHaveBeenCalled();
    let patch = armazem.atualizarCasoDeCobranca.mock.calls[0][2] as any;
    expect(patch).toMatchObject({ proximaAcao: "Responder no chat" });
    expect(patch).not.toHaveProperty("responsavelUserId");

    // Autonomia bloqueada (humano assumiu antes): o caso volta à fila sem dono.
    armazem.atualizarCasoDeCobranca.mockClear();
    fila.estado.mockResolvedValueOnce({ turnos: 2, humano: true, proposta: null, motivo: "Operador assumiu" });
    expect(await receberMensagemAutonoma(42, "conv_1", "m2")).toBe(true);
    patch = armazem.atualizarCasoDeCobranca.mock.calls[0][2] as any;
    expect(patch).toMatchObject({ proximaAcao: "Responder no chat", responsavelUserId: null });

    // Enfileirada para o assistente responder: nada a pedir ainda.
    armazem.atualizarCasoDeCobranca.mockClear();
    expect(await receberMensagemAutonoma(42, "conv_1", "m3")).toBe(true);
    expect(fila.enfileirar).toHaveBeenCalledWith(42, "conv_1", "m3");
    expect(armazem.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });
  it("iniciar: sem as tabelas da 0028, um aviso só e o laço não sobe; com elas, sobe e para", async () => {
    fila.tabelasExistem.mockResolvedValueOnce({ ok: false, faltam: ["chat_autonomia_fila"] });
    expect(await iniciarAutonomia()).toBe(false);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn.mock.calls[0][0]).toEqual({ faltam: ["chat_autonomia_fila"] });
    fila.tabelasExistem.mockRejectedValueOnce(new Error("banco fora"));
    expect(await iniciarAutonomia()).toBe(false);
    expect(loggerMock.warn).toHaveBeenCalledTimes(2);
    expect(await iniciarAutonomia()).toBe(true);
    await pararAutonomia();
  });
});
