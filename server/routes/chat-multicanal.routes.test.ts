import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import type { Server } from "node:http";
const fake = vi.hoisted(() => ({ listar: vi.fn(), configurar: vi.fn(), enviar: vi.fn(), proposta: vi.fn(), role: "admin", providerId: 7, userId: 8 }));
vi.mock("../auth", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => req.session.userId ? next() : res.sendStatus(401),
  requireProvider: (req: Request, res: Response, next: NextFunction) => req.session.providerId ? next() : res.sendStatus(403),
}));
vi.mock("./chat-escopo", () => ({ exigirEscopoDoChat: (_req: Request, _res: Response, next: NextFunction) => next() }));
vi.mock("./provider.routes", () => ({ podeAdministrarOProvedor: (s: Request["session"]) => s.role === "admin" }));
vi.mock("../logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../services/chat/chat-ponte.service", () => ({ ErroDaPonteDoChat: class extends Error { constructor(public readonly codigo: string, mensagem: string) { super(mensagem); } } }));
vi.mock("../services/chat/chat-multicanal.service", () => ({
  listarMulticanal: fake.listar, configurarMulticanal: fake.configurar, enviarMulticanal: fake.enviar, propostaMulticanal: fake.proposta, ErroMulticanal: class extends Error {},
}));
import { registerChatMulticanalRoutes } from "./chat-multicanal.routes";
import { ErroDaPonteDoChat } from "../services/chat/chat-ponte.service";
import { ErroMulticanal } from "../services/chat/chat-multicanal.service";
let servidor: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: fake.userId, providerId: fake.providerId, role: fake.role } as Request["session"]; next(); });
  app.use(registerChatMulticanalRoutes());
  await new Promise<void>(resolve => { servidor = app.listen(0, "127.0.0.1", resolve); });
  const addr = servidor.address();
  if (!addr || typeof addr === "string") throw new Error("Sem porta");
  base = `http://127.0.0.1:${addr.port}/api/chat-bullq/atendimentos/c1/multicanal`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => servidor.close(e => e ? reject(e) : resolve())); });
beforeEach(() => { vi.clearAllMocks(); fake.role = "admin"; fake.listar.mockResolvedValue({ mensagens: [] }); fake.enviar.mockResolvedValue({ status: "enviado" }); fake.configurar.mockResolvedValue({ reforcoAtivo: true }); });
const config = { reforcoAtivo: true, intervaloHoras: 48, canais: ["email"] };
const mensagem = { canal: "email", texto: "Olá", chave: "11111111-1111-4111-8111-111111111111" };
const post = (rota: string, dados: unknown) => fetch(base + rota, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
describe("rotas do multicanal", () => {
  // Ligar reforço automático é configurar o provedor, como os canais e a
  // autonomia: fica com quem administra (`podeAdministrarOProvedor`).
  it("/config é só de administrador: operador recebe 403 e o serviço não é chamado", async () => {
    fake.role = "user";
    expect((await post("/config", config)).status).toBe(403);
    expect(fake.configurar).not.toHaveBeenCalled();
    fake.role = "admin";
    expect((await post("/config", config)).status).toBe(200);
    expect(fake.configurar).toHaveBeenCalledWith(7, "c1", config);
  });
  it("operador continua lendo e enviando na conversa", async () => {
    fake.role = "user";
    expect((await fetch(base)).status).toBe(200);
    expect((await post("/enviar", mensagem)).status).toBe(200);
    expect(fake.enviar).toHaveBeenCalledWith(7, "c1", 8, mensagem);
  });
  it("recusa da ponte (horário, pausa) vira 409 com código; regra do multicanal 400; infraestrutura 503 — nunca 500", async () => {
    fake.enviar.mockRejectedValueOnce(new ErroDaPonteDoChat("CONFLITO", "Fora do horário de contato"));
    const ponte = await post("/enviar", mensagem);
    expect(ponte.status).toBe(409);
    expect(await ponte.json()).toEqual({ message: "Fora do horário de contato", codigo: "CONFLITO" });
    fake.enviar.mockRejectedValueOnce(new ErroMulticanal("Assuma a conversa antes de enviar"));
    const regra = await post("/enviar", mensagem);
    expect(regra.status).toBe(400);
    expect((await regra.json()).message).toBe("Assuma a conversa antes de enviar");
    fake.enviar.mockRejectedValueOnce(new Error("segredo-do-banco"));
    const infra = await post("/enviar", mensagem);
    expect(infra.status).toBe(503);
    expect(await infra.text()).not.toContain("segredo-do-banco");
  });
});
