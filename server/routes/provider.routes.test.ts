import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: DELETE /api/provider/users/:id (exclusao definitiva) e a defesa em
 * profundidade do requireProvider — sem ele, sessao com providerId 0 chega ao
 * handler e o handler compara/grava contra o provedor 0.
 */
const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(async (): Promise<any> => null),
  getUsersByProvider: vi.fn(async (): Promise<any[]> => []),
  deleteUser: vi.fn(async () => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Autenticacao necessaria" });
    next();
  },
  requireProvider: (req: any, res: any, next: any) => {
    const pid = req.session?.providerId;
    if (!req.session?.userId || !pid || pid <= 0) return res.status(403).json({ message: "Somente provedores" });
    next();
  },
}));

vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { registerProviderRoutes } from "./provider.routes";

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
  app.use(registerProviderRoutes());
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
  sessao = { userId: 1, providerId: 7, role: "admin" };
});

const apagar = (id: number) => fetch(`${base}/api/provider/users/${id}`, { method: "DELETE" });

describe("DELETE /api/provider/users/:id", () => {
  it("exclui outro usuario do mesmo provedor", async () => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "user", providerId: 7 });

    const res = await apagar(9);

    expect(res.status).toBe(200);
    expect(storageMock.deleteUser).toHaveBeenCalledWith(9);
  });

  // 409 e nao 400: o pedido esta bem formado; o que impede e o estado.
  it("409 ao tentar excluir a propria conta", async () => {
    const res = await apagar(1);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "Voce nao pode excluir a propria conta" });
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("409 ao excluir o ultimo administrador do provedor", async () => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "admin", providerId: 7 });
    storageMock.getUsersByProvider.mockResolvedValue([
      { id: 9, role: "admin" },
      { id: 1, role: "user" },
    ]);

    const res = await apagar(9);

    expect(res.status).toBe(409);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("exclui um administrador quando sobra outro", async () => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "admin", providerId: 7 });
    storageMock.getUsersByProvider.mockResolvedValue([
      { id: 9, role: "admin" },
      { id: 1, role: "admin" },
    ]);

    const res = await apagar(9);

    expect(res.status).toBe(200);
    expect(storageMock.deleteUser).toHaveBeenCalledWith(9);
  });

  it("404 para usuario de outro provedor — nao revela que ele existe", async () => {
    storageMock.getUser.mockResolvedValue({ id: 9, role: "user", providerId: 8 });

    const res = await apagar(9);

    expect(res.status).toBe(404);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });
});

describe("requireProvider nas rotas de provedor", () => {
  it("403 para sessao sem provedor: nao chega a consultar nada", async () => {
    sessao = { userId: 1, providerId: 0, role: "user" };

    const res = await fetch(`${base}/api/provider/users`);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Somente provedores" });
    expect(storageMock.getUsersByProvider).not.toHaveBeenCalled();
  });

  it("403 para sessao sem provedor tambem na criacao de usuario", async () => {
    sessao = { userId: 1, providerId: 0, role: "admin" };

    const res = await fetch(`${base}/api/provider/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@x.com", password: "12345678" }),
    });

    expect(res.status).toBe(403);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("401 sem sessao nenhuma", async () => {
    sessao = {};

    const res = await fetch(`${base}/api/provider/users`);

    expect(res.status).toBe(401);
  });
});
