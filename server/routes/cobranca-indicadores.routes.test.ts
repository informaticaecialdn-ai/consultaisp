import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";

/**
 * OS INDICADORES DA COBRANCA — o que a automacao fez, e quanto se recuperou.
 *
 * O que este arquivo defende, na ordem em que importa:
 *
 *   1. TENANT. O provedor sai da SESSAO. Nao ha `?providerId=` que valha, e
 *      duas sessoes diferentes nunca leem a mesma carteira. Um indicador de
 *      dinheiro que aceitasse provedor por query seria um vazamento com
 *      aparencia de relatorio.
 *   2. AUSENCIA DE DADO E "—", nunca zero. Chat nao provisionado devolve
 *      `hoje: null` com motivo; provedor sem fatura do ERP devolve `valor:
 *      null` com motivo. Um "R$ 0,00" ali seria uma afirmacao falsa sobre o
 *      trabalho da equipe.
 *   3. OS NUMEROS QUE A TELA AFIRMA SAO OS DO WORKER. A tela diz "no maximo 5
 *      por rodada, a cada minuto". Os dois valores vem daqui; o ultimo teste
 *      le o FONTE do servico e falha no dia em que alguem mudar um deles sem
 *      olhar para a tela.
 *
 * `requireAuth` e `requireProvider` entram COMO OS REAIS: sao a linha que
 * separa o operador logado de qualquer um, e mocka-las provaria so que a rota
 * chama alguma coisa. O que e dublado sao os dois storages — o SQL deles ja
 * esta provado em `faturas.storage.test.ts` e `chat-bullq.storage.test.ts`.
 */

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

vi.mock("express-session", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("connect-pg-simple", () => ({ default: () => class MockPgStore {} }));
vi.mock("../db", () => ({ pool: {}, db: {} }));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

/** So o que `requireProvider` consulta: o provedor da sessao esta no ar? */
const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(async (id: number): Promise<any> => ({ id, name: "Provedor", status: "active" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

/** Os dubles guardam com QUE provedor foram chamados — e a prova do item 1. */
const chatMock = vi.hoisted(() => ({
  getIntegracaoDoChat: vi.fn(async (_p: number): Promise<any> => ({
    providerId: _p,
    agenteConfig: { primeiroContato: { ligada: true, limiteDiario: 12 } },
  })),
  contatosIniciadosNoDia: vi.fn(async (_p: number, _inicio: Date) => 3),
  ultimosPrimeirosContatos: vi.fn(async (_p: number, _limite: number): Promise<any[]> => [
    { em: new Date("2026-09-06T13:00:00Z"), origem: "cobranca", canal: "whatsapp", clienteId: 42, clienteNome: "Ana Maria Souza", resultado: null },
  ]),
}));
vi.mock("../storage/chat-bullq.storage", () => ({
  ChatBullqStorage: class { constructor() { return chatMock as any; } },
}));

const faturasMock = vi.hoisted(() => ({
  recuperacaoAposContato: vi.fn(async (_p: number, _o: any): Promise<any> => ({
    base: true, motivo: null, dias: 30, janelaDias: 7,
    desde: new Date("2026-08-07T00:00:00Z"), ate: new Date("2026-09-06T00:00:00Z"),
    valor: 1234.5, faturas: 9, clientes: 6,
    porOrigem: [{ chave: "assistente", valor: 834.5, faturas: 6, clientes: 4 }],
    porCanal: [{ chave: "whatsapp", valor: 1234.5, faturas: 9, clientes: 6 }],
  })),
}));
vi.mock("../storage/faturas.storage", () => ({
  FaturasStorage: class { constructor() { return faturasMock as any; } },
}));

import { esquecerStatusDeProvedor } from "../auth";
import {
  API_AUTOMACAO, API_RECUPERACAO, CONTATOS_POR_RODADA, SEGUNDOS_ENTRE_RODADAS,
  registerCobrancaIndicadoresRoutes,
} from "./cobranca-indicadores.routes";

const AMPLINET = 6;
const VIZINHO = 9;
const OPERADOR = { userId: 7, role: "user", providerId: AMPLINET };
const OPERADOR_VIZINHO = { userId: 11, role: "user", providerId: VIZINHO };
const SEM_PROVEDOR = { userId: 8, role: "revendedor", providerId: 0, marcaId: 3 };

let server: Server;
let base: string;
let sessao: Record<string, any> | null;

beforeEach(async () => {
  vi.clearAllMocks();
  esquecerStatusDeProvedor();
  storageMock.getProvider.mockImplementation(async (id: number) => ({ id, name: "Provedor", status: "active" }));
  sessao = { ...OPERADOR };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao ?? {}; next(); });
  app.use(registerCobrancaIndicadoresRoutes());

  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const pegar = (caminho: string) => fetch(`${base}${caminho}`);

/* ── Quem entra ──────────────────────────────────────────────────────── */

describe("a porta: sessao de provedor, e so ela", () => {
  it("sem sessao, 401 nas duas rotas — e nenhuma leitura sai", async () => {
    sessao = null;
    for (const rota of [API_AUTOMACAO, API_RECUPERACAO]) {
      expect((await pegar(rota)).status, rota).toBe(401);
    }
    expect(chatMock.contatosIniciadosNoDia).not.toHaveBeenCalled();
    expect(faturasMock.recuperacaoAposContato).not.toHaveBeenCalled();
  });

  it("sessao sem provedor (revendedor) leva 403: o indicador e operacional", async () => {
    sessao = { ...SEM_PROVEDOR };
    for (const rota of [API_AUTOMACAO, API_RECUPERACAO]) {
      expect((await pegar(rota)).status, rota).toBe(403);
    }
    expect(faturasMock.recuperacaoAposContato).not.toHaveBeenCalled();
  });

  it("provedor suspenso nao le indicador", async () => {
    storageMock.getProvider.mockImplementation(async (id: number) => ({ id, name: "Provedor", status: "suspended" }));
    const r = await pegar(API_RECUPERACAO);
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("PROVIDER_SUSPENDED");
  });

  it("o provedor e o da SESSAO — query nenhuma o troca", async () => {
    await pegar(`${API_AUTOMACAO}?providerId=${VIZINHO}`);
    await pegar(`${API_RECUPERACAO}?providerId=${VIZINHO}&provider_id=${VIZINHO}`);
    expect(chatMock.contatosIniciadosNoDia).toHaveBeenCalledWith(AMPLINET, expect.any(Date));
    expect(chatMock.ultimosPrimeirosContatos).toHaveBeenCalledWith(AMPLINET, 20);
    expect(faturasMock.recuperacaoAposContato).toHaveBeenCalledWith(AMPLINET, expect.anything());

    // A outra sessao le a outra carteira, no mesmo servidor.
    sessao = { ...OPERADOR_VIZINHO };
    await pegar(API_RECUPERACAO);
    expect(faturasMock.recuperacaoAposContato).toHaveBeenLastCalledWith(VIZINHO, expect.anything());
  });
});

/* ── O contador da automacao ─────────────────────────────────────────── */

describe(`GET ${API_AUTOMACAO}`, () => {
  it("devolve a contagem do worker, o teto do dia e o diario com o nome mascarado", async () => {
    const r = await pegar(API_AUTOMACAO);
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c.provisionado).toBe(true);
    expect(c.ligada).toBe(true);
    expect(c.hoje).toBe(3);
    expect(c.limiteDiario).toBe(12);
    expect(c.motivo).toBeNull();
    expect(c.porRodada).toBe(CONTATOS_POR_RODADA);
    expect(c.segundosEntreRodadas).toBe(SEGUNDOS_ENTRE_RODADAS);
    // LGPD: o painel e um relatorio de maquina, o nome inteiro nao e preciso.
    expect(c.envios).toHaveLength(1);
    expect(c.envios[0].cliente).toBe("Ana ***");
    expect(c.envios[0].canal).toBe("whatsapp");
    // Sem desfecho e traco na tela, e nulo aqui — nunca "sem sucesso".
    expect(c.envios[0].resultado).toBeNull();
  });

  it("a virada do dia e a do worker: comeco do dia no fuso de Brasilia", async () => {
    await pegar(API_AUTOMACAO);
    const [, inicio] = chatMock.contatosIniciadosNoDia.mock.calls[0];
    expect(inicio).toBeInstanceOf(Date);
    // Meia-noite em -03:00 = 03:00 UTC.
    expect((inicio as Date).getUTCHours()).toBe(3);
    expect((inicio as Date).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("sem integracao provisionada: hoje e teto sao NULOS com motivo, nunca zero", async () => {
    chatMock.getIntegracaoDoChat.mockResolvedValueOnce(undefined as any);
    const c = await (await pegar(API_AUTOMACAO)).json();
    expect(c.provisionado).toBe(false);
    expect(c.hoje).toBeNull();
    expect(c.limiteDiario).toBeNull();
    expect(c.motivo).toMatch(/provisionado/i);
    expect(c.envios).toEqual([]);
    // Nem adianta contar: nao ha automacao.
    expect(chatMock.contatosIniciadosNoDia).not.toHaveBeenCalled();
  });

  it("falha de leitura vira 500 com mensagem segura, e nao meio relatorio", async () => {
    chatMock.contatosIniciadosNoDia.mockRejectedValueOnce(new Error("banco fora"));
    const r = await pegar(API_AUTOMACAO);
    expect(r.status).toBe(500);
    expect(await r.json()).toHaveProperty("message");
  });
});

/* ── O recuperado ────────────────────────────────────────────────────── */

describe(`GET ${API_RECUPERACAO}`, () => {
  it("devolve total, quebra por origem e por canal, com as datas em ISO", async () => {
    const c = await (await pegar(API_RECUPERACAO)).json();
    expect(c.base).toBe(true);
    expect(c.valor).toBe(1234.5);
    expect(c.faturas).toBe(9);
    expect(c.porOrigem[0].chave).toBe("assistente");
    expect(c.porCanal[0].chave).toBe("whatsapp");
    expect(c.desde).toBe("2026-08-07T00:00:00.000Z");
    expect(c.ate).toBe("2026-09-06T00:00:00.000Z");
  });

  it("sem fatura do ERP: valores nulos e o motivo, jamais R$ 0,00", async () => {
    faturasMock.recuperacaoAposContato.mockResolvedValueOnce({
      base: false, motivo: "Nenhuma fatura veio do ERP deste provedor; nao ha o que conciliar.",
      dias: 30, janelaDias: 7, desde: new Date(0), ate: new Date(0),
      valor: null, faturas: null, clientes: null, porOrigem: [], porCanal: [],
    } as any);
    const c = await (await pegar(API_RECUPERACAO)).json();
    expect(c.base).toBe(false);
    expect(c.valor).toBeNull();
    expect(c.faturas).toBeNull();
    expect(c.motivo).toMatch(/ERP/);
  });

  it("periodo e janela vem da query, aparados; lixo cai no padrao de 30 e 7 dias", async () => {
    await pegar(`${API_RECUPERACAO}?dias=7&janela=3`);
    expect(faturasMock.recuperacaoAposContato).toHaveBeenLastCalledWith(AMPLINET, { dias: 7, janelaDias: 3 });

    await pegar(`${API_RECUPERACAO}?dias=abacaxi&janela=`);
    expect(faturasMock.recuperacaoAposContato).toHaveBeenLastCalledWith(AMPLINET, { dias: 30, janelaDias: 7 });

    await pegar(`${API_RECUPERACAO}?dias=9999&janela=0`);
    expect(faturasMock.recuperacaoAposContato).toHaveBeenLastCalledWith(AMPLINET, { dias: 365, janelaDias: 1 });
  });
});

/* ── O que a tela AFIRMA continua sendo verdade ──────────────────────── */

describe("os numeros do worker, lidos do fonte do worker", () => {
  const servico = readFileSync(
    new URL("../services/chat/chat-primeiro-contato.service.ts", import.meta.url),
    "utf8",
  );

  it("a rodada inicia no maximo CONTATOS_POR_RODADA contatos", () => {
    // `Math.min(5, automacao.limiteDiario - ...)` — o 5 e o teto por rodada.
    expect(servico).toMatch(new RegExp(`Math\\.min\\(\\s*${CONTATOS_POR_RODADA}\\s*,`));
  });

  it("a rodada corre a cada SEGUNDOS_ENTRE_RODADAS segundos", () => {
    expect(servico).toContain(`}, ${SEGUNDOS_ENTRE_RODADAS}_000);`);
  });

  it("conversa reaproveitada nao conta como envio — e o que a tela promete", () => {
    expect(servico).toContain("if (resultado.enviado) restantes--;");
  });
});
