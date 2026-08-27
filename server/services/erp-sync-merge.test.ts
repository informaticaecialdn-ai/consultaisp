/**
 * O sync so gravava divida de cliente CANCELADO.
 *
 * Medido no IXC da O L I em 27/08/2026: 6.038 pessoas com divida gravada
 * enquanto a base deles tinha 42.883 faturas em aberto e 13.561 contratos
 * ativos. Cliente ativo inadimplente — o dado central de um bureau — nunca era
 * atualizado.
 */
import { describe, it, expect } from "vitest";
import { mesclarInadimplentes } from "./erp-sync.service";

const c = (cpfCnpj: string, extra: Record<string, unknown> = {}) => ({ cpfCnpj, ...extra } as any);

describe("mesclarInadimplentes", () => {
  it("soma as duas listas", () => {
    const r = mesclarInadimplentes([c("111")], [c("222")]);
    expect(r.customers).toHaveLength(2);
    expect(r.somenteAtivos).toBe(1);
  });

  it("cancelado tem prioridade quando o CPF esta nos dois", () => {
    const r = mesclarInadimplentes(
      [c("111", { contractStatus: "cancelled", totalOverdueAmount: 500 })],
      [c("111", { contractStatus: undefined, totalOverdueAmount: 300 })],
    );
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0].contractStatus).toBe("cancelled");
    expect(r.customers[0].totalOverdueAmount).toBe(500);
    // Estava nas duas: nao conta como "so ativo".
    expect(r.somenteAtivos).toBe(0);
  });

  it("dedup ignora pontuacao — o mesmo CPF escrito de dois jeitos e um so", () => {
    const r = mesclarInadimplentes([c("123.456.789-01")], [c("12345678901")]);
    expect(r.customers).toHaveLength(1);
    expect(r.somenteAtivos).toBe(0);
  });

  it("descarta documento vazio ou so com pontuacao", () => {
    const r = mesclarInadimplentes([c(""), c("---")], [c("111"), c("")]);
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0].cpfCnpj).toBe("111");
  });

  it("uma fonte vazia nao apaga a outra", () => {
    expect(mesclarInadimplentes([], [c("111"), c("222")]).customers).toHaveLength(2);
    expect(mesclarInadimplentes([c("111")], []).customers).toHaveLength(1);
    expect(mesclarInadimplentes([], []).customers).toHaveLength(0);
  });

  it("duplicata DENTRO da mesma lista tambem colapsa", () => {
    const r = mesclarInadimplentes([], [c("111"), c("111"), c("222")]);
    expect(r.customers).toHaveLength(2);
  });

  it("o caso da O L I: cancelados menores que o total, ativos entram por cima", () => {
    const cancelados = Array.from({ length: 6038 }, (_, i) => c(String(1_000_000 + i)));
    // 922 ativos em atraso, dos quais 100 tambem estao cancelados
    const ativos = [
      ...cancelados.slice(0, 100),
      ...Array.from({ length: 822 }, (_, i) => c(String(9_000_000 + i))),
    ];
    const r = mesclarInadimplentes(cancelados, ativos);
    expect(r.customers).toHaveLength(6038 + 822);
    expect(r.somenteAtivos).toBe(822);
  });
});
