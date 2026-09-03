import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

// O storage real abre conexão com o Postgres ao ser importado; aqui ele é
// substituído por espiões para provar que a rota só pede o providerId da
// sessão e monta o board com o que voltou.
// vi.hoisted porque o vi.mock sobe acima dos imports e a fábrica roda quando
// a rota importa o storage — antes de um `const` comum existir.
const storageMock = vi.hoisted(() => ({
  expireRecoveryCases: vi.fn(async () => 0),
  getRecoveryBoardCases: vi.fn(async (): Promise<any[]> => []),
  getRetainedEquipmentWithoutOpenCase: vi.fn(async (): Promise<any[]> => []),
  getUsersByProvider: vi.fn(async (): Promise<any[]> => []),
  getRecoveryAttemptSummaries: vi.fn(async (): Promise<any[]> => []),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

// requireAuth real depende de sessão assinada e host; o que interessa aqui
// é o contrato "sem userId → 401", reproduzido pelo mock.
vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Autenticacao necessaria" });
    next();
  },
  requireProvider: (req: any, res: any, next: any) => {
    if (!req.session?.providerId) return res.status(403).json({ message: "Somente provedores" });
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

import { registerEquipamentosRoutes } from "./equipamentos.routes";

let server: Server;
let base: string;
let sessao: Record<string, unknown> = {};

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    next();
  });
  app.use(registerEquipamentosRoutes());
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
});

describe("GET /api/equipment/recovery-board", () => {
  it("401 sem sessão, e o storage nem é consultado", async () => {
    const res = await fetch(`${base}/api/equipment/recovery-board`);
    expect(res.status).toBe(401);
    expect(storageMock.getRecoveryBoardCases).not.toHaveBeenCalled();
  });

  it("isola por providerId da sessão: toda leitura recebe o mesmo tenant", async () => {
    sessao = { userId: 7, providerId: 42, role: "admin" };
    const res = await fetch(`${base}/api/equipment/recovery-board`);
    expect(res.status).toBe(200);

    expect(storageMock.expireRecoveryCases).toHaveBeenCalledWith(42);
    expect(storageMock.getRecoveryBoardCases).toHaveBeenCalledWith(42, expect.any(Date));
    expect(storageMock.getRetainedEquipmentWithoutOpenCase).toHaveBeenCalledWith(42);
    expect(storageMock.getUsersByProvider).toHaveBeenCalledWith(42);
    expect(storageMock.getRecoveryAttemptSummaries).toHaveBeenCalledWith(42, []);
  });

  it("devolve o contrato BoardKanban e só id/nome dos usuários", async () => {
    sessao = { userId: 7, providerId: 42, role: "admin" };
    storageMock.getUsersByProvider.mockResolvedValueOnce([
      { id: 1, name: "Ana", email: "ana@x", password: "hash-secreto" } as any,
    ]);
    storageMock.getRecoveryBoardCases.mockResolvedValueOnce([{
      id: 9,
      status: "pre_recuperacao",
      prioridade: "alta",
      rescisaoEm: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      prazoAt: new Date(Date.now() + 55 * 24 * 60 * 60 * 1000),
      agendadoEm: null, metodo: null, responsavelId: null, responsavelNome: null,
      notificadoEm: null, bureauStatus: "candidato", contestadoEm: null, encerradoEm: null, notas: null,
      equipamento: { id: 3, tipo: "ONU", marca: null, modelo: null, serie: null, mac: null, patrimonio: null, valor: "290.00", status: "retirada_pendente" },
      cliente: { id: 1, nome: "Maria", cpfCnpj: "12345678901", telefone: null, endereco: null, numero: null, bairro: null, cidade: null, uf: null, situacao: "active", dividaEmAberto: "0", diasEmAtraso: 0 },
    }] as any);

    const res = await fetch(`${base}/api/equipment/recovery-board`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.colunas.map((c: any) => c.chave)).toEqual(["sem_data", "ate30", "31a60", "61a90", "mais90", "recuperado", "baixado"]);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({ chave: "caso:9", coluna: "ate30", caseId: 9 });
    expect(body.kpis.retidos).toBe(1);
    expect(body.responsaveis).toEqual([{ id: 1, nome: "Ana" }]);
    expect(JSON.stringify(body)).not.toContain("hash-secreto");
    // as tentativas são pedidas para os casos que voltaram
    expect(storageMock.getRecoveryAttemptSummaries).toHaveBeenCalledWith(42, [9]);
  });
});
