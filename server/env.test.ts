/**
 * O aviso de LGPD no boot.
 *
 * A politica publica /lgpd nomeia o CONTROLADOR perante o titular — e um
 * documento com efeito juridico. Sem LGPD_CNPJ ela publica o placeholder
 * "00.000.000/0000-00", que nao identifica ninguem, e a falha e silenciosa: a
 * rota responde 200 e a pagina parece pronta. Este aviso e o unico sinal.
 *
 * O outro lado do teste importa igual: ele NUNCA pode derrubar o processo. Um
 * campo de texto faltando nao vale o bureau inteiro fora do ar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const warn = vi.fn();
vi.mock("./logger", () => ({
  logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn(), fatal: vi.fn(), debug: vi.fn() },
}));

import { avisarLgpdSemIdentificacao } from "./env";

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
