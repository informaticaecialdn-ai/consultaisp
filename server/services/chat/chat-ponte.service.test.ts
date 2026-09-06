import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A ponte sob contrato: provisiona a organizacao do provedor uma vez; liga o
 * canal e marca o estado; "enviar para cobranca" reaproveita a conversa do
 * telefone quando ela existe, registra o evento de contato no caso, liga a
 * conversa ao caso e move aberto → em contato; sem canal, sem telefone ou com
 * o chat desligado, explica em portugues em vez de mandar meia mensagem.
 * O telefone nunca vai para o log.
 */

vi.mock("../../db", () => ({ pool: {}, db: {} }));
vi.mock("./chat-trava", () => ({ comTravaDoChat: async (_chave: string, executar: () => Promise<unknown>) => executar() }));
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
  },
}));

import {
  _usarClienteDoChatParaTestes, configurarCanalWhatsapp, conversaDoCaso, definirSenhaDoInbox, enviarCasoParaCobranca, enviarRecuperacaoParaChat, ErroDaPonteDoChat,
  estadoDaIntegracao, garantirIntegracao, garantirAgenteDeCobranca, mensagemDeCobranca, mensagemDeRecuperacao,
} from "./chat-ponte.service";

function clienteFalso(sobrescritas: Record<string, any> = {}) {
  const c = {
    provisionarOrganizacao: vi.fn(async () => ({ ok: true, valor: { organizationId: "org_1", slug: "isp-6", ownerUserId: "u1", ownerEmail: "dono@nslink.com", created: true } })),
    criarCanalZappfy: vi.fn(async () => ({ ok: true, valor: { id: "ch_1", type: "WHATSAPP_ZAPPFY", name: "Principal", isActive: true } })),
    criarCanalWhatsapp: vi.fn(async () => ({ ok: true, valor: { id: "ch_2", type: "WHATSAPP_ZAPPFY", name: "Principal", isActive: true } })),
    testarCanal: vi.fn(async () => ({ ok: true, valor: { ok: true } })),
    capacidadesDosCanais: vi.fn(async () => ({ ok: true, valor: { whatsappUnofficial: true, instanceConnect: true, instanceStatus: true, provider: "ZAPPFY", uazapi: true, datafy: true, templateFirstContact: true } })),
    estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: true, valor: { provider: "ZAPPFY", status: "connected", connected: true, loggedIn: true, phone: "5543999990000", qrCode: null, pairCode: null } })),
    ligarAgenteAoCanal: vi.fn(async () => ({ ok: true, valor: undefined })),
    buscarConversaPorTelefone: vi.fn(async () => ({ ok: true, valor: null })),
    iniciarConversa: vi.fn(async () => ({ ok: true, valor: { conversationId: "conv_nova", messageId: "msg_1" } })),
    enviarTexto: vi.fn(async () => ({ ok: true, valor: { messageId: "msg_2", status: "QUEUED" } })),
    desligarIa: vi.fn(async () => ({ ok: true, valor: undefined })),
    criarAutomacao: vi.fn(async () => ({ ok: true, valor: { id: "auto_resposta" } })),
    listarAutomacoes: vi.fn(async () => ({ ok: true, valor: [] })),
    prepararPrimeiroContato: vi.fn(async (_org: string, id: string, contexto: { nomeCliente: string; nomeProvedor: string }) => ({ ok: true, valor: { texto: `Olá, ${contexto.nomeCliente}! Sou o assistente virtual da ${contexto.nomeProvedor}. Podemos conversar${id === "ag-equip" ? " sobre a devolução do equipamento" : ""}?`, agenteId: id, modelo: "sakana/modelo-real", runId: "draft-1" } })),
    listarMensagens: vi.fn(async () => ({ ok: true, valor: [{ id: "m1", direction: "OUTBOUND", type: "TEXT", content: { text: "Ola" }, status: "SENT", senderName: "NsLink", createdAt: "2026-09-05T10:00:00Z" }] })),
    definirSenhaDoOwner: vi.fn(async () => ({ ok: true, valor: { ownerUserId: "u1", ownerEmail: "dono@nslink.com" } })),
    ...sobrescritas,
  };
  _usarClienteDoChatParaTestes(c as any);
  return c;
}

const CASO = {
  id: 10, status: "aberto", carteira: "ativo", valorAtual: 189.9,
  cliente: { id: 42, nome: "Maria da Silva", cpfCnpj: "12345678909", telefone: "(43) 99999-0000", email: null, cidade: null, bairro: null, statusErp: "active", dividaAtual: 189.9, diasAtraso: 47, faturasAbertas: 2 },
};
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
  it("cria o canal, testa, confirma o numero conectado e logado, e so entao marca ativo", async () => {
    const c = clienteFalso();
    const r = await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(c.criarCanalZappfy).toHaveBeenCalledWith("org_1", { nome: "Principal", token: "tok_secreto_123", webhookSecret: undefined });
    expect(c.estadoDaConexaoWhatsapp).toHaveBeenCalledWith("org_1", "ch_1");
    expect(r.canalOk).toBe(true);
    expect(fake.integracao).toMatchObject({ status: "ativo", canalId: "ch_1", canalNome: "Principal", ultimoErro: null });
  });
  it("Zappfy sem pareamento: token valido nao liga o canal — fica aguardando_conexao, e a automacao (que exige 'ativo') nao dispara", async () => {
    clienteFalso({ estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: true, valor: { provider: "ZAPPFY", status: "connecting", connected: false, loggedIn: false, phone: null, qrCode: null, pairCode: null } })) });
    const r = await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(r.canalOk).toBe(false);
    expect(fake.integracao).toMatchObject({ status: "aguardando_conexao", canalId: "ch_1", ultimoErro: "Aguardando o pareamento do WhatsApp" });
  });
  it("conectado mas nao logado tambem nao e ativo", async () => {
    clienteFalso({ estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: true, valor: { provider: "ZAPPFY", status: "connected", connected: true, loggedIn: false, phone: null, qrCode: null, pairCode: null } })) });
    await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(fake.integracao.status).toBe("aguardando_conexao");
  });
  it("connection-status indisponivel: diz a causa medida, nao inventa 'aguardando o pareamento'", async () => {
    clienteFalso({ estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: false, erro: "token=SEGREDO nao encontrado", status: 404 })) });
    await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(fake.integracao).toMatchObject({ status: "erro", ultimoErro: "Não foi possível consultar o estado da conexão: o chat respondeu HTTP 404" });
    // O texto bruto do gateway pode carregar credencial: nao vai para a coluna.
    expect(JSON.stringify(fake.integracao)).not.toContain("SEGREDO");
    fake.integracao = undefined;
    clienteFalso({ estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: false, erro: "fetch failed" })) });
    await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(fake.integracao).toMatchObject({ status: "erro", ultimoErro: "Não foi possível consultar o estado da conexão: o serviço não respondeu" });
  });
  it("Uazapi com capability do fork: cria pelo canal generico e tambem exige o numero pareado", async () => {
    const c = clienteFalso({ estadoDaConexaoWhatsapp: vi.fn(async () => ({ ok: true, valor: { provider: "UAZAPI", status: "disconnected", connected: false, loggedIn: false, phone: null, qrCode: null, pairCode: null } })) });
    const r = await configurarCanalWhatsapp(6, { provider: "UAZAPI", nome: "Principal", token: "tok_secreto_123", baseUrl: "https://minha.uazapi.com" });
    expect(c.capacidadesDosCanais).toHaveBeenCalledWith("org_1");
    expect(c.criarCanalWhatsapp).toHaveBeenCalledWith("org_1", expect.objectContaining({ provider: "UAZAPI", baseUrl: "https://minha.uazapi.com" }));
    expect(r.canalOk).toBe(false);
    expect(fake.integracao).toMatchObject({ status: "aguardando_conexao", canalId: "ch_2", agenteConfig: { whatsapp: { provider: "UAZAPI", baseUrl: "https://minha.uazapi.com" } } });
  });
  it.each([
    ["UAZAPI", { provider: "UAZAPI" as const, nome: "Principal", token: "tok_secreto_123", baseUrl: "https://minha.uazapi.com" }, { uazapi: false, datafy: true }],
    ["DATAFY", { provider: "DATAFY" as const, nome: "Oficial", token: "tok_secreto_123", phoneNumberId: "123456789", webhookSecret: "whsec_segredo_datafy_1" }, { uazapi: true, datafy: false }],
  ])("%s sem a capability no fork: CHAT_SEM_SUPORTE e o token nunca sai daqui", async (_nome, dados, caps) => {
    const c = clienteFalso({ capacidadesDosCanais: vi.fn(async () => ({ ok: true, valor: { whatsappUnofficial: true, instanceConnect: true, instanceStatus: true, provider: "ZAPPFY", templateFirstContact: true, ...caps } })) });
    await expect(configurarCanalWhatsapp(6, dados)).rejects.toMatchObject({ codigo: "CHAT_SEM_SUPORTE", message: expect.stringContaining("ainda não aceita este serviço") });
    expect(c.criarCanalWhatsapp).not.toHaveBeenCalled();
    expect(c.criarCanalZappfy).not.toHaveBeenCalled();
    expect(fake.integracao.canalId).toBeNull();
    expect(JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls])).not.toContain("tok_secreto");
  });
  it("fork sem o endpoint de capabilities (404): tambem recusa Uazapi/Datafy; Zappfy nem consulta", async () => {
    const c = clienteFalso({ capacidadesDosCanais: vi.fn(async () => ({ ok: false, erro: "404", status: 404 })) });
    await expect(configurarCanalWhatsapp(6, { provider: "UAZAPI", nome: "Principal", token: "tok_secreto_123", baseUrl: "https://minha.uazapi.com" })).rejects.toMatchObject({ codigo: "CHAT_SEM_SUPORTE" });
    expect(c.criarCanalWhatsapp).not.toHaveBeenCalled();
    await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(c.capacidadesDosCanais).toHaveBeenCalledTimes(1);
    expect(c.criarCanalZappfy).toHaveBeenCalledTimes(1);
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
    await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(c.ligarAgenteAoCanal).toHaveBeenCalledWith("org_1", "ag_1", "ch_1", "DISABLED");
  });
  it("canal novo e ligado DISABLED a TODOS os perfis de agente do provedor, sem repetir o legado", async () => {
    const c = clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: null, status: "provisionado", agenteId: "ag-ativos", agenteConfig: AGENTES_PRONTOS };
    await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    const vinculos = c.ligarAgenteAoCanal.mock.calls.map(([org, agente, canal, modo]) => [org, agente, canal, modo]);
    expect(vinculos).toHaveLength(3);
    expect(vinculos).toEqual(expect.arrayContaining([["org_1", "ag-ativos", "ch_1", "DISABLED"], ["org_1", "ag-ex", "ch_1", "DISABLED"], ["org_1", "ag-equip", "ch_1", "DISABLED"]]));
    expect(vinculos.every(([, , , modo]) => modo === "DISABLED")).toBe(true);
  });
  it("perfil sem id ainda nao existe la: nao tenta ligar; vinculo que falha vira aviso sem derrubar o canal", async () => {
    const c = clienteFalso({ ligarAgenteAoCanal: vi.fn(async () => ({ ok: false, erro: "agent not found", status: 404 })) });
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: null, status: "provisionado", agenteConfig: { agentes: { cobranca_ativos: { id: "ag-ativos", etapa: "pronto" }, cobranca_ex_clientes: { etapa: "nao_configurado" } } } };
    const r = await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(c.ligarAgenteAoCanal).toHaveBeenCalledTimes(1);
    expect(c.ligarAgenteAoCanal).toHaveBeenCalledWith("org_1", "ag-ativos", "ch_1", "DISABLED");
    expect(r.canalOk).toBe(true);
    expect(log.warn).toHaveBeenCalled();
  });
  it("teste do canal falhou: fica em erro com o motivo, mas o canal fica guardado", async () => {
    const c = clienteFalso({ testarCanal: vi.fn(async () => ({ ok: true, valor: { ok: false, message: "instancia desconectada" } })) });
    const r = await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(r.canalOk).toBe(false);
    expect(c.estadoDaConexaoWhatsapp).not.toHaveBeenCalled();
    expect(fake.integracao).toMatchObject({ status: "erro", ultimoErro: "instancia desconectada", canalId: "ch_1" });
  });
  it("o token nunca aparece no log", async () => {
    clienteFalso({ criarCanalZappfy: vi.fn(async () => ({ ok: false, erro: "recusado", status: 400 })) });
    await expect(configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" })).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
    const tudo = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]);
    expect(tudo).not.toContain("tok_secreto");
  });
});

describe("enviarCasoParaCobranca", () => {
  const comCanal = () => { fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", canalNome: "Principal", status: "ativo", ultimoErro: null, agenteConfig: AGENTES_PRONTOS }; };
  it("falha no draft bloqueia envio e não usa template de fallback", async () => {
    const c = clienteFalso({ prepararPrimeiroContato: vi.fn(async () => ({ ok: false, erro: "Modelo sem credencial" })) }); comCanal();
    await expect(enviarCasoParaCobranca(6, 10, 3)).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
    expect(c.iniciarConversa).not.toHaveBeenCalled(); expect(fake.eventos).toEqual([]);
  });
  it("ex-cliente usa seu agente exclusivo", async () => {
    const c = clienteFalso(); comCanal(); fake.caso = { ...CASO, carteira: "ex_cliente" };
    await enviarCasoParaCobranca(6, 10, 3);
    expect(c.prepararPrimeiroContato).toHaveBeenCalledWith("org_1", "ag-ex", expect.objectContaining({ nomeCliente: "Maria" }));
    expect(fake.eventos[0].metadata.origemTexto).toBe("agente_ia");
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
    expect(dados.texto).toContain("Maria");
    expect(dados.texto).toContain("NsLink");
    expect(dados.texto).not.toContain("R$");
    expect(dados.texto).not.toContain("Lembrar do vencimento com cordialidade.");
    expect(dados.texto).toContain("assistente virtual");
    expect(dados.aiEnabled).toBe(false);
    expect(r).toMatchObject({ conversationId: "conv_nova", reaproveitada: false, messageId: "msg_1", inboxUrl: "https://chat.consultaisp.com.br/inbox" });
    expect(fake.conversasRegistradas[0]).toMatchObject({ customerId: 42, origem: "cobranca", casoId: 10, conversationId: "conv_nova", canalId: "ch_1", abertaPorUserId: 3 });
    expect(fake.eventos[0]).toMatchObject({ casoId: 10, userId: 3, tipo: "contato", canal: "whatsapp" });
    expect(fake.eventos[0].metadata.chat.conversationId).toBe("conv_nova");
    expect(fake.patches).toEqual([{ id: 10, patch: { status: "em_contato" } }]);
  });
  it("texto do operador vence o modelo; caso ja em contato nao muda de status", async () => {
    const c = clienteFalso(); comCanal();
    fake.caso = { ...CASO, status: "em_contato" };
    await enviarCasoParaCobranca(6, 10, 3, "Oi Maria, tudo bem? Podemos combinar?");
    expect(c.iniciarConversa.mock.calls[0][1].texto).toBe("Oi Maria, tudo bem? Podemos combinar?");
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
    expect(fake.eventos[0].metadata.origemTexto).toBe("agente_ia");
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
});

describe("enviarRecuperacaoParaChat", () => {
  it("manda a mensagem de retirada com o equipamento e liga a conversa ao caso de recuperacao", async () => {
    const c = clienteFalso();
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", status: "ativo", agenteConfig: AGENTES_PRONTOS };
    fake.recuperacoes = [{ id: 77, customerId: 42, customerName: "Joao Pereira", customerPhone: "43988880000", equipmentType: "ONU", equipmentBrand: "Huawei", equipmentModel: "HG8145V5" }];
    const r = await enviarRecuperacaoParaChat(6, 77, 3);
    expect(c.iniciarConversa.mock.calls[0][1].texto).toContain("devolução do equipamento");
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
