/**
 * O log de resposta gravou credencial de producao em texto puro.
 *
 * Em 27/08/2026, no servidor: `PATCH /api/provider/erp-integrations/mk` devolve
 * a integracao ja decifrada, e a linha do log saiu com o token e a contra-senha
 * reais de um provedor. Os testes abaixo travam os dois casos que produziram
 * isso — segredo no primeiro nivel e segredo dentro de array.
 */
import { describe, it, expect } from "vitest";
import { sanitizeForLog } from "./sanitize-log";

describe("sanitizeForLog", () => {
  it("censura a credencial do ERP que vazou em producao", () => {
    const r = sanitizeForLog({
      id: 8, providerId: 1, erpSource: "mk", isEnabled: true,
      apiUrl: "http://exemplo:8080/mk",
      apiToken: "token-real-do-provedor",
      apiUser: "contra-senha-real",
      mkContraSenha: "segredo", clientSecret: "outro",
    });
    expect(r.apiToken).toBe("[REDACTED]");
    expect(r.apiUser).toBe("[REDACTED]");
    expect(r.mkContraSenha).toBe("[REDACTED]");
    expect(r.clientSecret).toBe("[REDACTED]");
    // O que nao e segredo continua legivel — senao o log perde a utilidade.
    expect(r.erpSource).toBe("mk");
    expect(r.providerId).toBe(1);
    expect(r.isEnabled).toBe(true);
  });

  it("censura o webhookToken que o login devolvia inteiro", () => {
    const r = sanitizeForLog({ user: { name: "Fulano" }, provider: { webhookToken: "5fed09c6b1" } });
    expect(r.provider.webhookToken).toBe("[REDACTED]");
  });

  it("entra em ARRAY — era o furo: rota de listagem devolve lista", () => {
    const r = sanitizeForLog([
      { erpSource: "mk", apiToken: "abc" },
      { erpSource: "ixc", apiToken: "def" },
    ]);
    expect(r[0].apiToken).toBe("[REDACTED]");
    expect(r[1].apiToken).toBe("[REDACTED]");
    expect(r[1].erpSource).toBe("ixc");
  });

  it("entra em array ANINHADO dentro de objeto", () => {
    const r = sanitizeForLog({ integracoes: [{ apiToken: "x", nome: "MK" }] });
    expect(r.integracoes[0].apiToken).toBe("[REDACTED]");
  });

  it("nao quebra com null, numero e string", () => {
    expect(sanitizeForLog(null)).toBeNull();
    expect(sanitizeForLog(42)).toBe(42);
    expect(sanitizeForLog("texto")).toBe("texto");
    expect(sanitizeForLog({ a: null, b: 0, c: "" })).toEqual({ a: null, b: 0, c: "" });
  });

  it("mantem a censura de dado pessoal que ja existia", () => {
    const r = sanitizeForLog({ cpfCnpj: "12345678901", email: "a@b.c", nome: "Fulano" });
    expect(r.cpfCnpj).toBe("[REDACTED]");
    expect(r.email).toBe("[REDACTED]");
    expect(r.nome).toBe("[REDACTED]");
  });
});
