import { describe, expect, it } from "vitest";
import { verificarWebhookAsaas } from "./env";

describe("verificarWebhookAsaas", () => {
  it("em producao, sem token o processo tem que cair", () => {
    const r = verificarWebhookAsaas(undefined, "production");
    expect(r.nivel).toBe("fatal");
    expect(r.mensagem).toContain("ASAAS_WEBHOOK_TOKEN");
    // A mensagem e para quem opera a VPS as duas da manha; tem que dizer o que fazer.
    expect(r.mensagem).toContain(".env");
  });

  it("token so de espaco em branco conta como ausente", () => {
    expect(verificarWebhookAsaas("   ", "production").nivel).toBe("fatal");
  });

  it("com token configurado, sobe calado", () => {
    expect(verificarWebhookAsaas("segredo-do-painel", "production")).toEqual({ nivel: "ok", mensagem: "" });
  });

  it("fora de producao vira aviso: quem roda local nao tem o token", () => {
    const r = verificarWebhookAsaas("", "development");
    expect(r.nivel).toBe("aviso");
    expect(r.mensagem).toContain("sem protecao");
  });

  it("NODE_ENV nao definido tambem e aviso, nao fatal", () => {
    expect(verificarWebhookAsaas(undefined, undefined).nivel).toBe("aviso");
  });
});
