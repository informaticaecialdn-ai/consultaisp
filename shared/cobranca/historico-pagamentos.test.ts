import { describe, expect, it } from "vitest";
import { resumirHistoricoDePagamentos } from "./historico-pagamentos";

describe("histórico de pagamentos confirmados", () => {
  it("baixa no ERP e paid sem data não inventam pontualidade", () => {
    const r = resumirHistoricoDePagamentos([
      { status: "baixada_no_erp", vencimento: new Date("2026-08-10Z"), pagoEm: new Date("2026-08-10Z") },
      { status: "paid", vencimento: new Date("2026-08-10Z"), pagoEm: null },
    ]);
    expect(r).toMatchObject({ historicoInsuficiente: true, faturasPagas: 0, taxaAtraso: null });
  });
  it("mede apenas recebimentos com data e compara dias civis", () => {
    const r = resumirHistoricoDePagamentos([
      { status: "paid", vencimento: new Date("2026-08-10T00:00:00Z"), pagoEm: new Date("2026-08-10T20:00:00Z") },
      { status: "paid", vencimento: new Date("2026-07-10Z"), pagoEm: new Date("2026-07-11Z") },
      { status: "aberta", vencimento: new Date("2026-06-10Z"), pagoEm: null },
    ]);
    expect(r).toMatchObject({ historicoInsuficiente: false, faturasPagas: 2, faturasPagasComAtraso: 1, taxaAtraso: 0.5 });
  });
});
