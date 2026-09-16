import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  ligado: true, getIntegracaoDoChat: vi.fn(), listarCanais: vi.fn(), estadoDaConexaoWhatsapp: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage: fake }));
vi.mock("../../storage/chat-autonomia.storage", () => ({ autonomiaStorage: {} }));
vi.mock("./chat-ponte.service", () => ({ clienteDoChat: () => fake.ligado ? fake : null, ErroDaPonteDoChat: class extends Error {} }));
import { diagnosticoDoAtendimento } from "./chat-atendimento.service";

beforeEach(() => {
  vi.resetAllMocks(); fake.ligado = true;
  fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 7, organizationId: "org7", canalId: "canal7", status: "ativo" });
  fake.listarCanais.mockResolvedValue({ ok: true, valor: [{ id: "canal7", type: "WHATSAPP_ZAPPFY", isActive: true, config: { token: "segredo" } }] });
  fake.estadoDaConexaoWhatsapp.mockResolvedValue({ ok: true, valor: { provider: "ZAPPFY", status: "connected", connected: true, loggedIn: true, phone: null, qrCode: null, pairCode: null } });
});

describe("diagnóstico de transporte do atendimento", () => {
  it("serviço offline é explícito e não expõe erro bruto ou canal", async () => {
    fake.listarCanais.mockResolvedValue({ ok: false, erro: "https://usuario:senha@privado" });
    const r = await diagnosticoDoAtendimento(7);
    expect(r).toMatchObject({ codigo: "SERVICO_INDISPONIVEL", servicoDisponivel: false, canalConfigurado: true });
    expect(JSON.stringify(r)).not.toMatch(/senha|privado|org7|canal7/);
    expect(fake.estadoDaConexaoWhatsapp).not.toHaveBeenCalled();
  });
  it("distingue configuração ausente e consulta apenas o provedor da sessão", async () => {
    fake.getIntegracaoDoChat.mockResolvedValue(null);
    expect(await diagnosticoDoAtendimento(7)).toMatchObject({ codigo: "SEM_CONFIGURACAO", servicoDisponivel: null, canalConfigurado: false });
    expect(fake.getIntegracaoDoChat).toHaveBeenCalledWith(7);
    expect(fake.listarCanais).not.toHaveBeenCalled();
    fake.ligado = false;
    expect(await diagnosticoDoAtendimento(7)).toMatchObject({ codigo: "CHAT_DESLIGADO" });
  });
  it("configuração de outro provedor nunca causa acesso remoto", async () => {
    fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 8, organizationId: "org8", canalId: "canal8" });
    expect(await diagnosticoDoAtendimento(7)).toMatchObject({ codigo: "SEM_CONFIGURACAO" });
    expect(fake.listarCanais).not.toHaveBeenCalled();
  });
  it("não confunde canal apagado ou payload inválido com canal conectado", async () => {
    fake.listarCanais.mockResolvedValueOnce({ ok: true, valor: [] });
    expect(await diagnosticoDoAtendimento(7)).toMatchObject({ codigo: "SEM_CANAL", servicoDisponivel: true, canalConfigurado: false });
    fake.listarCanais.mockResolvedValueOnce({ ok: true, valor: {} });
    expect(await diagnosticoDoAtendimento(7)).toMatchObject({ codigo: "RESPOSTA_INVALIDA" });
  });
  it("consulta a sessão atual sem conectar ou retornar telefone/QR/credenciais", async () => {
    const r = await diagnosticoDoAtendimento(7);
    expect(r).toMatchObject({ codigo: "PRONTO", servicoDisponivel: true, canalConfigurado: true, estadoCanal: "connected" });
    expect(fake.listarCanais).toHaveBeenCalledWith("org7");
    expect(fake.estadoDaConexaoWhatsapp).toHaveBeenCalledWith("org7", "canal7");
    expect(JSON.stringify(r)).not.toMatch(/token|segredo|org7|canal7/);
  });
  it("estado salvo ativo não mascara WhatsApp desconectado", async () => {
    fake.estadoDaConexaoWhatsapp.mockResolvedValue({ ok: true, valor: { provider: "ZAPPFY", status: "disconnected", connected: false, loggedIn: false, phone: null, qrCode: null, pairCode: null } });
    expect(await diagnosticoDoAtendimento(7)).toMatchObject({ codigo: "AGUARDANDO_CONEXAO", estadoCanal: "disconnected" });
  });
  it("erro na sessão não confirma conexão pelo estado salvo", async () => {
    fake.estadoDaConexaoWhatsapp.mockResolvedValue({ ok: false, erro: "token-secreto" });
    expect(await diagnosticoDoAtendimento(7)).toMatchObject({ codigo: "CONEXAO_NAO_CONFIRMADA", estadoCanal: null });
  });
});
