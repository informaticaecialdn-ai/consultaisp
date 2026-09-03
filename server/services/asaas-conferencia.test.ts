import { beforeEach, describe, expect, it, vi } from "vitest";

// O modulo real fala com a API do Asaas; aqui interessa a decisao que ele toma
// a partir do que a API respondeu.
const asaasMock = vi.hoisted(() => ({
  getCharge: vi.fn(),
  isAsaasConfigured: vi.fn(() => true),
  asaasStatusToLocal: vi.fn((s: string) => (s === "RECEIVED" || s === "CONFIRMED" ? "paid" : "pending")),
}));
vi.mock("./asaas", () => asaasMock);

import { anotarRecusa, conferirPagamento } from "./asaas-conferencia";

const cobrancaBoa = {
  id: "pay_1",
  externalReference: "credit_order_7",
  status: "RECEIVED",
  value: 100,
};

beforeEach(() => {
  vi.clearAllMocks();
  asaasMock.isAsaasConfigured.mockReturnValue(true);
  asaasMock.asaasStatusToLocal.mockImplementation((s: string) => (s === "RECEIVED" || s === "CONFIRMED" ? "paid" : "pending"));
  asaasMock.getCharge.mockResolvedValue(cobrancaBoa);
});

describe("conferirPagamento", () => {
  const pedido = { referencia: "credit_order_7", valorEsperado: 100, chargeIdGravado: "pay_1" };

  it("aprova quando o Asaas confirma a cobranca deste pedido pelo valor devido", async () => {
    const r = await conferirPagamento({ id: "pay_1", value: 100 }, pedido);
    expect(r).toEqual({ ok: true, valorPago: 100, chargeId: "pay_1" });
    expect(asaasMock.getCharge).toHaveBeenCalledWith("pay_1");
  });

  it("nao confia no valor do corpo: quem manda e a reconsulta", async () => {
    // POST forjado dizendo que um pedido de R$ 100 foi pago com R$ 1.
    asaasMock.getCharge.mockResolvedValue({ ...cobrancaBoa, value: 1 });
    const r = await conferirPagamento({ id: "pay_1", value: 100 }, pedido);
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toContain("valor divergente");
  });

  it("recusa cobranca real de OUTRO pedido", async () => {
    asaasMock.getCharge.mockResolvedValue({ ...cobrancaBoa, externalReference: "credit_order_99" });
    const r = await conferirPagamento({ id: "pay_1", value: 100 }, pedido);
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toContain("credit_order_99");
  });

  // O superadmin gera uma segunda cobranca para o mesmo pedido (o boleto
  // anterior venceu). A rota sobrescreve `asaasChargeId` e NAO cancela a
  // anterior, que continua pagavel com o mesmo externalReference. Se o provedor
  // pagar o boleto antigo, isto tem que liberar: ele pagou de verdade.
  it("cobranca antiga paga libera o pedido — quem amarra e a referencia, nao o id gravado", async () => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_antigo", externalReference: "credit_order_7", status: "RECEIVED", value: 100,
    });
    const r = await conferirPagamento({ id: "pay_antigo" }, { ...pedido, chargeIdGravado: "pay_novo" });
    expect(r.ok).toBe(true);
    expect(asaasMock.getCharge).toHaveBeenCalledWith("pay_antigo");
    // o pagamento vale, mas a divergencia fica registrada para o superadmin
    expect((r as any).avisoIdDivergente).toContain("pay_novo");
  });

  it("id divergente que referencia OUTRO pedido continua recusado", async () => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_antigo", externalReference: "credit_order_99", status: "RECEIVED", value: 100,
    });
    const r = await conferirPagamento({ id: "pay_antigo" }, { ...pedido, chargeIdGravado: "pay_novo" });
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toContain("credit_order_99");
  });

  it("id igual ao gravado nao gera aviso de divergencia", async () => {
    const r = await conferirPagamento({ id: "pay_1", value: 100 }, pedido);
    expect(r.ok).toBe(true);
    expect((r as any).avisoIdDivergente).toBeUndefined();
  });

  it("recusa webhook sem id de cobranca", async () => {
    const r = await conferirPagamento({ value: 100 }, pedido);
    expect(r).toEqual({ ok: false, motivo: "webhook sem id de cobranca" });
  });

  it("recusa quando o Asaas nao da a cobranca por paga", async () => {
    asaasMock.getCharge.mockResolvedValue({ ...cobrancaBoa, status: "PENDING" });
    const r = await conferirPagamento({ id: "pay_1" }, pedido);
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toContain("nao confirma pagamento");
  });

  it("recusa quando nao da para reconsultar: falha de rede nao vira liberacao", async () => {
    asaasMock.getCharge.mockRejectedValue(new Error("timeout"));
    const r = await conferirPagamento({ id: "pay_1" }, pedido);
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toContain("timeout");
  });

  it("recusa quando o Asaas nem esta configurado", async () => {
    asaasMock.isAsaasConfigured.mockReturnValue(false);
    const r = await conferirPagamento({ id: "pay_1" }, pedido);
    expect(r.ok).toBe(false);
    expect(asaasMock.getCharge).not.toHaveBeenCalled();
  });

  it("aceita pagamento a maior e tolera o centavo do ponto flutuante", async () => {
    asaasMock.getCharge.mockResolvedValue({ ...cobrancaBoa, value: 199.9 });
    const r = await conferirPagamento({ id: "pay_1" }, { ...pedido, valorEsperado: parseFloat("199.90") });
    expect(r.ok).toBe(true);
  });

  it("aceita pedido sem cobranca gravada desde que a referencia bata", async () => {
    const r = await conferirPagamento({ id: "pay_1" }, { ...pedido, chargeIdGravado: null });
    expect(r.ok).toBe(true);
  });
});

describe("anotarRecusa", () => {
  it("acrescenta a linha sem apagar o que ja havia", () => {
    expect(anotarRecusa("compra manual", "valor divergente")).toBe(
      "compra manual\nWebhook Asaas recusado: valor divergente",
    );
  });

  it("nao repete a mesma recusa a cada retentativa do Asaas", () => {
    const primeira = anotarRecusa(null, "valor divergente")!;
    expect(anotarRecusa(primeira, "valor divergente")).toBeNull();
  });
});
