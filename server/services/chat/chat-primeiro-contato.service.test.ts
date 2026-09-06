import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ integracoesComContatoAutomatico: vi.fn(), getIntegracaoDoChat: vi.fn(), getUsersByProvider: vi.fn(), getPoliticaDeCobranca: vi.fn(), contatosIniciadosNoDia: vi.fn(), candidatosAoPrimeiroContato: vi.fn() }));
const ponte = vi.hoisted(() => ({ enviarCasoParaCobranca: vi.fn(), enviarRecuperacaoParaChat: vi.fn() }));
vi.mock("../../storage", () => ({ storage: fake }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("./chat-ponte.service", () => ponte);
vi.mock("./chat-trava", () => ({ comTravaDoChat: async (_chave: string, fn: () => Promise<unknown>) => fn() }));
import { executarPrimeirosContatos } from "./chat-primeiro-contato.service";

const duranteExpediente = new Date("2026-09-08T15:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  fake.integracoesComContatoAutomatico.mockResolvedValue([{ providerId: 6 }]);
  fake.getIntegracaoDoChat.mockResolvedValue({ agenteConfig: { primeiroContatoUserId: 3, primeiroContato: { ligada: true, limiteDiario: 2, cobranca: true, equipamentos: true } } });
  fake.getUsersByProvider.mockResolvedValue([{ id: 3, role: "admin", isActive: true }]);
  fake.getPoliticaDeCobranca.mockResolvedValue(null);
  fake.contatosIniciadosNoDia.mockResolvedValue(0);
  fake.candidatosAoPrimeiroContato.mockResolvedValue({ cobranca: [{ id: 1, diasAtraso: 12, carteira: "ativo", tom: "cuidado" }, { id: 2, diasAtraso: 40, carteira: "ex_cliente", tom: "humanizado_vulneravel" }], equipamentos: [{ id: 81 }] });
  ponte.enviarCasoParaCobranca.mockResolvedValue({ conversationId: "c1", enviado: true });
  ponte.enviarRecuperacaoParaChat.mockResolvedValue({ conversationId: "c2", enviado: true });
});
describe("agenda de primeiros contatos", () => {
  it("uma desativação no meio da rodada impede o próximo contato", async () => {
    ponte.enviarCasoParaCobranca.mockImplementationOnce(async () => {
      fake.getIntegracaoDoChat.mockResolvedValue({ agenteConfig: { primeiroContato: { ligada: false } } });
      return { conversationId: "c1", enviado: true };
    });
    await executarPrimeirosContatos(duranteExpediente);
    expect(ponte.enviarCasoParaCobranca).toHaveBeenCalledTimes(1);
    expect(ponte.enviarRecuperacaoParaChat).not.toHaveBeenCalled();
  });
  it("envia contato de cobrança e retirada sem automatizar vulnerável", async () => {
    await executarPrimeirosContatos(duranteExpediente);
    expect(ponte.enviarCasoParaCobranca).toHaveBeenCalledExactlyOnceWith(6, 1, 3);
    expect(ponte.enviarRecuperacaoParaChat).toHaveBeenCalledExactlyOnceWith(6, 81, 3);
  });
  it("não contata fora da janela, nem quando o administrador foi removido", async () => {
    await executarPrimeirosContatos(new Date("2026-09-08T02:00:00Z"));
    fake.getUsersByProvider.mockResolvedValue([]);
    await executarPrimeirosContatos(duranteExpediente);
    expect(ponte.enviarCasoParaCobranca).not.toHaveBeenCalled();
  });
  it("respeita teto diário e pausa da cobrança", async () => {
    fake.contatosIniciadosNoDia.mockResolvedValue(2);
    await executarPrimeirosContatos(duranteExpediente);
    expect(ponte.enviarCasoParaCobranca).not.toHaveBeenCalled();
    fake.contatosIniciadosNoDia.mockResolvedValue(0);
    fake.getPoliticaDeCobranca.mockResolvedValue({ pausada: true });
    await executarPrimeirosContatos(duranteExpediente);
    expect(ponte.enviarCasoParaCobranca).not.toHaveBeenCalled();
    expect(ponte.enviarRecuperacaoParaChat).toHaveBeenCalledTimes(1);
  });
  it("conversa reaproveitada não gastou mensagem, logo não gasta a cota do dia", async () => {
    fake.getIntegracaoDoChat.mockResolvedValue({ agenteConfig: { primeiroContatoUserId: 3, primeiroContato: { ligada: true, limiteDiario: 1, cobranca: true, equipamentos: true } } });
    ponte.enviarCasoParaCobranca.mockResolvedValue({ conversationId: "c1", enviado: false, motivo: "Conversa existente vinculada; nenhuma mensagem foi enviada" });
    await executarPrimeirosContatos(duranteExpediente);
    expect(ponte.enviarCasoParaCobranca).toHaveBeenCalledTimes(1);
    // A cota de 1 continua de pé: o contato seguinte ainda pode sair hoje.
    expect(ponte.enviarRecuperacaoParaChat).toHaveBeenCalledTimes(1);
  });
  it("cota de um contato para depois do primeiro envio de verdade", async () => {
    fake.getIntegracaoDoChat.mockResolvedValue({ agenteConfig: { primeiroContatoUserId: 3, primeiroContato: { ligada: true, limiteDiario: 1, cobranca: true, equipamentos: true } } });
    await executarPrimeirosContatos(duranteExpediente);
    expect(ponte.enviarCasoParaCobranca).toHaveBeenCalledTimes(1);
    expect(ponte.enviarRecuperacaoParaChat).not.toHaveBeenCalled();
  });
  it("configuração desligada não dispara; falha de transporte interrompe a rodada", async () => {
    fake.getIntegracaoDoChat.mockResolvedValueOnce({ agenteConfig: {} });
    await executarPrimeirosContatos(duranteExpediente);
    expect(ponte.enviarCasoParaCobranca).not.toHaveBeenCalled();
    ponte.enviarCasoParaCobranca.mockRejectedValueOnce(new Error("timeout"));
    await executarPrimeirosContatos(duranteExpediente);
    expect(ponte.enviarRecuperacaoParaChat).not.toHaveBeenCalled();
  });
});
