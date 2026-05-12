/**
 * Spec 012.0 — Tests do IxcConnector.getOnuStatus + getCustomerActivity.
 *
 * Mock global `fetch` para simular respostas do IXC. Verifica:
 *   - Parsing correto de radusuarios.online (S/N)
 *   - Discovery em runtime de tabelas opticas (cliente_fibra_onu fallback)
 *   - Parsing de número em dBm (string ou number)
 *   - Graceful degradation quando tabelas faltam
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { IxcConnector } from "./ixc";
import type { ErpConnectionConfig } from "../types";

const CONFIG: ErpConnectionConfig = {
  apiUrl: "https://example.ixc.com.br",
  apiToken: "fake-token",
  apiUser: "fake-user",
  extra: { providerId: "1" },
};

// Mock fetch globalmente
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

/**
 * Helper para mock de resposta IXC paginada (1 página com N registros).
 */
function mockIxcResponse(registros: Record<string, unknown>[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ page: 1, total: registros.length, registros }),
  } as unknown as Response;
}

function mockIxcEmpty() {
  return mockIxcResponse([]);
}

describe("IxcConnector.capabilities", () => {
  it("declara capability FULL para onuStatus e customerActivity", () => {
    const c = new IxcConnector();
    expect(c.capabilities.onuStatus).toBe("full");
    expect(c.capabilities.customerActivity).toBe("full");
  });
});

describe("IxcConnector.getOnuStatus", () => {
  it("retorna online=true quando radusuarios.online='S'", async () => {
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([
        { id_cliente: "42", login: "joao", online: "S", ultima_conexao_final: "2026-05-15 10:00:00" },
      ]),
    );
    // 3 tentativas optical fallback (cliente_fibra_onu, fibra_onu, monitora_potencia_onu) — todas vazias
    fetchMock.mockResolvedValueOnce(mockIxcEmpty());
    fetchMock.mockResolvedValueOnce(mockIxcEmpty());
    fetchMock.mockResolvedValueOnce(mockIxcEmpty());

    const c = new IxcConnector();
    const result = await c.getOnuStatus(CONFIG, "42");

    expect(result.online).toBe(true);
    expect(result.lastSeen).toBeInstanceOf(Date);
    expect(result.signalRxDbm).toBeUndefined();
    expect(result.source).toBe("radius");
  });

  it("retorna online=false quando radusuarios.online='N'", async () => {
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([{ id_cliente: "42", online: "N", ultima_conexao_final: "2026-05-10 22:00:00" }]),
    );
    fetchMock.mockResolvedValue(mockIxcEmpty());

    const c = new IxcConnector();
    const result = await c.getOnuStatus(CONFIG, "42");

    expect(result.online).toBe(false);
  });

  it("descobre sinal Rx em cliente_fibra_onu (primeira tabela)", async () => {
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([{ id_cliente: "42", online: "S", ultima_conexao_final: "2026-05-15 10:00:00" }]),
    );
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([{ id_cliente: "42", sinal_rx: "-22.5", sinal_tx: "2.1" }]),
    );

    const c = new IxcConnector();
    const result = await c.getOnuStatus(CONFIG, "42");

    expect(result.signalRxDbm).toBe(-22.5);
    expect(result.signalTxDbm).toBe(2.1);
    expect(result.source).toBe("olt");
  });

  it("faz fallback para tabela fibra_onu quando cliente_fibra_onu retorna vazio", async () => {
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([{ id_cliente: "42", online: "S" }]),
    );
    fetchMock.mockResolvedValueOnce(mockIxcEmpty());  // cliente_fibra_onu vazio
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([{ id_cliente: "42", potencia_rx: "-25.3" }]),  // fibra_onu tem
    );

    const c = new IxcConnector();
    const result = await c.getOnuStatus(CONFIG, "42");

    expect(result.signalRxDbm).toBe(-25.3);
    expect(result.source).toBe("olt");
  });

  it("retorna source='radius' (sem sinal) quando nenhuma tabela óptica responde", async () => {
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([{ id_cliente: "42", online: "S" }]),
    );
    fetchMock.mockResolvedValue(mockIxcEmpty());

    const c = new IxcConnector();
    const result = await c.getOnuStatus(CONFIG, "42");

    expect(result.signalRxDbm).toBeUndefined();
    expect(result.source).toBe("radius");
  });

  it("aceita signalRx como number (não-string) graciosamente", async () => {
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([{ id_cliente: "42", online: "S" }]),
    );
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([{ id_cliente: "42", rx_power: -19.8 }]),
    );

    const c = new IxcConnector();
    const result = await c.getOnuStatus(CONFIG, "42");

    expect(result.signalRxDbm).toBe(-19.8);
  });

  it("cliente sem radusuarios (não-PPPoE) retorna online=false sem erro", async () => {
    fetchMock.mockResolvedValueOnce(mockIxcEmpty());  // sem RADIUS user
    fetchMock.mockResolvedValue(mockIxcEmpty());

    const c = new IxcConnector();
    const result = await c.getOnuStatus(CONFIG, "999");

    expect(result.online).toBe(false);
    expect(result.lastSeen).toBeUndefined();
  });

  it("falha de tabela óptica não quebra retorno (try/catch)", async () => {
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([{ id_cliente: "42", online: "S" }]),
    );
    // Primeira tabela dá erro 500
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);
    fetchMock.mockResolvedValue(mockIxcEmpty());

    const c = new IxcConnector();
    const result = await c.getOnuStatus(CONFIG, "42");

    expect(result.online).toBe(true);
    expect(result.signalRxDbm).toBeUndefined();
  });
});

describe("IxcConnector.getCustomerActivity", () => {
  it("calcula média MB/dia a partir de download_atual + upload_atual", async () => {
    // 1 GB download + 200 MB upload em 30 dias = ~40 MB/dia
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([
        {
          id_cliente: "42",
          download_atual: "1000000000",  // 1 GB bytes
          upload_atual: "200000000",     // 200 MB bytes
          ultima_conexao_final: "2026-05-15 10:00:00",
        },
      ]),
    );

    const c = new IxcConnector();
    const result = await c.getCustomerActivity(CONFIG, "42", 30);

    expect(result.source).toBe("radius");
    expect(result.bandwidthDownloadMbTotal).toBe(1000);
    expect(result.bandwidthUploadMbTotal).toBe(200);
    expect(result.bandwidthMbAvg).toBe(40);
    expect(result.lastActivityAt).toBeInstanceOf(Date);
  });

  it("retorna source=unavailable quando radusuarios não retorna", async () => {
    fetchMock.mockResolvedValueOnce(mockIxcEmpty());

    const c = new IxcConnector();
    const result = await c.getCustomerActivity(CONFIG, "999", 30);

    expect(result.source).toBe("unavailable");
    expect(result.bandwidthMbAvg).toBeUndefined();
  });

  it("aceita download/upload como 0 (cliente sem uso)", async () => {
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([
        { id_cliente: "42", download_atual: "0", upload_atual: "0" },
      ]),
    );

    const c = new IxcConnector();
    const result = await c.getCustomerActivity(CONFIG, "42", 30);

    expect(result.source).toBe("radius");
    expect(result.bandwidthMbAvg).toBe(0);
  });

  it("divide por max(1, sinceDays) — protege divisão por zero", async () => {
    fetchMock.mockResolvedValueOnce(
      mockIxcResponse([{ id_cliente: "42", download_atual: "100000000", upload_atual: "0" }]),
    );

    const c = new IxcConnector();
    const result = await c.getCustomerActivity(CONFIG, "42", 0);

    expect(result.bandwidthMbAvg).toBe(100);  // 100 MB / max(1, 0) = 100
  });
});
