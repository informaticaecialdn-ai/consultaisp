import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";

/**
 * As rotas do agente e o webhook de volta: sem chave e 401; com chave, o
 * providerId vem da chave (nunca do corpo); "nao encontrado" e falha do
 * sistema respondem 200 com instrucao (>= 400 vira alerta para a org inteira
 * no Chat BullQ); o webhook exige HMAC do corpo cru com o segredo do
 * provedor dono da organizacao.
 */

const servico = vi.hoisted(() => ({
  provedorDaChave: vi.fn(async (chave?: string | null): Promise<any> => (chave === "isp_ag_valida_1234567890" ? { providerId: 42, organizationId: "org_42" } : null)),
  casoParaAgente: vi.fn(async (): Promise<any> => ({ ok: true, encontrado: true, instrucao: "cobre com cordialidade" })),
  registrarPromessaDoAgente: vi.fn(async (): Promise<any> => ({ ok: true, mensagem: "registrada", promessaId: 900 })),
  registrarTransferenciaDoAgente: vi.fn(async (): Promise<any> => ({ ok: true, mensagem: "ok" })),
}));
vi.mock("../services/chat/chat-agente.service", () => servico);
const atendimento = vi.hoisted(() => ({ receberRespostaDoCliente: vi.fn(async () => undefined) }));
vi.mock("../services/chat/chat-atendimento.service", () => atendimento);
// `receberMensagemAutonoma` devolve `false` so com a autonomia DESLIGADA — e
// `true` tambem quando nao enfileira nada. Por isso a rota decide antes, lendo
// config + vinculo + estado: so vai para a fila o que a IA vai mesmo responder.
const autonomia = vi.hoisted(() => ({ receberMensagemAutonoma: vi.fn(async (): Promise<boolean> => true) }));
vi.mock("../services/chat/chat-autonomia.service", () => autonomia);
const autonomiaStorage = vi.hoisted(() => ({
  cancelar: vi.fn(async () => undefined),
  config: vi.fn(async (): Promise<any> => ({ ativa: false })),
  estado: vi.fn(async (): Promise<any> => ({ turnos: 0, humano: false, proposta: null, motivo: null })),
}));
vi.mock("../storage/chat-autonomia.storage", () => ({ autonomiaStorage }));
// A trava real abre conexao no pool; aqui ela so executa o callback.
vi.mock("../services/chat/chat-trava", () => ({ comTravaDoChat: async (_chave: string, executar: () => Promise<unknown>) => executar() }));
const armazem = vi.hoisted(() => ({
  getIntegracaoDoChatPorOrganizacao: vi.fn(async (org: string): Promise<any> => (org === "org_42" ? { providerId: 42, organizationId: "org_42", webhookSecret: "segredo-do-42" } : undefined)),
  getConversaDoChat: vi.fn(async (): Promise<any> => ({ id: 1, casoId: 10, conversationId: "conv_1", status: "WAITING" })),
  atualizarConversaDoChat: vi.fn(async (): Promise<any> => ({ id: 1, casoId: 10, conversationId: "conv_1", status: "PENDING" })),
  registrarEventoDeCobranca: vi.fn(async (_p: number, ev: any): Promise<any> => ({ id: 1, ...ev })),
  registrarEventoDoChat: vi.fn(async (_p: number, _v: unknown, _u: number | null, _texto: string) => undefined),
}));
vi.mock("../storage", () => ({ storage: armazem }));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { registerChatBullqAgenteRoutes } from "./chat-bullq-agente.routes";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  // Igual ao server/index.ts: o corpo cru fica em req.rawBody para o HMAC.
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use(registerChatBullqAgenteRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); });

const CHAVE = "isp_ag_valida_1234567890";
const pedir = (method: string, caminho: string, corpo?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${caminho}`, { method, headers: { ...(corpo === undefined ? {} : { "content-type": "application/json" }), ...headers }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

describe("as skills do agente", () => {
  it("modo primeiro contato impede registro autônomo de promessa", async () => {
    armazem.getIntegracaoDoChatPorOrganizacao.mockResolvedValueOnce({ providerId: 42, agenteConfig: { modoAtendimento: "primeira_resposta_humana" } });
    const res = await pedir("POST", "/api/chat-bullq/agente/promessa", { telefone: "43999990000", dataPrometida: "2026-09-10", valor: 100 }, { "x-chave-agente": CHAVE });
    expect(await res.json()).toMatchObject({ ok: false, mensagem: expect.stringContaining("atendente") });
    expect(servico.registrarPromessaDoAgente).not.toHaveBeenCalled();
  });
  it("sem chave ou com chave errada: 401, e o servico nao e chamado", async () => {
    expect((await pedir("GET", "/api/chat-bullq/agente/caso?telefone=43999990000")).status).toBe(401);
    expect((await pedir("GET", "/api/chat-bullq/agente/caso?telefone=43999990000", undefined, { "x-chave-agente": "isp_ag_errada_1234567890" })).status).toBe(401);
    expect(servico.casoParaAgente).not.toHaveBeenCalled();
  });
  it("consultar caso: o providerId vem da chave, o telefone da query", async () => {
    const res = await pedir("GET", "/api/chat-bullq/agente/caso?telefone=43999990000", undefined, { "x-chave-agente": CHAVE });
    expect(res.status).toBe(200);
    expect(servico.casoParaAgente).toHaveBeenCalledWith(42, "43999990000");
    expect(await res.json()).toMatchObject({ ok: true, encontrado: true });
  });
  it("falha do sistema nao vira >= 400: 200 com instrucao de nao citar valores", async () => {
    servico.casoParaAgente.mockRejectedValueOnce(new Error("banco fora"));
    const res = await pedir("GET", "/api/chat-bullq/agente/caso?telefone=43999990000", undefined, { "x-chave-agente": CHAVE });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.instrucao).toMatch(/Nao cite valores/);
  });
  it("promessa: valor com virgula vira numero; dados invalidos respondem 200 com ok=false", async () => {
    const res = await pedir("POST", "/api/chat-bullq/agente/promessa", { telefone: "43999990000", dataPrometida: "2026-09-20", valor: "149,90", observacao: "ok", conversaId: "conv_1" }, { "x-chave-agente": CHAVE });
    expect(res.status).toBe(200);
    expect(servico.registrarPromessaDoAgente).toHaveBeenCalledWith(42, { telefone: "43999990000", dataPrometida: "2026-09-20", valor: 149.9, observacao: "ok", conversaId: "conv_1" });
    const ruim = await pedir("POST", "/api/chat-bullq/agente/promessa", { telefone: "43999990000", dataPrometida: "20/09/2026" }, { "x-chave-agente": CHAVE });
    expect(ruim.status).toBe(200);
    expect((await ruim.json()).ok).toBe(false);
    expect(servico.registrarPromessaDoAgente).toHaveBeenCalledTimes(1);
  });
  it("transferencia: motivo e resumo vao ao servico", async () => {
    const res = await pedir("POST", "/api/chat-bullq/agente/transferencia", { telefone: "43999990000", motivo: "pediu atendente", resumo: "quer parcelar em 12x" }, { "x-chave-agente": CHAVE });
    expect(res.status).toBe(200);
    expect(servico.registrarTransferenciaDoAgente).toHaveBeenCalledWith(42, { telefone: "43999990000", motivo: "pediu atendente", resumo: "quer parcelar em 12x", conversaId: null });
  });
});

describe("o webhook de volta", () => {
  const corpo = { organizationId: "org_42", conversationId: "conv_1", contactId: "ct_1", trigger: { fromStatus: "BOT", toStatus: "PENDING" }, sentAt: "2026-09-05T20:00:00Z" };
  const assinar = (obj: unknown, segredo: string) => createHmac("sha256", segredo).update(JSON.stringify(obj), "utf8").digest("hex");
  const mensagemDoCliente = (messageId: string, extra: Record<string, unknown> = {}) => ({ ...corpo, trigger: { messageId, isFromCustomer: true, type: "TEXT", body: "posso pagar dia 10", ...extra } });
  const mandar = (evento: unknown) => pedir("POST", "/api/webhooks/chat-bullq", evento, { "x-signature-256": assinar(evento, "segredo-do-42") });

  it("primeira resposta de cliente, inclusive áudio, só transfere após verificar assinatura", async () => {
    const resposta = mensagemDoCliente("m2", { type: "AUDIO", body: null });
    expect((await pedir("POST", "/api/webhooks/chat-bullq", resposta)).status).toBe(401);
    expect(atendimento.receberRespostaDoCliente).not.toHaveBeenCalled();
    expect((await mandar(resposta)).status).toBe(200);
    // Autonomia desligada: comportamento de hoje — o fluxo humano legado atende.
    expect(atendimento.receberRespostaDoCliente).toHaveBeenCalledWith(42, "conv_1");
    expect(autonomia.receberMensagemAutonoma).not.toHaveBeenCalled();
  });
  it("com a autonomia ligada e a conversa no assistente, a mensagem vai para a fila autônoma e o fluxo humano legado não roda", async () => {
    autonomiaStorage.config.mockResolvedValueOnce({ ativa: true });
    expect((await mandar(mensagemDoCliente("m3"))).status).toBe(200);
    expect(autonomia.receberMensagemAutonoma).toHaveBeenCalledWith(42, "conv_1", "m3");
    expect(atendimento.receberRespostaDoCliente).not.toHaveBeenCalled();
  });
  /**
   * O defeito que esta rota tinha: `receberMensagemAutonoma` devolvia `true`
   * numa conversa CLOSED sem enfileirar nada, e o caminho humano — o unico que
   * reabre a conversa em PENDING — nao rodava. O cliente respondia e a
   * mensagem sumia.
   */
  it("conversa encerrada com a autonomia ligada: a mensagem volta para a fila humana, nunca para a autônoma", async () => {
    autonomiaStorage.config.mockResolvedValueOnce({ ativa: true });
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, casoId: 10, conversationId: "conv_1", status: "CLOSED" });
    expect((await mandar(mensagemDoCliente("m4"))).status).toBe(200);
    expect(atendimento.receberRespostaDoCliente).toHaveBeenCalledWith(42, "conv_1");
    expect(autonomia.receberMensagemAutonoma).not.toHaveBeenCalled();
  });
  it.each(["OPEN", "PENDING"])("conversa em %s com a autonomia ligada: quem responde é o atendente", async (status) => {
    autonomiaStorage.config.mockResolvedValueOnce({ ativa: true });
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, casoId: 10, conversationId: "conv_1", status });
    expect((await mandar(mensagemDoCliente("m5"))).status).toBe(200);
    expect(atendimento.receberRespostaDoCliente).toHaveBeenCalledWith(42, "conv_1");
    expect(autonomia.receberMensagemAutonoma).not.toHaveBeenCalled();
  });
  it("conversa já entregue ao humano: mesmo em WAITING a mensagem não volta para a fila autônoma", async () => {
    autonomiaStorage.config.mockResolvedValueOnce({ ativa: true });
    autonomiaStorage.estado.mockResolvedValueOnce({ turnos: 3, humano: true, proposta: null, motivo: "transferida" });
    expect((await mandar(mensagemDoCliente("m6"))).status).toBe(200);
    expect(atendimento.receberRespostaDoCliente).toHaveBeenCalledWith(42, "conv_1");
    expect(autonomia.receberMensagemAutonoma).not.toHaveBeenCalled();
  });
  it("estado da autonomia ilegível não deixa a mensagem sem ninguém: vai para o atendimento humano", async () => {
    autonomiaStorage.config.mockRejectedValueOnce(new Error("relation chat_autonomia_config does not exist"));
    expect((await mandar(mensagemDoCliente("m7"))).status).toBe(200);
    expect(atendimento.receberRespostaDoCliente).toHaveBeenCalledWith(42, "conv_1");
    expect(autonomia.receberMensagemAutonoma).not.toHaveBeenCalled();
  });
  it("conversa sem vínculo neste provedor: nada a atender, e o webhook não vira alerta na organização", async () => {
    armazem.getConversaDoChat.mockResolvedValueOnce(undefined);
    const res = await mandar(mensagemDoCliente("m8"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignorado: "conversa sem vinculo" });
    expect(atendimento.receberRespostaDoCliente).not.toHaveBeenCalled();
    expect(autonomia.receberMensagemAutonoma).not.toHaveBeenCalled();
  });
  it("atribuição à conta técnica não assume o atendimento humano", async () => {
    armazem.getIntegracaoDoChatPorOrganizacao.mockResolvedValueOnce({ providerId: 42, organizationId: "org_42", webhookSecret: "segredo-do-42", agenteConfig: { modoAtendimento: "primeira_resposta_humana" } });
    const evento = { ...corpo, trigger: { toAssigneeId: "owner_tecnico" } };
    await pedir("POST", "/api/webhooks/chat-bullq", evento, { "x-signature-256": assinar(evento, "segredo-do-42") });
    expect(armazem.atualizarConversaDoChat).not.toHaveBeenCalled();
  });

  it("organizacao desconhecida: 404; assinatura errada ou ausente: 401; nada gravado", async () => {
    expect((await pedir("POST", "/api/webhooks/chat-bullq", { ...corpo, organizationId: "org_x" }, { "x-signature-256": "abc" })).status).toBe(404);
    expect((await pedir("POST", "/api/webhooks/chat-bullq", corpo)).status).toBe(401);
    expect((await pedir("POST", "/api/webhooks/chat-bullq", corpo, { "x-signature-256": assinar(corpo, "outro-segredo") })).status).toBe(401);
    expect(armazem.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });
  it("assinatura certa: atualiza a conversa e grava na linha do tempo que a IA transferiu", async () => {
    const res = await pedir("POST", "/api/webhooks/chat-bullq", corpo, { "x-signature-256": assinar(corpo, "segredo-do-42") });
    expect(res.status).toBe(200);
    expect(armazem.atualizarConversaDoChat).toHaveBeenCalledWith(42, "conv_1", { status: "PENDING" });
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.objectContaining({ casoId: 10 }), null, "Chat: a IA transferiu a conversa ao atendente");
    // Transferida: a rodada autônoma pendente desta conversa é cancelada antes de qualquer resposta.
    expect(autonomiaStorage.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.any(String));
  });
  it("atendente assumiu: status OPEN e a nota certa; sem conversa, ignora", async () => {
    const assumiu = { ...corpo, trigger: { fromAssigneeId: null, toAssigneeId: "u_9", assignedToId: "u_9" } };
    await pedir("POST", "/api/webhooks/chat-bullq", assumiu, { "x-signature-256": assinar(assumiu, "segredo-do-42") });
    expect(armazem.atualizarConversaDoChat).toHaveBeenLastCalledWith(42, "conv_1", { status: "OPEN" });
    expect(armazem.registrarEventoDoChat.mock.calls.at(-1)![3]).toBe("Chat: um atendente assumiu a conversa");
    const semConversa = { organizationId: "org_42", trigger: { toStatus: "CLOSED" } };
    const res = await pedir("POST", "/api/webhooks/chat-bullq", semConversa, { "x-signature-256": assinar(semConversa, "segredo-do-42") });
    expect(await res.json()).toMatchObject({ ok: true, ignorado: "sem conversa" });
  });
  it("o segredo do webhook nunca aparece na resposta nem no log", async () => {
    await pedir("POST", "/api/webhooks/chat-bullq", corpo, { "x-signature-256": assinar(corpo, "segredo-do-42") });
    expect(JSON.stringify([...loggerMock.info.mock.calls, ...loggerMock.error.mock.calls])).not.toContain("segredo-do-42");
  });
});
