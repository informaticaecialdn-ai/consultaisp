import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import type { Server } from "node:http";
const fake = vi.hoisted(() => ({ obter: vi.fn(), salvar: vi.fn(), role: "admin", providerId: 7, userId: 8 }));
vi.mock("../auth", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => req.session.userId ? next() : res.sendStatus(401),
  requireProvider: (req: Request, res: Response, next: NextFunction) => req.session.providerId ? next() : res.sendStatus(403),
}));
vi.mock("./provider.routes", () => ({ podeAdministrarOProvedor: (s: Request["session"]) => s.role === "admin" }));
vi.mock("../services/cobranca/canais-comunicacao.service", () => ({
  obterConfiguracaoCanais: fake.obter, salvarConfiguracaoCanais: fake.salvar, ErroConfiguracaoCanais: class extends Error {},
}));
import router from "./cobranca-canais.routes";
let servidor: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: fake.userId, providerId: fake.providerId, role: fake.role } as Request["session"]; next(); });
  app.use(router);
  await new Promise<void>(resolve => { servidor = app.listen(0, "127.0.0.1", resolve); });
  const addr = servidor.address();
  if (!addr || typeof addr === "string") throw new Error("Sem porta");
  base = `http://127.0.0.1:${addr.port}/api/cobranca/canais`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => servidor.close(e => e ? reject(e) : resolve())); });
beforeEach(() => { vi.clearAllMocks(); fake.role = "admin"; fake.providerId = 7; fake.userId = 8; fake.obter.mockResolvedValue({}); fake.salvar.mockResolvedValue({}); });
const body = { sms: { ativado: false, accountSid: "", remetente: "" }, email: { ativado: false, remetente: "", nomeRemetente: "", responderPara: "" } };
function put(dados: unknown = body) { return fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) }); }
describe("configuração de canais", () => {
  it("exige sessão e provedor", async () => {
    fake.userId = 0; expect((await fetch(base)).status).toBe(401);
    fake.userId = 8; fake.providerId = 0; expect((await put()).status).toBe(403);
    expect(fake.salvar).not.toHaveBeenCalled();
  });
  it("operador lê mas não altera", async () => {
    fake.role = "user";
    expect((await fetch(base)).status).toBe(200);
    expect((await put()).status).toBe(403);
    expect(fake.obter).toHaveBeenCalledWith(7);
    expect(fake.salvar).not.toHaveBeenCalled();
  });
  it("salva somente no provedor da sessão e rejeita substituição pelo body", async () => {
    expect((await put()).status).toBe(200);
    expect(fake.salvar).toHaveBeenCalledWith(7, body);
    fake.salvar.mockClear();
    expect((await put({ ...body, providerId: 99 })).status).toBe(400);
    expect(fake.salvar).not.toHaveBeenCalled();
  });
  it("erros de infraestrutura não expõem credenciais", async () => {
    fake.salvar.mockRejectedValue(new Error("segredo-do-banco"));
    const r = await put(); expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("segredo-do-banco");
  });
});
