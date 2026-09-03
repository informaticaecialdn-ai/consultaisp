import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the registry before importing the service
vi.mock("../erp/registry.js", () => ({
  getConnector: vi.fn(),
}));

// Mock the index (connector registration side-effect)
vi.mock("../erp/index.js", () => ({}));

// Mock the logger
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { queryRegionalErps, queryRegionalErpsByAddress } from "./realtime-query.service.js";
import { getConnector } from "../erp/registry.js";
import { logger } from "../logger.js";
import type { ErpConnector, ErpConnectionConfig, ErpFetchResult } from "../erp/types.js";

const mockedGetConnector = vi.mocked(getConnector);

function makeMockConnector(customers: ErpFetchResult["customers"] = []): ErpConnector {
  return {
    name: "mock-erp",
    label: "Mock ERP",
    configFields: [],
    testConnection: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    fetchDelinquents: vi.fn().mockResolvedValue({ ok: true, message: "ok", customers }),
    fetchCustomers: vi.fn().mockResolvedValue({ ok: true, message: "ok", customers }),
    fetchCustomerByCpf: vi.fn().mockResolvedValue({ ok: true, message: "ok", customers }),
  };
}

function makeIntegration(providerId: number, providerName: string, erpSource = "mock-erp") {
  return {
    id: providerId,
    providerId,
    providerName,
    erpSource,
    apiUrl: "https://erp.example.com",
    apiToken: "token123",
    apiUser: "user1",
    isActive: true,
    syncIntervalHours: 6,
    lastSyncAt: null,
    clientId: null,
    clientSecret: null,
    mkContraSenha: null,
    extra: null,
    createdAt: new Date(),
  };
}

describe("queryRegionalErps", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array for empty integrations", async () => {
    const results = await queryRegionalErps([], "12345678901", "cpf");
    expect(results).toEqual([]);
  });

  it("returns results tagged with correct providerId for each provider", async () => {
    const connectorA = makeMockConnector([
      { cpfCnpj: "12345678901", name: "Cliente A", totalOverdueAmount: 100, maxDaysOverdue: 30, erpSource: "mock-erp" },
    ]);
    const connectorB = makeMockConnector([
      { cpfCnpj: "12345678901", name: "Cliente B", totalOverdueAmount: 200, maxDaysOverdue: 60, erpSource: "mock-erp" },
    ]);

    mockedGetConnector.mockImplementation((source: string) => {
      // Both use same source name, return different connectors per call
      return source === "mock-erp" ? connectorA : undefined;
    });

    // For this test, we use two integrations with the same erpSource but different providers
    // Both will get connectorA, but we control fetchCustomerByCpf per-call
    let callCount = 0;
    mockedGetConnector.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? connectorA : connectorB;
    });

    const integrations = [
      makeIntegration(1, "Provider Alpha"),
      makeIntegration(2, "Provider Beta"),
    ];

    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(results).toHaveLength(2);
    expect(results[0].providerId).toBe(1);
    expect(results[0].providerName).toBe("Provider Alpha");
    expect(results[1].providerId).toBe(2);
    expect(results[1].providerName).toBe("Provider Beta");
  });

  it("tenant isolation: Provider A results do not mix with Provider B", async () => {
    const connectorA = makeMockConnector([
      { cpfCnpj: "12345678901", name: "Only A Customer", totalOverdueAmount: 100, maxDaysOverdue: 10, erpSource: "mock-erp" },
    ]);
    const connectorB = makeMockConnector([
      { cpfCnpj: "12345678901", name: "Only B Customer", totalOverdueAmount: 500, maxDaysOverdue: 90, erpSource: "mock-erp" },
    ]);

    let callIdx = 0;
    mockedGetConnector.mockImplementation(() => {
      callIdx++;
      return callIdx === 1 ? connectorA : connectorB;
    });

    const integrations = [
      makeIntegration(10, "ISP Alpha"),
      makeIntegration(20, "ISP Beta"),
    ];

    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(results[0].providerId).not.toBe(results[1].providerId);
    expect(results[0].providerId).toBe(10);
    expect(results[1].providerId).toBe(20);
    // Each result has its own customers from its own connector
    expect(results[0].customers[0].name).toBe("Only A Customer");
    expect(results[1].customers[0].name).toBe("Only B Customer");
  });

  it("CPF search uses fetchCustomerByCpf when available", async () => {
    const connector = makeMockConnector([
      { cpfCnpj: "12345678901", name: "Test User", totalOverdueAmount: 0, maxDaysOverdue: 0, erpSource: "mock-erp" },
    ]);
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "Provider")];
    await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(connector.fetchCustomerByCpf).toHaveBeenCalled();
  });

  it("returns ok: true with customers on successful query", async () => {
    const connector = makeMockConnector([
      { cpfCnpj: "12345678901", name: "Joao", totalOverdueAmount: 150, maxDaysOverdue: 45, erpSource: "mock-erp" },
    ]);
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "ISP Test")];
    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(results[0].ok).toBe(true);
    expect(results[0].customers).toHaveLength(1);
    expect(results[0].customers[0].cpfCnpj).toBe("12345678901");
    expect(results[0].customers[0].name).toBe("Joao");
  });

  it("handles timeout from connector with timedOut: true", async () => {
    const connector = makeMockConnector();
    (connector.fetchCustomerByCpf as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Timeout"));
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "Slow ISP")];
    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(results[0].ok).toBe(false);
    expect(results[0].timedOut).toBe(true);
    expect(results[0].error).toContain("Timeout");
    expect(results[0].customers).toEqual([]);
  });

  it("returns ok: false with descriptive error for unknown erpSource", async () => {
    mockedGetConnector.mockReturnValue(undefined);

    const integrations = [makeIntegration(1, "Unknown ISP", "unknown-erp")];
    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("unknown-erp");
    expect(results[0].error).toContain("nao disponivel");
  });

  it("includes latencyMs in each result", async () => {
    const connector = makeMockConnector([]);
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "ISP")];
    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(results[0]).toHaveProperty("latencyMs");
    expect(typeof results[0].latencyMs).toBe("number");
    expect(results[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("one ERP failure does not block others (parallel independence)", async () => {
    const goodConnector = makeMockConnector([
      { cpfCnpj: "12345678901", name: "Good", totalOverdueAmount: 0, maxDaysOverdue: 0, erpSource: "mock-erp" },
    ]);
    const badConnector = makeMockConnector();
    (badConnector.fetchCustomerByCpf as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Connection refused"));

    let callIdx = 0;
    mockedGetConnector.mockImplementation(() => {
      callIdx++;
      return callIdx === 1 ? badConnector : goodConnector;
    });

    const integrations = [
      makeIntegration(1, "Bad ISP"),
      makeIntegration(2, "Good ISP"),
    ];

    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(true);
    expect(results[1].customers).toHaveLength(1);
  });

  it("handles generic error from connector", async () => {
    const connector = makeMockConnector();
    (connector.fetchCustomerByCpf as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Internal server error"));
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "ISP")];
    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(results[0].ok).toBe(false);
    expect(results[0].timedOut).toBeFalsy();
    expect(results[0].error).toContain("Internal server error");
  });

  it("falls back to fetchDelinquents when fetchCustomerByCpf is not available", async () => {
    const connector: ErpConnector = {
      name: "basic-erp",
      label: "Basic ERP",
      configFields: [],
      testConnection: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
      fetchDelinquents: vi.fn().mockResolvedValue({
        ok: true,
        message: "ok",
        customers: [
          { cpfCnpj: "12345678901", name: "Match", totalOverdueAmount: 50, maxDaysOverdue: 5, erpSource: "basic-erp" },
          { cpfCnpj: "99999999999", name: "Other", totalOverdueAmount: 100, maxDaysOverdue: 10, erpSource: "basic-erp" },
        ],
      }),
      fetchCustomers: vi.fn().mockResolvedValue({ ok: true, message: "ok", customers: [] }),
      // No fetchCustomerByCpf — should use fetchDelinquents fallback
    };
    // Remove fetchCustomerByCpf to trigger fallback path
    delete (connector as any).fetchCustomerByCpf;

    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "Basic ISP", "basic-erp")];
    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(results[0].ok).toBe(true);
    expect(results[0].customers).toHaveLength(1);
    expect(results[0].customers[0].cpfCnpj).toBe("12345678901");
    expect(connector.fetchDelinquents).toHaveBeenCalled();
  });

  it("normalizes customer data (missing fields default to safe values)", async () => {
    const connector = makeMockConnector([
      { cpfCnpj: "12345678901", name: "Sparse" } as any,
    ]);
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "ISP")];
    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    const customer = results[0].customers[0];
    expect(customer.totalOverdueAmount).toBe(0);
    expect(customer.maxDaysOverdue).toBe(0);
    expect(customer.overdueInvoicesCount).toBe(0);
  });

  it("preserves erpSource in each result", async () => {
    const connector = makeMockConnector([]);
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "ISP", "ixc")];
    const results = await queryRegionalErps(integrations, "12345678901", "cpf");

    expect(results[0].erpSource).toBe("ixc");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CEP search — optimized path + failure fallback
  // ═══════════════════════════════════════════════════════════════════════════

  it("CEP search uses fetchCustomersByCep when available and succeeds", async () => {
    const connector = makeMockConnector();
    connector.fetchCustomersByCep = vi.fn().mockResolvedValue({
      ok: true,
      message: "ok",
      customers: [
        { cpfCnpj: "12345678901", name: "CEP Customer", cep: "01310100", totalOverdueAmount: 50, maxDaysOverdue: 10, erpSource: "mock-erp" },
      ],
    });
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "ISP CEP")];
    const results = await queryRegionalErps(integrations, "01310100", "cep");

    expect(results[0].ok).toBe(true);
    expect(results[0].customers).toHaveLength(1);
    expect(results[0].customers[0].cpfCnpj).toBe("12345678901");
    expect(connector.fetchCustomersByCep).toHaveBeenCalled();
    expect(connector.fetchDelinquents).not.toHaveBeenCalled();
  });

  it("CEP search falls back to fetchDelinquents when fetchCustomersByCep returns ok: false", async () => {
    const connector = makeMockConnector();
    connector.fetchCustomersByCep = vi.fn().mockResolvedValue({
      ok: false,
      message: "Erro: timeout na API",
      customers: [],
    });
    (connector.fetchDelinquents as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      message: "ok",
      customers: [
        { cpfCnpj: "11111111111", name: "Fallback Match", cep: "01310200", totalOverdueAmount: 100, maxDaysOverdue: 30, erpSource: "mock-erp" },
        { cpfCnpj: "22222222222", name: "No Match", cep: "99999000", totalOverdueAmount: 200, maxDaysOverdue: 60, erpSource: "mock-erp" },
      ],
    });
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "ISP Fallback")];
    const results = await queryRegionalErps(integrations, "01310200", "cep");

    expect(results[0].ok).toBe(true);
    expect(results[0].customers).toHaveLength(1);
    expect(results[0].customers[0].cpfCnpj).toBe("11111111111");
    expect(connector.fetchCustomersByCep).toHaveBeenCalled();
    expect(connector.fetchDelinquents).toHaveBeenCalled();
  });

  it("CEP search returns ok: false when both fetchCustomersByCep and fetchDelinquents fail", async () => {
    const connector = makeMockConnector();
    connector.fetchCustomersByCep = vi.fn().mockResolvedValue({
      ok: false,
      message: "Erro: connection refused",
      customers: [],
    });
    (connector.fetchDelinquents as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      message: "Erro: also broken",
      customers: [],
    });
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "ISP Both Fail")];
    const results = await queryRegionalErps(integrations, "01310100", "cep");

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("CEP query falhou");
    expect(results[0].customers).toEqual([]);
  });

  it("CEP search without fetchCustomersByCep uses fetchDelinquents + in-memory filter", async () => {
    const connector: ErpConnector = {
      name: "basic-erp",
      label: "Basic ERP",
      configFields: [],
      testConnection: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
      fetchDelinquents: vi.fn().mockResolvedValue({
        ok: true,
        message: "ok",
        customers: [
          { cpfCnpj: "11111111111", name: "CEP Match", cep: "01310100", totalOverdueAmount: 50, maxDaysOverdue: 5, erpSource: "basic-erp" },
          { cpfCnpj: "22222222222", name: "No CEP Match", cep: "99999000", totalOverdueAmount: 100, maxDaysOverdue: 10, erpSource: "basic-erp" },
        ],
      }),
      fetchCustomers: vi.fn().mockResolvedValue({ ok: true, message: "ok", customers: [] }),
    };
    mockedGetConnector.mockReturnValue(connector);

    const integrations = [makeIntegration(1, "Basic ISP", "basic-erp")];
    const results = await queryRegionalErps(integrations, "01310100", "cep");

    expect(results[0].ok).toBe(true);
    expect(results[0].customers).toHaveLength(1);
    expect(results[0].customers[0].cpfCnpj).toBe("11111111111");
    expect(connector.fetchDelinquents).toHaveBeenCalled();
  });
});

/**
 * O sinal de contrato precisa CHEGAR do outro lado.
 *
 * `normalizeCustomer` renomeava `contractStatus` para `status` e nao deixava o
 * campo tipado. O anti-fraude, do outro lado, lia `contractStatus` — sempre
 * `undefined`. A regra de fuga descartava por "status_desconhecido" e nenhum
 * alerta proativo era criado, para nenhum provedor, nunca. O tsc nao pegava
 * porque o campo e opcional nos dois tipos.
 */
describe("o sinal de contrato atravessa a normalizacao", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("contractStatus do conector sobrevive como campo proprio", async () => {
    const connector = makeMockConnector([
      {
        cpfCnpj: "12345678901", name: "Cliente Ativo", totalOverdueAmount: 300,
        maxDaysOverdue: 20, contractStatus: "active", contractStartDate: "2026-06-01",
        erpSource: "mock-erp",
      } as any,
    ]);
    mockedGetConnector.mockReturnValue(connector);

    const [r] = await queryRegionalErps([makeIntegration(1, "Dono")], "12345678901", "cpf");

    // O que o anti-fraude le:
    expect(r.customers[0].contractStatus).toBe("active");
    // E o texto livre segue existindo para exibicao:
    expect(r.customers[0].status).toBe("active");
    expect(r.customers[0].contractStartDate).toBe("2026-06-01");
  });

  it("conector que nao sabe o contrato deixa o campo indefinido — nao inventa", async () => {
    const connector = makeMockConnector([
      { cpfCnpj: "12345678901", name: "Sem sinal", totalOverdueAmount: 0, maxDaysOverdue: 0, erpSource: "mock-erp" },
    ]);
    mockedGetConnector.mockReturnValue(connector);

    const [r] = await queryRegionalErps([makeIntegration(1, "Dono")], "12345678901", "cpf");

    expect(r.customers[0].contractStatus).toBeUndefined();
  });

  it("status cru do ERP nao contamina o campo tipado", async () => {
    // `status` aceita texto livre do ERP; `contractStatus` so a uniao fechada.
    // Sem essa separacao, a regra de fuga receberia "Ativo"/"A"/"1" e teria de
    // adivinhar.
    const connector = makeMockConnector([
      { cpfCnpj: "12345678901", name: "Cru", status: "Ativo", totalOverdueAmount: 0, maxDaysOverdue: 0, erpSource: "mock-erp" } as any,
    ]);
    mockedGetConnector.mockReturnValue(connector);

    const [r] = await queryRegionalErps([makeIntegration(1, "Dono")], "12345678901", "cpf");

    expect(r.customers[0].status).toBe("Ativo");
    expect(r.customers[0].contractStatus).toBeUndefined();
  });
});

/**
 * O identificador da consulta nas linhas do ERP.
 *
 * Sem ele, dois provedores consultando ao mesmo tempo produzem "RT-QUERY ERP
 * falhou" intercalado e indistinguivel — e e essa a linha que responde "por que
 * a consulta CI-2609-K7F3M2 nao trouxe nada".
 */
describe("correlacao pelo identificador da consulta", () => {
  const CODIGO = "CI-2609-K7F3M2";

  beforeEach(() => {
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
  });

  it("carimba as linhas de abertura e de conclusao", async () => {
    mockedGetConnector.mockReturnValue(makeMockConnector([]));

    await queryRegionalErps([makeIntegration(1, "Dono")], "12345678901", "cpf", { consultaId: CODIGO });

    const linhas = vi.mocked(logger.info).mock.calls.map(([ctx, msg]: any[]) => ({ ctx, msg }));
    expect(linhas.find(l => l.msg === "RT-QUERY consultando ERPs")?.ctx.consultaId).toBe(CODIGO);
    expect(linhas.find(l => l.msg === "RT-QUERY concluido")?.ctx.consultaId).toBe(CODIGO);
  });

  it("carimba tambem a falha de um ERP — a linha que o suporte procura", async () => {
    const quebrado = makeMockConnector([]);
    (quebrado.fetchCustomerByCpf as any) = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    mockedGetConnector.mockReturnValue(quebrado);

    const [r] = await queryRegionalErps([makeIntegration(1, "Dono")], "12345678901", "cpf", { consultaId: CODIGO });

    expect(r.ok).toBe(false);
    const falha = vi.mocked(logger.warn).mock.calls.find(([, msg]: any[]) => msg === "RT-QUERY ERP falhou");
    expect((falha?.[0] as any).consultaId).toBe(CODIGO);
  });

  it("sem codigo o servico segue funcionando — chamador antigo nao quebra", async () => {
    mockedGetConnector.mockReturnValue(makeMockConnector([]));

    const results = await queryRegionalErps([makeIntegration(1, "Dono")], "12345678901", "cpf");

    expect(results).toHaveLength(1);
    const abertura = vi.mocked(logger.info).mock.calls.find(([, msg]: any[]) => msg === "RT-QUERY consultando ERPs");
    expect((abertura?.[0] as any).consultaId).toBeUndefined();
  });

  it("o cruzamento por endereco leva o mesmo codigo da consulta que o originou", async () => {
    const connector = makeMockConnector([]);
    (connector as any).fetchCustomersByAddress = vi.fn().mockResolvedValue({ ok: true, message: "ok", customers: [] });
    mockedGetConnector.mockReturnValue(connector);

    await queryRegionalErpsByAddress(
      [makeIntegration(1, "Dono")],
      { logradouro: "RUA DAS FLORES", numero: "772", cidade: "NOVA ESPERANCA", uf: "PR" },
      { consultaId: CODIGO },
    );

    const abertura = vi.mocked(logger.info).mock.calls.find(([, msg]: any[]) => msg === "RT-QUERY cruzando endereco nos ERPs");
    expect((abertura?.[0] as any).consultaId).toBe(CODIGO);
  });
});
