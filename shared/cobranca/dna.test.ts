/**
 * O DNA 3×3 com os limiares do Provedor.ai, um caso por fronteira: 11/12 e
 * 36/37 meses, 30/31 e 90/91 dias, 2/3 faturas abertas, e a taxa histórica
 * que a fase 1 NÃO tem.
 */
import { describe, expect, it } from "vitest";
import {
  ABORDAGEM_POR_QUADRANTE,
  ABORDAGENS,
  DIRETIVA_POR_ABORDAGEM,
  DIRETIVA_POR_TOM,
  DIRETIVA_VULNERAVEL,
  FRASE_EXEMPLO_POR_QUADRANTE,
  GRADE_DNA,
  QUADRANTES,
  ROTULO_CONFIABILIDADE,
  ROTULO_FIDELIDADE,
  ROTULO_TOM,
  TOM_VULNERAVEL,
  TONS,
  classificarConfiabilidade,
  classificarDna,
  classificarFidelidade,
  eixosDoQuadrante,
  familiaDoQuadrante,
  mesesDeContrato,
  quadranteDe,
  tomEfetivo,
  type EntradaDna,
} from "./dna";

/** Entrada da fase 1: só o que o sync grava em `customers`. */
function fase1(parcial: Partial<EntradaDna> = {}): EntradaDna {
  return { mesesComoCliente: 0, diasAtrasoMax: 0, faturasAbertas: 0, historicoInsuficiente: true, ...parcial };
}

describe("classificarFidelidade — meses completos de contrato", () => {
  it("até 11 meses é novo; 12 vira médio", () => {
    expect(classificarFidelidade(0)).toBe("novo");
    expect(classificarFidelidade(11)).toBe("novo");
    expect(classificarFidelidade(12)).toBe("medio");
  });

  it("36 ainda é médio; 37 vira fiel", () => {
    expect(classificarFidelidade(36)).toBe("medio");
    expect(classificarFidelidade(37)).toBe("fiel");
    expect(classificarFidelidade(120)).toBe("fiel");
  });
});

describe("classificarConfiabilidade — fase 1, sem histórico de faturas pagas", () => {
  it("sem atraso é em dia", () => {
    expect(classificarConfiabilidade(fase1())).toBe("em_dia");
  });

  it("30 dias de atraso ainda é em dia; 31 oscila", () => {
    expect(classificarConfiabilidade(fase1({ diasAtrasoMax: 30, faturasAbertas: 1 }))).toBe("em_dia");
    expect(classificarConfiabilidade(fase1({ diasAtrasoMax: 31, faturasAbertas: 1 }))).toBe("oscila");
  });

  it("90 dias oscila; 91 é crônico", () => {
    expect(classificarConfiabilidade(fase1({ diasAtrasoMax: 90, faturasAbertas: 2 }))).toBe("oscila");
    expect(classificarConfiabilidade(fase1({ diasAtrasoMax: 91, faturasAbertas: 2 }))).toBe("cronico");
  });

  it("3 faturas abertas é crônico mesmo com atraso curto; 2 não", () => {
    // A dívida ATUAL basta: o ERP que só expõe faturas abertas já diz o suficiente.
    expect(classificarConfiabilidade(fase1({ diasAtrasoMax: 5, faturasAbertas: 3 }))).toBe("cronico");
    expect(classificarConfiabilidade(fase1({ diasAtrasoMax: 5, faturasAbertas: 2 }))).toBe("em_dia");
  });

  it("sem histórico, a taxa de atraso é ignorada mesmo que os campos venham preenchidos", () => {
    // Limitação documentada da fase 1: historicoInsuficiente manda.
    const entrada = fase1({ historicoInsuficiente: true, faturasPagas: 10, faturasPagasComAtraso: 10 });
    expect(classificarConfiabilidade(entrada)).toBe("em_dia");
  });
});

describe("classificarConfiabilidade — fase 2, com faturas pagas", () => {
  const comHistorico = (comAtraso: number, extra: Partial<EntradaDna> = {}): EntradaDna =>
    fase1({ historicoInsuficiente: false, faturasPagas: 10, faturasPagasComAtraso: comAtraso, ...extra });

  it("taxa até 10% é em dia; entre 10% e 40% oscila; acima de 40% é crônico", () => {
    expect(classificarConfiabilidade(comHistorico(1))).toBe("em_dia");
    expect(classificarConfiabilidade(comHistorico(2))).toBe("oscila");
    expect(classificarConfiabilidade(comHistorico(4))).toBe("oscila");
    expect(classificarConfiabilidade(comHistorico(5))).toBe("cronico");
  });

  it("taxa baixa não salva quem está com 31 dias de atraso hoje", () => {
    expect(classificarConfiabilidade(comHistorico(0, { diasAtrasoMax: 31 }))).toBe("oscila");
  });

  it("zero faturas pagas conta como sem histórico, ainda que o chamador diga o contrário", () => {
    const entrada = fase1({ historicoInsuficiente: false, faturasPagas: 0, faturasPagasComAtraso: 0 });
    expect(classificarConfiabilidade(entrada)).toBe("em_dia");
    expect(classificarDna(entrada).historicoInsuficiente).toBe(true);
  });
});

describe("quadrante e abordagem", () => {
  it("a grade 3×3 é a do Provedor.ai, literal", () => {
    expect(ABORDAGEM_POR_QUADRANTE).toEqual({
      A1: "boas_vindas",
      A2: "parceiro",
      A3: "acolhedor",
      B1: "orientador",
      B2: "firme_gentil",
      B3: "cuidado",
      C1: "firme_objetivo",
      C2: "recuperacao",
      C3: "negociar_reter",
    });
  });

  it("quadranteDe e eixosDoQuadrante são inversos para os nove quadrantes", () => {
    for (const q of QUADRANTES) {
      const { fidelidade, confiabilidade } = eixosDoQuadrante(q);
      expect(quadranteDe(fidelidade, confiabilidade)).toBe(q);
    }
    expect(quadranteDe("novo", "em_dia")).toBe("A1");
    expect(quadranteDe("fiel", "cronico")).toBe("C3");
  });

  it("classificarDna junta os dois eixos", () => {
    const dna = classificarDna(fase1({ mesesComoCliente: 40, diasAtrasoMax: 100, faturasAbertas: 1 }));
    expect(dna).toEqual({
      fidelidade: "fiel",
      confiabilidade: "cronico",
      quadrante: "C3",
      abordagem: "negociar_reter",
      historicoInsuficiente: true,
    });
    expect(classificarDna(fase1({ mesesComoCliente: 3 })).quadrante).toBe("A1");
    expect(classificarDna(fase1({ mesesComoCliente: 20, diasAtrasoMax: 45, faturasAbertas: 2 })).quadrante).toBe("B2");
  });

  it("a grade da tela cobre os nove quadrantes, uma linha por confiabilidade", () => {
    expect(GRADE_DNA.map(l => l.confiabilidade)).toEqual(["em_dia", "oscila", "cronico"]);
    expect(GRADE_DNA.flatMap(l => l.quadrantes)).toEqual([...QUADRANTES]);
  });

  it("família de cor: A ok, B gated, C past", () => {
    expect(familiaDoQuadrante("A2")).toBe("ok");
    expect(familiaDoQuadrante("B3")).toBe("gated");
    expect(familiaDoQuadrante("C1")).toBe("past");
  });
});

describe("tomEfetivo — vulnerável sobrepõe", () => {
  it("cliente comum recebe a abordagem do quadrante", () => {
    expect(tomEfetivo({ abordagem: "firme_objetivo" }, false)).toBe("firme_objetivo");
  });

  it("vulnerável recebe o tom humanizado, seja qual for o quadrante", () => {
    expect(tomEfetivo({ abordagem: "firme_objetivo" }, true)).toBe(TOM_VULNERAVEL);
    expect(tomEfetivo({ abordagem: "boas_vindas" }, true)).toBe(TOM_VULNERAVEL);
  });

  it("sem DNA (sem data de contrato) não há tom — a não ser que seja vulnerável", () => {
    expect(tomEfetivo(null, false)).toBeNull();
    expect(tomEfetivo(null, true)).toBe(TOM_VULNERAVEL);
  });
});

describe("mesesDeContrato — meses completos, sem passar por new Date(string)", () => {
  const hoje = new Date(2026, 0, 15); // 15/01/2026, hora local

  it("conta só meses completos: um dia antes do aniversário ainda não fechou o mês", () => {
    expect(mesesDeContrato("2024-01-15", hoje)).toBe(24);
    expect(mesesDeContrato("2024-01-16", hoje)).toBe(23);
    expect(mesesDeContrato("2025-12-15", hoje)).toBe(1);
    expect(mesesDeContrato("2025-12-16", hoje)).toBe(0);
  });

  it("dia 1 continua dia 1 em qualquer fuso", () => {
    // `new Date("2026-01-01")` é UTC e vira 31/12 no Brasil; a leitura manual não.
    expect(mesesDeContrato("2026-01-01", new Date(2026, 1, 1))).toBe(1);
  });

  it("aceita Date e string com hora", () => {
    expect(mesesDeContrato(new Date(2024, 6, 1), hoje)).toBe(18);
    expect(mesesDeContrato("2024-07-01T00:00:00.000Z", hoje)).toBe(18);
  });

  it("sem data não há DNA: null, nunca zero", () => {
    expect(mesesDeContrato(null, hoje)).toBeNull();
    expect(mesesDeContrato(undefined, hoje)).toBeNull();
    expect(mesesDeContrato("", hoje)).toBeNull();
    expect(mesesDeContrato("01/06/2024", hoje)).toBeNull();
    expect(mesesDeContrato("2024-13-01", hoje)).toBeNull();
    expect(mesesDeContrato(new Date("nada"), hoje)).toBeNull();
  });

  it("contrato com data no futuro conta zero, não negativo", () => {
    expect(mesesDeContrato("2027-01-01", hoje)).toBe(0);
  });
});

describe("textos para o funcionário", () => {
  it("toda abordagem tem diretiva e todo tom tem rótulo e diretiva", () => {
    for (const a of ABORDAGENS) expect(DIRETIVA_POR_ABORDAGEM[a].length).toBeGreaterThan(40);
    for (const t of TONS) {
      expect(ROTULO_TOM[t].length).toBeGreaterThan(0);
      expect(DIRETIVA_POR_TOM[t].length).toBeGreaterThan(40);
    }
    expect(DIRETIVA_POR_TOM[TOM_VULNERAVEL]).toBe(DIRETIVA_VULNERAVEL);
  });

  it("todo quadrante tem frase de exemplo e os eixos têm rótulo", () => {
    for (const q of QUADRANTES) expect(FRASE_EXEMPLO_POR_QUADRANTE[q].length).toBeGreaterThan(20);
    expect(ROTULO_FIDELIDADE).toEqual({ novo: "Novo", medio: "Médio", fiel: "Fiel" });
    expect(ROTULO_CONFIABILIDADE).toEqual({ em_dia: "Em dia", oscila: "Oscila", cronico: "Crônico" });
  });

  it("a diretiva do vulnerável proíbe ameaça — é o que a Lei 14.181 exige", () => {
    expect(DIRETIVA_VULNERAVEL).toMatch(/sem ameaça/i);
    expect(DIRETIVA_VULNERAVEL).toMatch(/14\.181/);
  });
});
