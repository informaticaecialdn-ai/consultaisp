import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  intg: { providerId: 6, organizationId: "org-6", agenteConfig: {} as Record<string, unknown> },
  remotos: [] as { id: string; name: string }[],
  canalFalha: false,
  comTrava: true,
  modelos: { ok: true, valor: { configured: true, models: [{ id: "sakana/modelo-real" }] } },
}));
const client = vi.hoisted(() => ({
  listarModelosDePrimeiroContato: vi.fn(async () => fake.modelos),
  listarAgentes: vi.fn(async () => ({ ok: true, valor: fake.remotos })),
  obterAgente: vi.fn(async () => ({ ok: true, valor: { id: "origem", organizationId: "org-6", name: "Clara", modelId: "sakana/modelo-real", systemPrompt: "Seja cordial", temperature: 0.5, maxTokens: 2048 } })),
  criarAgente: vi.fn(async (_org: string, dados: { name: string }) => { const a = { id: `a-${fake.remotos.length}`, name: dados.name }; fake.remotos.push(a); return { ok: true, valor: a }; }),
  atualizarAgente: vi.fn(async () => ({ ok: true, valor: { id: "a-0" } })),
  listarCanais: vi.fn(async () => ({ ok: true, valor: [{ id: "ch-6" }] })),
  ligarAgenteAoCanal: vi.fn(async () => fake.canalFalha ? { ok: false, erro: "Falha no vínculo" } : { ok: true, valor: undefined }),
  prepararPrimeiroContato: vi.fn(async (_org: string, id: string) => ({ ok: true, valor: { texto: "Olá, sou o assistente virtual da NsLink. Posso falar com Maria?", agenteId: id, modelo: "sakana/modelo-real", runId: "run-1" } })),
}));
vi.mock("../../storage", () => ({ storage: {
  getIntegracaoDoChat: vi.fn(async () => fake.intg),
  getProvider: vi.fn(async () => ({ name: "NsLink", tradeName: null })),
  guardarAgenteDoChat: vi.fn(async (_p: number, d: Record<string, unknown>) => { Object.assign(fake.intg, d); return fake.intg; }),
} }));
vi.mock("./chat-trava", () => ({ comTravaDoChat: async (_k: string, fn: () => Promise<unknown>) => fake.comTrava ? fn() : null }));
vi.mock("./chat-ponte.service", () => ({
  clienteDoChat: () => client,
  garantirIntegracao: async () => fake.intg,
  ErroDaPonteDoChat: class extends Error { constructor(public codigo: string, msg: string) { super(msg); } },
}));
import { configurarAgenteDoChat, provisionarAgenteDoChat, prepararPrimeiroContatoDoAgente, listarAgentesDoChat, importarAgenteDoChat, modelosDosAgentesDoChat, promptDePrimeiroContato, promptDoAgenteDoChat, promptFinalDoAgente } from "./chat-agentes.service";

beforeEach(() => {
  fake.intg = { providerId: 6, organizationId: "org-6", agenteConfig: { primeiroContato: { ligada: false }, respostaHumanaAutomacaoId: "retorno" } };
  fake.remotos = []; fake.canalFalha = false; fake.comTrava = true;
  fake.modelos = { ok: true, valor: { configured: true, models: [{ id: "sakana/modelo-real" }] } };
  vi.clearAllMocks();
});
const configurar = () => configurarAgenteDoChat(6, "cobranca_ativos", { modelo: "sakana/modelo-real", instrucoes: "Seja breve", habilitado: true });
describe("agentes de primeiro contato", () => {
  it("importa preferências da organização sem assumir o agente original e limita orçamento", async () => {
    fake.remotos.push({ id: "origem", name: "Clara" });
    const a = await importarAgenteDoChat(6, "cobranca_ativos", "origem");
    expect(a).toMatchObject({ id: null, modelo: "sakana/modelo-real", instrucoes: "Seja cordial", temperatura: 0.5, maxTokens: 1200, etapa: "configurado", importadoDe: { id: "origem", nome: "Clara" } });
    expect(client.atualizarAgente).not.toHaveBeenCalled();
  });
  it("recusa importar agente que não aparece na organização", async () => {
    await expect(importarAgenteDoChat(6, "cobranca_ativos", "outro")).rejects.toThrow(/organização/);
    expect(client.obterAgente).not.toHaveBeenCalled();
  });
  it("alterar temperatura exige reaplicar configuração antes da execução", async () => {
    await configurar(); await provisionarAgenteDoChat(6, "cobranca_ativos");
    const a = await configurarAgenteDoChat(6, "cobranca_ativos", { modelo: "sakana/modelo-real", instrucoes: "Seja breve", habilitado: true, temperatura: 0.8, maxTokens: 900 });
    expect(a.etapa).toBe("configurado");
  });
  it("oferece três papéis e bloqueia contato sem agente pronto, sem fallback", async () => {
    expect((await listarAgentesDoChat(6)).agentes).toHaveLength(3);
    await expect(prepararPrimeiroContatoDoAgente(6, "cobranca_ativos", { nomeCliente: "Maria", nomeProvedor: "NsLink" })).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(client.prepararPrimeiroContato).not.toHaveBeenCalled();
  });
  it("não cria agente sem modelo explicitamente configurado e disponível", async () => {
    await expect(provisionarAgenteDoChat(6, "cobranca_ativos")).rejects.toThrow(/modelo/i);
    await configurarAgenteDoChat(6, "cobranca_ativos", { modelo: "openai/inexistente", instrucoes: "", habilitado: true });
    await expect(provisionarAgenteDoChat(6, "cobranca_ativos")).rejects.toThrow(/disponível/i);
    expect(client.criarAgente).not.toHaveBeenCalled();
  });
  it("retoma após falha do vínculo sem duplicar agente e preserva agenda", async () => {
    await configurar(); fake.canalFalha = true;
    await expect(provisionarAgenteDoChat(6, "cobranca_ativos")).rejects.toThrow();
    fake.canalFalha = false;
    await provisionarAgenteDoChat(6, "cobranca_ativos");
    expect(client.criarAgente).toHaveBeenCalledTimes(1);
    expect(client.criarAgente.mock.calls[0][1]).toMatchObject({ isActive: false, canRespondDirectly: false });
    expect(client.ligarAgenteAoCanal).toHaveBeenLastCalledWith("org-6", "a-0", "ch-6", "DISABLED");
    expect(fake.intg.agenteConfig.primeiroContato).toEqual({ ligada: false });
  });
  it("gera no agente do papel e valida o identificador devolvido", async () => {
    await configurar(); await provisionarAgenteDoChat(6, "cobranca_ativos");
    const d = await prepararPrimeiroContatoDoAgente(6, "cobranca_ativos", { nomeCliente: "Maria", nomeProvedor: "NsLink" });
    expect(d.runId).toBe("run-1");
    expect(client.prepararPrimeiroContato).toHaveBeenCalledWith("org-6", "a-0", { nomeCliente: "Maria", nomeProvedor: "NsLink" });
  });
  it("recusa provedor divergente e concorrência", async () => {
    await expect(configurarAgenteDoChat(7, "cobranca_ativos", { modelo: null, instrucoes: "", habilitado: false })).rejects.toThrow();
    fake.comTrava = false;
    await expect(configurar()).rejects.toMatchObject({ codigo: "CONFLITO" });
  });
  it("timeout de criação não duplica um recurso remoto ainda não confirmado", async () => {
    await configurar();
    client.criarAgente.mockResolvedValueOnce({ ok: false, erro: "timeout" } as never);
    await expect(provisionarAgenteDoChat(6, "cobranca_ativos")).rejects.toThrow(/criar/);
    await expect(provisionarAgenteDoChat(6, "cobranca_ativos")).rejects.toThrow(/anterior/);
    expect(client.criarAgente).toHaveBeenCalledTimes(1);
  });
  it("reaproveita o agente legado do provedor e aplica modo sem resposta", async () => {
    Object.assign(fake.intg, { agenteId: "legado" }); fake.remotos.push({ id: "legado", name: "Cobrança" });
    await configurar(); await provisionarAgenteDoChat(6, "cobranca_ativos");
    expect(client.criarAgente).not.toHaveBeenCalled();
    expect(client.atualizarAgente).toHaveBeenCalledWith("org-6", "legado", expect.objectContaining({ isActive: false, canRespondDirectly: false }));
  });
  it("recusa texto devolvido por outro modelo mesmo com status HTTP de sucesso", async () => {
    await configurar(); await provisionarAgenteDoChat(6, "cobranca_ativos");
    client.prepararPrimeiroContato.mockResolvedValueOnce({ ok: true, valor: { texto: "Olá, sou assistente virtual. Posso falar com Maria?", agenteId: "a-0", modelo: "modelo-diferente", runId: "run" } });
    await expect(prepararPrimeiroContatoDoAgente(6, "cobranca_ativos", { nomeCliente: "Maria", nomeProvedor: "NsLink" })).rejects.toMatchObject({ codigo: "CHAT_FALHOU" });
  });
});

describe("paridade de configuração com o AiAgent do fork", () => {
  const completo = { modelo: "sakana/modelo-real", instrucoes: "Seja breve", habilitado: true, descricao: "Assistente da NsLink", contextoOperacional: "Hoje: instabilidade no Centro até as 18h.", temperatura: 0.2, maxTokens: 400 };
  it("grava descrição e contexto operacional e os manda ao fork com os nomes do CreateAgentDto", async () => {
    const salvo = await configurarAgenteDoChat(6, "cobranca_ativos", completo);
    expect(salvo).toMatchObject({ descricao: "Assistente da NsLink", contextoOperacional: "Hoje: instabilidade no Centro até as 18h.", etapa: "configurado" });
    expect((await listarAgentesDoChat(6)).agentes[0]).toMatchObject({ descricao: "Assistente da NsLink", contextoOperacional: "Hoje: instabilidade no Centro até as 18h." });
    await provisionarAgenteDoChat(6, "cobranca_ativos");
    const dados = client.criarAgente.mock.calls[0][1] as Record<string, unknown>;
    expect(dados).toMatchObject({ description: "Assistente da NsLink", operationalContext: "Hoje: instabilidade no Centro até as 18h.", temperature: 0.2, maxTokens: 400 });
    // O contexto vai NO systemPrompt: os endpoints usados (first-contact-draft e planejador) montam a mensagem só com `agent.systemPrompt`.
    // O campo `operationalContext` continua indo junto pelo contrato do DTO, mas quem garante a entrega ao modelo é o prompt.
    expect(String(dados.systemPrompt)).toContain("AVISOS DE HOJE");
    expect(String(dados.systemPrompt)).toContain("instabilidade no Centro");
    expect(client.atualizarAgente).toHaveBeenCalledWith("org-6", "a-0", expect.objectContaining({ description: "Assistente da NsLink", operationalContext: "Hoje: instabilidade no Centro até as 18h.", systemPrompt: expect.stringContaining("instabilidade no Centro") }));
  });
  it("sem contexto operacional nenhum bloco de avisos entra no prompt enviado ao fork", async () => {
    await configurarAgenteDoChat(6, "cobranca_ativos", { ...completo, contextoOperacional: "   " });
    await provisionarAgenteDoChat(6, "cobranca_ativos");
    const dados = client.criarAgente.mock.calls[0][1] as Record<string, unknown>;
    expect(dados).toMatchObject({ operationalContext: "" });
    expect(String(dados.systemPrompt)).not.toContain("AVISOS DE HOJE");
    expect(String(dados.systemPrompt)).toBe(promptDePrimeiroContato("cobranca_ativos", "NsLink", "Seja breve"));
  });
  it("mudar só a descrição ou o contexto do dia volta o agente para configurado — precisa reaplicar", async () => {
    await configurarAgenteDoChat(6, "cobranca_ativos", completo); await provisionarAgenteDoChat(6, "cobranca_ativos");
    expect((await configurarAgenteDoChat(6, "cobranca_ativos", { ...completo, contextoOperacional: "Hoje sem visita técnica." })).etapa).toBe("configurado");
    await provisionarAgenteDoChat(6, "cobranca_ativos");
    expect((await configurarAgenteDoChat(6, "cobranca_ativos", { ...completo, contextoOperacional: "Hoje sem visita técnica." })).etapa).toBe("pronto");
    expect((await configurarAgenteDoChat(6, "cobranca_ativos", { ...completo, contextoOperacional: "Hoje sem visita técnica.", descricao: "Outra" })).etapa).toBe("configurado");
  });
  it("o prompt final subordina as preferências às regras e traz o contexto operacional no bloco do fork", () => {
    const p = promptFinalDoAgente("cobranca_ativos", "NsLink", { instrucoes: "Trate por você", contextoOperacional: "Hoje: sem promessa de visita." });
    const regras = p.prompt.indexOf("Não invente valores");
    expect(regras).toBeGreaterThan(-1);
    expect(p.prompt.indexOf("Trate por você")).toBeGreaterThan(regras);
    expect(p.prompt.indexOf("AVISOS DE HOJE (informados pelo provedor")).toBeGreaterThan(p.prompt.indexOf("Trate por você"));
    expect(p.prompt.endsWith("Hoje: sem promessa de visita.")).toBe(true);
    expect(p).toMatchObject({ tipo: "cobranca_ativos", nomeProvedor: "NsLink", contextoOperacional: "Hoje: sem promessa de visita.", caracteres: p.prompt.length });
    const semContexto = promptFinalDoAgente("cobranca_ativos", "NsLink", { instrucoes: "", contextoOperacional: "  " });
    expect(semContexto.prompt).toBe(promptDePrimeiroContato("cobranca_ativos", "NsLink", ""));
    expect(semContexto.prompt).not.toContain("AVISOS DE HOJE");
    expect(semContexto.prompt).toContain("Seja cordial e objetivo.");
  });
  it("promptDoAgenteDoChat lê a configuração salva do provedor e recusa integração de outro", async () => {
    await configurarAgenteDoChat(6, "cobranca_ex_clientes", completo);
    const p = await promptDoAgenteDoChat(6, "cobranca_ex_clientes");
    expect(p.prompt).toContain("Papel: Cobrança · ex-clientes");
    expect(p.prompt).toContain("Hoje: instabilidade no Centro até as 18h.");
    expect(p.nomeProvedor).toBe("NsLink");
    await expect(promptDoAgenteDoChat(7, "cobranca_ativos")).rejects.toMatchObject({ codigo: "CONFLITO" });
  });
  it("importar traz description e operationalContext do agente de origem", async () => {
    fake.remotos.push({ id: "origem", name: "Clara" });
    client.obterAgente.mockResolvedValueOnce({ ok: true, valor: { id: "origem", organizationId: "org-6", name: "Clara", modelId: "sakana/modelo-real", systemPrompt: "Seja cordial", temperature: 0.5, maxTokens: 2048, description: " Vendas ", operationalContext: null } } as never);
    expect(await importarAgenteDoChat(6, "cobranca_ativos", "origem")).toMatchObject({ descricao: "Vendas", contextoOperacional: "" });
  });
});
describe("catálogo de modelos oferecido ao provedor", () => {
  it("junta a lista ao vivo do Chat BullQ com os OpenAI da VPS, cada um com origem", async () => {
    const c = await modelosDosAgentesDoChat(6);
    expect(c.configured).toBe(true);
    expect(c.models).toEqual([{ id: "sakana/modelo-real", origem: "chat_bullq" }, { id: "openai/gpt-4o-mini", origem: "openai_vps" }, { id: "openai/gpt-4o", origem: "openai_vps" }]);
    expect(c.origens?.openai_vps).toMatch(/VPS/);
  });
  it("Chat BullQ sem credencial de IA: `configured` continua falso e nada é provisionado", async () => {
    fake.modelos = { ok: true, valor: { configured: false, models: [] } };
    const c = await modelosDosAgentesDoChat(6);
    // Os ids da VPS aparecem marcados, mas não fabricam credencial: quem responde por ela é o serviço.
    expect(c).toMatchObject({ configured: false });
    expect(c.models.map(m => m.id)).toEqual(["openai/gpt-4o-mini", "openai/gpt-4o"]);
    await configurarAgenteDoChat(6, "cobranca_ativos", { modelo: "openai/gpt-4o-mini", instrucoes: "", habilitado: true });
    await expect(provisionarAgenteDoChat(6, "cobranca_ativos")).rejects.toThrow(/credencial de IA/i);
    expect(client.criarAgente).not.toHaveBeenCalled();
  });
  it("com credencial, provisiona em modelo OpenAI que só o catálogo local conhece", async () => {
    fake.modelos = { ok: true, valor: { configured: true, models: [{ id: "sakana/fugu" }] } };
    await configurarAgenteDoChat(6, "cobranca_ativos", { modelo: "openai/gpt-4o-mini", instrucoes: "", habilitado: true });
    await provisionarAgenteDoChat(6, "cobranca_ativos");
    expect(client.criarAgente.mock.calls[0][1]).toMatchObject({ modelId: "openai/gpt-4o-mini" });
  });
  it("continua recusando modelo que nenhuma fonte confirma", async () => {
    await configurarAgenteDoChat(6, "cobranca_ativos", { modelo: "openai/gpt-5-inventado", instrucoes: "", habilitado: true });
    await expect(provisionarAgenteDoChat(6, "cobranca_ativos")).rejects.toThrow(/disponível/i);
    expect(client.criarAgente).not.toHaveBeenCalled();
  });
});
