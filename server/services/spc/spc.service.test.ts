import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listarProdutosSpc, consultarSpc, mensagemDeAutenticacao, credencialTravada,
  _resetTravaCredencialParaTestes, SpcError, TRAVA_CREDENCIAL_MS,
} from "./spc.service";

/**
 * O que NAO pode acontecer: repetir uma credencial recusada. Em 02/09/2026 o
 * SPC bloqueou o operador (CS_AUT001.E1.7) depois de poucas tentativas com a
 * senha errada. Depois de uma recusa, o cliente nao toca o SPC por
 * TRAVA_CREDENCIAL_MS.
 */

const resposta = (status: number, body: string) =>
  ({ status, ok: status < 400, text: async () => body, headers: new Headers() } as unknown as Response);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SPC_USERNAME = "000000000";
  process.env.SPC_PASSWORD = "senha-de-teste";
  process.env.SPC_WSDL_URL = "https://exemplo.invalido/spc/remoting/ws/consulta/consultaWebService";
  _resetTravaCredencialParaTestes();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetTravaCredencialParaTestes();
});

describe("mensagemDeAutenticacao", () => {
  it("traduz os codigos CS_AUT001 da camada de autenticacao", () => {
    expect(mensagemDeAutenticacao("CS_AUT001.E1.2")).toEqual({ codigo: "CS_AUT001.E1.2", mensagem: "operador ou senha inválidos" });
    expect(mensagemDeAutenticacao("<html>CS_AUT001.E1.7</html>")).toEqual({ codigo: "CS_AUT001.E1.7", mensagem: "operador bloqueado por excesso de tentativas" });
    expect(mensagemDeAutenticacao("CS_AUT001.E1.6.1")?.mensagem).toContain("IP internacional");
    expect(mensagemDeAutenticacao("CS_AUT001.E1.99")?.mensagem).toBe("erro de autenticação E1.99");
    expect(mensagemDeAutenticacao("<S:Envelope/>")).toBeNull();
  });
});

describe("credencial recusada", () => {
  it("401 com E1.2 vira SpcError de credencial, com status 4xx (sem retry) e trava as proximas chamadas", async () => {
    fetchMock.mockResolvedValue(resposta(401, "CS_AUT001.E1.2"));
    const err = await listarProdutosSpc().catch(e => e);
    expect(err).toBeInstanceOf(SpcError);
    expect(err.categoria).toBe("credencial");
    expect(err.status).toBe(401);
    expect(err.message).toContain("operador ou senha inválidos");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(credencialTravada()?.motivo).toBe("operador ou senha inválidos");

    // Segunda chamada: nada sai para o SPC.
    const err2 = await consultarSpc("00752477714").catch(e => e);
    expect(err2).toBeInstanceOf(SpcError);
    expect(err2.codigo).toBe("TRAVA_CREDENCIAL");
    expect(err2.message).toMatch(/Nova tentativa só em \d+ min/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("operador bloqueado (E1.7) chega com HTTP 500 e ainda assim e credencial, nao indisponibilidade — e nao repete", async () => {
    fetchMock.mockResolvedValue(resposta(500, "CS_AUT001.E1.7"));
    const err = await listarProdutosSpc().catch(e => e);
    expect(err.categoria).toBe("credencial");
    expect(err.message).toContain("bloqueado por excesso de tentativas");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a trava expira sozinha", async () => {
    fetchMock.mockResolvedValue(resposta(401, "CS_AUT001.E1.2"));
    await listarProdutosSpc().catch(() => {});
    const agora = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(agora + TRAVA_CREDENCIAL_MS + 1);
    expect(credencialTravada()).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("indisponibilidade", () => {
  it("5xx sem codigo de autenticacao e indisponivel e repete uma vez", async () => {
    fetchMock.mockResolvedValue(resposta(503, "<html>Service Unavailable</html>"));
    const err = await listarProdutosSpc().catch(e => e);
    expect(err.categoria).toBe("indisponivel");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(credencialTravada()).toBeNull();
  }, 15_000);

  it("sem SPC_USERNAME/SPC_PASSWORD nao chama nada", async () => {
    delete process.env.SPC_USERNAME;
    const err = await listarProdutosSpc().catch(e => e);
    expect(err.codigo).toBe("NAO_CONFIGURADO");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SOAP Fault com HTTP 500", () => {
  it("CPF inválido (CN_INT005.E8.2) é erro de documento, sem repetir e sem contar como indisponibilidade", async () => {
    const fault = `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><S:Fault><faultcode>S:Server</faultcode><faultstring>CN_INT005.E8.2 - CPF/CNPJ inválido</faultstring></S:Fault></S:Body></S:Envelope>`;
    fetchMock.mockResolvedValue(resposta(500, fault));
    const err = await consultarSpc("00752477714").catch(e => e);
    expect(err).toBeInstanceOf(SpcError);
    expect(err.categoria).toBe("documento");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(credencialTravada()).toBeNull();
  });
});
