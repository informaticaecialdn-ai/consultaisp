import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const selo = readFileSync(new URL("./SeloConfissao.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const card = readFileSync(new URL("./CardCliente.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("SeloConfissao", () => {
  it("é o selo de título assinado; em sandbox diz TESTE e nunca 'título executivo'", () => {
    expect(selo).toContain("SELO_ASSINADA");
    expect(selo).toContain("SELO_SANDBOX");
    expect(selo).toMatch(/ambiente === "sandbox"/);
    expect(selo).toContain('tom={confissao.ambiente === "sandbox" ? "gated" : "ok"}');
  });
  it("some quando não há confissão assinada viva", () => {
    expect(selo).toContain("if (!confissao) return null;");
  });
  it("está no card do kanban e na linha da carteira", () => {
    expect(card).toContain('import { SeloConfissao } from "./SeloConfissao";');
    expect((card.match(/<SeloConfissao confissao=\{item\.confissao\}/g) ?? []).length).toBe(2);
  });
});
