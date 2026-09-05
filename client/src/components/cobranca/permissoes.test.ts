import { describe, it, expect } from "vitest";
import { podeAdministrarCobranca } from "./permissoes";

describe("podeAdministrarCobranca", () => {
  it("admin do provedor configura; operador só trabalha a fila", () => {
    expect(podeAdministrarCobranca({ role: "admin" })).toBe(true);
    expect(podeAdministrarCobranca({ role: "user" })).toBe(false);
  });
  /** A mesma regra do Painel do Provedor: superadmin dentro da janela de suporte conta como admin. */
  it("superadmin só dentro da sessão de suporte", () => {
    expect(podeAdministrarCobranca({ role: "superadmin" }, true)).toBe(true);
    expect(podeAdministrarCobranca({ role: "superadmin" }, false)).toBe(false);
  });
  it("sem sessão, nada", () => {
    expect(podeAdministrarCobranca(null)).toBe(false);
    expect(podeAdministrarCobranca({ role: "revendedor" })).toBe(false);
  });
});
