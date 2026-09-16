import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  getIntegracaoDoChat: vi.fn(), getPoliticaDeCobranca: vi.fn(), listarCandidatosDoChat: vi.fn(), estadoDoProcessoChat: vi.fn(),
  contatosIniciadosNoDia: vi.fn(), contatosReservadosNoDia: vi.fn(), getUsersByProvider: vi.fn(), config: vi.fn(),
  enviarCasoParaCobranca: vi.fn(), enviarRecuperacaoParaChat: vi.fn(), executarPreAviso: vi.fn(),
}));
vi.mock("../../storage", () => ({ storage: fake }));
vi.mock("../../storage/chat-autonomia.storage", () => ({ autonomiaStorage: { config: fake.config } }));
vi.mock("../../storage/cobranca-preventivo.storage", () => ({ CobrancaPreventivoStorage: class { contatosReservadosNoDia = fake.contatosReservadosNoDia; } }));
vi.mock("./chat-elegibilidade.service", () => ({ listarCandidatosDoChat: fake.listarCandidatosDoChat }));
vi.mock("./chat-worker-presenca", () => ({ estadoDoProcessoChat: fake.estadoDoProcessoChat }));
vi.mock("./chat-ponte.service", () => fake);
vi.mock("./chat-preventivo.service", () => fake);
import { consultarOperacaoChat } from "./chat-operacao.service";
const agora = new Date("2026-09-14T14:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 7, canalId: "canal", status: "ativo", agenteConfig: { autonomia: { ativa: false }, primeiroContatoUserId: 8, primeiroContato: { ligada: true, limiteDiario: 5 } } });
  fake.getPoliticaDeCobranca.mockResolvedValue(null);
  fake.listarCandidatosDoChat.mockResolvedValue({ cobranca: [
    { id: 1, carteira: "ativo", diasAtraso: 10, telefoneValido: true },
    { id: 2, carteira: "ativo", diasAtraso: 10, tom: "humanizado_vulneravel" },
    { id: 3, carteira: "ex_cliente", diasAtraso: 20, telefoneValido: true },
  ], equipamentos: [], limitado: false });
  fake.estadoDoProcessoChat.mockResolvedValue({ online: true, modo: "envio", verificadoEm: agora.toISOString() });
  fake.contatosIniciadosNoDia.mockResolvedValue(1);
  fake.contatosReservadosNoDia.mockResolvedValue(2);
  fake.getUsersByProvider.mockResolvedValue([{ id: 8, role: "admin" }]);
  fake.config.mockResolvedValue({ ativa: true });
});

describe("diagnóstico da operação sem envio", () => {
  it("exige perfil habilitado, provisionado e com modelo somente nas carteiras habilitadas", async () => {
    fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 7, canalId: "canal", status: "ativo", agenteConfig: {
      primeiroContatoUserId: 8, primeiroContato: { ligada: true, carteiras: ["ativo"] },
      agentes: { cobranca_ativos: { id: "ag1", modelo: "openai/gpt-4o-mini", etapa: "configurado" } },
    } });
    const r = await consultarOperacaoChat(7, agora);
    expect(r.bloqueios).toContain("Configure e provisione o agente “Cobrança · clientes ativos” antes de iniciar contatos");
    expect(r.bloqueios.join(" ")).not.toMatch(/ex-clientes|Recuperação de equipamentos/);
    for (const incompleto of [{ habilitado: false }, { id: null }, { modelo: null }, { etapa: "erro" }]) {
      fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 7, canalId: "canal", status: "ativo", agenteConfig: {
        primeiroContatoUserId: 8, primeiroContato: { ligada: true, carteiras: ["ativo"] },
        agentes: { cobranca_ativos: { id: "ag1", modelo: "openai/gpt-4o-mini", etapa: "pronto", ...incompleto } },
      } });
      expect((await consultarOperacaoChat(7, agora)).bloqueios.some(b => b.includes("Configure e provisione"))).toBe(true);
    }
  });
  it("perfil local pronto remove seu bloqueio sem confirmar credencial do modelo", async () => {
    fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 7, canalId: "canal", status: "ativo", agenteConfig: {
      primeiroContatoUserId: 8, primeiroContato: { ligada: true, carteiras: ["ativo"] },
      agentes: { cobranca_ativos: { id: "ag1", modelo: "openai/gpt-4o-mini", etapa: "pronto", habilitado: true } },
    } });
    expect((await consultarOperacaoChat(7, agora)).bloqueios.some(b => b.includes("agente"))).toBe(false);
  });
  it("Datafy exige template válido para cada operação sem exigir agente de abertura", async () => {
    fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 7, canalId: "canal", status: "ativo", agenteConfig: {
      primeiroContatoUserId: 8, whatsapp: { provider: "DATAFY" },
      primeiroContato: { ligada: true, carteiras: ["ex_cliente"], equipamentos: true },
      templatesDatafy: { cobranca_ex_clientes: { nome: "abertura", idioma: "pt_BR", variaveis: ["nomeCliente"] } },
    } });
    const r = await consultarOperacaoChat(7, agora);
    expect(r.bloqueios).toContain("Configure o template Datafy de “Recuperação de equipamentos” no Painel do Provedor");
    expect(r.bloqueios.join(" ")).not.toMatch(/provisione|clientes ativos|Cobrança · ex-clientes/);
  });
  it("preventivo Datafy precisa do template ativo; preventivo não oficial usa abertura controlada", async () => {
    const config = { primeiroContatoUserId: 8, primeiroContato: { ligada: true, cobranca: false, preventivo: true, carteiras: ["ativo"] } };
    fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 7, canalId: "canal", status: "ativo", agenteConfig: config });
    expect((await consultarOperacaoChat(7, agora)).bloqueios.join(" ")).not.toMatch(/provisione|template/);
    fake.getIntegracaoDoChat.mockResolvedValue({ providerId: 7, canalId: "canal", status: "ativo", agenteConfig: { ...config, whatsapp: { provider: "DATAFY" }, templatesDatafy: { cobranca_ativos: { nome: "nome inválido", idioma: "pt_BR", variaveis: [] } } } });
    expect((await consultarOperacaoChat(7, agora)).bloqueios).toContain("Configure o template Datafy de “Cobrança · clientes ativos” no Painel do Provedor");
  });
  it("lê a autonomia da tabela real, independente de agenteConfig.autonomia", async () => {
    const r = await consultarOperacaoChat(7, agora);
    expect(r.respostaAutonoma).toBe(true);
    expect(fake.config).toHaveBeenCalledWith(7);
    fake.config.mockResolvedValue({ ativa: false });
    expect((await consultarOperacaoChat(7, agora)).respostaAutonoma).toBe(false);
  });
  it("conta candidatos e reservas do mesmo provedor, preservando os motivos de revisão", async () => {
    const r = await consultarOperacaoChat(7, agora);
    expect(r.usadosHoje).toBe(3);
    expect(r.carteiras).toEqual([{ carteira: "ativo", pendentes: 2, elegiveis: 1, revisao: 1 }, { carteira: "ex_cliente", pendentes: 1, elegiveis: 1, revisao: 0 }]);
    expect(r.motivos).toEqual([{ motivo: "Atendimento humano por vulnerabilidade", quantidade: 1 }]);
    expect(fake.contatosReservadosNoDia).toHaveBeenCalledWith(7, "2026-09-14");
    expect(fake.contatosIniciadosNoDia).toHaveBeenCalledWith(7, new Date("2026-09-14T03:00:00Z"));
    expect(fake.enviarCasoParaCobranca).not.toHaveBeenCalled();
    expect(fake.enviarRecuperacaoParaChat).not.toHaveBeenCalled();
    expect(fake.executarPreAviso).not.toHaveBeenCalled();
  });
  it("explica ausência de configuração, pausa, janela, teto e autor", async () => {
    fake.getIntegracaoDoChat.mockResolvedValue(null);
    fake.getPoliticaDeCobranca.mockResolvedValue({ pausada: true });
    fake.getUsersByProvider.mockResolvedValue([]);
    fake.estadoDoProcessoChat.mockResolvedValue({ online: false, modo: null, verificadoEm: null });
    fake.contatosIniciadosNoDia.mockResolvedValue(10);
    const r = await consultarOperacaoChat(7, new Date("2026-09-13T01:00:00Z"));
    for (const texto of ["sem atividade", "desligado", "WhatsApp", "pausada", "Fora do horário", "Limite diário", "administrador"]) expect(r.bloqueios.some(b => b.includes(texto))).toBe(true);
  });
  it("ensaio é declarado sem converter elegíveis em mensagens enviadas", async () => {
    fake.estadoDoProcessoChat.mockResolvedValue({ online: true, modo: "ensaio", verificadoEm: agora.toISOString() });
    const r = await consultarOperacaoChat(7, agora);
    expect(r.bloqueios).toContain("Motor em ensaio: nenhum contato será enviado por este processo");
    expect(r.usadosHoje).toBe(3);
    expect(r.etapas.reduce((n, e) => n + e.quantidade, 0)).toBe(2);
  });
});
