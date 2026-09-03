import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * O identificador de consulta nas rotas de Consulta ISP e Consulta SPC.
 *
 * O contrato que estes testes fixam, ramo a ramo:
 *   1. um codigo por REQUISICAO, sorteado antes de qualquer coisa que falhe;
 *   2. a linha gravada leva o codigo na coluna;
 *   3. TODA resposta leva o codigo — inclusive as de erro, que sao justamente
 *      as que o provedor leva ao suporte;
 *   4. cache hit devolve o codigo da consulta ORIGINAL, nunca um novo;
 *   5. toda linha de log daquele caminho leva o campo `consultaId`;
 *   6. caminho que NAO grava linha ainda assim loga, com o motivo.
 */

const FORMATO = /^CI-\d{4}-[23456789ABCDEFGHJKLMNPQRSTVWXYZ]{6}$/;

const CPF = "00752477714";     // CPF da lista de homologacao do SPC, DV valido
const PROVEDOR = 42;
const PARCEIRO = 99;

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

// O limite de 10/min existe em producao; aqui ele so tornaria a suite refem da
// ordem dos testes.
vi.mock("../middleware/rate-limiter.middleware", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const loggerMock = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../logger", () => loggerMock);

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
const spcMock = vi.hoisted(() => ({
  isSpcConfigured: vi.fn(() => true),
  consultarSpc: vi.fn(),
}));
vi.mock("../services/spc/spc.service", async (original) => ({
  ...(await original() as object),
  ...spcMock,
}));

import { registerConsultasRoutes } from "./consultas.routes";
import { consultationCache } from "../services/consultation-cache.service";
import { SpcError } from "../services/spc/spc-parser";

let server: Server;
let base: string;
let sessao: Record<string, unknown> = {};

/** Um resultado de ERP com um cliente do provedor indicado. */
function erpResult(providerId: number, extras: Record<string, unknown> = {}) {
  return {
    providerId,
    providerName: providerId === PROVEDOR ? "Provedor Teste" : "Parceiro Teste",
    erpSource: "ixc",
    ok: true,
    customers: [{
      cpfCnpj: CPF,
      name: "Maria Teste",
      totalOverdueAmount: 250,
      maxDaysOverdue: 45,
      overdueInvoicesCount: 2,
      contractStatus: "active",
      ...extras,
    }],
    latencyMs: 12,
  };
}

function integracao(providerId: number) {
  return {
    id: providerId, providerId, providerName: providerId === PROVEDOR ? "Provedor Teste" : "Parceiro Teste",
    erpSource: "ixc", apiUrl: "https://erp.exemplo.invalido", apiToken: "t", apiUser: "u", isActive: true,
  };
}

beforeAll(async () => {
  // O hash de rede e o codigo de parceiro leem o ambiente na primeira chamada.
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
  sessao = { userId: 7, providerId: PROVEDOR, role: "admin" };

  storageMock.getProvider.mockResolvedValue({ id: PROVEDOR, name: "Provedor Teste", ispCredits: 500 });
  storageMock.getAllEnabledErpIntegrationsWithCredentials.mockResolvedValue([integracao(PROVEDOR)]);
  storageMock.getValidatedRecoverySignals.mockResolvedValue([]);
  storageMock.getRecentConsultationsForDocument.mockResolvedValue([]);
  storageMock.getCustomersByAddressForAlert.mockResolvedValue([]);
  storageMock.createIspConsultation.mockImplementation(async (payload: any) => ({ id: 1, createdAt: new Date(), ...payload }));
  storageMock.debitAndCreateIspConsultation.mockImplementation(async (_p: number, _c: number, payload: any) => ({
    provider: { id: PROVEDOR, ispCredits: 499 },
    consultation: { id: 2, createdAt: new Date(), ...payload },
  }));
  storageMock.debitAndCreateSpcConsultation.mockImplementation(async (_p: number, _c: number, payload: any) => ({
    provider: { id: PROVEDOR, ispCredits: 498 },
    consultation: { id: 3, createdAt: new Date(), ...payload },
  }));

  regionalMock.getRegionalProviderIds.mockResolvedValue([]);
  erpMock.queryRegionalErps.mockResolvedValue([erpResult(PROVEDOR)]);
  erpMock.queryRegionalErpsByAddress.mockResolvedValue([]);
  spcMock.isSpcConfigured.mockReturnValue(true);
});

async function consultarIsp(body: unknown = { cpfCnpj: CPF, lgpdAccepted: true }) {
  const res = await fetch(`${base}/api/isp-consultations`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

async function consultarSpcNaRota(body: unknown = { cpfCnpj: CPF }) {
  const res = await fetch(`${base}/api/spc-consultations`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

/** Toda chamada ao logger feita durante a requisicao, achatada. */
function linhasDeLog(): Array<{ contexto: any; mensagem: string }> {
  return [
    ...loggerMock.logger.info.mock.calls,
    ...loggerMock.logger.warn.mock.calls,
    ...loggerMock.logger.error.mock.calls,
  ].map(([contexto, mensagem]: any[]) => ({ contexto, mensagem: String(mensagem ?? "") }));
}

function acharLog(trecho: string) {
  return linhasDeLog().find(l => l.mensagem.includes(trecho));
}

describe("POST /api/isp-consultations — identificador", () => {
  it("grava o codigo na linha e devolve o MESMO na resposta", async () => {
    const { status, body } = await consultarIsp();

    expect(status).toBe(200);
    expect(body.consultaId).toMatch(FORMATO);
    expect(storageMock.createIspConsultation).toHaveBeenCalledTimes(1);
    const gravado = storageMock.createIspConsultation.mock.calls[0][0] as any;
    expect(gravado.consultaId).toBe(body.consultaId);
  });

  it("cada requisicao ganha um codigo proprio", async () => {
    const primeira = await consultarIsp();
    consultationCache.invalidateAll();
    const segunda = await consultarIsp();
    expect(primeira.body.consultaId).not.toBe(segunda.body.consultaId);
  });

  it("leva o codigo ao servico de consulta ao vivo — e a essas linhas que o log do ERP se amarra", async () => {
    const { body } = await consultarIsp();
    const opcoes = erpMock.queryRegionalErps.mock.calls[0][3] as any;
    expect(opcoes).toEqual({ consultaId: body.consultaId });
  });

  it("nenhuma linha de log do caminho sai sem o campo consultaId", async () => {
    const { body } = await consultarIsp();
    const linhas = linhasDeLog();
    expect(linhas.length).toBeGreaterThan(0);
    for (const linha of linhas) {
      expect(linha.contexto?.consultaId, `linha sem codigo: ${linha.mensagem}`).toBe(body.consultaId);
    }
  });

  it("cache hit devolve o codigo da consulta ORIGINAL, nao um novo", async () => {
    const primeira = await consultarIsp();
    expect(primeira.body.consultaId).toMatch(FORMATO);

    const segunda = await consultarIsp();
    expect(segunda.body.source).toBe("cache");
    expect(segunda.body.consultaId).toBe(primeira.body.consultaId);
    // Nada novo foi gravado: um codigo novo mandaria o suporte procurar uma
    // linha que nao existe.
    expect(storageMock.createIspConsultation).toHaveBeenCalledTimes(1);
    expect(acharLog("CONSULTA cache hit")?.contexto.consultaId).toBe(primeira.body.consultaId);
  });

  it("cache de consulta anterior a esta versao responde SEM codigo — ela nasceu sem", async () => {
    consultationCache.setResult(CPF, PROVEDOR, "cpf", {
      result: { cpfCnpj: CPF, source: "erp_direct" } as any,
      consultation: { id: 900, providerId: PROVEDOR },   // linha antiga: sem consultaId
      cachedAt: Date.now(),
    });

    const { status, body } = await consultarIsp();
    expect(status).toBe(200);
    expect(body.source).toBe("cache");
    expect(body).not.toHaveProperty("consultaId");
    // O sorteio da requisicao fica no log, so para provar que ela existiu.
    expect(acharLog("CONSULTA cache hit")?.contexto.novoSorteioDescartado).toMatch(FORMATO);
  });

  it("sem ERP na regiao nada e gravado — a resposta leva o codigo e o log diz o motivo", async () => {
    storageMock.getAllEnabledErpIntegrationsWithCredentials.mockResolvedValue([]);

    const { status, body } = await consultarIsp();
    expect(status).toBe(200);
    expect(body.consultaId).toMatch(FORMATO);
    expect(body.consultation).toBeNull();
    expect(storageMock.createIspConsultation).not.toHaveBeenCalled();

    const linha = acharLog("CONSULTA sem resultado — nada gravado");
    expect(linha?.contexto).toMatchObject({ consultaId: body.consultaId, motivo: "sem_erp_na_regiao" });
  });

  it("402 sem saldo: a consulta ja rodou e nada sobrou no banco — codigo na resposta e no log", async () => {
    regionalMock.getRegionalProviderIds.mockResolvedValue([PARCEIRO]);
    storageMock.getAllEnabledErpIntegrationsWithCredentials.mockResolvedValue([
      integracao(PROVEDOR), integracao(PARCEIRO),
    ]);
    erpMock.queryRegionalErps.mockResolvedValue([erpResult(PROVEDOR), erpResult(PARCEIRO)]);
    storageMock.debitAndCreateIspConsultation.mockResolvedValue(null);   // saldo nao cobriu
    storageMock.getProvider.mockResolvedValue({ id: PROVEDOR, name: "Provedor Teste", ispCredits: 0 });

    const { status, body } = await consultarIsp();
    expect(status).toBe(402);
    expect(body.consultaId).toMatch(FORMATO);

    const linha = acharLog("CONSULTA executada mas nao gravada");
    expect(linha?.contexto).toMatchObject({ consultaId: body.consultaId, motivo: "saldo_insuficiente" });
  });

  it("erro 500 responde com o codigo, e o mesmo codigo esta no logger.error", async () => {
    storageMock.getAllEnabledErpIntegrationsWithCredentials.mockRejectedValue(new Error("banco fora"));

    const { status, body } = await consultarIsp();
    expect(status).toBe(500);
    expect(body.consultaId).toMatch(FORMATO);

    // `getSafeErrorMessage` emite uma segunda linha, sem contexto, para todas
    // as rotas do sistema (server/utils/safe-error.ts) — nao e a linha da
    // consulta. A da consulta e esta, e ela leva o codigo.
    expect(acharLog("ISP consultation error")?.contexto.consultaId).toBe(body.consultaId);
  });

  it("documento invalido: resposta com codigo e log dizendo que nada foi gravado", async () => {
    const { status, body } = await consultarIsp({ cpfCnpj: "12345678900", lgpdAccepted: true });
    expect(status).toBe(400);
    expect(body.consultaId).toMatch(FORMATO);
    expect(acharLog("CONSULTA recusada — nada gravado")?.contexto).toMatchObject({
      consultaId: body.consultaId, motivo: "documento_invalido",
    });
  });

  it("nao vaza documento nem nome nas linhas de log do identificador", async () => {
    await consultarIsp();
    for (const linha of linhasDeLog()) {
      const texto = JSON.stringify(linha.contexto ?? {});
      expect(texto).not.toContain(CPF);
      expect(texto).not.toContain("Maria Teste");
    }
  });
});

describe("POST /api/spc-consultations — identificador", () => {
  const resultadoSpc = {
    protocolo: "14723249770-10",
    restricao: false,
    status: "clear",
    score: 800,
    restrictions: [],
    cadastralData: { tipo: "PF", nome: "Maria Teste", cpfCnpj: CPF },
    rawXml: "<S:Envelope/>",
  };

  it("grava o codigo na linha, devolve na resposta e o passa ao servico do SPC", async () => {
    spcMock.consultarSpc.mockResolvedValue({ ...resultadoSpc });

    const { status, body } = await consultarSpcNaRota();
    expect(status).toBe(200);
    expect(body.consultaId).toMatch(FORMATO);

    const [documento, opcoes] = spcMock.consultarSpc.mock.calls[0] as any[];
    expect(documento).toBe(CPF);
    expect(opcoes).toMatchObject({ guardarXml: true, consultaId: body.consultaId });

    const gravado = storageMock.debitAndCreateSpcConsultation.mock.calls[0][2] as any;
    expect(gravado.consultaId).toBe(body.consultaId);
  });

  it("o nosso codigo nao e o protocolo do SPC", async () => {
    spcMock.consultarSpc.mockResolvedValue({ ...resultadoSpc });
    const { body } = await consultarSpcNaRota();
    expect(body.result.protocolo).toBe("14723249770-10");
    expect(body.consultaId).not.toBe(body.result.protocolo);
  });

  it("erro do SPC: a resposta leva o codigo — e nele que o SPC nao devolve protocolo nenhum", async () => {
    spcMock.consultarSpc.mockRejectedValue(
      new SpcError("SPC indisponível (tempo esgotado)", "REDE", "indisponivel"),
    );

    const { status, body } = await consultarSpcNaRota();
    expect(status).toBe(502);
    expect(body.consultaId).toMatch(FORMATO);
    expect(body).not.toHaveProperty("protocolo");
    expect(acharLog("SPC consultation refused")?.contexto.consultaId).toBe(body.consultaId);
  });

  it("SPC nao configurado (503) responde com o codigo e loga o motivo", async () => {
    spcMock.isSpcConfigured.mockReturnValue(false);

    const { status, body } = await consultarSpcNaRota();
    expect(status).toBe(503);
    expect(body.consultaId).toMatch(FORMATO);
    expect(spcMock.consultarSpc).not.toHaveBeenCalled();
    expect(acharLog("CONSULTA SPC recusada — nada gravado")?.contexto).toMatchObject({
      consultaId: body.consultaId, motivo: "spc_nao_configurado",
    });
  });

  it("saldo insuficiente antes da consulta: codigo na resposta e no log, sem tocar o SPC", async () => {
    storageMock.getProvider.mockResolvedValue({ id: PROVEDOR, name: "Provedor Teste", ispCredits: 0 });

    const { status, body } = await consultarSpcNaRota();
    expect(status).toBe(402);
    expect(body.consultaId).toMatch(FORMATO);
    expect(spcMock.consultarSpc).not.toHaveBeenCalled();
    expect(acharLog("CONSULTA SPC recusada — nada gravado")?.contexto).toMatchObject({
      consultaId: body.consultaId, motivo: "saldo_insuficiente",
    });
  });

  it("saldo caiu entre a conferencia e o debito: consulta feita, linha nao gravada, codigo mantido", async () => {
    spcMock.consultarSpc.mockResolvedValue({ ...resultadoSpc });
    storageMock.debitAndCreateSpcConsultation.mockResolvedValue(null);

    const { status, body } = await consultarSpcNaRota();
    expect(status).toBe(402);
    expect(body.consultaId).toMatch(FORMATO);
    expect(acharLog("CONSULTA SPC executada mas nao gravada")?.contexto).toMatchObject({
      consultaId: body.consultaId, motivo: "saldo_insuficiente_no_debito",
    });
  });

  it("erro inesperado (500) responde com o codigo e o logger.error carrega o mesmo", async () => {
    spcMock.consultarSpc.mockRejectedValue(new Error("falha inesperada"));

    const { status, body } = await consultarSpcNaRota();
    expect(status).toBe(500);
    expect(body.consultaId).toMatch(FORMATO);
    expect(acharLog("SPC consultation error")?.contexto.consultaId).toBe(body.consultaId);
  });
});
