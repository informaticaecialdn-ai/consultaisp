import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * GET /api/spc-consultations/:id/pdf — o relatório da consulta SPC como
 * arquivo, montado da LINHA gravada e só para o provedor dono dela. O
 * download vai ao log sem o documento consultado. E POST /api/spc-consultations
 * passa a devolver o `id` da linha: é com ele que a tela monta o link.
 *
 * Contra a ROTA real; só storage, auth, limitador e o serviço do SPC são dublados.
 */
const PROPRIO = 501;
const CPF = "00752477714"; // CPF da lista de homologacao do SPC, DV valido

const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(),
  getSpcConsultation: vi.fn(),
  getSpcConsultationsByProvider: vi.fn(async () => [] as any[]),
  getSpcConsultationCountToday: vi.fn(async () => 0),
  getSpcConsultationCountMonth: vi.fn(async () => 0),
  debitAndCreateSpcConsultation: vi.fn(),
  getAllEnabledErpIntegrationsWithCredentials: vi.fn(async () => [] as any[]),
  getValidatedRecoverySignals: vi.fn(async () => [] as any[]),
  getRecentConsultationsForDocument: vi.fn(async () => [] as any[]),
  getCustomersByAddressForAlert: vi.fn(async () => [] as any[]),
  createIspConsultation: vi.fn(),
  debitAndCreateIspConsultation: vi.fn(),
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
const loggerMock = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../logger", () => loggerMock);
vi.mock("../services/regional.service", () => ({ getRegionalProviderIds: vi.fn(async () => [] as number[]) }));
vi.mock("../services/realtime-query.service", () => ({
  queryRegionalErps: vi.fn(async () => [] as any[]),
  queryRegionalErpsByAddress: vi.fn(async () => [] as any[]),
}));
vi.mock("../services/proactive-alert.service", () => ({ notifyOwnerProviders: vi.fn(async () => undefined) }));
const spcMock = vi.hoisted(() => ({ isSpcConfigured: vi.fn(() => true), consultarSpc: vi.fn() }));
vi.mock("../services/spc/spc.service", async (original) => ({
  ...(await original() as object),
  ...spcMock,
}));

import { registerConsultasRoutes } from "./consultas.routes";

function resultado(extra: Record<string, unknown> = {}) {
  return {
    cpfCnpj: CPF, protocolo: "SPC-2026-000123", consultadoEm: "2026-09-16T14:04:58.000Z", restricao: false,
    cadastralData: { nome: "Maria da Silva", cpfCnpj: CPF, situacaoRf: "REGULAR", obitoRegistrado: false, tipo: "PF" },
    score: 832, riskLevel: "low", riskLabel: "Risco baixo", recommendation: "Aprovar", status: "clean",
    restrictions: [], totalRestrictions: 0, resumo: {}, pendenciasFinanceiras: [],
    previousConsultations: { total: 0, last90Days: 0, diasConsiderados: 90, bySegment: {}, lista: [] },
    alerts: [], rendaPresumida: null, limiteCreditoSugerido: null, basesInoperantes: [],
    ...extra,
  };
}

function linha(extra: Record<string, unknown> = {}) {
  return {
    id: 91, providerId: PROPRIO, userId: 1, cpfCnpj: CPF, score: 832, consultaId: "CI-2609-K7F3M2",
    createdAt: new Date("2026-09-16T14:05:00.000Z"),
    result: { ...resultado(), rawXml: "<xml>SEGREDO-DO-XML</xml>", creditosCobrados: 3 },
    ...extra,
  };
}

/** Os textos de um PDF sem compressão saem como <hex> WinAnsi; espaços fora, para a quebra de linha não importar. */
function textoDoPdf(pdf: Buffer): string {
  const conteudo = pdf.toString("latin1");
  const corpo = conteudo.slice(0, conteudo.lastIndexOf("trailer"));
  return Array.from(corpo.matchAll(/<([0-9a-fA-F]+)>/g)).map(m => Buffer.from(m[1], "hex").toString("latin1")).join("").replace(/\s+/g, "");
}

let server: Server;
let base: string;
let sessao: Record<string, unknown> = {};

beforeAll(async () => {
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
  sessao = { userId: 1, providerId: PROPRIO, role: "admin" };
  storageMock.getProvider.mockResolvedValue({ id: PROPRIO, name: "NsLink Provedor", ispCredits: 500, status: "active" });
  storageMock.getSpcConsultation.mockResolvedValue(linha());
});

describe("GET /api/spc-consultations/:id/pdf", () => {
  it("devolve o relatório como anexo PDF, nomeado pelo código da consulta, com o conteúdo da tela e sem o XML", async () => {
    const res = await fetch(`${base}/api/spc-consultations/91/pdf`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="consulta-spc-CI-2609-K7F3M2.pdf"');
    expect(res.headers.get("cache-control")).toContain("no-store");
    const pdf = Buffer.from(await res.arrayBuffer());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const texto = textoDoPdf(pdf);
    expect(texto).toContain("MariadaSilva");
    expect(texto).toContain("CI-2609-K7F3M2");
    expect(texto).toContain("NsLinkProvedor");
    expect(texto).not.toContain("SEGREDO-DO-XML");
    expect(storageMock.getSpcConsultation).toHaveBeenCalledWith(PROPRIO, 91);
  });

  it("consulta de OUTRO provedor é 404: o storage só procura no tenant da sessão", async () => {
    storageMock.getSpcConsultation.mockResolvedValue(undefined);

    const res = await fetch(`${base}/api/spc-consultations/91/pdf`);

    expect(res.status).toBe(404);
    expect(storageMock.getSpcConsultation).toHaveBeenCalledWith(PROPRIO, 91);
  });

  it("id que não é número inteiro positivo é 400, sem ir ao banco", async () => {
    for (const id of ["abc", "0", "-3", "1.5"]) {
      const res = await fetch(`${base}/api/spc-consultations/${id}/pdf`);
      expect(res.status, id).toBe(400);
    }
    expect(storageMock.getSpcConsultation).not.toHaveBeenCalled();
  });

  it("o download vai ao log com provedor, usuário e ids — nunca o documento consultado", async () => {
    await fetch(`${base}/api/spc-consultations/91/pdf`);

    const chamada = loggerMock.logger.info.mock.calls.find(c => /PDF/i.test(String(c[1])));
    expect(chamada).toBeDefined();
    expect(chamada![0]).toMatchObject({ providerId: PROPRIO, userId: 1, spcConsultationId: 91, consultaId: "CI-2609-K7F3M2" });
    expect(JSON.stringify(loggerMock.logger.info.mock.calls)).not.toContain(CPF);
  });

  it("na demonstração o PDF sai marcado como simulado", async () => {
    storageMock.getSpcConsultation.mockResolvedValue(linha({ result: { ...resultado({ simulado: true }), creditosCobrados: 3 } }));

    const res = await fetch(`${base}/api/spc-consultations/91/pdf`);

    expect(res.status).toBe(200);
    expect(textoDoPdf(Buffer.from(await res.arrayBuffer()))).toContain("SIMULADO");
  });

  it("sem sessão é 401", async () => {
    sessao = {};
    const res = await fetch(`${base}/api/spc-consultations/91/pdf`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/spc-consultations devolve o id da linha gravada", () => {
  it("a resposta leva `id` ao lado do código, do resultado e do saldo", async () => {
    spcMock.consultarSpc.mockResolvedValue({ ...resultado(), rawXml: "<xml/>" });
    storageMock.debitAndCreateSpcConsultation.mockImplementation(async (_p: number, _c: number, payload: any) => ({
      provider: { id: PROPRIO, ispCredits: 497 },
      consultation: { id: 123, createdAt: new Date(), ...payload },
    }));

    const res = await fetch(`${base}/api/spc-consultations`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cpfCnpj: CPF }),
    });

    expect(res.status).toBe(200);
    const corpo = await res.json() as any;
    expect(corpo.id).toBe(123);
    expect(corpo.consultaId).toMatch(/^CI-/);
    expect(corpo.result.cadastralData.nome).toBe("Maria da Silva");
    expect(corpo.result.rawXml).toBeUndefined();
  });
});
