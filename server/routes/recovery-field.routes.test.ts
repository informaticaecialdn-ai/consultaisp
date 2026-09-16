import express, { type Request } from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const field = vi.hoisted(() => ({ list: vi.fn(async () => []), preview: vi.fn(), dispatch: vi.fn(), visit: vi.fn(), evidence: vi.fn() }));
vi.mock("../services/recovery-field.service", async importOriginal => ({ ...await importOriginal<object>(), recoveryFieldService: field }));
vi.mock("../storage", () => ({ storage: { getUsersByProvider: vi.fn(async () => []), recalculateCustomerEquipmentAggregate: vi.fn(async () => undefined) } }));
vi.mock("../auth", () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => req.session.userId ? next() : res.status(401).end(),
  requireProvider: (req: express.Request, res: express.Response, next: express.NextFunction) => req.session.providerId ? next() : res.status(403).end(),
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => req.session.role === "admin" ? next() : res.status(403).end(),
}));
import { registerRecoveryFieldRoutes } from "./recovery-field.routes";
let server: Server; let base: string; let session: Partial<Request["session"]> = {};
beforeAll(async () => { const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.session = session as Request["session"]; next(); }); app.use(registerRecoveryFieldRoutes()); await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Sem porta"); base = `http://127.0.0.1:${address.port}/api/equipment/field`; });
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); session = { userId: 8, providerId: 42, role: "user" }; });
describe("API de campo", () => {
  it("exige sessão e não consulta dados sem autenticação", async () => { session = {}; expect((await fetch(`${base}/cases`)).status).toBe(401); expect(field.list).not.toHaveBeenCalled(); });
  it("usa tenant e técnico da sessão, ignorando tenant sugerido na URL", async () => { const r = await fetch(`${base}/cases?providerId=999`); expect(r.status).toBe(200); expect(field.list).toHaveBeenCalledWith({ providerId: 42, userId: 8, manager: false }); expect(r.headers.get("cache-control")).toBe("no-store"); });
  it("admin no app do técnico também pode consultar somente sua agenda", async () => { session.role = "admin"; await fetch(`${base}/cases?scope=mine`); expect(field.list).toHaveBeenCalledWith({ providerId: 42, userId: 8, manager: false }); });
  it("operador não distribui atividades nem enumera a equipe", async () => { expect((await fetch(`${base}/dispatch`, { method: "POST" })).status).toBe(403); expect((await fetch(`${base}/team`)).status).toBe(403); expect(field.dispatch).not.toHaveBeenCalled(); });
  it("recusa visita sem evidência e sem relato", async () => { const r = await fetch(`${base}/cases/7/visits`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: "cliente_ausente" }) }); expect(r.status).toBe(400); expect(field.visit).not.toHaveBeenCalled(); });
  it("não expõe bytes de fotos na listagem", async () => { field.evidence.mockResolvedValueOnce([{ id: 3, caseId: 7, metadata: { version: 1, kind: "field_visit", requestId: "x", payloadHash: "x", visit: { nextAction: "reagendar", location: null, photos: [{ name: "fachada", mime: "image/jpeg", base64: "segredo-da-foto" }] } } }]); const r = await fetch(`${base}/cases/7/visits`); const body = await r.text(); expect(r.status).toBe(200); expect(body).not.toContain("segredo-da-foto"); expect(body).toContain("/photos/0"); expect(field.evidence).toHaveBeenCalledWith({ providerId: 42, userId: 8, manager: false }, 7); });
});
