/**
 * A porta da funcionária para o fork, com o ORÇAMENTO DE VERDADE
 * (`comOrcamentoContato` sobre um banco de mentira): o que se prova é o que o
 * provedor vê no diário de contatos.
 *
 * - Um turno reserva UMA vez, quantos balões tiver.
 * - Chave ligada: sai pelo lote do agente. 404, ou 400 de agente não
 *   controlado: sai pelo envio comum, os balões juntos numa mensagem só. 400
 *   que recusa o texto (meta-talk) não sai. Qualquer falha ambígua não cai no
 *   envio comum — seria reenviar — e sai SEM status numérico: o orçamento grava
 *   `incerto`, que conta no dia.
 * - Chave desligada: `enviarTexto`, como hoje; o lote nunca é chamado.
 * - Planejador: 400 no pedido com escrita repete UMA vez sem ela; balões fora
 *   do contrato são descartados e o plano segue; decisão malformada recusa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  linha: { disputa: false, optout: false, pausado: false, promessa: false, hoje: 0, semana: 0 } as Record<string, unknown>,
  reservas: 0,
  statusGravado: [] as string[],
}));
vi.mock("../../db", () => {
  const consulta = async (sql: string, params: unknown[] = []) => {
    if (/SELECT config FROM cobranca_gestao_config/.test(sql)) return { rows: [] };
    if (/INSERT INTO cobranca_contatos_orcamento/.test(sql)) { banco.reservas += 1; return { rows: [{ id: banco.reservas }] }; }
    if (/UPDATE cobranca_contatos_orcamento SET status='incerto'/.test(sql)) { banco.statusGravado.push("incerto"); return { rows: [] }; }
    if (/UPDATE cobranca_contatos_orcamento SET status=\$3/.test(sql)) { banco.statusGravado.push(String(params[2])); return { rows: [] }; }
    if (/FROM customers c LEFT JOIN cobranca_preferencias_contato/.test(sql)) return { rows: [banco.linha] };
    return { rows: [] };
  };
  return { pool: { query: consulta, connect: async () => ({ query: consulta, release: () => undefined }) }, db: {} };
});
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../../logger", () => ({ logger: loggerMock }));

import { enviarBaloesDaFuncionaria, planejarDaFuncionaria, requestIdSemEscrita, type EnvioDaFuncionaria } from "./chat-envio-funcionaria";
import { ErroGestao } from "../cobranca/gestao-operacional.service";

const cliente = {
  enviarComoAgente: vi.fn(),
  enviarTexto: vi.fn(),
  planejarAutonomia: vi.fn(),
};
const BALOES = ["Oi, Maria! Aqui é a Clara, da NsLink 😊", "Vi aqui a sua conta de agosto, tá em aberto."];
const envio = (extra: Partial<EnvioDaFuncionaria> = {}): EnvioDaFuncionaria => ({
  cliente, providerId: 42, customerId: 7, organizationId: "org_42", conversationId: "conv_1",
  baloes: BALOES, funcionariaDigitalAtiva: true, aiAgentId: "ag_ativos", ...extra,
});
const lote = { ok: true, valor: { loteId: "lote-1", mensagens: [{ messageId: "m1", status: "QUEUED" }, { messageId: "m2", status: "QUEUED" }] } };
const texto = { ok: true, valor: { messageId: "t1", status: "QUEUED" } };

beforeEach(() => {
  vi.clearAllMocks();
  banco.linha = { disputa: false, optout: false, pausado: false, promessa: false, hoje: 0, semana: 0 };
  banco.reservas = 0;
  banco.statusGravado = [];
});

describe("envio dos balões de um turno", () => {
  it("chave ligada: um lote do agente, com os balões na ordem, e UMA reserva de orçamento", async () => {
    cliente.enviarComoAgente.mockResolvedValue(lote);
    const r = await enviarBaloesDaFuncionaria(envio());
    expect(r).toEqual({ ok: true, valor: { via: "agente", degradado: false, mensagens: lote.valor.mensagens } });
    expect(cliente.enviarComoAgente).toHaveBeenCalledOnce();
    expect(cliente.enviarComoAgente).toHaveBeenCalledWith("org_42", "conv_1", "ag_ativos", BALOES);
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(banco.reservas).toBe(1);
    expect(banco.statusGravado).toEqual(["enviado"]);
  });

  it("chave desligada: enviarTexto como hoje, balões juntos numa mensagem só; o lote nunca é chamado", async () => {
    cliente.enviarTexto.mockResolvedValue(texto);
    const r = await enviarBaloesDaFuncionaria(envio({ funcionariaDigitalAtiva: false }));
    expect(r).toEqual({ ok: true, valor: { via: "texto", degradado: false, mensagens: [{ messageId: "t1", status: "QUEUED" }] } });
    expect(cliente.enviarComoAgente).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).toHaveBeenCalledWith("org_42", "conv_1", BALOES.join("\n\n"));
    expect(banco.reservas).toBe(1);
  });

  it("chave ligada sem o agente do perfil: sai pelo envio comum, sem tentar o lote", async () => {
    cliente.enviarTexto.mockResolvedValue(texto);
    expect((await enviarBaloesDaFuncionaria(envio({ aiAgentId: null }))).ok).toBe(true);
    expect(cliente.enviarComoAgente).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 404, erro: "Cannot POST /messages/agent-batch" },
    { status: 404, erro: "Agente não encontrado nesta organização" },
    { status: 400, erro: "Configure um agente de autonomia controlada sem resposta direta nos canais" },
  ])("lote recusado pelo AGENTE ($status: $erro): nada foi enfileirado, os balões saem pelo enviarTexto juntos — e a reserva continua sendo UMA", async ({ status, erro }) => {
    cliente.enviarComoAgente.mockResolvedValue({ ok: false, erro, status });
    cliente.enviarTexto.mockResolvedValue(texto);
    const r = await enviarBaloesDaFuncionaria(envio());
    expect(r).toEqual({ ok: true, valor: { via: "texto", degradado: true, mensagens: [{ messageId: "t1", status: "QUEUED" }] } });
    expect(cliente.enviarTexto).toHaveBeenCalledWith("org_42", "conv_1", "Oi, Maria! Aqui é a Clara, da NsLink 😊\n\nVi aqui a sua conta de agosto, tá em aberto.");
    expect(banco.reservas).toBe(1);
    expect(banco.statusGravado).toEqual(["enviado"]);
  });

  it("falha ambígua do lote (timeout, 5xx, 408, aceito sem confirmação): incerto, SEM status numérico, sem reenvio pelo envio comum", async () => {
    for (const falha of [
      { ok: false, erro: "O Chat BullQ não respondeu em 15s" },
      { ok: false, erro: "Fila de envio indisponível", status: 503 },
      { ok: false, erro: "Request Timeout", status: 408 },
      { ok: false, erro: "O Chat BullQ não confirmou o lote de mensagens" },
    ]) {
      vi.clearAllMocks(); banco.statusGravado = [];
      cliente.enviarComoAgente.mockResolvedValue(falha);
      const r = await enviarBaloesDaFuncionaria(envio());
      expect(r, JSON.stringify(falha)).toEqual({ ok: false, erro: falha.erro, envio: "incerto" });
      expect(r).not.toHaveProperty("status");
      expect(cliente.enviarTexto).not.toHaveBeenCalled();
      expect(banco.statusGravado).toEqual(["incerto"]);
    }
  });

  it.each([
    "Mensagem recusada: descreve raciocínio interno da IA em vez de responder ao cliente.",
    "Envie de 1 a 4 mensagens de texto, cada uma com até 4000 caracteres.",
    "textos must contain no more than 4 elements",
  ])("400 que recusa o TEXTO (%s): nao_saiu — o mesmo texto não sai pelo envio comum, sem a checagem e assinado pelo dono", async erro => {
    cliente.enviarComoAgente.mockResolvedValue({ ok: false, erro, status: 400 });
    expect(await enviarBaloesDaFuncionaria(envio())).toEqual({ ok: false, erro, envio: "nao_saiu", status: 400 });
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(banco.reservas).toBe(1);
    expect(banco.statusGravado).toEqual(["falhou"]);
  });

  it("409 (conversa com um atendente): nada saiu e nada é tentado por fora; o orçamento grava falhou", async () => {
    cliente.enviarComoAgente.mockResolvedValue({ ok: false, erro: "A conversa está com um atendente", status: 409 });
    expect(await enviarBaloesDaFuncionaria(envio())).toEqual({ ok: false, erro: "A conversa está com um atendente", envio: "nao_saiu", status: 409 });
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(banco.statusGravado).toEqual(["falhou"]);
  });

  it("depois do 404 do lote, o envio comum decide: recusa 4xx é nao_saiu; timeout é incerto sem status", async () => {
    cliente.enviarComoAgente.mockResolvedValue({ ok: false, erro: "não existe", status: 404 });
    cliente.enviarTexto.mockResolvedValueOnce({ ok: false, erro: "Conversa encerrada", status: 422 });
    expect(await enviarBaloesDaFuncionaria(envio())).toEqual({ ok: false, erro: "Conversa encerrada", envio: "nao_saiu", status: 422 });
    expect(banco.statusGravado).toEqual(["falhou"]);
    banco.statusGravado = [];
    cliente.enviarTexto.mockResolvedValueOnce({ ok: false, erro: "Não foi possível falar com o Chat BullQ" });
    expect(await enviarBaloesDaFuncionaria(envio())).toEqual({ ok: false, erro: "Não foi possível falar com o Chat BullQ", envio: "incerto" });
    expect(banco.statusGravado).toEqual(["incerto"]);
    expect(banco.reservas).toBe(2);
  });

  it("chave desligada e enviarTexto ambíguo: incerto sem status; nada é repetido", async () => {
    cliente.enviarTexto.mockResolvedValue({ ok: false, erro: "Bad Gateway", status: 502 });
    expect(await enviarBaloesDaFuncionaria(envio({ funcionariaDigitalAtiva: false }))).toEqual({ ok: false, erro: "Bad Gateway", envio: "incerto" });
    expect(cliente.enviarTexto).toHaveBeenCalledOnce();
    expect(banco.statusGravado).toEqual(["incerto"]);
  });

  it("orçamento bloqueado (pedido para não contatar, contestação, cota): ErroGestao antes de qualquer envio", async () => {
    banco.linha = { ...banco.linha, optout: true };
    await expect(enviarBaloesDaFuncionaria(envio())).rejects.toBeInstanceOf(ErroGestao);
    banco.linha = { ...banco.linha, optout: false, hoje: 20 };
    await expect(enviarBaloesDaFuncionaria(envio())).rejects.toThrow(/Orçamento diário/);
    expect(cliente.enviarComoAgente).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(banco.reservas).toBe(0);
  });

  it("balões vazios não são contato: nem reserva nem fork; acima de 4, o excedente vai junto no último — nunca dois lotes", async () => {
    expect(await enviarBaloesDaFuncionaria(envio({ baloes: ["  ", ""] }))).toEqual({ ok: false, erro: "Nenhuma mensagem para enviar", envio: "nao_saiu" });
    expect(banco.reservas).toBe(0);
    cliente.enviarComoAgente.mockResolvedValue({ ok: true, valor: { loteId: "l", mensagens: [] } });
    await enviarBaloesDaFuncionaria(envio({ baloes: [" a ", "b", "", "c", "d", "e"] }));
    expect(cliente.enviarComoAgente).toHaveBeenCalledOnce();
    expect(cliente.enviarComoAgente.mock.calls[0][3]).toEqual(["a", "b", "c", "d\n\ne"]);
  });

  it("o log do envio tem tempo, via e desfecho — nunca o texto dos balões", async () => {
    cliente.enviarComoAgente.mockResolvedValue({ ok: false, erro: "não existe", status: 404 });
    cliente.enviarTexto.mockResolvedValue(texto);
    await enviarBaloesDaFuncionaria(envio());
    const info = loggerMock.info.mock.calls.find(c => c[1] === "Autonomia: envio da rodada")?.[0];
    expect(info).toMatchObject({ providerId: 42, etapa: "envio", baloes: 2, via: "texto", degradado: true, envio: "aceito" });
    expect(typeof info.ms).toBe("number");
    const linhas = [loggerMock.info, loggerMock.warn].flatMap(f => f.mock.calls).map(a => JSON.stringify(a));
    for (const l of linhas) { expect(l).not.toContain("Maria"); expect(l).not.toContain("conta de agosto"); }
  });
});

describe("planejador com escrita", () => {
  const PEDIDO = { requestId: "r1", operation: "cobranca" as const, context: "{}", history: [], allowedActions: ["responder" as const, "transferir" as const] };

  it("com escrita aceita: o plano vem com os balões e escreveu=true", async () => {
    cliente.planejarAutonomia.mockResolvedValue({ ok: true, valor: { acao: "responder", resposta: "acolher", mensagens: ["Oi, Maria!"] } });
    expect(await planejarDaFuncionaria(cliente, 42, "org_42", "ag_1", { ...PEDIDO, escrever: true }))
      .toEqual({ ok: true, valor: { plano: { acao: "responder", resposta: "acolher", mensagens: ["Oi, Maria!"] }, escreveu: true, degradado: false } });
    expect(cliente.planejarAutonomia).toHaveBeenCalledOnce();
  });

  it("fork no 008 (400 no pedido com escrita): repete UMA vez sem escrever e o plano volta como do modo antigo", async () => {
    cliente.planejarAutonomia
      .mockResolvedValueOnce({ ok: false, erro: "Contexto do planejamento inválido", status: 400 })
      .mockResolvedValueOnce({ ok: true, valor: { acao: "promessa", data: "2026-09-20", valor: 150 } });
    const r = await planejarDaFuncionaria(cliente, 42, "org_42", "ag_1", { ...PEDIDO, escrever: true });
    expect(r).toEqual({ ok: true, valor: { plano: { acao: "promessa", data: "2026-09-20", valor: 150 }, escreveu: false, degradado: true } });
    expect(cliente.planejarAutonomia).toHaveBeenCalledTimes(2);
    expect(cliente.planejarAutonomia.mock.calls[1][2]).toEqual({ ...PEDIDO, requestId: "r1_sem_escrita" });
    expect(cliente.planejarAutonomia.mock.calls[1][2]).not.toHaveProperty("escrever");
  });

  it("a repetição usa OUTRO requestId: com o 400 nascido depois do registro do pedido, o fork devolve o erro real, não 409", async () => {
    // O fork de verdade (vps/003): o pedido fica registrado pelo requestId antes do modelo; mesmo id com outro conteúdo é 409.
    const registrados = new Map<string, string>();
    cliente.planejarAutonomia.mockImplementation(async (_org: string, _agente: string, pedido: any) => {
      const conteudo = JSON.stringify({ ...pedido, requestId: undefined });
      const anterior = registrados.get(pedido.requestId);
      if (anterior !== undefined && anterior !== conteudo) return { ok: false, erro: "requestId reutilizado com conteúdo diferente", status: 409 };
      registrados.set(pedido.requestId, conteudo);
      return { ok: false, erro: "Modelo do agente não disponível na credencial atual", status: 400 };
    });
    expect(await planejarDaFuncionaria(cliente, 42, "org_42", "ag_1", { ...PEDIDO, escrever: true }))
      .toEqual({ ok: false, erro: "Modelo do agente não disponível na credencial atual", status: 400 });
    expect(cliente.planejarAutonomia).toHaveBeenCalledTimes(2);
  });

  it("requestId derivado cabe no teto do fork (120, [a-zA-Z0-9_:-]) mesmo com id longo", () => {
    const longo = `autonomia_123456789_${"a".repeat(200)}`;
    const derivado = requestIdSemEscrita(longo);
    expect(derivado.length).toBeLessThanOrEqual(120);
    expect(derivado).toMatch(/^[a-zA-Z0-9_:-]+$/);
    expect(derivado.endsWith("_sem_escrita")).toBe(true);
    expect(derivado).not.toBe(requestIdSemEscrita(`autonomia_987654321_${"a".repeat(200)}`));
    expect(requestIdSemEscrita("autonomia_7_0f8e")).toBe("autonomia_7_0f8e_sem_escrita");
  });

  it("400 sem escrita pedida, ou outra falha com escrita: não repete — quem chama transfere", async () => {
    cliente.planejarAutonomia.mockResolvedValue({ ok: false, erro: "Instruções do agente acima do limite", status: 400 });
    expect((await planejarDaFuncionaria(cliente, 42, "org_42", "ag_1", PEDIDO)).ok).toBe(false);
    expect(cliente.planejarAutonomia).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    cliente.planejarAutonomia.mockResolvedValue({ ok: false, erro: "Planejador ocupado", status: 503 });
    expect(await planejarDaFuncionaria(cliente, 42, "org_42", "ag_1", { ...PEDIDO, escrever: true })).toEqual({ ok: false, erro: "Planejador ocupado", status: 503 });
    expect(cliente.planejarAutonomia).toHaveBeenCalledOnce();
  });

  it("repetição degradada também recusada: devolve a falha dela", async () => {
    cliente.planejarAutonomia.mockResolvedValue({ ok: false, erro: "Instruções do agente acima do limite", status: 400 });
    expect(await planejarDaFuncionaria(cliente, 42, "org_42", "ag_1", { ...PEDIDO, escrever: true })).toEqual({ ok: false, erro: "Instruções do agente acima do limite", status: 400 });
    expect(cliente.planejarAutonomia).toHaveBeenCalledTimes(2);
  });

  it("balões sem escrita pedida são ignorados; com escrita, fora do contrato são descartados e o plano segue", async () => {
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "responder", resposta: "acolher", mensagens: ["Oi"] } });
    expect(await planejarDaFuncionaria(cliente, 42, "org_42", "ag_1", PEDIDO)).toEqual({ ok: true, valor: { plano: { acao: "responder", resposta: "acolher" }, escreveu: false, degradado: false } });
    for (const mensagens of [["a", "b", "c", "d"], ["x".repeat(601)], [], "Oi", [""]]) {
      cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "promessa", data: "2026-09-20", valor: 150, mensagens } });
      const r = await planejarDaFuncionaria(cliente, 42, "org_42", "ag_1", { ...PEDIDO, escrever: true });
      expect(r, JSON.stringify(mensagens)).toEqual({ ok: true, valor: { plano: { acao: "promessa", data: "2026-09-20", valor: 150 }, escreveu: true, degradado: false } });
    }
    expect(loggerMock.warn.mock.calls.some(c => c[0]?.codigo === "mensagens_fora_do_contrato")).toBe(true);
  });

  it("decisão malformada recusa o plano, sem status — quem chama transfere", async () => {
    for (const valor of [{ acao: "negativar" }, { acao: "promessa", valor: -1 }, { acao: "responder", url: "https://x" }, null, "responder"]) {
      cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor });
      expect(await planejarDaFuncionaria(cliente, 42, "org_42", "ag_1", { ...PEDIDO, escrever: true }), JSON.stringify(valor))
        .toEqual({ ok: false, erro: "O planejador devolveu um plano fora do contrato" });
    }
  });

  it("o log do planejador tem tempo, ação e contagem de balões — nunca o texto", async () => {
    cliente.planejarAutonomia.mockResolvedValue({ ok: true, valor: { acao: "responder", resposta: "acolher", mensagens: ["Oi, Maria! Sua conta venceu."] } });
    await planejarDaFuncionaria(cliente, 42, "org_42", "ag_1", { ...PEDIDO, escrever: true });
    const info = loggerMock.info.mock.calls.find(c => c[1] === "Autonomia: plano recebido")?.[0];
    expect(info).toMatchObject({ providerId: 42, etapa: "planejador", acao: "responder", escreveu: true, baloes: 1 });
    for (const l of [loggerMock.info, loggerMock.warn].flatMap(f => f.mock.calls).map(a => JSON.stringify(a))) expect(l).not.toContain("Maria");
  });
});
