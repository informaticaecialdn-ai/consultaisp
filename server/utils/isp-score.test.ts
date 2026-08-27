import { describe, expect, it } from "vitest";
import { calcularScoreISP } from "./isp-score";

const occurrence = (equipamentosDevolvidos?: boolean) => ({
  diasAtraso: 1,
  faturasAtraso: 0,
  statusContrato: "cancelado",
  mesesComoCliente: 12,
  equipamentosDevolvidos,
});

describe("score ISP e equipamento", () => {
  it("nao concede bonus quando a devolucao e desconhecida", () => {
    const unknown = calcularScoreISP({
      rede: { ocorrencias: [occurrence(undefined)], totalProvedores: 1, consultasRecentes30d: 0, consultasRecentes90d: 0 },
    });
    const confirmed = calcularScoreISP({
      rede: { ocorrencias: [occurrence(true)], totalProvedores: 1, consultasRecentes30d: 0, consultasRecentes90d: 0 },
    });
    expect(confirmed.fatores.f1_historicoPagamento.pontos - unknown.fatores.f1_historicoPagamento.pontos).toBe(15);
  });

  it("reduz o score e exige revisao quando existe ocorrencia validada", () => {
    const result = calcularScoreISP({
      rede: { ocorrencias: [occurrence(false)], totalProvedores: 1, consultasRecentes30d: 0, consultasRecentes90d: 0 },
    });
    expect(result.alertas).toContain("Equipamentos nao devolvidos registrados na rede");
    expect(result.condicoesSugeridas).toContain("Revisar a ocorrencia validada de equipamento antes de fornecer novo comodato");
    expect(result.sugestaoIA).not.toBe("APROVAR");
  });
});
