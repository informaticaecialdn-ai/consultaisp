import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

// O webhook do Asaas e a unica porta pela qual credito entra no saldo sem
// ninguem clicar. Estes testes cobrem as tres maneiras de arrombar essa porta:
// POST sem o token, POST com valor mentido, e reentrega do mesmo evento.
const storageMock = vi.hoisted(() => ({
  getCreditOrder: vi.fn(),
  updateCreditOrder: vi.fn(async (id: number, data: any) => ({ id, ...data })),
  releaseCreditOrder: vi.fn(async () => ({
    pedido: { id: 501, orderNumber: "CR-202609-0009", ispCredits: 100, status: "paid" },
    liberadoAgora: true,
  })),
  getProviderInvoice: vi.fn(),
  updateProviderInvoiceAsaas: vi.fn(async (id: number, data: any) => ({ id, ...data })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

const envMock = vi.hoisted(() => ({ getAsaasWebhookToken: vi.fn(() => "token-do-painel") }));
vi.mock("../env", () => envMock);

const asaasMock = vi.hoisted(() => ({
  getCharge: vi.fn(),
  isAsaasConfigured: vi.fn(() => true),
  asaasStatusToLocal: vi.fn((s: string) => (s === "RECEIVED" || s === "CONFIRMED" ? "paid" : s === "OVERDUE" ? "overdue" : "pending")),
  findOrCreateCustomer: vi.fn(),
  createCharge: vi.fn(),
  cancelCharge: vi.fn(),
  getPixQrCode: vi.fn(),
  getBalance: vi.fn(),
  getAsaasMode: vi.fn(() => "sandbox"),
}));
vi.mock("../services/asaas", () => asaasMock);

vi.mock("../auth", () => ({
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Somente superadmin" });
    next();
  },
}));

import { registerFinanceiroRoutes } from "./financeiro.routes";

let server: Server;
let base: string;

const PEDIDO = {
  id: 501, orderNumber: "CR-202609-0009", amount: "100.00",
  asaasChargeId: "pay_1", notes: null, status: "pending", providerId: 42,
};
const FATURA = {
  id: 77, invoiceNumber: "NF-2026-000077", amount: "349.00",
  asaasChargeId: "pay_f", notes: null, status: "pending", providerId: 42,
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {};
    next();
  });
  app.use(registerFinanceiroRoutes());
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  envMock.getAsaasWebhookToken.mockReturnValue("token-do-painel");
  asaasMock.isAsaasConfigured.mockReturnValue(true);
  asaasMock.asaasStatusToLocal.mockImplementation((s: string) =>
    s === "RECEIVED" || s === "CONFIRMED" ? "paid" : s === "OVERDUE" ? "overdue" : "pending");
  storageMock.getCreditOrder.mockResolvedValue({ ...PEDIDO });
  storageMock.getProviderInvoice.mockResolvedValue({ ...FATURA });
  asaasMock.getCharge.mockResolvedValue({
    id: "pay_1", externalReference: "credit_order_501", status: "RECEIVED", value: 100,
  });
  storageMock.releaseCreditOrder.mockResolvedValue({
    pedido: { id: 501, orderNumber: "CR-202609-0009", ispCredits: 100, status: "paid" },
    liberadoAgora: true,
  } as any);
});

function webhook(body: unknown, token?: string) {
  return fetch(`${base}/api/asaas/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token === undefined ? {} : { "asaas-access-token": token }),
    },
    body: JSON.stringify(body),
  });
}

const PAGO = { event: "PAYMENT_RECEIVED", payment: { id: "pay_1", externalReference: "credit_order_501", status: "RECEIVED", value: 100, paymentDate: "2026-09-02" } };

describe("POST /api/asaas/webhook — token", () => {
  it("sem o header, nada e liberado", async () => {
    const res = await webhook(PAGO);
    expect(res.status).toBe(401);
    expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
  });

  it("com token errado, nada e liberado", async () => {
    const res = await webhook(PAGO, "chute");
    expect(res.status).toBe(401);
    expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
  });

  it("com o token certo, o pagamento e processado", async () => {
    const res = await webhook(PAGO, "token-do-painel");
    expect(res.status).toBe(200);
    expect(storageMock.releaseCreditOrder).toHaveBeenCalledWith(501);
  });
});

describe("POST /api/asaas/webhook — pedido de credito", () => {
  it("reconsulta o Asaas antes de creditar", async () => {
    await webhook(PAGO, "token-do-painel");
    expect(asaasMock.getCharge).toHaveBeenCalledWith("pay_1");
  });

  it("valor mentido no corpo nao libera: quem decide e a reconsulta", async () => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_1", externalReference: "credit_order_501", status: "RECEIVED", value: 1,
    });
    const res = await webhook(
      { event: "PAYMENT_RECEIVED", payment: { id: "pay_1", externalReference: "credit_order_501", status: "RECEIVED", value: 100 } },
      "token-do-painel",
    );
    expect(res.status).toBe(200);
    expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
    // a recusa fica gravada onde o superadmin ve
    expect(storageMock.updateCreditOrder).toHaveBeenCalledWith(501, {
      notes: expect.stringContaining("valor divergente"),
    });
  });

  it("cobranca real de outro pedido nao libera este", async () => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_1", externalReference: "credit_order_999", status: "RECEIVED", value: 100,
    });
    await webhook(PAGO, "token-do-painel");
    expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
  });

  it("Asaas fora do ar nao libera nada", async () => {
    asaasMock.getCharge.mockRejectedValue(new Error("timeout"));
    await webhook(PAGO, "token-do-painel");
    expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
  });

  it("reentrega do mesmo evento nao credita de novo e nao vira erro", async () => {
    storageMock.releaseCreditOrder.mockResolvedValue({
      pedido: { id: 501, orderNumber: "CR-202609-0009", ispCredits: 100, status: "paid" },
      liberadoAgora: false,
    } as any);
    const res = await webhook(PAGO, "token-do-painel");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("status que nao e pagamento so atualiza o pedido, sem creditar", async () => {
    const res = await webhook(
      { event: "PAYMENT_OVERDUE", payment: { id: "pay_1", externalReference: "credit_order_501", status: "OVERDUE" } },
      "token-do-painel",
    );
    expect(res.status).toBe(200);
    expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
    expect(storageMock.updateCreditOrder).toHaveBeenCalledWith(501, { asaasStatus: "OVERDUE", status: "overdue" });
  });

  it("pedido inexistente e ignorado, sem 500", async () => {
    storageMock.getCreditOrder.mockResolvedValue(undefined);
    const res = await webhook(PAGO, "token-do-painel");
    expect(res.status).toBe(200);
    expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
  });
});

describe("POST /api/asaas/webhook — fatura do plano", () => {
  const PAGA = {
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_f", externalReference: "invoice_77", status: "RECEIVED", value: 349, paymentDate: "2026-09-02" },
  };

  it("confirma no Asaas e grava o valor que ele confirmou, nao o do corpo", async () => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_f", externalReference: "invoice_77", status: "RECEIVED", value: 349,
    });
    const res = await webhook(PAGA, "token-do-painel");
    expect(res.status).toBe(200);
    expect(storageMock.updateProviderInvoiceAsaas).toHaveBeenCalledWith(77, expect.objectContaining({
      status: "paid", paidAmount: "349.00",
    }));
  });

  it("valor a menor nao da a fatura por paga", async () => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_f", externalReference: "invoice_77", status: "RECEIVED", value: 10,
    });
    await webhook(PAGA, "token-do-painel");
    expect(storageMock.updateProviderInvoiceAsaas).toHaveBeenCalledWith(77, {
      notes: expect.stringContaining("valor divergente"),
    });
  });

  it("referencia que nao e pedido nem fatura passa batido", async () => {
    const res = await webhook(
      { event: "PAYMENT_RECEIVED", payment: { id: "pay_z", externalReference: "outra_coisa_1", status: "RECEIVED", value: 1 } },
      "token-do-painel",
    );
    expect(res.status).toBe(200);
    expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
    expect(storageMock.updateProviderInvoiceAsaas).not.toHaveBeenCalled();
  });
});
