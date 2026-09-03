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
    pedido: {
      id: 501, orderNumber: "CR-202609-0009", packageName: "100 créditos",
      ispCredits: 100, amount: "100.00", providerId: 42, status: "paid",
    },
    liberadoAgora: true,
  })),
  getProviderInvoice: vi.fn(),
  updateProviderInvoiceAsaas: vi.fn(async (id: number, data: any) => ({ id, ...data })),
  updateProviderInvoiceStatus: vi.fn(async (id: number, status: string) => ({ id, status })),
  createProviderInvoice: vi.fn(async (dados: any) => ({ ...dados, id: 77 })),
  getAllProviderInvoices: vi.fn(async (): Promise<any[]> => []),
  getNextInvoiceNumber: vi.fn(async () => "NF-2026-000077"),
  getAllProviders: vi.fn(async (): Promise<any[]> => []),
  getProvider: vi.fn(async (): Promise<any> => undefined),
  getUsersByProvider: vi.fn(async (): Promise<any[]> => []),
  getMarca: vi.fn(async (): Promise<any> => undefined),
  getUser: vi.fn(async () => ({ id: 1, name: "Admin da plataforma" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

const emailMock = vi.hoisted(() => ({
  sendCreditosLiberadosEmail: vi.fn(async () => undefined),
  sendFaturaGeradaEmail: vi.fn(async () => undefined),
  sendFaturaPagaEmail: vi.fn(async () => undefined),
}));
vi.mock("../services/email", () => emailMock);

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

import { competenciaPorExtenso, dataPorExtenso, registerFinanceiroRoutes } from "./financeiro.routes";
import { esquecerMarcas } from "../services/marca.service";

let server: Server;
let base: string;
let sessao: Record<string, unknown> = {};

const PEDIDO = {
  id: 501, orderNumber: "CR-202609-0009", amount: "100.00",
  asaasChargeId: "pay_1", notes: null, status: "pending", providerId: 42,
};
const FATURA = {
  id: 77, invoiceNumber: "NF-2026-000077", amount: "349.00", period: "2026-09",
  planAtTime: "pro", dueDate: new Date(2026, 8, 10),
  asaasChargeId: "pay_f", notes: null, status: "pending", providerId: 42,
};
const PROVEDOR = {
  id: 42, name: "NsLink Telecom", contactEmail: "financeiro@nslink.com.br",
  marcaId: null, subdomain: "nslink", plan: "pro", ispCredits: 250,
};
/** A marca de um revendedor, como `storage.getMarca` a devolve. */
const CREDNET = {
  id: 7, slug: "crednet", ativo: true, nomeProduto: "CredNet", assinatura: null,
  dominio: "app.crednet.com.br", dominioStatus: "ativo",
  logoSvg: null, logoPng: null, faviconSvg: null,
  corBrand: "#1F6F7A", corBrandDark: null,
  emailRemetente: null, emailNomeExibicao: null,
  suporteEmail: null, suporteWhatsapp: null, site: null,
  responsavelRazaoSocial: null, responsavelCnpj: null, createdAt: new Date(),
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessao;
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
  sessao = {};
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
    pedido: {
      id: 501, orderNumber: "CR-202609-0009", packageName: "100 créditos",
      ispCredits: 100, amount: "100.00", providerId: 42, status: "paid",
    },
    liberadoAgora: true,
  } as any);
  // `resolverMarcaPorId` guarda a marca por 5 minutos num Map de modulo.
  esquecerMarcas();
  storageMock.getMarca.mockResolvedValue(undefined);
  storageMock.getProvider.mockResolvedValue({ ...PROVEDOR });
  storageMock.getUsersByProvider.mockResolvedValue([]);
  storageMock.getAllProviders.mockResolvedValue([]);
  storageMock.getAllProviderInvoices.mockResolvedValue([]);
  storageMock.getNextInvoiceNumber.mockResolvedValue("NF-2026-000077");
  storageMock.createProviderInvoice.mockImplementation(async (dados: any) => ({ ...dados, id: 77 }));
  storageMock.updateProviderInvoiceStatus.mockImplementation(async (id: number, status: string) => ({ id, status }));
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

  // O pagamento e real e o Asaas caiu no instante da reconsulta. Recusar esta
  // certo; responder 200 nao — para o Asaas, 200 e "entregue, nao reenvie", e o
  // credito de um PIX pago de verdade nunca entrava, porque ninguem reprocessa.
  describe("Asaas indisponivel: 500 para reentregar, nao 200", () => {
    it("queda de rede na reconsulta devolve 500", async () => {
      asaasMock.getCharge.mockRejectedValue(new Error("fetch failed"));
      const res = await webhook(PAGO, "token-do-painel");
      expect(res.status).toBe(500);
      expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
    });

    it("502 do Asaas devolve 500", async () => {
      asaasMock.getCharge.mockRejectedValue(Object.assign(new Error("Erro Asaas: 502"), { status: 502 }));
      const res = await webhook(PAGO, "token-do-painel");
      expect(res.status).toBe(500);
    });

    it("chave do Asaas ausente devolve 500", async () => {
      asaasMock.isAsaasConfigured.mockReturnValue(false);
      const res = await webhook(PAGO, "token-do-painel");
      expect(res.status).toBe(500);
      expect(storageMock.releaseCreditOrder).not.toHaveBeenCalled();
    });

    // A mensagem muda a cada tentativa (timeout, 502, 503) e `anotarRecusa` so
    // deduplica linha identica: anotar aqui encheria as observacoes do pedido.
    it("indisponibilidade nao escreve nas observacoes do pedido", async () => {
      asaasMock.getCharge.mockRejectedValue(new Error("socket hang up"));
      await webhook(PAGO, "token-do-painel");
      expect(storageMock.updateCreditOrder).not.toHaveBeenCalled();
    });

    it("recusa por prova continua 200 e anotada — insistir nao mudaria nada", async () => {
      asaasMock.getCharge.mockResolvedValue({
        id: "pay_1", externalReference: "credit_order_501", status: "RECEIVED", value: 1,
      });
      const res = await webhook(PAGO, "token-do-painel");
      expect(res.status).toBe(200);
      expect(storageMock.updateCreditOrder).toHaveBeenCalledWith(501, {
        notes: expect.stringContaining("valor divergente"),
      });
    });
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

  // Este era o caminho do credito em dobro: o proprio webhook apagava a trava.
  // `asaasStatusToLocal` devolve "pending" para todo status fora do mapa dele —
  // CHARGEBACK_REQUESTED, AWAITING_RISK_ANALYSIS, DUNNING_REQUESTED — e o ramo
  // nao-pago gravava esse "pending" por cima de um pedido ja creditado.
  it("evento de status desconhecido nao rebaixa pedido ja creditado", async () => {
    storageMock.getCreditOrder.mockResolvedValue({
      ...PEDIDO, status: "paid", creditedAt: new Date("2026-09-02"),
    });
    const res = await webhook(
      { event: "PAYMENT_CHARGEBACK_REQUESTED", payment: { id: "pay_1", externalReference: "credit_order_501", status: "CHARGEBACK_REQUESTED" } },
      "token-do-painel",
    );
    expect(res.status).toBe(200);
    // o status do Asaas e registrado; o status LOCAL nao volta para "pending"
    expect(storageMock.updateCreditOrder).toHaveBeenCalledWith(501, { asaasStatus: "CHARGEBACK_REQUESTED" });
    expect(storageMock.updateCreditOrder).not.toHaveBeenCalledWith(501, expect.objectContaining({ status: "pending" }));
  });

  it("pedido ainda nao creditado continua acompanhando o status do Asaas", async () => {
    storageMock.getCreditOrder.mockResolvedValue({ ...PEDIDO, status: "pending", creditedAt: null });
    await webhook(
      { event: "PAYMENT_OVERDUE", payment: { id: "pay_1", externalReference: "credit_order_501", status: "OVERDUE" } },
      "token-do-painel",
    );
    expect(storageMock.updateCreditOrder).toHaveBeenCalledWith(501, { asaasStatus: "OVERDUE", status: "overdue" });
  });

  // Sequencia completa do defeito: pago -> chargeback -> PAYMENT_RECEIVED de
  // novo. A segunda entrega chega ate releaseCreditOrder (a conferencia passa,
  // o Asaas de fato confirma), e quem barra o segundo credito e o `credited_at`
  // la dentro — que ninguem no meio do caminho apagou.
  it("depois do chargeback, a reentrega do PAYMENT_RECEIVED nao credita de novo", async () => {
    storageMock.getCreditOrder.mockResolvedValue({
      ...PEDIDO, status: "paid", creditedAt: new Date("2026-09-02"),
    });
    await webhook(
      { event: "PAYMENT_CHARGEBACK_REQUESTED", payment: { id: "pay_1", externalReference: "credit_order_501", status: "CHARGEBACK_REQUESTED" } },
      "token-do-painel",
    );
    storageMock.releaseCreditOrder.mockResolvedValue({
      pedido: { id: 501, orderNumber: "CR-202609-0009", ispCredits: 100, status: "paid" },
      liberadoAgora: false,
    } as any);
    const res = await webhook(PAGO, "token-do-painel");
    expect(res.status).toBe(200);
    expect(storageMock.releaseCreditOrder).toHaveBeenCalledTimes(1);
    // e o pedido nunca passou por "pending" no meio
    for (const [, dados] of storageMock.updateCreditOrder.mock.calls) {
      expect((dados as any).status).not.toBe("pending");
    }
  });

  // Cobranca antiga paga (o superadmin gerou um segundo boleto e o provedor
  // pagou o primeiro): o pagamento e real e tem que virar credito.
  it("pagamento por cobranca diferente da gravada libera e fica anotado", async () => {
    storageMock.getCreditOrder.mockResolvedValue({ ...PEDIDO, asaasChargeId: "pay_novo" });
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_antigo", externalReference: "credit_order_501", status: "RECEIVED", value: 100,
    });
    const res = await webhook(
      { event: "PAYMENT_RECEIVED", payment: { id: "pay_antigo", externalReference: "credit_order_501", status: "RECEIVED", value: 100 } },
      "token-do-painel",
    );
    expect(res.status).toBe(200);
    expect(storageMock.releaseCreditOrder).toHaveBeenCalledWith(501);
    expect(storageMock.updateCreditOrder).toHaveBeenCalledWith(501, {
      notes: expect.stringContaining("pay_antigo"),
    });
  });
});

// O Asaas so reenvia o evento quando a resposta NAO e 2xx. Responder 200 numa
// falha de banco fazia o provedor pagar e nunca receber credito, sem
// retentativa. Reentregar e barato: a liberacao e travada por `credited_at`.
describe("POST /api/asaas/webhook — falha inesperada", () => {
  it("banco fora do ar devolve 500 para o Asaas reentregar", async () => {
    storageMock.getCreditOrder.mockRejectedValue(new Error("statement timeout"));
    const res = await webhook(PAGO, "token-do-painel");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("falha ao creditar tambem devolve 500", async () => {
    storageMock.releaseCreditOrder.mockRejectedValue(new Error("pool esgotado"));
    const res = await webhook(PAGO, "token-do-painel");
    expect(res.status).toBe(500);
  });

  it("falha na fatura tambem devolve 500", async () => {
    storageMock.getProviderInvoice.mockRejectedValue(new Error("db down"));
    const res = await webhook(
      { event: "PAYMENT_RECEIVED", payment: { id: "pay_f", externalReference: "invoice_77", status: "RECEIVED", value: 349 } },
      "token-do-painel",
    );
    expect(res.status).toBe(500);
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

  // O ramo do pedido ganhou trava contra rebaixamento; o da fatura ficou sem.
  // Qualquer status fora do mapa de `asaasStatusToLocal` vira "pending", e o
  // botao "reenviar evento" do painel do Asaas reenvia OVERDUE antigo: a fatura
  // ja quitada reaparecia como vencida e o provedor era cobrado de novo.
  describe("fatura ja paga nao volta atras", () => {
    it("chargeback pedido so registra o status do Asaas", async () => {
      storageMock.getProviderInvoice.mockResolvedValue({
        ...FATURA, status: "paid", paidDate: new Date("2026-09-02"), paidAmount: "349.00",
      });
      const res = await webhook(
        { event: "PAYMENT_CHARGEBACK_REQUESTED", payment: { id: "pay_f", externalReference: "invoice_77", status: "CHARGEBACK_REQUESTED" } },
        "token-do-painel",
      );
      expect(res.status).toBe(200);
      expect(storageMock.updateProviderInvoiceAsaas).toHaveBeenCalledWith(77, { asaasStatus: "CHARGEBACK_REQUESTED" });
      expect(storageMock.updateProviderInvoiceAsaas).not.toHaveBeenCalledWith(77, expect.objectContaining({ status: "pending" }));
    });

    it("reenvio de PAYMENT_OVERDUE antigo nao deixa a fatura paga vencida", async () => {
      storageMock.getProviderInvoice.mockResolvedValue({
        ...FATURA, status: "paid", paidDate: new Date("2026-09-02"), paidAmount: "349.00",
      });
      await webhook(
        { event: "PAYMENT_OVERDUE", payment: { id: "pay_f", externalReference: "invoice_77", status: "OVERDUE" } },
        "token-do-painel",
      );
      expect(storageMock.updateProviderInvoiceAsaas).not.toHaveBeenCalledWith(77, expect.objectContaining({ status: "overdue" }));
    });

    // A fatura tem paidDate mas o status nunca foi corrigido: a prova de que o
    // dinheiro entrou e a data, e ela tambem tranca o rebaixamento.
    it("paidDate preenchida sozinha ja tranca o rebaixamento", async () => {
      storageMock.getProviderInvoice.mockResolvedValue({
        ...FATURA, status: "pending", paidDate: new Date("2026-09-02"),
      });
      await webhook(
        { event: "PAYMENT_OVERDUE", payment: { id: "pay_f", externalReference: "invoice_77", status: "OVERDUE" } },
        "token-do-painel",
      );
      expect(storageMock.updateProviderInvoiceAsaas).toHaveBeenCalledWith(77, { asaasStatus: "OVERDUE" });
    });

    it("fatura que nunca foi paga continua acompanhando o Asaas", async () => {
      storageMock.getProviderInvoice.mockResolvedValue({ ...FATURA, status: "pending", paidDate: null });
      await webhook(
        { event: "PAYMENT_OVERDUE", payment: { id: "pay_f", externalReference: "invoice_77", status: "OVERDUE" } },
        "token-do-painel",
      );
      expect(storageMock.updateProviderInvoiceAsaas).toHaveBeenCalledWith(77, { asaasStatus: "OVERDUE", status: "overdue" });
    });
  });

  it("Asaas indisponivel na fatura tambem devolve 500", async () => {
    asaasMock.getCharge.mockRejectedValue(Object.assign(new Error("Erro Asaas: 503"), { status: 503 }));
    const res = await webhook(PAGA, "token-do-painel");
    expect(res.status).toBe(500);
    expect(storageMock.updateProviderInvoiceAsaas).not.toHaveBeenCalled();
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

// O botao "sincronizar" decidia pelo status cru da cobranca: nao conferia se
// ela e desta fatura nem se cobre o valor. Era a porta dos fundos da conferencia
// do webhook — o que o webhook recusava, um clique aprovava.
describe("POST /api/admin/invoices/:id/asaas/sync", () => {
  beforeEach(() => {
    sessao = { userId: 1, role: "superadmin" };
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_f", externalReference: "invoice_77", status: "RECEIVED", value: 349,
      paymentDate: "2026-09-02", invoiceUrl: "https://asaas/i/f",
    });
  });

  function sincronizar() {
    return fetch(`${base}/api/admin/invoices/77/asaas/sync`, { method: "POST" });
  }

  it("pagamento conferido marca a fatura como paga com o valor do Asaas", async () => {
    const res = await sincronizar();
    expect(res.status).toBe(200);
    expect(storageMock.updateProviderInvoiceAsaas).toHaveBeenCalledWith(77, expect.objectContaining({
      status: "paid", paidAmount: "349.00",
    }));
  });

  it("boleto pago a menor nao quita a fatura, e o superadmin le o motivo", async () => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_f", externalReference: "invoice_77", status: "RECEIVED", value: 10, paymentDate: "2026-09-02",
    });
    const res = await sincronizar();
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain("valor divergente");
    expect(storageMock.updateProviderInvoiceAsaas).not.toHaveBeenCalledWith(77, expect.objectContaining({ status: "paid" }));
  });

  it("cobranca de outra fatura nao quita esta", async () => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_f", externalReference: "invoice_999", status: "RECEIVED", value: 349, paymentDate: "2026-09-02",
    });
    const res = await sincronizar();
    expect(res.status).toBe(409);
    expect(storageMock.updateProviderInvoiceAsaas).not.toHaveBeenCalledWith(77, expect.objectContaining({ status: "paid" }));
  });

  it("Asaas fora do ar na conferencia devolve 502, nao quitacao", async () => {
    asaasMock.isAsaasConfigured.mockReturnValue(false);
    const res = await sincronizar();
    expect(res.status).toBe(502);
    expect(storageMock.updateProviderInvoiceAsaas).not.toHaveBeenCalledWith(77, expect.objectContaining({ status: "paid" }));
  });

  it("status nao-pago nao rebaixa fatura ja paga", async () => {
    storageMock.getProviderInvoice.mockResolvedValue({
      ...FATURA, status: "paid", paidDate: new Date("2026-09-02"), paidAmount: "349.00",
    });
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_f", externalReference: "invoice_77", status: "CHARGEBACK_REQUESTED", value: 349,
    });
    const res = await sincronizar();
    expect(res.status).toBe(200);
    const [, dados] = storageMock.updateProviderInvoiceAsaas.mock.calls.at(-1)!;
    expect((dados as any).status).toBeUndefined();
    expect((dados as any).asaasStatus).toBe("CHARGEBACK_REQUESTED");
  });

  it("fatura que nunca foi paga continua acompanhando o status do Asaas", async () => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_f", externalReference: "invoice_77", status: "OVERDUE", value: 349,
    });
    await sincronizar();
    expect(storageMock.updateProviderInvoiceAsaas).toHaveBeenCalledWith(77, expect.objectContaining({ status: "overdue" }));
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AVISOS: o provedor pagava e nao ficava sabendo de nada.
//
// Tres regras valem para os tres e-mails deste arquivo:
//   1. o e-mail sai DEPOIS que o efeito financeiro ja aconteceu, e nenhuma
//      falha de envio pode desfaze-lo ou virar erro na tela/no webhook;
//   2. o mesmo aviso nunca sai duas vezes â€” a reentrega do webhook e o clique
//      repetido tem que ser silenciosos;
//   3. a marca e o endereco sao os do PROVEDOR, nunca os do host.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("competencia e vencimento como o provedor le", () => {
  it("a competencia do banco vira mes por extenso em portugues", () => {
    expect(competenciaPorExtenso("2026-09")).toBe("setembro de 2026");
    expect(competenciaPorExtenso("2026-01")).toBe("janeiro de 2026");
    expect(competenciaPorExtenso("2025-12")).toBe("dezembro de 2025");
    expect(competenciaPorExtenso("2026-03")).toBe("março de 2026");
  });

  // Melhor o provedor ler a competencia crua do que "undefined de NaN".
  it("formato inesperado volta como veio", () => {
    expect(competenciaPorExtenso("setembro/2026")).toBe("setembro/2026");
    expect(competenciaPorExtenso("2026-13")).toBe("2026-13");
    expect(competenciaPorExtenso("")).toBe("");
  });

  it("vencimento sai em dd/mm/aaaa", () => {
    expect(dataPorExtenso(new Date(2026, 8, 10))).toBe("10/09/2026");
    expect(dataPorExtenso(new Date(2026, 0, 5))).toBe("05/01/2026");
  });

  it("data invalida ou ausente nao vira 'Invalid Date' no e-mail", () => {
    expect(dataPorExtenso(null)).toBe("");
    expect(dataPorExtenso(undefined)).toBe("");
    expect(dataPorExtenso("nao e data")).toBe("");
  });
});

describe("aviso de creditos liberados pelo webhook", () => {
  const PAGO_CR = {
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_1", externalReference: "credit_order_501", status: "RECEIVED", value: 100, paymentDate: "2026-09-02" },
  };

  it("credito liberado avisa o contato do provedor uma vez, com o saldo de agora", async () => {
    const res = await webhook(PAGO_CR, "token-do-painel");
    expect(res.status).toBe(200);
    expect(emailMock.sendCreditosLiberadosEmail).toHaveBeenCalledTimes(1);
    const [para, nome, dados] = emailMock.sendCreditosLiberadosEmail.mock.calls[0] as any[];
    expect(para).toBe("financeiro@nslink.com.br");
    expect(nome).toBe("NsLink Telecom");
    expect(dados).toEqual({
      pedido: "CR-202609-0009", pacote: "100 créditos",
      creditos: 100, valor: 100, saldo: 250,
    });
  });

  // A trava contra o e-mail em dobro e a mesma que trava o credito em dobro.
  it("reentrega do mesmo evento nao manda um segundo e-mail", async () => {
    storageMock.releaseCreditOrder.mockResolvedValue({
      pedido: { id: 501, orderNumber: "CR-202609-0009", packageName: "100 créditos", ispCredits: 100, amount: "100.00", providerId: 42 },
      liberadoAgora: false,
    } as any);
    const res = await webhook(PAGO_CR, "token-do-painel");
    expect(res.status).toBe(200);
    expect(emailMock.sendCreditosLiberadosEmail).not.toHaveBeenCalled();
  });

  it("recusa na conferencia nao avisa ninguem", async () => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_1", externalReference: "credit_order_501", status: "RECEIVED", value: 1,
    });
    await webhook(PAGO_CR, "token-do-painel");
    expect(emailMock.sendCreditosLiberadosEmail).not.toHaveBeenCalled();
  });

  // 500 aqui poria o evento de volta na fila do Asaas para um pagamento JA
  // creditado. O aviso nao pode mexer na resposta do webhook.
  it("Resend fora do ar nao vira 500 no webhook", async () => {
    emailMock.sendCreditosLiberadosEmail.mockRejectedValueOnce(new Error("Resend 503"));
    const res = await webhook(PAGO_CR, "token-do-painel");
    expect(res.status).toBe(200);
    expect(storageMock.releaseCreditOrder).toHaveBeenCalledWith(501);
  });

  it("provedor sumido do banco nao vira 500 no webhook", async () => {
    storageMock.getProvider.mockResolvedValue(undefined);
    const res = await webhook(PAGO_CR, "token-do-painel");
    expect(res.status).toBe(200);
    expect(emailMock.sendCreditosLiberadosEmail).not.toHaveBeenCalled();
  });
});

describe("aviso de fatura paga", () => {
  const PAGA = {
    event: "PAYMENT_RECEIVED",
    payment: { id: "pay_f", externalReference: "invoice_77", status: "RECEIVED", value: 349, paymentDate: "2026-09-02" },
  };

  beforeEach(() => {
    asaasMock.getCharge.mockResolvedValue({
      id: "pay_f", externalReference: "invoice_77", status: "RECEIVED", value: 349, paymentDate: "2026-09-02",
    });
  });

  describe("pelo webhook", () => {
    it("quita e avisa uma vez, com numero, competencia por extenso e valor conferido", async () => {
      const res = await webhook(PAGA, "token-do-painel");
      expect(res.status).toBe(200);
      expect(emailMock.sendFaturaPagaEmail).toHaveBeenCalledTimes(1);
      const [para, nome, dados] = emailMock.sendFaturaPagaEmail.mock.calls[0] as any[];
      expect(para).toBe("financeiro@nslink.com.br");
      expect(nome).toBe("NsLink Telecom");
      expect(dados).toEqual({ numero: "NF-2026-000077", competencia: "setembro de 2026", valor: 349 });
    });

    // Regravar "paid" com os mesmos valores nao custa nada; mandar o e-mail de
    // novo, sim. A foto de antes e o que separa a quitacao da reentrega.
    it("reentrega sobre fatura ja paga nao manda um segundo e-mail", async () => {
      storageMock.getProviderInvoice.mockResolvedValue({
        ...FATURA, status: "paid", paidDate: new Date("2026-09-02"), paidAmount: "349.00",
      });
      const res = await webhook(PAGA, "token-do-painel");
      expect(res.status).toBe(200);
      expect(emailMock.sendFaturaPagaEmail).not.toHaveBeenCalled();
    });

    it("paidDate preenchida sozinha ja segura o aviso", async () => {
      storageMock.getProviderInvoice.mockResolvedValue({ ...FATURA, status: "pending", paidDate: new Date("2026-09-02") });
      await webhook(PAGA, "token-do-painel");
      expect(emailMock.sendFaturaPagaEmail).not.toHaveBeenCalled();
    });

    it("pagamento recusado na conferencia nao avisa", async () => {
      asaasMock.getCharge.mockResolvedValue({
        id: "pay_f", externalReference: "invoice_77", status: "RECEIVED", value: 10,
      });
      await webhook(PAGA, "token-do-painel");
      expect(emailMock.sendFaturaPagaEmail).not.toHaveBeenCalled();
    });

    it("Resend fora do ar nao vira 500 nem desfaz a quitacao", async () => {
      emailMock.sendFaturaPagaEmail.mockRejectedValueOnce(new Error("Resend 503"));
      const res = await webhook(PAGA, "token-do-painel");
      expect(res.status).toBe(200);
      expect(storageMock.updateProviderInvoiceAsaas).toHaveBeenCalledWith(77, expect.objectContaining({ status: "paid" }));
    });
  });

  describe("pelo botao sincronizar", () => {
    beforeEach(() => {
      sessao = { userId: 1, role: "superadmin" };
    });

    function sincronizar() {
      return fetch(`${base}/api/admin/invoices/77/asaas/sync`, { method: "POST" });
    }

    it("quitou agora: avisa uma vez", async () => {
      const res = await sincronizar();
      expect(res.status).toBe(200);
      expect(emailMock.sendFaturaPagaEmail).toHaveBeenCalledTimes(1);
      expect((emailMock.sendFaturaPagaEmail.mock.calls[0] as any[])[2]).toEqual({
        numero: "NF-2026-000077", competencia: "setembro de 2026", valor: 349,
      });
    });

    it("sincronizar de novo a mesma cobranca ja quitada nao repete o e-mail", async () => {
      storageMock.getProviderInvoice.mockResolvedValue({
        ...FATURA, status: "paid", paidDate: new Date("2026-09-02"), paidAmount: "349.00",
      });
      const res = await sincronizar();
      expect(res.status).toBe(200);
      expect(emailMock.sendFaturaPagaEmail).not.toHaveBeenCalled();
    });

    it("conferencia recusada nao avisa", async () => {
      asaasMock.getCharge.mockResolvedValue({
        id: "pay_f", externalReference: "invoice_77", status: "RECEIVED", value: 10, paymentDate: "2026-09-02",
      });
      const res = await sincronizar();
      expect(res.status).toBe(409);
      expect(emailMock.sendFaturaPagaEmail).not.toHaveBeenCalled();
    });

    it("status nao-pago nao avisa", async () => {
      asaasMock.getCharge.mockResolvedValue({
        id: "pay_f", externalReference: "invoice_77", status: "OVERDUE", value: 349,
      });
      await sincronizar();
      expect(emailMock.sendFaturaPagaEmail).not.toHaveBeenCalled();
    });
  });

  describe("pela mao do superadmin", () => {
    beforeEach(() => {
      sessao = { userId: 1, role: "superadmin" };
    });

    function marcar(body: unknown) {
      return fetch(`${base}/api/admin/invoices/77/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("marcar como paga avisa uma vez, com o valor da fatura", async () => {
      const res = await marcar({ status: "paid" });
      expect(res.status).toBe(200);
      expect(emailMock.sendFaturaPagaEmail).toHaveBeenCalledTimes(1);
      expect((emailMock.sendFaturaPagaEmail.mock.calls[0] as any[])[2]).toEqual({
        numero: "NF-2026-000077", competencia: "setembro de 2026", valor: 349,
      });
    });

    it("valor recebido informado a mao e o que aparece no e-mail", async () => {
      await marcar({ status: "paid", paidAmount: "300.00" });
      expect((emailMock.sendFaturaPagaEmail.mock.calls[0] as any[])[2].valor).toBe(300);
    });

    // O superadmin corrigindo o valor pago, ou clicando de novo, nao pode
    // render um segundo "recebemos o pagamento".
    it("marcar como paga uma fatura ja paga nao repete o e-mail", async () => {
      storageMock.getProviderInvoice.mockResolvedValue({
        ...FATURA, status: "paid", paidDate: new Date("2026-09-02"),
      });
      const res = await marcar({ status: "paid", paidAmount: "349.00" });
      expect(res.status).toBe(200);
      expect(emailMock.sendFaturaPagaEmail).not.toHaveBeenCalled();
    });

    it("qualquer outro status nao avisa", async () => {
      await marcar({ status: "cancelled" });
      expect(emailMock.sendFaturaPagaEmail).not.toHaveBeenCalled();
      expect(storageMock.updateProviderInvoiceStatus).toHaveBeenCalled();
    });

    // Sem a foto de antes nao da para saber se foi esta chamada que quitou;
    // o que nao pode e a leitura derrubar a alteracao de status.
    it("falha ao ler a fatura antes nao impede a mudanca de status", async () => {
      storageMock.getProviderInvoice.mockRejectedValueOnce(new Error("statement timeout"));
      const res = await marcar({ status: "paid" });
      expect(res.status).toBe(200);
      expect(storageMock.updateProviderInvoiceStatus).toHaveBeenCalled();
      expect(emailMock.sendFaturaPagaEmail).not.toHaveBeenCalled();
    });
  });
});

describe("aviso de fatura gerada", () => {
  beforeEach(() => {
    sessao = { userId: 1, role: "superadmin" };
  });

  describe("fatura avulsa", () => {
    function criar(body: unknown) {
      return fetch(`${base}/api/admin/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    const AVULSA = {
      providerId: 42, period: "2026-09", planAtTime: "pro",
      amount: "99.00", dueDate: "2026-09-10T12:00:00.000Z",
    };

    it("avisa o contato do provedor com numero, competencia, plano em portugues, valor e vencimento", async () => {
      const res = await criar(AVULSA);
      expect(res.status).toBe(201);
      expect(emailMock.sendFaturaGeradaEmail).toHaveBeenCalledTimes(1);
      const [para, nome, dados] = emailMock.sendFaturaGeradaEmail.mock.calls[0] as any[];
      expect(para).toBe("financeiro@nslink.com.br");
      expect(nome).toBe("NsLink Telecom");
      expect(dados).toMatchObject({
        numero: "NF-2026-000077",
        competencia: "setembro de 2026",
        plano: "Profissional",
        valor: 99,
        vencimento: "10/09/2026",
      });
    });

    // A cobranca Asaas nasce num segundo passo; enquanto ela nao existe, o
    // e-mail cai sozinho no botao "ver a fatura no painel".
    it("sem cobranca Asaas o e-mail sai sem link de pagamento", async () => {
      await criar(AVULSA);
      expect((emailMock.sendFaturaGeradaEmail.mock.calls[0] as any[])[2].linkDePagamento).toBeNull();
    });

    it("link do Asaas, quando ja existe, vai no e-mail", async () => {
      storageMock.createProviderInvoice.mockResolvedValueOnce({
        ...FATURA, asaasInvoiceUrl: "https://asaas/i/f",
      } as any);
      await criar(AVULSA);
      expect((emailMock.sendFaturaGeradaEmail.mock.calls[0] as any[])[2].linkDePagamento).toBe("https://asaas/i/f");
    });

    it("campo obrigatorio faltando nao gera fatura nem e-mail", async () => {
      const res = await criar({ providerId: 42, period: "2026-09" });
      expect(res.status).toBe(400);
      expect(emailMock.sendFaturaGeradaEmail).not.toHaveBeenCalled();
    });

    it("Resend fora do ar nao derruba a criacao da fatura", async () => {
      emailMock.sendFaturaGeradaEmail.mockRejectedValueOnce(new Error("Resend 503"));
      const res = await criar(AVULSA);
      expect(res.status).toBe(201);
      expect(storageMock.createProviderInvoice).toHaveBeenCalled();
    });

    it("sai com a marca do provedor e o endereco de entrada dele", async () => {
      storageMock.getProvider.mockResolvedValue({ ...PROVEDOR, marcaId: 7 });
      storageMock.getMarca.mockResolvedValue({ ...CREDNET });
      await criar(AVULSA);
      const [, , , marca, urlBase] = emailMock.sendFaturaGeradaEmail.mock.calls[0] as any[];
      expect(marca.nomeProduto).toBe("CredNet");
      expect(urlBase).toBe("https://app.crednet.com.br");
    });
  });

  describe("geracao mensal", () => {
    const NSLINK = { ...PROVEDOR };
    const CIALDN = {
      id: 43, name: "CialDN", contactEmail: "contato@cialdn.com.br",
      marcaId: null, subdomain: "cialdn", plan: "basic", ispCredits: 10,
    };
    const GRATUITO = { id: 44, name: "Teste", contactEmail: "t@t.com", marcaId: null, subdomain: "teste", plan: "free" };

    function gerar(period = "2026-09") {
      return fetch(`${base}/api/admin/invoices/generate-monthly`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
    }

    it("um e-mail por fatura gerada, para o contato de cada provedor", async () => {
      storageMock.getAllProviders.mockResolvedValue([NSLINK, CIALDN, GRATUITO]);
      const res = await gerar();
      expect(res.status).toBe(200);
      expect((await res.json()).created).toBe(2);
      expect(emailMock.sendFaturaGeradaEmail).toHaveBeenCalledTimes(2);
      const destinatarios = emailMock.sendFaturaGeradaEmail.mock.calls.map(c => (c as any[])[0]);
      expect(destinatarios).toEqual(["financeiro@nslink.com.br", "contato@cialdn.com.br"]);
    });

    it("cada e-mail leva o plano e o valor do proprio provedor", async () => {
      storageMock.getAllProviders.mockResolvedValue([NSLINK, CIALDN]);
      await gerar();
      const [, , nslink] = emailMock.sendFaturaGeradaEmail.mock.calls[0] as any[];
      const [, , cialdn] = emailMock.sendFaturaGeradaEmail.mock.calls[1] as any[];
      expect(nslink).toMatchObject({ plano: "Profissional", valor: 99, competencia: "setembro de 2026", vencimento: "10/09/2026" });
      expect(cialdn).toMatchObject({ plano: "Básico", valor: 149 });
    });

    it("provedor pulado por ja ter fatura no periodo nao recebe e-mail", async () => {
      storageMock.getAllProviders.mockResolvedValue([NSLINK, CIALDN]);
      storageMock.getAllProviderInvoices.mockImplementation(async (id: number) =>
        (id === 42 ? [{ period: "2026-09", status: "pending" }] : []) as any);
      const res = await gerar();
      expect((await res.json()).created).toBe(1);
      expect(emailMock.sendFaturaGeradaEmail).toHaveBeenCalledTimes(1);
      expect((emailMock.sendFaturaGeradaEmail.mock.calls[0] as any[])[0]).toBe("contato@cialdn.com.br");
    });

    // A geracao mensal e um lote: um Resend fora do ar no meio nao pode deixar
    // metade dos provedores sem fatura.
    it("falha de e-mail de um provedor nao impede a fatura nem o aviso dos outros", async () => {
      storageMock.getAllProviders.mockResolvedValue([NSLINK, CIALDN]);
      emailMock.sendFaturaGeradaEmail.mockRejectedValueOnce(new Error("Resend 503"));
      const res = await gerar();
      expect(res.status).toBe(200);
      expect((await res.json()).created).toBe(2);
      expect(storageMock.createProviderInvoice).toHaveBeenCalledTimes(2);
      expect(emailMock.sendFaturaGeradaEmail).toHaveBeenCalledTimes(2);
    });

    // Nenhum e-mail sai antes de a ultima fatura existir: e o que garante que um
    // envio lento nunca se meta entre duas gravacoes.
    it("nenhum e-mail sai antes de todas as faturas estarem gravadas", async () => {
      storageMock.getAllProviders.mockResolvedValue([NSLINK, CIALDN]);
      const ordem: string[] = [];
      storageMock.createProviderInvoice.mockImplementation(async (dados: any) => {
        ordem.push(`gravou:${dados.providerId}`);
        return { ...dados, id: 77 };
      });
      emailMock.sendFaturaGeradaEmail.mockImplementation(async () => { ordem.push("avisou"); });
      await gerar();
      expect(ordem).toEqual(["gravou:42", "gravou:43", "avisou", "avisou"]);
    });

    it("sem provedor pagante, ninguem e avisado", async () => {
      storageMock.getAllProviders.mockResolvedValue([GRATUITO]);
      const res = await gerar();
      expect((await res.json()).created).toBe(0);
      expect(emailMock.sendFaturaGeradaEmail).not.toHaveBeenCalled();
    });
  });
});
