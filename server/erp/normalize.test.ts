import { describe, expect, it } from "vitest";
import { aggregateByCustomer } from "./normalize";

/**
 * `aggregateByCustomer` junta as faturas em aberto de um mesmo documento num
 * cliente só. Era um ponto de perda silencioso: vários conectores extraem a
 * coordenada da instalação por linha, e a agregação a descartava no caminho —
 * o cliente chegava ao banco sem ponto e o mapa mandava geocodificar de novo
 * um endereço que o ERP já sabia localizar.
 */

const fatura = (over: Partial<Parameters<typeof aggregateByCustomer>[0][number]> = {}) => ({
  cpfCnpj: "12345678901",
  name: "Cliente Teste",
  amount: 100,
  daysOverdue: 30,
  erpSource: "mk",
  ...over,
});

describe("coordenada atravessa a agregação", () => {
  it("chega ao cliente quando vem na fatura", () => {
    const [c] = aggregateByCustomer([fatura({ latitude: "-23.3103", longitude: "-51.1628" })]);
    expect(c.latitude).toBe("-23.3103");
    expect(c.longitude).toBe("-51.1628");
  });

  it("a primeira fatura que tiver coordenada define o ponto", () => {
    const [c] = aggregateByCustomer([
      fatura({ amount: 100 }),
      fatura({ amount: 50, latitude: "-23.3103", longitude: "-51.1628" }),
      fatura({ amount: 25, latitude: "-99", longitude: "-99" }),
    ]);
    expect(c.latitude).toBe("-23.3103");
    expect(c.totalOverdueAmount).toBe(175);
    expect(c.overdueInvoicesCount).toBe(3);
  });

  it("sem coordenada em nenhuma fatura, o cliente sai sem ponto — e não com lixo", () => {
    const [c] = aggregateByCustomer([fatura(), fatura({ amount: 20 })]);
    expect(c.latitude).toBeUndefined();
    expect(c.longitude).toBeUndefined();
  });

  it("latitude sem longitude não vira meia coordenada", () => {
    const [c] = aggregateByCustomer([
      fatura(),
      fatura({ amount: 10, latitude: "-23.3103" }),
    ]);
    expect(c.latitude).toBeUndefined();
  });

  it("clientes diferentes não trocam de coordenada", () => {
    const cs = aggregateByCustomer([
      fatura({ cpfCnpj: "111", latitude: "-23.31", longitude: "-51.16" }),
      fatura({ cpfCnpj: "222" }),
    ]);
    expect(cs.find(c => c.cpfCnpj === "111")?.latitude).toBe("-23.31");
    expect(cs.find(c => c.cpfCnpj === "222")?.latitude).toBeUndefined();
  });
});
