/**
 * Primeiro teste das rotas de marca. Ele nasce de um defeito real.
 *
 * A tela do superadmin monta o formulario a partir da LISTA de marcas, que nao
 * carrega logo, favicon nem WhatsApp — a listagem os corta para nao trafegar
 * tres SVGs por linha. Como o formulario era enviado inteiro, esses campos iam
 * como nulo: abrir a edicao de uma marca para corrigir um telefone APAGAVA o
 * logo do revendedor. O conserto e no cliente (envia so o que mudou), e a
 * garantia do lado do servidor e esta: PATCH parcial nao encosta em campo que
 * nao veio.
 *
 * Alem disso, duas coisas que o arquivo de rotas trata como seguranca e que
 * ninguem cobria: a validacao dos arquivos enviados (um "PNG" que nao e PNG, um
 * "SVG" que e HTML, arquivo grande demais) e o fato de a area inteira ser so do
 * superadmin.
 *
 * E o outro lado da mesma moeda do PATCH parcial: corpo que fica VAZIO depois do
 * zod (so campo desconhecido, ou nada) nao pode virar 500 — um UPDATE sem coluna
 * nenhuma estoura dentro do Drizzle, e a falha e do pedido, nao do servidor.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

// O modulo de auth avalia SESSION_SECRET no import; sobe antes de tudo.
vi.hoisted(() => {
  process.env.SESSION_SECRET = "segredo-de-teste";
});

const storageMock = vi.hoisted(() => ({
  getAllMarcas: vi.fn(async (): Promise<any[]> => []),
  getMarca: vi.fn(async (_id: number): Promise<any> => undefined),
  getMarcaPorSlug: vi.fn(async (_s: string): Promise<any> => undefined),
  getMarcaPorDominio: vi.fn(async (_h: string): Promise<any> => undefined),
  getMarcaPorSubdominio: vi.fn(async (_s: string): Promise<any> => undefined),
  createMarca: vi.fn(async (dados: any) => ({ id: 1, ...dados })),
  updateMarca: vi.fn(async (id: number, dados: any) => ({ id, ...dados })),
  deleteMarca: vi.fn(async (_id: number) => undefined),
  marcarDominioAtivo: vi.fn(async (id: number) => ({ id, dominioStatus: "ativo" })),
  getProvidersPorMarca: vi.fn(async (_id: number): Promise<any[]> => []),
  getProvidersSemMarca: vi.fn(async (): Promise<any[]> => []),
  getProvider: vi.fn(async (_id: number): Promise<any> => undefined),
  setMarcaDoProvider: vi.fn(async () => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

// Dependencias que server/auth.ts abre no import — o middleware real e o que
// interessa aqui, entao so o entorno dele e substituido.
vi.mock("express-session", () => ({ default: () => (_r: any, _s: any, n: any) => n() }));
vi.mock("connect-pg-simple", () => ({ default: () => class { } }));
vi.mock("../db", () => ({ pool: {}, db: {} }));
vi.mock("../logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { registerMarcaRoutes } from "./marca.routes";

let server: Server;
let base: string;
let sessao: Record<string, unknown> = {};

const SUPERADMIN = { userId: 1, providerId: 0, role: "superadmin" };
const ADMIN_DE_PROVEDOR = { userId: 2, providerId: 5, role: "admin" };

/** Uma marca como o banco devolve, com logo e favicon ja gravados. */
const CREDNET = {
  id: 7, slug: "crednet", ativo: true, nomeProduto: "CredNet", assinatura: null,
  dominio: "app.crednet.com.br", dominioStatus: "ativo",
  logoSvg: "<svg xmlns='http://www.w3.org/2000/svg'></svg>", logoPng: null,
  faviconSvg: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
  corBrand: "#1F6F7A", corBrandDark: null,
  emailRemetente: null, emailNomeExibicao: "CredNet",
  suporteEmail: "suporte@crednet.com.br", suporteWhatsapp: "5531999998888", site: null,
  responsavelRazaoSocial: "CredNet Ltda", responsavelCnpj: "00.000.000/0001-00",
  createdAt: new Date(),
};

const SVG_VALIDO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;
/** 1x1 transparente. Os quatro primeiros bytes sao a assinatura 89 50 4E 47. */
const PNG_VALIDO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function patch(id: number, corpo: unknown) {
  return fetch(`${base}/api/admin/marcas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerMarcaRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getMarca.mockResolvedValue(CREDNET);
  storageMock.getMarcaPorSlug.mockResolvedValue(undefined);
  storageMock.getMarcaPorDominio.mockResolvedValue(undefined);
  // O mock imita o Drizzle no ponto que importa: `set({})` nao e UPDATE nenhum,
  // e mapUpdateSet lanca "No values to set". Sem isto, um corpo que chega vazio
  // ao storage passaria despercebido no teste e viraria 500 so em producao.
  storageMock.updateMarca.mockImplementation(async (id: number, dados: any) => {
    if (Object.keys(dados).length === 0) throw new Error("No values to set");
    return { id, ...dados };
  });
  sessao = { ...SUPERADMIN };
});

describe("PATCH /api/admin/marcas/:id — parcial de verdade", () => {
  it("campo ausente no corpo nao chega ao storage: o logo sobrevive a edicao do telefone", async () => {
    const res = await patch(7, { suporteWhatsapp: "5531988887777" });
    expect(res.status).toBe(200);

    const [, gravado] = storageMock.updateMarca.mock.calls[0];
    expect(gravado).toEqual({ suporteWhatsapp: "5531988887777" });
    // O defeito que motivou o arquivo: estas tres chaves nao podem aparecer.
    expect(gravado).not.toHaveProperty("logoSvg");
    expect(gravado).not.toHaveProperty("logoPng");
    expect(gravado).not.toHaveProperty("faviconSvg");
  });

  it("nulo EXPLICITO continua limpando o campo — apagar o logo tem de ser possivel", async () => {
    const res = await patch(7, { logoSvg: null, logoPng: null });
    expect(res.status).toBe(200);
    const [, gravado] = storageMock.updateMarca.mock.calls[0];
    expect(gravado).toEqual({ logoSvg: null, logoPng: null });
  });

  it("campo fora do esquema e descartado, nao gravado", async () => {
    // dominioStatus e do operador, nao do formulario: quem confirma HTTPS e a
    // rota /dominio-ativo, depois de alguem ter rodado o script.
    const res = await patch(7, { dominioStatus: "ativo", ativo: false });
    expect(res.status).toBe(200);
    const [, gravado] = storageMock.updateMarca.mock.calls[0];
    expect(gravado).toEqual({ ativo: false });
    expect(gravado).not.toHaveProperty("dominioStatus");
  });

  it("corpo so com campo desconhecido nao vira 500: o zod esvazia, e vazio e 400", async () => {
    // dominioStatus sozinho e o caso real — o operador tenta confirmar o HTTPS
    // pela rota errada. Depois do zod o corpo fica {}, e um UPDATE sem coluna
    // nenhuma explode dentro do Drizzle. Erro do pedido, nao do servidor.
    const res = await patch(7, { dominioStatus: "ativo" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/Nada a alterar/i);
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("corpo vazio tambem responde 400, e nao chega ao banco", async () => {
    const res = await patch(7, {});
    expect(res.status).toBe(400);
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("trocar o dominio devolve o status para pendente — o certificado antigo nao vale", async () => {
    const res = await patch(7, { dominio: "https://Portal.CredNet.com.BR/" });
    expect(res.status).toBe(200);
    const [, gravado] = storageMock.updateMarca.mock.calls[0];
    expect(gravado.dominio).toBe("portal.crednet.com.br");
    expect(gravado.dominioStatus).toBe("pendente");
  });

  it("marca inexistente responde 404 e nao grava", async () => {
    storageMock.getMarca.mockResolvedValue(undefined);
    const res = await patch(404, { nomeProduto: "X" });
    expect(res.status).toBe(404);
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });
});

describe("arquivos da marca", () => {
  it("aceita SVG e PNG de verdade", async () => {
    expect((await patch(7, { logoSvg: SVG_VALIDO })).status).toBe(200);
    expect((await patch(7, { faviconSvg: SVG_VALIDO })).status).toBe(200);
    expect((await patch(7, { logoPng: PNG_VALIDO })).status).toBe(200);
    expect(storageMock.updateMarca).toHaveBeenCalledTimes(3);
  });

  it("grava o PNG na MESMA forma que validou", async () => {
    // Espaco na frente passava na checagem e sumia depois na hora de servir: o
    // logo saia como bytes que nao sao PNG.
    await patch(7, { logoPng: `  ${PNG_VALIDO}  ` });
    const [, gravado] = storageMock.updateMarca.mock.calls[0];
    expect(gravado.logoPng).toBe(PNG_VALIDO);
  });

  it("recusa SVG acima de 256 KB", async () => {
    const gigante = `<svg xmlns="http://www.w3.org/2000/svg">${"a".repeat(300 * 1024)}</svg>`;
    const res = await patch(7, { logoSvg: gigante });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/256 KB/);
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("recusa PNG acima de 512 KB", async () => {
    const res = await patch(7, { logoPng: `data:image/png;base64,${"A".repeat(600 * 1024)}` });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/512 KB/);
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("recusa HTML disfarcado de SVG, e o favicon diz que e o favicon", async () => {
    const html = "<html><script>alert(1)</script></html>";
    expect((await patch(7, { logoSvg: html })).status).toBe(400);

    const res = await patch(7, { faviconSvg: html });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/^Favicon:/);
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("recusa arquivo que se diz PNG mas nao tem a assinatura do formato", async () => {
    const falso = `data:image/png;base64,${Buffer.from("nao sou um png").toString("base64")}`;
    const res = await patch(7, { logoPng: falso });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/nao e um PNG/);
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("recusa subdominio da plataforma como dominio proprio da marca", async () => {
    // As duas regras brigariam: ali quem manda e o subdominio do provedor.
    const res = await patch(7, { dominio: "crednet.consultaisp.com.br" });
    expect(res.status).toBe(400);
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });
});

/**
 * A area de marcas e do superadmin inteira. Um admin de provedor que a
 * alcancasse editaria a pele de outra empresa — inclusive a propria marca do
 * revendedor concorrente.
 */
describe("so o superadmin entra", () => {
  const rotas: Array<[string, string]> = [
    ["GET", "/api/admin/marcas"],
    ["GET", "/api/admin/marcas/7"],
    ["POST", "/api/admin/marcas"],
    ["PATCH", "/api/admin/marcas/7"],
    ["DELETE", "/api/admin/marcas/7"],
    ["POST", "/api/admin/marcas/7/dominio-ativo"],
    ["GET", "/api/admin/provedores-sem-marca"],
    ["POST", "/api/admin/marcas/vincular"],
  ];

  it("sem sessao nenhuma rota responde, e o storage nem e consultado", async () => {
    sessao = {};
    for (const [metodo, rota] of rotas) {
      const res = await fetch(`${base}${rota}`, {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: metodo === "GET" ? undefined : "{}",
      });
      expect([401, 403], `${metodo} ${rota}`).toContain(res.status);
    }
    expect(storageMock.getMarca).not.toHaveBeenCalled();
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
    expect(storageMock.deleteMarca).not.toHaveBeenCalled();
  });

  it("admin de provedor recebe 403 e nao grava nada", async () => {
    sessao = { ...ADMIN_DE_PROVEDOR };
    for (const [metodo, rota] of rotas) {
      const res = await fetch(`${base}${rota}`, {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: metodo === "GET" ? undefined : "{}",
      });
      expect(res.status, `${metodo} ${rota}`).toBe(403);
    }
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
    expect(storageMock.createMarca).not.toHaveBeenCalled();
    expect(storageMock.deleteMarca).not.toHaveBeenCalled();
    expect(storageMock.setMarcaDoProvider).not.toHaveBeenCalled();
  });

  it("o logo e o favicon, ao contrario, sao PUBLICOS — a tela de login mostra a marca antes de existir sessao", async () => {
    sessao = {};
    const logo = await fetch(`${base}/api/marca/7/logo`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toContain("image/svg+xml");
    // Aberto direto, o SVG seria documento de novo; estes dois cabecalhos o
    // deixam inerte. Ver a nota no topo de marca.routes.ts.
    expect(logo.headers.get("x-content-type-options")).toBe("nosniff");
    expect(logo.headers.get("content-security-policy")).toContain("default-src 'none'");

    expect((await fetch(`${base}/api/marca/7/favicon`)).status).toBe(200);
  });

  it("marca desativada some tambem dos arquivos publicos", async () => {
    sessao = {};
    storageMock.getMarca.mockResolvedValue({ ...CREDNET, ativo: false });
    expect((await fetch(`${base}/api/marca/7/logo`)).status).toBe(404);
    expect((await fetch(`${base}/api/marca/7/favicon`)).status).toBe(404);
  });
});
