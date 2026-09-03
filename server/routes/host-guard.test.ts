import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";

/**
 * A prova de host (hostLogin vs req.hostname) mora DENTRO de requireAuth.
 *
 * Uma rota de provedor que use so `requireProvider, requireAdmin` parece
 * protegida — pede sessao, pede papel — mas escapa da unica comparacao que
 * impede uma sessao nascida em `nslink.consultaisp.com.br` de ser
 * reapresentada com `X-Forwarded-Host: outra.com.br`. Foi o que aconteceu com
 * `PUT /api/anti-fraud/rules` e com o `validate-signal` do kanban de
 * recuperacao: a LEITURA das regras tinha duas barreiras, a ESCRITA tinha uma.
 *
 * Aqui roda o middleware de verdade (nada de mock de `../auth`); so o storage
 * e o que abre conexao viram espiao. `req.hostname` e injetado por request
 * porque em express ele e um getter de prototipo derivado do cabecalho Host,
 * que o cliente de teste nao controla.
 */

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

vi.mock("express-session", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("connect-pg-simple", () => ({ default: () => class MockPgStore {} }));
vi.mock("../db", () => ({ pool: {}, db: {} }));

const storageMock = vi.hoisted(() => ({
  saveAntiFraudRules: vi.fn(async () => undefined),
  updateProviderProfile: vi.fn(async () => ({})),
  validateRecoverySignal: vi.fn(async () => ({ case: { id: 1 }, message: "" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

import { registerAntiFraudeRoutes } from "./antifraude.routes";
import { registerEquipamentosRoutes } from "./equipamentos.routes";

const HOST_DO_LOGIN = "nslink.consultaisp.com.br";
const HOST_FORJADO = "outramarca.com.br";

let server: Server;
let base: string;
let sessao: Record<string, unknown>;
let host: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    // `hostname` e getter de prototipo; a propriedade propria o encobre e
    // simula o que o `X-Forwarded-Host` faz com `trust proxy` ligado.
    Object.defineProperty(req, "hostname", { value: host, configurable: true });
    next();
  });
  app.use(registerAntiFraudeRoutes());
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
  sessao = { userId: 3, providerId: 7, role: "admin", hostLogin: HOST_DO_LOGIN };
  host = HOST_DO_LOGIN;
});

const salvarRegras = (body: unknown) => fetch(`${base}/api/anti-fraud/rules`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const validarSinal = (body: unknown) => fetch(`${base}/api/equipment/recovery-cases/9/validate-signal`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("prova de host nas rotas de escrita que so pediam papel", () => {
  it("PUT /api/anti-fraud/rules recusa sessao de outro host e nao grava nada", async () => {
    host = HOST_FORJADO;

    const res = await salvarRegras({});

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Sessao invalida para este endereco" });
    expect(storageMock.saveAntiFraudRules).not.toHaveBeenCalled();
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it("PUT /api/anti-fraud/rules chega ao handler quando o host confere", async () => {
    // 400 do schema prova que passou pelos tres middlewares — o que importa
    // aqui e a barreira, nao o corpo valido.
    const res = await salvarRegras({});

    expect(res.status).toBe(400);
    expect(storageMock.saveAntiFraudRules).not.toHaveBeenCalled();
  });

  it("validate-signal recusa sessao de outro host e nao valida o sinal", async () => {
    host = HOST_FORJADO;

    const res = await validarSinal({});

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Sessao invalida para este endereco" });
    expect(storageMock.validateRecoverySignal).not.toHaveBeenCalled();
  });

  it("validate-signal chega ao handler quando o host confere", async () => {
    const res = await validarSinal({});

    expect(res.status).toBe(400);
    expect(storageMock.validateRecoverySignal).not.toHaveBeenCalled();
  });

  // Sem requireAuth na frente, sessao expirada respondia 403 "Somente
  // provedores" — e o queryClient do client so manda para /login em 401.
  it("sessao expirada responde 401 nas duas, nao 403", async () => {
    sessao = {};

    expect((await salvarRegras({})).status).toBe(401);
    expect((await validarSinal({})).status).toBe(401);
  });

  // Sessao aberta antes do deploy do hostLogin cai na regra antiga, que so
  // sabe comparar rotulo de subdominio. Ela tambem so existe dentro de
  // requireAuth, entao antes da correcao nao valia nestas duas rotas.
  it("sessao legada sem hostLogin segue valendo pelo subdominio", async () => {
    sessao = { userId: 3, providerId: 7, role: "admin", subdomain: "nslink" };
    host = "outra.consultaisp.com.br";

    expect((await salvarRegras({})).status).toBe(403);
  });
});

/**
 * Guarda de reincidencia: varre o fonte das rotas. E textual de proposito —
 * pega tambem os routers que este arquivo nao monta (credits, financeiro,
 * crm...) sem precisar importar meio servidor.
 */
describe("toda rota de provedor comeca por requireAuth", () => {
  const dir = join(import.meta.dirname, ".");
  const arquivos = readdirSync(dir).filter(f => f.endsWith(".routes.ts"));

  it("nenhuma rota usa requireProvider/requireAdmin sem a prova de host", () => {
    const faltando: string[] = [];

    for (const arquivo of arquivos) {
      const linhas = readFileSync(join(dir, arquivo), "utf-8").split(/\r?\n/);
      linhas.forEach((linha, i) => {
        const m = linha.match(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,([^)]*)/);
        if (!m) return;
        const guardas = m[3];
        if (!/require(Provider|Admin)\b/.test(guardas)) return;
        if (/requireSuperAdmin/.test(guardas)) return;
        if (/requireAuth/.test(guardas)) return;
        faltando.push(`${arquivo}:${i + 1} ${m[1].toUpperCase()} ${m[2]}`);
      });
    }

    expect(faltando).toEqual([]);
  });

  it("a varredura enxerga as rotas (senao o teste acima passaria vazio)", () => {
    const total = arquivos.reduce((soma, arquivo) => {
      const texto = readFileSync(join(dir, arquivo), "utf-8");
      return soma + (texto.match(/router\.(get|post|put|patch|delete)\(\s*"[^"]+"\s*,[^)]*require(Provider|Admin)\b/g) || []).length;
    }, 0);

    expect(total).toBeGreaterThan(50);
  });
});
