import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { spcSimulado, cadastralSimulado } from "./bureaus-simulados";
import { consultarSpc } from "../services/spc/spc.service";
import { consultarCpf, type Credencial } from "../services/bigdata.service";

describe("bureaus simulados", () => {
  it("o mesmo documento devolve sempre o mesmo resultado", () => {
    expect(spcSimulado("99912345607")).toEqual(spcSimulado("99912345607"));
    expect(cadastralSimulado("99912345607")).toEqual(cadastralSimulado("99912345607"));
  });

  it("documentos diferentes produzem situacoes diferentes", () => {
    const varios = ["99900000019", "99911111150", "99922222291", "99933333332"].map(spcSimulado);
    expect(new Set(varios.map(r => r.restricao)).size).toBeGreaterThan(1);
    expect(new Set(varios.map(r => r.score)).size).toBeGreaterThan(1);
  });

  it("todo resultado vem marcado como simulado — a tela precisa poder avisar", () => {
    expect(spcSimulado("99912345607").simulado).toBe(true);
    expect(cadastralSimulado("99912345607").simulado).toBe(true);
  });

  it("score fica na faixa do produto (0 a 1000)", () => {
    for (let i = 0; i < 50; i++) {
      const r = spcSimulado(`999${String(i).padStart(8, "0")}`);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1000);
    }
  });

  describe("modo demo desvia as duas entradas reais antes de qualquer rede", () => {
    const original = process.env.DEMO_MODE;
    beforeEach(() => {
      process.env.DEMO_MODE = "true";
      vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
      if (original === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = original;
      vi.unstubAllGlobals();
    });

    it("consultarSpc nunca chama fetch em modo demo", async () => {
      const resultado = await consultarSpc("99912345607");
      expect(resultado.simulado).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("consultarCpf nunca chama fetch em modo demo", async () => {
      const cred: Credencial = { login: "x", password: "y" };
      const resultado = await consultarCpf(1, cred, "99912345607");
      expect(resultado.simulado).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
