/**
 * A TRAVA DE ACESSO DE SUPORTE, exercitada por um Express DE VERDADE.
 *
 * POR QUE UM APP MONTADO, E NAO UM `req` FALSO.
 *
 * O furo que este arquivo fecha nao estava na logica da trava — estava na
 * distancia entre o texto que o ROTEADOR casa e o texto que a trava comparava.
 * A trava saia cedo com `if (!req.path.startsWith("/api")) return next()`, uma
 * comparacao sensivel a caixa decidindo sobre um roteador que nao e: este
 * projeto nunca chamou `app.set("case sensitive routing", true)` e o default do
 * Express e false. Medido no express 5.2.1 deste `node_modules`:
 *
 *   GET /api/isp-consultations  -> handler alcancado, trava APLICADA
 *   GET /API/isp-consultations  -> MESMO handler,      trava IGNORADA
 *   GET /aPi/isp-consultations  -> MESMO handler,      trava IGNORADA
 *
 * Um `req` falso com `path: "/API/..."` teria "provado" o mesmo furo, mas nao
 * teria provado o que importa: que aquele endereco chega ao handler que serve
 * CPF, nome e telefone. Por isso cada caso abaixo sobe um app, registra a
 * trava como `suporte-acesso.routes.ts` registra (primeiro `use` da cadeia) e
 * fala HTTP com ele — a mesma montagem que o servidor usa.
 *
 * A exploracao que isto encerra: o suporte entra legitimamente, o provedor
 * clica em encerrar, e o suporte segue lendo o dado dos titulares por
 * `/API/customers` ate a sessao de 48h cair — com a trilha registrando que ele
 * tinha parado, porque o uso so era carimbado dentro da trava.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

vi.mock("express-session", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("connect-pg-simple", () => ({ default: () => class MockPgStore {} }));
vi.mock("./db", () => ({ pool: {}, db: {} }));

const storageMock = vi.hoisted(() => ({
  acessoDeSuporteValido: vi.fn(),
  registrarUsoDoAcesso: vi.fn(),
}));
vi.mock("./storage", () => ({ storage: storageMock }));

const loggerMock = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./logger", () => loggerMock);

import express from "express";
import type { AddressInfo } from "net";
import http from "http";
import {
  travaDeAcessoDeSuporte,
  esquecerRegistrosDeUso,
  CODIGO_SUPORTE_ENCERRADO,
  CODIGO_SUPORTE_NAO_VERIFICADO,
} from "./auth";

/** A sessao que o app do teste injeta. E o mesmo objeto que a trava muta. */
let sessao: Record<string, any>;

interface Resposta {
  status: number;
  corpo: any;
}

/**
 * Sobe o app na MESMA ordem do servidor: a trava primeiro, num router sem
 * caminho de montagem (como em `registerSuporteAcessoRoutes`), e so depois as
 * rotas que servem dado. Trocar a ordem aqui invalidaria o teste inteiro.
 */
async function comApp(uso: (pedir: (caminho: string) => Promise<Resposta>) => Promise<void>) {
  const app = express();
  app.use((req: any, _res, next) => {
    req.session = sessao;
    next();
  });

  const trava = express.Router();
  trava.use(travaDeAcessoDeSuporte);
  app.use(trava);

  const dados = express.Router();
  // Duas das rotas que servem dado pessoal completo do provedor personificado.
  dados.get("/api/isp-consultations", (_req, res) => res.json({ dado: "cpf do titular" }));
  dados.get("/api/customers", (_req, res) => res.json({ dado: "carteira inteira" }));
  app.use(dados);

  // Um asset da SPA: nao serve dado, e era o argumento da saida antecipada.
  app.get("/assets/app.js", (_req, res) => res.type("js").send("// spa"));
  app.use((_req, res) => res.status(404).json({ naoEncontrado: true }));

  const servidor = app.listen(0);
  await new Promise<void>((ok) => servidor.once("listening", () => ok()));
  const { port } = servidor.address() as AddressInfo;

  const pedir = (caminho: string) =>
    new Promise<Resposta>((ok) => {
      const req = http.request({ host: "127.0.0.1", port, path: caminho, method: "GET" }, (res) => {
        let bruto = "";
        res.on("data", (p) => (bruto += p));
        res.on("end", () => {
          let corpo: any = bruto;
          try {
            corpo = JSON.parse(bruto);
          } catch {
            /* asset nao e JSON */
          }
          ok({ status: res.statusCode ?? 0, corpo });
        });
      });
      req.on("error", () => ok({ status: 0, corpo: null }));
      req.end();
    });

  try {
    await uso(pedir);
  } finally {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  }
}

/** Sessao de superadmin personificando o provedor 7 por uma janela valida. */
function sessaoDeSuporte(overrides: Record<string, any> = {}) {
  return {
    userId: 1,
    role: "superadmin",
    providerId: 7,
    suporte: { acessoId: 99, providerId: 7, expiraEm: new Date(Date.now() + 3_600_000).toISOString() },
    ...overrides,
  };
}

const janelaAberta = { id: 99, providerId: 7, expiraEm: new Date(Date.now() + 3_600_000) };

beforeEach(() => {
  esquecerRegistrosDeUso();
  storageMock.acessoDeSuporteValido.mockReset().mockResolvedValue(janelaAberta);
  storageMock.registrarUsoDoAcesso.mockReset().mockResolvedValue(undefined);
  loggerMock.logger.info.mockReset();
  loggerMock.logger.warn.mockReset();
  loggerMock.logger.error.mockReset();
  sessao = sessaoDeSuporte();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("janela valida", () => {
  it("deixa passar e carimba o uso na trilha", async () => {
    await comApp(async (pedir) => {
      const r = await pedir("/api/isp-consultations");
      expect(r.status).toBe(200);
      expect(storageMock.acessoDeSuporteValido).toHaveBeenCalledWith(7);
      expect(storageMock.registrarUsoDoAcesso).toHaveBeenCalledWith(99, 1);
    });
  });

  it("o mesmo endereco em OUTRA CAIXA chega ao mesmo handler — a raiz do furo", async () => {
    // Este caso nao testa a trava: testa o roteador, e e a premissa de todos os
    // casos seguintes. Se um dia alguem ligar `case sensitive routing`, este
    // teste passa a falhar e conta exatamente o que mudou.
    await comApp(async (pedir) => {
      const r = await pedir("/API/isp-consultations");
      expect(r.status).toBe(200);
      expect(r.corpo).toEqual({ dado: "cpf do titular" });
    });
  });
});

describe("janela revogada — a personificacao cai, escreva-se o endereco como se escrever", () => {
  beforeEach(() => {
    // O provedor clicou em encerrar: nao ha mais janela valida.
    storageMock.acessoDeSuporteValido.mockResolvedValue(undefined);
  });

  const variantes = [
    ["a forma normal", "/api/isp-consultations"],
    ["caixa alta no prefixo — o furo medido", "/API/isp-consultations"],
    ["caixa misturada no prefixo", "/aPi/isp-consultations"],
    ["caminho inteiro em caixa alta", "/API/ISP-CONSULTATIONS"],
    ["caixa alta com barra final", "/API/isp-consultations/"],
    ["outra rota de dado, em caixa alta", "/API/customers"],
    ["um asset da SPA, que a saida antecipada deixava passar", "/assets/app.js"],
    ["a raiz, que nem e API", "/"],
    ["barra dupla", "//api/isp-consultations"],
    ["segmento ponto-ponto", "/api/x/../isp-consultations"],
    ["percent-encoding no prefixo", "/%61pi/isp-consultations"],
    ["caminho que nem existe", "/qualquer-coisa"],
  ] as const;

  for (const [nome, caminho] of variantes) {
    it(`derruba a personificacao: ${nome} (${caminho})`, async () => {
      await comApp(async (pedir) => {
        const r = await pedir(caminho);
        expect(r.status).toBe(403);
        expect(r.corpo.code).toBe(CODIGO_SUPORTE_ENCERRADO);
        // O dado nao saiu, e a sessao nao volta a personificar ninguem.
        expect(r.corpo.dado).toBeUndefined();
        expect(sessao.suporte).toBeUndefined();
        expect(sessao.providerId).toBe(0);
        // E o uso NAO e carimbado: a trilha nao pode dizer que a janela
        // continuou sendo usada depois de encerrada.
        expect(storageMock.registrarUsoDoAcesso).not.toHaveBeenCalled();
      });
    });
  }

  it("uma janela NOVA nao emenda a sessao antiga", async () => {
    // Revogar e liberar de novo cria outra autorizacao; quem estava dentro tem
    // de entrar por ela.
    storageMock.acessoDeSuporteValido.mockResolvedValue({ ...janelaAberta, id: 100 });
    await comApp(async (pedir) => {
      const r = await pedir("/API/isp-consultations");
      expect(r.status).toBe(403);
      expect(r.corpo.code).toBe(CODIGO_SUPORTE_ENCERRADO);
      expect(sessao.suporte).toBeUndefined();
    });
  });
});

describe("custo do caminho quente", () => {
  it("sessao sem personificacao nao consulta o banco, em nenhum endereco", async () => {
    sessao = { userId: 42, role: "admin", providerId: 3 };
    await comApp(async (pedir) => {
      for (const caminho of ["/api/customers", "/API/customers", "/assets/app.js", "/"]) {
        await pedir(caminho);
      }
      expect(storageMock.acessoDeSuporteValido).not.toHaveBeenCalled();
      expect(storageMock.registrarUsoDoAcesso).not.toHaveBeenCalled();
    });
  });

  it("sessao sem login nao consulta o banco", async () => {
    // Sem `userId` nao ha a quem atribuir o uso; `requireAuth` recusa adiante.
    sessao = { suporte: { acessoId: 99, providerId: 7, expiraEm: "" } };
    await comApp(async (pedir) => {
      await pedir("/api/customers");
      expect(storageMock.acessoDeSuporteValido).not.toHaveBeenCalled();
    });
  });

  it("dentro da personificacao TODA requisicao revalida, inclusive asset", async () => {
    // O preco da inversao, medido e aceito: quem paga a consulta extra e so a
    // sessao de suporte, que e rara, curta e vigiada.
    await comApp(async (pedir) => {
      await pedir("/assets/app.js");
      expect(storageMock.acessoDeSuporteValido).toHaveBeenCalledTimes(1);
    });
  });
});

describe("personificacao orfa — o login nao limpa `session.suporte`", () => {
  it("papel de provedor com `suporte` pendurado: a sobra e apagada e o dono legitimo segue", async () => {
    // `POST /api/auth/login` sobrescreve userId/providerId/role sem apagar
    // `suporte`. Sem esta blindagem a trava validaria a janela do provedor 7 e
    // carimbaria uso dela com o userId de quem acabou de entrar.
    sessao = { userId: 55, role: "admin", providerId: 7, suporte: { acessoId: 99, providerId: 7, expiraEm: "" } };
    await comApp(async (pedir) => {
      const r = await pedir("/api/customers");
      expect(r.status).toBe(200);
      expect(sessao.suporte).toBeUndefined();
      // O `providerId` veio do login DESTE usuario: apagar seria expulsa-lo.
      expect(sessao.providerId).toBe(7);
      expect(storageMock.acessoDeSuporteValido).not.toHaveBeenCalled();
      expect(storageMock.registrarUsoDoAcesso).not.toHaveBeenCalled();
    });
  });

  it("superadmin que fez login de novo: janela sem provedor aberto e recusada sem tocar o banco", async () => {
    // Depois do login o `providerId` volta a 0 e a janela de 7 sobra.
    sessao = sessaoDeSuporte({ providerId: 0 });
    await comApp(async (pedir) => {
      const r = await pedir("/api/customers");
      expect(r.status).toBe(403);
      expect(r.corpo.code).toBe(CODIGO_SUPORTE_ENCERRADO);
      expect(sessao.suporte).toBeUndefined();
      expect(storageMock.acessoDeSuporteValido).not.toHaveBeenCalled();
    });
  });

  it("janela de um provedor e sessao aberta em outro: recusa", async () => {
    sessao = sessaoDeSuporte({ providerId: 8 });
    await comApp(async (pedir) => {
      const r = await pedir("/api/customers");
      expect(r.status).toBe(403);
      expect(r.corpo.code).toBe(CODIGO_SUPORTE_ENCERRADO);
      expect(storageMock.acessoDeSuporteValido).not.toHaveBeenCalled();
    });
  });
});

describe("banco indisponivel", () => {
  it("recusa sem apagar a personificacao — soluco de rede nao e liberacao encerrada", async () => {
    storageMock.acessoDeSuporteValido.mockRejectedValue(new Error("connection terminated"));
    await comApp(async (pedir) => {
      const r = await pedir("/API/isp-consultations");
      expect(r.status).toBe(503);
      expect(r.corpo.code).toBe(CODIGO_SUPORTE_NAO_VERIFICADO);
      expect(r.corpo.dado).toBeUndefined();
      // Continua personificando: o provedor nao precisa autorizar de novo por
      // causa de uma falha de banco, e nada vazou.
      expect(sessao.suporte).toBeDefined();
      expect(sessao.providerId).toBe(7);
    });
  });
});
