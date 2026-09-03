import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateErpUrl, isAllowedErpUrl } from "./url-validator";

/**
 * A URL base do ERP e a unica coisa que o operador digita e que ninguem mais
 * confere. Estes testes existem porque um endereco de tela de login passou por
 * aqui em 03/09/2026 e virou "conexao ok" numa integracao que nao autentica.
 */

const ENV_ORIGINAL = {
  privado: process.env.ERP_ALLOW_PRIVATE_NETWORK,
  allowlist: process.env.ERP_URL_ALLOWLIST,
};

beforeEach(() => {
  delete process.env.ERP_ALLOW_PRIVATE_NETWORK;
  delete process.env.ERP_URL_ALLOWLIST;
});

afterEach(() => {
  if (ENV_ORIGINAL.privado === undefined) delete process.env.ERP_ALLOW_PRIVATE_NETWORK;
  else process.env.ERP_ALLOW_PRIVATE_NETWORK = ENV_ORIGINAL.privado;
  if (ENV_ORIGINAL.allowlist === undefined) delete process.env.ERP_URL_ALLOWLIST;
  else process.env.ERP_URL_ALLOWLIST = ENV_ORIGINAL.allowlist;
});

describe("validateErpUrl — as tres integracoes reais de producao", () => {
  // Se a regra nova reprovar uma destas duas, ela esta errada: sao provedores
  // sincronizando hoje.
  it("MK do provedor 1 continua valido com a rede privada liberada", () => {
    process.env.ERP_ALLOW_PRIVATE_NETWORK = "true";

    expect(validateErpUrl("http://170.231.148.99:8080/mk")).toEqual({ valid: true });
  });

  it("MK do provedor 1: o caminho /mk nunca e o motivo da recusa", () => {
    // Sem a liberacao de rede o MK cai pelo HTTP, que e politica antiga e
    // deliberada. O que este teste trava e que o caminho de instalacao `/mk`
    // nao entre na conta — foi o risco de barrar caminho junto com tela.
    const r = validateErpUrl("http://170.231.148.99:8080/mk");

    expect(r.valid).toBe(false);
    expect(r.reason).toContain("HTTP");
    expect(r.reason).not.toContain("tela");
  });

  it("IXC do provedor 4 continua valido", () => {
    expect(validateErpUrl("https://ixc.ngtelecom.net.br")).toEqual({ valid: true });
  });

  it("SGP do provedor 6 — o endereco do incidente — passa a ser recusado", () => {
    const r = validateErpUrl("https://amplisinal.sgp.net.br/accounts/login?next=/admin/");

    expect(r.valid).toBe(false);
    // A mensagem tem de ensinar o que sobra do endereco.
    expect(r.reason).toContain("login");
    expect(r.reason).toContain("https://amplisinal.sgp.net.br");
  });
});

describe("validateErpUrl — caminho legitimo de instalacao continua passando", () => {
  it.each([
    ["RBX guarda o endpoint inteiro", "https://erp.provedor.com.br/routerbox/ws/rbx_server_json.php"],
    ["Hubsoft pede a base com /api", "https://api.provedor.com.br/api"],
    ["IXC com caminho de webservice", "https://ixc.provedor.com.br/webservice/v1"],
    ["base com barra no fim", "https://provedor.sgp.net.br/"],
    ["host sem protocolo", "provedor.sgp.net.br"],
    ["palavra que apenas comeca igual a uma tela", "https://erp.provedor.com.br/logistica"],
    ["authorize nao e a tela auth", "https://erp.provedor.com.br/authorize"],
    ["espaco colado junto do endereco", "  https://ixc.ngtelecom.net.br  "],
  ])("%s", (_titulo, url) => {
    expect(validateErpUrl(url)).toEqual({ valid: true });
  });
});

describe("validateErpUrl — endereco de tela de acesso", () => {
  it.each([
    "https://provedor.sgp.net.br/accounts/login",
    "https://provedor.sgp.net.br/accounts/login/",
    "https://provedor.sgp.net.br/ACCOUNTS/LOGIN",
    "https://erp.provedor.com.br/login.php",
    "https://erp.provedor.com.br/entrar",
    "https://erp.provedor.com.br/signin",
    "https://erp.provedor.com.br/auth",
    "https://erp.provedor.com.br/logout",
    "https://erp.provedor.com.br/autenticação",
  ])("recusa %s", (url) => {
    const r = validateErpUrl(url);

    expect(r.valid).toBe(false);
    expect(r.reason).toContain("tela de acesso");
  });

  it("a tela dentro de um caminho de instalacao tambem cai", () => {
    const r = validateErpUrl("https://erp.provedor.com.br/mk/login");

    expect(r.valid).toBe(false);
  });
});

describe("validateErpUrl — trecho de navegacao", () => {
  it("recusa query string e mostra o que sobra do endereco", () => {
    const r = validateErpUrl("https://erp.provedor.com.br/mk?empresa=2");

    expect(r.valid).toBe(false);
    expect(r.reason).toContain("?");
    expect(r.reason).toContain("https://erp.provedor.com.br/mk");
  });

  it("recusa ate o ? sozinho no fim — ele quebra a montagem da chamada igual", () => {
    expect(validateErpUrl("https://erp.provedor.com.br?").valid).toBe(false);
  });

  it("recusa fragmento e mostra o que sobra do endereco", () => {
    const r = validateErpUrl("https://erp.provedor.com.br/#/dashboard");

    expect(r.valid).toBe(false);
    expect(r.reason).toContain("#");
    expect(r.reason).toContain("https://erp.provedor.com.br");
  });
});

describe("validateErpUrl — a allowlist abre excecao de rede, nao de formato", () => {
  it("host liberado com endereco de tela continua recusado", () => {
    process.env.ERP_URL_ALLOWLIST = "amplisinal.sgp.net.br";

    const r = validateErpUrl("https://amplisinal.sgp.net.br/accounts/login?next=/admin/");

    expect(r.valid).toBe(false);
    expect(r.reason).toContain("tela de acesso");
  });

  it("host liberado com endereco limpo passa, mesmo em rede interna", () => {
    process.env.ERP_URL_ALLOWLIST = "erp.interno";

    expect(validateErpUrl("http://erp.interno/api")).toEqual({ valid: true });
  });
});

describe("validateErpUrl — politica de rede preservada", () => {
  it("host privado sem liberacao e recusado", () => {
    const r = validateErpUrl("http://192.168.0.10/webservice/v1");

    expect(r.valid).toBe(false);
  });

  it("host privado com liberacao passa", () => {
    process.env.ERP_ALLOW_PRIVATE_NETWORK = "true";

    expect(validateErpUrl("http://192.168.0.10/webservice/v1")).toEqual({ valid: true });
  });

  it("protocolo que nao e web e recusado", () => {
    const r = validateErpUrl("httpx://erp.provedor.com.br");

    expect(r.valid).toBe(false);
    expect(r.reason).toContain("Protocolo");
  });

  it("texto que nao e endereco e recusado", () => {
    const r = validateErpUrl("nao e uma url");

    expect(r.valid).toBe(false);
    expect(r.reason).toContain("URL invalida");
  });
});

describe("isAllowedErpUrl", () => {
  it("acompanha o veredito de validateErpUrl", () => {
    expect(isAllowedErpUrl("https://ixc.ngtelecom.net.br")).toBe(true);
    expect(isAllowedErpUrl("https://amplisinal.sgp.net.br/accounts/login?next=/admin/")).toBe(false);
  });
});
