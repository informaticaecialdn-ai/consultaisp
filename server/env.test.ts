/**
 * As duas guardas de ambiente que a fase 0 acrescentou, no mesmo arquivo
 * porque as duas nascem em `validateEnv` — uma derruba o boot, a outra só
 * avisa, e a diferença entre elas é o ponto:
 *
 * - `verificarWebhookAsaas`: sem o token, o webhook do Asaas aceita qualquer
 *   POST e um pedido inventado libera crédito. Em produção o processo não sobe.
 * - `avisarLgpdSemIdentificacao`: a política pública /lgpd nomeia o CONTROLADOR
 *   perante o titular. Sem LGPD_CNPJ ela publica "00.000.000/0000-00", que não
 *   identifica ninguém, e a falha é silenciosa: a rota responde 200 e a página
 *   parece pronta. Este aviso é o único sinal — e nunca pode derrubar o
 *   processo, porque um campo de texto não vale o bureau inteiro fora do ar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const warn = vi.fn();
vi.mock("./logger", () => ({
  logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn(), fatal: vi.fn(), debug: vi.fn() },
}));

import { avisarLgpdSemIdentificacao, verificarWebhookAsaas } from "./env";

const ambiente = { ...process.env };

beforeEach(() => {
  warn.mockReset();
  process.env.NODE_ENV = "production";
  delete process.env.LGPD_CNPJ;
  delete process.env.LGPD_EMPRESA;
});

afterEach(() => {
  process.env = { ...ambiente };
});

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

/** Os campos que o aviso reclamou, na ordem em que vieram. */
function reclamou(): string[] {
  return (warn.mock.calls[0]?.[0] as { faltando: string[] } | undefined)?.faltando ?? [];
}

describe("avisarLgpdSemIdentificacao", () => {
  it("reclama dos dois campos quando nenhum esta definido", () => {
    avisarLgpdSemIdentificacao();
    expect(reclamou()).toEqual(["LGPD_CNPJ", "LGPD_EMPRESA"]);
  });

  it("o placeholder conta como ausente — e ele que a pagina publicaria", () => {
    process.env.LGPD_CNPJ = "00.000.000/0000-00";
    process.env.LGPD_EMPRESA = "Consulta ISP Tecnologia Ltda";
    avisarLgpdSemIdentificacao();
    expect(reclamou()).toEqual(["LGPD_CNPJ"]);
  });

  it("cala quando os dois valores sao reais", () => {
    process.env.LGPD_CNPJ = "12.345.678/0001-95";
    process.env.LGPD_EMPRESA = "Consulta ISP Tecnologia Ltda";
    avisarLgpdSemIdentificacao();
    expect(warn).not.toHaveBeenCalled();
  });

  it("so vale em producao: em desenvolvimento ninguem publica nada", () => {
    process.env.NODE_ENV = "development";
    avisarLgpdSemIdentificacao();
    expect(warn).not.toHaveBeenCalled();
  });

  it("e aviso, nunca falha — o boot segue", () => {
    const sair = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    expect(() => avisarLgpdSemIdentificacao()).not.toThrow();
    expect(sair).not.toHaveBeenCalled();
    sair.mockRestore();
  });
});
