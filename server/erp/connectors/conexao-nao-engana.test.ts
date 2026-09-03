/**
 * Um 200 nao e prova de que o ERP atendeu.
 *
 * Medido em 03/09/2026 contra um SGP real: o dono colou no campo de URL o
 * endereco para onde o SGP redireciona quem nao esta logado, e o conector, que
 * decidia so pelo `response.ok`, mostrou "conexao ok 216 ms" para 4.751 bytes da
 * PAGINA DE LOGIN. Qualquer coisa que responda 200 engana um teste assim:
 * portal cativo de wifi, proxy reverso mal apontado, pagina de erro amigavel de
 * CDN, dominio parqueado.
 *
 * O teste de conexao e a UNICA prova que o operador tem antes de ligar a
 * integracao. Se ele mente, a varredura passa a rodar contra a pagina errada,
 * nao acha ninguem — e o sync usa a lista de inadimplentes como prova NEGATIVA:
 * quem nao esta nela tem a divida baixada. Um "ok" mentiroso aqui pode limpar a
 * inadimplencia de um provedor inteiro.
 *
 * Por isso duas garantias, para cada conector:
 *   1. pagina de login com 200 NAO vira sucesso no teste de conexao;
 *   2. pagina de login (ou JSON de forma estranha) NAO vira lista vazia com
 *      `ok: true` nas buscas.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IxcConnector } from "./ixc";
import { MkConnector } from "./mk";
import { HubsoftConnector } from "./hubsoft";
import { VoalleConnector } from "./voalle";
import { RbxConnector } from "./rbx";

/** O corpo que o SGP devolveu no incidente: HTML de tela de login, status 200. */
const PAGINA_LOGIN = `<!DOCTYPE html><html><head><title>Login</title></head><body><form action="/accounts/login"><input name="username"></form></body></html>`;

/** Resposta 200 com HTML — `json()` lanca, como o fetch real faz. */
function respostaHtml(): any {
  return {
    ok: true,
    status: 200,
    text: async () => PAGINA_LOGIN,
    json: async () => {
      throw new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`);
    },
  };
}

/** Resposta 200 com JSON qualquer — serve para o `{}` de um proxy. */
function respostaJson(corpo: any): any {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(corpo),
    json: async () => corpo,
  };
}

/** Um servidor de mentira que responde por rota. */
function servidor(rotear: (url: string) => any) {
  return vi.fn(async (url: string) => rotear(String(url)));
}

let fetchOriginal: typeof globalThis.fetch;
beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe("IXC — o envelope {page,total,registros} e a prova", () => {
  const CONFIG = { apiUrl: "https://ixc.local", apiUser: "45", apiToken: "t", extra: {} } as any;

  it("pagina de login com 200 nao vira conexao ok", async () => {
    globalThis.fetch = servidor(() => respostaHtml()) as any;
    const r = await new IxcConnector().testConnection(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/pagina|JSON/i);
  });

  it("200 com JSON sem envelope do IXC nao vira conexao ok", async () => {
    globalThis.fetch = servidor(() => respostaJson({ status: "ok" })) as any;
    const r = await new IxcConnector().testConnection(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/formato do IXC/i);
  });

  it("erro do IXC com HTTP 200 (token ou IP nao liberado) nao vira conexao ok", async () => {
    globalThis.fetch = servidor(() => respostaJson({ type: "error", message: "Acesso negado - IP nao autorizado" })) as any;
    const r = await new IxcConnector().testConnection(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/IP/i);
  });

  it("envelope legitimo continua passando", async () => {
    globalThis.fetch = servidor(() => respostaJson({ page: "1", total: "1", registros: [{ id: "1" }] })) as any;
    const r = await new IxcConnector().testConnection(CONFIG);
    expect(r.ok).toBe(true);
  });

  it("pagina de login nao vira lista vazia de inadimplentes", async () => {
    globalThis.fetch = servidor(() => respostaHtml()) as any;
    const r = await new IxcConnector().fetchDelinquents(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.customers).toHaveLength(0);
  });

  it("200 com JSON fora do envelope nao vira lista vazia de clientes", async () => {
    globalThis.fetch = servidor(() => respostaJson({})) as any;
    const r = await new IxcConnector().fetchCustomers(CONFIG);
    expect(r.ok).toBe(false);
  });

  it("cancelados: as tres buscas de contrato falhando nao viram 'nenhum cancelado'", async () => {
    globalThis.fetch = servidor(() => respostaHtml()) as any;
    const r = await new IxcConnector().fetchCancelledDelinquents(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.customers).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("MK — o token de acesso e a prova (regressao)", () => {
  const CONFIG = { apiUrl: "http://mk.local:8080/mk", apiToken: "t", mkContraSenha: "c", extra: {} } as any;

  it("pagina de login com 200 nao vira conexao ok", async () => {
    globalThis.fetch = servidor(() => respostaHtml()) as any;
    const r = await new MkConnector().testConnection(CONFIG);
    expect(r.ok).toBe(false);
  });

  it("autenticacao sem token no corpo nao vira conexao ok", async () => {
    globalThis.fetch = servidor(() => respostaJson({ mensagem: "ok" })) as any;
    const r = await new MkConnector().testConnection(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/token/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Hubsoft — o access_token do OAuth e a prova", () => {
  const CONFIG = {
    apiUrl: "https://hubsoft.local/api",
    apiUser: "api@provedor",
    apiToken: "senha",
    extra: { clientId: "id", clientSecret: "segredo" },
  } as any;

  it("pagina de login no /oauth/token nao vira conexao ok", async () => {
    globalThis.fetch = servidor(() => respostaHtml()) as any;
    const r = await new HubsoftConnector().testConnection(CONFIG);
    expect(r.ok).toBe(false);
  });

  it("OAuth ok e resposta de forma desconhecida nao vira lista vazia", async () => {
    globalThis.fetch = servidor((url) =>
      url.includes("/oauth/token")
        ? respostaJson({ access_token: "abc", expires_in: 3600 })
        : respostaJson({ status: "ok" }),
    ) as any;
    const r = await new HubsoftConnector().fetchDelinquents(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/formato/i);
  });

  it("lista vazia reconhecida continua sendo leitura boa", async () => {
    globalThis.fetch = servidor((url) =>
      url.includes("/oauth/token")
        ? respostaJson({ access_token: "abc", expires_in: 3600 })
        : respostaJson({ data: [] }),
    ) as any;
    const r = await new HubsoftConnector().fetchDelinquents(CONFIG);
    expect(r.ok).toBe(true);
    expect(r.customers).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Voalle — o access_token do /connect/token e a prova", () => {
  it("pagina de login no /connect/token nao vira conexao ok", async () => {
    globalThis.fetch = servidor(() => respostaHtml()) as any;
    const r = await new VoalleConnector().testConnection({ apiUrl: "https://voalle-html.local", apiUser: "u", apiToken: "p", extra: {} } as any);
    expect(r.ok).toBe(false);
  });

  it("autenticacao ok e endpoint financeiro servindo HTML nao vira conexao ok", async () => {
    globalThis.fetch = servidor((url) =>
      url.includes("/connect/token")
        ? respostaJson({ access_token: "abc", expires_in: 3600 })
        : respostaHtml(),
    ) as any;
    const r = await new VoalleConnector().testConnection({ apiUrl: "https://voalle-misto.local", apiUser: "u", apiToken: "p", extra: {} } as any);
    expect(r.ok).toBe(false);
  });

  it("resposta de forma desconhecida nao vira lista vazia de inadimplentes", async () => {
    globalThis.fetch = servidor((url) =>
      url.includes("/connect/token")
        ? respostaJson({ access_token: "abc", expires_in: 3600 })
        : respostaJson({ status: "ok" }),
    ) as any;
    const r = await new VoalleConnector().fetchDelinquents({ apiUrl: "https://voalle-forma.local", apiUser: "u", apiToken: "p", extra: {} } as any);
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("RBX — o JSON do rbx_server_json.php e a prova", () => {
  const CONFIG = { apiUrl: "https://rbx.local/routerbox/ws/rbx_server_json.php", apiToken: "chave", extra: {} } as any;

  it("pagina de login com 200 nao vira conexao ok", async () => {
    globalThis.fetch = servidor(() => respostaHtml()) as any;
    const r = await new RbxConnector().testConnection(CONFIG);
    expect(r.ok).toBe(false);
  });

  it("200 com JSON fora do formato do RBX nao vira conexao ok", async () => {
    globalThis.fetch = servidor(() => respostaJson({ status: "ok" })) as any;
    const r = await new RbxConnector().testConnection(CONFIG);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/formato do RBX/i);
  });

  it("envelope legitimo continua passando", async () => {
    globalThis.fetch = servidor(() => respostaJson({ dados: [{ nome: "Fulano" }] })) as any;
    const r = await new RbxConnector().testConnection(CONFIG);
    expect(r.ok).toBe(true);
  });

  it("pagina de login nao vira lista vazia de inadimplentes", async () => {
    globalThis.fetch = servidor(() => respostaHtml()) as any;
    const r = await new RbxConnector().fetchDelinquents(CONFIG);
    expect(r.ok).toBe(false);
  });
});
