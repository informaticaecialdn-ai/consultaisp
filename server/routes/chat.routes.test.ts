import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: `POST /api/public/visitor-chat/messages` — revisão final de segurança
 * antes da demonstração pública (item 5).
 *
 * A rota é pública (sem `requireAuth`), a linha que ela grava
 * (`visitorChatMessages`) não tem `provider_id` e nenhuma varredura de
 * limpeza a alcança. Sem limite de taxa nem de tamanho, qualquer IP grava
 * mensagens sem parar contra um corpo com até 10 MB (teto global do parser
 * JSON, `server/index.ts`). O que se prova aqui é só essas duas guardas.
 *
 * `generateChatResponse` (a resposta automática por IA) é mockada para
 * REJEITAR, de propósito: a rota dispara essa resposta em `fire-and-forget`
 * — sem `await` — e ela grava uma SEGUNDA mensagem
 * (`storage.createVisitorChatMessage` de novo, com `isFromAdmin: true`)
 * quando termina. Deixá-la resolver tornaria as asserções sobre "quantas
 * vezes o storage foi chamado" uma corrida contra microtasks, porque o `catch`
 * do handler não segura essa promise. Rejeitando, o bloco cai no `catch`
 * interno da rota (`console.warn`) e nunca chama o storage de novo — o que
 * sobra é determinístico e é exatamente o que esta bateria de testes verifica.
 *
 * Servidor NOVO a cada teste, de propósito (mesmo motivo de
 * `demo.routes.test.ts`): o limite de taxa vive num Map fechado dentro de
 * `createRateLimiter`, criado quando `registerChatRoutes()` roda — um
 * servidor compartilhado entre testes faria os pedidos de um teste contarem
 * para o balde do próximo.
 */
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "segredo-de-teste-sem-nenhum-valor-real";
});
vi.mock("../db", () => ({
  pool: { query: async () => ({ rows: [] }), on: () => undefined, connect: async () => ({ release: () => undefined }) },
  db: {},
}));

const storageMock = vi.hoisted(() => ({
  getVisitorChatByToken: vi.fn(async (): Promise<any> => ({ id: 1, status: "open", visitorName: "Visitante" })),
  createVisitorChatMessage: vi.fn(async (chatId: number, content: string, isFromAdmin: boolean, senderName: string): Promise<any> =>
    ({ id: 99, chatId, content, isFromAdmin, senderName })),
  getVisitorChatMessages: vi.fn(async (): Promise<any[]> => []),
  createVisitorChat: vi.fn(async (name: string, email: string, phone: string | null): Promise<any> =>
    ({ id: 2, token: `tok-${name}`, visitorName: name, visitorEmail: email, visitorPhone: phone })),
  getUser: vi.fn(async (userId: number): Promise<any> => ({ id: userId, name: "Usuario Teste" })),
  createSupportMessage: vi.fn(async (data: any): Promise<any> => ({ id: 100, ...data })),
  getOrCreateSupportThread: vi.fn(async (providerId: number): Promise<any> => ({ id: 5, providerId })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

const chatAgentMock = vi.hoisted(() => ({
  generateChatResponse: vi.fn(async () => { throw new Error("nao usado neste teste"); }),
}));
vi.mock("../services/chat-agent", () => chatAgentMock);

/**
 * `../auth` mockado so por causa das rotas de ADMIN testadas mais abaixo
 * (`/api/admin/visitor-chats/:id/messages`). As rotas publicas
 * (`/api/public/visitor-chat/*`, o grosso deste arquivo) nao passam por
 * nenhum destes middlewares. Mesmo padrao de `admin.routes.test.ts`: o que se
 * prova aqui e a rota em si, nao a regra de acesso do superadmin (que tem
 * teste proprio em `auth.test.ts`).
 */
vi.mock("../auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireProvider: (_req: any, _res: any, next: any) => next(),
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Acesso restrito" });
    next();
  },
}));

import { registerChatRoutes } from "./chat.routes";

let server: Server;
let base: string;

/**
 * Sessao e usuario da requisicao — mutaveis de proposito (mesmo padrao de
 * `admin.routes.test.ts`): o middleware abaixo le estas variaveis a CADA
 * requisicao, entao um teste que precisa de superadmin so muda o valor antes
 * de disparar o `fetch`. Reiniciadas no `beforeEach` para que as rotas
 * publicas (a maioria dos testes deste arquivo) nunca herdem sessao de teste
 * nenhum.
 */
let sessaoAtual: Record<string, any> = {};
let usuarioAtual: any = undefined;

async function subirServidor(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessaoAtual;
    (req as any).user = usuarioAtual;
    next();
  });
  app.use(registerChatRoutes());
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
}

beforeEach(async () => {
  vi.clearAllMocks();
  sessaoAtual = {};
  usuarioAtual = undefined;
  storageMock.getVisitorChatByToken.mockResolvedValue({ id: 1, status: "open", visitorName: "Visitante" });
  storageMock.createVisitorChatMessage.mockImplementation(async (chatId: number, content: string, isFromAdmin: boolean, senderName: string) =>
    ({ id: 99, chatId, content, isFromAdmin, senderName }));
  storageMock.createVisitorChat.mockImplementation(async (name: string, email: string, phone: string | null) =>
    ({ id: 2, token: `tok-${name}`, visitorName: name, visitorEmail: email, visitorPhone: phone }));
  await subirServidor();
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const enviar = (content: unknown, token = "tok-123") =>
  fetch(`${base}/api/public/visitor-chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-visitor-token": token },
    body: JSON.stringify({ content }),
  });

describe("POST /api/public/visitor-chat/messages — teto de tamanho", () => {
  it("recusa mensagem acima de 4.000 caracteres, sem gravar nada", async () => {
    const res = await enviar("x".repeat(4_001));

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/longa/i);
    expect(storageMock.createVisitorChatMessage).not.toHaveBeenCalled();
  });

  it("aceita exatamente 4.000 caracteres", async () => {
    const res = await enviar("x".repeat(4_000));

    expect(res.status).toBe(201);
    expect(storageMock.createVisitorChatMessage).toHaveBeenCalledTimes(1);
  });

  it("mensagem comum continua funcionando normalmente", async () => {
    const res = await enviar("Ola, quero saber mais sobre o produto");

    expect(res.status).toBe(201);
    expect(storageMock.createVisitorChatMessage).toHaveBeenCalledWith(1, "Ola, quero saber mais sobre o produto", false, "Visitante");
  });
});

/**
 * Revisao seguinte (item 1): `content?.trim()` so protege contra `content`
 * `null`/`undefined` — o `?.` guarda o ACESSO a propriedade, nao o METODO que
 * ela devolve. Um objeto, array, numero ou booleano nao tem `.trim()`, entao
 * `content?.trim` resolve para `undefined` e `undefined()` lanca
 * `TypeError`, que o `catch` da rota devolve como 500 generico — servidor
 * quebrado para o que e, na verdade, um pedido mal formado (o mesmo formato
 * que a rodada anterior ja corrigiu em `/api/public/visitor-chat/start`).
 */
describe("POST /api/public/visitor-chat/messages — tipo do campo content", () => {
  it("recusa content que nao e string, com 400 — nunca 500 (nao lanca excecao)", async () => {
    for (const valorInvalido of [{ pad: "x" }, [1, 2, 3], 12345, true]) {
      const res = await enviar(valorInvalido);
      expect(res.status).toBe(400);
    }
    expect(storageMock.createVisitorChatMessage).not.toHaveBeenCalled();
  });
});

describe("POST /api/public/visitor-chat/messages — limite de taxa", () => {
  it("acima de 20 pedidos na mesma janela, o servidor recusa com 429", async () => {
    const status: number[] = [];
    // 21 chamadas do MESMO IP (todas batem em 127.0.0.1 — o teste roda contra
    // um servidor local de verdade, entao o proprio `req.ip` e quem chaveia).
    for (let i = 0; i < 21; i++) {
      status.push((await enviar(`mensagem ${i}`)).status);
    }

    expect(status.filter(s => s === 201).length).toBe(20);
    expect(status[20]).toBe(429);
  });
});

const iniciar = (overrides: Record<string, unknown> = {}) =>
  fetch(`${base}/api/public/visitor-chat/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Visitante", email: "visitante@example.com", ...overrides }),
  });

/**
 * `POST /api/public/visitor-chat/start` — revisão final de segurança antes
 * da demonstração pública (item 5): a rota mintava token sem limite nenhum,
 * e cada token emitido dá direito a 20 mensagens por minuto com resposta
 * automática via IA (OpenAI) na rota `/messages` acima — sem freio aqui, um
 * IP mintava tokens sem parar e cada um abria sua própria cota de custo.
 */
describe("POST /api/public/visitor-chat/start — limite de taxa", () => {
  it("acima de 20 pedidos na mesma janela, o servidor recusa com 429", async () => {
    const status: number[] = [];
    for (let i = 0; i < 21; i++) {
      status.push((await iniciar()).status);
    }

    expect(status.filter(s => s === 201).length).toBe(20);
    expect(status[20]).toBe(429);
  });

  // A prova de que é o MESMO limitador, não um equivalente: as duas rotas
  // dividem o balde. Sem isso, `/start` teria seus próprios 20 e `/messages`
  // outros 20 — 40 no total pela mesma origem, o dobro da cota pretendida.
  it("compartilha o balde com /messages — a mesma origem gasta a MESMA cota nas duas rotas", async () => {
    for (let i = 0; i < 15; i++) await iniciar();

    const status: number[] = [];
    for (let i = 0; i < 10; i++) status.push((await enviar(`mensagem ${i}`)).status);

    // So sobram 5 no balde compartilhado (20 - 15) antes de recusar.
    expect(status.filter(s => s === 201).length).toBe(5);
    expect(status.slice(5).every(s => s === 429)).toBe(true);
  });

  it("mensagem comum continua funcionando normalmente", async () => {
    const res = await iniciar();

    expect(res.status).toBe(201);
    const corpo = await res.json();
    expect(corpo.token).toBe("tok-Visitante");
    expect(storageMock.createVisitorChat).toHaveBeenCalledWith("Visitante", "visitante@example.com", null);
  });

  it("recusa sem nome ou sem email, sem gravar nada", async () => {
    const res = await iniciar({ name: "" });

    expect(res.status).toBe(400);
    expect(storageMock.createVisitorChat).not.toHaveBeenCalled();
  });
});

/**
 * `POST /api/public/visitor-chat/start` — item 7 (menor) da rodada seguinte:
 * `name`/`email`/`phone` nao tinham NENHUM teto de tamanho, so a checagem de
 * presenca — string arbitraria ate os 10 MB do parser JSON global, gravada
 * numa tabela sem varredura de limpeza. Mesmo estilo do teto de `/messages`
 * acima: so tamanho, sem mexer na validacao de formato (que continua so
 * checando presenca).
 */
describe("POST /api/public/visitor-chat/start — teto de tamanho", () => {
  it("recusa nome acima do teto, sem gravar nada", async () => {
    const res = await iniciar({ name: "x".repeat(201) });

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/nome.*longo/i);
    expect(storageMock.createVisitorChat).not.toHaveBeenCalled();
  });

  it("aceita nome com exatamente 200 caracteres", async () => {
    const res = await iniciar({ name: "x".repeat(200) });

    expect(res.status).toBe(201);
  });

  it("recusa email acima do teto, sem gravar nada", async () => {
    const res = await iniciar({ email: `${"x".repeat(250)}@example.com` });

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/email.*longo/i);
    expect(storageMock.createVisitorChat).not.toHaveBeenCalled();
  });

  it("recusa telefone acima do teto, sem gravar nada", async () => {
    const res = await iniciar({ phone: "1".repeat(41) });

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/telefone.*longo/i);
    expect(storageMock.createVisitorChat).not.toHaveBeenCalled();
  });

  it("aceita telefone com exatamente 40 caracteres", async () => {
    const res = await iniciar({ phone: "1".repeat(40) });

    expect(res.status).toBe(201);
  });

  it("sem telefone (campo ausente), continua funcionando normalmente", async () => {
    const res = await iniciar();

    expect(res.status).toBe(201);
    expect(storageMock.createVisitorChat).toHaveBeenCalledWith("Visitante", "visitante@example.com", null);
  });
});

/**
 * `POST /api/public/visitor-chat/start` — revisão de segurança 4 (item 4 do
 * pedido): só `phone` checava `typeof` antes desta rodada. `{"name": 12345}`
 * passa por `!name` (número é truthy) e `(12345).length` é `undefined` —
 * `undefined > 200` é `false`, então o teto de tamanho nunca disparava e o
 * valor cru chegava em `storage.createVisitorChat`. Mesma guarda agora nos
 * três campos.
 */
describe("POST /api/public/visitor-chat/start — tipo dos campos", () => {
  it("recusa nome que nao e string, sem gravar nada", async () => {
    const res = await iniciar({ name: 12345 });

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/obrigatorios/i);
    expect(storageMock.createVisitorChat).not.toHaveBeenCalled();
  });

  it("recusa email que nao e string, sem gravar nada", async () => {
    const res = await iniciar({ email: 12345 });

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/obrigatorios/i);
    expect(storageMock.createVisitorChat).not.toHaveBeenCalled();
  });

  it("recusa nome como objeto (teria .length undefined, passando pelo teto em silencio)", async () => {
    const res = await iniciar({ name: { qualquer: "coisa" } });

    expect(res.status).toBe(400);
    expect(storageMock.createVisitorChat).not.toHaveBeenCalled();
  });

  /**
   * `phone` ficou de fora da correcao acima: a guarda dele era um E
   * (`typeof phone === "string" && phone.length > ...`), entao um `phone` que
   * nao e string faz a condicao inteira dar falso e pula o teto por inteiro —
   * ao contrario de `name`/`email`, que recusam tipo errado ANTES de medir.
   * Um objeto sobrevive ate `storage.createVisitorChat` cru.
   */
  it("recusa telefone como objeto, sem gravar nada (phone e opcional, mas nao qualquer tipo)", async () => {
    const res = await iniciar({ phone: { pad: "x".repeat(5000) } });

    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/telefone/i);
    expect(storageMock.createVisitorChat).not.toHaveBeenCalled();
  });

  it("telefone ausente continua valido (opcional, diferente de nome/email)", async () => {
    const res = await iniciar();

    expect(res.status).toBe(201);
    expect(storageMock.createVisitorChat).toHaveBeenCalledWith("Visitante", "visitante@example.com", null);
  });

  /**
   * "Ausente" (a chave nem existe no corpo) e "explicitamente null" tomam o
   * MESMO caminho no codigo (`phone != null` cobre os dois), mas so o
   * primeiro tinha teste. Fecha o buraco: o valor tem de continuar valido, e
   * `storage.createVisitorChat` tem de receber `null` (nunca a string
   * "null" nem o `undefined` cru).
   */
  it("telefone explicitamente null continua valido (nao e o mesmo caso do campo ausente)", async () => {
    const res = await iniciar({ phone: null });

    expect(res.status).toBe(201);
    expect(storageMock.createVisitorChat).toHaveBeenCalledWith("Visitante", "visitante@example.com", null);
  });
});

const enviarComoAdmin = (content: unknown, chatId = 1) =>
  fetch(`${base}/api/admin/visitor-chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

/**
 * `POST /api/admin/visitor-chats/:id/messages` — o mesmo `content?.trim()`
 * sem `typeof` do `/api/public/visitor-chat/messages` acima (item 1 da
 * rodada seguinte), so que do lado do atendente. `sessaoAtual`/`usuarioAtual`
 * dao o superadmin e o `req.user` que a rota le para `senderName`.
 */
describe("POST /api/admin/visitor-chats/:id/messages — tipo do campo content", () => {
  beforeEach(() => {
    sessaoAtual = { role: "superadmin" };
    usuarioAtual = { name: "Atendente Teste" };
  });

  it("recusa content que nao e string, com 400 — nunca 500 (nao lanca excecao)", async () => {
    for (const valorInvalido of [{ pad: "x" }, [1, 2, 3], 12345, true]) {
      const res = await enviarComoAdmin(valorInvalido);
      expect(res.status).toBe(400);
    }
    expect(storageMock.createVisitorChatMessage).not.toHaveBeenCalled();
  });

  it("mensagem valida continua funcionando normalmente", async () => {
    const res = await enviarComoAdmin("Ola, em que posso ajudar?");

    expect(res.status).toBe(201);
    expect(storageMock.createVisitorChatMessage).toHaveBeenCalledWith(1, "Ola, em que posso ajudar?", true, "Atendente Teste");
  });
});

const enviarParaThreadAdmin = (content: unknown, threadId = 1) =>
  fetch(`${base}/api/admin/chat/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

/**
 * `POST /api/admin/chat/threads/:id/messages` — o mesmo `content?.trim()` sem
 * `typeof` do `/api/admin/visitor-chats/:id/messages` acima (mesmo item 1), so
 * que no chat de suporte provedor <-> admin.
 */
describe("POST /api/admin/chat/threads/:id/messages — tipo do campo content", () => {
  beforeEach(() => {
    sessaoAtual = { role: "superadmin", userId: 1 };
  });

  it("recusa content que nao e string, com 400 — nunca 500 (nao lanca excecao)", async () => {
    for (const valorInvalido of [{ pad: "x" }, [1, 2, 3], 12345, true]) {
      const res = await enviarParaThreadAdmin(valorInvalido);
      expect(res.status).toBe(400);
    }
    expect(storageMock.createSupportMessage).not.toHaveBeenCalled();
  });
});

const enviarParaThreadProvedor = (content: unknown) =>
  fetch(`${base}/api/chat/thread/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

/**
 * `POST /api/chat/thread/messages` — o mesmo `content?.trim()` sem `typeof` de
 * cima, do lado do provedor (mesmo item 1).
 */
describe("POST /api/chat/thread/messages — tipo do campo content", () => {
  beforeEach(() => {
    sessaoAtual = { userId: 1, providerId: 1 };
  });

  it("recusa content que nao e string, com 400 — nunca 500 (nao lanca excecao)", async () => {
    for (const valorInvalido of [{ pad: "x" }, [1, 2, 3], 12345, true]) {
      const res = await enviarParaThreadProvedor(valorInvalido);
      expect(res.status).toBe(400);
    }
    expect(storageMock.createSupportMessage).not.toHaveBeenCalled();
  });
});
