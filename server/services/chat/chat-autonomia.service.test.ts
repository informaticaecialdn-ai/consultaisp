vi.mock("../cobranca/gestao-operacional.service", () => ({
  ErroGestao: class ErroGestao extends Error {},
  comOrcamentoContato: vi.fn(async (_pid: number, _cid: number, _canal: string, _automatico: boolean, enviar: () => Promise<unknown>) => enviar()),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O motor controlado da autonomia, rodada a rodada (spec 2026-09-16, §3, §9 e §10). Antes da identidade o texto é do
 * servidor; depois, com a chave D9 desligada, a reserva humanizada escreve — e, ligada, a funcionária escreve e o
 * verificador confere. A AÇÃO (promessa, segunda via, acordo, transferência) nunca depende do texto. A transferência
 * avisa o cliente por frase fixa — menos nos motivos da tabela do §3.4 (achado e16).
 */
const armazem = vi.hoisted(() => ({
  getUser: vi.fn(async () => ({ id: 8, providerId: 42, role: "admin" })),
  getPoliticaDeCobranca: vi.fn(),
  getProvider: vi.fn(async (): Promise<any> => ({ id: 42, name: "NsLink Telecom LTDA", tradeName: "NsLink", website: "https://nslink.com.br/cliente/financeiro", contactPhone: "(43) 3333-4444" })),
  clienteDoAtendimento: vi.fn(async () => ({ id: 7, nome: "Maria de Souza", documento: "12345678909", telefone: "43999990000" })),
  getConversaDoChat: vi.fn(async (): Promise<any> => ({ id: 1, providerId: 42, customerId: 7, casoId: 10, recuperacaoId: null, conversationId: "conv_1", status: "BOT" })),
  getIntegracaoDoChat: vi.fn(async (): Promise<any> => ({ providerId: 42, organizationId: "org_42" })),
  obterCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 10, cliente: { id: 7 }, carteira: "ativo", status: "aberto" })),
  atualizarCasoDeCobranca: vi.fn(async (_p?: number, _id?: number, _patch?: any, _autor?: unknown): Promise<any> => ({ id: 10 })),
  listarEventosDoCaso: vi.fn(async (): Promise<any[]> => [{ tipo: "promessa", metadata: { dataPrometida: "2026-08-20" } }, { tipo: "contato", metadata: {} }]),
  getRecoveryCaseById: vi.fn(async (): Promise<any> => null),
  atualizarConversaDoChat: vi.fn(async (_p: number, _c: string, m: any): Promise<any> => ({ id: 1, providerId: 42, customerId: 7, casoId: 10, conversationId: "conv_1", status: m.status ?? "BOT" })),
  registrarEventoDoChat: vi.fn(async (_p?: number, _v?: unknown, _u?: unknown, _notas?: string, _followUp?: unknown) => undefined),
  criarNegociacao: vi.fn(async (_p?: number, _dados?: unknown, _parcelas?: unknown): Promise<any> => ({ id: 1 })),
  addRecoveryAttempt: vi.fn(async (_entrada?: unknown): Promise<any> => ({ id: 1 })),
}));
vi.mock("../../storage", () => ({ storage: armazem }));
const faturas = vi.hoisted(() => ({ faturasQuitadasAindaAbertas: vi.fn(async () => false) }));
vi.mock("../../storage/faturas.storage", () => ({ FaturasStorage: class { faturasQuitadasAindaAbertas = faturas.faturasQuitadasAindaAbertas; } }));
const preferencias = vi.hoisted(() => ({ pausarComunicacao: vi.fn(async (_p?: number, _c?: number, _u?: number | null, _acao?: string) => true) }));
vi.mock("../../storage/cobranca-comunicacao.storage", () => preferencias);

const fila = vi.hoisted(() => ({
  config: vi.fn(async (): Promise<any> => ({ ativa: true, maxTurnos: 12, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos", "cobranca_ex_clientes", "recuperacao_equipamentos"] })),
  estado: vi.fn(async (): Promise<any> => ({ turnos: 0, humano: false, proposta: null, motivo: null })),
  enfileirar: vi.fn(async () => undefined),
  proximos: vi.fn(async (): Promise<any[]> => []),
  assumir: vi.fn(async () => true),
  marcar: vi.fn(async (_job?: unknown, _status?: string, _motivo?: string | null) => undefined),
  turno: vi.fn(async () => undefined),
  proposta: vi.fn(async () => undefined),
  cancelar: vi.fn(async () => undefined),
  devolver: vi.fn(async () => undefined),
  devolverParaPendente: vi.fn(async () => true),
  agendar: vi.fn(async () => true),
  resumo: vi.fn(async () => ({ pendente: 0, processando: 0, enviando: 0, concluido: 0, humano: 0, cancelado: 0 })),
  tabelasExistem: vi.fn(async (): Promise<any> => ({ ok: true, faltam: [] })),
  salvarConfig: vi.fn(async () => undefined),
}));
vi.mock("../../storage/chat-autonomia.storage", () => ({ autonomiaStorage: fila }));

const cliente = vi.hoisted(() => ({
  buscarConversaPorTelefone: vi.fn(async (_o?: string, _t?: string, _canal?: unknown): Promise<any> => ({ ok: true, valor: { id: "conv_1", contact: { phone: "5543999990000" } } })),
  listarMensagens: vi.fn(async (_o?: string, _c?: string, _opcoes?: unknown): Promise<any> => ({ ok: true, valor: [] })),
  planejarAutonomia: vi.fn(async (_o?: string, _agente?: string, _pedido?: any): Promise<any> => ({ ok: true, valor: { acao: "responder", resposta: "informar_divida", texto: "pague R$999 em https://malicioso" } })),
  enviarTexto: vi.fn(async (_o?: string, _c?: string, _texto?: string): Promise<any> => ({ ok: true, valor: { messageId: "out_1", status: "SENT" } })),
  enviarComoAgente: vi.fn(async (_o: string, _c: string, _a: string, textos: string[]): Promise<any> => ({ ok: true, valor: { loteId: "l1", mensagens: textos.map((_, i) => ({ messageId: `lote_${i}`, status: "QUEUED" })) } })),
  desligarIa: vi.fn(async (_o?: string, _c?: string): Promise<any> => ({ ok: true, valor: undefined })),
  atribuir: vi.fn(async (_o?: string, _c?: string, _dados?: unknown): Promise<any> => ({ ok: true, valor: {} })),
}));
vi.mock("./chat-ponte.service", async () => {
  const real = await vi.importActual<typeof import("./chat-ponte.service")>("./chat-ponte.service");
  return { clienteDoChat: () => cliente, ErroDaPonteDoChat: real.ErroDaPonteDoChat };
});
vi.mock("./chat-trava", () => ({ comTravaDoChat: async (_chave: string, fn: () => Promise<unknown>) => fn() }));
const agentes = vi.hoisted(() => ({
  listarAgentesDoChat: vi.fn(async (): Promise<any> => ({ agentes: [
    { tipo: "cobranca_ativos", habilitado: true, etapa: "pronto", id: "ag_ativos", modelo: "openai/gpt-4.1", nomeDaPersona: "Clara" },
    { tipo: "cobranca_ex_clientes", habilitado: true, etapa: "pronto", id: "ag_ex", modelo: "openai/gpt-4.1", nomeDaPersona: "Leonora" },
    { tipo: "recuperacao_equipamentos", habilitado: false, etapa: "configurado", id: null, modelo: null },
  ] })),
  modelosDosAgentesDoChat: vi.fn(async () => ({ configured: true, models: [{ id: "openai/gpt-4.1" }] })),
  comTravaDaConfiguracaoDoChat: async (_p: number, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("./chat-agentes.service", () => agentes);
const AO_VIVO = { status: "disponivel", carteiraAoVivo: true, financeiroAoVivo: true, valoresDe: "ao_vivo", lidoEm: "2026-09-06T15:00:00Z" };
const contexto = vi.hoisted(() => ({
  contextoDoAtendimento: vi.fn(async (): Promise<any> => ({ cliente: { id: 7, carteira: "ativo", statusContrato: "active", divida: 150, diasAtraso: 20, telefone: "43999990000", clienteDesde: "2024-03-01" }, erp: { status: "disponivel", carteiraAoVivo: true, financeiroAoVivo: true, valoresDe: "ao_vivo", lidoEm: "2026-09-06T15:00:00Z" }, faturas: [{ ref: "f1", valor: 150, vencimento: "2026-08-10" }] })),
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
const seguranca = vi.hoisted(() => ({
  ler: vi.fn<(...args: unknown[]) => Promise<{ identidade: import("./chat-autonomia-identidade").EstadoIdentidade | null; ofertas: any }>>(),
  identidade: vi.fn(async () => undefined), ofertas: vi.fn(async () => undefined), revogar: vi.fn(async () => undefined),
  autorizacao: vi.fn(async () => 8), autorizar: vi.fn(async () => undefined),
  tentativasDoCliente: vi.fn(async () => ({ em24h: 0, em30Dias: 0 })),
}));
vi.mock("../../storage/chat-autonomia-seguranca.storage", () => ({ segurancaAutonomiaStorage: seguranca }));
import { avaliarIdentidade } from "./chat-autonomia-identidade";
import { POLITICA_PADRAO } from "@shared/cobranca/politica";
import type { ConfigAutonomia } from "@shared/chat-autonomia";

import { configurarAutonomia, devolverAoAssistente, executarFilaAutonomia, historicoDoPlanejador, iniciarAutonomia, pararAutonomia, receberMensagemAutonoma } from "./chat-autonomia.service";
import { ErroDaPonteDoChat } from "./chat-ponte.service";
import { comOrcamentoContato } from "../cobranca/gestao-operacional.service";

const AGORA = new Date("2026-09-06T15:00:00Z"); // domingo, 12:00 em Brasília: a equipe está fora do horário
const JOB = { id: 15, provider_id: 42, conversation_id: "conv_1", message_id: "m1", status: "pendente", criado_em: "2026-09-06T14:59:30Z" };
const inbound = (id: string, text: string, createdAt = "2026-09-06T14:59:00Z") => ({ id, direction: "INBOUND", type: "TEXT", content: { text }, createdAt });
const outbound = (id: string, text: string, createdAt = "2026-09-06T14:00:00Z") => ({ id, direction: "OUTBOUND", type: "TEXT", content: { text }, createdAt });
const midia = (id: string, type: string, createdAt = "2026-09-06T14:59:00Z") => ({ id, direction: "INBOUND", type, content: {}, createdAt });
const VINCULO = { providerId: 42, conversationId: "conv_1", customerId: 7, telefone: "5543999990000" };
const CADASTRO = { nome: "Maria de Souza", documento: "12345678909" };
/** A identidade confirmada `haMs` antes de agora (dentro do episódio). */
const identidadeConfirmada = (haMs = 0) => {
  const quando = new Date(Date.now() - haMs);
  const desafio = avaliarIdentidade(null, VINCULO, CADASTRO, "oi", "ident1", quando);
  return avaliarIdentidade(desafio.estado, VINCULO, CADASTRO, "8909", "ident2", quando).estado;
};
const ligarChaveD9 = () => armazem.getIntegracaoDoChat.mockImplementation(async () => ({ providerId: 42, organizationId: "org_42", agenteConfig: { funcionariaDigital: { ativa: true } } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
  fila.proximos.mockResolvedValue([JOB]);
  seguranca.ler.mockImplementation(async () => ({ identidade: identidadeConfirmada(), ofertas: null }));
});
afterEach(() => { vi.useRealTimers(); });

const textoEnviado = () => String(cliente.enviarTexto.mock.calls.at(-1)?.[2] ?? "");
const todosOsTextos = () => [...cliente.enviarTexto.mock.calls.map(c => String(c[2])), ...cliente.enviarComoAgente.mock.calls.flatMap(c => (c[3] as string[]))];
const statusMarcados = () => fila.marcar.mock.calls.map(c => c[1]);
/**
 * O aviso de transferência (§3.4) chama quem continua a conversa. A frase de encerramento (número errado, parar,
 * contestação, tentativas esgotadas) e a confirmação do acordo também saem DEPOIS da transferência — senão o lote do
 * agente parava nela (vps/010) — e não são aviso: é pelo texto que se separa uma da outra.
 */
const FRASE_DE_AVISO = /continuar com você|seguir com você|continuar a conversa com você|cuidar disso|te responde por aqui/;
/** As mensagens que saíram DEPOIS de o trabalho ir ao atendente, na ordem, com o texto de cada uma. */
function saidasDepoisDaTransferencia(): string[] {
  const i = fila.marcar.mock.calls.findIndex(c => c[1] === "humano");
  if (i < 0) return [];
  const ordem = fila.marcar.mock.invocationCallOrder[i];
  return [
    ...cliente.enviarTexto.mock.calls.map((c, k) => ({ ordem: cliente.enviarTexto.mock.invocationCallOrder[k], texto: String(c[2]) })),
    ...cliente.enviarComoAgente.mock.calls.map((c, k) => ({ ordem: cliente.enviarComoAgente.mock.invocationCallOrder[k], texto: (c[3] as string[]).join("\n\n") })),
  ].filter(s => s.ordem > ordem).sort((a, b) => a.ordem - b.ordem).map(s => s.texto);
}
/** Saiu o aviso de transferência DEPOIS de o trabalho ir ao atendente? */
const avisou = () => saidasDepoisDaTransferencia().some(t => FRASE_DE_AVISO.test(t));
const textoDoAviso = () => saidasDepoisDaTransferencia().find(t => FRASE_DE_AVISO.test(t)) ?? "";
/** A leitura sob a trava vê a autonomia ligada; qualquer releitura depois dela, pausada (o admin desligou no meio da rodada). */
const pausarDepoisDaPrimeiraLeitura = () => {
  let leituras = 0;
  fila.config.mockImplementation(async () => ({ ativa: ++leituras === 1, maxTurnos: 12, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos", "cobranca_ex_clientes", "recuperacao_equipamentos"] }));
};

describe("uma rodada", () => {
  it("primeira resposta em WAITING inicia o desafio na voz da funcionária, sem depender de mudança prévia para BOT", async () => {
    armazem.getConversaDoChat.mockResolvedValue({ id: 1, providerId: 42, customerId: 7, casoId: 10, recuperacaoId: null, conversationId: "conv_1", status: "WAITING" });
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toContain("4 últimos dígitos do seu CPF");
    // conversa iniciada pelo cliente: ela se apresenta primeiro (f18), e nunca como "assistente virtual" (D1)
    expect(textoEnviado()).toMatch(/é a Clara, da NsLink 😊/);
    expect(textoEnviado()).not.toMatch(/assistente virtual|Souza/);
    expect(contexto.contextoDoAtendimento).not.toHaveBeenCalled();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "concluido");
  });
  it("caso de outro cliente não permite negociar o saldo do titular da conversa — e nada sai pela conversa", async () => {
    armazem.obterCasoDeCobranca.mockResolvedValueOnce({ id: 10, cliente: { id: 88 }, carteira: "ativo", status: "aberto" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(contexto.contextoDoAtendimento).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("cliente"));
  });
  it("contrato encerrado no ERP e caso ativo não permitem atendimento da carteira errada: transfere com aviso, sem valor", async () => {
    contexto.contextoDoAtendimento.mockResolvedValueOnce({ cliente: { id: 7, carteira: "ex_cliente", statusContrato: "cancelled", divida: 150, diasAtraso: 20 }, erp: AO_VIVO, faturas: [{ ref: "f1", valor: 150, vencimento: "2026-08-10" }] });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("Carteira"));
    expect(avisou()).toBe(true);
    expect(textoDoAviso()).toMatch(/equipe/);
    expect(todosOsTextos().join(" ")).not.toMatch(/150|contrato|já já|em instantes/);
  });
  it("ex-cliente recebe agente próprio, contexto do contrato encerrado e nenhum DNA ativo legado", async () => {
    armazem.obterCasoDeCobranca.mockResolvedValueOnce({ id: 10, cliente: { id: 7 }, carteira: "ex_cliente", status: "aberto", quadranteDna: "C3", tom: "negociar_reter" });
    contexto.contextoDoAtendimento.mockResolvedValueOnce({ cliente: { id: 7, carteira: "ex_cliente", statusContrato: "cancelled", divida: 150, diasAtraso: 45 }, erp: AO_VIVO, faturas: [{ ref: "f1", valor: 150, vencimento: "2026-08-10" }] });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia.mock.calls[0]?.[1]).toBe("ag_ex");
    const pedido = cliente.planejarAutonomia.mock.calls[0]?.[2];
    expect(JSON.parse(pedido.context)).toMatchObject({ carteira: "ex_cliente", statusContrato: "cancelled", identidadeConfirmada: true, abordagem: { tom: "cordial", quadrante: null }, nomeDaPersona: "Leonora" });
    expect(textoEnviado()).toMatch(/contrato (que foi )?encerrado/);
    expect(textoEnviado()).not.toMatch(/preserve nossa relação|boas-vindas|suspensão/i);
  });
  it("usa etapa e ação da política vigente em vez do snapshot antigo do caso", async () => {
    armazem.getPoliticaDeCobranca.mockResolvedValueOnce({ ...structuredClone(POLITICA_PADRAO), etapas: [{ id: "aviso_suspensao", acao: "Conferir pendência pela regra do provedor", diaMin: 15, diaMax: 30 }] });
    armazem.obterCasoDeCobranca.mockResolvedValueOnce({ id: 10, cliente: { id: 7 }, carteira: "ativo", status: "aberto", etapaAtual: "lembrete_atraso", quadranteDna: "B2", tom: "firme_gentil" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    const pedido = cliente.planejarAutonomia.mock.calls[0]?.[2];
    expect(JSON.parse(pedido.context).abordagem).toMatchObject({ etapa: "aviso_suspensao", objetivo: "Conferir pendência pela regra do provedor" });
  });
  it("política pausada transfere sem planejar, sem cobrança e sem aviso (é a autonomia em pausa, §3.4)", async () => {
    armazem.getPoliticaDeCobranca.mockResolvedValueOnce({ ...structuredClone(POLITICA_PADRAO), pausada: true });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("Política"));
  });
  it("resposta factual também respeita promessa e segunda via desligadas", async () => {
    fila.config.mockResolvedValueOnce({ ativa: true, maxTurnos: 12, permitirPromessa: false, permitirSegundaVia: false, permitirAgendamento: false, tipos: ["cobranca_ativos"] });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia.mock.calls[0]?.[2].allowedActions).toEqual(["responder", "transferir"]);
    expect(textoEnviado()).toContain("R$ 150,00");
    expect(textoEnviado()).not.toMatch(/segunda via|dia pra você pagar|qual dia/i);
  });
  it.each([100, 400])("ex-cliente com %s dias continua em conciliação autônoma sem ações de negativação ou baixa", async (diasAtraso) => {
    armazem.obterCasoDeCobranca.mockResolvedValueOnce({ id: 10, cliente: { id: 7 }, carteira: "ex_cliente", status: "aberto" });
    contexto.contextoDoAtendimento.mockResolvedValueOnce({ cliente: { id: 7, carteira: "ex_cliente", statusContrato: "cancelled", divida: 150, diasAtraso }, erp: AO_VIVO, faturas: [{ ref: "f1", valor: 150, vencimento: "2025-08-10" }] });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).toHaveBeenCalledOnce();
    expect(cliente.planejarAutonomia.mock.calls[0]?.[2].allowedActions).toEqual(["responder", "transferir", "segunda_via", "promessa"]);
    expect(textoEnviado()).toMatch(/contrato (que foi )?encerrado/);
    expect(fila.cancelar).not.toHaveBeenCalled();
  });
  it("humano que assume durante o planejamento interrompe o bot antes do envio", async () => {
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: 10, recuperacaoId: null, conversationId: "conv_1", status: "BOT" })
      .mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: 10, recuperacaoId: null, conversationId: "conv_1", status: "OPEN" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).toHaveBeenCalledOnce();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "cancelado", expect.stringContaining("humano"));
  });
  it("integração de outro provedor não recebe consultas nem transferência remota", async () => {
    armazem.getIntegracaoDoChat.mockResolvedValueOnce({ providerId: 99, organizationId: "org_99" }).mockResolvedValueOnce({ providerId: 99, organizationId: "org_99" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(cliente.listarMensagens).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(cliente.atribuir).not.toHaveBeenCalled();
  });
  it("equipamentos também confirmam identidade antes de consultar dados ou propor devolução", async () => {
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: null, recuperacaoId: 9, conversationId: "conv_1", status: "BOT" });
    agentes.listarAgentesDoChat.mockResolvedValueOnce({ agentes: [{ tipo: "recuperacao_equipamentos", habilitado: true, etapa: "pronto", id: "ag_equip", modelo: "openai/gpt-4.1", nomeDaPersona: "Eduarda" }] });
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toContain("4 últimos dígitos do seu CPF");
    expect(textoEnviado()).not.toMatch(/equipamento|aparelho|devolu/i);
    expect(contexto.contextoDoAtendimento).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
  });
  it("recuperação identificada não entrega saldo ou faturas financeiras ao modelo", async () => {
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: null, recuperacaoId: 9, conversationId: "conv_1", status: "BOT" });
    armazem.getRecoveryCaseById.mockResolvedValueOnce({ id: 9, providerId: 42, customerId: 7, closedAt: null, disputedAt: null, scheduledAt: null });
    agentes.listarAgentesDoChat.mockResolvedValueOnce({ agentes: [{ tipo: "recuperacao_equipamentos", habilitado: true, etapa: "pronto", id: "ag_equip", modelo: "openai/gpt-4.1" }] });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "como faço a devolução?")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "responder", resposta: "orientar_devolucao" } });
    await executarFilaAutonomia();
    const pedido = cliente.planejarAutonomia.mock.calls[0]?.[2];
    expect(pedido.operation).toBe("recuperacao");
    expect(JSON.parse(pedido.context)).toMatchObject({ saldo: null, faturas: [], carteira: "equipamentos", financeiroAoVivo: false, diasAtraso: null, promessasAnteriores: null });
    expect(JSON.stringify(pedido)).not.toContain("150");
    expect(textoEnviado()).not.toMatch(/R\$|valor|fatura|dívida/i);
  });
  it("quitação comprovada ainda aberta no ERP vai à conciliação sem divulgar saldo ou boleto", async () => {
    faturas.faturasQuitadasAindaAbertas.mockResolvedValueOnce(true);
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "manda o boleto")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(contexto.segundaViaDoAtendimento).not.toHaveBeenCalled();
    expect(fila.turno).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("conciliação"));
    expect(avisou()).toBe(true);
    expect(todosOsTextos().join(" ")).not.toMatch(/150|boleto|https/);
  });
  it("pedido de desconto com permissão gera opções controladas, sem chamar planejador: introdução e linhas do servidor", async () => {
    fila.config.mockResolvedValueOnce({ ativa: true, maxTurnos: 12, permitirNegociacao: true, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] });
    const politica = structuredClone(POLITICA_PADRAO); politica.acordo.ativo.origemDaCobranca = "manual";
    armazem.getPoliticaDeCobranca.mockResolvedValueOnce(politica).mockResolvedValueOnce(politica);
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "tem desconto?")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toContain("Opção 1");
    expect(textoEnviado()).toContain("150,00");
    expect(textoEnviado()).toMatch(/política/);
    expect(textoEnviado()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).not.toHaveBeenCalled();
  });
  it("sem identidade confirmada não lê financeiro nem chama modelo ou segunda via", async () => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "me manda o boleto e saldo")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toContain("4 últimos");
    expect(textoEnviado()).not.toContain("150");
    expect(contexto.contextoDoAtendimento).not.toHaveBeenCalled();
    expect(contexto.segundaViaDoAtendimento).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
  });
  it("os 4 dígitos certos na 1ª mensagem confirmam e a rodada SEGUE com a própria mensagem (§3.3), sem frase de identidade", async () => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "8909 quanto devo?")] });
    await executarFilaAutonomia();
    expect(seguranca.tentativasDoCliente).toHaveBeenCalledWith(42, 7);
    expect(seguranca.identidade).toHaveBeenCalledWith(42, "conv_1", expect.objectContaining({ confirmadaEm: AGORA.toISOString() }));
    expect(contexto.contextoDoAtendimento).toHaveBeenCalled();
    expect(JSON.parse(cliente.planejarAutonomia.mock.calls[0][2].context)).toMatchObject({ identidadeRecemConfirmada: true, situacao: "identidade_recem_confirmada" });
    expect(cliente.enviarTexto.mock.calls.map(c => String(c[2]))).not.toContainEqual(expect.stringContaining("4 últimos"));
    // perguntou o valor: no turno da identidade o R$ pode sair (f20)
    expect(textoEnviado()).toContain("R$ 150,00");
  });
  it("§10: \"Maria Souza 8909 pago dia 20/09\" confirma e a intenção segue ao planejador; só os dígitos, o turno não cita R$", async () => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "Maria Souza 8909 pago dia 20/09")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).toHaveBeenCalledOnce();
    expect(fila.cancelar).not.toHaveBeenCalled();

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([JOB]);
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "8909")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).not.toMatch(/R\$|150/);
    // revisão final (voz): com a chave D9 desligada toda conversa passa por aqui — obrigada pelo nome e o assunto, sem número
    expect(textoEnviado()).toMatch(/(?:^|\n\n)Obrigada por confirmar, Maria! É sobre a sua mensalidade, que ficou em aberto aqui com a gente\. /);
  });
  it("figurinha, reação e só emoji antes da identidade: não responde, não transfere, não gasta rodada e conclui (f12)", async () => {
    for (const mensagem of [inbound("m1", "👍"), midia("m1", "STICKER"), midia("m1", "REACTION")]) {
      vi.clearAllMocks(); fila.proximos.mockResolvedValue([JOB]);
      seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
      cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [mensagem] });
      await executarFilaAutonomia();
      expect(cliente.enviarTexto).not.toHaveBeenCalled();
      expect(fila.cancelar).not.toHaveBeenCalled();
      expect(fila.turno).not.toHaveBeenCalled();
      expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "concluido", expect.stringContaining("emoji"));
    }
  });
  it("tentativas esgotadas em OUTRA conversa do mesmo cliente valem aqui: frase com os canais oficiais e a equipe em silêncio (s7)", async () => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    seguranca.tentativasDoCliente.mockResolvedValueOnce({ em24h: 3, em30Dias: 3 });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "8909")] });
    await executarFilaAutonomia();
    expect(contexto.contextoDoAtendimento).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("Identificação"));
    expect(cliente.enviarTexto).toHaveBeenCalledOnce();
    // só o domínio do site do cadastro: o caminho "/cliente/financeiro" diria o assunto a quem não confirmou
    expect(textoEnviado()).toContain("nslink.com.br");
    expect(textoEnviado()).not.toMatch(/financeiro|4 últimos/);
    expect(avisou()).toBe(false);
  });
  it("telefone da conversa divergente do cadastro vai ao humano sem divulgação nem aviso", async () => {
    cliente.buscarConversaPorTelefone.mockResolvedValueOnce({ ok: true, valor: { id: "outra_conversa", contact: { phone: "5543999990000" } } });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("identificação"));
  });
  it("o contato sem o nono dígito que o WhatsApp devolve é o telefone do cadastro — o atendimento segue", async () => {
    // 43 9 9999-0000 no cadastro; a Evolution devolve 55 43 9999-0000 (16/09/2026, primeira resposta real).
    cliente.buscarConversaPorTelefone.mockResolvedValueOnce({ ok: true, valor: { id: "conv_1", contact: { phone: "554399990000" } } });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(fila.cancelar).not.toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("identificação"));
    expect(contexto.contextoDoAtendimento).toHaveBeenCalled();
  });
  it("vulnerabilidade exige acolhimento humano sem enviar dados ao planejador; o aviso não repete o documento", async () => {
    armazem.obterCasoDeCobranca.mockResolvedValueOnce({ id: 10, cliente: { id: 7 }, carteira: "ativo", status: "aberto", etapaAtual: "lembrete_atraso", quadranteDna: "C3", tom: "humanizado_vulneravel" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "Meu CPF é 123.456.789-09, quanto devo?")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("humana"));
    expect(todosOsTextos().join(" ")).not.toMatch(/123|150/);
  });
  it("responde com a reserva e o saldo lido, nunca com o texto ou o link do modelo; debita a rodada antes e marca enviando → concluido", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", "Olá"), inbound("m1", "quanto estou devendo?")] });
    await executarFilaAutonomia();
    expect(fila.assumir).toHaveBeenCalledWith(JOB);
    expect(fila.turno).toHaveBeenCalledWith(42, "conv_1", false);
    expect(cliente.planejarAutonomia).toHaveBeenCalledTimes(1);
    const [org, agenteId, pedido] = cliente.planejarAutonomia.mock.calls[0] as any[];
    expect(org).toBe("org_42"); expect(agenteId).toBe("ag_ativos");
    expect(pedido.allowedActions).toEqual(["responder", "transferir", "segunda_via", "promessa"]);
    expect(pedido.operation).toBe("cobranca");
    // chave D9 desligada: o planejador do 008, sem `escrever`, e o envio comum (sem aiAgentId)
    expect(pedido).not.toHaveProperty("escrever");
    expect(cliente.enviarComoAgente).not.toHaveBeenCalled();
    expect(textoEnviado()).toContain("R$ 150,00");
    expect(textoEnviado()).not.toMatch(/999|malicioso|ERP|leitura de agora|assistente virtual/);
    expect(statusMarcados()).toEqual(["enviando", "concluido"]);
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.objectContaining({ conversationId: "conv_1" }), null, expect.stringContaining("Assistente autônomo respondeu"));
    expect(fila.cancelar).not.toHaveBeenCalled();
    // o log da rodada leva etapas e tempos, nunca o texto
    expect(loggerMock.info).toHaveBeenCalledWith(expect.objectContaining({ etapa: "erp", ms: expect.any(Number) }), expect.any(String));
    expect(JSON.stringify(loggerMock.info.mock.calls)).not.toMatch(/devendo|150,00|Maria/);
  });
  it("áudio: a 1ª vez pede para escrever; a 2ª no episódio transfere com aviso (f12)", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [midia("m1", "AUDIO")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).not.toHaveBeenCalled();
    expect(textoEnviado()).toMatch(/áudio/);
    expect(textoEnviado()).not.toContain("4 últimos"); // identidade vigente: não pede os dígitos

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([{ ...JOB, message_id: "m2" }]);
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [midia("m1", "AUDIO", "2026-09-06T14:50:00Z"), outbound("o1", "Não consigo ouvir áudio por aqui. Me escreve, por favor?", "2026-09-06T14:51:00Z"), midia("m2", "AUDIO")] });
    await executarFilaAutonomia();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("áudio"));
    expect(avisou()).toBe(true);
  });
  it("imagem ou documento (possível comprovante) transfere com o aviso de pagamento informado", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [midia("m1", "IMAGE")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("comprovante"));
    expect(textoDoAviso()).toMatch(/conferir/);
  });
  it("rodadas contam por episódio (f16): no limite transfere com aviso; com proposta esperando o \"sim\", o limite não corta", async () => {
    fila.estado.mockResolvedValueOnce({ turnos: 12, humano: false, proposta: null, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "oi")] });
    await executarFilaAutonomia();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", "Limite de rodadas atingido");
    expect(avisou()).toBe(true);

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([JOB]);
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 60_000).toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValueOnce({ turnos: 12, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", "Posso anotar o pagamento de R$ 150,00 pra quinta, dia 10/09?", "2026-09-06T14:58:00Z"), inbound("m1", "sim")] });
    await executarFilaAutonomia();
    expect(agente.registrarPromessaDoAgente).toHaveBeenCalled();
    expect(fila.cancelar).not.toHaveBeenCalled();

    // episódio novo (6 h sem rodada): a leitura já devolve zero e o turno recomeça em 1
    vi.clearAllMocks(); fila.proximos.mockResolvedValue([JOB]);
    fila.estado.mockResolvedValueOnce({ turnos: 0, humano: false, proposta: null, motivo: null, episodioNovo: true });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(fila.turno).toHaveBeenCalledWith(42, "conv_1", true);
  });
  it("plano fora das permissões do provedor (agendar numa cobrança) transfere com aviso, não executa", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "posso devolver dia 10/9 às 14:00")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "agendar", data: "2026-09-10T14:00:00-03:00" } });
    await executarFilaAutonomia();
    expect(fila.agendar).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", "Plano fora das permissões do provedor");
    expect(avisou()).toBe(true);
  });
  it("D1 depois da identidade: \"você é robô?\" com a reserva confirma que é atendimento automatizado", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "você é robô?")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "responder", resposta: "acolher" } });
    await executarFilaAutonomia();
    expect(textoEnviado()).toMatch(/automatizado/);
    expect(textoEnviado()).not.toMatch(/sou (uma )?pessoa|não sou robô/i);
  });
  it("resposta a um pré-aviso (conversa sem caso): a identidade primeiro, e só com os dígitos conferidos a conversa vai à equipe com o aviso (§12)", async () => {
    const preAviso = { id: 1, providerId: 42, customerId: 7, casoId: null, recuperacaoId: null, conversationId: "conv_1", status: "WAITING" };
    const abertura = outbound("o1", "Oi! Aqui é a Clara, da NsLink 😊", "2026-09-06T14:00:00Z");
    armazem.getConversaDoChat.mockResolvedValue(preAviso);
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [abertura, inbound("m1", "oi, quem é?", "2026-09-06T14:30:00Z")] });
    await executarFilaAutonomia();
    // sem os dígitos: a frase do servidor pede de novo — a equipe não recebe parte de um CPF que ninguém conferiu
    expect(fila.cancelar).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(textoEnviado()).toContain("4 últimos dígitos do seu CPF");
    expect(textoEnviado()).not.toMatch(/fatura|vencimento|R\$/);
    const desafiada = (seguranca.identidade.mock.calls.at(-1) as unknown as any[])[2];

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([{ ...JOB, message_id: "m2" }]);
    armazem.getConversaDoChat.mockResolvedValue(preAviso);
    seguranca.ler.mockResolvedValueOnce({ identidade: desafiada, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [abertura, inbound("m1", "oi, quem é?", "2026-09-06T14:30:00Z"), outbound("o2", textoEnviado() || "Me confirma os 4 últimos dígitos do seu CPF?", "2026-09-06T14:31:00Z"), inbound("m2", "8909")] });
    await executarFilaAutonomia();
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.anything(), null, expect.stringContaining("Identidade confirmada"));
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("pré-aviso"));
    expect(contexto.contextoDoAtendimento).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(avisou()).toBe(true);
    expect(textoDoAviso()).not.toMatch(/fatura|vencimento|R\$/);
  });
  it("planejador ocupado (503) com a mensagem recente: a rodada volta à fila, sem transferir nem enviar", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: false, erro: "Planejador ocupado", status: 503 });
    await executarFilaAutonomia();
    expect(fila.devolverParaPendente).toHaveBeenCalledWith(JOB);
    expect(fila.cancelar).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
  });
  it("503 “ocupado” depois de confirmar a identidade: a volta à fila continua “recém-confirmada” (f20) e não debita a rodada de novo", async () => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "8909 oi")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: false, erro: "Planejador ocupado", status: 503 });
    await executarFilaAutonomia();
    expect(fila.devolverParaPendente).toHaveBeenCalledWith(JOB);
    expect(fila.turno).toHaveBeenCalledTimes(1);
    const gravada = (seguranca.identidade.mock.calls.at(-1) as unknown as any[])[2];
    expect(gravada).toMatchObject({ confirmadaNaMensagem: "m1", lidasComIdentidadeAte: "2026-09-06T14:59:00Z" });

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([JOB]);
    seguranca.ler.mockResolvedValueOnce({ identidade: gravada, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "8909 oi")] });
    await executarFilaAutonomia();
    expect(JSON.parse(cliente.planejarAutonomia.mock.calls[0][2].context)).toMatchObject({ identidadeRecemConfirmada: true, situacao: "identidade_recem_confirmada" });
    // não perguntou valor: nem na volta o turno cita R$
    expect(textoEnviado()).not.toMatch(/R\$|150/);
    expect(fila.turno).not.toHaveBeenCalled();
    // a linha do tempo não ganha uma segunda "Identidade confirmada"
    expect(armazem.registrarEventoDoChat).not.toHaveBeenCalledWith(42, expect.anything(), null, expect.stringContaining("Identidade confirmada"));
  });
  it("e11: contexto + histórico nunca passam do teto de 14.000 do fork, nem com 20 faturas e mensagens longas", async () => {
    const vinteFaturas = Array.from({ length: 20 }, (_, i) => ({ ref: `fatura-erp-${1000 + i}`, valor: 99.9, vencimento: `2026-0${(i % 8) + 1}-10` }));
    contexto.contextoDoAtendimento.mockResolvedValueOnce({ cliente: { id: 7, carteira: "ativo", statusContrato: "active", divida: 1998, diasAtraso: 20, telefone: "43999990000", clienteDesde: "2024-03-01" }, erp: AO_VIVO, faturas: vinteFaturas });
    const longa = "x".repeat(1100);
    const mensagens: any[] = Array.from({ length: 14 }, (_, i) => (i % 2 ? outbound(`o${i}`, longa, new Date(Date.UTC(2026, 8, 6, 13, i)).toISOString()) : inbound(`i${i}`, longa, new Date(Date.UTC(2026, 8, 6, 13, i)).toISOString())));
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [...mensagens, inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    const pedido = cliente.planejarAutonomia.mock.calls[0][2];
    const historico = pedido.history.reduce((soma: number, item: { content: string }) => soma + item.content.length, 0);
    expect(pedido.context.length).toBeGreaterThan(3000);
    expect(pedido.context.length + historico).toBeLessThanOrEqual(14_000);
    expect(pedido.history.at(-1)).toEqual({ role: "user", content: "quanto devo?" });
  });
  it("figurinha no limite de rodadas é ignorada — não leva a conversa à equipe (§3.2, item 1)", async () => {
    fila.estado.mockResolvedValueOnce({ turnos: 12, humano: false, proposta: null, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [midia("m1", "STICKER")] });
    await executarFilaAutonomia();
    expect(fila.cancelar).not.toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "concluido", expect.stringContaining("figurinha"));
  });
  it("com proposta esperando o “sim”: 😊 é ignorado e a proposta fica de pé; 👍 confirma", async () => {
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 5 * 60_000).toISOString(), messageId: "m0" };
    const pergunta = outbound("o1", "Posso anotar o pagamento de R$ 150,00 pra quinta, dia 10/09?", "2026-09-06T14:55:00Z");
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [pergunta, inbound("m1", "😊")] });
    await executarFilaAutonomia();
    expect(fila.proposta).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "concluido", expect.stringContaining("emoji"));

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([{ ...JOB, message_id: "m2" }]);
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [pergunta, inbound("m1", "😊", "2026-09-06T14:56:00Z"), inbound("m2", "👍")] });
    await executarFilaAutonomia();
    expect(agente.registrarPromessaDoAgente).toHaveBeenCalled();
    expect(fila.cancelar).not.toHaveBeenCalled();
  });
  it("o aviso lê a chave D9 na hora (§3.4): ligada depois do começo da rodada, sai como a funcionária", async () => {
    ligarChaveD9();
    armazem.getIntegracaoDoChat.mockResolvedValueOnce({ providerId: 42, organizationId: "org_42" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quero falar com atendente")] });
    await executarFilaAutonomia();
    expect(fila.cancelar).toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(cliente.enviarComoAgente).toHaveBeenCalledWith("org_42", "conv_1", "ag_ativos", expect.any(Array));
  });
  it("ofertas gravadas e o worker parando: a rodada envia, em vez de voltar à fila e tratar a escolha como velha", async () => {
    let parar = false;
    seguranca.ofertas.mockImplementation((async (...args: unknown[]) => { if (args[2]) parar = true; return undefined; }) as never);
    fila.config.mockResolvedValue({ ativa: true, maxTurnos: 12, permitirNegociacao: true, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] });
    const politica = structuredClone(POLITICA_PADRAO); politica.acordo.ativo.origemDaCobranca = "manual";
    armazem.getPoliticaDeCobranca.mockResolvedValue(politica);
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "tem desconto?")] });
    await executarFilaAutonomia({ deveParar: () => parar });
    expect(parar).toBe(true);
    expect(fila.devolverParaPendente).not.toHaveBeenCalled();
    expect(textoEnviado()).toMatch(/Opção 1: R\$ /);
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "concluido");
  });
});

describe("antes da identidade: triagem (§3.2) e frases do servidor", () => {
  beforeEach(() => { seguranca.ler.mockImplementation(async () => ({ identidade: null, ofertas: null })); });
  it("número errado: telefone a conferir no caso ANTES da frase, desculpa sem convite e a equipe em silêncio", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", "Oi! Aqui é a Clara, da NsLink 😊"), inbound("m1", "é engano, não conheço")] });
    await executarFilaAutonomia();
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.anything(), null, expect.stringContaining("conferir o telefone"), expect.objectContaining({ proximaAcao: "Conferir telefone do cadastro" }));
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Conferir telefone do cadastro" }), null);
    expect(armazem.atualizarCasoDeCobranca.mock.invocationCallOrder[0]).toBeLessThan(cliente.enviarTexto.mock.invocationCallOrder[0]);
    // o follow-up "Responder no chat" da transferência não sobrescreve o "conferir telefone"
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledTimes(1);
    expect(textoEnviado()).toMatch(/desculpa/i);
    expect(textoEnviado()).not.toMatch(/4 últimos|equipe|\?/);
    expect(fila.cancelar).toHaveBeenCalled();
    expect(avisou()).toBe(false);
  });
  it("pediu para parar: frase de encerramento, `nao_contatar` gravado pelas preferências de contato e a equipe em silêncio", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "para de mandar mensagem")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toMatch(/não (vou mais te mandar|te mando mais)/i);
    expect(preferencias.pausarComunicacao).toHaveBeenCalledWith(42, 7, null, "nao_contatar");
    expect(cliente.enviarTexto.mock.invocationCallOrder[0]).toBeLessThan(preferencias.pausarComunicacao.mock.invocationCallOrder[0]);
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("não receber"));
    expect(avisou()).toBe(false);
  });
  it("pediu para parar e o envio da frase falha: o `nao_contatar` é gravado do mesmo jeito", async () => {
    cliente.enviarTexto.mockResolvedValueOnce({ ok: false, erro: "timeout" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "me tira da lista")] });
    await executarFilaAutonomia();
    expect(preferencias.pausarComunicacao).toHaveBeenCalledWith(42, 7, null, "nao_contatar");
    expect(cliente.enviarTexto).toHaveBeenCalledTimes(1);
  });
  it("contestação de titularidade: frase neutra com o canal oficial e a equipe em silêncio", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "não contratei nada, isso é fraude")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toMatch(/verificar esse cadastro/);
    expect(textoEnviado()).not.toMatch(/dívida|fatura|R\$|4 últimos/);
    expect(avisou()).toBe(false);
  });
  it("terceiro declarado: pede que o titular fale, sem pedir dígitos e sem gastar tentativa", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sou o filho dela, 8909")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toMatch(/Maria/);
    expect(textoEnviado()).not.toMatch(/4 últimos|Souza/);
    expect(contexto.contextoDoAtendimento).not.toHaveBeenCalled();
    expect(fila.cancelar).not.toHaveBeenCalled();
  });
  it("pedido de pessoa antes da identidade: aviso NEUTRO, sem assunto nem valor", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quero falar com atendente")] });
    await executarFilaAutonomia();
    expect(fila.cancelar).toHaveBeenCalled();
    expect(avisou()).toBe(true);
    expect(textoDoAviso()).toMatch(/equipe/);
    expect(textoDoAviso()).not.toMatch(/dívida|pagamento|fatura|contrato|R\$|\d{2}\/\d{2}|já já|em instantes/);
  });
  // revisão final (voz): o aceite da oferta da D1 é pedido de pessoa — antes, ela pedia os dígitos de novo
  it.each(["prefiro falar com alguém da equipe", "pode ser alguém da equipe", "me passa pra equipe"])("“%s” depois da oferta de robô: vai à equipe com o aviso neutro, sem pedir os dígitos", async texto => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", "É um atendimento automatizado da NsLink, com supervisão da nossa equipe. Se preferir falar com alguém da equipe, é só me dizer. Pra seguir por aqui, me confirma os 4 últimos dígitos do seu CPF?", "2026-09-06T14:50:00Z"), inbound("m1", texto)] });
    await executarFilaAutonomia();
    expect(fila.cancelar).toHaveBeenCalled();
    expect(avisou()).toBe(true);
    expect(todosOsTextos().join(" ")).not.toMatch(/4 últimos|dígitos/);
  });
  it("\"é golpe?\" tranquiliza, indica só o domínio do site do cadastro e pede os dígitos de novo", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "isso é golpe?")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toContain("nslink.com.br");
    expect(textoEnviado()).not.toContain("financeiro");
    expect(textoEnviado()).toContain("4 últimos dígitos do seu CPF");
    expect(fila.cancelar).not.toHaveBeenCalled();
  });
  it("a frase não repete a variação já enviada na conversa (f13)", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m0", "oi"), inbound("m1", "oi de novo")] });
    fila.proximos.mockResolvedValue([JOB]);
    await executarFilaAutonomia();
    const primeira = textoEnviado();
    vi.clearAllMocks(); fila.proximos.mockResolvedValue([{ ...JOB, message_id: "m2" }]);
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", primeira, "2026-09-06T14:59:10Z"), inbound("m2", "oi?")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).not.toBe(primeira);
  });
  it("na terceira vez da mesma situação volta a variação usada há mais tempo, nunca a última (§7)", async () => {
    const abertura = outbound("o0", "Oi! Aqui é a Clara, da NsLink 😊", "2026-09-06T14:00:00Z");
    const m1 = inbound("m1", "pode", "2026-09-06T14:10:00Z");
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [abertura, { ...m1, createdAt: "2026-09-06T14:59:00Z" }] });
    await executarFilaAutonomia();
    const a = textoEnviado();

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([{ ...JOB, message_id: "m2" }]);
    const o1 = outbound("o1", a, "2026-09-06T14:11:00Z"), m2 = inbound("m2", "pode", "2026-09-06T14:20:00Z");
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [abertura, m1, o1, { ...m2, createdAt: "2026-09-06T14:59:00Z" }] });
    await executarFilaAutonomia();
    const b = textoEnviado();
    expect(b).not.toBe(a);

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([{ ...JOB, message_id: "m3" }]);
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [abertura, m1, o1, m2, outbound("o2", b, "2026-09-06T14:21:00Z"), inbound("m3", "pode")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toBe(a);
  });
});

describe("s10: o que chegou antes dos dígitos passa pela triagem de depois da identidade (§3.3)", () => {
  const pedidoDosDigitos = outbound("o1", "Pra continuar com segurança, me confirma os 4 últimos dígitos do seu CPF?", "2026-09-06T14:31:00Z");
  it.each([
    { nome: "pagamento informado", antes: "já paguei", aviso: /por avisar/ },
    { nome: "pergunta de negativação (política)", antes: "vão me negativar?", aviso: /equipe/ },
    { nome: "desconto sem negociação autônoma", antes: "tem desconto?", aviso: /equipe/ },
  ])("$nome antes da identidade e, depois, só os dígitos: a equipe recebe com o aviso certo, sem planejador", async ({ antes, aviso }) => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", antes, "2026-09-06T14:30:00Z")] });
    await executarFilaAutonomia();
    // antes dos dígitos, o pedido de identidade: a conferência precisa saber de quem é
    expect(fila.cancelar).not.toHaveBeenCalled();
    expect(textoEnviado()).toContain("4 últimos dígitos");
    const desafiada = (seguranca.identidade.mock.calls.at(-1) as unknown as any[])[2];

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([{ ...JOB, message_id: "m2" }]);
    seguranca.ler.mockResolvedValueOnce({ identidade: desafiada, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", antes, "2026-09-06T14:30:00Z"), pedidoDosDigitos, inbound("m2", "8909")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(contexto.contextoDoAtendimento).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("exige conferência"));
    expect(avisou()).toBe(true);
    expect(textoDoAviso()).toMatch(aviso);
    expect(textoDoAviso()).not.toMatch(/R\$|150/);
  });
  it("revisão final: “sou a filha dela” e, na mensagem seguinte, “8909” — confirma, mas a equipe recebe sem ERP e sem planejador", async () => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sou a filha dela", "2026-09-06T14:30:00Z")] });
    await executarFilaAutonomia();
    // antes dos dígitos: a frase que pede a titular, sem gastar tentativa
    const pedeATitular = textoEnviado();
    expect(pedeATitular).toMatch(/Maria/);
    expect(pedeATitular).not.toMatch(/4 últimos/);
    expect(fila.cancelar).not.toHaveBeenCalled();
    const desafiada = (seguranca.identidade.mock.calls.at(-1) as unknown as any[])[2];

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([{ ...JOB, message_id: "m2" }]);
    seguranca.ler.mockResolvedValueOnce({ identidade: desafiada, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sou a filha dela", "2026-09-06T14:30:00Z"), outbound("o1", pedeATitular, "2026-09-06T14:31:00Z"), inbound("m2", "8909")] });
    await executarFilaAutonomia();
    expect(contexto.contextoDoAtendimento).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("exige conferência"));
    expect(avisou()).toBe(true);
    expect(todosOsTextos().join(" ")).not.toMatch(/R\$|150|mensalidade|em aberto/);
  });
  it.each(["sou o marido dela, quanto deve?", "o cpf é da minha mãe, quanto deve?", "to respondendo pela minha mãe, qual o valor?"])(
    "revisão final: com a identidade vigente, “%s” vai à equipe sem ERP e sem planejador", async texto => {
      cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", texto)] });
      await executarFilaAutonomia();
      expect(contexto.contextoDoAtendimento).not.toHaveBeenCalled();
      expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
      expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("exige conferência"));
      expect(todosOsTextos().join(" ")).not.toMatch(/R\$|150/);
    });
  it("equipamentos: “já devolvi o aparelho” e, na mensagem seguinte (a primeira cancelada), “8909” — a equipe confere a devolução", async () => {
    armazem.getConversaDoChat.mockResolvedValue({ id: 1, providerId: 42, customerId: 7, casoId: null, recuperacaoId: 9, conversationId: "conv_1", status: "BOT" });
    armazem.getRecoveryCaseById.mockResolvedValue({ id: 9, providerId: 42, customerId: 7, closedAt: null, disputedAt: null, scheduledAt: null });
    agentes.listarAgentesDoChat.mockResolvedValue({ agentes: [{ tipo: "recuperacao_equipamentos", habilitado: true, etapa: "pronto", id: "ag_equip", modelo: "openai/gpt-4.1", nomeDaPersona: "Eduarda" }] });
    fila.proximos.mockResolvedValue([{ ...JOB, message_id: "m2" }]);
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "já devolvi o aparelho", "2026-09-06T14:58:00Z"), inbound("m2", "8909")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("exige conferência"));
    expect(textoDoAviso()).toMatch(/conferir a devolução/);
  });
  it("o que já foi lido não volta: pedido anterior à marca (devolvido pelo atendente) não transfere de novo", async () => {
    const desafio = avaliarIdentidade(null, VINCULO, CADASTRO, "oi", "m0", new Date("2026-09-06T14:40:00Z"));
    seguranca.ler.mockResolvedValueOnce({ identidade: { ...desafio.estado!, lidasComIdentidadeAte: "2026-09-06T14:35:00Z" } as never, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [
      inbound("m9", "já paguei", "2026-09-06T14:00:00Z"), outbound("o9", "Conferi aqui, obrigado!", "2026-09-06T14:20:00Z"),
      inbound("m0", "oi", "2026-09-06T14:40:00Z"), pedidoDosDigitos, inbound("m1", "8909"),
    ] });
    await executarFilaAutonomia();
    expect(fila.cancelar).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).toHaveBeenCalledOnce();
  });
});

describe("figurinha, reação ou só emoji DEPOIS de um pedido: o pedido não some (f12, revisão B5 rodada 2)", () => {
  /** As duas rodadas da conversa: a do texto (m1) e a da mensagem sem pedido (m2), na ordem da fila. */
  async function duasRodadas(msgs: unknown[], preparar: () => void = () => {}) {
    preparar();
    cliente.listarMensagens.mockResolvedValue({ ok: true, valor: msgs });
    await executarFilaAutonomia();
    const primeira = { enviados: todosOsTextos(), marcados: statusMarcados(), cancelou: fila.cancelar.mock.calls.length, avisou: avisou(), aviso: textoDoAviso(), planejou: cliente.planejarAutonomia.mock.calls.length, pedido: cliente.planejarAutonomia.mock.calls[0]?.[2], promessas: agente.registrarPromessaDoAgente.mock.calls.length };
    vi.clearAllMocks(); fila.proximos.mockResolvedValue([{ ...JOB, id: 16, message_id: "m2" }]);
    preparar();
    cliente.listarMensagens.mockResolvedValue({ ok: true, valor: msgs });
    await executarFilaAutonomia();
    return { primeira };
  }
  const expectSegundaRodadaIgnorada = () => {
    expect(todosOsTextos()).toEqual([]);
    expect(fila.cancelar).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.marcar).toHaveBeenLastCalledWith(expect.objectContaining({ id: 16 }), "concluido", expect.stringContaining("figurinha"));
  };

  it("“já paguei” + figurinha: a rodada do texto transfere com o aviso de pagamento; a da figurinha não faz nada", async () => {
    const { primeira } = await duasRodadas([inbound("m1", "já paguei", "2026-09-06T14:58:50Z"), midia("m2", "STICKER")]);
    expect(primeira.marcados).not.toContain("cancelado");
    expect(primeira.cancelou).toBe(1);
    expect(primeira.avisou).toBe(true);
    expect(primeira.aviso).toMatch(/por avisar/);
    expect(primeira.planejou).toBe(0);
    expectSegundaRodadaIgnorada();
  });
  it("“quanto devo?” + 🙏: responde UMA vez, e o que o modelo lê termina na pergunta", async () => {
    const { primeira } = await duasRodadas([inbound("m1", "quanto devo?", "2026-09-06T14:58:50Z"), inbound("m2", "🙏")]);
    expect(primeira.planejou).toBe(1);
    expect(primeira.enviados).toHaveLength(1);
    expect(primeira.enviados[0]).toMatch(/150/);
    expect(primeira.pedido.history.at(-1)).toEqual({ role: "user", content: "quanto devo?" });
    expectSegundaRodadaIgnorada();
  });
  it("proposta esperando o “sim”: “sim” + reação grava a promessa", async () => {
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 5 * 60_000).toISOString(), messageId: "m0" };
    const { primeira } = await duasRodadas(
      [outbound("o1", "Posso anotar o pagamento de R$ 150,00 pra quinta, dia 10/09?", "2026-09-06T14:55:00Z"), inbound("m1", "sim", "2026-09-06T14:58:50Z"), midia("m2", "REACTION")],
      () => fila.estado.mockResolvedValue({ turnos: 1, humano: false, proposta, motivo: null }),
    );
    expect(primeira.promessas).toBe(1);
    expect(primeira.cancelou).toBe(0);
    expect(primeira.enviados.join(" ")).toMatch(/10\/09/);
    expectSegundaRodadaIgnorada();
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();
  });
  it("antes da identidade: “Maria 8909” + 😊 confirma com os dígitos e segue", async () => {
    const { primeira } = await duasRodadas(
      [inbound("m1", "Maria 8909", "2026-09-06T14:58:50Z"), inbound("m2", "😊")],
      () => seguranca.ler.mockResolvedValue({ identidade: null, ofertas: null }),
    );
    expect(primeira.marcados).not.toContain("cancelado");
    expect(primeira.planejou).toBe(1);
    expectSegundaRodadaIgnorada();
  });
  it("com proposta esperando, o 👍 É o “sim”: o texto anterior cede a vez a ele, que grava a promessa", async () => {
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 5 * 60_000).toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValue({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValue({ ok: true, valor: [outbound("o1", "Posso anotar o pagamento de R$ 150,00 pra quinta, dia 10/09?", "2026-09-06T14:55:00Z"), inbound("m1", "pode", "2026-09-06T14:58:50Z"), inbound("m2", "👍")] });
    await executarFilaAutonomia();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "cancelado", "Outra mensagem do cliente já recebida");
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();
  });
});

describe("encerramento antes da triagem e autonomia pausada no meio da rodada (s6, §3.4 — revisão B5 rodada 2)", () => {
  const LIMITE = () => fila.estado.mockResolvedValueOnce({ turnos: 12, humano: false, proposta: null, motivo: null });
  const CASO_PAGO = () => armazem.obterCasoDeCobranca.mockResolvedValue({ id: 10, cliente: { id: 7 }, carteira: "ativo", status: "pago" });
  const AGENTE_PARADO = () => agentes.listarAgentesDoChat.mockResolvedValue({ agentes: [{ tipo: "cobranca_ativos", habilitado: false, etapa: "configurado", id: null, modelo: null }] });
  it.each([
    { onde: "limite de rodadas", preparar: LIMITE },
    { onde: "caso pago", preparar: CASO_PAGO },
    { onde: "agente não pronto", preparar: AGENTE_PARADO },
  ])("$onde + “para de mandar mensagem”: frase de encerramento, `nao_contatar` gravado e nenhum convite", async ({ preparar }) => {
    preparar();
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "para de mandar mensagem")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toMatch(/não (vou mais te mandar|te mando mais)/i);
    expect(todosOsTextos().join(" ")).not.toMatch(/nossa equipe|continuar com você|te responde/);
    expect(preferencias.pausarComunicacao).toHaveBeenCalledWith(42, 7, null, "nao_contatar");
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("não receber"));
    expect(avisou()).toBe(false);
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
  });
  it.each([
    { onde: "limite de rodadas", preparar: LIMITE, casoRecebe: true },
    { onde: "caso pago", preparar: CASO_PAGO, casoRecebe: false },
    { onde: "agente não pronto", preparar: AGENTE_PARADO, casoRecebe: true },
  ])("$onde, sem identidade, + “é engano”: desculpa, “conferir telefone” e a equipe em silêncio", async ({ preparar, casoRecebe }) => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    preparar();
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "é engano, não conheço essa pessoa")] });
    await executarFilaAutonomia();
    expect(textoEnviado()).toMatch(/desculpa/i);
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.anything(), null, expect.stringContaining("conferir o telefone"), expect.objectContaining({ proximaAcao: "Conferir telefone do cadastro" }));
    if (casoRecebe) expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Conferir telefone do cadastro" }), null);
    expect(armazem.atualizarCasoDeCobranca).not.toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Responder no chat" }), null);
    expect(avisou()).toBe(false);
  });
  it("com a identidade vigente, só o número errado INEQUÍVOCO encerra: “não conheço o técnico” no limite vai à equipe com o aviso", async () => {
    LIMITE();
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "não conheço o técnico que veio aqui")] });
    await executarFilaAutonomia();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", "Limite de rodadas atingido");
    expect(avisou()).toBe(true);
  });
  it("autonomia pausada durante a rodada: o aviso de transferência não sai, e a conversa vai à equipe", async () => {
    pausarDepoisDaPrimeiraLeitura();
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quero falar com uma pessoa")] });
    await executarFilaAutonomia();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("exige conferência"));
    expect(todosOsTextos()).toEqual([]);
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
  });
  it("autonomia pausada durante a rodada: “é engano” e “para de mandar” não recebem a frase, mas o registro e a transferência acontecem", async () => {
    pausarDepoisDaPrimeiraLeitura();
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "é engano, não conheço")] });
    await executarFilaAutonomia();
    expect(todosOsTextos()).toEqual([]);
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledTimes(1);
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Conferir telefone do cadastro" }), null);
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.stringContaining("número errado"));
    expect(statusMarcados()).not.toContain("enviando");

    vi.clearAllMocks(); fila.proximos.mockResolvedValue([JOB]);
    pausarDepoisDaPrimeiraLeitura();
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "para de mandar mensagem")] });
    await executarFilaAutonomia();
    expect(todosOsTextos()).toEqual([]);
    expect(preferencias.pausarComunicacao).toHaveBeenCalledWith(42, 7, null, "nao_contatar");
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.stringContaining("não receber"));
  });
});

describe("o follow-up já gravado no caso não vira “Responder no chat” (caminhos de borda)", () => {
  it("número errado e a transferência lança (fork fora no desligarIa): nem o catch da rodada nem a desistência do trabalho trocam o “conferir telefone”", async () => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.desligarIa.mockResolvedValueOnce({ ok: false, erro: "fora do ar" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "é engano, não conheço")] });
    await executarFilaAutonomia();
    expect(cliente.desligarIa).toHaveBeenCalledTimes(2);
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledTimes(1);
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Conferir telefone do cadastro" }), null);
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.stringContaining("sem reenvio automático"));

    // o fork continua fora: a transferência do catch também lança, e quem desiste do trabalho preserva o follow-up
    vi.clearAllMocks(); fila.proximos.mockResolvedValue([JOB]);
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.desligarIa.mockResolvedValue({ ok: false, erro: "fora do ar" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "é engano, não conheço")] });
    await expect(executarFilaAutonomia()).resolves.toBeUndefined();
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledTimes(1);
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Conferir telefone do cadastro" }), null);
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.stringContaining("Falha inesperada"));
  });
  it("acordo aceito e a autonomia pausada antes da confirmação: a equipe recebe a conversa e o caso fica com “preparar cobrança”", async () => {
    const cfg = { ativa: true, maxTurnos: 12, permitirNegociacao: true, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] };
    // pausada no instante em que o acordo foi gravado
    fila.config.mockImplementation(async () => ({ ...cfg, ativa: armazem.criarNegociacao.mock.calls.length === 0 }));
    const politica = structuredClone(POLITICA_PADRAO); politica.acordo.ativo.origemDaCobranca = "manual";
    armazem.getPoliticaDeCobranca.mockResolvedValue(politica);
    const { calcularOfertasAutonomia } = await import("./chat-autonomia-ofertas");
    const base = calcularOfertasAutonomia({ customerId: 7, carteira: "ativo", saldo: 150, diasAtraso: 20, mensalidade: null, vulneravel: false }, politica, "m0", new Date(AGORA.getTime() - 10 * 60_000));
    seguranca.ler.mockImplementation(async () => ({ identidade: identidadeConfirmada(), ofertas: { ...base, selecionada: 0 } }));
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim")] });
    await executarFilaAutonomia();
    expect(armazem.criarNegociacao).toHaveBeenCalled();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("Autonomia pausada antes de confirmar"));
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Preparar cobrança do acordo aceito no chat" }), 8);
    expect(armazem.atualizarCasoDeCobranca).not.toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Responder no chat" }), null);
  });
  it("promessa gravada e o envio da confirmação sem resposta: a equipe recebe sem trocar o follow-up da promessa", async () => {
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 60_000).toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", "Posso anotar o pagamento de R$ 150,00 pra quinta, dia 10/09?", "2026-09-06T14:58:00Z"), inbound("m1", "sim")] });
    cliente.enviarTexto.mockResolvedValueOnce({ ok: false, erro: "O Chat BullQ não respondeu em 30s" });
    await executarFilaAutonomia();
    expect(agente.registrarPromessaDoAgente).toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("envio não confirmado"));
    expect(armazem.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });
  it("número errado e o atendente assume antes da frase: o caso continua com “conferir telefone”", async () => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: 10, recuperacaoId: null, conversationId: "conv_1", status: "BOT" })
      .mockResolvedValue({ id: 1, providerId: 42, customerId: 7, casoId: 10, recuperacaoId: null, conversationId: "conv_1", status: "OPEN" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "é engano, não conheço")] });
    await executarFilaAutonomia();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledTimes(1);
    expect(armazem.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Conferir telefone do cadastro" }), null);
  });
  it("número errado na retirada: a tentativa “Número inválido” vai ao caso de recuperação, que não tem próxima ação", async () => {
    armazem.getConversaDoChat.mockResolvedValue({ id: 1, providerId: 42, customerId: 7, casoId: null, recuperacaoId: 9, conversationId: "conv_1", status: "BOT" });
    agentes.listarAgentesDoChat.mockResolvedValue({ agentes: [{ tipo: "recuperacao_equipamentos", habilitado: true, etapa: "pronto", id: "ag_equip", modelo: "openai/gpt-4.1", nomeDaPersona: "Eduarda" }] });
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "é engano, não conheço")] });
    await executarFilaAutonomia();
    expect(armazem.addRecoveryAttempt).toHaveBeenCalledWith(expect.objectContaining({ providerId: 42, caseId: 9, userId: null, channel: "whatsapp", result: "numero_invalido" }));
    expect(fila.cancelar).toHaveBeenCalled();
    expect(avisou()).toBe(false);
  });
});


describe("proposta e confirmação", () => {
  it("promessa: primeiro a PERGUNTA com valor integral e data em dd/mm; depois o “sim” grava — sem chamar o modelo de novo", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "consigo pagar dia 10/9")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "promessa", data: "2026-09-10", valor: 150 } });
    await executarFilaAutonomia();
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: AGORA.toISOString(), messageId: "m1" };
    expect(fila.proposta).toHaveBeenCalledWith(42, "conv_1", proposta);
    expect(textoEnviado()).toMatch(/R\$ 150,00/);
    expect(textoEnviado()).toMatch(/10\/09\?$/);
    expect(textoEnviado()).not.toMatch(/2026-09-10|ERP|Responda/);
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();
    const pergunta = textoEnviado();

    vi.clearAllMocks();
    const JOB2 = { ...JOB, id: 16, message_id: "m2" };
    fila.proximos.mockResolvedValue([JOB2]);
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    vi.setSystemTime(new Date(AGORA.getTime() + 5 * 60_000));
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "consigo pagar dia 10/9"), outbound("o1", pergunta, "2026-09-06T15:00:30Z"), inbound("m2", "pode anotar", "2026-09-06T15:04:00Z")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(agente.registrarPromessaDoAgente).toHaveBeenCalledWith(42, expect.objectContaining({ telefone: "43999990000", dataPrometida: "2026-09-10", valor: 150, conversaId: "conv_1" }));
    expect(fila.proposta).toHaveBeenCalledWith(42, "conv_1", null);
    expect(textoEnviado()).toMatch(/10\/09/);
    expect(textoEnviado()).toMatch(/R\$ 150,00/);
    expect(statusMarcados()).toEqual(["enviando", "concluido"]);
  });
  it("o “ok” a outra pergunta não confirma a proposta que ficou para trás: o último balão tem que ser a pergunta", async () => {
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 10 * 60_000).toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", "Posso anotar o pagamento de R$ 150,00 pra quinta, dia 10/09?", "2026-09-06T14:50:00Z"), outbound("o2", "Tô aqui pra te ajudar com isso.", "2026-09-06T14:55:00Z"), inbound("m1", "ok")] });
    await executarFilaAutonomia();
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).toHaveBeenCalledOnce();
  });
  it("modelo propõe desconto (valor menor que o saldo) ou data não citada: transfere com aviso, nada é gravado", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "consigo pagar dia 10/9")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "promessa", data: "2026-09-10", valor: 100 } });
    await executarFilaAutonomia();
    expect(fila.proposta).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("Data, valor ou horário não confirmados"));
    expect(avisou()).toBe(true);
    expect(textoDoAviso()).not.toMatch(/100|150/);
  });
  /**
   * 21:30 em Brasília já é o dia seguinte em UTC. A oferta de datas usa o
   * calendário de São Paulo (`dataLocal`); a confirmação comparava com o dia em
   * UTC, então toda promessa feita para HOJE, à noite, era recusada como passada
   * e a conversa ia ao atendente sem motivo.
   */
  it("às 21:30 de Brasília, a promessa para HOJE ainda é hoje: grava", async () => {
    vi.setSystemTime(new Date("2026-09-10T00:30:00Z"));
    seguranca.ler.mockImplementation(async () => ({ identidade: identidadeConfirmada(), ofertas: null }));
    const proposta = { acao: "promessa", data: "2026-09-09", valor: 150, criadaEm: new Date("2026-09-10T00:25:00Z").toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim", "2026-09-10T00:29:00Z")] });
    await executarFilaAutonomia();
    expect(agente.registrarPromessaDoAgente).toHaveBeenCalledWith(42, expect.objectContaining({ dataPrometida: "2026-09-09", valor: 150 }));
    expect(textoEnviado()).toMatch(/hoje, dia 09\/09/);
    expect(fila.cancelar).not.toHaveBeenCalled();
  });
  it("a confirmação tardia (oferta de fora do episódio de 6 h) não grava: vira nova intenção e a oferta antiga cai", async () => {
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 6 * 60 * 60_000 - 60_000).toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim")] });
    await executarFilaAutonomia();
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();
    expect(fila.proposta).toHaveBeenCalledWith(42, "conv_1", null);
    expect(cliente.planejarAutonomia).toHaveBeenCalledTimes(1);
  });
});

describe("chave D9 ligada: a funcionária escreve e o servidor confere (D6, §5)", () => {
  beforeEach(() => { ligarChaveD9(); });
  it("o planejador recebe `escrever` e os sinais do caso; os balões verificados saem como a funcionária (lote do agente)", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", "Oi! Aqui é a Clara, da NsLink 😊"), inbound("m1", "quanto devo?")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "responder", resposta: "informar_divida", mensagens: ["Olhando aqui, tem R$ 150,00 em aberto.", "Consegue resolver hoje?"] } });
    await executarFilaAutonomia();
    const pedido = cliente.planejarAutonomia.mock.calls[0][2];
    expect(pedido.escrever).toBe(true);
    expect(JSON.parse(pedido.context)).toMatchObject({
      primeiroNome: "Maria", nomeProvedor: "NsLink", nomeDaPersona: "Clara", diasAtraso: 20, situacao: "conversa",
      mesesDeCliente: expect.any(Number), promessasAnteriores: { total: 1, ultimaData: "2026-08-20" },
    });
    expect(cliente.enviarComoAgente).toHaveBeenCalledWith("org_42", "conv_1", "ag_ativos", ["Olhando aqui, tem R$ 150,00 em aberto.", "Consegue resolver hoje?"]);
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(comOrcamentoContato).toHaveBeenCalledOnce();
  });
  it("balões recusados pelo verificador: a AÇÃO segue e sai a reserva; o log leva só o código", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "responder", resposta: "informar_divida", mensagens: ["Fica tranquila, paga R$ 99,00 e a gente não corta, tá?"] } });
    await executarFilaAutonomia();
    const enviados = cliente.enviarComoAgente.mock.calls[0][3] as string[];
    expect(enviados.join(" ")).toContain("R$ 150,00");
    expect(enviados.join(" ")).not.toMatch(/99|tranquila|corta/);
    const recusa = loggerMock.info.mock.calls.find(c => c[0]?.etapa === "verificador");
    expect(recusa?.[0]).toEqual({ providerId: 42, jobId: 15, etapa: "verificador", codigo: expect.any(String) });
  });
  it("e2: timeout do planejador com `escrever` repete UMA vez sem escrever; a reserva responde e nada vai à equipe", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: false, erro: "O Chat BullQ não respondeu em 45s" })
      .mockResolvedValueOnce({ ok: true, valor: { acao: "responder", resposta: "informar_divida" } });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).toHaveBeenCalledTimes(2);
    const segundo = cliente.planejarAutonomia.mock.calls[1][2];
    expect(segundo).not.toHaveProperty("escrever");
    expect(segundo.requestId).toMatch(/_sem_escrita$/);
    expect(fila.cancelar).not.toHaveBeenCalled();
    expect((cliente.enviarComoAgente.mock.calls[0][3] as string[]).join(" ")).toContain("R$ 150,00");
  });
  it("s9: a segunda via busca e valida o instrumento ANTES de qualquer balão; a introdução da IA vem sem número e o instrumento em balão próprio", async () => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "manda a segunda via")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "segunda_via", faturaId: "f1", mensagens: ["Claro! Segue aqui embaixo."] } });
    await executarFilaAutonomia();
    expect(contexto.segundaViaDoAtendimento).toHaveBeenCalledWith(42, "conv_1", "f1");
    expect(contexto.segundaViaDoAtendimento.mock.invocationCallOrder[0]).toBeLessThan(cliente.enviarComoAgente.mock.invocationCallOrder[0]);
    const [intro, instrumento] = cliente.enviarComoAgente.mock.calls[0][3] as string[];
    expect(intro).toBe("Claro! Segue aqui embaixo.");
    expect(instrumento).toMatch(/https:\/\/erp\.example\/boleto\/f1/);
    expect(instrumento).toMatch(/10\/08\/2026/);
  });
  it("s9: sem instrumento no ERP, nenhum balão da IA sai — a conversa vai à equipe com o aviso", async () => {
    contexto.segundaViaDoAtendimento.mockResolvedValueOnce({ ref: "f1", valor: 150, vencimento: "2026-08-10", linhaDigitavel: null, pix: null, link: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "manda a segunda via")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "segunda_via", faturaId: "f1", mensagens: ["Claro! Segue aqui embaixo."] } });
    await executarFilaAutonomia();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("Segunda via indisponível"));
    expect(todosOsTextos()).not.toContain("Claro! Segue aqui embaixo.");
    // só o aviso sai (um lote da funcionária), e sem o texto da IA
    expect(cliente.enviarComoAgente.mock.calls.length + cliente.enviarTexto.mock.calls.length).toBe(1);
    expect(avisou()).toBe(true);
  });
  it("confirmação gravada: nova chamada com allowedActions [\"responder\"], escrever e a situação; a frase cita exatamente o gravado", async () => {
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 60_000).toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", "Posso anotar o pagamento de R$ 150,00 pra quinta, dia 10/09?", "2026-09-06T14:58:00Z"), inbound("m1", "sim")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "responder", mensagens: ["Anotado! R$ 150,00 pra quinta, dia 10/09. Obrigada!"] } });
    await executarFilaAutonomia();
    expect(agente.registrarPromessaDoAgente).toHaveBeenCalled();
    // a ação ANTES da redação
    expect(agente.registrarPromessaDoAgente.mock.invocationCallOrder[0]).toBeLessThan(cliente.planejarAutonomia.mock.invocationCallOrder[0]);
    const pedido = cliente.planejarAutonomia.mock.calls[0][2];
    expect(pedido).toMatchObject({ allowedActions: ["responder"], escrever: true });
    expect(pedido.requestId).toMatch(/^redacao_15_confirmacao_/);
    expect(JSON.parse(pedido.context)).toMatchObject({ situacao: "promessa_registrada", gravado: { tipo: "promessa", data: "2026-09-10", valor: 150 } });
    expect(cliente.enviarComoAgente.mock.calls[0][3]).toEqual(["Anotado! R$ 150,00 pra quinta, dia 10/09. Obrigada!"]);
  });
  it("confirmação gravada com o planejador fora: a reserva confirma — a promessa já está gravada e não vai à equipe", async () => {
    const proposta = { acao: "promessa", data: "2026-09-10", valor: 150, criadaEm: new Date(AGORA.getTime() - 60_000).toISOString(), messageId: "m0" };
    fila.estado.mockResolvedValueOnce({ turnos: 1, humano: false, proposta, motivo: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: false, erro: "fora", status: 502 });
    await executarFilaAutonomia();
    expect(fila.cancelar).not.toHaveBeenCalled();
    expect((cliente.enviarComoAgente.mock.calls[0][3] as string[]).join(" ")).toMatch(/10\/09/);
  });
  it("antes da identidade o texto continua sendo do servidor: o desafio sai como a funcionária, sem chamar o planejador (D5)", async () => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [outbound("o1", "Oi! Aqui é a Clara, da NsLink 😊"), inbound("m1", "você é robô?")] });
    await executarFilaAutonomia();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    const [, , agenteId, baloes] = cliente.enviarComoAgente.mock.calls[0] as [string, string, string, string[]];
    expect(agenteId).toBe("ag_ativos");
    expect(baloes.join(" ")).toMatch(/automatizado/);
    expect(baloes.join(" ")).toContain("4 últimos dígitos do seu CPF");
    // já se apresentou na abertura: não repete "Aqui é a Clara" (f18)
    expect(baloes.join(" ")).not.toMatch(/Aqui é a Clara/);
  });
  it("negociação: a introdução escrita pela funcionária (sem número) e as linhas das opções do servidor num balão próprio", async () => {
    fila.config.mockResolvedValueOnce({ ativa: true, maxTurnos: 12, permitirNegociacao: true, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] });
    const politica = structuredClone(POLITICA_PADRAO); politica.acordo.ativo.origemDaCobranca = "manual";
    armazem.getPoliticaDeCobranca.mockResolvedValue(politica);
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "tem desconto?")] });
    cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "responder", mensagens: ["Consegui algumas condições pra você dentro da nossa política.", "Me diz qual opção prefere e o dia do primeiro pagamento."] } });
    await executarFilaAutonomia();
    const pedido = cliente.planejarAutonomia.mock.calls[0][2];
    expect(pedido).toMatchObject({ allowedActions: ["responder"], escrever: true });
    expect(JSON.parse(pedido.context)).toMatchObject({ situacao: "apresentar_ofertas" });
    const baloes = cliente.enviarComoAgente.mock.calls[0][3] as string[];
    expect(baloes.slice(0, 2)).toEqual(["Consegui algumas condições pra você dentro da nossa política.", "Me diz qual opção prefere e o dia do primeiro pagamento."]);
    expect(baloes[2]).toMatch(/^Opção 1: R\$ /);
  });
  it("aceite de acordo com identidade de mais de 2 h: pede os dígitos de novo e a opção escolhida continua (D10)", async () => {
    fila.config.mockResolvedValueOnce({ ativa: true, maxTurnos: 12, permitirNegociacao: true, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] });
    const politica = structuredClone(POLITICA_PADRAO); politica.acordo.ativo.origemDaCobranca = "manual";
    armazem.getPoliticaDeCobranca.mockResolvedValue(politica);
    const { calcularOfertasAutonomia } = await import("./chat-autonomia-ofertas");
    const base = calcularOfertasAutonomia({ customerId: 7, carteira: "ativo", saldo: 150, diasAtraso: 20, mensalidade: null, vulneravel: false }, politica, "m0", new Date(AGORA.getTime() - 10 * 60_000));
    const selecionada = { ...base, selecionada: 0 };
    const velha = identidadeConfirmada(3 * 60 * 60_000);
    seguranca.ler.mockImplementation(async () => ({ identidade: { ...velha!, validaAte: new Date(AGORA.getTime() + 60 * 60_000).toISOString() }, ofertas: selecionada }));
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim")] });
    await executarFilaAutonomia();
    expect(seguranca.identidade).toHaveBeenLastCalledWith(42, "conv_1", expect.objectContaining({ confirmadaEm: null }));
    expect(todosOsTextos().join(" ")).toContain("4 últimos dígitos do seu CPF");
    expect(seguranca.ofertas).not.toHaveBeenCalledWith(42, "conv_1", null);
    expect(fila.cancelar).not.toHaveBeenCalled();
  });
});

describe("o que sai junto com a transferência chega ao cliente — o lote do agente para na IA desligada (vps/010, revisão final)", () => {
  /**
   * O fork com a regra do vps/010: o lote aceito PARA — nenhum balão sai — quando a IA da conversa é desligada DEPOIS
   * de ele ser criado (`aiDisabledAt` posterior ao lote; o processor confere de novo depois do "digitando…"). O relógio
   * é a ordem das chamadas. Com o mock simples, que só aceita o lote, a frase "saía" mesmo mandada antes de transferir.
   */
  function forkComLoteDoAgente() {
    let relogio = 0, iaDesligadaEm = -1;
    const lotes: { criadoEm: number; textos: string[] }[] = [];
    cliente.desligarIa.mockImplementation(async () => { iaDesligadaEm = ++relogio; return { ok: true, valor: undefined }; });
    cliente.enviarComoAgente.mockImplementation(async (_o: string, _c: string, _a: string, textos: string[]) => {
      lotes.push({ criadoEm: ++relogio, textos });
      return { ok: true, valor: { loteId: `l${lotes.length}`, mensagens: textos.map((_, i) => ({ messageId: `lote_${lotes.length}_${i}`, status: "QUEUED" })) } };
    });
    return { lotes, entregues: () => lotes.filter(l => !(iaDesligadaEm > l.criadoEm)).flatMap(l => l.textos) };
  }
  async function aceitarAcordo() {
    fila.config.mockResolvedValue({ ativa: true, maxTurnos: 12, permitirNegociacao: true, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos: ["cobranca_ativos"] });
    const politica = structuredClone(POLITICA_PADRAO); politica.acordo.ativo.origemDaCobranca = "manual";
    armazem.getPoliticaDeCobranca.mockResolvedValue(politica);
    const { calcularOfertasAutonomia } = await import("./chat-autonomia-ofertas");
    const base = calcularOfertasAutonomia({ customerId: 7, carteira: "ativo", saldo: 150, diasAtraso: 20, mensalidade: null, vulneravel: false }, politica, "m0", new Date(AGORA.getTime() - 10 * 60_000));
    seguranca.ler.mockImplementation(async () => ({ identidade: identidadeConfirmada(), ofertas: { ...base, selecionada: 0 } }));
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "sim")] });
    const vencimento = base.ofertas[0].vencimentos[0];
    return `${vencimento.slice(8, 10)}/${vencimento.slice(5, 7)}`;
  }

  it("chave ligada, acordo aceito: a conversa vai à equipe ANTES do lote, e a confirmação com a data e o valor registrados chega", async () => {
    ligarChaveD9();
    const fork = forkComLoteDoAgente();
    const data = await aceitarAcordo();
    await executarFilaAutonomia();
    expect(armazem.criarNegociacao).toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("Acordo aceito"));
    expect(cliente.desligarIa.mock.invocationCallOrder[0]).toBeLessThan(cliente.enviarComoAgente.mock.invocationCallOrder[0]);
    const entregue = fork.entregues().join(" ");
    expect(entregue).toMatch(/acordo/i);
    expect(entregue).toContain(data);
    expect(entregue).toMatch(/R\$ \d/);
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.anything(), null, "Assistente autônomo registrou o acordo aceito pelo cliente");
    expect(armazem.atualizarCasoDeCobranca).not.toHaveBeenCalledWith(42, 10, expect.objectContaining({ proximaAcao: "Responder no chat" }), null);
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.stringContaining("Acordo aceito"));
  });
  it("chave desligada, acordo aceito: a mesma ordem pelo envio comum", async () => {
    const data = await aceitarAcordo();
    await executarFilaAutonomia();
    expect(cliente.desligarIa.mock.invocationCallOrder[0]).toBeLessThan(cliente.enviarTexto.mock.invocationCallOrder[0]);
    expect(textoEnviado()).toMatch(/acordo/i);
    expect(textoEnviado()).toContain(data);
    expect(cliente.enviarComoAgente).not.toHaveBeenCalled();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.stringContaining("Acordo aceito"));
  });
  it("chave ligada, acordo aceito e o lote recusado: a linha do tempo diz que a confirmação não saiu, e nada é reenviado", async () => {
    ligarChaveD9();
    await aceitarAcordo();
    cliente.enviarComoAgente.mockResolvedValueOnce({ ok: false, erro: "O Chat BullQ não respondeu em 30s" });
    await executarFilaAutonomia();
    expect(cliente.enviarComoAgente).toHaveBeenCalledTimes(1);
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.anything(), null, expect.stringContaining("não confirmou o envio"));
    expect(armazem.registrarEventoDoChat).not.toHaveBeenCalledWith(42, expect.anything(), null, "Assistente autônomo registrou o acordo aceito pelo cliente");
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.stringContaining("Acordo aceito"));
  });

  const semIdentidade = () => seguranca.ler.mockImplementation(async () => ({ identidade: null, ofertas: null }));
  it.each([
    { nome: "pediu para parar", texto: "para de mandar mensagem", frase: /não (vou mais te mandar|te mando mais)/i, preparar: semIdentidade },
    { nome: "número errado", texto: "é engano, não conheço", frase: /desculpa/i, preparar: semIdentidade },
    { nome: "contestação de titularidade", texto: "não contratei nada, isso é fraude", frase: /verificar esse cadastro/, preparar: semIdentidade },
    { nome: "tentativas esgotadas", texto: "1234", frase: /(parar|encerrar) por aqui/, preparar: () => { semIdentidade(); seguranca.tentativasDoCliente.mockResolvedValueOnce({ em24h: 3, em30Dias: 3 }); } },
    { nome: "pediu para parar com a identidade vigente", texto: "me tira da lista", frase: /não (vou mais te mandar|te mando mais)/i, preparar: () => {} },
  ])("chave ligada, $nome: transfere ANTES do lote, a frase própria chega e não há aviso", async ({ texto, frase, preparar }) => {
    ligarChaveD9();
    const fork = forkComLoteDoAgente();
    preparar();
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", texto)] });
    await executarFilaAutonomia();
    expect(cliente.desligarIa).toHaveBeenCalled();
    expect(cliente.enviarComoAgente).toHaveBeenCalledTimes(1);
    expect(cliente.desligarIa.mock.invocationCallOrder[0]).toBeLessThan(cliente.enviarComoAgente.mock.invocationCallOrder[0]);
    expect(fork.entregues().join(" ")).toMatch(frase);
    expect(avisou()).toBe(false);
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
    if (/parar/.test(texto) || /lista/.test(texto)) {
      // `nao_contatar` depois da frase: gravado antes, o orçamento recusaria a própria confirmação do pedido
      expect(preferencias.pausarComunicacao).toHaveBeenCalledWith(42, 7, null, "nao_contatar");
      expect(cliente.enviarComoAgente.mock.invocationCallOrder[0]).toBeLessThan(preferencias.pausarComunicacao.mock.invocationCallOrder[0]);
    }
  });
  it("pediu para parar e a transferência lança (fork fora): o `nao_contatar` é gravado do mesmo jeito, sem frase", async () => {
    seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
    cliente.desligarIa.mockResolvedValue({ ok: false, erro: "fora do ar" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "para de mandar mensagem")] });
    await expect(executarFilaAutonomia()).resolves.toBeUndefined();
    expect(preferencias.pausarComunicacao).toHaveBeenCalledWith(42, 7, null, "nao_contatar");
    expect(todosOsTextos()).toEqual([]);
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
  });
});

describe("transferir em exceção (§3.3) e a tabela motivo → avisa / não avisa (§3.4, achado e16)", () => {
  it.each(["já paguei ontem", "quero falar com atendente", "vocês vão me negativar?", "vou no Procon"])("“%s”: bloqueia local, PENDING no chat, IA de lá desligada, e só DEPOIS o aviso", async texto => {
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", texto)] });
    await executarFilaAutonomia();
    expect(fila.turno).not.toHaveBeenCalled();
    expect(cliente.planejarAutonomia).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("exige conferência"));
    expect(armazem.atualizarConversaDoChat).toHaveBeenCalledWith(42, "conv_1", { status: "PENDING" });
    expect(cliente.desligarIa).toHaveBeenCalledWith("org_42", "conv_1");
    expect(cliente.atribuir).toHaveBeenCalledWith("org_42", "conv_1", { status: "PENDING" });
    expect(armazem.registrarEventoDoChat).toHaveBeenCalledWith(42, expect.anything(), null, expect.stringContaining("transferiu ao atendente"));
    expect(avisou()).toBe(true);
    expect(textoDoAviso()).not.toMatch(/já já|em instantes|hoje ainda|rapidinho/);
    if (texto.includes("atendente")) expect(textoDoAviso()).toMatch(/automatizado/);
  });

  type Linha = { motivo: string; preparar: () => void; avisa: boolean };
  const semIdentidade = () => seguranca.ler.mockResolvedValueOnce({ identidade: null, ofertas: null });
  const mensagem = (texto: string) => cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", texto)] });
  const TABELA: Linha[] = [
    { motivo: "pedido de pessoa (depois da identidade)", avisa: true, preparar: () => mensagem("quero falar com uma pessoa") },
    { motivo: "pagamento informado", avisa: true, preparar: () => mensagem("fiz o pix ontem") },
    { motivo: "pedido de pessoa antes da identidade (aviso neutro)", avisa: true, preparar: () => { semIdentidade(); mensagem("me passa pro atendente"); } },
    { motivo: "limite de rodadas", avisa: true, preparar: () => { fila.estado.mockResolvedValueOnce({ turnos: 12, humano: false, proposta: null, motivo: null }); mensagem("oi"); } },
    { motivo: "saldo não confirmado no ERP", avisa: true, preparar: () => { contexto.contextoDoAtendimento.mockResolvedValueOnce({ cliente: { divida: null, diasAtraso: null }, erp: { status: "indisponivel" }, faturas: [] }); mensagem("quanto devo?"); } },
    { motivo: "plano do modelo: transferir", avisa: true, preparar: () => { mensagem("quanto devo?"); cliente.planejarAutonomia.mockResolvedValueOnce({ ok: true, valor: { acao: "transferir", motivo: "x" } }); } },
    { motivo: "imagem (possível comprovante)", avisa: true, preparar: () => cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [midia("m1", "IMAGE")] }) },
    // não avisam: o motivo impede o contato, o canal falhou, ou alguém já cuida da conversa
    { motivo: "contestação aberta (orçamento)", avisa: false, preparar: () => { mensagem("quanto devo?"); vi.mocked(comOrcamentoContato).mockRejectedValueOnce(new Error("Fatura em contestação: conclua a análise antes de retomar os contatos.")); } },
    { motivo: "pedido para não contatar (orçamento)", avisa: false, preparar: () => { mensagem("quanto devo?"); vi.mocked(comOrcamentoContato).mockRejectedValueOnce(new Error("Cliente solicitou não receber contatos.")); } },
    { motivo: "cota diária (orçamento)", avisa: false, preparar: () => { mensagem("quanto devo?"); vi.mocked(comOrcamentoContato).mockRejectedValueOnce(new Error("Orçamento diário de mensagens deste cliente atingido.")); } },
    { motivo: "envio incerto (timeout)", avisa: false, preparar: () => { mensagem("quanto devo?"); cliente.enviarTexto.mockResolvedValueOnce({ ok: false, erro: "O Chat BullQ não respondeu em 30s" }); } },
    { motivo: "envio recusado (4xx)", avisa: false, preparar: () => { mensagem("quanto devo?"); cliente.enviarTexto.mockResolvedValueOnce({ ok: false, erro: "recusado", status: 422 }); } },
    { motivo: "fork ou LLM fora (planejador 502)", avisa: false, preparar: () => { mensagem("quanto devo?"); cliente.planejarAutonomia.mockResolvedValueOnce({ ok: false, erro: "Bad Gateway", status: 502 }); } },
    { motivo: "rodada interrompida", avisa: false, preparar: () => fila.proximos.mockResolvedValue([{ ...JOB, status: "enviando" }]) },
    { motivo: "vínculo de telefone divergente", avisa: false, preparar: () => { mensagem("quanto devo?"); cliente.buscarConversaPorTelefone.mockResolvedValueOnce({ ok: true, valor: { id: "outra", contact: { phone: "5543999990000" } } }); } },
    { motivo: "política de cobrança pausada", avisa: false, preparar: () => { mensagem("quanto devo?"); armazem.getPoliticaDeCobranca.mockResolvedValueOnce({ ...structuredClone(POLITICA_PADRAO), pausada: true }); } },
    { motivo: "número errado (frase própria)", avisa: false, preparar: () => { semIdentidade(); mensagem("é engano"); } },
    { motivo: "pediu para parar (frase própria)", avisa: false, preparar: () => { semIdentidade(); mensagem("não quero mais receber mensagem"); } },
    { motivo: "contesta titularidade (frase própria)", avisa: false, preparar: () => { semIdentidade(); mensagem("não reconheço essa dívida, sofri golpe"); } },
    { motivo: "tentativas esgotadas (frase própria)", avisa: false, preparar: () => { semIdentidade(); seguranca.tentativasDoCliente.mockResolvedValueOnce({ em24h: 3, em30Dias: 3 }); mensagem("1234"); } },
    // s10: o "já paguei" que recebeu o pedido dos dígitos é lido depois deles
    { motivo: "pagamento informado antes da identidade, e depois os dígitos", avisa: true, preparar: () => { semIdentidade(); cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m0", "já paguei", "2026-09-06T14:30:00Z"), outbound("o1", "Me confirma os 4 últimos dígitos do seu CPF?", "2026-09-06T14:31:00Z"), inbound("m1", "8909")] }); } },
    // §12: a resposta ao pré-aviso vai à equipe com aviso depois dos dígitos; com o telefone divergente, nada sai
    { motivo: "resposta ao pré-aviso, identidade confirmada", avisa: true, preparar: () => { semIdentidade(); armazem.getConversaDoChat.mockResolvedValue({ id: 1, providerId: 42, customerId: 7, casoId: null, recuperacaoId: null, conversationId: "conv_1", status: "WAITING" }); mensagem("8909"); } },
    { motivo: "resposta ao pré-aviso com telefone divergente", avisa: false, preparar: () => { armazem.getConversaDoChat.mockResolvedValue({ id: 1, providerId: 42, customerId: 7, casoId: null, recuperacaoId: null, conversationId: "conv_1", status: "WAITING" }); mensagem("oi"); cliente.buscarConversaPorTelefone.mockResolvedValueOnce({ ok: true, valor: { id: "outra", contact: { phone: "5543111110000" } } }); } },
    // s6 (revisão B5, rodada 2): as transferências que correm antes da triagem não convidam quem pediu para parar ou disse que é engano
    { motivo: "limite de rodadas + pediu para parar (frase própria)", avisa: false, preparar: () => { fila.estado.mockResolvedValueOnce({ turnos: 12, humano: false, proposta: null, motivo: null }); mensagem("para de mandar mensagem"); } },
    { motivo: "limite de rodadas sem identidade + número errado (frase própria)", avisa: false, preparar: () => { semIdentidade(); fila.estado.mockResolvedValueOnce({ turnos: 12, humano: false, proposta: null, motivo: null }); mensagem("é engano, não conheço essa pessoa"); } },
    { motivo: "caso pago + pediu para parar (frase própria)", avisa: false, preparar: () => { semIdentidade(); armazem.obterCasoDeCobranca.mockResolvedValue({ id: 10, cliente: { id: 7 }, carteira: "ativo", status: "pago" }); mensagem("não quero mais receber mensagem"); } },
    { motivo: "agente não pronto + contesta titularidade (frase própria)", avisa: false, preparar: () => { semIdentidade(); agentes.listarAgentesDoChat.mockResolvedValue({ agentes: [{ tipo: "cobranca_ativos", habilitado: false, etapa: "configurado", id: null, modelo: null }] }); mensagem("não contratei nada, isso é fraude"); } },
    // §3.4: autonomia pausada durante a rodada — a conversa vai à equipe, mas nada sai pela conversa
    { motivo: "autonomia pausada durante a rodada (pedido de pessoa)", avisa: false, preparar: () => { pausarDepoisDaPrimeiraLeitura(); mensagem("quero falar com uma pessoa"); } },
  ];
  it.each(TABELA)("$motivo → avisa: $avisa", async ({ preparar, avisa }) => {
    preparar();
    await expect(executarFilaAutonomia()).resolves.toBeUndefined();
    expect(fila.marcar).toHaveBeenLastCalledWith(expect.objectContaining({ id: 15 }), "humano", expect.any(String));
    expect(avisou()).toBe(avisa);
    // nenhum aviso promete prazo nem cita valor
    expect(textoDoAviso()).not.toMatch(/já já|em instantes|hoje ainda|150/);
  });
  it.each([
    { motivo: "humano assumiu antes do envio", preparar: () => armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: 10, recuperacaoId: null, conversationId: "conv_1", status: "BOT" }).mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: 10, recuperacaoId: null, conversationId: "conv_1", status: "OPEN" }) },
    { motivo: "mensagem mais nova do cliente", preparar: () => cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?"), inbound("m9", "oi?")] }) },
    { motivo: "autonomia pausada", preparar: () => fila.config.mockResolvedValueOnce({ ativa: false }) },
  ])("$motivo → cancela sem transferir e sem aviso", async ({ preparar }) => {
    cliente.listarMensagens.mockResolvedValue({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    preparar();
    await executarFilaAutonomia();
    expect(statusMarcados()).toContain("cancelado");
    expect(statusMarcados()).not.toContain("humano");
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
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
    armazem.obterCasoDeCobranca.mockResolvedValue({ id: 10, cliente: { id: 7 }, carteira: "ativo", status: "pago" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quero falar com atendente")] });
    await executarFilaAutonomia();
    expect(armazem.atualizarCasoDeCobranca).not.toHaveBeenCalled();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
  });
  it("falha ao gravar o follow-up não impede a entrega ao atendente", async () => {
    armazem.atualizarCasoDeCobranca.mockRejectedValueOnce(new Error("banco fora"));
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quero falar com atendente")] });
    await executarFilaAutonomia();
    expect(armazem.atualizarConversaDoChat).toHaveBeenCalledWith(42, "conv_1", { status: "PENDING" });
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
    expect(loggerMock.warn).toHaveBeenCalled();
  });
  it("aviso que falha (orçamento) não volta a rodada nem a transferência: o trabalho termina com o atendente", async () => {
    vi.mocked(comOrcamentoContato).mockRejectedValueOnce(new Error("Orçamento diário de mensagens deste cliente atingido."));
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quero falar com atendente")] });
    await expect(executarFilaAutonomia()).resolves.toBeUndefined();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.stringContaining("exige conferência"));
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.objectContaining({ etapa: "aviso", causa: expect.any(String) }), expect.any(String));
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
    expect(fila.turno).not.toHaveBeenCalled();
    expect(agente.registrarPromessaDoAgente).not.toHaveBeenCalled();
    expect(fila.proposta).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.stringContaining("não fala valor que não leu"));
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
    // O 150 da varredura não sai em lugar nenhum: nem no aviso, nem no pedido ao modelo.
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
    expect(JSON.stringify(cliente.enviarTexto.mock.calls)).not.toContain("150");
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

describe("histórico do planejador (e11)", () => {
  const msg = (i: number, direction: "INBOUND" | "OUTBOUND", text: string) => ({ id: `x${i}`, direction, type: "TEXT", content: { text }, status: "SENT", createdAt: new Date(Date.UTC(2026, 8, 6, 12, i)).toISOString() }) as any;
  it("12 itens; balões seguidos da funcionária viram um item; documento e dígitos do desafio saem", () => {
    const mensagens = [
      msg(0, "INBOUND", "oi, meu cpf 123.456.789-09 e final 8909"),
      msg(1, "OUTBOUND", "Oi! Aqui é a Clara, da NsLink 😊"),
      msg(2, "OUTBOUND", "Tô falando com Maria?"),
      ...Array.from({ length: 20 }, (_, i) => msg(3 + i, i % 2 ? "OUTBOUND" : "INBOUND", `m${i}`)),
    ];
    const h = historicoDoPlanejador(mensagens, "12345678909");
    expect(h).toHaveLength(12);
    const todos = historicoDoPlanejador(mensagens.slice(0, 3), "12345678909");
    expect(todos).toEqual([
      { role: "user", content: "oi, meu cpf [documento omitido] e final [confirmação omitida]" },
      { role: "assistant", content: "Oi! Aqui é a Clara, da NsLink 😊\n\nTô falando com Maria?" },
    ]);
  });
  it("cada item até 1.200 caracteres e a soma até 14.000", () => {
    const longo = "a".repeat(1500);
    const mensagens = Array.from({ length: 30 }, (_, i) => msg(i, i % 2 ? "OUTBOUND" : "INBOUND", longo));
    const h = historicoDoPlanejador(mensagens, "12345678909");
    expect(h.every(i => i.content.length <= 1200)).toBe(true);
    expect(h.reduce((s, i) => s + i.content.length, 0)).toBeLessThanOrEqual(14_000);
    expect(h.length).toBeLessThanOrEqual(12);
  });
});

describe("devolver ao assistente", () => {
  it("negociação exige autorização nominal de administrador do provedor", async () => {
    const config = { ativa: false, maxTurnos: 12, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, permitirNegociacao: true, tipos: ["cobranca_ativos" as const] };
    armazem.getUser.mockResolvedValueOnce({ id: 8, providerId: 99, role: "admin" });
    await expect(configurarAutonomia(42, config, 8)).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(fila.salvarConfig).not.toHaveBeenCalled();
    expect(seguranca.autorizar).not.toHaveBeenCalled();
    await configurarAutonomia(42, config, 8);
    expect(seguranca.autorizar).toHaveBeenCalledWith(42, 8);
    expect(fila.salvarConfig).toHaveBeenCalledWith(42, config);
  });
  it("humano=false: o chat vai a BOT primeiro, a IA de lá fica desligada, o estado volta e a linha do tempo registra quem devolveu", async () => {
    armazem.getConversaDoChat.mockResolvedValueOnce({ id: 1, providerId: 42, customerId: 7, casoId: 10, conversationId: "conv_1", status: "OPEN" });
    const r = await devolverAoAssistente(42, "conv_1", 8);
    expect(r).toEqual({ conversationId: "conv_1", status: "BOT", humano: false });
    expect(cliente.desligarIa).toHaveBeenCalledWith("org_42", "conv_1");
    expect(cliente.atribuir).toHaveBeenCalledWith("org_42", "conv_1", { status: "BOT" });
    expect(fila.devolver).toHaveBeenCalledWith(42, "conv_1", expect.any(String));
    // o que o cliente escreveu até aqui foi lido pelo atendente: não é pedido pendente do assistente (s10)
    expect(seguranca.identidade).toHaveBeenCalledWith(42, "conv_1", expect.objectContaining({ lidasComIdentidadeAte: AGORA.toISOString() }));
    expect(seguranca.revogar.mock.invocationCallOrder[0]).toBeLessThan(seguranca.identidade.mock.invocationCallOrder[0]);
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
  /**
   * A recusa do fork (VPS, 16/09/2026: a máquina de estados de lá respondeu 400
   * ao OPEN→BOT) subia como `Error` genérico, e a rota a escondia atrás do 503
   * "confira as migrações". Agora sobe como CHAT_FALHOU com o HTTP de lá e uma
   * frase de operador: o que se tentava, a razão em português (a máquina de
   * estados do fork fala "Invalid transition: OPEN → BOT" — a string REAL de
   * `conversation-fsm.service.ts`) e o que fazer. Nunca o jargão cru no toast.
   */
  it("se o Chat BullQ recusar o BOT, a recusa sobe como CHAT_FALHOU com a razão em português, o que fazer e o HTTP dele; o humano continua dono", async () => {
    cliente.atribuir.mockResolvedValueOnce({ ok: false, erro: "Invalid transition: OPEN → BOT", status: 400 });
    await expect(devolverAoAssistente(42, "conv_1", 8)).rejects.toMatchObject({
      codigo: "CHAT_FALHOU", status: 400,
      message: "Não foi possível devolver a conversa ao assistente: a conversa está em atendimento humano no Chat BullQ e de lá não passa direto a ficar com o assistente. Confira o status dela lá e tente de novo.",
    });
    expect(fila.devolver).not.toHaveBeenCalled();
    expect(armazem.atualizarConversaDoChat).not.toHaveBeenCalled();
    // Razão que não é da máquina de estados passa como veio (já é só o `message` da API), com o contexto em volta.
    cliente.atribuir.mockResolvedValueOnce({ ok: false, erro: "O Chat BullQ respondeu 500", status: 500 });
    await expect(devolverAoAssistente(42, "conv_1", 8)).rejects.toMatchObject({ codigo: "CHAT_FALHOU", status: 500, message: "Não foi possível devolver a conversa ao assistente: O Chat BullQ respondeu 500. Confira o status dela lá e tente de novo." });
    // Sem razão nenhuma, a frase genérica — nunca um erro mudo.
    cliente.desligarIa.mockResolvedValueOnce({ ok: false, erro: "" });
    await expect(devolverAoAssistente(42, "conv_1", 8)).rejects.toMatchObject({ codigo: "CHAT_FALHOU", message: expect.stringContaining("O Chat BullQ recusou a operação") });
    expect(fila.devolver).not.toHaveBeenCalled();
  });
});

describe("configurar a autonomia", () => {
  const cfg = (tipos: ConfigAutonomia["tipos"]): ConfigAutonomia => ({ ativa: true, maxTurnos: 12, permitirPromessa: true, permitirSegundaVia: true, permitirAgendamento: true, tipos });
  // O vocabulário é o da tela em volta: "agente" (nunca "perfil") e a seção "Agentes do chat", onde fica o botão Provisionar.
  it("tipo marcado sem agente provisionado: a recusa diz QUAL, pelo nome do catálogo — e todos, quando são vários", async () => {
    await expect(configurarAutonomia(42, cfg(["cobranca_ativos", "recuperacao_equipamentos"]), 8)).rejects.toMatchObject({
      codigo: "CONFLITO", message: "O agente “Recuperação de equipamentos” ainda não está provisionado. Provisione-o em Agentes do chat ou desmarque-o.",
    });
    agentes.listarAgentesDoChat.mockResolvedValueOnce({ agentes: [
      { tipo: "cobranca_ativos", habilitado: true, etapa: "pronto", id: "ag_ativos", modelo: "openai/gpt-4o-mini" },
      { tipo: "cobranca_ex_clientes", habilitado: true, etapa: "criado", id: "ag_ex", modelo: "openai/gpt-4o-mini" },
      { tipo: "recuperacao_equipamentos", habilitado: false, etapa: "configurado", id: null, modelo: null },
    ] });
    await expect(configurarAutonomia(42, cfg(["cobranca_ativos", "cobranca_ex_clientes", "recuperacao_equipamentos"]), 8)).rejects.toMatchObject({
      codigo: "CONFLITO", message: "Os agentes “Cobrança · ex-clientes” e “Recuperação de equipamentos” ainda não estão provisionados. Provisione-os em Agentes do chat ou desmarque-os.",
    });
    expect(fila.salvarConfig).not.toHaveBeenCalled();
    // Só agentes prontos marcados: grava.
    await configurarAutonomia(42, cfg(["cobranca_ativos", "cobranca_ex_clientes"]), 8);
    expect(fila.salvarConfig).toHaveBeenCalledWith(42, expect.objectContaining({ ativa: true, tipos: ["cobranca_ativos", "cobranca_ex_clientes"] }));
  });
  it("agente provisionado mas pausado (habilitado=false): a recusa diz que está pausado e onde habilitar — não que falta provisionar", async () => {
    agentes.listarAgentesDoChat.mockResolvedValue({ agentes: [
      { tipo: "cobranca_ativos", habilitado: false, etapa: "pronto", id: "ag_ativos", modelo: "openai/gpt-4o-mini" },
      { tipo: "cobranca_ex_clientes", habilitado: false, etapa: "pronto", id: "ag_ex", modelo: "openai/gpt-4o-mini" },
      { tipo: "recuperacao_equipamentos", habilitado: false, etapa: "configurado", id: null, modelo: null },
    ] });
    await expect(configurarAutonomia(42, cfg(["cobranca_ativos"]), 8)).rejects.toMatchObject({
      codigo: "CONFLITO", message: "O agente “Cobrança · clientes ativos” está pausado. Marque “Habilitado para abrir contato” em Agentes do chat ou desmarque-o aqui.",
    });
    // Os dois motivos juntos, cada grupo com a sua frase.
    await expect(configurarAutonomia(42, cfg(["cobranca_ativos", "cobranca_ex_clientes", "recuperacao_equipamentos"]), 8)).rejects.toMatchObject({
      codigo: "CONFLITO", message: "O agente “Recuperação de equipamentos” ainda não está provisionado. Provisione-o em Agentes do chat ou desmarque-o. Os agentes “Cobrança · clientes ativos” e “Cobrança · ex-clientes” estão pausados. Marque “Habilitado para abrir contato” em Agentes do chat ou desmarque-os aqui.",
    });
    expect(fila.salvarConfig).not.toHaveBeenCalled();
  });
  it("sem credencial de IA no Chat BullQ a recusa é pela credencial, antes de olhar agente", async () => {
    agentes.modelosDosAgentesDoChat.mockResolvedValueOnce({ configured: false, models: [] });
    await expect(configurarAutonomia(42, cfg(["cobranca_ativos"]), 8)).rejects.toMatchObject({ codigo: "CONFLITO", message: expect.stringContaining("credencial de IA") });
    expect(fila.salvarConfig).not.toHaveBeenCalled();
  });
});

describe("fila: o bloqueio do orçamento não deixa trabalho preso (spec §10, achado e1)", () => {
  it.each([
    "Fatura em contestação: conclua a análise antes de retomar os contatos.",
    "Cliente solicitou não receber contatos.",
    "Orçamento diário de mensagens deste cliente atingido.",
  ])("%s → transfere sem enviar, e o trabalho termina com o atendente", async (motivo) => {
    vi.mocked(comOrcamentoContato).mockRejectedValueOnce(new Error(motivo));
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await executarFilaAutonomia();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.cancelar).toHaveBeenCalledWith(42, "conv_1", expect.any(String));
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.any(String));
    expect(statusMarcados()).not.toContain("concluido");
  });
  it("se a própria transferência lança (fork fora), a fila leva o trabalho ao atendente e a volta termina sem erro", async () => {
    vi.mocked(comOrcamentoContato).mockRejectedValueOnce(new Error("Cliente solicitou não receber contatos."));
    cliente.desligarIa.mockResolvedValueOnce({ ok: false, erro: "fora do ar" });
    cliente.listarMensagens.mockResolvedValueOnce({ ok: true, valor: [inbound("m1", "quanto devo?")] });
    await expect(executarFilaAutonomia()).resolves.toBeUndefined();
    expect(cliente.enviarTexto).not.toHaveBeenCalled();
    expect(fila.marcar).toHaveBeenLastCalledWith(JOB, "humano", expect.stringContaining("sem reenvio automático"));
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
