import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  i: { providerId: 6, organizationId: "org6", canalId: "ch6", agenteConfig: { whatsapp: { provider: "DATAFY" }, primeiroContato: { ligada: false }, agentes: { cobranca_ativos: { id: "ag6" } }, templatesDatafy: {} } } as Record<string, unknown>,
}));
const data = [{ name: "abertura", language: "pt_BR", status: "APPROVED", components: [{ type: "BODY", text: "Olá {{1}}, aqui é {{2}}" }] }];
const client = vi.hoisted(() => ({ listarTemplatesWhatsapp: vi.fn() }));
const db = vi.hoisted(() => ({ getIntegracaoDoChat: vi.fn(), guardarAgenteDoChat: vi.fn() }));
vi.mock("../../storage", () => ({ storage: db }));
vi.mock("./chat-ponte.service", () => ({ clienteDoChat: () => client, ErroDaPonteDoChat: class extends Error { constructor(public codigo: string, m: string) { super(m); } } }));
vi.mock("./chat-agentes.service", () => ({ comTravaDaConfiguracaoDoChat: async (_p: number, fn: () => Promise<unknown>) => fn() }));
import { catalogoTemplatesWhatsapp, prepararTemplateWhatsapp, salvarTemplatesWhatsapp } from "./chat-templates.service";
const config = { cobranca_ativos: { nome: "abertura", idioma: "pt_BR", variaveis: ["nomeCliente" as const, "nomeProvedor" as const] } };
beforeEach(() => {
  vi.clearAllMocks();
  state.i = { providerId: 6, organizationId: "org6", canalId: "ch6", agenteConfig: { whatsapp: { provider: "DATAFY" }, primeiroContato: { ligada: false }, agentes: { cobranca_ativos: { id: "ag6" } }, templatesDatafy: {} } };
  db.getIntegracaoDoChat.mockImplementation(async () => state.i);
  client.listarTemplatesWhatsapp.mockResolvedValue({ ok: true, valor: { data } });
});
describe("templates Datafy por provedor", () => {
  it("consulta somente o canal da organização do provedor", async () => {
    await catalogoTemplatesWhatsapp(6);
    expect(client.listarTemplatesWhatsapp).toHaveBeenCalledWith("org6", "ch6");
    await expect(catalogoTemplatesWhatsapp(7)).rejects.toMatchObject({ codigo: "SEM_CANAL" });
    expect(client.listarTemplatesWhatsapp).toHaveBeenCalledTimes(1);
  });
  it("salva somente configuração validada e preserva catálogo de agentes e agenda", async () => {
    await salvarTemplatesWhatsapp(6, config);
    expect(db.guardarAgenteDoChat).toHaveBeenCalledWith(6, { agenteConfig: expect.objectContaining({ whatsapp: { provider: "DATAFY" }, agentes: { cobranca_ativos: { id: "ag6" } }, primeiroContato: { ligada: false }, templatesDatafy: config }) });
  });
  it("rejeita variável proibida mesmo em chamada interna sem validação de rota", async () => {
    await expect(salvarTemplatesWhatsapp(6, { cobranca_ativos: { ...config.cobranca_ativos, variaveis: ["segredo" as never, "nomeProvedor"] } })).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(db.guardarAgenteDoChat).not.toHaveBeenCalled();
  });
  it("reconfere identidade e canal antes de gravar após a consulta remota", async () => {
    db.getIntegracaoDoChat.mockResolvedValueOnce(state.i).mockResolvedValueOnce({ ...state.i, providerId: 7, organizationId: "org7", canalId: "ch7" });
    await expect(salvarTemplatesWhatsapp(6, config)).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(db.guardarAgenteDoChat).not.toHaveBeenCalled();
  });
  it("não aprova template pendente nem variáveis de contagem incorreta", async () => {
    client.listarTemplatesWhatsapp.mockResolvedValueOnce({ ok: true, valor: { data: [{ ...data[0], status: "PENDING" }] } });
    await expect(salvarTemplatesWhatsapp(6, config)).rejects.toMatchObject({ codigo: "CONFLITO" });
    await expect(salvarTemplatesWhatsapp(6, { cobranca_ativos: { ...config.cobranca_ativos, variaveis: [] } })).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(db.guardarAgenteDoChat).not.toHaveBeenCalled();
  });
  it("revalida aprovação na preparação e não retorna erro remoto contendo credenciais", async () => {
    state.i.agenteConfig = { whatsapp: { provider: "DATAFY" }, templatesDatafy: config };
    const contexto = { nomeCliente: "Maria", nomeProvedor: "ISP" };
    const t = await prepararTemplateWhatsapp(6, "cobranca_ativos", contexto);
    expect(t).toMatchObject({ name: "abertura", language: { code: "pt_BR" } });
    client.listarTemplatesWhatsapp.mockResolvedValueOnce({ ok: false, erro: "Bearer segredo-remoto" });
    try { await prepararTemplateWhatsapp(6, "cobranca_ativos", contexto); throw new Error("Era esperado erro"); }
    catch (e) { expect((e as Error).message).not.toContain("segredo-remoto"); expect(e).toMatchObject({ codigo: "CHAT_FALHOU" }); }
    client.listarTemplatesWhatsapp.mockResolvedValueOnce({ ok: true, valor: { data: [{ ...data[0], status: "REJECTED" }] } });
    await expect(prepararTemplateWhatsapp(6, "cobranca_ativos", contexto)).rejects.toMatchObject({ codigo: "CONFLITO" });
  });
  it("recusa catálogo de um canal diferente da conversa que será aberta", async () => {
    state.i.agenteConfig = { whatsapp: { provider: "DATAFY" }, templatesDatafy: config };
    await expect(prepararTemplateWhatsapp(6, "cobranca_ativos", { nomeCliente: "Maria", nomeProvedor: "ISP" }, { organizationId: "org6", canalId: "canal-anterior" })).rejects.toMatchObject({ codigo: "CONFLITO" });
  });
  it("exceção inesperada do transporte também oculta credencial", async () => {
    client.listarTemplatesWhatsapp.mockRejectedValueOnce(new Error("Bearer segredo-em-excecao"));
    await expect(catalogoTemplatesWhatsapp(6)).rejects.toMatchObject({ codigo: "CHAT_FALHOU", message: expect.not.stringContaining("segredo-em-excecao") });
  });
});
