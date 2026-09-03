import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A regra que faz o "30 créditos inclusos" do Profissional deixar de ser
 * promessa e virar saldo. O que estes testes protegem:
 *
 * 1. A quantidade sai da FATURA, não da tabela de planos — quem pagou recebe o
 *    que estava escrito na conta dele, mesmo que o catálogo mude depois.
 * 2. Número estranho nunca vira débito.
 * 3. Falha ao creditar não derruba quem chamou: a fatura já foi paga.
 */
const storageMock = vi.hoisted(() => ({
  addCredits: vi.fn(async () => ({ id: 1, ispCredits: 79 })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { creditarPlanoDaFatura, creditosDaFatura } from "./credito-do-plano";

const fatura = (over: Record<string, unknown> = {}) => ({
  id: 128, providerId: 42, invoiceNumber: "NF-2026-000128",
  planAtTime: "pro", ispCreditsIncluded: 30, spcCreditsIncluded: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.addCredits.mockResolvedValue({ id: 1, ispCredits: 79 } as any);
});

describe("creditosDaFatura", () => {
  it("le o que a fatura declara", () => {
    expect(creditosDaFatura(fatura())).toEqual({ isp: 30, spc: 0 });
  });

  it("valor negativo ou lixo vira zero: credito nunca subtrai saldo", () => {
    expect(creditosDaFatura(fatura({ ispCreditsIncluded: -50 }))).toEqual({ isp: 0, spc: 0 });
    expect(creditosDaFatura(fatura({ ispCreditsIncluded: "trinta" }))).toEqual({ isp: 0, spc: 0 });
    expect(creditosDaFatura(fatura({ ispCreditsIncluded: null, spcCreditsIncluded: undefined }))).toEqual({ isp: 0, spc: 0 });
  });

  it("fracao e truncada: nao existe meio credito", () => {
    expect(creditosDaFatura(fatura({ ispCreditsIncluded: 30.9 }))).toEqual({ isp: 30, spc: 0 });
  });
});

describe("creditarPlanoDaFatura", () => {
  it("concede o que a fatura declara e devolve o saldo novo", async () => {
    const r = await creditarPlanoDaFatura(fatura());

    expect(storageMock.addCredits).toHaveBeenCalledWith(42, 30, 0);
    expect(r).toEqual({ concedeu: true, isp: 30, spc: 0, saldo: 79 });
  });

  // O Gratuito nao gera fatura; se gerar uma avulsa sem credito, nao ha o que dar.
  it("fatura sem credito incluso nao toca no saldo", async () => {
    const r = await creditarPlanoDaFatura(fatura({ ispCreditsIncluded: 0, spcCreditsIncluded: 0 }));

    expect(storageMock.addCredits).not.toHaveBeenCalled();
    expect(r).toEqual({ concedeu: false, isp: 0, spc: 0, saldo: null });
  });

  /**
   * A fatura ja esta paga quando isto roda. Propagar a excecao faria a rota
   * devolver erro para um pagamento que entrou — e, no caso do webhook, faria
   * o Asaas reentregar o evento e tentar creditar de novo.
   */
  it("falha ao creditar nao propaga: a fatura continua paga", async () => {
    storageMock.addCredits.mockRejectedValueOnce(new Error("connection terminated"));

    const r = await creditarPlanoDaFatura(fatura());

    expect(r).toEqual({ concedeu: false, isp: 30, spc: 0, saldo: null });
  });

  it("usa o numero da fatura, e nao a tabela de planos, para saber quanto dar", async () => {
    await creditarPlanoDaFatura(fatura({ ispCreditsIncluded: 12, planAtTime: "pro" }));

    expect(storageMock.addCredits).toHaveBeenCalledWith(42, 12, 0);
  });
});
