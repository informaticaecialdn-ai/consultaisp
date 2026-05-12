/**
 * Spec 012.0 — Tests do MkConnector.getOnuStatus (DEGRADED) +
 * getCustomerActivity (UNAVAILABLE).
 *
 * MK não expõe RADIUS/ONU/banda via REST oficial. Tests validam:
 *   - capabilities = { onuStatus: 'degraded', customerActivity: 'unavailable' }
 *   - getOnuStatus: usa WSMKConexoesPorCliente.Bloqueada como proxy
 *   - online = !bloqueada
 *   - source = 'inferred_bloqueado'
 *   - getCustomerActivity: sempre retorna unavailable
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MkConnector } from "./mk";
import type { ErpConnectionConfig } from "../types";

/**
 * Cada teste usa um apiToken único pra invalidar o tokenCache interno
 * do MkConnector (module-level Map). Sem isso, autenticação é cached
 * entre tests e mocks ficam dessincronizados.
 */
let tokenCounter = 0;
function freshConfig(): ErpConnectionConfig {
  tokenCounter++;
  return {
    apiUrl: "https://example.mk.com.br",
    apiToken: `fake-token-${tokenCounter}-${Date.now()}`,
    mkContraSenha: "fake-contra-senha",
    apiUser: "",
    extra: { providerId: "1" },
  };
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

/** Helper: mock da autenticação MK (sempre 1ª chamada). */
function mockAuth(token = "session-token-abc") {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ tokenRetornoAutenticacao: token }),
  } as unknown as Response);
}

function mockConexoes(conexoes: Record<string, unknown>[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ Conexoes: conexoes }),
  } as unknown as Response;
}

describe("MkConnector.capabilities", () => {
  it("declara DEGRADED para onuStatus, UNAVAILABLE para customerActivity", () => {
    const c = new MkConnector();
    expect(c.capabilities.onuStatus).toBe("degraded");
    expect(c.capabilities.customerActivity).toBe("unavailable");
  });
});

describe("MkConnector.getOnuStatus", () => {
  it("online=true quando Bloqueada='N'", async () => {
    mockAuth();
    fetchMock.mockResolvedValueOnce(
      mockConexoes([{ Bloqueada: "N", MotivoBloqueio: "" }]),
    );

    const c = new MkConnector();
    const result = await c.getOnuStatus(freshConfig(), "42");

    expect(result.online).toBe(true);
    expect(result.source).toBe("inferred_bloqueado");
    expect(result.signalRxDbm).toBeUndefined();
    expect(result.signalTxDbm).toBeUndefined();
  });

  it("online=false quando Bloqueada='S'", async () => {
    mockAuth();
    fetchMock.mockResolvedValueOnce(
      mockConexoes([{ Bloqueada: "S", MotivoBloqueio: "Inadimplência" }]),
    );

    const c = new MkConnector();
    const result = await c.getOnuStatus(freshConfig(), "42");

    expect(result.online).toBe(false);
    expect(result.source).toBe("inferred_bloqueado");
  });

  it("aceita variações de campo (bloqueada minúscula, Bloqueado, true, 1)", async () => {
    mockAuth();
    fetchMock.mockResolvedValueOnce(mockConexoes([{ bloqueada: "S" }]));
    const c = new MkConnector();
    expect((await c.getOnuStatus(freshConfig(), "42")).online).toBe(false);

    mockAuth();
    fetchMock.mockResolvedValueOnce(mockConexoes([{ Bloqueado: "true" }]));
    expect((await c.getOnuStatus(freshConfig(), "42")).online).toBe(false);

    mockAuth();
    fetchMock.mockResolvedValueOnce(mockConexoes([{ Bloqueada: "1" }]));
    expect((await c.getOnuStatus(freshConfig(), "42")).online).toBe(false);
  });

  it("retorna source='unavailable' quando WSMKConexoesPorCliente vazio", async () => {
    mockAuth();
    fetchMock.mockResolvedValueOnce(mockConexoes([]));

    const c = new MkConnector();
    const result = await c.getOnuStatus(freshConfig(), "999");

    expect(result.source).toBe("unavailable");
    expect(result.online).toBe(false);
  });

  it("retorna source='unavailable' quando MK API retorna erro HTTP", async () => {
    mockAuth();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);

    const c = new MkConnector();
    const result = await c.getOnuStatus(freshConfig(), "42");

    expect(result.source).toBe("unavailable");
  });

  it("retorna source='unavailable' quando auth falha", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ erro: "credencial inválida" }),
    } as unknown as Response);

    const c = new MkConnector();
    const result = await c.getOnuStatus(freshConfig(), "42");

    expect(result.source).toBe("unavailable");
  });
});

describe("MkConnector.getCustomerActivity", () => {
  it("sempre retorna source='unavailable' (MK não expõe banda via REST)", async () => {
    const c = new MkConnector();
    const result = await c.getCustomerActivity(freshConfig(), "42", 30);

    expect(result.source).toBe("unavailable");
    expect(result.bandwidthMbAvg).toBeUndefined();
    expect(result.bandwidthDownloadMbTotal).toBeUndefined();
    expect(result.lastActivityAt).toBeUndefined();
  });

  it("não faz chamadas HTTP (early return)", async () => {
    const c = new MkConnector();
    await c.getCustomerActivity(freshConfig(), "42", 30);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
