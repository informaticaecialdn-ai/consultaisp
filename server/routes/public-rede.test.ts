/**
 * GET /api/public/rede — o numero do selo "Rede online · N provedores ativos".
 *
 * O desenho da tela de login trazia "47" escrito a mao; a base tinha 6. O teste
 * prende as tres coisas que fazem o numero ser verdade: conta so provedor
 * ativo, nao expoe nada alem do numero, e nao vira uma leitura de banco por
 * visita de uma pagina publica.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";

const storageMock = vi.hoisted(() => ({
  getAllProviders: vi.fn(),
  getAllErpCatalog: vi.fn(),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../db", () => ({ db: {}, pool: {} }));
// A rota nao usa nada disto; o modulo das rotas publicas importa, e o de auth
// exige SESSION_SECRET ja no import.
vi.mock("../auth", () => ({ requireAuth: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../services/lgpd-email.service", () => ({ sendConfirmationEmail: vi.fn() }));
vi.mock("../services/marca.service", () => ({ resolverMarcaPorHost: vi.fn() }));

import { registerPublicRoutes } from "./public.routes";

let server: Server;
let base: string;

beforeEach(async () => {
  vi.clearAllMocks();
  const app = express();
  app.use(registerPublicRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterEach(async () => {
  vi.useRealTimers();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const provedor = (id: number, status: string) => ({ id, name: `Provedor ${id}`, cnpj: "00000000000100", status });

describe("GET /api/public/rede", () => {
  it("conta so provedor ativo — suspenso e cancelado nao sao rede", async () => {
    storageMock.getAllProviders.mockResolvedValue([
      provedor(1, "active"), provedor(2, "active"), provedor(3, "suspended"), provedor(4, "cancelled"),
    ]);

    const res = await fetch(`${base}/api/public/rede`);

    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.provedoresAtivos).toBe(2);
  });

  it("sandbox de demonstracao nao conta como provedor ativo — na demo, cada visitante inflaria o selo", async () => {
    storageMock.getAllProviders.mockResolvedValue([
      { ...provedor(1, "active"), subdomain: "rede-1" },
      { ...provedor(2, "active"), subdomain: "sandbox-aaaa" },
      { ...provedor(3, "active"), subdomain: "sandbox-bbbb" },
      { ...provedor(4, "active"), subdomain: null },
    ]);

    const corpo = await (await fetch(`${base}/api/public/rede`)).json();

    expect(corpo.provedoresAtivos).toBe(2);
  });

  it("devolve o numero e a hora da leitura — nenhum nome, CNPJ ou id", async () => {
    storageMock.getAllProviders.mockResolvedValue([provedor(1, "active")]);

    const corpo = await (await fetch(`${base}/api/public/rede`)).json();

    expect(Object.keys(corpo).sort()).toEqual(["lidoEm", "provedoresAtivos"]);
    expect(JSON.stringify(corpo)).not.toContain("Provedor 1");
  });

  it("segunda visita dentro de 5 minutos nao le o banco de novo", async () => {
    storageMock.getAllProviders.mockResolvedValue([provedor(1, "active")]);

    await fetch(`${base}/api/public/rede`);
    await fetch(`${base}/api/public/rede`);

    expect(storageMock.getAllProviders).toHaveBeenCalledTimes(1);
  });

  it("falha do banco vira 500 sem numero — a tela mostra so 'Rede online'", async () => {
    storageMock.getAllProviders.mockRejectedValue(new Error("conexao recusada"));

    const res = await fetch(`${base}/api/public/rede`);

    expect(res.status).toBe(500);
    const corpo = await res.json();
    expect(corpo.provedoresAtivos).toBeUndefined();
  });
});
