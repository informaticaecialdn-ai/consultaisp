import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Comportamento da Consulta ISP EXCLUSIVO da demonstração pública (itens 2 e
 * 6 do plano de 2026-09-11, `.superpowers/sdd/2026-09-11-demo-sandbox/`),
 * contra a ROTA real (só os serviços de rede/ERP são mockados).
 *
 * Item 2 — isolamento de rede: CADA sandbox nasce com a PRÓPRIA integração
 * "demo" habilitada (`server/demo/sandbox.service.ts`), e a consulta ao vivo
 * (`server/routes/consultas.routes.ts`) varria a integração de TODOS os
 * sandboxes vivos ao mesmo tempo — até 150 — em vez de só os cinco
 * provedores do mundo base. Consultar um dos 150 CPFs compartilhados
 * (exatamente o que a demonstração convida a fazer) voltava um "Provedor
 * Parceiro · em dia" extra por sandbox alheio. Provado abaixo:
 *   1. a consulta só pergunta à PRÓPRIA integração e às do mundo base
 *      (subdomínio fora do prefixo `sandbox-`), nunca à de outro sandbox;
 *   2. fora da demonstração (integração sem `providerSubdomain`, o caso de
 *      produção), nada é filtrado — o comportamento de sempre;
 *   3. em modo demo, dois sandboxes concorrentes não compartilham o cache
 *      regional bruto de ERP entre si.
 *
 * Item 6 — proveniência do dado: o resultado da Consulta ISP passa a levar
 * `simulado: emModoDemo()`, para `ProvTag` mostrar "SIMULADO" em vez de
 * "REAL" na demonstração (ver `client/src/components/consulta/ConsultaResultSummary.tsx`).
 */

const PROPRIO = 501;
const OUTRO_SANDBOX = 777;
const REDE_1 = 1;
const REDE_2 = 2;
const CPF = "00752477714"; // CPF da lista de homologacao do SPC, DV valido

const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(),
  getAllEnabledErpIntegrationsWithCredentials: vi.fn(),
  getValidatedRecoverySignals: vi.fn(),
  getRecentConsultationsForDocument: vi.fn(),
  getCustomersByAddressForAlert: vi.fn(),
  createIspConsultation: vi.fn(),
  debitAndCreateIspConsultation: vi.fn(),
  debitAndCreateSpcConsultation: vi.fn(),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) =>
    req.session?.userId ? next() : res.status(401).json({ message: "Autenticacao necessaria" }),
  requireProvider: (req: any, res: any, next: any) =>
    Number(req.session?.providerId) > 0 ? next() : res.status(403).json({ message: "Somente provedores" }),
}));

vi.mock("../middleware/rate-limiter.middleware", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const regionalMock = vi.hoisted(() => ({ getRegionalProviderIds: vi.fn(async () => [] as number[]) }));
vi.mock("../services/regional.service", () => regionalMock);

const erpMock = vi.hoisted(() => ({
  queryRegionalErps: vi.fn(async () => [] as any[]),
  queryRegionalErpsByAddress: vi.fn(async () => [] as any[]),
}));
vi.mock("../services/realtime-query.service", () => erpMock);

const alertaMock = vi.hoisted(() => ({ notifyOwnerProviders: vi.fn(async () => undefined) }));
vi.mock("../services/proactive-alert.service", () => alertaMock);

// SpcError e statusHttpParaErroSpc continuam os reais: a rota faz `instanceof`.
const spcMock = vi.hoisted(() => ({ isSpcConfigured: vi.fn(() => true), consultarSpc: vi.fn() }));
vi.mock("../services/spc/spc.service", async (original) => ({
  ...(await original() as object),
  ...spcMock,
}));

import { registerConsultasRoutes } from "./consultas.routes";
import { consultationCache } from "../services/consultation-cache.service";

/** Uma integracao "demo" (ou de qualquer fonte) com o subdominio do provedor dela. */
function integracao(providerId: number, providerSubdomain: string | null | undefined, erpSource = "demo") {
  return {
    id: providerId, providerId, providerName: `Provedor ${providerId}`,
    erpSource, apiUrl: erpSource === "demo" ? "demo://mundo-base" : "https://erp.exemplo.invalido",
    apiToken: "t", apiUser: null, providerSubdomain,
  };
}

function erpResult(providerId: number) {
  return {
    providerId, providerName: `Provedor ${providerId}`, erpSource: "demo", ok: true,
    customers: [{
      cpfCnpj: CPF, name: "Cliente Teste", totalOverdueAmount: 0, maxDaysOverdue: 0,
      overdueInvoicesCount: 0, contractStatus: "active",
    }],
    latencyMs: 5,
  };
}

let server: Server;
let base: string;
let sessao: Record<string, unknown> = {};

beforeAll(async () => {
  // O hash de rede e o codigo de parceiro leem o ambiente na primeira chamada
  // (mesmo requisito de consultas-identificador.test.ts).
  process.env.NETWORK_CPF_SALT = "s".repeat(64);
  process.env.PARTNER_CODE_SECRET = "p".repeat(64);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerConsultasRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  consultationCache.invalidateAll();
  sessao = { userId: 1, providerId: PROPRIO, role: "admin" };

  storageMock.getProvider.mockResolvedValue({ id: PROPRIO, name: "Sandbox Proprio", ispCredits: 500 });
  storageMock.getValidatedRecoverySignals.mockResolvedValue([]);
  storageMock.getRecentConsultationsForDocument.mockResolvedValue([]);
  storageMock.getCustomersByAddressForAlert.mockResolvedValue([]);
  storageMock.createIspConsultation.mockImplementation(async (p: any) => ({ id: 1, createdAt: new Date(), ...p }));
  storageMock.debitAndCreateIspConsultation.mockImplementation(async (_p: number, _c: number, payload: any) => ({
    provider: { id: PROPRIO, ispCredits: 499 },
    consultation: { id: 2, createdAt: new Date(), ...payload },
  }));

  regionalMock.getRegionalProviderIds.mockResolvedValue([]);
  erpMock.queryRegionalErpsByAddress.mockResolvedValue([]);
});

async function consultar(providerId: number) {
  sessao.providerId = providerId;
  const res = await fetch(`${base}/api/isp-consultations`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cpfCnpj: CPF, lgpdAccepted: true }),
  });
  return { status: res.status, body: await res.json() as any };
}

describe("consulta ao vivo — isolamento de rede da demonstracao (item 2)", () => {
  it("um sandbox nunca pergunta ao ERP de OUTRO sandbox — so o proprio + o mundo base", async () => {
    storageMock.getAllEnabledErpIntegrationsWithCredentials.mockResolvedValue([
      integracao(PROPRIO, "sandbox-aaaa"),
      integracao(OUTRO_SANDBOX, "sandbox-bbbb"),
      integracao(REDE_1, "rede-1"),
      integracao(REDE_2, "rede-2"),
    ]);
    erpMock.queryRegionalErps.mockResolvedValue([erpResult(PROPRIO), erpResult(REDE_1), erpResult(REDE_2)]);

    const { status } = await consultar(PROPRIO);
    expect(status).toBe(200);

    const [integracoesPerguntadas] = erpMock.queryRegionalErps.mock.calls[0];
    const idsPerguntados = (integracoesPerguntadas as any[]).map(i => i.providerId).sort((a, b) => a - b);
    expect(idsPerguntados).toEqual([PROPRIO, REDE_1, REDE_2].sort((a, b) => a - b));
    expect(idsPerguntados).not.toContain(OUTRO_SANDBOX);
  });

  it("sem providerSubdomain (o caso de producao, fora da demonstracao) nada e filtrado", async () => {
    storageMock.getAllEnabledErpIntegrationsWithCredentials.mockResolvedValue([
      integracao(REDE_1, undefined, "ixc"),
    ]);
    erpMock.queryRegionalErps.mockResolvedValue([erpResult(REDE_1)]);

    const { status } = await consultar(PROPRIO);
    expect(status).toBe(200);
    const [integracoesPerguntadas] = erpMock.queryRegionalErps.mock.calls[0];
    expect((integracoesPerguntadas as any[]).map(i => i.providerId)).toEqual([REDE_1]);
  });

  it("em modo demo, dois sandboxes concorrentes nao compartilham o cache regional bruto entre si", async () => {
    process.env.DEMO_MODE = "true";
    try {
      storageMock.getAllEnabledErpIntegrationsWithCredentials
        .mockResolvedValueOnce([integracao(PROPRIO, "sandbox-aaaa"), integracao(REDE_1, "rede-1")])
        .mockResolvedValueOnce([integracao(OUTRO_SANDBOX, "sandbox-bbbb"), integracao(REDE_1, "rede-1")]);
      erpMock.queryRegionalErps
        .mockResolvedValueOnce([erpResult(PROPRIO), erpResult(REDE_1)])
        .mockResolvedValueOnce([erpResult(OUTRO_SANDBOX), erpResult(REDE_1)]);

      const primeira = await consultar(PROPRIO);
      expect(primeira.status).toBe(200);
      const segunda = await consultar(OUTRO_SANDBOX);
      expect(segunda.status).toBe(200);

      // Sem cache POR sandbox, a segunda chamada reaproveitaria o bruto da
      // primeira (mesmo CPF, mesma chave regional) e jamais chamaria
      // queryRegionalErps de novo — o próprio ERP do segundo sandbox nunca
      // seria perguntado.
      expect(erpMock.queryRegionalErps).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.DEMO_MODE;
    }
  });
});

/**
 * Item 6 do plano de 2026-09-11: o relatório da Consulta ISP era o único dos
 * três bureaus (SPC e Cadastral já levam `simulado`) sem nenhum jeito de a
 * tela distinguir dado real de dado fictício — `ProvTag` mostrava "REAL"
 * (tecnicamente verdade: o conector "demo" respondeu ao vivo) ao lado de uma
 * carteira inteira fictícia.
 */
describe("resultado da Consulta ISP leva 'simulado' quando emModoDemo() (item 6)", () => {
  const original = process.env.DEMO_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = original;
  });

  it("em modo demo, o resultado leva simulado:true", async () => {
    process.env.DEMO_MODE = "true";
    storageMock.getAllEnabledErpIntegrationsWithCredentials.mockResolvedValue([integracao(PROPRIO, "sandbox-aaaa")]);
    erpMock.queryRegionalErps.mockResolvedValue([erpResult(PROPRIO)]);

    const { status, body } = await consultar(PROPRIO);

    expect(status).toBe(200);
    expect(body.result.simulado).toBe(true);
  });

  it("fora do modo demo (producao), o resultado nunca leva simulado:true", async () => {
    delete process.env.DEMO_MODE;
    storageMock.getAllEnabledErpIntegrationsWithCredentials.mockResolvedValue([integracao(REDE_1, undefined, "ixc")]);
    erpMock.queryRegionalErps.mockResolvedValue([erpResult(REDE_1)]);

    const { status, body } = await consultar(PROPRIO);

    expect(status).toBe(200);
    expect(body.result.simulado).toBeFalsy();
  });
});
