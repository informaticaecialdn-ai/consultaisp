import { describe, it, expect } from "vitest";
import {
  deveRecarregar,
  CHAVE_DE_RECARGA,
  JANELA_DE_TRAVA_MS,
} from "./pagina-do-deploy";

function armazemFalso(inicial?: string) {
  const dados = new Map<string, string>();
  if (inicial !== undefined) dados.set(CHAVE_DE_RECARGA, inicial);
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    ler: () => dados.get(CHAVE_DE_RECARGA) ?? null,
  };
}

describe("deveRecarregar", () => {
  it("recarrega na primeira falha", () => {
    const a = armazemFalso();
    expect(deveRecarregar(a, 1_000)).toBe(true);
    expect(a.ler()).toBe("1000");
  });

  it("NAO recarrega de novo dentro da janela — senao vira laco", () => {
    const a = armazemFalso();
    deveRecarregar(a, 1_000);
    expect(deveRecarregar(a, 1_000 + JANELA_DE_TRAVA_MS - 1)).toBe(false);
  });

  it("recarrega de novo passada a janela: outra falha e outro evento", () => {
    const a = armazemFalso();
    deveRecarregar(a, 1_000);
    expect(deveRecarregar(a, 1_000 + JANELA_DE_TRAVA_MS)).toBe(true);
  });

  it("marca ilegivel no armazem nao trava a recarga", () => {
    const a = armazemFalso("nao-e-numero");
    expect(deveRecarregar(a, 5_000)).toBe(true);
  });
});
