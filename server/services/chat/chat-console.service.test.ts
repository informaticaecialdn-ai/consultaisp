import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  intg: null as null | { providerId: number; organizationId: string; agenteConfig: Record<string, unknown> },
  agentes: [] as Record<string, unknown>[],
  tools: [] as Record<string, unknown>[],
  skills: [] as Record<string, unknown>[],
}));

const client = vi.hoisted(() => ({
  listarAgentes: vi.fn(async () => ({ ok: true, valor: fake.agentes })),
  obterAgente: vi.fn(async (_o: string, id: string) => ({ ok: true, valor: fake.agentes.find(a => a.id === id) })),
  criarAgente: vi.fn(async (_o: string, dados: Record<string, unknown>) => {
    const a = { id: `ag-${fake.agentes.length + 1}`, ...dados };
    fake.agentes.push(a);
    return { ok: true, valor: a };
  }),
  atualizarAgente: vi.fn(async () => ({ ok: true, valor: { id: "ag-1" } })),
  apagarAgente: vi.fn(async () => ({ ok: true, valor: undefined })),
  listarTools: vi.fn(async () => ({ ok: true, valor: fake.tools })),
  criarTool: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ ok: true, valor: { id: "tool-nova", name: d.nome, description: d.descricao, source: "CUSTOM_HTTP", httpBaseUrl: d.httpBaseUrl, httpHeaders: d.httpHeaders, isActive: true } })),
  atualizarTool: vi.fn(async () => ({ ok: true, valor: { id: "tool-1" } })),
  apagarTool: vi.fn(async () => ({ ok: true, valor: undefined })),
  listarSkills: vi.fn(async () => ({ ok: true, valor: fake.skills })),
  criarSkill: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ ok: true, valor: { id: "skill-nova", name: d.nome, description: d.descricao, source: "HTTP", toolId: d.toolId, parameters: d.parameters, httpMethod: d.httpMethod, httpPath: d.httpPath } })),
  atualizarSkill: vi.fn(async () => ({ ok: true, valor: { id: "skill-1" } })),
  apagarSkill: vi.fn(async () => ({ ok: true, valor: undefined })),
  ligarSkillsAoAgente: vi.fn(async () => ({ ok: true, valor: undefined })),
  listarCanais: vi.fn(async () => ({ ok: true, valor: [{ id: "canal-1" }] })),
  ligarAgenteAoCanal: vi.fn(async () => ({ ok: true, valor: undefined })),
  estatisticasDaOrganizacao: vi.fn(async () => ({ ok: true, valor: { period: "7d", runs: { total: 2, completed: 2 }, tokens: { total: 10 }, cost: { usd: 0.1 }, byAgent: [{ agentId: "ag-1", runs: 2 }] } })),
  listarExecucoes: vi.fn(async () => ({ ok: true, valor: [] as unknown[] })),
}));

vi.mock("../../storage", () => ({ storage: { getIntegracaoDoChat: vi.fn(async () => fake.intg) } }));
vi.mock("./chat-agentes.service", () => ({ comTravaDaConfiguracaoDoChat: async (_p: number, fn: () => Promise<unknown>) => fn() }));
vi.mock("./chat-ponte.service", () => ({
  clienteDoChat: () => client,
  urlDaApiDoAgente: () => "https://consultaisp.com.br/api/chat-bullq/agente",
  ErroDaPonteDoChat: class extends Error { constructor(public codigo: string, msg: string) { super(msg); } },
}));

import {
  apagarAgenteDoConsole, apagarSkillDoConsole, apagarToolDoConsole, atualizarAgenteDoConsole,
  criarAgenteDoConsole, criarSkillDoConsole, criarToolDoConsole, definirSkillsDoAgenteDoConsole,
  hostsPermitidosDasTools, listarAgentesDoConsole, listarToolsDoConsole, ligarAgenteAoCanalDoConsole,
  resumoDoConsole,
} from "./chat-console.service";

const AGENTE_VALIDO = {
  nome: "Cobrança noturna", tipo: "WORKER" as const, modelo: "openai/gpt-4o-mini",
  instrucoes: "Você atende clientes fora do horário comercial e não cita valores.",
};

beforeEach(() => {
  fake.intg = { providerId: 7, organizationId: "org-7", agenteConfig: {} };
  fake.agentes = [];
  fake.tools = [];
  fake.skills = [];
  delete process.env.CHAT_BULLQ_TOOLS_HOSTS;
  vi.clearAllMocks();
});

describe("console de agentes · organização", () => {
  it("não provisiona nada: sem integração, manda ligar o chat no painel", async () => {
    fake.intg = null;
    await expect(listarAgentesDoConsole(7)).rejects.toMatchObject({ codigo: "SEM_CANAL" });
    expect(client.listarAgentes).not.toHaveBeenCalled();
  });

  it("recusa integração de outro provedor em vez de usar a organização dela", async () => {
    fake.intg = { providerId: 99, organizationId: "org-99", agenteConfig: {} };
    await expect(listarAgentesDoConsole(7)).rejects.toMatchObject({ codigo: "CONFLITO" });
  });

  it("resolve a organização pelo provedor da sessão — nunca por parâmetro", async () => {
    await listarAgentesDoConsole(7);
    expect(client.listarAgentes).toHaveBeenCalledWith("org-7");
  });
});

describe("console de agentes · criar e editar", () => {
  it("agente novo nasce parado e sem responder direto, mesmo pedindo ativo", async () => {
    await criarAgenteDoConsole(7, { ...AGENTE_VALIDO, ativo: true } as never);
    const corpo = client.criarAgente.mock.calls[0][1] as Record<string, unknown>;
    expect(corpo.isActive).toBe(false);
    expect(corpo.canRespondDirectly).toBe(false);
    expect(corpo.name).toBe("Cobrança noturna");
    expect(corpo.systemPrompt).toContain("horário comercial");
  });

  it("chefia tem que existir na mesma organização", async () => {
    await expect(criarAgenteDoConsole(7, { ...AGENTE_VALIDO, reportaA: "de-outra-org" })).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(client.criarAgente).not.toHaveBeenCalled();
  });

  it("um agente não reporta a si mesmo", async () => {
    fake.agentes.push({ id: "ag-1", name: "Chefe", modelId: "openai/gpt-4o-mini", systemPrompt: "x" });
    await expect(atualizarAgenteDoConsole(7, "ag-1", { reportaA: "ag-1" })).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(client.atualizarAgente).not.toHaveBeenCalled();
  });

  it("os perfis da cobrança não se editam nem se apagam pelo console", async () => {
    fake.intg!.agenteConfig = { agentes: { cobranca_ativos: { id: "ag-ponte" } } };
    fake.agentes.push({ id: "ag-ponte", name: "Cobrança · clientes ativos", modelId: "openai/gpt-4o-mini", systemPrompt: "x" });
    await expect(atualizarAgenteDoConsole(7, "ag-ponte", { nome: "Outro" })).rejects.toThrow(/Painel do Provedor/);
    await expect(apagarAgenteDoConsole(7, "ag-ponte")).rejects.toThrow(/não se apaga/);
    await expect(definirSkillsDoAgenteDoConsole(7, "ag-ponte", [])).rejects.toThrow(/prompt/);
    expect(client.apagarAgente).not.toHaveBeenCalled();
    expect(client.ligarSkillsAoAgente).not.toHaveBeenCalled();
  });

  it("marca daPonte só nos ids gravados na integração", async () => {
    fake.intg!.agenteConfig = { agentes: { cobranca_ativos: { id: "ag-ponte" } } };
    fake.agentes.push(
      { id: "ag-ponte", name: "Cobrança", modelId: "m", systemPrompt: "x" },
      { id: "ag-livre", name: "Suporte", modelId: "m", systemPrompt: "x" },
    );
    const { agentes } = await listarAgentesDoConsole(7);
    expect(agentes.find(a => a.id === "ag-ponte")!.daPonte).toBe(true);
    expect(agentes.find(a => a.id === "ag-livre")!.daPonte).toBe(false);
  });

  it("canal precisa ser do próprio provedor", async () => {
    await expect(ligarAgenteAoCanalDoConsole(7, "ag-1", "canal-de-outro", "COPILOT")).rejects.toMatchObject({ codigo: "CONFLITO" });
    expect(client.ligarAgenteAoCanal).not.toHaveBeenCalled();
  });
});

describe("console de agentes · conexões (tools)", () => {
  it("host fora da lista é recusado antes de qualquer ida à VPS", async () => {
    await expect(criarToolDoConsole(7, {
      nome: "Meu servidor", descricao: "Endpoint próprio", baseUrl: "https://servidor-do-atacante.example",
    })).rejects.toThrow(/não liberado/);
    expect(client.criarTool).not.toHaveBeenCalled();
  });

  it("a base da própria API do agente entra na lista sem configuração nenhuma", async () => {
    expect(hostsPermitidosDasTools()).toContain("consultaisp.com.br");
    const tool = await criarToolDoConsole(7, {
      nome: "API do Consulta ISP", descricao: "Skills do caso", baseUrl: "https://consultaisp.com.br/api/x",
      headers: { "x-chave": "segredo" },
    });
    expect(client.criarTool).toHaveBeenCalled();
    // A credencial não volta: só o NOME do header.
    expect(tool.headers).toEqual(["x-chave"]);
    expect(JSON.stringify(tool)).not.toContain("segredo");
  });

  it("http, endereço privado e credencial embutida na URL são recusados", async () => {
    const recusas = ["http://consultaisp.com.br/x", "https://127.0.0.1/x", "https://user:senha@consultaisp.com.br/x"];
    for (const url of recusas) {
      await expect(criarToolDoConsole(7, { nome: "n", descricao: "descricao", baseUrl: url })).rejects.toBeInstanceOf(Error);
    }
    expect(client.criarTool).not.toHaveBeenCalled();
  });

  it("o superadmin libera host por ambiente", async () => {
    process.env.CHAT_BULLQ_TOOLS_HOSTS = "erp-do-provedor.com.br";
    await criarToolDoConsole(7, { nome: "ERP", descricao: "API do ERP", baseUrl: "https://api.erp-do-provedor.com.br/v1" });
    expect(client.criarTool).toHaveBeenCalled();
  });

  it("a conexão da cobrança não se edita nem se apaga; conexão em uso também não", async () => {
    fake.tools = [
      { id: "tool-ponte", name: "Consulta ISP", description: "d", httpBaseUrl: "https://consultaisp.com.br/api/chat-bullq/agente", _count: { skills: 3 } },
      { id: "tool-livre", name: "ERP", description: "d", httpBaseUrl: "https://consultaisp.com.br/outro", _count: { skills: 2 } },
    ];
    await expect(apagarToolDoConsole(7, "tool-ponte")).rejects.toThrow(/cobrança/);
    await expect(apagarToolDoConsole(7, "tool-livre")).rejects.toThrow(/2 skill/);
    expect(client.apagarTool).not.toHaveBeenCalled();
  });
});

describe("console de agentes · skills", () => {
  beforeEach(() => {
    fake.tools = [{ id: "tool-1", name: "API", description: "d", httpBaseUrl: "https://consultaisp.com.br/api", isActive: true, _count: { skills: 0 } }];
  });

  const SKILL = {
    nome: "consultarSaldo", descricao: "Consulta o saldo em aberto do cliente pelo telefone.",
    toolId: "tool-1", parametros: { type: "object" }, metodo: "POST" as const, caminho: "/saldo",
  };

  it("a conexão tem que ser do provedor e estar ativa", async () => {
    await expect(criarSkillDoConsole(7, { ...SKILL, toolId: "tool-de-outro" } as never)).rejects.toMatchObject({ codigo: "CASO_NAO_ENCONTRADO" });
    fake.tools[0].isActive = false;
    await expect(criarSkillDoConsole(7, SKILL as never)).rejects.toThrow(/desativada/);
    expect(client.criarSkill).not.toHaveBeenCalled();
  });

  it("recusa criar skill com o nome de uma da cobrança", async () => {
    await expect(criarSkillDoConsole(7, { ...SKILL, nome: "consultarCaso" } as never)).rejects.toThrow(/cobrança/);
    expect(client.criarSkill).not.toHaveBeenCalled();
  });

  it("as skills da cobrança não se apagam: o prompt as chama pelo nome", async () => {
    fake.skills = [{ id: "s-1", name: "registrarPromessa", description: "d", source: "HTTP", toolId: "tool-1" }];
    await expect(apagarSkillDoConsole(7, "s-1")).rejects.toThrow(/registrarPromessa/);
    expect(client.apagarSkill).not.toHaveBeenCalled();
  });

  it("só liga ao agente skills que existem no provedor", async () => {
    fake.skills = [{ id: "s-1", name: "minhaSkill", description: "d", source: "HTTP", toolId: "tool-1" }];
    await expect(definirSkillsDoAgenteDoConsole(7, "ag-1", ["s-1", "s-de-outro"])).rejects.toThrow(/não pertence/);
    await definirSkillsDoAgenteDoConsole(7, "ag-1", ["s-1"]);
    expect(client.ligarSkillsAoAgente).toHaveBeenCalledWith("org-7", "ag-1", ["s-1"]);
  });
});

describe("console de agentes · resumo", () => {
  it("troca o id do agente pelo nome que o console já conhece", async () => {
    fake.agentes.push({ id: "ag-1", name: "Cobrança noturna", modelId: "m", systemPrompt: "x" });
    const r = await resumoDoConsole(7, "7d");
    expect(r.porAgente[0]).toMatchObject({ agenteId: "ag-1", nome: "Cobrança noturna", execucoes: 2 });
    expect(r.execucoes.total).toBe(2);
  });

  it("agente já removido não vira linha sem nome", async () => {
    const r = await resumoDoConsole(7, "7d");
    expect(r.porAgente[0].nome).toBe("agente removido");
  });
});
