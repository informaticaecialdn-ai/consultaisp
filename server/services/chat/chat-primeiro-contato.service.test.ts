import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ integracoesComContatoAutomatico: vi.fn(), getIntegracaoDoChat: vi.fn(), getUsersByProvider: vi.fn(), getPoliticaDeCobranca: vi.fn(), contatosIniciadosNoDia: vi.fn(), candidatosAoPrimeiroContato: vi.fn() }));
const ponte = vi.hoisted(() => ({ enviarCasoParaCobranca: vi.fn(), enviarRecuperacaoParaChat: vi.fn() }));
const pre = vi.hoisted(() => ({ prepararPreAvisos: vi.fn(), contatosReservadosNoDia: vi.fn(), listarPreAvisosPendentes: vi.fn(), executarPreAviso: vi.fn() }));
vi.mock("../../storage/cobranca-preventivo.storage", () => ({ CobrancaPreventivoStorage: class { prepararPreAvisos = pre.prepararPreAvisos; contatosReservadosNoDia = pre.contatosReservadosNoDia; listarPreAvisosPendentes = pre.listarPreAvisosPendentes; } }));
vi.mock("./chat-preventivo.service", () => ({ executarPreAviso: pre.executarPreAviso }));
vi.mock("../../storage", () => ({ storage: fake }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("./chat-ponte.service", () => ponte);
vi.mock("./chat-trava", () => ({ comTravaDoChat: async (_chave: string, fn: () => Promise<unknown>) => fn() }));
import { executarPrimeirosContatos } from "./chat-primeiro-contato.service";

const duranteExpediente = new Date("2026-09-08T15:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(fake, { atualizarCasoDeCobranca: vi.fn(async () => ({})), registrarEventoDeCobranca: vi.fn(async () => ({})) });
  pre.contatosReservadosNoDia.mockResolvedValue(0);
  pre.prepararPreAvisos.mockResolvedValue(0);
  pre.listarPreAvisosPendentes.mockResolvedValue([{ id: 21 }]);
  pre.executarPreAviso.mockResolvedValue({ enviado: true });
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
  it("executa candidato depois de 200 bloqueados sem contatar os vulneráveis", async () => {
    fake.candidatosAoPrimeiroContato
      .mockResolvedValueOnce({ cobranca: Array.from({ length: 200 }, (_, i) => ({ id: i + 1, carteira: "ativo", diasAtraso: 12, tom: "humanizado_vulneravel" })), equipamentos: [], proximoId: 200 })
      .mockResolvedValueOnce({ cobranca: [{ id: 201, carteira: "ativo", diasAtraso: 12 }], equipamentos: [], proximoId: null });
    await executarPrimeirosContatos(duranteExpediente);
    expect(ponte.enviarCasoParaCobranca).toHaveBeenCalledExactlyOnceWith(6, 201, 3);
  });
  it("pré-aviso usa o mesmo teto diário e exige opção explícita", async () => {
    await executarPrimeirosContatos(duranteExpediente);
    expect(pre.executarPreAviso).not.toHaveBeenCalled();
    fake.getIntegracaoDoChat.mockResolvedValue({ agenteConfig: { primeiroContatoUserId: 3, primeiroContato: { ligada: true, preventivo: true, limiteDiario: 1 } } });
    await executarPrimeirosContatos(duranteExpediente);
    expect(pre.executarPreAviso).toHaveBeenCalledExactlyOnceWith(6, 21, 3, "2026-09-08");
    pre.contatosReservadosNoDia.mockResolvedValue(1);
    await executarPrimeirosContatos(duranteExpediente);
    expect(pre.executarPreAviso).toHaveBeenCalledTimes(1);
  });
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
  it("recusa definitiva do chat (4xx) adia o caso para amanhã com a próxima ação e a rodada segue", async () => {
    // 16/09/2026: "Este número não tem WhatsApp." parava a rodada inteira, e ela voltava a parar
    // no mesmo caso a cada minuto — nenhum outro cliente era contatado.
    const recusa = Object.assign(new Error("O chat nao abriu a conversa: Este número não tem WhatsApp."), { codigo: "CHAT_FALHOU", status: 400 });
    ponte.enviarCasoParaCobranca.mockRejectedValueOnce(recusa);
    await executarPrimeirosContatos(duranteExpediente);
    const fakeComCaso = fake as typeof fake & { atualizarCasoDeCobranca: ReturnType<typeof vi.fn>; registrarEventoDeCobranca: ReturnType<typeof vi.fn> };
    expect(fakeComCaso.atualizarCasoDeCobranca).toHaveBeenCalledWith(6, 1,
      { proximaAcao: expect.stringContaining("telefone"), proximoContatoEm: new Date("2026-09-09T03:00:00Z") }, 3);
    expect(fakeComCaso.registrarEventoDeCobranca).toHaveBeenCalledWith(6,
      expect.objectContaining({ casoId: 1, tipo: "nota", resultado: "recusado", notas: expect.stringContaining("não tem WhatsApp") }));
    // A rodada seguiu: a retirada de equipamento, que vem depois na fila, foi contatada.
    expect(ponte.enviarRecuperacaoParaChat).toHaveBeenCalled();
  });
});
