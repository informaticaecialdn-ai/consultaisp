import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * A porta da demonstracao publica.
 *
 * O que roda contra CODIGO REAL, sem mock: `emModoDemo()` (o que muda entre
 * testes e `process.env.DEMO_MODE`, a mesma variavel que decide em produção)
 * e `normalizarHost()` (prova que o host de verdade — porta e caixa
 * incluidos — vira o valor gravado). `criarSandbox` e `storage.getProvider`
 * SAO espioes: a criacao real (~5 mil linhas por sandbox) e responsabilidade
 * de `sandbox.service.test.ts`, e aqui o que importa e o que a ROTA faz com
 * o retorno deles.
 *
 * `req.session` É UM OBJETO STUB (`{ save, cookie, ... }` montado abaixo),
 * NAO a sessao real do Express — nao ha `sessionMiddleware` nem
 * `connect-pg-simple` neste arquivo. Isso e legitimo para testar a rota
 * isolada (o contrato é "o handler grava estes campos neste objeto"), mas
 * não cobre a integração com o store de sessão de verdade — só a rota.
 *
 * O app Express (e portanto o rate limiter, que guarda estado num Map
 * fechado dentro de `createRateLimiter`) e recriado a CADA teste — sem isso,
 * os pedidos a `/demo` espalhados pelos testes anteriores ao de limite
 * dividiriam o mesmo balde e o teste de limite ficaria refem da ordem de
 * execucao dos outros.
 */

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

const sandboxMock = vi.hoisted(() => ({
  criarSandbox: vi.fn(async () => ({
    providerId: 42,
    userId: 7,
    subdomain: "sandbox-abc123",
    // Relativo a "agora": o teste de TTL do cookie (abaixo) compara isto
    // contra `Date.now()` no momento da asserção, e uma data absoluta fixa
    // ficaria refem de quando a suíte roda de verdade.
    expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })),
  // Por padrao, bem abaixo do teto — a maioria dos testes quer o caminho
  // feliz de criacao. O teste do teto (abaixo) troca para um valor >= ele.
  contarSandboxesVivos: vi.fn(async () => 0),
  TETO_DE_SANDBOXES_VIVOS: 150,
  // Constante de verdade (nao ha comportamento a espionar) — precisa existir
  // no mock porque este arquivo substitui o MODULO inteiro.
  PREFIXO_SANDBOX: "sandbox-",
  // O mundo versionado (16/09/2026): por padrao o sandbox da sessao e do
  // mundo ATUAL — a maioria dos testes quer o reaproveitamento de sempre. A
  // regra de data em si e pura e provada em `sandbox.service.test.ts`; aqui o
  // que importa e o que a ROTA faz com a resposta dela (e com qual `createdAt`
  // ela e perguntada).
  sandboxDesatualizado: vi.fn((_createdAt: unknown) => false),
  apagarSandbox: vi.fn(async (_providerId: number) => undefined),
}));
vi.mock("../demo/sandbox.service", () => sandboxMock);

const loggerMock = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../logger", () => loggerMock);

const storageMock = vi.hoisted(() => ({
  // Por padrao, o sandbox "ainda existe" e esta ATIVO — a maioria dos testes
  // quer o caminho feliz de reaproveitamento (incluindo `requireProvider`,
  // real e nao mockado neste arquivo, que consulta `storage.getProvider` via
  // `provedorSuspenso` e trata a ausencia de `status: "active"` como
  // suspenso). Quem quer o contrario usa `mockResolvedValueOnce`.
  getProvider: vi.fn(async () => ({ id: 42, subdomain: "sandbox-abc123", status: "active" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

const exemplosMock = vi.hoisted(() => ({ cpfsDeExemplo: vi.fn() }));
vi.mock("../demo/exemplos.service", () => exemplosMock);

import { registerDemoRoutes, filaDeCriacaoDoSandbox } from "./demo.routes";

const HOST_DA_DEMO = "demo.consultaisp.com.br";
const DEMO_MODE_ORIGINAL = process.env.DEMO_MODE;

/** Espelha VIDA_DO_SANDBOX_MS (server/demo/sandbox.service.ts) — 24h. */
const VIDA_DO_SANDBOX_MS = 24 * 60 * 60 * 1000;
/**
 * Espelha SESSAO_PADRAO_MS (server/auth.ts:12) — 48h, o padrao global que a
 * sessao herdaria se esta rota NUNCA tocasse `cookie.maxAge`. Nao importado
 * de la: importar `../auth` de verdade exige mockar `express-session`,
 * `connect-pg-simple` e `../db` so por uma constante que esta rota nem
 * referencia — o valor e estavel e documentado, e o comentario acima aponta
 * de volta pra fonte.
 */
const SESSAO_PADRAO_MS_DA_PLATAFORMA = 2 * 24 * 60 * 60 * 1000;

let server: Server;
let base: string;
let sessao: Record<string, unknown>;
let host: string;

async function subirServidor(): Promise<void> {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    // `hostname` e getter de prototipo no Express — a propriedade propria o
    // encobre, do mesmo jeito que `X-Forwarded-Host` faz com trust proxy ligado.
    Object.defineProperty(req, "hostname", { value: host, configurable: true });
    next();
  });
  app.use(registerDemoRoutes());
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
}

beforeEach(async () => {
  vi.clearAllMocks();
  sessao = { save: (cb: (e?: unknown) => void) => cb() };
  host = HOST_DA_DEMO;
  process.env.DEMO_MODE = "true";
  await subirServidor();
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (DEMO_MODE_ORIGINAL === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = DEMO_MODE_ORIGINAL;
});

const pedirDemo = () => fetch(`${base}/demo`, { redirect: "manual" });

describe("GET /demo fora de DEMO_MODE", () => {
  it("responde 404 explicito do handler, mesmo sem qualquer sessao", async () => {
    delete process.env.DEMO_MODE;
    sessao = {};

    const res = await pedirDemo();

    expect(res.status).toBe(404);
    // .json() aqui so funciona porque o corpo E JSON: prova que quem respondeu
    // foi o handler (res.status(404).json(...)), nao a pagina padrao do Express
    // para rota inexistente (que seria HTML, e faria .json() estourar).
    expect(await res.json()).toEqual({ message: "Nao encontrado" });
    expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
  });

  it("qualquer valor diferente da string exata 'true' tambem e 404", async () => {
    process.env.DEMO_MODE = "1";

    expect((await pedirDemo()).status).toBe(404);
    expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
  });
});

describe("GET /demo em DEMO_MODE", () => {
  it("cria o sandbox, grava os cinco campos de sessao e redireciona para /", async () => {
    const res = await pedirDemo();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);
    expect(sessao).toMatchObject({
      userId: 7,
      providerId: 42,
      role: "admin",
      hostLogin: HOST_DA_DEMO,
      subdomain: "sandbox-abc123",
    });
    // Primeira visita: nao ha sessao pra reaproveitar, entao a existencia de
    // um sandbox nem chega a ser conferida.
    expect(storageMock.getProvider).not.toHaveBeenCalled();
  });

  it("hostLogin sai de normalizarHost de verdade — porta e caixa somem", async () => {
    host = "DEMO.consultaisp.com.br:8443";

    await pedirDemo();

    expect(sessao.hostLogin).toBe(HOST_DA_DEMO);
  });

  it("subdomain e o do SANDBOX recem-criado, nao um extraido do host", async () => {
    // Um host que nem tem subdominio de provedor extraivel — so para deixar
    // claro que o valor gravado nao pode ter vindo de req.hostname.
    host = HOST_DA_DEMO;

    await pedirDemo();

    expect(sessao.subdomain).toBe("sandbox-abc123");
  });

  it("segundo acesso com sessao viva reaproveita o mesmo sandbox, sem criar outro", async () => {
    const primeiro = await pedirDemo();
    expect(primeiro.status).toBe(302);
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);

    // `sessao` e o MESMO objeto que a rota acabou de mutar — simula o cookie
    // voltando numa segunda visita. `storage.getProvider` (padrao do mock)
    // confirma que o provedor 42 ainda existe.
    const segundo = await pedirDemo();

    expect(segundo.status).toBe(302);
    expect(segundo.headers.get("location")).toBe("/");
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);
    expect(storageMock.getProvider).toHaveBeenCalledWith(42);
  });

  it("sessao viva mas sandbox ja apagado pela limpeza: cria um novo, nao reaproveita dado morto", async () => {
    const primeiro = await pedirDemo();
    expect(primeiro.status).toBe(302);
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);

    // A limpeza horaria (Tarefa 7) ja apagou o provedor: o cookie ainda
    // "vale" no navegador, mas o registro no banco sumiu.
    storageMock.getProvider.mockResolvedValueOnce(undefined);

    const segundo = await pedirDemo();

    expect(segundo.status).toBe(302);
    expect(segundo.headers.get("location")).toBe("/");
    // NAO reaproveitou a sessao orfa — criou um sandbox NOVO em vez de
    // redirecionar para "/" apontando para dado que nao existe mais.
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(2);
  });

  /**
   * O mundo versionado da demonstração (16/09/2026): o dono viu "não aparece a
   * Economia do cliente" e "não tem simulação do chat" — o navegador dele
   * guardava o cookie de um sandbox criado ANTES do deploy que mudou a
   * semeadura, e a rota reaproveitava só conferindo que ele ainda existia. O
   * mundo dos sandboxes vivos não migra nos deploys (sandbox é descartável):
   * um sandbox anterior ao mundo atual é APAGADO e substituído por um novo,
   * pelo mesmo caminho de criação de sempre (fila, teto, sessão e cookie novos).
   */
  describe("sandbox anterior ao mundo atual e substituido", () => {
    const CRIADO_ANTES_DO_MUNDO_ATUAL = new Date("2026-09-10T12:00:00.000Z");

    function sessaoVivaNoSandboxAntigo() {
      sessao = { save: (cb: (e?: unknown) => void) => cb(), destroy: vi.fn((cb: (e?: unknown) => void) => cb()), userId: 7, providerId: 42, role: "admin", hostLogin: HOST_DA_DEMO, subdomain: "sandbox-abc123" };
      storageMock.getProvider.mockResolvedValueOnce({ id: 42, subdomain: "sandbox-abc123", status: "active", createdAt: CRIADO_ANTES_DO_MUNDO_ATUAL });
      sandboxMock.sandboxDesatualizado.mockReturnValueOnce(true);
      sandboxMock.criarSandbox.mockResolvedValueOnce({
        providerId: 43, userId: 8, subdomain: "sandbox-def456",
        expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    it("sessao viva + sandbox criado antes do mundo atual: apaga o antigo, cria um novo e a sessao passa a apontar para ele", async () => {
      sessaoVivaNoSandboxAntigo();

      const res = await pedirDemo();

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
      // A pergunta e feita com o `createdAt` do PROVEDOR da sessao — nunca com
      // o relogio, nem com outro campo.
      expect(sandboxMock.sandboxDesatualizado).toHaveBeenCalledWith(CRIADO_ANTES_DO_MUNDO_ATUAL);
      expect(sandboxMock.apagarSandbox).toHaveBeenCalledWith(42);
      expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);
      // A sessao e REGRAVADA com o sandbox novo — e assim que o cookie antigo
      // deixa de apontar para o mundo velho.
      expect(sessao).toMatchObject({ userId: 8, providerId: 43, subdomain: "sandbox-def456" });
      expect(loggerMock.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ providerAntigo: 42, providerNovo: 43, antigoApagado: true }),
        "demo: sandbox anterior ao mundo atual substituído",
      );
      // A sessao foi REGRAVADA, nao destruida: o cookie aponta para o novo.
      expect(sessao.destroy).not.toHaveBeenCalled();
    });

    it("sessao de provedor de VERDADE (sem prefixo sandbox-) com createdAt antigo: redireciona para / como sempre — nada e apagado nem criado por cima da sessao", async () => {
      // Em modo demo o dono entra no provedor-modelo pelo login normal; a
      // regra de data e SO para sandbox (como no /me e no login).
      sessao = { save: (cb: (e?: unknown) => void) => cb(), destroy: vi.fn((cb: (e?: unknown) => void) => cb()), userId: 1, providerId: 5, role: "admin", hostLogin: HOST_DA_DEMO, subdomain: "nslink" };
      storageMock.getProvider.mockResolvedValueOnce({ id: 5, subdomain: "nslink", status: "active", createdAt: CRIADO_ANTES_DO_MUNDO_ATUAL });
      sandboxMock.sandboxDesatualizado.mockReturnValueOnce(true);
      try {
        const res = await pedirDemo();

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/");
        // O prefixo decide antes da data: a pergunta nem e feita.
        expect(sandboxMock.sandboxDesatualizado).not.toHaveBeenCalled();
        expect(sandboxMock.apagarSandbox).not.toHaveBeenCalled();
        expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
        expect(sessao).toMatchObject({ userId: 1, providerId: 5, subdomain: "nslink" });
        expect(sessao.destroy).not.toHaveBeenCalled();
        expect(loggerMock.logger.info).not.toHaveBeenCalled();
        expect(loggerMock.logger.warn).not.toHaveBeenCalled();
      } finally {
        // O `Once` nao consumido nao pode vazar para o proximo teste.
        sandboxMock.sandboxDesatualizado.mockReset();
        sandboxMock.sandboxDesatualizado.mockImplementation((_createdAt: unknown) => false);
      }
    });

    it("fila funda: recusa com 503 ANTES de apagar o antigo — a sessao continua no sandbox antigo (a faixa segue oferecendo renovar), nada fica orfao", async () => {
      const liberar: Array<() => void> = [];
      const tarefaTravada = () => new Promise<void>((resolve) => { liberar.push(resolve); });
      for (let i = 0; i < 20; i++) void filaDeCriacaoDoSandbox(tarefaTravada);
      try {
        sessaoVivaNoSandboxAntigo();

        const res = await pedirDemo();

        expect(res.status).toBe(503);
        expect(sandboxMock.apagarSandbox).not.toHaveBeenCalled();
        expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
        expect(sessao).toMatchObject({ userId: 7, providerId: 42 });
        expect(sessao.destroy).not.toHaveBeenCalled();
      } finally {
        // O mesmo dreno do teste da fila, mais abaixo: libera o que ja tem, cede um tick, repete ate zerar.
        while (filaDeCriacaoDoSandbox.pendingCount > 0 || filaDeCriacaoDoSandbox.activeCount > 0) {
          while (liberar.length > 0) liberar.shift()!();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        sandboxMock.criarSandbox.mockReset();
        sandboxMock.criarSandbox.mockImplementation(async () => ({
          providerId: 42, userId: 7, subdomain: "sandbox-abc123", expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }));
      }
    });

    it("o antigo ja apagado e o novo nao nasceu (criacao falhou): 500 e a sessao e ESQUECIDA — o cookie nao pode apontar para o nada", async () => {
      sessaoVivaNoSandboxAntigo();
      sandboxMock.criarSandbox.mockReset();
      sandboxMock.criarSandbox.mockRejectedValueOnce(new Error("boom"));

      const res = await pedirDemo();

      expect(res.status).toBe(500);
      expect(sandboxMock.apagarSandbox).toHaveBeenCalledWith(42);
      expect(sessao.destroy).toHaveBeenCalledTimes(1);
      sandboxMock.criarSandbox.mockImplementation(async () => ({
        providerId: 42, userId: 7, subdomain: "sandbox-abc123", expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }));
    });

    it("o antigo e apagado ANTES de o novo ser criado — a vaga no teto de vivos e devolvida primeiro", async () => {
      sessaoVivaNoSandboxAntigo();
      const ordem: string[] = [];
      sandboxMock.apagarSandbox.mockImplementationOnce(async () => { ordem.push("apagar"); });
      sandboxMock.criarSandbox.mockReset();
      sandboxMock.criarSandbox.mockImplementationOnce(async () => {
        ordem.push("criar");
        return { providerId: 43, userId: 8, subdomain: "sandbox-def456", expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000) };
      });

      await pedirDemo();

      expect(ordem).toEqual(["apagar", "criar"]);
      sandboxMock.criarSandbox.mockImplementation(async () => ({
        providerId: 42, userId: 7, subdomain: "sandbox-abc123", expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }));
    });

    it("sandbox do mundo ATUAL (createdAt novo): reaproveita como sempre, sem apagar nada", async () => {
      const CRIADO_NO_MUNDO_ATUAL = new Date();
      sessao = { save: (cb: (e?: unknown) => void) => cb(), userId: 7, providerId: 42, role: "admin", hostLogin: HOST_DA_DEMO, subdomain: "sandbox-abc123" };
      storageMock.getProvider.mockResolvedValueOnce({ id: 42, subdomain: "sandbox-abc123", status: "active", createdAt: CRIADO_NO_MUNDO_ATUAL });

      const res = await pedirDemo();

      expect(res.status).toBe(302);
      expect(sandboxMock.sandboxDesatualizado).toHaveBeenCalledWith(CRIADO_NO_MUNDO_ATUAL);
      expect(sandboxMock.apagarSandbox).not.toHaveBeenCalled();
      expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
      expect(sessao.providerId).toBe(42);
    });

    it("falha ao apagar o antigo NAO impede o novo: vira aviso no log e a limpeza horaria termina o servico", async () => {
      sessaoVivaNoSandboxAntigo();
      sandboxMock.apagarSandbox.mockRejectedValueOnce(new Error("deadlock detected"));

      const res = await pedirDemo();

      expect(res.status).toBe(302);
      expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);
      expect(sessao).toMatchObject({ userId: 8, providerId: 43 });
      expect(loggerMock.logger.warn).toHaveBeenCalledTimes(1);
      expect(loggerMock.logger.warn.mock.calls[0][0]).toMatchObject({ providerId: 42, erroMensagem: "deadlock detected" });
      // O info diz que a sessao trocou, e que o antigo continua vivo ate a limpeza.
      expect(loggerMock.logger.info).toHaveBeenCalledWith(expect.objectContaining({ providerAntigo: 42, providerNovo: 43, antigoApagado: false }), "demo: sandbox anterior ao mundo atual substituído");
    });

    /*
     * O teto existe para conter CRIACAO nova. A substituicao nao cria ninguem:
     * reocupa a vaga que o proprio visitante devolveu uma linha antes. Barra-lo
     * aqui o deixava SEM demonstracao nenhuma — o antigo apagado, o novo nao
     * criado e a sessao destruida — com a porta limitada a 2 por IP em 10 min.
     */
    it("sandbox desatualizado com o teto batido: o antigo ja foi apagado, entao o teto NAO barra a substituicao — o visitante sai com o sandbox novo", async () => {
      sessaoVivaNoSandboxAntigo();
      sandboxMock.contarSandboxesVivos.mockResolvedValue(150);

      const res = await pedirDemo();

      expect(res.status).toBe(302);
      expect(sandboxMock.apagarSandbox).toHaveBeenCalledWith(42);
      expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);
      expect(sessao).toMatchObject({ userId: 8, providerId: 43 });
      expect(sessao.destroy).not.toHaveBeenCalled();
      // A vaga ja era dele: o teto nem chega a ser consultado.
      expect(sandboxMock.contarSandboxesVivos).not.toHaveBeenCalled();
      sandboxMock.contarSandboxesVivos.mockResolvedValue(0);
    });
    it("falha ao apagar o antigo E teto batido: ai sim o teto barra — nada foi apagado, o visitante segue no sandbox que tem", async () => {
      sessaoVivaNoSandboxAntigo();
      sandboxMock.apagarSandbox.mockRejectedValueOnce(new Error("deadlock detected"));
      sandboxMock.contarSandboxesVivos.mockResolvedValueOnce(150);

      const res = await pedirDemo();

      expect(res.status).toBe(503);
      expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
      expect(sessao.destroy).not.toHaveBeenCalled();
      expect(sessao).toMatchObject({ userId: 7, providerId: 42 });
      // `criarSandbox` recebeu um `mockResolvedValueOnce` que nao foi consumido
      // (o teto barrou antes) — descarta, para o proximo teste nao herdar o 43.
      sandboxMock.criarSandbox.mockReset();
      sandboxMock.criarSandbox.mockImplementation(async () => ({
        providerId: 42, userId: 7, subdomain: "sandbox-abc123", expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }));
    });
  });

  it("500 com mensagem segura quando a criacao do sandbox falha, sem gravar sessao", async () => {
    sandboxMock.criarSandbox.mockRejectedValueOnce(new Error("boom"));

    const res = await pedirDemo();

    expect(res.status).toBe(500);
    expect(sessao.userId).toBeUndefined();
    expect(sessao.providerId).toBeUndefined();
    // Primeira visita: a verificacao de existencia nem entra em cena.
    expect(storageMock.getProvider).not.toHaveBeenCalled();
  });

  /**
   * Item 5 do plano de 2026-09-11: o 500 tambem respondia JSON cru. Mesma
   * pagina do 429 (`server/routes/demo-porta-html.ts`), com o texto seguro de
   * `getSafeErrorMessage` (nunca "boom" cru, o detalhe interno) e um jeito
   * claro de seguir em frente.
   */
  it("500 vira pagina HTML no visual da landing, com o texto de getSafeErrorMessage e o que fazer a seguir", async () => {
    // `getSafeErrorMessage` (server/utils/safe-error.ts) e quem decide se a
    // mensagem crua aparece ou vira "Erro interno do servidor" — so troca
    // pelo texto generico quando NODE_ENV=production, o que este teste (como
    // o resto da suite) nao roda sob. O que esta correcao muda e SO a
    // EMBALAGEM (HTML em vez de JSON); a mensagem em si continua sendo
    // decidida por aquela funcao, ja coberta em outro lugar.
    sandboxMock.criarSandbox.mockRejectedValueOnce(new Error("boom"));

    const res = await pedirDemo();

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const corpo = await res.text();
    expect(corpo).toMatch(/<!doctype html>/i);
    expect(corpo).toMatch(/boom/); // o texto que getSafeErrorMessage devolveu, incorporado na pagina
    expect(corpo).toMatch(/Tente novamente/);
    expect(corpo).toMatch(/href="\/"/);
  });

  it("500 quando a verificacao de existencia falha — nao tenta criar outro por cima", async () => {
    sessao = { save: (cb: (e?: unknown) => void) => cb(), userId: 7, providerId: 42 };
    storageMock.getProvider.mockRejectedValueOnce(new Error("banco fora do ar"));

    const res = await pedirDemo();

    expect(res.status).toBe(500);
    expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
  });
});

describe("GET /demo — o cookie nao sobrevive ao sandbox", () => {
  it("maxAge fica preso a expiraEm do sandbox, nao ao padrao global de 48h", async () => {
    // Simula o que a sessao real entregaria: `cookie.maxAge` ja presente, no
    // padrao GLOBAL da plataforma. Se a rota nunca tocasse este campo, o
    // valor permaneceria EXATAMENTE este — e essa e a regressao que o teste
    // existe para pegar (o cookie "sobrevivendo" ao sandbox).
    sessao = { save: (cb: (e?: unknown) => void) => cb(), cookie: { maxAge: SESSAO_PADRAO_MS_DA_PLATAFORMA } };

    await pedirDemo();

    const maxAge = (sessao.cookie as { maxAge: number }).maxAge;
    expect(maxAge).not.toBe(SESSAO_PADRAO_MS_DA_PLATAFORMA);
    expect(maxAge).toBeLessThanOrEqual(VIDA_DO_SANDBOX_MS);
    // Folga generosa (1 min) para o tempo de execucao do teste — a chamada
    // mockada e sincrona o bastante para sobrar bem menos que isso.
    expect(maxAge).toBeGreaterThan(VIDA_DO_SANDBOX_MS - 60_000);
  });

  it("a segunda visita (sandbox ainda vivo) nao reescreve o cookie", async () => {
    sessao = { save: (cb: (e?: unknown) => void) => cb(), cookie: { maxAge: SESSAO_PADRAO_MS_DA_PLATAFORMA } };
    await pedirDemo();
    const maxAgeAposCriar = (sessao.cookie as { maxAge: number }).maxAge;

    await pedirDemo(); // segunda visita: sessao viva, sandbox confirmado no banco

    expect((sessao.cookie as { maxAge: number }).maxAge).toBe(maxAgeAposCriar);
  });
});

describe("GET /demo — limite", () => {
  it("2 pedidos passam e o 3o e recusado com 429", async () => {
    const status: number[] = [];
    for (let i = 0; i < 3; i++) {
      // Sessao nova a cada volta: sem isto, a partir da 2a chamada
      // `chaveDoLimite` passaria a chavear por `p:42` (a sessao ja teria
      // providerId da chamada anterior) em vez de por IP, e as 3 chamadas
      // nunca cairiam no mesmo balde.
      sessao = { save: (cb: (e?: unknown) => void) => cb() };
      status.push((await pedirDemo()).status);
    }

    expect(status.slice(0, 2)).toEqual([302, 302]);
    expect(status[2]).toBe(429);
  });

  it("o 429 diz quanto esperar, em vez de so recusar", async () => {
    for (let i = 0; i < 2; i++) {
      sessao = { save: (cb: (e?: unknown) => void) => cb() };
      await pedirDemo();
    }
    sessao = { save: (cb: (e?: unknown) => void) => cb() };

    const res = await pedirDemo();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    // Item 5 do plano de 2026-09-11: a resposta virou pagina HTML, nao mais
    // JSON cru — mas o quanto esperar continua na tela, so que em prosa.
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const corpo = await res.text();
    expect(corpo).toMatch(/<html/i);
    expect(corpo).toMatch(/\d+ minuto/);
  });

  /**
   * Item 5 do plano de 2026-09-11: ate aqui o 429 respondia
   * `{"message":"Muitas tentativas..."}` cru — um estranho que clica duas
   * vezes rapido demais via um blob de JSON no lugar de qualquer coisa que
   * pareca um site. A pagina segue a linguagem visual da landing (a MESMA
   * excecao ao DESIGN_SYSTEM.md que ela e a porta de entrada da plataforma
   * ja sao).
   */
  it("o 429 vira pagina HTML no visual da landing, nunca JSON cru", async () => {
    for (let i = 0; i < 2; i++) {
      sessao = { save: (cb: (e?: unknown) => void) => cb() };
      await pedirDemo();
    }
    sessao = { save: (cb: (e?: unknown) => void) => cb() };

    const res = await pedirDemo();

    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const corpo = await res.text();
    expect(corpo).toMatch(/<!doctype html>/i);
    expect(corpo).toMatch(/consulta<span[^>]*>\.isp/); // o wordmark /consulta.isp
    expect(corpo).toMatch(/href="\/"/); // diz o que fazer a seguir: volta pra home
  });
});

/**
 * Revisão final de segurança (item 5): um teto GLOBAL de sandboxes vivos, além
 * do limite por IP acima — sem ele, muitos IPs diferentes (o limite de 2/10min
 * só trava por IP) podiam somar sandboxes sem parar, e cada um grava ~2.000
 * linhas num banco que compartilha o filesystem com produção. Ver a
 * justificativa completa de `TETO_DE_SANDBOXES_VIVOS` em sandbox.service.ts.
 */
describe("GET /demo — teto de sandboxes vivos", () => {
  it("no teto (150), recusa com 503 e nao cria sandbox nenhum", async () => {
    sandboxMock.contarSandboxesVivos.mockResolvedValueOnce(150);

    const res = await pedirDemo();

    expect(res.status).toBe(503);
    expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
  });

  it("acima do teto, tambem recusa", async () => {
    sandboxMock.contarSandboxesVivos.mockResolvedValueOnce(151);

    const res = await pedirDemo();

    expect(res.status).toBe(503);
    expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
  });

  it("um a menos que o teto ainda cria normalmente", async () => {
    sandboxMock.contarSandboxesVivos.mockResolvedValueOnce(149);

    const res = await pedirDemo();

    expect(res.status).toBe(302);
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);
  });

  it("visitante que RETORNA (sessao com sandbox ainda vivo) nunca esbarra no teto", async () => {
    // Primeira visita: cria normalmente (chama contarSandboxesVivos uma vez).
    await pedirDemo();
    sandboxMock.contarSandboxesVivos.mockClear();
    // Simula a demonstracao lotada bem depois — se a rota conferisse o teto
    // ANTES do reaproveitamento, esta segunda visita cairia nele por engano.
    sandboxMock.contarSandboxesVivos.mockResolvedValueOnce(150);

    const segundo = await pedirDemo();

    expect(segundo.status).toBe(302);
    expect(sandboxMock.contarSandboxesVivos).not.toHaveBeenCalled();

    // A asserção acima PROVA que o "150" nunca foi consumido — mas ele
    // continua ENFILEIRADO no mock (`clearAllMocks`, no `beforeEach`, limpa
    // histórico de chamadas, não a fila de `mockResolvedValueOnce`). Sem
    // descartar aqui, o próximo teste deste arquivo que CHAME
    // `contarSandboxesVivos` herdaria esse "150" na primeira chamada — foi
    // o que aconteceu ao escrever o describe de serialização, mais abaixo.
    sandboxMock.contarSandboxesVivos.mockReset();
    sandboxMock.contarSandboxesVivos.mockImplementation(async () => 0);
  });
});

/**
 * Revisão final de segurança antes da demonstração pública (item 3): o
 * check-then-create (conferir o teto, depois criar) não tinha trava nenhuma
 * — duas requisições concorrentes liam a mesma contagem, abaixo do teto,
 * ANTES de qualquer uma commitar a própria criação, e cada `criarSandbox`
 * monta uma carteira inteira (~5 mil linhas) num processo de 512 MB.
 */
describe("GET /demo — criacao serializada dentro do processo", () => {
  it("duas requisicoes concorrentes NUNCA constroem duas carteiras ao mesmo tempo", async () => {
    let emAndamento = 0;
    let maiorConcorrencia = 0;
    sandboxMock.criarSandbox.mockImplementation(async () => {
      emAndamento++;
      maiorConcorrencia = Math.max(maiorConcorrencia, emAndamento);
      await new Promise((resolve) => setTimeout(resolve, 30));
      emAndamento--;
      return {
        providerId: 42,
        userId: 7,
        subdomain: "sandbox-abc123",
        expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    });

    try {
      // Sessao vazia e COMPARTILHADA entre as duas chamadas — simula duas
      // requisicoes concorrentes chegando sem cookie nenhum (duplo clique,
      // prefetch), o cenario que o comentario do rate limiter ja descreve.
      sessao = { save: (cb: (e?: unknown) => void) => cb() };

      const [a, b] = await Promise.all([pedirDemo(), pedirDemo()]);

      expect(a.status).toBe(302);
      expect(b.status).toBe(302);
      expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(2);
      // A prova central: as duas criacoes nunca estiveram "em andamento" ao
      // mesmo tempo — sem a serializacao, as duas concorreriam (2), porque
      // contarSandboxesVivos() resolve quase instantaneamente para as duas
      // ANTES de qualquer criarSandbox() comecar.
      expect(maiorConcorrencia).toBe(1);
    } finally {
      // Restaura o padrao do arquivo — este e o `it()` que MAIS precisa
      // disso, porque sobrescreveu com `mockImplementation` (persistente),
      // nao `mockResolvedValueOnce` (o padrao dos outros testes deste arquivo).
      sandboxMock.criarSandbox.mockImplementation(async () => ({
        providerId: 42,
        userId: 7,
        subdomain: "sandbox-abc123",
        expiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }));
    }
  });
});

/**
 * Item 5 da rodada seguinte: a fila é FIFO e ilimitada, e cada criação leva
 * ~2s — com o nginx da demo em `proxy_read_timeout 60s`, o visitante lá pelo
 * 30º lugar da fila levaria um 504 OPACO da nginx (nunca a mensagem desta
 * rota) ENQUANTO o servidor terminava de montar o sandbox dele mesmo assim,
 * ao fundo, queimando uma vaga do teto de 150 por 24h com alguém que nunca
 * viu a demonstração.
 *
 * A fila (`filaDeCriacaoDoSandbox`) é um SINGLETON no módulo — vive por todo
 * o arquivo, não é recriada a cada teste como o router é (`subirServidor`).
 * Por isso cada teste que a enche precisa DRENÁ-LA por completo antes de
 * terminar (`finally`), senão o próximo teste do arquivo herdaria tarefas
 * presas.
 */
describe("GET /demo — fila de criação tem profundidade máxima", () => {
  it("com a fila funda (> 10 pendentes), recusa com 503 NA HORA — nunca entra na fila nem chama o servico", async () => {
    const liberar: Array<() => void> = [];
    const tarefaTravada = () => new Promise<void>((resolve) => { liberar.push(resolve); });
    // Concorrencia 1: a primeira tarefa fica ATIVA (roda), o resto fica
    // PENDENTE. 20 tarefas dao pendingCount=19 — bem alem do teto de 10,
    // com folga contra qualquer erro de um-a-mais/um-a-menos.
    for (let i = 0; i < 20; i++) {
      void filaDeCriacaoDoSandbox(tarefaTravada);
    }

    try {
      expect(filaDeCriacaoDoSandbox.pendingCount).toBeGreaterThan(10);

      sessao = { save: (cb: (e?: unknown) => void) => cb() };
      const res = await pedirDemo();

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ message: "A demonstração está muito concorrida agora. Tente novamente em alguns minutos." });
      // A prova central: a requisicao nem CHEGOU a entrar na fila — nao
      // conferiu o teto de vivos nem tentou criar nada.
      expect(sandboxMock.contarSandboxesVivos).not.toHaveBeenCalled();
      expect(sandboxMock.criarSandbox).not.toHaveBeenCalled();
    } finally {
      // Libera as 20 tarefas travadas e espera a fila esvaziar de verdade,
      // para o PROXIMO teste do arquivo (fila e singleton do modulo) comecar
      // do zero.
      //
      // Concorrencia 1: so UMA tarefa esta "ativa" (invocada) de cada vez —
      // `tarefaTravada` das outras 19 so roda quando a ativa termina e
      // `resumeNext()` promove a proxima. Ou seja, `liberar` ganha um item
      // NOVO a cada rodada (nao os 20 de uma vez): um `forEach` unico so
      // libera a primeira e trava nas outras 19. Por isso o dreno e um
      // LACO — libera o que ja tem, cede um tick pra proxima ser promovida
      // e empurrar o proprio resolve, repete ate a fila zerar.
      while (filaDeCriacaoDoSandbox.pendingCount > 0 || filaDeCriacaoDoSandbox.activeCount > 0) {
        while (liberar.length > 0) liberar.shift()!();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  });

  it("com a fila rasa (nenhuma tarefa presa), o pedido segue normalmente e cria o sandbox", async () => {
    expect(filaDeCriacaoDoSandbox.pendingCount).toBe(0);

    const res = await pedirDemo();

    expect(res.status).toBe(302);
    expect(sandboxMock.criarSandbox).toHaveBeenCalledTimes(1);
  });
});

/**
 * Os três CPFs de exemplo (item 1 do plano de 2026-09-11) — a tela de
 * Consulta ISP sugere um clique por história. A rota é gated pelos MESMOS
 * dois sinais que `FaixaDemonstracao` exige para mostrar o aviso de
 * demonstração: `emModoDemo()` E o subdomínio do PRÓPRIO provedor da sessão
 * começando por `sandbox-`.
 *
 * `requireAuth`/`requireProvider` são os REAIS deste arquivo (não mockados —
 * ver o cabeçalho do arquivo): a sessão de cada teste precisa provar host
 * (`hostLogin`) e ter um provedor "ativo" (`storage.getProvider` mockado
 * acima com `status: "active"`, o que `requireProvider` exige via
 * `provedorSuspenso`).
 */
describe("GET /api/demo/exemplos-cpf", () => {
  const EXEMPLOS_DE_TESTE = [
    { situacao: "limpo" as const, cpf: "99900000019", rotulo: "CPF limpo", descricao: "..." },
    { situacao: "devendo_na_rede" as const, cpf: "99911111150", rotulo: "Devendo na rede", descricao: "..." },
    { situacao: "migrador_serial" as const, cpf: "99922222291", rotulo: "Migrador serial", descricao: "..." },
  ];

  function sessaoDeSandboxLogado() {
    sessao = {
      save: (cb: (e?: unknown) => void) => cb(),
      userId: 7, providerId: 42, role: "admin",
      hostLogin: HOST_DA_DEMO, subdomain: "sandbox-abc123",
    };
  }

  const pedirExemplos = () => fetch(`${base}/api/demo/exemplos-cpf`, { headers: {} });

  it("fora de DEMO_MODE, 404 mesmo com sessao de sandbox valida", async () => {
    delete process.env.DEMO_MODE;
    sessaoDeSandboxLogado();

    const res = await pedirExemplos();

    expect(res.status).toBe(404);
    expect(exemplosMock.cpfsDeExemplo).not.toHaveBeenCalled();
  });

  it("sem sessao (nunca passou por /demo), 401 — a rota exige login, como o resto do painel", async () => {
    sessao = { save: (cb: (e?: unknown) => void) => cb() };

    const res = await pedirExemplos();

    expect(res.status).toBe(401);
    expect(exemplosMock.cpfsDeExemplo).not.toHaveBeenCalled();
  });

  it("provedor de verdade (subdominio fora do prefixo sandbox-) recebe 404, nao um array vazio", async () => {
    sessao = {
      save: (cb: (e?: unknown) => void) => cb(),
      userId: 7, providerId: 99, role: "admin",
      hostLogin: HOST_DA_DEMO, subdomain: "nslink",
    };
    storageMock.getProvider.mockResolvedValueOnce({ id: 99, subdomain: "nslink", status: "active" });

    const res = await pedirExemplos();

    expect(res.status).toBe(404);
    expect(exemplosMock.cpfsDeExemplo).not.toHaveBeenCalled();
  });

  it("sandbox autenticado recebe os tres exemplos da PROPRIA carteira", async () => {
    sessaoDeSandboxLogado();
    exemplosMock.cpfsDeExemplo.mockResolvedValueOnce(EXEMPLOS_DE_TESTE);

    const res = await pedirExemplos();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exemplos: EXEMPLOS_DE_TESTE });
    // O PROPRIO providerId da sessao, nunca um id que o visitante possa pedir.
    expect(exemplosMock.cpfsDeExemplo).toHaveBeenCalledWith(42);
  });

  it("carteira sem os candidatos esperados (cpfsDeExemplo lanca) vira 500 com mensagem segura, nunca uma tela quebrada", async () => {
    sessaoDeSandboxLogado();
    exemplosMock.cpfsDeExemplo.mockRejectedValueOnce(new Error("cpfsDeExemplo: sandbox 42 sem a carteira esperada"));

    const res = await pedirExemplos();

    expect(res.status).toBe(500);
  });
});
