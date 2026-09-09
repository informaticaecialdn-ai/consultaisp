import { describe, expect, it } from "vitest";
import { planejarPreAviso } from "./preventivo";
import { ETAPAS_PADRAO } from "./regua";

describe("pré-aviso por fatura", () => {
  const fatura = { id: 8, status: "aberta", vencimento: new Date("2026-09-15T00:00:00Z"), valor: 99.9 };
  it.each([["2026-09-08", -7], ["2026-09-12", -3], ["2026-09-14", -1]])("planeja %s", (dia, dias) => {
    expect(planejarPreAviso(6, fatura, dia)).toMatchObject({ faturaId: 8, diaContato: dia, diasAtraso: dias, chave: `6:8:${dia}` });
  });
  it("não lembra fora do toque, fatura paga ou etapa desligada", () => {
    expect(planejarPreAviso(6, fatura, "2026-09-09")).toBeNull();
    expect(planejarPreAviso(6, { ...fatura, status: "paid" }, "2026-09-08")).toBeNull();
    expect(planejarPreAviso(6, fatura, "2026-09-08", ETAPAS_PADRAO.map(e => ({ ...e, ativa: false })))).toBeNull();
  });
});
