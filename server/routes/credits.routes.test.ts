import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

// A compra self-service estava quebrada desde sempre e ninguem viu: o unico
// sinal era um console.warn dentro de um catch. Estes testes provam o contrato
// com o server/services/asaas.ts real (cpfCnpj, customerId) sem falar com a API.
const storageMock = vi.hoisted(() => ({
  getAllCreditOrders: vi.fn(async (): Promise<any[]> => []),
  getProvider: vi.fn(async () => ({
    id: 42, name: "Provedor Teste", cnpj: "12.345.678/0001-90",
    contactEmail: "financeiro@provedor.com.br", contactPhone: "5199999999",
  })),
  getUser: vi.fn(async () => ({ id: 7, name: "Ana", email: "ana@provedor.com.br" })),
  getNextOrderNumber: vi.fn(async () => "CR-202609-0009"),
  createCreditOrder: vi.fn(async (o: any) => ({ ...o, id: 501 })),
  updateCreditOrder: vi.fn(async (id: number, data: any) => ({ id, ...data })),
  getCreditOrder: vi.fn(async () => undefined as any),
  releaseCreditOrder: vi.fn(async () => ({
    pedido: { id: 501, orderNumber: "CR-202609-0009", ispCredits: 100, spcCredits: 0, status: "paid" },
    liberadoAgora: true,
  })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

const asaasMock = vi.hoisted(() => ({
  isAsaasConfigured: vi.fn(() => true),
  findOrCreateCustomer: vi.fn(async () => ({ id: "cus_1", name: "Provedor Teste", cpfCnpj: "12345678000190" })),
  createCharge: vi.fn(async (p: any) => ({
    id: "pay_1", customer: p.customerId, value: p.value, billingType: p.billingType,
    status: "PENDING", dueDate: p.dueDate, externalReference: p.externalReference,
    invoiceUrl: "https://asaas/i/1", bankSlipUrl: p.billingType === "BOLETO" ? "https://asaas/b/1" : undefined,
  })),
  getPixQrCode: vi.fn(async () => ({ encodedImage: "x", payload: "y", expirationDate: "2026-09-10" })),
  getCharge: vi.fn(),
  asaasStatusToLocal: vi.fn(() => "pending"),
}));
vi.mock("../services/asaas", () => asaasMock);

vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Autenticacao necessaria" });
    next();
  },
  // Espelha o middleware real: `> 0`, e nao truthy. Antes cada rota de crédito
  // repetia essa checagem inline; agora é o middleware, e o mock precisa dele
  // ou o registro das rotas recebe `undefined` como handler.
  requireProvider: (req: any, res: any, next: any) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Autenticacao necessaria" });
    if (!(Number(req.session?.providerId) > 0)) return res.status(403).json({ message: "Somente provedores" });
    next();
  },
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Somente superadmin" });
    next();
  },
}));

import { registerCreditsRoutes } from "./credits.routes";

let server: Server;
let base: string;
let sessao: Record<string, unknown> = {};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    next();
  });
  app.use(registerCreditsRoutes());
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
  asaasMock.isAsaasConfigured.mockReturnValue(true);
  sessao = { userId: 7, providerId: 42, role: "admin" };
});

async function comprar(body: unknown) {
  return fetch(`${base}/api/credits/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/credits/purchase", () => {
  it("401 sem sessao e 403 para quem nao e provedor", async () => {
    sessao = {};
    expect((await comprar({ packageId: "credits-100" })).status).toBe(401);

    sessao = { userId: 7, role: "superadmin" };
    expect((await comprar({ packageId: "credits-100" })).status).toBe(403);
    expect(storageMock.createCreditOrder).not.toHaveBeenCalled();
  });

  it("recusa pacote fora do catalogo — o preco nunca vem do cliente", async () => {
    const res = await comprar({ packageId: "credits-999999", billingType: "PIX" });
    expect(res.status).toBe(400);
    expect(storageMock.createCreditOrder).not.toHaveBeenCalled();
  });

  it("PIX: manda cpfCnpj e customerId, os nomes que o asaas.ts espera", async () => {
    const res = await comprar({ packageId: "credits-100", billingType: "PIX" });
    expect(res.status).toBe(200);

    const cliente = asaasMock.findOrCreateCustomer.mock.calls[0][0] as any;
    expect(cliente.cpfCnpj).toBe("12.345.678/0001-90");
    expect(cliente).not.toHaveProperty("cnpj");

    const cobranca = asaasMock.createCharge.mock.calls[0][0] as any;
    expect(cobranca.customerId).toBe("cus_1");
    expect(cobranca).not.toHaveProperty("customer");
    expect(cobranca.billingType).toBe("PIX");
    // 100 creditos a R$ 1,00 — o valor sai do catalogo, em reais.
    expect(cobranca.value).toBe(100);
    expect(cobranca.externalReference).toBe("credit_order_501");
    expect(cobranca.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const body = await res.json();
    expect(body.charge.id).toBe("pay_1");
    expect(storageMock.updateCreditOrder).toHaveBeenCalledWith(501, expect.objectContaining({
      asaasChargeId: "pay_1", asaasCustomerId: "cus_1", asaasBillingType: "PIX",
    }));
  });

  it("boleto: a forma de cobranca chega ao Asaas e volta a URL do boleto", async () => {
    const res = await comprar({ packageId: "credits-50", billingType: "BOLETO" });
    expect(res.status).toBe(200);
    expect((asaasMock.createCharge.mock.calls[0][0] as any).billingType).toBe("BOLETO");
    expect((asaasMock.createCharge.mock.calls[0][0] as any).value).toBe(50);
    const body = await res.json();
    expect(body.charge.bankSlipUrl).toBe("https://asaas/b/1");
  });

  it("forma de cobranca inventada vira UNDEFINED em vez de 400 do Asaas", async () => {
    await comprar({ packageId: "credits-100", billingType: "CRIPTO" });
    expect((asaasMock.createCharge.mock.calls[0][0] as any).billingType).toBe("UNDEFINED");
  });

  it("Asaas fora do ar nao derruba o pedido: ele fica pendente, sem cobranca", async () => {
    asaasMock.createCharge.mockRejectedValueOnce(new Error("503 do Asaas"));
    const res = await comprar({ packageId: "credits-100", billingType: "PIX" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.orderNumber).toBe("CR-202609-0009");
    expect(body.charge).toBeNull();
  });

  it("sem chave do Asaas o pedido nasce igual, so sem cobranca", async () => {
    asaasMock.isAsaasConfigured.mockReturnValue(false);
    const res = await comprar({ packageId: "credits-100", billingType: "PIX" });
    expect(res.status).toBe(200);
    expect(asaasMock.createCharge).not.toHaveBeenCalled();
    expect(storageMock.createCreditOrder).toHaveBeenCalled();
  });
});

describe("GET /api/credits/orders/:id/asaas/pix", () => {
  it("nao entrega o PIX de pedido de outro provedor", async () => {
    storageMock.getCreditOrder.mockResolvedValueOnce({ id: 9, providerId: 99, asaasChargeId: "pay_x" } as any);
    const res = await fetch(`${base}/api/credits/orders/9/asaas/pix`);
    expect(res.status).toBe(404);
    expect(asaasMock.getPixQrCode).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/credit-orders/:id/release", () => {
  beforeEach(() => {
    sessao = { userId: 1, role: "superadmin" };
  });

  it("libera e diz quantos creditos entraram", async () => {
    const res = await fetch(`${base}/api/admin/credit-orders/501/release`, { method: "POST" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.liberadoAgora).toBe(true);
    expect(body.message).toContain("100 creditos liberados");
  });

  it("clique repetido no botao nao vira erro nem credito dobrado", async () => {
    storageMock.releaseCreditOrder.mockResolvedValueOnce({
      pedido: { id: 501, orderNumber: "CR-202609-0009", ispCredits: 100, spcCredits: 0, status: "paid" },
      liberadoAgora: false,
    } as any);
    const res = await fetch(`${base}/api/admin/credit-orders/501/release`, { method: "POST" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.liberadoAgora).toBe(false);
    expect(body.message).toContain("ja estava liberado");
  });
});

// A trava contra credito dobrado vive em `credited_at`. Estas duas rotas eram os
// caminhos por onde uma mao humana podia reabrir um pedido ja creditado.
describe("PATCH /api/admin/credit-orders/:id", () => {
  beforeEach(() => {
    sessao = { userId: 1, role: "superadmin" };
  });

  function alterar(body: unknown) {
    return fetch(`${base}/api/admin/credit-orders/501`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("nao rebaixa pedido ja creditado", async () => {
    storageMock.getCreditOrder.mockResolvedValue({
      id: 501, status: "paid", creditedAt: new Date("2026-09-02"), notes: null,
    } as any);
    const res = await alterar({ status: "cancelled" });
    expect(res.status).toBe(409);
    expect(storageMock.updateCreditOrder).not.toHaveBeenCalled();
  });

  it("cancela normalmente pedido que ainda nao virou saldo", async () => {
    storageMock.getCreditOrder.mockResolvedValue({ id: 501, status: "pending", creditedAt: null } as any);
    const res = await alterar({ status: "cancelled" });
    expect(res.status).toBe(200);
    expect(storageMock.updateCreditOrder).toHaveBeenCalledWith(501, { status: "cancelled" });
  });

  it("status fora do catalogo e recusado — a tela filtra por estes quatro", async () => {
    storageMock.getCreditOrder.mockResolvedValue({ id: 501, status: "pending", creditedAt: null } as any);
    const res = await alterar({ status: "PAGO" });
    expect(res.status).toBe(400);
    expect(storageMock.updateCreditOrder).not.toHaveBeenCalled();
  });

  it("anotar observacao em pedido creditado continua permitido", async () => {
    storageMock.getCreditOrder.mockResolvedValue({
      id: 501, status: "paid", creditedAt: new Date("2026-09-02"),
    } as any);
    const res = await alterar({ notes: "conferido com o extrato" });
    expect(res.status).toBe(200);
    expect(storageMock.updateCreditOrder).toHaveBeenCalledWith(501, { notes: "conferido com o extrato" });
  });
});

describe("POST /api/admin/credit-orders/:id/asaas/sync", () => {
  beforeEach(() => {
    sessao = { userId: 1, role: "superadmin" };
    asaasMock.getCharge.mockResolvedValue({ id: "pay_1", status: "RECEIVED", invoiceUrl: "u" } as any);
    asaasMock.asaasStatusToLocal.mockReturnValue("paid" as any);
  });

  it("pedido ja creditado nao e creditado de novo pelo botao sincronizar", async () => {
    // O status pode ter sido rebaixado por um evento de chargeback; quem manda
    // e o credited_at.
    storageMock.getCreditOrder.mockResolvedValue({
      id: 501, asaasChargeId: "pay_1", status: "pending", creditedAt: new Date("2026-09-02"),
    } as any);
    const res = await fetch(`${base}/api/admin/credit-orders/501/asaas/sync`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
    // e o sync ainda conserta o status rebaixado: creditado le "paid"
    expect(storageMock.updateCreditOrder).toHaveBeenCalledWith(501, expect.objectContaining({ status: "paid" }));
  });

  it("pedido pago que nunca foi creditado libera", async () => {
    storageMock.getCreditOrder.mockResolvedValue({
      id: 501, asaasChargeId: "pay_1", status: "pending", creditedAt: null,
    } as any);
    const res = await fetch(`${base}/api/admin/credit-orders/501/asaas/sync`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(storageMock.releaseCreditOrder).toHaveBeenCalledWith(501);
  });
});
