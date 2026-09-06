import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O snapshot ao vivo sob contrato: escolhe a integração que serve, mapeia o
 * que o ERP devolve sem inventar nada, e guarda em cache — sucesso por dez
 * minutos, falha por um. Nunca lança.
 */

vi.mock("../../db", () => ({ pool: {}, db: {} }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }));
vi.mock("../../logger", () => ({ logger: log }));

const fake = vi.hoisted(() => ({
  integracoes: [] as any[],
  conectores: new Map<string, any>(),
  falhaAoLer: false,
}));
vi.mock("../../storage", () => ({
  storage: {
    getErpIntegrations: vi.fn(async (_providerId: number) => {
      if (fake.falhaAoLer) throw new Error("banco fora");
      return fake.integracoes;
    }),
  },
}));
vi.mock("../../erp", () => ({
  getConnector: (source: string) => fake.conectores.get(source),
  buildConnectorConfig: (i: any) => ({ apiUrl: i.apiUrl, apiToken: i.apiToken, extra: { sgpApp: "x" } }),
}));

import {
  _limparCacheDoSnapshotParaTestes, snapshotAoVivoDoCliente, TIMEOUT_SNAPSHOT_MS, TTL_SNAPSHOT_FALHA_MS, TTL_SNAPSHOT_OK_MS,
} from "./snapshot-ao-vivo.service";

const DOC = "123.456.789-09";
const integracao = (erpSource: string, extra: Partial<any> = {}) => ({
  providerId: 7, erpSource, apiUrl: "https://erp.exemplo.com/", apiToken: "t", apiUser: "u", isEnabled: true, ...extra,
});

function conectorQueDevolve(customers: any[], ok = true) {
  const fetchCustomerByCpf = vi.fn(async () => ({ ok, message: ok ? "ok" : "credencial recusada", customers }));
  return { name: "sgp", fetchCustomerByCpf };
}

beforeEach(() => {
  _limparCacheDoSnapshotParaTestes();
  fake.integracoes = [];
  fake.conectores.clear();
  fake.falhaAoLer = false;
  vi.useRealTimers();
});

describe("snapshotAoVivoDoCliente", () => {
  it("expõe autenticação técnica sem senha e não confunde contrato ativo com sessão online", async () => {
    fake.integracoes = [integracao("sgp")];
    fake.conectores.set("sgp", conectorQueDevolve([{ cpfCnpj: DOC, name: "Maria", contractStatus: "active", autenticacoes: [{ login: "assinante", mac: "AABBCCDDEEFF", ip: "100.64.0.2", contrato: "1", serial: null, online: null, fonte: "sgp", senha: "segredo-que-nao-pode-sair" }] }]));
    const s = await snapshotAoVivoDoCliente(7, DOC);
    expect(s.cliente?.autenticacoes).toEqual([{ login: "assinante", mac: "AABBCCDDEEFF", ip: "100.64.0.2", contrato: "1", serial: null, online: null, fonte: "sgp" }]);
    expect(JSON.stringify(s)).not.toContain("segredo-que-nao-pode-sair");
  });
  it("sem integração ligada, diz isso e não lança", async () => {
    const s = await snapshotAoVivoDoCliente(7, DOC);
    expect(s.ok).toBe(false);
    expect(s.erpSource).toBeNull();
    expect(s.erro).toMatch(/Sem integração/);
    expect(s.cliente).toBeNull();
  });

  it("documento incompleto na base não vai ao ERP", async () => {
    fake.integracoes = [integracao("sgp")];
    fake.conectores.set("sgp", conectorQueDevolve([]));
    const s = await snapshotAoVivoDoCliente(7, "123");
    expect(s.ok).toBe(false);
    expect(s.erro).toMatch(/incompleto/);
    expect(fake.conectores.get("sgp").fetchCustomerByCpf).not.toHaveBeenCalled();
  });

  it("ignora conector casca (naoImplementado) e o que não busca por CPF; usa o que serve", async () => {
    fake.integracoes = [integracao("topsapp"), integracao("mk"), integracao("sgp")];
    fake.conectores.set("topsapp", { name: "topsapp", naoImplementado: true, fetchCustomerByCpf: vi.fn() });
    fake.conectores.set("mk", { name: "mk" }); // sem fetchCustomerByCpf
    fake.conectores.set("sgp", conectorQueDevolve([{ cpfCnpj: "12345678909", name: "Maria", contractPlan: "Fibra 300", contractStatus: "active" }]));
    const s = await snapshotAoVivoDoCliente(7, DOC);
    expect(s.ok).toBe(true);
    expect(s.erpSource).toBe("sgp");
    expect(fake.conectores.get("topsapp").fetchCustomerByCpf).not.toHaveBeenCalled();
  });

  it("integração ligada cujo conector não busca por documento explica o motivo", async () => {
    fake.integracoes = [integracao("mk")];
    fake.conectores.set("mk", { name: "mk" });
    const s = await snapshotAoVivoDoCliente(7, DOC);
    expect(s.ok).toBe(false);
    expect(s.erro).toMatch(/não busca cliente por documento/);
  });

  it("mapeia o que o ERP devolve — plano, contrato, corte, aparelhos com MAC e série — sem inventar o que falta", async () => {
    fake.integracoes = [integracao("sgp")];
    const conector = conectorQueDevolve([{
      cpfCnpj: "123.456.789-09", name: " Maria da Silva ", contractPlan: "Fibra 300", contractStatus: "suspended",
      motivoCorte: "Financeiro", cortadoEm: "2026-08-01", contractStartDate: "2023-05-10",
      totalOverdueAmount: "189.9", maxDaysOverdue: 47, overdueInvoicesCount: 2, phone: "43999990000",
      equipmentDetails: [
        { type: "ONU", brand: "Huawei", model: "HG8145V5", serialNumber: "HWTC1234", mac: "A1B2C3D4E5F6", value: "290", inRecoveryProcess: false },
        { type: "Roteador", brand: "", model: "", serialNumber: "", mac: "", value: "", inRecoveryProcess: true },
      ],
    }]);
    fake.conectores.set("sgp", conector);
    const s = await snapshotAoVivoDoCliente(7, DOC);
    expect(s.ok).toBe(true);
    expect(s.encontrado).toBe(true);
    expect(s.cliente).toMatchObject({
      nome: "Maria da Silva", plano: "Fibra 300", statusContrato: "suspended", motivoCorte: "Financeiro", cortadoEm: "2026-08-01",
      contractStartDate: "2023-05-10", dividaAtual: 189.9, diasAtraso: 47, faturasAbertas: 2, telefone: "43999990000", email: null,
    });
    expect(s.cliente!.equipamentos).toEqual([
      { tipo: "ONU", marca: "Huawei", modelo: "HG8145V5", serie: "HWTC1234", mac: "A1B2C3D4E5F6", valor: 290, emRecuperacao: false },
      { tipo: "Roteador", marca: null, modelo: null, serie: null, mac: null, valor: null, emRecuperacao: true },
    ]);
    // A config vai com o provedor no extra, como a consulta ao vivo faz.
    const [config, doc] = conector.fetchCustomerByCpf.mock.calls[0];
    expect(config.extra.providerId).toBe("7");
    expect(config.extra.sgpApp).toBe("x");
    expect(doc).toBe("12345678909");
  });

  it("ERP respondeu mas o documento não está lá: ok, encontrado=false, cliente nulo", async () => {
    fake.integracoes = [integracao("sgp")];
    fake.conectores.set("sgp", conectorQueDevolve([{ cpfCnpj: "99999999999", name: "Outra" }]));
    const s = await snapshotAoVivoDoCliente(7, DOC);
    expect(s.ok).toBe(true);
    expect(s.encontrado).toBe(false);
    expect(s.cliente).toBeNull();
  });

  it("ERP recusou: ok=false com a mensagem do conector", async () => {
    fake.integracoes = [integracao("sgp")];
    fake.conectores.set("sgp", conectorQueDevolve([], false));
    const s = await snapshotAoVivoDoCliente(7, DOC);
    expect(s.ok).toBe(false);
    expect(s.erro).toBe("credencial recusada");
    expect(s.erpSource).toBe("sgp");
  });

  it("conector que lança vira ok=false, sem propagar", async () => {
    fake.integracoes = [integracao("sgp")];
    fake.conectores.set("sgp", { name: "sgp", fetchCustomerByCpf: vi.fn(async () => { throw new Error("ECONNREFUSED"); }) });
    const s = await snapshotAoVivoDoCliente(7, DOC);
    expect(s.ok).toBe(false);
    expect(s.erro).toBe("ECONNREFUSED");
    expect(log.warn).toHaveBeenCalled();
  });

  it("estoura o tempo em TIMEOUT_SNAPSHOT_MS com mensagem em português", async () => {
    vi.useFakeTimers();
    fake.integracoes = [integracao("sgp")];
    fake.conectores.set("sgp", { name: "sgp", fetchCustomerByCpf: vi.fn(() => new Promise(() => {})) });
    const pendente = snapshotAoVivoDoCliente(7, DOC);
    await vi.advanceTimersByTimeAsync(TIMEOUT_SNAPSHOT_MS + 1);
    const s = await pendente;
    expect(s.ok).toBe(false);
    expect(s.erro).toMatch(/não respondeu em 20s/);
  });

  it("sucesso fica em cache por dez minutos; a segunda leitura não vai ao ERP e diz que veio do cache", async () => {
    let t = 1_000_000;
    const agora = () => t;
    fake.integracoes = [integracao("sgp")];
    const conector = conectorQueDevolve([{ cpfCnpj: "12345678909", name: "Maria" }]);
    fake.conectores.set("sgp", conector);

    const a = await snapshotAoVivoDoCliente(7, DOC, { agora });
    expect(a.doCache).toBe(false);
    t += TTL_SNAPSHOT_OK_MS - 1;
    const b = await snapshotAoVivoDoCliente(7, DOC, { agora });
    expect(b.doCache).toBe(true);
    expect(conector.fetchCustomerByCpf).toHaveBeenCalledTimes(1);

    t += 2;
    const c = await snapshotAoVivoDoCliente(7, DOC, { agora });
    expect(c.doCache).toBe(false);
    expect(conector.fetchCustomerByCpf).toHaveBeenCalledTimes(2);
  });

  it("falha fica em cache por um minuto, e `forcar` fura o cache", async () => {
    let t = 5_000_000;
    const agora = () => t;
    fake.integracoes = [integracao("sgp")];
    const conector = conectorQueDevolve([], false);
    fake.conectores.set("sgp", conector);

    await snapshotAoVivoDoCliente(7, DOC, { agora });
    t += TTL_SNAPSHOT_FALHA_MS - 1;
    const b = await snapshotAoVivoDoCliente(7, DOC, { agora });
    expect(b.doCache).toBe(true);
    expect(conector.fetchCustomerByCpf).toHaveBeenCalledTimes(1);

    await snapshotAoVivoDoCliente(7, DOC, { agora, forcar: true });
    expect(conector.fetchCustomerByCpf).toHaveBeenCalledTimes(2);
  });

  it("o cache é por provedor: outro provedor com o mesmo documento vai ao próprio ERP", async () => {
    fake.integracoes = [integracao("sgp")];
    const conector = conectorQueDevolve([{ cpfCnpj: "12345678909", name: "Maria" }]);
    fake.conectores.set("sgp", conector);
    await snapshotAoVivoDoCliente(7, DOC);
    await snapshotAoVivoDoCliente(8, DOC);
    expect(conector.fetchCustomerByCpf).toHaveBeenCalledTimes(2);
  });

  it("banco fora ao ler a integração: ok=false, sem lançar", async () => {
    fake.falhaAoLer = true;
    const s = await snapshotAoVivoDoCliente(7, DOC);
    expect(s.ok).toBe(false);
    expect(s.erro).toMatch(/integração do ERP/);
  });
});
