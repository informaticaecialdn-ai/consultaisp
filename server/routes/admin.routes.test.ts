import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: as travas do DELETE /api/admin/users/:id, que apaga a linha de vez.
 *
 * Tudo que abre conexao ou fala com terceiro vira espiao: o que se prova aqui
 * e QUEM a rota se recusa a apagar, nao como ela apaga.
 */
const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(async (): Promise<any> => null),
  deleteUser: vi.fn(async () => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../auth", () => ({
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Acesso restrito" });
    next();
  },
}));

vi.mock("../db", () => ({ db: {} }));
vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../services/email", () => ({ sendVerificationEmail: vi.fn(async () => undefined) }));
vi.mock("../services/marca.service", () => ({ esquecerMarcas: vi.fn() }));
vi.mock("../services/lgpd-email.service", () => ({ sendCompletionEmail: vi.fn(async () => undefined) }));

import { registerAdminRoutes } from "./admin.routes";

let server: Server;
let base: string;
let sessao: Record<string, any>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    next();
  });
  app.use(registerAdminRoutes());
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
  sessao = { userId: 1, role: "superadmin" };
});

const apagar = (id: number) => fetch(`${base}/api/admin/users/${id}`, { method: "DELETE" });

describe("DELETE /api/admin/users/:id", () => {
  it("apaga um usuario comum", async () => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "admin", providerId: 3 });

    const res = await apagar(9);

    expect(res.status).toBe(200);
    expect(storageMock.deleteUser).toHaveBeenCalledWith(9);
  });

  // Sem esta trava o superadmin apaga a propria conta e so o banco devolve o
  // acesso — a plataforma fica sem quem administre.
  it("409 ao tentar apagar a propria conta, e nao chega a apagar", async () => {
    const res = await apagar(1);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "Voce nao pode excluir a propria conta" });
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("409 ao tentar apagar outro superadmin", async () => {
    storageMock.getUser.mockResolvedValue({ id: 2, role: "superadmin", providerId: null });

    const res = await apagar(2);

    expect(res.status).toBe(409);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("404 quando o usuario nao existe", async () => {
    storageMock.getUser.mockResolvedValue(null);

    const res = await apagar(999);

    expect(res.status).toBe(404);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("403 para quem nao e superadmin", async () => {
    sessao = { userId: 5, role: "admin", providerId: 3 };

    const res = await apagar(9);

    expect(res.status).toBe(403);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });
});
