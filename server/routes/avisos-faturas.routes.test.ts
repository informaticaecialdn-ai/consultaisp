import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import type { Server } from "node:http";
const fila = vi.hoisted(() => ({ obterConfigAvisos: vi.fn(), salvarConfigAvisos: vi.fn(), simularAvisos: vi.fn() }));
vi.mock("../storage/cobranca-preventivo.storage", () => ({
  CobrancaPreventivoStorage: class { obterConfigAvisos = fila.obterConfigAvisos; salvarConfigAvisos = fila.salvarConfigAvisos; simularAvisos = fila.simularAvisos; },
  diaDoPreAviso: () => "2026-09-08",
}));
vi.mock("../storage", () => ({ storage: { getIntegracaoDoChat: vi.fn(async () => undefined), getPoliticaDeCobranca: vi.fn(async () => undefined) } }));
vi.mock("../routes/provider.routes", () => ({ podeAdministrarOProvedor: (session: Request["session"]) => session.role === "admin" }));
vi.mock("../logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../auth", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => req.session.userId ? next() : res.sendStatus(401),
  requireProvider: (req: Request, res: Response, next: NextFunction) => req.session.providerId ? next() : res.sendStatus(403),
}));
import { registerAvisosFaturasRoutes } from "./avisos-faturas.routes";
let servidor: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: req.headers["x-auth"] === "no" ? undefined : 9, providerId: 6, role: req.headers["x-role"] ?? "admin" } as Request["session"]; next(); });
  app.use(registerAvisosFaturasRoutes());
  await new Promise<void>(resolve => { servidor = app.listen(0, "127.0.0.1", resolve); });
  const address = servidor.address();
  if (!address || typeof address === "string") throw new Error("Porta indisponível");
  base = `http://127.0.0.1:${address.port}/api/cobranca/avisos-faturas`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => servidor.close(erro => erro ? reject(erro) : resolve())); });
beforeEach(() => {
  vi.clearAllMocks();
  fila.obterConfigAvisos.mockResolvedValue(null);
  fila.salvarConfigAvisos.mockImplementation(async (_providerId, config) => config);
  fila.simularAvisos.mockResolvedValue({ itens: [], elegiveis: 0 });
});
describe("API de avisos de faturas", () => {
  it("configuração começa desligada mesmo sem integração de WhatsApp", async () => {
    const r = await fetch(`${base}/config`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ligada: false, diasAntes: [7, 3, 1] });
    expect(fila.obterConfigAvisos).toHaveBeenCalledWith(6);
  });
  it("salva só no tenant da sessão e exige administrador", async () => {
    const body = JSON.stringify({ ligada: true, canal: "email", diasAntes: [0, 10], limiteDiario: 50, providerId: 999 });
    const r = await fetch(`${base}/config`, { method: "PUT", headers: { "content-type": "application/json" }, body });
    expect(r.status).toBe(200);
    expect(fila.salvarConfigAvisos).toHaveBeenCalledWith(6, { ligada: true, canal: "email", diasAntes: [0, 10], limiteDiario: 50, incluirLinkFatura: false });
    const denied = await fetch(`${base}/config`, { method: "PUT", headers: { "content-type": "application/json", "x-role": "user" }, body });
    expect(denied.status).toBe(403);
    expect(fila.salvarConfigAvisos).toHaveBeenCalledTimes(1);
  });
  it("simula rascunho sem persistir e rejeita data impossível", async () => {
    const options = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dia: "2026-09-08", config: { ligada: true, diasAntes: [5] } }) };
    expect((await fetch(`${base}/simular`, options)).status).toBe(200);
    expect(fila.simularAvisos).toHaveBeenCalledWith(6, "2026-09-08", expect.objectContaining({ diasAntes: [5], ligada: true }));
    expect(fila.salvarConfigAvisos).not.toHaveBeenCalled();
    expect((await fetch(`${base}/simular`, { ...options, body: JSON.stringify({ dia: "2026-02-30" }) })).status).toBe(400);
  });
  it("recusa acesso sem autenticação", async () => {
    expect((await fetch(`${base}/config`, { headers: { "x-auth": "no" } })).status).toBe(401);
    expect(fila.obterConfigAvisos).not.toHaveBeenCalled();
  });
});
