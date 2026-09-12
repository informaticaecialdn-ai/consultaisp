import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { emModoDemo } from "./modo-demo";

describe("modo demo", () => {
  const original = process.env.DEMO_MODE;
  beforeEach(() => { delete process.env.DEMO_MODE; });
  afterEach(() => { if (original === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = original; });

  it("desligado por padrao — producao nunca vira demo por engano", () => {
    expect(emModoDemo()).toBe(false);
  });

  it("so 'true' liga; qualquer outro valor e ignorado", () => {
    for (const valor of ["1", "sim", "TRUE", "", "false"]) {
      process.env.DEMO_MODE = valor;
      expect(emModoDemo(), valor).toBe(false);
    }
    process.env.DEMO_MODE = "true";
    expect(emModoDemo()).toBe(true);
  });
});
