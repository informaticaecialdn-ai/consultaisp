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
  },
}));

import {
  _usarClienteDoChatParaTestes, configurarCanalWhatsapp, conversaDoCaso, enviarCasoParaCobranca, enviarRecuperacaoParaChat, ErroDaPonteDoChat,
  estadoDaIntegracao, garantirIntegracao, mensagemDeCobranca, mensagemDeRecuperacao,
} from "./chat-ponte.service";

function clienteFalso(sobrescritas: Record<string, any> = {}) {
  const c = {
    provisionarOrganizacao: vi.fn(async () => ({ ok: true, valor: { organizationId: "org_1", slug: "isp-6", ownerUserId: "u1", ownerEmail: "dono@nslink.com", created: true } })),
    criarCanalZappfy: vi.fn(async () => ({ ok: true, valor: { id: "ch_1", type: "WHATSAPP_ZAPPFY", name: "Principal", isActive: true } })),
    testarCanal: vi.fn(async () => ({ ok: true, valor: { ok: true } })),
    buscarConversaPorTelefone: vi.fn(async () => ({ ok: true, valor: null })),
    iniciarConversa: vi.fn(async () => ({ ok: true, valor: { conversationId: "conv_nova", messageId: "msg_1" } })),
    enviarTexto: vi.fn(async () => ({ ok: true, valor: { messageId: "msg_2", status: "QUEUED" } })),
    listarMensagens: vi.fn(async () => ({ ok: true, valor: [{ id: "m1", direction: "OUTBOUND", type: "TEXT", content: { text: "Ola" }, status: "SENT", senderName: "NsLink", createdAt: "2026-09-05T10:00:00Z" }] })),
    ...sobrescritas,
  };
  _usarClienteDoChatParaTestes(c as any);
  return c;
}

const CASO = {
  id: 10, status: "aberto", carteira: "ativo", valorAtual: 189.9,
  cliente: { id: 42, nome: "Maria da Silva", cpfCnpj: "12345678909", telefone: "(43) 99999-0000", email: null, cidade: null, bairro: null, statusErp: "active", dividaAtual: 189.9, diasAtraso: 47, faturasAbertas: 2 },
};

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
  it("cria o canal, testa e marca ativo com o id do canal", async () => {
    const c = clienteFalso();
    const r = await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(c.criarCanalZappfy).toHaveBeenCalledWith("org_1", { nome: "Principal", token: "tok_secreto_123", webhookSecret: undefined });
    expect(r.canalOk).toBe(true);
    expect(fake.integracao).toMatchObject({ status: "ativo", canalId: "ch_1", canalNome: "Principal", ultimoErro: null });
  });
  it("teste do canal falhou: fica em erro com o motivo, mas o canal fica guardado", async () => {
    clienteFalso({ testarCanal: vi.fn(async () => ({ ok: true, valor: { ok: false, message: "instancia desconectada" } })) });
    const r = await configurarCanalWhatsapp(6, { nome: "Principal", token: "tok_secreto_123" });
    expect(r.canalOk).toBe(false);
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
  const comCanal = () => { fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", canalNome: "Principal", status: "ativo", ultimoErro: null }; };

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
    expect(dados.texto).toContain("R$");
    expect(dados.texto).toContain("47 dias");
    expect(dados.texto).toContain("Lembrar do vencimento com cordialidade.");
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
  it("conversa do telefone ja existe e nao esta fechada: reaproveita e so manda o texto", async () => {
    const c = clienteFalso({ buscarConversaPorTelefone: vi.fn(async () => ({ ok: true, valor: { id: "conv_velha", status: "OPEN", contact: { name: "Maria", phone: "5543999990000" }, channel: { id: "ch_1", type: "WHATSAPP_ZAPPFY", name: "Principal" }, assignedTo: null, aiEnabled: null, activeAgentId: null, lastMessageAt: null } })) }); comCanal();
    const r = await enviarCasoParaCobranca(6, 10, 3);
    expect(c.iniciarConversa).not.toHaveBeenCalled();
    expect(c.enviarTexto).toHaveBeenCalledWith("org_1", "conv_velha", expect.any(String));
    expect(r).toMatchObject({ conversationId: "conv_velha", reaproveitada: true, messageId: "msg_2" });
    expect(fake.eventos[0].notas).toContain("ja existente");
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
    fake.integracao = { id: 1, providerId: 6, organizationId: "org_1", slug: "isp-6", ownerEmail: "x", canalId: "ch_1", status: "ativo" };
    fake.recuperacoes = [{ id: 77, customerId: 42, customerName: "Joao Pereira", customerPhone: "43988880000", equipmentType: "ONU", equipmentBrand: "Huawei", equipmentModel: "HG8145V5" }];
    const r = await enviarRecuperacaoParaChat(6, 77, 3);
    expect(c.iniciarConversa.mock.calls[0][1].texto).toContain("ONU Huawei HG8145V5");
    expect(c.iniciarConversa.mock.calls[0][1].telefone).toBe("5543988880000");
    expect(fake.conversasRegistradas[0]).toMatchObject({ origem: "equipamentos", recuperacaoId: 77, customerId: 42 });
    expect(r.conversationId).toBe("conv_nova");
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
