import { afterEach, describe, expect, it, vi } from "vitest";
import { MkConnector } from "./mk";
import { SgpConnector } from "./sgp";
import type { ErpConnectionConfig } from "../types";

const config: ErpConnectionConfig = {
  apiUrl: "https://erp.example.test",
  apiToken: "credencial-sintetica",
  extra: { sgpApp: "teste" },
};
const documento = "00000000000";
const json = (d: unknown) =>
  new Response(JSON.stringify(d), {
    headers: { "content-type": "application/json" },
  });
afterEach(() => vi.unstubAllGlobals());

describe("segunda via dos conectores", () => {
  it("MK aceita URL configurada com /mk e preserva valor corrigido", async () => {
    const fetchFake = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/mk/WSAutenticacao.rule")
        return json({ tokenRetornoAutenticacao: "sessao-sintetica" });
      expect(url.pathname).toBe("/mk/WSMKSegundaViaCobranca.rule");
      expect(url.searchParams.get("cd_fatura")).toBe("123");
      expect(url.searchParams.get("token")).toBe("sessao-sintetica");
      return json({
        Fatura: 123,
        PathDownload: "https://erp.example.test/boleto/123",
        Valor: "1.234,56",
        Vcto: "10/09/2026",
      });
    });
    vi.stubGlobal("fetch", fetchFake);
    const d = await new MkConnector().fetchSegundaVia(
      { ...config, apiUrl: config.apiUrl + "/mk/" },
      documento,
      "123",
    );
    expect(d).toMatchObject({
      valor: 1234.56,
      vencimento: "2026-09-10",
      link: "https://erp.example.test/boleto/123",
    });
  });
  it("MK recusa referências sintéticas sem consultar o servidor", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(
      await new MkConnector().fetchSegundaVia(
        config,
        documento,
        "1:2026-09-10:90",
      ),
    ).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("MK não retorna instrumento de outra fatura", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("WSAutenticacao")
          ? json({ tokenRetornoAutenticacao: "sessao-sintetica" })
          : json({
              Fatura: 999,
              PathDownload: "https://erp.example.test/boleto/999",
            }),
      ),
    );
    await expect(
      new MkConnector().fetchSegundaVia(config, documento, "123"),
    ).rejects.toThrow("outra fatura");
  });
  it("SGP consulta por documento, sem abrir OS, e seleciona a fatura correta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/api/ura/fatura2via/");
        expect(url.search).toBe("");
        expect(init?.method).toBe("POST");
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("cpfcnpj")).toBe(documento);
        expect(body.get("nao_gerar_os")).toBe("1");
        expect(body.get("faturas_abertas_todas")).toBe("1");
        expect(body.get("token")).toBe(config.apiToken);
        return json({
          cpfCnpj: documento,
          links: [
            { fatura: 999, valor: 999 },
            {
              fatura: 123,
              link: "https://erp.example.test/boleto/123",
              valor: 102.45,
              vencimento: "2026-09-10",
              linhadigitavel: "CODIGO-SINTETICO",
            },
          ],
        });
      }),
    );
    expect(
      await new SgpConnector().fetchSegundaVia(config, documento, "123"),
    ).toMatchObject({ valor: 102.45, linhaDigitavel: "CODIGO-SINTETICO" });
  });
  it("SGP rejeita outro cadastro e não substitui uma fatura ausente por outra", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ cpfCnpj: "11111111111", links: [] }))
        .mockResolvedValueOnce(
          json({ cpfCnpj: documento, links: [{ fatura: 999 }] }),
        ),
    );
    const c = new SgpConnector();
    await expect(c.fetchSegundaVia(config, documento, "123")).rejects.toThrow(
      "outro cadastro",
    );
    expect(await c.fetchSegundaVia(config, documento, "123")).toBeNull();
  });
});
