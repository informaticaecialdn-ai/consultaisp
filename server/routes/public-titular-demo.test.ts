/**
 * POST /api/public/titular-request na demonstração pública.
 *
 * O pedido de titular não pede login, e o worker processa exclusão, acesso e
 * portabilidade sozinho, PELO CPF, em todos os provedores. Na demonstração os
 * CPFs da rede se repetem em todo sandbox e no mundo base: um pedido de
 * exclusão feito por qualquer visitante anonimizava as consultas desse CPF para
 * todos os outros (auditoria de isolamento de 13/09/2026, L3). A demonstração
 * não recebe o pedido — responde onde fazê-lo e não grava nada. Fora dela, o
 * fluxo de sempre.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";

const estado = vi.hoisted(() => ({ demo: false }));
const dbMock = vi.hoisted(() => {
  const values = vi.fn(async (_linha: unknown) => undefined);
  return { values, insert: vi.fn((_tabela: unknown) => ({ values })) };
});
vi.mock("../db", () => ({ db: { insert: dbMock.insert }, pool: {} }));
vi.mock("../storage", () => ({ storage: {} }));
// A rota nao usa; o modulo das rotas publicas importa, e o de auth exige
// SESSION_SECRET ja no import.
vi.mock("../auth", () => ({ requireAuth: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../middleware/rate-limiter.middleware", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, next: () => void) => next(),
}));
const emailMock = vi.hoisted(() => ({ sendConfirmationEmail: vi.fn(async () => undefined) }));
vi.mock("../services/lgpd-email.service", () => emailMock);
vi.mock("../services/marca.service", () => ({ resolverMarcaPorHost: vi.fn(async () => undefined) }));
vi.mock("../demo/modo-demo", () => ({ emModoDemo: () => estado.demo }));

import { registerPublicRoutes } from "./public.routes";

let server: Server;
let base: string;

beforeEach(async () => {
  vi.clearAllMocks();
  const app = express();
  app.use(express.json());
  app.use(registerPublicRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterEach(async () => {
  estado.demo = false;
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const pedir = (tipoSolicitacao: string) => fetch(`${base}/api/public/titular-request`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    cpfCnpj: "999.504.000-07", nome: "Visitante da demonstracao",
    email: "visitante@exemplo.invalid", tipoSolicitacao,
  }),
});

describe("POST /api/public/titular-request — demonstração", () => {
  it("na demonstração recusa todo tipo de pedido, sem gravar e sem mandar e-mail", async () => {
    estado.demo = true;
    for (const tipo of ["exclusao", "acesso", "portabilidade", "correcao", "revogacao"]) {
      const res = await pedir(tipo);
      expect(res.status, tipo).toBe(403);
      const corpo = await res.json();
      expect(corpo.message, tipo).toContain("consultaisp.com.br/lgpd");
      expect(corpo.protocolo, tipo).toBeUndefined();
    }
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(emailMock.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it("fora da demonstração o pedido é registrado como sempre", async () => {
    const res = await pedir("exclusao");

    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.protocolo).toMatch(/^LGPD-/);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(dbMock.values).toHaveBeenCalledWith(expect.objectContaining({
      cpfCnpj: "99950400007", tipoSolicitacao: "exclusao", status: "pendente",
    }));
  });
});
