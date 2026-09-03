/**
 * A tabela de preco tem que sair do SERVIDOR, e sair certa nos dois portoes:
 * a rota publica (landing, cadastro) responde sem sessao, e a rota do provedor
 * recusa quem nao tem sessao. Se a publica exigisse login a landing ficaria sem
 * preco; se a do provedor deixasse passar, o preco de uma marca vazaria para
 * quem nao pertence a ela quando a camada `marca_precos` entrar na fase 3.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

vi.mock("express-session", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("connect-pg-simple", () => ({ default: () => class MockPgStore {} }));
vi.mock("../db", () => ({ pool: {}, db: {} }));

const getMarcaPorSubdominio = vi.fn();
const getMarcaPorDominio = vi.fn();
vi.mock("../storage", () => ({
  storage: {
    getMarcaPorSubdominio: (s: string) => getMarcaPorSubdominio(s),
    getMarcaPorDominio: (h: string) => getMarcaPorDominio(h),
  },
}));

import express from "express";
import type { AddressInfo } from "net";
import { registerPrecosRoutes } from "./precos.routes";
import { esquecerMarcas } from "../services/marca.service";
import { CREDIT_PACKAGES, PLAN_PRICES } from "@shared/planos";

/** Sessao injetada por teste; `null` = visitante sem sessao. */
let sessaoFalsa: Record<string, unknown> | null = null;

async function comServidor<T>(uso: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use((req: any, _res, next) => {
    req.session = sessaoFalsa ?? {};
    next();
  });
  app.use(registerPrecosRoutes());
  const servidor = app.listen(0);
  await new Promise<void>((ok) => servidor.once("listening", () => ok()));
  const { port } = servidor.address() as AddressInfo;
  try {
    return await uso(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  }
}

beforeEach(() => {
  sessaoFalsa = null;
  esquecerMarcas();
  getMarcaPorSubdominio.mockReset().mockResolvedValue(undefined);
  getMarcaPorDominio.mockReset().mockResolvedValue(undefined);
});

describe("GET /api/public/precos", () => {
  it("responde sem sessao — e a vitrine", async () => {
    const { status, body } = await comServidor(async (base) => {
      const r = await fetch(`${base}/api/public/precos`);
      return { status: r.status, body: await r.json() };
    });
    expect(status).toBe(200);
    expect(body.origem).toBe("plataforma");
    expect(body.marcaId).toBeNull();
  });

  it("entrega os pacotes da tabela da plataforma, em centavos e em reais", async () => {
    const body = await comServidor(async (base) =>
      (await fetch(`${base}/api/public/precos`)).json(),
    );
    expect(body.pacotes).toHaveLength(CREDIT_PACKAGES.length);
    const cem = body.pacotes.find((p: any) => p.id === "credits-100");
    expect(cem.precoCentavos).toBe(10000);
    expect(cem.precoReais).toBe(100);
    expect(cem.precoLabel).toBe("R$ 100,00");
    expect(cem.precoUnitarioLabel).toBe("R$ 1,00/crédito");
  });

  it("entrega os planos com rotulo e marcacao de vitrine", async () => {
    const body = await comServidor(async (base) =>
      (await fetch(`${base}/api/public/precos`)).json(),
    );
    expect(body.planos).toHaveLength(Object.keys(PLAN_PRICES).length);
    const pro = body.planos.find((p: any) => p.chave === "pro");
    expect(pro.rotulo).toBe("Profissional");
    expect(pro.precoReais).toBe(PLAN_PRICES.pro);
    expect(pro.precoCentavos).toBe(PLAN_PRICES.pro * 100);
    expect(pro.naVitrine).toBe(true);
  });

  /**
   * Decisao do dono em 03/09/2026: o catalogo e o da landing, e mais nada.
   * `basic` e `enterprise` sairam; a migracao 0014 moveu para `pro` quem
   * estava neles. Este teste existe para eles nao voltarem por descuido —
   * bastaria uma linha em PLAN_PRICES para o seletor do admin oferecer de novo
   * um plano que ninguem decidiu vender.
   */
  it("o catalogo tem exatamente os dois planos da landing", async () => {
    const body = await comServidor(async (base) =>
      (await fetch(`${base}/api/public/precos`)).json(),
    );
    expect(body.planos.map((p: any) => p.chave).sort()).toEqual(["free", "pro"]);
    expect(body.planos.every((p: any) => p.naVitrine)).toBe(true);
    for (const legado of ["basic", "enterprise"]) {
      expect(body.planos.find((p: any) => p.chave === legado)).toBeUndefined();
    }
  });

  /**
   * `creditosInclusos` e o que a FATURA escreve, nao um credito automatico.
   * Quem nao gera fatura nao tem recorrencia: `generate-monthly` pula todo
   * provedor com preco zero. Sem este campo o painel do provedor so tinha
   * `creditosInclusos` para exibir e anunciava "50 creditos inclusos por mes"
   * no plano gratuito — uma promessa mensal que nada no sistema cumpre.
   */
  it("marca como recorrente apenas o plano que gera fatura", async () => {
    const body = await comServidor(async (base) =>
      (await fetch(`${base}/api/public/precos`)).json(),
    );
    for (const plano of body.planos) {
      expect(plano.recorrente).toBe(plano.precoCentavos > 0);
    }
    expect(body.planos.find((p: any) => p.chave === "free").recorrente).toBe(false);
    expect(body.planos.find((p: any) => p.chave === "pro").recorrente).toBe(true);
  });

  /**
   * Os 30 creditos do Profissional sao a unica promessa mensal do catalogo, e
   * agora ela e cumprida pelo sistema (ver `creditarPlanoDaFatura`). O
   * Gratuito declara 50 porque sao os de boas-vindas, concedidos uma vez no
   * cadastro — por isso ele nao e recorrente.
   */
  it("o Profissional declara os 30 creditos mensais e o Gratuito os de boas-vindas", async () => {
    const body = await comServidor(async (base) =>
      (await fetch(`${base}/api/public/precos`)).json(),
    );
    expect(body.planos.find((p: any) => p.chave === "pro").creditosInclusos).toEqual({ isp: 30, spc: 0 });
    expect(body.planos.find((p: any) => p.chave === "free").creditosInclusos).toEqual({ isp: 50, spc: 0 });
  });
});

describe("GET /api/credits/packages", () => {
  it("recusa com 401 quem nao tem sessao", async () => {
    const status = await comServidor(async (base) =>
      (await fetch(`${base}/api/credits/packages`)).status,
    );
    expect(status).toBe(401);
  });

  it("responde ao provedor logado", async () => {
    sessaoFalsa = { userId: 3, providerId: 12, role: "admin", marcaId: null };
    const { status, body } = await comServidor(async (base) => {
      const r = await fetch(`${base}/api/credits/packages`);
      return { status: r.status, body: await r.json() };
    });
    expect(status).toBe(200);
    expect(body.pacotes).toHaveLength(CREDIT_PACKAGES.length);
  });

  it("responde ao superadmin, que nao tem providerId", async () => {
    sessaoFalsa = { userId: 1, role: "superadmin" };
    const status = await comServidor(async (base) =>
      (await fetch(`${base}/api/credits/packages`)).status,
    );
    expect(status).toBe(200);
  });

  /**
   * A marca sai da sessao. Aceitar `?marcaId=` seria o provedor escolhendo por
   * qual tabela quer ser cobrado — hoje inofensivo, porque so ha a tabela da
   * plataforma, e uma porta aberta na fase 3.
   */
  it("ignora marcaId vindo da query", async () => {
    sessaoFalsa = { userId: 3, providerId: 12, role: "admin", marcaId: null };
    const body = await comServidor(async (base) =>
      (await fetch(`${base}/api/credits/packages?marcaId=99`)).json(),
    );
    expect(body.marcaId).toBeNull();
  });
});
