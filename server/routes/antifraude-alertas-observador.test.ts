/**
 * GET /api/anti-fraud/alerts — a situação de HOJE de cada cliente citado sai de
 * `getCustomerByCpfCnpj`, que na demonstração tira o sandbox de outro visitante
 * (auditoria de isolamento de 13/09/2026, L1). Sem o provedor da sessão como
 * observador, o mesmo filtro tiraria o sandbox do PRÓPRIO visitante, e o card
 * de fuga perderia a situação de hoje. Aqui se prende o argumento; o filtro em
 * si está em `server/storage/customers-fora-de-sandbox.test.ts`.
 *
 * `requireAuth`/`requireProvider` viram passagem: o que se prova é o que a rota
 * faz depois da porta, e a porta tem teste próprio (`antifraude.routes.test.ts`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "segredo-de-teste-sem-nenhum-valor-real";
  process.env.PARTNER_CODE_SECRET = "p".repeat(64);
});
vi.mock("express-session", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("connect-pg-simple", () => ({ default: () => class MockPgStore {} }));
vi.mock("../db", () => ({ pool: {}, db: {} }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../auth", async (original) => ({
  ...(await original() as object),
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireProvider: (_req: any, _res: any, next: any) => next(),
}));

const PROVEDOR = 501;
const CONSULENTE = 2;
const CPF = "99950400007";

const storageMock = vi.hoisted(() => ({
  getAlertsByProvider: vi.fn(async (_id: number): Promise<any[]> => []),
  getProactiveAlertsByProvider: vi.fn(async (_id: number, _limite: number): Promise<any[]> => []),
  getAntiFraudRules: vi.fn(async (_id: number): Promise<any[]> => []),
  getCustomerByCpfCnpj: vi.fn(async (_doc: string, _observador?: number): Promise<any[]> => []),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

let server: Server;
let base: string;

beforeAll(async () => {
  const { registerAntiFraudeRoutes } = await import("./antifraude.routes");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: 1, providerId: PROVEDOR, role: "admin" };
    next();
  });
  app.use(registerAntiFraudeRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => { vi.clearAllMocks(); });

describe("GET /api/anti-fraud/alerts — o snapshot do cliente é lido com o provedor da sessão como observador", () => {
  it("cada CPF citado é procurado com o próprio provedor, que o filtro da demonstração mantém", async () => {
    storageMock.getProactiveAlertsByProvider.mockResolvedValue([
      { id: 1, providerId: PROVEDOR, cpfCnpj: CPF, consultingProviderId: CONSULENTE, sentAt: new Date(), acknowledged: false },
    ]);

    const res = await fetch(`${base}/api/anti-fraud/alerts`);

    expect(res.status).toBe(200);
    expect(storageMock.getCustomerByCpfCnpj).toHaveBeenCalledWith(CPF, PROVEDOR);
  });
});
