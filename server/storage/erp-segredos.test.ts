/**
 * Campo de segredo vazio nao pode apagar credencial que funciona.
 *
 * Caso real (27/08/2026): a contra-senha do MK estava guardada em `api_user`,
 * entao o campo "Contra-Senha Webservice" da tela renderizava vazio. Um clique
 * em Salvar mandaria string vazia e zeraria a credencial — e a falha so
 * apareceria no sync seguinte, horas depois.
 */
import { describe, it, expect } from "vitest";
import { ErpStorage } from "./erp.storage";

const preservar = (data: any, atual: any) =>
  (ErpStorage.prototype as any).preservarSegredosVazios.call(null, data, atual);

const ATUAL = {
  apiToken: "token-valido", apiUser: "usuario-valido",
  mkContraSenha: "senha-valida", clientSecret: "segredo-valido",
} as any;

describe("preservarSegredosVazios", () => {
  it("string vazia nao apaga o segredo guardado", () => {
    const r = preservar({ apiToken: "", mkContraSenha: "" }, ATUAL);
    expect("apiToken" in r).toBe(false);
    expect("mkContraSenha" in r).toBe(false);
  });

  it("null tambem nao apaga", () => {
    const r = preservar({ clientSecret: null }, ATUAL);
    expect("clientSecret" in r).toBe(false);
  });

  it("valor novo SUBSTITUI — trocar credencial tem que funcionar", () => {
    const r = preservar({ apiToken: "token-novo" }, ATUAL);
    expect(r.apiToken).toBe("token-novo");
  });

  it("campo nao-segredo passa vazio normalmente", () => {
    const r = preservar({ notes: "", apiUrl: "" }, ATUAL);
    expect(r.notes).toBe("");
    expect(r.apiUrl).toBe("");
  });

  it("se nao havia segredo antes, vazio passa (nao ha o que preservar)", () => {
    const r = preservar({ mkContraSenha: "" }, { ...ATUAL, mkContraSenha: null });
    expect(r.mkContraSenha).toBe("");
  });

  it("nao mexe no objeto original", () => {
    const entrada = { apiToken: "" };
    preservar(entrada, ATUAL);
    expect(entrada.apiToken).toBe("");
  });
});
