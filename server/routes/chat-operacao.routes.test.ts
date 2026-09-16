import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request } from "express";
import type { Server } from "node:http";
const fake = vi.hoisted(() => ({ consultarOperacaoChat: vi.fn(), error: vi.fn() }));
vi.mock("../services/chat/chat-operacao.service", () => fake);
vi.mock("../logger", () => ({ logger: fake }));
vi.mock("../auth", () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => req.session?.userId ? next() : res.sendStatus(401),
  requireProvider: (req: express.Request, res: express.Response, next: express.NextFunction) => req.session?.providerId ? next() : res.sendStatus(403),
}));
import { registerChatOperacaoRoutes } from "./chat-operacao.routes";
let server: Server;
let base: string;
let sessao: Partial<Request["session"]> = {};
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { req.session = sessao as Request["session"]; next(); });
  app.use(registerChatOperacaoRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Sem porta");
  base = `http://127.0.0.1:${addr.port}/api/chat-bullq/operacao`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.resetAllMocks(); sessao = {}; fake.consultarOperacaoChat.mockResolvedValue({ bloqueios: [], usadosHoje: 0 }); });
describe("leitura da operação", () => {
  it("autentica e isola pelo provedor da sessão, ignorando IDs na URL", async () => {
    expect((await fetch(base)).status).toBe(401);
    sessao = { userId: 8 };
    expect((await fetch(base)).status).toBe(403);
    sessao = { userId: 8, providerId: 7, role: "user" };
    const r = await fetch(base + "?providerId=999");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(fake.consultarOperacaoChat).toHaveBeenCalledExactlyOnceWith(7);
  });
  it("só aceita GET e sanitiza falha interna", async () => {
    sessao = { userId: 8, providerId: 7, role: "admin" };
    expect((await fetch(base, { method: "POST" })).status).toBe(404);
    expect(fake.consultarOperacaoChat).not.toHaveBeenCalled();
    fake.consultarOperacaoChat.mockRejectedValue(new Error("credencial-secreta"));
    const r = await fetch(base);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("credencial-secreta");
  });
});
