/**
 * O selo do ambiente da tela de NFS-e. Na demonstração o servidor responde
 * `environment: "demonstracao"` (nfse.routes.ts) e a nota é simulada; antes, a
 * tela só conhecia "producao" e mostrava HOMOLOGACAO para todo o resto — a
 * nota de mentira parecia homologação real da Focus. Fora da demonstração os
 * dois rótulos de sempre continuam iguais.
 */
import { describe, expect, it } from "vitest";
import { seloDoAmbienteNfse } from "./nfse";

describe("seloDoAmbienteNfse", () => {
  it("demonstracao: rotulo proprio e aviso de nota simulada", () => {
    expect(seloDoAmbienteNfse("demonstracao")).toEqual({ rotulo: "DEMONSTRACAO", simulado: true });
  });

  it("fora da demonstracao nada muda: producao e homologacao, sem aviso", () => {
    expect(seloDoAmbienteNfse("producao")).toEqual({ rotulo: "PRODUCAO", simulado: false });
    expect(seloDoAmbienteNfse("homologacao")).toEqual({ rotulo: "HOMOLOGACAO", simulado: false });
    expect(seloDoAmbienteNfse(undefined)).toEqual({ rotulo: "HOMOLOGACAO", simulado: false });
  });
});
