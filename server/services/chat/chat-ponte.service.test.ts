// O orçamento de contato é falso (deixa passar), mas o `ErroGestao` é o REAL:
// a ponte tem de deixá-lo subir intacto para a rota virar 409 com o motivo.
vi.mock("../cobranca/gestao-operacional.service", async () => {
  const real = await vi.importActual<typeof import("../cobranca/gestao-operacional.service")>("../cobranca/gestao-operacional.service");
  return { ErroGestao: real.ErroGestao, comOrcamentoContato: vi.fn(async (_pid: number, _cid: number, _canal: string, _automatico: boolean, enviar: () => Promise<unknown>) => enviar()) };
});
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A ponte sob contrato: provisiona a organizacao do provedor uma vez; liga o
 * canal e marca o estado; "enviar para cobranca" reaproveita a conversa do
 * telefone quando ela existe, registra o evento de contato no caso, liga a
 * conversa ao caso e move aberto → em contato; sem canal, sem telefone ou com
 * o chat desligado, explica em portugues em vez de mandar meia mensagem.
 * O telefone nunca vai para o log.
 */

// `pool.query` só serve à pausa de contato (`cobranca_preferencias_contato`):
// sem linha = sem pausa. Os testes de pausa trocam a resposta.
const banco = vi.hoisted(() => ({ query: vi.fn(async () => ({ rowCount: 0, rows: [] })) }));
vi.mock("../../db", () => ({ pool: { query: banco.query }, db: {} }));
// A trava é passagem livre, mas REGISTRA que chaves estão tomadas: os testes da
// automação de retorno provam que a ida ao fork fica fora de `config:`.
const travas = vi.hoisted(() => ({ emCurso: [] as string[], tomadas: [] as string[] }));
vi.mock("./chat-trava", () => ({ comTravaDoChat: async (chave: string, executar: () => Promise<unknown>) => {
  travas.emCurso.push(chave); travas.tomadas.push(chave);
  try { return await executar(); } finally { travas.emCurso.splice(travas.emCurso.lastIndexOf(chave), 1); }
} }));
vi.mock("./chat-agente.service", () => ({ gerarChaveDoAgente: () => "chave-sintetica", hashDaChave: () => "hash-sintetico" }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }));
vi.mock("../../logger", () => ({ logger: log }));

const fake = vi.hoisted(() => ({
  integracao: undefined as any,
  provedor: { id: 6, name: "NsLink Telecom", tradeName: "NsLink", contactEmail: "dono@nslink.com" } as any,
  caso: undefined as any,
  recuperacoes: [] as any[],
  eventos: [] as any[],
  patches: [] as any[],
  conversasRegistradas: [] as any[],
  vinculoDoCaso: undefined as any,
}));
vi.mock("../../storage", () => ({
  storage: {
    getIntegracaoDoChat: vi.fn(async () => fake.integracao),
    upsertIntegracaoDoChat: vi.fn(async (_p: number, d: any) => { fake.integracao = { id: 1, providerId: _p, canalId: null, canalNome: null, status: "provisionado", ultimoErro: null, ...d }; return fake.integracao; }),
    marcarEstadoDaIntegracaoDoChat: vi.fn(async (_p: number, e: any) => { fake.integracao = { ...fake.integracao, ...e }; return fake.integracao; }),
    getProvider: vi.fn(async () => fake.provedor),
    obterCasoDeCobranca: vi.fn(async () => fake.caso),
    registrarConversaDoChat: vi.fn(async (_p: number, d: any) => { fake.conversasRegistradas.push(d); return { id: 50, ...d }; }),
    registrarEventoDeCobranca: vi.fn(async (_p: number, ev: any) => { fake.eventos.push(ev); return { id: 900, ...ev }; }),
    atualizarCasoDeCobranca: vi.fn(async (_p: number, id: number, patch: any) => { fake.patches.push({ id, patch }); return { id, ...patch }; }),
    getRecoveryCases: vi.fn(async () => fake.recuperacoes),
    getConversaDoChatPorCaso: vi.fn(async () => fake.vinculoDoCaso),
    getConversaDoChat: vi.fn(async () => fake.vinculoDoCaso),
    guardarAgenteDoChat: vi.fn(async (_p: number, d: Record<string, unknown>) => { fake.integracao = { ...fake.integracao, ...d }; return fake.integracao; }),
    registrarEventoDoChat: vi.fn(async () => undefined),
    // Sem política gravada vale a janela padrão (8h–20h, sem domingo).
    getPoliticaDeCobranca: vi.fn(async () => null),
  },
}));

import { ChatBullqClient } from "./chat-bullq.client";
import { storage } from "../../storage";
import {
  _usarClienteDoChatParaTestes, clienteDoChat, configurarCanalWhatsapp, conversaDoCaso, definirSenhaDoInbox, enviarCasoParaCobranca, enviarPreAvisoParaChat, enviarRecuperacaoParaChat, ErroDaPonteDoChat,
  estadoDaIntegracao, garantirIntegracao, garantirAgenteDeCobranca, garantirTransferenciaNaResposta, mensagemDeCobranca, mensagemDeRecuperacao, religarRetornoSePausado, retornoDaIntegracao,
  urlDaApiDoAgente, urlDoWebhookDeVolta,
} from "./chat-ponte.service";
import { limparChatSimuladoDoProvedor, URL_DO_CHAT_SIMULADO } from "../../demo/chat-simulado";
import { comOrcamentoContato, ErroGestao } from "../cobranca/gestao-operacional.service";
import { RETORNO_DESCONHECIDO } from "@shared/chat-whatsapp";

function clienteFalso(sobrescritas: Record<string, any> = {}) {
  const c = {
    provisionarOrganizacao: vi.fn(async () => ({ ok: true, valor: { organizationId: "org_1", slug: "isp-6", ownerUserId: "u1", ownerEmail: "dono@nslink.com", created: true } })),
    // O WhatsApp da plataforma (Evolution) e o caminho padrao; a Datafy e o unico
    // servico em que o provedor traz credencial. Zappfy e Uazapi nao sao mais
    // oferecidos (dono, 16/09/2026).
    criarCanalEvolution: vi.fn(async () => ({ ok: true, valor: { id: "ch_1", type: "WHATSAPP_EVOLUTION", name: "Principal", isActive: true } })),
    criarCanalWhatsapp: vi.fn(async () => ({ ok: true, valor: { id: "ch_2", type: "WHATSAPP_OFFICIAL", name: "Oficial", isActive: true } })),
    testarCanal: vi.fn(async () => ({ ok: true, valor: { ok: true } })),
    listarCanais: vi.fn(async () => ({ ok: true, valor: [] })),
    removerCanal: vi.fn(async () => ({ ok: true, valor: undefined })),
    capacidadesDosCanais: vi.fn(async () => ({ ok: true, valor: { whatsappUnofficial: true, instanceConnect: true, instanceStatus: true, provider: "ZAPPFY", uazapi: false, datafy: true, evolution: true, templateFirstContact: true } })),
    estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: true, valor: { provider: "ZAPPFY", status: "connected", connected: true, loggedIn: true, phone: "5543999990000", qrCode: null, pairCode: null } })),
    ligarAgenteAoCanal: vi.fn(async () => ({ ok: true, valor: undefined })),
    buscarConversaPorTelefone: vi.fn(async () => ({ ok: true, valor: null })),
    iniciarConversa: vi.fn(async () => ({ ok: true, valor: { conversationId: "conv_nova", messageId: "msg_1" } })),
    enviarTexto: vi.fn(async () => ({ ok: true, valor: { messageId: "msg_2", status: "QUEUED" } })),
    desligarIa: vi.fn(async () => ({ ok: true, valor: undefined })),
    criarAutomacao: vi.fn(async () => ({ ok: true, valor: { id: "auto_resposta" } })),
    listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [] })),
    religarAutomacao: vi.fn(async () => ({ ok: true, valor: undefined })),
    prepararPrimeiroContato: vi.fn(async (_org: string, id: string, contexto: { nomeCliente: string; nomeProvedor: string }) => ({ ok: true, valor: { texto: `Olá, ${contexto.nomeCliente}! Sou o assistente virtual da ${contexto.nomeProvedor}. Podemos conversar${id === "ag-equip" ? " sobre a devolução do equipamento" : ""}?`, agenteId: id, modelo: "sakana/modelo-real", runId: "draft-1" } })),
    listarMensagens: vi.fn(async () => ({ ok: true, valor: [{ id: "m1", direction: "OUTBOUND", type: "TEXT", content: { text: "Ola" }, status: "SENT", senderName: "NsLink", createdAt: "2026-09-05T10:00:00Z" }] })),
    definirSenhaDoOwner: vi.fn(async () => ({ ok: true, valor: { ownerUserId: "u1", ownerEmail: "dono@nslink.com" } })),
    ...sobrescritas,
  };
  _usarClienteDoChatParaTestes(c as any);
  return c;
}

/** O canal padrao dos testes: o WhatsApp da plataforma, sem token. */
const EVO = { provider: "EVOLUTION" as const, nome: "Principal" };
const CASO = {
  id: 10, status: "aberto", carteira: "ativo", etapaAtual: "aviso_suspensao", valorAtual: 189.9,
  cliente: { id: 42, nome: "Maria da Silva", cpfCnpj: "12345678909", telefone: "(43) 99999-0000", email: null, cidade: null, bairro: null, statusErp: "active", dividaAtual: 189.9, diasAtraso: 47, faturasAbertas: 2 },
};
// Segunda-feira, 10h em Brasília: dentro da janela padrão (8h–20h). Quem não fala
// de horário não pode depender da hora em que a suíte roda — o mesmo relógio de
// chat-multicanal.envio.test.ts.
const DENTRO_DA_JANELA = new Date("2026-09-14T13:00:00Z");
const FORA_DA_JANELA = new Date("2026-09-14T23:30:00Z"); // 20h30 em Brasília
const relogioEm = (instante: Date) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(instante); };
const comPausaVigente = () => banco.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] } as never);
const AGENTES_PRONTOS = { agentes: Object.fromEntries([["cobranca_ativos", "ag-ativos"], ["cobranca_ex_clientes", "ag-ex"], ["recuperacao_equipamentos", "ag-equip"]].map(([tipo, id]) => [tipo, { id, modelo: "sakana/modelo-real", habilitado: true, etapa: "pronto" }])) };

beforeEach(() => {
  fake.integracao = undefined;
  fake.caso = CASO;
  fake.recuperacoes = [];
  fake.eventos.length = 0;
  fake.patches.length = 0;
  fake.conversasRegistradas.length = 0;
  fake.vinculoDoCaso = undefined;
  vi.clearAllMocks();
  vi.useRealTimers();
  banco.query.mockReset().mockResolvedValue({ rowCount: 0, rows: [] } as never);
  process.env.CHAT_BULLQ_INBOX_URL = "https://chat.consultaisp.com.br/inbox/";
});

describe("chat desligado", () => {
  it("criação antiga sem modelo bloqueia explicitamente e preserva agenda e segredo", async () => {
    const c = clienteFalso({ criarTool: vi.fn(async () => ({ ok: true, valor: { id: "t1" } })), criarSkill: vi.fn(async () => ({ ok: true, valor: { id: "s1" } })), criarAgente: vi.fn(async () => ({ ok: true, valor: { id: "a1" } })), ligarSkillsAoAgente: vi.fn(async () => ({ ok: true, valor: {} })) });
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "dono@nslink.com", canalId: "ch_1", status: "ativo", webhookSecret: "segredo-existente-de-teste" };
    fake.integracao.agenteConfig = { respostaHumanaAutomacaoId: "a-retorno", primeiroContato: { ligada: true, limiteDiario: 5 }, modoAtendimento: "primeira_resposta_humana" };
    await expect(garantirAgenteDeCobranca(6)).rejects.toThrow(/modelo/i);
    expect(fake.integracao.webhookSecret).toBe("segredo-existente-de-teste");
    expect(fake.integracao.agenteConfig).toMatchObject({ respostaHumanaAutomacaoId: "a-retorno", primeiroContato: { ligada: true, limiteDiario: 5 } });
    expect(c.criarSkill).not.toHaveBeenCalled();
    expect(c.criarSkill.mock.calls.some(([, skill]) => skill?.nome === "registrarPromessa")).toBe(false);
  });
  it("sem cliente configurado, estado diz `ligado: false` e enviar falha com CHAT_DESLIGADO", async () => {
    _usarClienteDoChatParaTestes(null);
    expect((await estadoDaIntegracao(6)).ligado).toBe(false);
    await expect(enviarCasoParaCobranca(6, 10, 3)).rejects.toMatchObject({ codigo: "CHAT_DESLIGADO" });
  });
});

describe("garantirIntegracao", () => {
  it("provisiona a organizacao do provedor uma vez (externalId = providerId) e guarda o vinculo", async () => {
    const c = clienteFalso();
    const a = await garantirIntegracao(6);
    const b = await garantirIntegracao(6);
    expect(c.provisionarOrganizacao).toHaveBeenCalledTimes(1);
    expect(c.provisionarOrganizacao.mock.calls[0][0]).toMatchObject({ name: "NsLink", slug: "isp-6", ownerEmail: "dono@nslink.com", externalId: "6" });
    expect(a.organizationId).toBe("org_1");
    expect(b).toBe(fake.integracao);
  });
  it("provedor sem e-mail de contato ganha um endereco previsivel", async () => {
    fake.provedor = { ...fake.provedor, contactEmail: null };
    const c = clienteFalso();
    await garantirIntegracao(6);
    expect(c.provisionarOrganizacao.mock.calls[0][0].ownerEmail).toBe("provedor-6@consultaisp.com.br");
    fake.provedor = { ...fake.provedor, contactEmail: "dono@nslink.com" };
  });
  it("chat recusou: erro CHAT_FALHOU com a mensagem, e nada gravado", async () => {
    clienteFalso({ provisionarOrganizacao: vi.fn(async () => ({ ok: false, erro: "chave de plataforma invalida", status: 401 })) });
    await expect(garantirIntegracao(6)).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
    expect(fake.integracao).toBeUndefined();
  });
});

describe("configurarCanalWhatsapp", () => {
  it("um numero por provedor: ao salvar, os canais de WhatsApp antigos da organizacao saem do fork (com o nome, que e a confirmacao) — o novo e outros tipos ficam", async () => {
    const c = clienteFalso({ listarCanais: vi.fn(async () => ({ ok: true, valor: [
      { id: "ch_velho", type: "WHATSAPP_ZAPPFY", name: "WhatsApp principal", isActive: true },
      { id: "ch_1", type: "WHATSAPP_ZAPPFY", name: "Principal", isActive: true },
      { id: "ch_datafy", type: "WHATSAPP_OFFICIAL", name: "Oficial", isActive: true },
      { id: "ch_email", type: "EMAIL", name: "E-mail", isActive: true },
    ] })) });
    _usarClienteDoChatParaTestes(c as never);
    await configurarCanalWhatsapp(6, EVO);
    expect(c.removerCanal).toHaveBeenCalledTimes(2);
    expect(c.removerCanal).toHaveBeenCalledWith("org_1", "ch_velho", "WhatsApp principal");
    expect(c.removerCanal).toHaveBeenCalledWith("org_1", "ch_datafy", "Oficial");
    expect(c.removerCanal).not.toHaveBeenCalledWith("org_1", "ch_1", expect.anything());
  });
  it("remocao dos antigos que falha nao derruba o salvar: o canal novo ja esta de pe", async () => {
    const c = clienteFalso({
      listarCanais: vi.fn(async () => ({ ok: true, valor: [{ id: "ch_velho", type: "WHATSAPP_ZAPPFY", name: "Antigo", isActive: true }] })),
      removerCanal: vi.fn(async () => ({ ok: false, erro: "HTTP 500" })),
    });
    _usarClienteDoChatParaTestes(c as never);
    const r = await configurarCanalWhatsapp(6, EVO);
    expect(r.canalOk).toBe(true);
    expect(r.integracao.canalId).toBe("ch_1");
  });
  it("cria o canal, testa, confirma o numero conectado e logado, e so entao marca ativo", async () => {
    const c = clienteFalso();
    const r = await configurarCanalWhatsapp(6, EVO);
    expect(c.criarCanalEvolution).toHaveBeenCalledWith("org_1", { nome: "Principal" });
    expect(c.estadoDaConexaoWhatsapp).toHaveBeenCalledWith("org_1", "ch_1");
    expect(r.canalOk).toBe(true);
    expect(fake.integracao).toMatchObject({ status: "ativo", canalId: "ch_1", canalNome: "Principal", ultimoErro: null });
  });
  it("Evolution sem pareamento: canal criado nao liga — fica aguardando_conexao, e a automacao (que exige 'ativo') nao dispara", async () => {
    clienteFalso({ estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: true, valor: { provider: "EVOLUTION", status: "connecting", connected: false, loggedIn: false, phone: null, qrCode: null, pairCode: null } })) });
    const r = await configurarCanalWhatsapp(6, EVO);
    expect(r.canalOk).toBe(false);
    expect(fake.integracao).toMatchObject({ status: "aguardando_conexao", canalId: "ch_1", ultimoErro: "Aguardando o pareamento do WhatsApp" });
  });
  it("conectado mas nao logado tambem nao e ativo", async () => {
    clienteFalso({ estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: true, valor: { provider: "ZAPPFY", status: "connected", connected: true, loggedIn: false, phone: null, qrCode: null, pairCode: null } })) });
    await configurarCanalWhatsapp(6, EVO);
    expect(fake.integracao.status).toBe("aguardando_conexao");
  });
  it("connection-status indisponivel: diz a causa medida, nao inventa 'aguardando o pareamento'", async () => {
    clienteFalso({ estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: false, erro: "token=SEGREDO nao encontrado", status: 404 })) });
    await configurarCanalWhatsapp(6, EVO);
    expect(fake.integracao).toMatchObject({ status: "erro", ultimoErro: "Não foi possível consultar o estado da conexão: o chat respondeu HTTP 404" });
    // O texto bruto do gateway pode carregar credencial: nao vai para a coluna.
    expect(JSON.stringify(fake.integracao)).not.toContain("SEGREDO");
    fake.integracao = undefined;
    clienteFalso({ estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: false, erro: "fetch failed" })) });
    await configurarCanalWhatsapp(6, EVO);
    expect(fake.integracao).toMatchObject({ status: "erro", ultimoErro: "Não foi possível consultar o estado da conexão: o serviço não respondeu" });
  });
  it.each([
    ["ZAPPFY", { provider: "ZAPPFY", nome: "Principal", token: "tok_secreto_123" }],
    ["UAZAPI", { provider: "UAZAPI", nome: "Principal", token: "tok_secreto_123", baseUrl: "https://minha.uazapi.com" }],
  ])("%s nao e mais oferecido (dono, 16/09/2026): CHAT_SEM_SUPORTE antes de qualquer chamada ao fork, e o token nunca sai daqui", async (_nome, dados) => {
    const c = clienteFalso();
    await expect(configurarCanalWhatsapp(6, dados as never)).rejects.toMatchObject({ codigo: "CHAT_SEM_SUPORTE", message: expect.stringContaining("não são mais oferecidos") });
    expect(c.capacidadesDosCanais).not.toHaveBeenCalled();
    expect(c.criarCanalWhatsapp).not.toHaveBeenCalled();
    expect(c.criarCanalEvolution).not.toHaveBeenCalled();
    expect(fake.integracao.canalId).toBeNull();
    expect(JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls])).not.toContain("tok_secreto");
  });
  it("EVOLUTION (o WhatsApp da plataforma): sem token nenhum, o fork cria a instancia; fica aguardando o QR", async () => {
    const c = clienteFalso({
      capacidadesDosCanais: vi.fn(async () => ({ ok: true, valor: { whatsappUnofficial: true, instanceConnect: true, instanceStatus: true, provider: "ZAPPFY", uazapi: true, datafy: true, evolution: true, templateFirstContact: true } })),
      criarCanalEvolution: vi.fn(async () => ({ ok: true, valor: { id: "ch_evo", type: "WHATSAPP_EVOLUTION", name: "WhatsApp da plataforma", isActive: true } })),
      estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: true, valor: { provider: "EVOLUTION", status: "connecting", connected: false, loggedIn: false, phone: null, qrCode: null, pairCode: null } })),
    });
    const r = await configurarCanalWhatsapp(6, { provider: "EVOLUTION", nome: "WhatsApp da plataforma" });
    expect(c.capacidadesDosCanais).toHaveBeenCalledWith("org_1");
    expect(c.criarCanalEvolution).toHaveBeenCalledWith("org_1", { nome: "WhatsApp da plataforma" });
    expect(c.criarCanalWhatsapp).not.toHaveBeenCalled();
    expect(c.estadoDaConexaoWhatsapp).toHaveBeenCalledWith("org_1", "ch_evo");
    expect(r.canalOk).toBe(false);
    expect(fake.integracao).toMatchObject({ status: "aguardando_conexao", canalId: "ch_evo", canalNome: "WhatsApp da plataforma", agenteConfig: { whatsapp: { provider: "EVOLUTION" } } });
  });
  it("EVOLUTION sem a Evolution configurada no fork: CHAT_SEM_SUPORTE dizendo o que falta, e nada e criado", async () => {
    const c = clienteFalso({ capacidadesDosCanais: vi.fn(async () => ({ ok: true, valor: { whatsappUnofficial: true, instanceConnect: true, instanceStatus: true, provider: "ZAPPFY", uazapi: false, datafy: true, evolution: false, templateFirstContact: true } })) });
    await expect(configurarCanalWhatsapp(6, { provider: "EVOLUTION", nome: "WhatsApp da plataforma" })).rejects.toMatchObject({ codigo: "CHAT_SEM_SUPORTE", message: expect.stringContaining("Evolution") });
    expect(c.criarCanalEvolution).not.toHaveBeenCalled();
    expect(fake.integracao.canalId).toBeNull();
  });
  it("um numero por provedor vale para a Evolution: o canal Evolution antigo sai do fork ao salvar outro", async () => {
    const c = clienteFalso({ listarCanais: vi.fn(async () => ({ ok: true, valor: [
      { id: "ch_evo_velho", type: "WHATSAPP_EVOLUTION", name: "Plataforma antiga", isActive: true },
      { id: "ch_1", type: "WHATSAPP_ZAPPFY", name: "Principal", isActive: true },
    ] })) });
    await configurarCanalWhatsapp(6, EVO);
    expect(c.removerCanal).toHaveBeenCalledWith("org_1", "ch_evo_velho", "Plataforma antiga");
    expect(c.removerCanal).not.toHaveBeenCalledWith("org_1", "ch_1", expect.anything());
  });
  it("Datafy sem a capability no fork: CHAT_SEM_SUPORTE e o token nunca sai daqui", async () => {
    const c = clienteFalso({ capacidadesDosCanais: vi.fn(async () => ({ ok: true, valor: { whatsappUnofficial: true, instanceConnect: true, instanceStatus: true, provider: "ZAPPFY", uazapi: false, datafy: false, evolution: true, templateFirstContact: true } })) });
    await expect(configurarCanalWhatsapp(6, { provider: "DATAFY", nome: "Oficial", token: "tok_secreto_123", phoneNumberId: "123456789", webhookSecret: "whsec_segredo_datafy_1" })).rejects.toMatchObject({ codigo: "CHAT_SEM_SUPORTE", message: expect.stringContaining("ainda não aceita este serviço") });
    expect(c.criarCanalWhatsapp).not.toHaveBeenCalled();
    expect(c.criarCanalEvolution).not.toHaveBeenCalled();
    expect(fake.integracao.canalId).toBeNull();
    expect(JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls])).not.toContain("tok_secreto");
  });
  it("fork sem o endpoint de capabilities (404): recusa Datafy E Evolution — os dois dependem do que o fork anuncia, e nada e criado", async () => {
    const c = clienteFalso({ capacidadesDosCanais: vi.fn(async () => ({ ok: false, erro: "404", status: 404 })) });
    await expect(configurarCanalWhatsapp(6, { provider: "DATAFY", nome: "Oficial", token: "tok_secreto_123", phoneNumberId: "123456789", webhookSecret: "whsec_segredo_datafy_1" })).rejects.toMatchObject({ codigo: "CHAT_SEM_SUPORTE" });
    await expect(configurarCanalWhatsapp(6, EVO)).rejects.toMatchObject({ codigo: "CHAT_SEM_SUPORTE" });
    expect(c.criarCanalWhatsapp).not.toHaveBeenCalled();
    expect(c.criarCanalEvolution).not.toHaveBeenCalled();
  });
  it("Datafy (API oficial, sem QR): teste ok marca ativo sem consultar connection-status", async () => {
    const c = clienteFalso();
    const r = await configurarCanalWhatsapp(6, { provider: "DATAFY", nome: "Oficial", token: "tok_secreto_123", phoneNumberId: "123456789", webhookSecret: "whsec_segredo_datafy_1" });
    expect(c.estadoDaConexaoWhatsapp).not.toHaveBeenCalled();
    expect(r.canalOk).toBe(true);
    expect(fake.integracao).toMatchObject({ status: "ativo", agenteConfig: { whatsapp: { provider: "DATAFY", phoneNumberId: "123456789" } } });
  });
  it("com agente de cobranca ja criado, o numero novo e ligado a ele (o Chat BullQ so liga aos canais que existiam)", async () => {
    const c = clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: null, status: "provisionado", agenteId: "ag_1" };
    await configurarCanalWhatsapp(6, EVO);
    expect(c.ligarAgenteAoCanal).toHaveBeenCalledWith("org_1", "ag_1", "ch_1", "DISABLED");
  });
  it("canal novo e ligado DISABLED a TODOS os perfis de agente do provedor, sem repetir o legado", async () => {
    const c = clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: null, status: "provisionado", agenteId: "ag-ativos", agenteConfig: AGENTES_PRONTOS };
    await configurarCanalWhatsapp(6, EVO);
    const vinculos = c.ligarAgenteAoCanal.mock.calls.map(([org, agente, canal, modo]) => [org, agente, canal, modo]);
    expect(vinculos).toHaveLength(3);
    expect(vinculos).toEqual(expect.arrayContaining([["org_1", "ag-ativos", "ch_1", "DISABLED"], ["org_1", "ag-ex", "ch_1", "DISABLED"], ["org_1", "ag-equip", "ch_1", "DISABLED"]]));
    expect(vinculos.every(([, , , modo]) => modo === "DISABLED")).toBe(true);
  });
  it("perfil sem id ainda nao existe la: nao tenta ligar; vinculo que falha vira aviso sem derrubar o canal", async () => {
    const c = clienteFalso({ ligarAgenteAoCanal: vi.fn(async () => ({ ok: false, erro: "agent not found", status: 404 })) });
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: null, status: "provisionado", agenteConfig: { agentes: { cobranca_ativos: { id: "ag-ativos", etapa: "pronto" }, cobranca_ex_clientes: { etapa: "nao_configurado" } } } };
    const r = await configurarCanalWhatsapp(6, EVO);
    expect(c.ligarAgenteAoCanal).toHaveBeenCalledTimes(1);
    expect(c.ligarAgenteAoCanal).toHaveBeenCalledWith("org_1", "ag-ativos", "ch_1", "DISABLED");
    expect(r.canalOk).toBe(true);
    expect(log.warn).toHaveBeenCalled();
  });
  it("teste do canal falhou: fica em erro com o motivo, mas o canal fica guardado", async () => {
    const c = clienteFalso({ testarCanal: vi.fn(async () => ({ ok: true, valor: { ok: false, message: "instancia desconectada" } })) });
    const r = await configurarCanalWhatsapp(6, EVO);
    expect(r.canalOk).toBe(false);
    expect(c.estadoDaConexaoWhatsapp).not.toHaveBeenCalled();
    expect(fake.integracao).toMatchObject({ status: "erro", ultimoErro: "instancia desconectada", canalId: "ch_1" });
  });
  it("o token nunca aparece no log", async () => {
    clienteFalso({ criarCanalWhatsapp: vi.fn(async () => ({ ok: false, erro: "recusado: tok_secreto_123", status: 400 })) });
    await expect(configurarCanalWhatsapp(6, { provider: "DATAFY", nome: "Oficial", token: "tok_secreto_123", phoneNumberId: "123456789", webhookSecret: "whsec_segredo_datafy_1" })).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
    const tudo = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]);
    expect(tudo).not.toContain("tok_secreto");
  });
});

describe("enviarCasoParaCobranca", () => {
  const comCanal = () => { fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", canalNome: "Principal", status: "ativo", ultimoErro: null, agenteConfig: AGENTES_PRONTOS }; };
  it.each(["Maria, sua dívida é R$ 200", "Envie seu CPF", "Acesse https://isp.invalid/boleto"])("bloqueia primeiro texto manual antes da identidade: %s", async texto => {
    const c = clienteFalso(); comCanal();
    await expect(enviarCasoParaCobranca(6, 10, 3, texto)).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(c.iniciarConversa).not.toHaveBeenCalled();
    expect(fake.eventos).toEqual([]);
  });
  it("abertura de cobrança não depende da disponibilidade do modelo", async () => {
    const c = clienteFalso({ prepararPrimeiroContato: vi.fn(async () => ({ ok: false, erro: "Modelo sem credencial" })) }); comCanal();
    await expect(enviarCasoParaCobranca(6, 10, 3)).resolves.toMatchObject({ enviado: true });
    expect(c.prepararPrimeiroContato).not.toHaveBeenCalled();
    expect(fake.eventos[0].metadata).toMatchObject({ origemTexto: "abertura_controlada", chat: { agente: { modo: "abertura_controlada", modelo: null, runId: null } } });
  });
  it("ex-cliente usa seu agente exclusivo", async () => {
    const c = clienteFalso(); comCanal(); fake.caso = { ...CASO, carteira: "ex_cliente" };
    await enviarCasoParaCobranca(6, 10, 3);
    expect(c.prepararPrimeiroContato).not.toHaveBeenCalled();
    expect(fake.eventos[0].metadata).toMatchObject({ origemTexto: "abertura_controlada", chat: { agente: { agenteId: "ag-ex" } } });
  });
  it("cliques simultâneos no mesmo caso compartilham o primeiro contato", async () => {
    const c = clienteFalso(); comCanal();
    await Promise.all([enviarCasoParaCobranca(6, 10, 3), enviarCasoParaCobranca(6, 10, 3)]);
    expect(c.iniciarConversa).toHaveBeenCalledTimes(1);
    expect(fake.conversasRegistradas).toHaveLength(1);
  });
  it("Datafy usa template aprovado da carteira e registra a origem sem gerar texto de IA", async () => {
    const c = clienteFalso({ listarTemplatesWhatsapp: vi.fn(async () => ({ ok: true, valor: { data: [{ name: "primeiro_contato", language: "pt_BR", status: "APPROVED", components: [{ type: "BODY", text: "Olá, {{1}}! Aqui é o assistente virtual de {{2}}. Podemos conversar?" }] }] } })) });
    comCanal();
    fake.integracao.agenteConfig = { whatsapp: { provider: "DATAFY" }, templatesDatafy: { cobranca_ativos: { nome: "primeiro_contato", idioma: "pt_BR", variaveis: ["nomeCliente", "nomeProvedor"] } } };
    await enviarCasoParaCobranca(6, 10, 3);
    expect(c.prepararPrimeiroContato).not.toHaveBeenCalled();
    expect(c.iniciarConversa).toHaveBeenCalledWith("org_1", expect.objectContaining({ aiEnabled: false, template: { name: "primeiro_contato", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "NsLink" }] }] } }));
    expect(fake.eventos[0].metadata).toMatchObject({ origemTexto: "template_aprovado", chat: { template: { nome: "primeiro_contato", idioma: "pt_BR" } } });
  });
  it("Datafy sem template aprovado não envia nem substitui por texto livre", async () => {
    const c = clienteFalso({ listarTemplatesWhatsapp: vi.fn(async () => ({ ok: true, valor: { data: [] } })) });
    comCanal(); fake.integracao.agenteConfig = { whatsapp: { provider: "DATAFY" } };
    await expect(enviarCasoParaCobranca(6, 10, 3, "Texto manual")).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(c.iniciarConversa).not.toHaveBeenCalled();
  });
  it("consulta remota falhou: não abre outra conversa nem duplica mensagem", async () => {
    const c = clienteFalso({ buscarConversaPorTelefone: vi.fn(async () => ({ ok: false, erro: "timeout" })) }); comCanal();
    await expect(enviarCasoParaCobranca(6, 10, 3)).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
    expect(c.iniciarConversa).not.toHaveBeenCalled();
  });
  it("bloqueia caso pago antes de enviar", async () => {
    const c = clienteFalso(); comCanal(); fake.caso = { ...CASO, status: "pago" };
    await expect(enviarCasoParaCobranca(6, 10, 3)).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(c.iniciarConversa).not.toHaveBeenCalled();
  });

  it("sem canal ligado: SEM_CANAL, e nenhuma mensagem sai", async () => {
    const c = clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: null, status: "provisionado" };
    await expect(enviarCasoParaCobranca(6, 10, 3)).rejects.toMatchObject({ codigo: "SEM_CANAL" });
    expect(c.iniciarConversa).not.toHaveBeenCalled();
  });
  it("cliente sem telefone valido: SEM_TELEFONE", async () => {
    clienteFalso(); comCanal();
    fake.caso = { ...CASO, cliente: { ...CASO.cliente, telefone: "123" } };
    await expect(enviarCasoParaCobranca(6, 10, 3)).rejects.toMatchObject({ codigo: "SEM_TELEFONE" });
  });
  it("caso de outro provedor / inexistente: CASO_NAO_ENCONTRADO", async () => {
    clienteFalso(); comCanal();
    fake.caso = undefined;
    await expect(enviarCasoParaCobranca(6, 10, 3)).rejects.toMatchObject({ codigo: "CASO_NAO_ENCONTRADO" });
  });
  it("abre a conversa com a mensagem da regua, registra o evento de contato no caso, liga a conversa e move aberto → em contato", async () => {
    const c = clienteFalso(); comCanal();
    const r = await enviarCasoParaCobranca(6, 10, 3, null, "Lembrar do vencimento com cordialidade.");
    expect(c.iniciarConversa).toHaveBeenCalledTimes(1);
    const [org, dados] = c.iniciarConversa.mock.calls[0];
    expect(org).toBe("org_1");
    expect(dados).toMatchObject({ canalId: "ch_1", telefone: "5543999990000", nome: "Maria da Silva" });
    // §3.1: os dois balões — quem fala e de onde; depois, o titular e os dígitos. Com a chave D9 desligada saem numa
    // mensagem só: pelo envio comum o 2º podia chegar antes do 1º (a fila de saída do fork envia em paralelo)
    const [primeiro, segundo] = String(dados.texto).split("\n\n");
    expect(primeiro).toMatch(/é da equipe da NsLink 😊$/);
    expect(segundo).toMatch(/Maria/);
    expect(segundo).toContain("4 últimos dígitos do seu CPF");
    expect(c.enviarTexto).not.toHaveBeenCalled();
    expect(comOrcamentoContato).toHaveBeenCalledTimes(1);
    for (const t of [primeiro, segundo]) {
      expect(t).not.toMatch(/R\$|Silva|assistente virtual/);
      expect(t).not.toContain("Lembrar do vencimento com cordialidade.");
    }
    expect(dados.aiEnabled).toBe(false);
    expect(r).toMatchObject({ conversationId: "conv_nova", reaproveitada: false, messageId: "msg_1", inboxUrl: "https://chat.consultaisp.com.br/inbox" });
    expect(fake.conversasRegistradas[0]).toMatchObject({ customerId: 42, origem: "cobranca", casoId: 10, conversationId: "conv_nova", canalId: "ch_1", abertaPorUserId: 3 });
    expect(fake.eventos[0]).toMatchObject({ casoId: 10, userId: 3, tipo: "contato", canal: "whatsapp" });
    expect(fake.eventos[0].metadata.chat.conversationId).toBe("conv_nova");
    expect(fake.patches).toEqual([{ id: 10, patch: { status: "em_contato" } }]);
  });
  it("chave D9 ligada: o 2º balão da abertura sai como a funcionária (lote do agente); 404 do fork cai no envio comum; falha ambígua não reenvia", async () => {
    const lote = vi.fn(async (): Promise<any> => ({ ok: true, valor: { loteId: "l1", mensagens: [{ messageId: "msg_2", status: "QUEUED" }] } }));
    const c = clienteFalso({ enviarComoAgente: lote }); comCanal();
    fake.integracao.agenteConfig = { ...AGENTES_PRONTOS, funcionariaDigital: { ativa: true } };
    await enviarCasoParaCobranca(6, 10, 3);
    expect(lote).toHaveBeenCalledWith("org_1", "conv_nova", "ag-ativos", [expect.stringContaining("4 últimos dígitos do seu CPF")]);
    // ligada, o 1º balão abre a conversa sozinho: o lote do agente põe o 2º depois dele
    expect(c.iniciarConversa).toHaveBeenCalledWith("org_1", expect.objectContaining({ texto: expect.stringMatching(/é da equipe da NsLink 😊$/) }));
    expect(c.enviarTexto).not.toHaveBeenCalled();

    lote.mockResolvedValueOnce({ ok: false, erro: "Cannot POST /messages/agent-batch", status: 404 });
    fake.conversasRegistradas.length = 0; fake.eventos.length = 0;
    await enviarCasoParaCobranca(6, 10, 3);
    expect(c.enviarTexto).toHaveBeenCalledWith("org_1", "conv_nova", expect.stringContaining("4 últimos dígitos do seu CPF"));

    c.enviarTexto.mockClear();
    lote.mockResolvedValueOnce({ ok: false, erro: "O Chat BullQ não respondeu em 30s" });
    const r = await enviarCasoParaCobranca(6, 10, 3);
    expect(c.enviarTexto).not.toHaveBeenCalled();
    // a conversa foi aberta com o 1º balão: o contato aconteceu, e nada é repetido
    expect(r).toMatchObject({ enviado: true, conversationId: "conv_nova" });
  });
  it("texto do operador vence o modelo; caso ja em contato nao muda de status", async () => {
    const c = clienteFalso(); comCanal();
    fake.caso = { ...CASO, status: "em_contato" };
    await enviarCasoParaCobranca(6, 10, 3, "Oi Maria, tudo bem? Podemos conversar?");
    expect(c.iniciarConversa.mock.calls[0][1].texto).toBe("Oi Maria, tudo bem? Podemos conversar?");
    expect(fake.patches).toEqual([]);
  });
  it("conversa existente é aberta sem repetir primeiro contato", async () => {
    const c = clienteFalso({ buscarConversaPorTelefone: vi.fn(async () => ({ ok: true, valor: { id: "conv_velha", status: "OPEN", contact: { name: "Maria", phone: "5543999990000" }, channel: { id: "ch_1", type: "WHATSAPP_ZAPPFY", name: "Principal" }, assignedTo: null, aiEnabled: null, activeAgentId: null, lastMessageAt: null } })) }); comCanal();
    const r = await enviarCasoParaCobranca(6, 10, 3);
    expect(c.iniciarConversa).not.toHaveBeenCalled();
    expect(c.enviarTexto).not.toHaveBeenCalled();
    expect(c.prepararPrimeiroContato).not.toHaveBeenCalled();
    expect(r).toMatchObject({ conversationId: "conv_velha", reaproveitada: true, messageId: null, enviado: false, motivo: expect.stringContaining("nenhuma mensagem foi enviada") });
    // Nada saiu: o vinculo fica gravado, mas o caso nao ganha evento de contato nem muda de status.
    expect(fake.conversasRegistradas[0]).toMatchObject({ casoId: 10, conversationId: "conv_velha", status: "PENDING" });
    expect(fake.eventos).toEqual([]);
    expect(fake.patches).toEqual([]);
  });
  it("conversa reaproveitada de caso ja em contato: idem, e o status segue como estava", async () => {
    clienteFalso({ buscarConversaPorTelefone: vi.fn(async () => ({ ok: true, valor: { id: "conv_velha", status: "WAITING" } })) }); comCanal();
    fake.caso = { ...CASO, status: "em_contato" };
    fake.vinculoDoCaso = { id: 50, customerId: 42, casoId: 10, conversationId: "conv_velha", status: "WAITING" };
    const r = await enviarCasoParaCobranca(6, 10, 3);
    expect(r.enviado).toBe(false);
    expect(fake.eventos).toEqual([]);
    expect(fake.patches).toEqual([]);
    expect(fake.conversasRegistradas[0].status).toBe("WAITING");
  });
  it("conversa nova: enviado=true, evento de contato com origemTexto do agente e caso aberto → em contato", async () => {
    clienteFalso(); comCanal();
    const r = await enviarCasoParaCobranca(6, 10, 3);
    expect(r).toMatchObject({ enviado: true, motivo: null, reaproveitada: false, messageId: "msg_1" });
    expect(fake.eventos).toHaveLength(1);
    expect(fake.eventos[0].metadata.origemTexto).toBe("abertura_controlada");
    expect(fake.patches).toEqual([{ id: 10, patch: { status: "em_contato" } }]);
  });
  it("conversa fechada nao e reaproveitada: abre outra", async () => {
    const c = clienteFalso({ buscarConversaPorTelefone: vi.fn(async () => ({ ok: true, valor: { id: "conv_fechada", status: "CLOSED" } })) }); comCanal();
    await enviarCasoParaCobranca(6, 10, 3);
    expect(c.iniciarConversa).toHaveBeenCalledTimes(1);
  });
  it("chat nao abriu: CHAT_FALHOU e nada e gravado no caso", async () => {
    clienteFalso({ iniciarConversa: vi.fn(async () => ({ ok: false, erro: "canal desconectado", status: 502 })) }); comCanal();
    await expect(enviarCasoParaCobranca(6, 10, 3)).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
    expect(fake.eventos).toEqual([]);
    expect(fake.conversasRegistradas).toEqual([]);
  });
  it("o telefone do cliente nunca vai para o log", async () => {
    clienteFalso(); comCanal();
    await enviarCasoParaCobranca(6, 10, 3);
    const tudo = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls]);
    expect(tudo).not.toContain("99999");
  });
  /**
   * Decisão do coordenador (16/09/2026): o clique do operador é iniciativa
   * HUMANA e passa pelo orçamento com `automatico=false` — a pausa por
   * promessa vigente e a cota semanal de iniciativas são regras da automação
   * (`avaliarContato`); opt-out, contestação aberta e a cota diária valem para
   * os dois. Sem o sinal, o gesto do kanban entrava como se fosse a agenda e
   * o atendente era barrado por "Automação pausada por atendimento".
   */
  it("iniciativa humana reserva o orçamento como não automática; sem o sinal (a agenda) segue automática", async () => {
    clienteFalso(); comCanal(); relogioEm(DENTRO_DA_JANELA);
    await enviarCasoParaCobranca(6, 10, 3, null, null, false);
    expect(comOrcamentoContato).toHaveBeenLastCalledWith(6, 42, "whatsapp", false, expect.any(Function));
    await enviarCasoParaCobranca(6, 10, 3);
    expect(comOrcamentoContato).toHaveBeenLastCalledWith(6, 42, "whatsapp", true, expect.any(Function));
  });
  it("bloqueio do orçamento (ErroGestao) sobe intacto, sem mensagem, evento nem conversa gravada", async () => {
    const c = clienteFalso(); comCanal(); relogioEm(DENTRO_DA_JANELA);
    vi.mocked(comOrcamentoContato).mockRejectedValueOnce(new ErroGestao("Cliente solicitou não receber contatos."));
    await expect(enviarCasoParaCobranca(6, 10, 3, null, null, false)).rejects.toSatisfy((e: unknown) => e instanceof ErroGestao && e.message === "Cliente solicitou não receber contatos.");
    expect(c.iniciarConversa).not.toHaveBeenCalled();
    expect(fake.eventos).toEqual([]);
    expect(fake.conversasRegistradas).toEqual([]);
    expect(fake.patches).toEqual([]);
  });
  /**
   * A pausa (48 h de "cliente respondeu"/"pagamento informado") e a janela de
   * horário (CDC art. 42 / Anatel 765) valem para a INICIATIVA humana também —
   * `avaliarContato` só barra `pausado` na automação porque a mesma reserva
   * serve à RESPOSTA do atendente dentro da conversa (quem acabou de escrever
   * não pode ficar sem resposta). Abrir conversa nova é outra coisa: é o
   * atendente cobrando por WhatsApp quem acabou de dizer "já paguei", ou às
   * 22h. Revisão de 16/09/2026: o multicanal (SMS/e-mail) já recusava os dois
   * no envio manual; o WhatsApp, canal principal, deixava passar.
   */
  it("pausa vigente barra a iniciativa humana com CONFLITO antes de abrir conversa, reservar orçamento ou gravar evento", async () => {
    const c = clienteFalso(); comCanal(); relogioEm(DENTRO_DA_JANELA); comPausaVigente();
    await expect(enviarCasoParaCobranca(6, 10, 3, null, null, false)).rejects.toMatchObject({ codigo: "CONFLITO", message: expect.stringMatching(/pausado/) });
    expect(banco.query).toHaveBeenCalledWith(expect.stringMatching(/cobranca_preferencias_contato[\s\S]*pausa_ate>now\(\)/), [6, 42]);
    expect(comOrcamentoContato).not.toHaveBeenCalled();
    expect(c.iniciarConversa).not.toHaveBeenCalled();
    expect(fake.eventos).toEqual([]);
    expect(fake.conversasRegistradas).toEqual([]);
  });
  it("fora do horário de contato a iniciativa humana é recusada pela ponte (CDC 42 / Anatel 765), sem tocar o chat", async () => {
    const c = clienteFalso(); comCanal(); relogioEm(FORA_DA_JANELA);
    await expect(enviarCasoParaCobranca(6, 10, 3, null, null, false)).rejects.toMatchObject({ codigo: "CONFLITO", message: expect.stringMatching(/horário/) });
    expect(storage.getPoliticaDeCobranca).toHaveBeenCalledWith(6);
    expect(comOrcamentoContato).not.toHaveBeenCalled();
    expect(c.iniciarConversa).not.toHaveBeenCalled();
    expect(fake.eventos).toEqual([]);
  });
  it("a agenda (automatico=true) não passa pela conferência da ponte: pausa e janela dela são de quem a chama", async () => {
    clienteFalso(); comCanal(); relogioEm(FORA_DA_JANELA); comPausaVigente();
    await expect(enviarCasoParaCobranca(6, 10, 3)).resolves.toMatchObject({ enviado: true });
    expect(banco.query).not.toHaveBeenCalled();
    expect(storage.getPoliticaDeCobranca).not.toHaveBeenCalled();
  });
  it("conversa existente reaproveitada fora do horário e com pausa: nada é enviado, então nada é recusado", async () => {
    const c = clienteFalso({ buscarConversaPorTelefone: vi.fn(async () => ({ ok: true, valor: { id: "conv_velha", status: "OPEN" } })) }); comCanal(); relogioEm(FORA_DA_JANELA); comPausaVigente();
    await expect(enviarCasoParaCobranca(6, 10, 3, null, null, false)).resolves.toMatchObject({ reaproveitada: true, enviado: false });
    expect(c.iniciarConversa).not.toHaveBeenCalled();
  });
  it("o evento do contato carrega a base legal da etapa do caso, como o da régua de SMS/e-mail", async () => {
    clienteFalso(); comCanal();
    await enviarCasoParaCobranca(6, 10, 3);
    expect(fake.eventos[0].metadata).toMatchObject({ etapa: "aviso_suspensao", baseLegal: "Anatel Res. 765/2023 — 15 dias da notificação", motivoLegal: 'Etapa "Regularização do serviço" da régua de cobrança · Anatel Res. 765/2023 — 15 dias da notificação' });
    fake.eventos.length = 0; fake.caso = { ...CASO, carteira: "ex_cliente", etapaAtual: "pre_negativacao" };
    await enviarCasoParaCobranca(6, 10, 3);
    // Ex-cliente: a conciliação não é o aviso formal da Súmula 359 — a régua tira a base, e o evento respeita.
    expect(fake.eventos[0].metadata).toMatchObject({ etapa: "pre_negativacao", baseLegal: null, motivoLegal: 'Etapa "Conciliação de pendências" da régua de cobrança' });
    fake.eventos.length = 0; fake.caso = { ...CASO, etapaAtual: null };
    await enviarCasoParaCobranca(6, 10, 3);
    expect(fake.eventos[0].metadata).toMatchObject({ etapa: null, baseLegal: null, motivoLegal: "Caso sem etapa da régua definida no envio" });
  });
});

describe("primeiro contato preventivo", () => {
  it("abre no canal comum com mensagem neutra, sem revelar próximos vencimentos", async () => {
    const c = clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", canalId: "ch_1", status: "ativo", agenteConfig: AGENTES_PRONTOS };
    const r = await enviarPreAvisoParaChat(6, { customerId: 42, nome: "Maria da Silva", telefone: "(43) 99999-0000" }, 3);
    expect(r.enviado).toBe(true);
    // a mesma abertura humanizada (§3.1), numa mensagem só com a chave D9 desligada; nada de fatura nem vencimento
    expect(c.iniciarConversa).toHaveBeenCalledWith("org_1", expect.objectContaining({ texto: expect.stringMatching(/é da equipe da NsLink 😊\n\n.*Maria.*4 últimos dígitos do seu CPF/), aiEnabled: false }));
    expect(c.enviarTexto).not.toHaveBeenCalled();
    expect(c.iniciarConversa.mock.calls[0][1].texto).not.toMatch(/assistente virtual|fatura|vencimento|R\$|Silva/);
    expect(c.prepararPrimeiroContato).not.toHaveBeenCalled();
    expect(fake.conversasRegistradas[0]).toMatchObject({ customerId: 42, origem: "cobranca", casoId: null, conversationId: "conv_nova" });
    // Só a agenda dispara pré-aviso: iniciativa automática no orçamento.
    expect(comOrcamentoContato).toHaveBeenCalledWith(6, 42, "whatsapp", true, expect.any(Function));
  });
});

describe("enviarRecuperacaoParaChat", () => {
  it("não permite mensagem manual de devolução antes da identificação", async () => {
    const c = clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", canalId: "ch_1", status: "ativo", agenteConfig: AGENTES_PRONTOS };
    fake.recuperacoes = [{ id: 77, customerId: 42, customerName: "Joao Pereira", customerPhone: "43988880000" }];
    await expect(enviarRecuperacaoParaChat(6, 77, 3, "Joao, devolva o equipamento do contrato")).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(c.iniciarConversa).not.toHaveBeenCalled();
    expect(fake.conversasRegistradas).toEqual([]);
  });
  it("abre contato neutro e liga a conversa ao caso sem revelar equipamento antes da identidade", async () => {
    const c = clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", status: "ativo", agenteConfig: AGENTES_PRONTOS };
    fake.recuperacoes = [{ id: 77, customerId: 42, customerName: "Joao Pereira", customerPhone: "43988880000", equipmentType: "ONU", equipmentBrand: "Huawei", equipmentModel: "HG8145V5" }];
    const r = await enviarRecuperacaoParaChat(6, 77, 3);
    // os dois balões numa mensagem só (chave D9 desligada)
    const [primeiro, segundo] = String(c.iniciarConversa.mock.calls[0][1].texto).split("\n\n");
    expect(primeiro).toMatch(/é da equipe da NsLink 😊$/);
    expect(segundo).toMatch(/Joao/);
    expect(c.enviarTexto).not.toHaveBeenCalled();
    for (const t of [primeiro, segundo]) expect(t).not.toMatch(/contrato|equipamento|financeiro|Huawei|ONU|Pereira|assistente virtual/i);
    expect(c.iniciarConversa.mock.calls[0][1].activeAgentId).toBeUndefined();
    expect(c.iniciarConversa.mock.calls[0][1].telefone).toBe("5543988880000");
    expect(fake.conversasRegistradas[0]).toMatchObject({ origem: "equipamentos", recuperacaoId: 77, customerId: 42 });
    expect(r).toMatchObject({ conversationId: "conv_nova", enviado: true, motivo: null });
  });
  it("conversa existente na recuperacao: nada enviado, e o chamador fica sabendo", async () => {
    const c = clienteFalso({ buscarConversaPorTelefone: vi.fn(async () => ({ ok: true, valor: { id: "conv_velha", status: "OPEN" } })) });
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", status: "ativo", agenteConfig: AGENTES_PRONTOS };
    fake.recuperacoes = [{ id: 77, customerId: 42, customerName: "Joao Pereira", customerPhone: "43988880000" }];
    const r = await enviarRecuperacaoParaChat(6, 77, 3);
    expect(c.iniciarConversa).not.toHaveBeenCalled();
    expect(r).toMatchObject({ conversationId: "conv_velha", reaproveitada: true, enviado: false, motivo: expect.any(String) });
  });
  it("caso de recuperacao de outro provedor: CASO_NAO_ENCONTRADO", async () => {
    clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", status: "ativo" };
    await expect(enviarRecuperacaoParaChat(6, 999, 3)).rejects.toMatchObject({ codigo: "CASO_NAO_ENCONTRADO" });
  });
  it("'Iniciar contato' do operador é iniciativa humana no orçamento; a agenda continua automática", async () => {
    clienteFalso(); relogioEm(DENTRO_DA_JANELA);
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", status: "ativo", agenteConfig: AGENTES_PRONTOS };
    fake.recuperacoes = [{ id: 77, customerId: 42, customerName: "Joao Pereira", customerPhone: "43988880000" }];
    await enviarRecuperacaoParaChat(6, 77, 3, null, false);
    expect(comOrcamentoContato).toHaveBeenLastCalledWith(6, 42, "whatsapp", false, expect.any(Function));
    await enviarRecuperacaoParaChat(6, 77, 3);
    expect(comOrcamentoContato).toHaveBeenLastCalledWith(6, 42, "whatsapp", true, expect.any(Function));
  });
  it("'Iniciar contato' respeita a pausa do cliente e a janela de horário como o kanban (mesma ponte)", async () => {
    const c = clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", status: "ativo", agenteConfig: AGENTES_PRONTOS };
    fake.recuperacoes = [{ id: 77, customerId: 42, customerName: "Joao Pereira", customerPhone: "43988880000" }];
    relogioEm(DENTRO_DA_JANELA); comPausaVigente();
    await expect(enviarRecuperacaoParaChat(6, 77, 3, null, false)).rejects.toMatchObject({ codigo: "CONFLITO", message: expect.stringMatching(/pausado/) });
    relogioEm(FORA_DA_JANELA);
    await expect(enviarRecuperacaoParaChat(6, 77, 3, null, false)).rejects.toMatchObject({ codigo: "CONFLITO", message: expect.stringMatching(/horário/) });
    expect(c.iniciarConversa).not.toHaveBeenCalled();
    expect(fake.conversasRegistradas).toEqual([]);
    expect(storage.registrarEventoDoChat).not.toHaveBeenCalled();
  });
});

describe("conversaDoCaso", () => {
  it("sem vinculo devolve null; com vinculo traz as mensagens normalizadas", async () => {
    const c = clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", status: "ativo" };
    expect(await conversaDoCaso(6, 10)).toBeNull();
    fake.vinculoDoCaso = { conversationId: "conv_1", status: "OPEN", abertaEm: new Date("2026-09-05T10:00:00Z"), ultimoEventoEm: null };
    const r = await conversaDoCaso(6, 10);
    expect(c.listarMensagens).toHaveBeenCalledWith("org_1", "conv_1", { limit: 20 });
    expect(r).toMatchObject({ conversationId: "conv_1", status: "OPEN", erro: null });
    expect(r!.mensagens[0]).toEqual({ id: "m1", direcao: "OUTBOUND", texto: "Ola", status: "SENT", quem: "NsLink", em: "2026-09-05T10:00:00Z" });
  });
});

/**
 * A automação de retorno ("Consulta ISP · resposta para humano") é a volta da
 * resposta do cliente para cá. O fork a pausa sozinho depois de 5 falhas
 * seguidas do webhook (`enabled=false` + `autoPausedAt`) e nunca religa —
 * 16/09/2026: nosso webhook devolvia 401, a automação parou e a ponte
 * devolvia cedo só porque o id estava gravado; nenhuma resposta voltava e
 * ninguém soube. Agora a ponte confere o estado no fork e religa: ao salvar o
 * canal (a), quando o agente fica pronto (b — pela transferência que a rota e
 * `garantirAgenteDeCobranca` chamam logo depois, fora da trava) e em toda
 * transferência (c). Falha do fork nunca derruba canal nem agente: vira aviso
 * no log e o estado vai para a aba Chat.
 */
const RETORNO_PAUSADO = { id: "a-retorno", name: "Consulta ISP · resposta para humano", trigger: "MESSAGE_RECEIVED", enabled: false, autoPausedAt: "2026-09-16T17:10:00.000Z", consecutiveFailures: 5 };
const RETORNO_LIGADO = { ...RETORNO_PAUSADO, enabled: true, autoPausedAt: null, consecutiveFailures: 0 };
const comRetorno = (agenteConfig: Record<string, unknown> = {}) => {
  fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", canalNome: "Principal", status: "ativo", ultimoErro: null, webhookSecret: "whs_teste", agenteConfig: { respostaHumanaAutomacaoId: "a-retorno", modoAtendimento: "primeira_resposta_humana", ...agenteConfig } };
};
const avisos = () => log.warn.mock.calls.map(([dados, msg]) => ({ dados, msg }));

describe("religarRetornoSePausado — a automação de retorno que o fork pausa e nunca religa", () => {
  it("pausada pelo fork: religa pelo toggle e avisa no log com provedor, automação, quando pausou e quantas falhas", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [RETORNO_PAUSADO] })) }); comRetorno();
    expect(await religarRetornoSePausado(6)).toEqual({ estado: "religada" });
    expect(c.religarAutomacao).toHaveBeenCalledExactlyOnceWith("org_1", "a-retorno");
    expect(c.criarAutomacao).not.toHaveBeenCalled();
    expect(avisos()).toContainEqual({ dados: expect.objectContaining({ providerId: 6, automacaoId: "a-retorno", autoPausedAt: "2026-09-16T17:10:00.000Z", consecutiveFailures: 5 }), msg: expect.stringMatching(/estava pausada pelo fork; religada/) });
    expect(fake.integracao.agenteConfig.respostaHumanaAutomacaoId).toBe("a-retorno");
  });
  it("só autoPausedAt (enabled ainda true) também conta como pausada; enabled=false sem data idem", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [{ ...RETORNO_LIGADO, autoPausedAt: "2026-09-16T17:10:00.000Z" }] })) }); comRetorno();
    expect(await religarRetornoSePausado(6)).toEqual({ estado: "religada" });
    c.listarAutomacoes.mockResolvedValueOnce({ ok: true, valor: [{ ...RETORNO_LIGADO, enabled: false }] } as never);
    expect(await religarRetornoSePausado(6)).toEqual({ estado: "religada" });
    expect(c.religarAutomacao).toHaveBeenCalledTimes(2);
  });
  it("ligada: nada a fazer — nenhum toggle, nenhuma criação, nenhum aviso", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [RETORNO_LIGADO] })) }); comRetorno();
    expect(await religarRetornoSePausado(6)).toEqual({ estado: "ligada" });
    expect(c.religarAutomacao).not.toHaveBeenCalled();
    expect(c.criarAutomacao).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
  it("sumiu do fork (id gravado fora da lista): limpa o id e recria pela mesma criação de sempre, sem herdar o id antigo", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [{ ...RETORNO_LIGADO, id: "outra", name: "Outra coisa" }] })), criarAutomacao: vi.fn(async () => ({ ok: true, valor: { id: "a-nova" } })) }); comRetorno();
    expect(await religarRetornoSePausado(6)).toEqual({ estado: "recriada" });
    expect(c.religarAutomacao).not.toHaveBeenCalled();
    expect(c.criarAutomacao).toHaveBeenCalledExactlyOnceWith("org_1", expect.objectContaining({ nome: "Consulta ISP · resposta para humano", trigger: "MESSAGE_RECEIVED", actions: [{ type: "call_webhook", params: expect.objectContaining({ secret: "whs_teste" }) }] }));
    expect(fake.integracao.agenteConfig).toMatchObject({ respostaHumanaAutomacaoId: "a-nova", modoAtendimento: "primeira_resposta_humana" });
    expect(avisos()).toContainEqual({ dados: expect.objectContaining({ providerId: 6, automacaoId: "a-retorno" }), msg: expect.stringMatching(/sumiu do fork/) });
    // A lista que provou o sumiço é a mesma que a criação usa para reencontrar pelo nome: uma ida ao fork, não duas.
    expect(c.listarAutomacoes).toHaveBeenCalledTimes(1);
  });
  it("id gravado apontando para automação com OUTRO gatilho (editada no inbox do fork): não é mais a nossa — não religa às cegas; recria/adota pelo nome", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [{ ...RETORNO_PAUSADO, trigger: "CONVERSATION_CREATED" }, { ...RETORNO_LIGADO, id: "a-certa" }] })) }); comRetorno();
    expect(await religarRetornoSePausado(6)).toEqual({ estado: "recriada" });
    expect(c.religarAutomacao).not.toHaveBeenCalled();
    expect(c.criarAutomacao).not.toHaveBeenCalled();
    expect(fake.integracao.agenteConfig.respostaHumanaAutomacaoId).toBe("a-certa");
  });
  it("nunca criada (integração sem id): cria; sem integração nenhuma: sem_integracao e nenhuma chamada ao fork", async () => {
    const c = clienteFalso({ criarAutomacao: vi.fn(async () => ({ ok: true, valor: { id: "a-nova" } })) });
    comRetorno({ respostaHumanaAutomacaoId: null });
    expect(await religarRetornoSePausado(6)).toEqual({ estado: "recriada" });
    expect(c.criarAutomacao).toHaveBeenCalledTimes(1);
    expect(fake.integracao.agenteConfig.respostaHumanaAutomacaoId).toBe("a-nova");
    const chamadasAoFork = c.listarAutomacoes.mock.calls.length + c.criarAutomacao.mock.calls.length;
    fake.integracao = undefined;
    expect(await religarRetornoSePausado(6)).toEqual({ estado: "sem_integracao" });
    expect(c.listarAutomacoes.mock.calls.length + c.criarAutomacao.mock.calls.length).toBe(chamadasAoFork);
  });
  it("fork fora do ar ao listar: aviso e 'desconhecido', sem lançar; toggle recusado: aviso e 'pausada', sem lançar e sem recriar", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: false, erro: "Não foi possível falar com o Chat BullQ" })) }); comRetorno();
    expect(await religarRetornoSePausado(6)).toEqual({ estado: "desconhecido" });
    expect(c.religarAutomacao).not.toHaveBeenCalled();
    expect(avisos()).toContainEqual({ dados: expect.objectContaining({ providerId: 6, automacaoId: "a-retorno" }), msg: expect.stringMatching(/conferir a automação de retorno/) });
    c.listarAutomacoes.mockResolvedValue({ ok: true, valor: [RETORNO_PAUSADO] } as never);
    c.religarAutomacao.mockResolvedValue({ ok: false, erro: "Insufficient role", status: 403 } as never);
    expect(await religarRetornoSePausado(6)).toEqual({ estado: "pausada" });
    expect(avisos()).toContainEqual({ dados: expect.objectContaining({ providerId: 6, automacaoId: "a-retorno", autoPausedAt: "2026-09-16T17:10:00.000Z", consecutiveFailures: 5 }), msg: expect.stringMatching(/não foi possível religar/) });
    expect(c.criarAutomacao).not.toHaveBeenCalled();
    expect(fake.integracao.agenteConfig.respostaHumanaAutomacaoId).toBe("a-retorno");
  });
  it("chat desligado nesta instalação: CHAT_DESLIGADO (a rota vira 503)", async () => {
    _usarClienteDoChatParaTestes(null); comRetorno();
    await expect(religarRetornoSePausado(6)).rejects.toMatchObject({ codigo: "CHAT_DESLIGADO" });
  });

  it("(a) ao salvar o canal: confere DEPOIS de gravar o canal e o serviço de WhatsApp, e religa a automação pausada", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [RETORNO_PAUSADO] })) }); comRetorno();
    fake.integracao.canalId = null;
    const r = await configurarCanalWhatsapp(6, EVO);
    expect(r.canalOk).toBe(true);
    expect(c.religarAutomacao).toHaveBeenCalledExactlyOnceWith("org_1", "a-retorno");
    expect(vi.mocked(storage.marcarEstadoDaIntegracaoDoChat).mock.invocationCallOrder[0]).toBeLessThan(c.listarAutomacoes.mock.invocationCallOrder[0]);
    expect(fake.integracao).toMatchObject({ canalId: "ch_1", status: "ativo", agenteConfig: { whatsapp: { provider: "EVOLUTION" }, respostaHumanaAutomacaoId: "a-retorno" } });
  });
  it("(a) falha do fork na conferência — listagem caída ou recriação recusada — não derruba o canal: vira aviso", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: false, erro: "timeout" })) }); comRetorno();
    fake.integracao.canalId = null;
    expect((await configurarCanalWhatsapp(6, EVO)).canalOk).toBe(true);
    expect(fake.integracao.canalId).toBe("ch_1");
    // Sumiu e a recriação falhou: a criação lança CHAT_FALHOU, o canal fica de pé mesmo assim.
    c.listarAutomacoes.mockResolvedValue({ ok: true, valor: [] } as never);
    c.criarAutomacao.mockResolvedValue({ ok: false, erro: "500", status: 500 } as never);
    fake.integracao.canalId = null;
    expect((await configurarCanalWhatsapp(6, EVO)).canalOk).toBe(true);
    expect(fake.integracao.canalId).toBe("ch_1");
    expect(avisos()).toContainEqual({ dados: expect.objectContaining({ providerId: 6 }), msg: expect.stringMatching(/canal salvo, mas a automação de retorno não foi conferida/) });
  });
  it("(c) garantirTransferenciaNaResposta com id gravado não devolve mais cedo: confere e religa; fork caído na conferência não bloqueia", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [RETORNO_PAUSADO] })) }); comRetorno();
    await garantirTransferenciaNaResposta(6);
    expect(c.religarAutomacao).toHaveBeenCalledExactlyOnceWith("org_1", "a-retorno");
    expect(c.criarAutomacao).not.toHaveBeenCalled();
    c.listarAutomacoes.mockResolvedValueOnce({ ok: false, erro: "timeout" } as never);
    await expect(garantirTransferenciaNaResposta(6)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
  it("(c) a ida ao fork fica FORA da trava config: ligada, nenhuma trava é tomada; pausada, a listagem roda antes e só o toggle dentro", async () => {
    // A trava `config:` é compartilhada entre API e worker e não espera (quem
    // chega com ela ocupada recebe CONFLITO): segurá-la pelo tempo de resposta
    // do fork em TODO envio faria o operador levar 409 enquanto o worker lista.
    const dentroAoListar: string[][] = [];
    let lista: unknown = { ok: true, valor: [RETORNO_LIGADO] };
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => { dentroAoListar.push([...travas.emCurso]); return lista; }) }); comRetorno();
    travas.tomadas.length = 0;
    await garantirTransferenciaNaResposta(6);
    expect(dentroAoListar).toEqual([[]]);
    expect(travas.tomadas).not.toContain("config:6");
    // Pausada: a primeira listagem (fora da trava) diz que precisa mexer; a trava só então é tomada, e o toggle roda dentro dela.
    const dentroAoReligar: string[][] = [];
    c.religarAutomacao.mockImplementation(async () => { dentroAoReligar.push([...travas.emCurso]); return { ok: true, valor: undefined }; });
    lista = { ok: true, valor: [RETORNO_PAUSADO] };
    dentroAoListar.length = 0;
    await garantirTransferenciaNaResposta(6);
    expect(dentroAoListar[0]).toEqual([]);
    expect(dentroAoReligar).toEqual([["config:6"]]);
    // Fork caído na leitura de fora: aviso e o envio segue — sem tomar a trava para conferir de novo.
    travas.tomadas.length = 0;
    lista = { ok: false, erro: "timeout" };
    await garantirTransferenciaNaResposta(6);
    expect(travas.tomadas).not.toContain("config:6");
    expect(avisos()).toContainEqual({ dados: expect.objectContaining({ providerId: 6, automacaoId: "a-retorno" }), msg: expect.stringMatching(/conferir a automação de retorno/) });
  });
  it("(c) no envio: o primeiro contato passa pela conferência e a automação pausada é religada ANTES de a mensagem sair", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [RETORNO_PAUSADO] })) }); comRetorno(AGENTES_PRONTOS);
    await enviarCasoParaCobranca(6, 10, 3);
    expect(c.religarAutomacao).toHaveBeenCalledExactlyOnceWith("org_1", "a-retorno");
    expect(c.religarAutomacao.mock.invocationCallOrder[0]).toBeLessThan(c.iniciarConversa.mock.invocationCallOrder[0]);
  });
  it("(b) agente aplicado e pronto: a transferência que vem em seguida (fora da trava do agente) confere e religa", async () => {
    const c = clienteFalso({
      listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [RETORNO_PAUSADO] })),
      listarModelosDePrimeiroContato: vi.fn(async () => ({ ok: true, valor: { configured: true, models: [{ id: "sakana/modelo-real" }] } })),
      listarAgentes: vi.fn(async () => ({ ok: true, valor: [] })),
      criarAgente: vi.fn(async () => ({ ok: true, valor: { id: "ag-novo", name: "x", kind: "WORKER", modelId: "sakana/modelo-real", isActive: false } })),
      atualizarAgente: vi.fn(async () => ({ ok: true, valor: { id: "ag-novo" } })),
    });
    comRetorno({ agentes: { cobranca_ativos: { modelo: "sakana/modelo-real", instrucoes: "Seja breve", habilitado: true, etapa: "configurado" } } });
    expect(await garantirAgenteDeCobranca(6)).toEqual({ agenteId: "ag-novo", criado: true });
    expect(fake.integracao.agenteConfig.agentes.cobranca_ativos).toMatchObject({ id: "ag-novo", etapa: "pronto" });
    expect(c.religarAutomacao).toHaveBeenCalledExactlyOnceWith("org_1", "a-retorno");
    expect(c.criarAgente.mock.invocationCallOrder[0]).toBeLessThan(c.religarAutomacao.mock.invocationCallOrder[0]);
  });
});

describe("retornoDaIntegracao — o que a aba Chat mostra sobre a volta das respostas", () => {
  it("a leitura da integração (kanban, 360, esteira, confissão, diagnóstico) continua leve: não bate no fork nem carrega `retorno`", async () => {
    const c = clienteFalso(); comRetorno();
    const leve = await estadoDaIntegracao(6);
    expect("retorno" in leve).toBe(false);
    expect(c.listarAutomacoes).not.toHaveBeenCalled();
  });
  it("lê do fork na hora, com tempo curto: ligada / pausada (quando e falhas) / ausente (sumiu) / desconhecido (fork caiu) — e só olha, nunca religa nem cria", async () => {
    const c = clienteFalso({ listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [RETORNO_LIGADO] })) }); comRetorno();
    expect(await retornoDaIntegracao(6)).toEqual({ estado: "ligada", autoPausadoEm: null, falhas: 0 });
    expect(c.listarAutomacoes).toHaveBeenCalledWith("org_1", { timeoutMs: 5000 });
    c.listarAutomacoes.mockResolvedValueOnce({ ok: true, valor: [RETORNO_PAUSADO] } as never);
    expect(await retornoDaIntegracao(6)).toEqual({ estado: "pausada", autoPausadoEm: "2026-09-16T17:10:00.000Z", falhas: 5 });
    c.listarAutomacoes.mockResolvedValueOnce({ ok: true, valor: [] } as never);
    expect(await retornoDaIntegracao(6)).toEqual({ estado: "ausente", autoPausadoEm: null, falhas: null });
    c.listarAutomacoes.mockResolvedValueOnce({ ok: false, erro: "timeout" } as never);
    expect(await retornoDaIntegracao(6)).toEqual(RETORNO_DESCONHECIDO);
    expect(c.religarAutomacao).not.toHaveBeenCalled();
    expect(c.criarAutomacao).not.toHaveBeenCalled();
  });
  it("sem id gravado (nunca criada) é ausente sem ir ao fork; sem integração ou com o chat desligado é desconhecido", async () => {
    const c = clienteFalso(); comRetorno({ respostaHumanaAutomacaoId: null });
    expect(await retornoDaIntegracao(6)).toEqual({ estado: "ausente", autoPausadoEm: null, falhas: null });
    expect(c.listarAutomacoes).not.toHaveBeenCalled();
    fake.integracao = undefined;
    expect(await retornoDaIntegracao(6)).toEqual(RETORNO_DESCONHECIDO);
    _usarClienteDoChatParaTestes(null); comRetorno();
    expect(await retornoDaIntegracao(6)).toEqual(RETORNO_DESCONHECIDO);
  });
  it("fork fora do ar: o tempo curto vale para a conferência INTEIRA — o token que o cliente pede antes da listagem (15 s, sem sessão em cache) não segura a tela", async () => {
    // Cliente REAL com um fetch que nunca responde: `listarAutomacoes(…, { timeoutMs })`
    // só limita o GET /automations; o POST /token que vem antes cai nos 15 s do
    // cliente — e é exatamente com o fork caído que não há sessão em cache.
    vi.useFakeTimers();
    try {
      const pendurado = ((_entrada: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
      })) as unknown as typeof fetch;
      _usarClienteDoChatParaTestes(new ChatBullqClient({ baseUrl: "https://chat.example.com", platformKey: "chave-de-teste", fetchImpl: pendurado }));
      comRetorno();
      let resultado: unknown = "pendente";
      const leitura = retornoDaIntegracao(6).then(r => { resultado = r; });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(resultado).toEqual(RETORNO_DESCONHECIDO);
      await vi.advanceTimersByTimeAsync(15_000);
      await leitura;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("definirSenhaDoInbox", () => {
  it("provisiona se preciso e manda a senha ao owner da org; a senha nao vai ao log", async () => {
    const c = clienteFalso();
    const r = await definirSenhaDoInbox(6, "segredo-forte-123");
    expect(c.provisionarOrganizacao).toHaveBeenCalledTimes(1);
    expect(c.definirSenhaDoOwner).toHaveBeenCalledWith("org_1", "segredo-forte-123");
    expect(r).toEqual({ ownerEmail: "dono@nslink.com" });
    expect(JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls])).not.toContain("segredo-forte");
  });
  it("chat recusou: CHAT_FALHOU", async () => {
    clienteFalso({ definirSenhaDoOwner: vi.fn(async () => ({ ok: false, erro: "404 org", status: 404 })) });
    await expect(definirSenhaDoInbox(6, "segredo-forte-123")).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
  });
});

describe("as mensagens modelo", () => {
  it("cobranca: primeiro nome, provedor, valor em reais, dias e a acao da etapa", () => {
    const t = mensagemDeCobranca({ nomeCliente: "Maria da Silva", nomeProvedor: "NsLink", valor: 189.9, diasAtraso: 1, acaoDaEtapa: "Oferecer parcelamento." });
    expect(t.replace(/ /g, " ")).toBe("Ola, Maria! Aqui e NsLink. Identificamos uma pendencia de R$ 189,90 vencida ha 1 dia no seu contrato. Oferecer parcelamento. Responda por aqui que a gente resolve junto.");
    expect(mensagemDeCobranca({ nomeCliente: "", nomeProvedor: "X", valor: 10, diasAtraso: 0 })).toContain("Ola, cliente!");
  });
  it("retirada: cita o equipamento quando conhecido", () => {
    expect(mensagemDeRecuperacao({ nomeCliente: "Joao P", nomeProvedor: "NsLink", equipamento: "ONU Huawei" })).toContain("retirada do ONU Huawei");
    expect(mensagemDeRecuperacao({ nomeCliente: "Joao P", nomeProvedor: "NsLink", equipamento: null })).toContain("retirada do equipamento");
  });
});

describe("clienteDoChat e a demonstracao publica", () => {
  const VARIAVEIS = ["DEMO_MODE", "CHAT_BULLQ_URL", "CHAT_BULLQ_PLATFORM_KEY"] as const;

  /** Roda com o ambiente dado e o singleton zerado; devolve os dois como estavam, passe ou falhe. */
  async function comAmbiente(valores: Partial<Record<(typeof VARIAVEIS)[number], string>>, executar: () => Promise<void>) {
    const antes = Object.fromEntries(VARIAVEIS.map(v => [v, process.env[v]]));
    for (const v of VARIAVEIS) { if (valores[v] === undefined) delete process.env[v]; else process.env[v] = valores[v]; }
    _usarClienteDoChatParaTestes(undefined);
    try { await executar(); } finally {
      for (const v of VARIAVEIS) { if (antes[v] === undefined) delete process.env[v]; else process.env[v] = antes[v]; }
      _usarClienteDoChatParaTestes(undefined);
    }
  }

  it("com DEMO_MODE ligado: o cliente REAL com o fetch simulado, mesmo sem CHAT_BULLQ_* e mesmo com ele apontando para o fork", async () => {
    const rede = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("a demonstracao nao pode tocar a rede"); });
    try {
      await comAmbiente({ DEMO_MODE: "true" }, async () => {
        const c = clienteDoChat();
        expect(c).toBeInstanceOf(ChatBullqClient);
        expect(clienteDoChat()).toBe(c);
        expect(await c!.listarCanais("demo-org-6")).toEqual({ ok: true, valor: [{ id: "demo-canal", type: "WHATSAPP_ZAPPFY", name: "WhatsApp da Demonstração", isActive: true }] });
      });
      await comAmbiente({ DEMO_MODE: "true", CHAT_BULLQ_URL: "https://chat-real.invalid", CHAT_BULLQ_PLATFORM_KEY: "chave-real" }, async () => {
        expect(await clienteDoChat()!.testarCanal("demo-org-6", "demo-canal")).toEqual({ ok: true, valor: { ok: true } });
      });
      expect(rede).not.toHaveBeenCalled();
    } finally {
      rede.mockRestore();
    }
  });

  it("com DEMO_MODE desligado: volta ao ambiente — sem variaveis e null; com elas, fala pelo fetch global com a URL configurada", async () => {
    const rede = vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada) => new Response(
      JSON.stringify(String(entrada).includes("/token") ? { accessToken: "a", refreshToken: "r" } : []), { status: 200 },
    ));
    try {
      await comAmbiente({}, async () => {
        expect(clienteDoChat()).toBeNull();
      });
      await comAmbiente({ DEMO_MODE: "1", CHAT_BULLQ_URL: "https://chat-real.invalid", CHAT_BULLQ_PLATFORM_KEY: "chave-real" }, async () => {
        const c = clienteDoChat();
        expect(c).toBeInstanceOf(ChatBullqClient);
        expect(await c!.listarCanais("org_1")).toEqual({ ok: true, valor: [] });
      });
      expect(rede.mock.calls.map(([url]) => String(url))).toEqual([
        "https://chat-real.invalid/api/v1/platform/organizations/org_1/token",
        "https://chat-real.invalid/api/v1/channels",
      ]);
    } finally {
      rede.mockRestore();
    }
  });
});

/**
 * O que a tela de integração recebe na demonstração. O visitante nunca pode
 * ser mandado ao inbox de PRODUÇÃO nem ver a URL do fork real — mesmo com
 * CHAT_BULLQ_* esquecido no .env da instância de demo. A senha do inbox é
 * recusada (não existe inbox), e o Datafy, que exige template, é recusado antes
 * de gravar qualquer coisa. Fora da demonstração, o ambiente volta a valer.
 */
describe("a integração do chat na demonstração não expõe o ambiente nem finge o que não existe", () => {
  const VARIAVEIS = ["DEMO_MODE", "CHAT_BULLQ_URL", "CHAT_BULLQ_PLATFORM_KEY", "CHAT_BULLQ_INBOX_URL", "CHAT_BULLQ_PUBLIC_URL"] as const;
  const AMBIENTE_REAL = {
    CHAT_BULLQ_URL: "https://chat-real.invalid",
    CHAT_BULLQ_INBOX_URL: "https://inbox-real.invalid/inbox",
    CHAT_BULLQ_PUBLIC_URL: "https://chat-publico-real.invalid",
  };

  async function comAmbiente(valores: Partial<Record<(typeof VARIAVEIS)[number], string>>, executar: () => Promise<void>) {
    const antes = Object.fromEntries(VARIAVEIS.map(v => [v, process.env[v]]));
    for (const v of VARIAVEIS) { if (valores[v] === undefined) delete process.env[v]; else process.env[v] = valores[v]; }
    _usarClienteDoChatParaTestes(undefined);
    try { await executar(); } finally {
      for (const v of VARIAVEIS) { if (antes[v] === undefined) delete process.env[v]; else process.env[v] = antes[v]; }
      _usarClienteDoChatParaTestes(undefined);
    }
  }

  const integracaoDaDemo = () => ({ id: 1, providerId: 6, organizationId: "demo-org-6", slug: "sandbox-x", ownerEmail: "sandbox-x@demo.consultaisp.com.br", canalId: "demo-canal", canalNome: "WhatsApp da Demonstração", status: "ativo", agenteConfig: { whatsapp: { provider: "DATAFY" } } });

  it("DEMO_MODE: inbox e webhook Datafy vazios, e nenhum valor de CHAT_BULLQ_* sai na resposta", async () => {
    const rede = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("a demonstracao nao pode tocar a rede"); });
    try {
      await comAmbiente({ DEMO_MODE: "true", ...AMBIENTE_REAL }, async () => {
        fake.integracao = integracaoDaDemo();
        const estado = await estadoDaIntegracao(6);
        expect(estado.inboxUrl).toBe("");
        expect(estado.webhookDatafyUrl).toBeNull();
        const texto = JSON.stringify(estado);
        for (const valor of Object.values(AMBIENTE_REAL)) expect(texto).not.toContain(new URL(valor).host);
        expect(texto).not.toContain("chat.consultaisp.com.br");
      });
      expect(rede).not.toHaveBeenCalled();
    } finally {
      rede.mockRestore();
    }
  });

  it("DEMO_MODE: a senha do inbox é recusada pelo simulado, sem rede", async () => {
    const rede = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("a demonstracao nao pode tocar a rede"); });
    try {
      await comAmbiente({ DEMO_MODE: "true", ...AMBIENTE_REAL }, async () => {
        fake.integracao = integracaoDaDemo();
        await expect(definirSenhaDoInbox(6, "uma-senha-bem-comprida")).rejects.toMatchObject({ codigo: "CHAT_FALHOU", message: expect.stringMatching(/inbox externo não existe na demonstração/) });
      });
      expect(rede).not.toHaveBeenCalled();
    } finally {
      rede.mockRestore();
    }
  });

  it("DEMO_MODE: canal Datafy (e Uazapi) recusado antes de gravar — o simulado não tem template para abrir conversa", async () => {
    const rede = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("a demonstracao nao pode tocar a rede"); });
    try {
      await comAmbiente({ DEMO_MODE: "true" }, async () => {
        fake.integracao = integracaoDaDemo();
        await expect(configurarCanalWhatsapp(6, { provider: "DATAFY", nome: "Oficial", token: "sk_live_ficticio", phoneNumberId: "123456789", webhookSecret: "whsec_ficticio" } as never)).rejects.toMatchObject({ codigo: "CHAT_SEM_SUPORTE" });
        await expect(configurarCanalWhatsapp(6, { provider: "UAZAPI", nome: "Instância", token: "token-ficticio", baseUrl: "https://uazapi.invalid" } as never)).rejects.toMatchObject({ codigo: "CHAT_SEM_SUPORTE" });
        expect(storage.marcarEstadoDaIntegracaoDoChat).not.toHaveBeenCalled();
        expect(storage.guardarAgenteDoChat).not.toHaveBeenCalled();
      });
      expect(rede).not.toHaveBeenCalled();
    } finally {
      rede.mockRestore();
    }
  });

  it("sem DEMO_MODE: inbox e webhook Datafy saem do ambiente, como antes", async () => {
    await comAmbiente({ DEMO_MODE: "1", ...AMBIENTE_REAL }, async () => {
      fake.integracao = integracaoDaDemo();
      const estado = await estadoDaIntegracao(6);
      expect(estado.inboxUrl).toBe("https://inbox-real.invalid/inbox");
      expect(estado.webhookDatafyUrl).toBe("https://chat-publico-real.invalid/api/v1/webhooks/WHATSAPP_OFFICIAL");
    });
  });
});

/**
 * As duas URLs que a ponte grava no chat: a base da API do agente (o console
 * libera o host dela e marca a conexao da ponte) e o webhook de volta da
 * automacao de resposta. Na demonstracao sao fixas no host do chat simulado e
 * CHAT_BULLQ_* nao se le — um valor esquecido no .env da demo nao chega a
 * automacao guardada na memoria do simulado. Fora dela, vale o de antes.
 */
describe("URL da API do agente e do webhook de volta na demonstracao", () => {
  const VARIAVEIS = ["DEMO_MODE", "CHAT_BULLQ_AGENTE_URL", "CHAT_BULLQ_WEBHOOK_URL"] as const;
  const AMBIENTE_REAL = {
    CHAT_BULLQ_AGENTE_URL: "https://agente-real.invalid/api/chat-bullq/agente/",
    CHAT_BULLQ_WEBHOOK_URL: "https://webhook-real.invalid/api/webhooks/chat-bullq/",
  };

  async function comAmbiente(valores: Partial<Record<(typeof VARIAVEIS)[number], string>>, executar: () => Promise<void>) {
    const antes = Object.fromEntries(VARIAVEIS.map(v => [v, process.env[v]]));
    for (const v of VARIAVEIS) { if (valores[v] === undefined) delete process.env[v]; else process.env[v] = valores[v]; }
    _usarClienteDoChatParaTestes(undefined);
    try { await executar(); } finally {
      for (const v of VARIAVEIS) { if (antes[v] === undefined) delete process.env[v]; else process.env[v] = antes[v]; }
      _usarClienteDoChatParaTestes(undefined);
    }
  }

  const integracaoSemAutomacao = () => ({ id: 1, providerId: 6, organizationId: "demo-org-6", slug: "sandbox-x", ownerEmail: "sandbox-x@demo.consultaisp.com.br", canalId: "demo-canal", canalNome: "WhatsApp da Demonstração", status: "ativo", webhookSecret: null, agenteConfig: {} });

  it("DEMO_MODE: fixas no host do chat simulado, mesmo com CHAT_BULLQ_* apontando para fora", async () => {
    await comAmbiente({ DEMO_MODE: "true", ...AMBIENTE_REAL }, async () => {
      expect(urlDaApiDoAgente()).toBe(`${URL_DO_CHAT_SIMULADO}/api/chat-bullq/agente`);
      expect(urlDoWebhookDeVolta()).toBe(`${URL_DO_CHAT_SIMULADO}/api/webhooks/chat-bullq`);
    });
  });

  it("DEMO_MODE: a automacao de resposta guardada no simulado leva o webhook local, sem rede", async () => {
    const rede = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("a demonstracao nao pode tocar a rede"); });
    limparChatSimuladoDoProvedor(6);
    try {
      await comAmbiente({ DEMO_MODE: "true", ...AMBIENTE_REAL }, async () => {
        fake.integracao = integracaoSemAutomacao();
        await garantirTransferenciaNaResposta(6);
        const automacoes = await clienteDoChat()!.listarAutomacoes("demo-org-6");
        expect(automacoes.ok).toBe(true);
        const guardadas = JSON.stringify(automacoes.ok ? automacoes.valor : null);
        expect(guardadas).toContain(`"url":"${URL_DO_CHAT_SIMULADO}/api/webhooks/chat-bullq"`);
        for (const valor of Object.values(AMBIENTE_REAL)) expect(guardadas).not.toContain(new URL(valor).host);
        expect(guardadas).not.toContain("consultaisp.com.br/api");
      });
      expect(rede).not.toHaveBeenCalled();
    } finally {
      rede.mockRestore();
      limparChatSimuladoDoProvedor(6);
    }
  });

  it("DEMO_MODE: a automacao de retorno semeada no simulado e vista LIGADA — nenhum sandbox acende o aviso de 'respostas nao chegam' — e religar nao mexe em nada, sem rede", async () => {
    const rede = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("a demonstracao nao pode tocar a rede"); });
    limparChatSimuladoDoProvedor(6);
    try {
      await comAmbiente({ DEMO_MODE: "true", ...AMBIENTE_REAL }, async () => {
        // O id que `agenteConfigDaDemo()` grava no sandbox (server/demo/chat-simulado.ts, AUTOMACAO_DE_RETORNO).
        fake.integracao = { ...integracaoSemAutomacao(), agenteConfig: { respostaHumanaAutomacaoId: "demo-automacao-resposta-humana", modoAtendimento: "primeira_resposta_humana" } };
        expect(await retornoDaIntegracao(6)).toEqual({ estado: "ligada", autoPausadoEm: null, falhas: null });
        expect(await religarRetornoSePausado(6)).toEqual({ estado: "ligada" });
        expect(fake.integracao.agenteConfig.respostaHumanaAutomacaoId).toBe("demo-automacao-resposta-humana");
      });
      expect(rede).not.toHaveBeenCalled();
    } finally {
      rede.mockRestore();
      limparChatSimuladoDoProvedor(6);
    }
  });

  it("sem DEMO_MODE: o ambiente vale (sem a barra final), chega a automacao, e sem ele volta o padrao de producao", async () => {
    await comAmbiente({ DEMO_MODE: "1", ...AMBIENTE_REAL }, async () => {
      expect(urlDaApiDoAgente()).toBe("https://agente-real.invalid/api/chat-bullq/agente");
      expect(urlDoWebhookDeVolta()).toBe("https://webhook-real.invalid/api/webhooks/chat-bullq");
      const c = clienteFalso();
      fake.integracao = { ...integracaoSemAutomacao(), organizationId: "org_1" };
      await garantirTransferenciaNaResposta(6);
      expect(c.criarAutomacao).toHaveBeenCalledWith("org_1", expect.objectContaining({
        actions: [{ type: "call_webhook", params: expect.objectContaining({ url: "https://webhook-real.invalid/api/webhooks/chat-bullq" }) }],
      }));
    });
    await comAmbiente({}, async () => {
      expect(urlDaApiDoAgente()).toBe("https://consultaisp.com.br/api/chat-bullq/agente");
      expect(urlDoWebhookDeVolta()).toBe("https://consultaisp.com.br/api/webhooks/chat-bullq");
    });
  });
});
