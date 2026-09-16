import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * `GET /api/regional/providers` — o que um provedor recebe sobre os OUTROS
 * provedores da regiao dele.
 *
 * O defeito (pre-existente, visto em 12/09/2026): a rota devolvia cru o que o
 * servico selecionava — `id`, `name`, `cidadesAtendidas`, `mesorregioes` de
 * cada vizinho — e a tela de Regionalizacao pintava o NOME do concorrente e a
 * inicial dele num avatar. Bastava configurar cidades para ver quem mais
 * atende a regiao, e o id numerico do outro tenant viajava junto. A regra da
 * rede (CLAUDE.md, secao 11, "Codigo de provedor parceiro") e outra: o nome de
 * outro provedor NUNCA aparece; sai o codigo pareado por observador, e o id de
 * outro tenant nao sai em payload.
 *
 * Contra a ROTA real e o SERVICO real. So o banco e dublado — e o duble
 * respeita a projecao do `select`, devolvendo as colunas que a QUERY pede, nao
 * as que o teste gostaria. Os middlewares de `../auth` sao dublados porque a
 * pergunta aqui e o payload, nao quem entra.
 */

vi.hoisted(() => {
  // O codigo de parceiro le a chave do ambiente na primeira chamada.
  process.env.PARTNER_CODE_SECRET = "p".repeat(64);
});

vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) =>
    req.session?.userId ? next() : res.status(401).json({ message: "Autenticacao necessaria" }),
  requireProvider: (req: any, res: any, next: any) =>
    Number(req.session?.providerId) > 0 ? next() : res.status(403).json({ message: "Somente provedores" }),
}));
vi.mock("../storage", () => ({ storage: { getProvider: vi.fn(), updateProviderProfile: vi.fn() } }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/**
 * Duble do banco. `getRegionalProviders` faz duas leituras, nesta ordem: a
 * linha do PROPRIO provedor (as cidades dele) e depois a busca regional. O
 * duble entrega uma leitura por chamada e projeta cada linha pelas chaves do
 * `select(...)` — como o Postgres faria.
 */
const banco = vi.hoisted(() => {
  const estado = { leituras: [] as Array<Array<Record<string, unknown>>> };
  const db = {
    select: (campos: Record<string, unknown>) => ({
      from: () => ({
        where: async () => {
          const linhas = estado.leituras.shift() ?? [];
          return linhas.map(l => Object.fromEntries(Object.keys(campos).map(c => [c, l[c]])));
        },
      }),
    }),
  };
  return { estado, db };
});
vi.mock("../db", () => ({ db: banco.db, pool: {} }));

import { registerRegionalRoutes } from "./regional.routes";
import { PARTNER_CODE_REGEX, generatePartnerCode } from "../utils/provider-anonymizer";

const AMPLINET = 6;
const VIZINHO = 4242;

/** As linhas como estao na tabela `providers`; o duble projeta o que a query pedir. */
const EU = {
  id: AMPLINET, name: "Amplinet", tradeName: "Amplinet Telecom", status: "active", subdomain: "amplinet",
  cidadesAtendidas: ["Londrina - PR", "Cambé - PR"], mesorregioes: ["Norte Central Paranaense"],
};
const CONCORRENTE = {
  id: VIZINHO, name: "Vertical Telecom Ltda", tradeName: "Vertical", status: "active", subdomain: "vertical",
  cidadesAtendidas: ["Londrina - PR", "Maringá - PR"], mesorregioes: ["Norte Central Paranaense"],
};

let server: Server;
let base: string;
let sessao: Record<string, unknown> = {};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerRegionalRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  sessao = { userId: 1, providerId: AMPLINET, role: "admin" };
  banco.estado.leituras = [[EU], [CONCORRENTE]];
});

describe("GET /api/regional/providers", () => {
  it("cada vizinho sai como codigo pareado e cidades em comum — sem nome, sem id", async () => {
    const res = await fetch(`${base}/api/regional/providers`);
    expect(res.status).toBe(200);
    const corpo = await res.json();

    // A regra da rede: nem o nome nem o id de outro tenant atravessam a rota.
    expect(JSON.stringify(corpo)).not.toMatch(/Vertical|4242/);
    // O que sai e SO isto. Maringa e praca do vizinho que a Amplinet nao atende:
    // nao e "em comum", e a cobertura inteira de um concorrente tambem o identifica.
    expect(corpo).toEqual([
      { codigo: generatePartnerCode(AMPLINET, VIZINHO), cidadesEmComum: ["Londrina - PR"] },
    ]);
    expect(corpo[0].codigo).toMatch(PARTNER_CODE_REGEX);
  });
});
