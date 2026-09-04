/**
 * O preenchimento da ficha pelo CNPJ, na parte que da para provar sem React.
 *
 * O caso que motivou tudo: a ficha da Amplisinal estava com "helio cainelli" na
 * razao social — o nome do socio no campo da empresa — e o resto vazio. Medido
 * em producao em 04/09/2026, o que a Receita devolve para aquele CNPJ:
 *
 *   razao social  AMPLISINAL PROVEDOR TELECOM LTDA
 *   natureza      "206-2 - Sociedade Empresária Limitada"   (ReceitaWS)
 *                 "Sociedade Empresária Limitada"           (BrasilAPI)
 *
 * O servidor tira o codigo do IBGE; sobra a natureza por extenso, escrita de um
 * jeito diferente em cada fonte. `tipoSocietario` e quem transforma isso numa
 * das sete opcoes do `<select>` — e um mapa de igualdade exata, que era o que
 * havia antes, acerta uma fonte e erra as outras duas em silencio.
 */
import { describe, it, expect } from "vitest";
import { tipoSocietario } from "./painel-provedor";

describe("tipoSocietario", () => {
  it("reconhece a natureza da Amplisinal, com e sem acento", () => {
    expect(tipoSocietario("Sociedade Empresária Limitada")).toBe("LTDA");
    expect(tipoSocietario("Sociedade Empresaria Limitada")).toBe("LTDA");
  });

  it("nao depende de caixa nem de espaco em volta", () => {
    expect(tipoSocietario("  SOCIEDADE LIMITADA  ")).toBe("LTDA");
  });

  it("MEI vem antes de EIRELI, e EIRELI antes de LTDA", () => {
    // As tres compartilham palavras. Sem a ordem, "limitada" captura as tres e
    // um MEI vira LTDA na ficha — e o tipo societario sai na nota fiscal.
    expect(tipoSocietario("Empresário Individual")).toBe("MEI");
    expect(tipoSocietario("Microempresário Individual (MEI)")).toBe("MEI");
    expect(tipoSocietario("Empresa Individual de Responsabilidade Limitada (EIRELI)")).toBe("EIRELI");
    expect(tipoSocietario("EIRELI")).toBe("EIRELI");
  });

  it("reconhece sociedade anonima nas duas formas", () => {
    expect(tipoSocietario("Sociedade Anônima Aberta")).toBe("S/A");
    expect(tipoSocietario("Sociedade Anonima Fechada")).toBe("S/A");
  });

  it("devolve vazio — e nao 'Outro' — quando nao reconhece", () => {
    // Chute errado no tipo societario e pior que campo vazio: ele sai impresso.
    expect(tipoSocietario("Cooperativa")).toBe("");
    expect(tipoSocietario("Associação Privada")).toBe("");
    expect(tipoSocietario("")).toBe("");
    expect(tipoSocietario(null)).toBe("");
    expect(tipoSocietario(undefined)).toBe("");
  });

  it("tudo que ele devolve existe no select", () => {
    // Um valor fora da lista deixa o `<select>` sem opcao correspondente e o
    // campo volta para "Selecione..." sozinho, sem erro nenhum.
    const OPCOES = ["MEI", "ME", "EPP", "LTDA", "S/A", "EIRELI", "Outro"];
    const naturezas = [
      "Sociedade Empresária Limitada",
      "Empresário Individual",
      "Microempresário Individual (MEI)",
      "Empresa Individual de Responsabilidade Limitada (EIRELI)",
      "Sociedade Anônima Aberta",
      "Cooperativa",
    ];
    for (const n of naturezas) {
      const t = tipoSocietario(n);
      if (t) expect(OPCOES).toContain(t);
    }
  });
});
