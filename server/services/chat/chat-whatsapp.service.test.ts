import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  getIntegracaoDoChat: vi.fn(), marcarEstadoDaIntegracaoDoChat: vi.fn(),
  capacidadesDosCanais: vi.fn(), estadoDaConexaoWhatsapp: vi.fn(), conectarWhatsapp: vi.fn(),
  ligado: true, travado: false,
}));
vi.mock("../../storage", () => ({ storage: fake }));
vi.mock("./chat-ponte.service", () => ({
  clienteDoChat: () => fake.ligado ? fake : null,
  ErroDaPonteDoChat: class extends Error { constructor(public codigo: string, mensagem: string) { super(mensagem); } },
}));
vi.mock("./chat-trava", () => ({ comTravaDoChat: async (_chave: string, executar: () => Promise<unknown>) => fake.travado ? null : executar() }));
import { consultarOuConectarWhatsapp } from "./chat-whatsapp.service";
import { ConectarWhatsappSchema } from "@shared/chat-whatsapp";

const conectado = { provider: "ZAPPFY", status: "connected", connected: true, loggedIn: true, phone: "5543999990000", qrCode: null, pairCode: null };
beforeEach(() => {
  vi.resetAllMocks(); fake.ligado = true; fake.travado = false;
  fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 7, organizationId: "org-7", canalId: "canal-7" });
  fake.capacidadesDosCanais.mockResolvedValue({ ok: true, valor: { whatsappUnofficial: true, instanceConnect: true, instanceStatus: true } });
  fake.estadoDaConexaoWhatsapp.mockResolvedValue({ ok: true, valor: conectado });
  fake.conectarWhatsapp.mockResolvedValue({ ok: true, valor: { ...conectado, status: "connecting", connected: false, loggedIn: false, qrCode: "data:image/png;base64,iVBORw0KGgo=" } });
});

describe("conexão WhatsApp não oficial", () => {
  it("consulta apenas organização/canal do provedor e remove campos remotos extras", async () => {
    fake.estadoDaConexaoWhatsapp.mockResolvedValue({ ok: true, valor: { ...conectado, token: "segredo", instance: { token: "segredo" } } });
    expect(await consultarOuConectarWhatsapp(7, "consultar")).toEqual(conectado);
    expect(fake.estadoDaConexaoWhatsapp).toHaveBeenCalledWith("org-7", "canal-7");
    expect(fake.marcarEstadoDaIntegracaoDoChat).toHaveBeenCalledWith(7, { status: "ativo", ultimoErro: null });
  });
  it("conectar QR não envia telefone e marca pareamento pendente", async () => {
    expect((await consultarOuConectarWhatsapp(7, "conectar")).qrCode).toContain("data:image/png");
    expect(fake.conectarWhatsapp).toHaveBeenCalledWith("org-7", "canal-7", undefined);
    expect(fake.marcarEstadoDaIntegracaoDoChat).toHaveBeenCalledWith(7, { status: "aguardando_conexao", ultimoErro: "Aguardando o pareamento do WhatsApp" });
  });
  it("encaminha o número somente ao pedir código de pareamento", async () => {
    await consultarOuConectarWhatsapp(7, "conectar", "5543999990000");
    expect(fake.conectarWhatsapp).toHaveBeenCalledWith("org-7", "canal-7", "5543999990000");
  });
  it("canal salvo em aguardando_conexao continua aguardando (nao vira erro) e so vira ativo conectado E logado", async () => {
    fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 7, organizationId: "org-7", canalId: "canal-7", status: "aguardando_conexao" });
    fake.estadoDaConexaoWhatsapp.mockResolvedValueOnce({ ok: true, valor: { ...conectado, status: "connecting", connected: false, loggedIn: false } });
    await consultarOuConectarWhatsapp(7, "consultar");
    // A mesma situacao fisica que a ponte gravou nao pode ganhar outro nome no
    // primeiro "Verificar conexao": erro e para consulta que falhou.
    expect(fake.marcarEstadoDaIntegracaoDoChat).toHaveBeenLastCalledWith(7, { status: "aguardando_conexao", ultimoErro: "Aguardando o pareamento do WhatsApp" });
    await consultarOuConectarWhatsapp(7, "consultar");
    expect(fake.marcarEstadoDaIntegracaoDoChat).toHaveBeenLastCalledWith(7, { status: "ativo", ultimoErro: null });
  });
  it("conexão exige login confirmado e apaga QR após conectar", async () => {
    fake.estadoDaConexaoWhatsapp.mockResolvedValueOnce({ ok: true, valor: { ...conectado, loggedIn: false } });
    await consultarOuConectarWhatsapp(7, "consultar");
    expect(fake.marcarEstadoDaIntegracaoDoChat).toHaveBeenLastCalledWith(7, { status: "aguardando_conexao", ultimoErro: "A instância de WhatsApp não está conectada" });
    fake.estadoDaConexaoWhatsapp.mockResolvedValueOnce({ ok: true, valor: { ...conectado, qrCode: "data:image/png;base64,iVBORw0KGgo=", pairCode: "1234-5678" } });
    expect(await consultarOuConectarWhatsapp(7, "consultar")).toMatchObject({ qrCode: null, pairCode: null });
  });
  it.each([null, { providerId: 8, organizationId: "outra", canalId: "outro" }, { providerId: 7 }])("recusa integração ausente/inconsistente: %j", async (integracao) => {
    fake.getIntegracaoDoChat.mockResolvedValue(integracao);
    await expect(consultarOuConectarWhatsapp(7, "consultar")).rejects.toMatchObject({ codigo: "SEM_CANAL" });
    expect(fake.capacidadesDosCanais).not.toHaveBeenCalled();
  });
  it("não chama endpoints novos em instalação sem capacidade", async () => {
    fake.capacidadesDosCanais.mockResolvedValue({ ok: false, erro: "404" });
    await expect(consultarOuConectarWhatsapp(7, "conectar")).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(fake.conectarWhatsapp).not.toHaveBeenCalled();
  });
  it("recusa QR remoto/SVG e não marca a conexão como ativa", async () => {
    fake.estadoDaConexaoWhatsapp.mockResolvedValue({ ok: true, valor: { ...conectado, qrCode: "https://externo.example/qr" } });
    await expect(consultarOuConectarWhatsapp(7, "consultar")).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
    expect(fake.marcarEstadoDaIntegracaoDoChat).not.toHaveBeenCalled();
  });
  it("erro do gateway não expõe nem persiste credenciais", async () => {
    fake.estadoDaConexaoWhatsapp.mockResolvedValue({ ok: false, erro: "token=SEGREDO" });
    await expect(consultarOuConectarWhatsapp(7, "consultar")).rejects.not.toThrow("SEGREDO");
    expect(fake.marcarEstadoDaIntegracaoDoChat).not.toHaveBeenCalled();
  });
  it("operação concorrente não chama API nem altera canal", async () => {
    fake.travado = true;
    await expect(consultarOuConectarWhatsapp(7, "conectar")).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(fake.conectarWhatsapp).not.toHaveBeenCalled();
  });
  it("sem serviço configurado informa indisponibilidade", async () => {
    fake.ligado = false;
    await expect(consultarOuConectarWhatsapp(7, "consultar")).rejects.toMatchObject({ codigo: "CHAT_DESLIGADO" });
  });
  it("entrada aceita QR vazio ou número brasileiro e rejeita ids injetados", () => {
    expect(ConectarWhatsappSchema.safeParse({}).success).toBe(true);
    expect(ConectarWhatsappSchema.safeParse({ phone: "5543999990000" }).success).toBe(true);
    expect(ConectarWhatsappSchema.safeParse({ phone: "1234" }).success).toBe(false);
    expect(ConectarWhatsappSchema.safeParse({ channelId: "outro" }).success).toBe(false);
  });
});
