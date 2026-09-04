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
  getUser: vi.fn(async (_id: number): Promise<any> => undefined),
  getUserByEmail: vi.fn(async (_e: string): Promise<any> => undefined),
  createUser: vi.fn(async (dados: any) => ({ id: 90, createdAt: new Date(), ...dados })),
  deleteUser: vi.fn(async (_id: number) => undefined),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

/**
 * As tres consultas que a rota importa DIRETO de marcas.storage (elas nao
 * passam pelo barril — ver a nota no proprio arquivo). Os CODIGOS vem do modulo
 * de verdade, e nao copiados para ca: um teste que redefinisse a string
 * continuaria verde depois de a rota e o storage passarem a falar codigos
 * diferentes, que e exatamente o defeito que ele deveria pegar.
 */
const marcasStorageMock = vi.hoisted(() => ({
  getUsuariosDaMarca: vi.fn(async (_id: number): Promise<any[]> => []),
  contarRevendedoresDaMarca: vi.fn(async (_id: number, _exceto?: number) => 1),
}));
vi.mock("../storage/marcas.storage", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...marcasStorageMock,
}));

/** Scrypt de verdade leva ~100ms por chamada e nao e o que estes testes medem. */
vi.mock("../password", () => ({
  hashPassword: vi.fn(async (senha: string) => `hash-de:${senha}`),
}));

/**
 * O e-mail de boas-vindas do revendedor.
 *
 * Mockado para que o teste possa afirmar QUE ele sai e COM O QUE — e para que
 * a falha de envio seja encenavel: a rota promete que ela nao derruba a
 * criacao, e essa promessa so vale se alguem a exercitar.
 */
const emailMock = vi.hoisted(() => ({
  sendBoasVindasRevendedorEmail: vi.fn(async (_to: string, _d: any, _m: number) => undefined),
}));
vi.mock("../services/email", () => emailMock);

const eventosMock = vi.hoisted(() => ({
  registrarEventoDaMarca: vi.fn(async (_e: any) => undefined),
  listarEventosDaMarca: vi.fn(async (_id: number, _l?: number): Promise<any[]> => []),
}));
vi.mock("../services/marca-eventos.service", () => eventosMock);

// Dependencias que server/auth.ts abre no import — o middleware real e o que
// interessa aqui, entao so o entorno dele e substituido.
vi.mock("express-session", () => ({ default: () => (_r: any, _s: any, n: any) => n() }));
vi.mock("connect-pg-simple", () => ({ default: () => class { } }));
vi.mock("../db", () => ({ pool: {}, db: {} }));
vi.mock("../logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { esquemaMarcaDoRevendedor, esquemaMarcaDoSuperadmin, registerMarcaRoutes } from "./marca.routes";
import { CODIGO_MARCA_COM_HISTORICO, CODIGO_MARCA_COM_REVENDA, MarcaComVinculosError } from "../storage/marcas.storage";

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
  responsavelRazaoSocial: "CredNet Ltda", responsavelCnpj: "11.222.333/0001-81",
  // Camada comercial da migracao 0013. A marca do fixture ja passou o
  // onboarding inteiro (dominio com HTTPS + revenda ligada), que e o unico
  // estado em que criar acesso de revendedor e permitido.
  revendaAtiva: true, statusComercial: "ativo", comissaoPercentual: "20.00",
  repasseRazaoSocial: null, repasseCnpj: null, repasseChavePix: null, repasseEmail: null,
  cadastroAberto: false, landingAtiva: false, landing: {}, ogImagePng: null,
  createdAt: new Date(),
};

/** Digitos verificadores corretos — usado onde o CNPJ precisa passar. */
const CNPJ_VALIDO = "11.222.333/0001-81";

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
  storageMock.getUserByEmail.mockResolvedValue(undefined);
  storageMock.getUser.mockResolvedValue(undefined);
  storageMock.createUser.mockImplementation(async (dados: any) => ({ id: 90, createdAt: new Date(), ...dados }));
  storageMock.deleteUser.mockResolvedValue(undefined);
  marcasStorageMock.getUsuariosDaMarca.mockResolvedValue([]);
  marcasStorageMock.contarRevendedoresDaMarca.mockResolvedValue(1);
  eventosMock.listarEventosDaMarca.mockResolvedValue([]);
  emailMock.sendBoasVindasRevendedorEmail.mockResolvedValue(undefined);
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

  /**
   * MUDANCA DELIBERADA DE COMPORTAMENTO (fase 1 do white label).
   *
   * Ate aqui o esquema descartava chave desconhecida em silencio e respondia
   * 200. O mesmo esquema passa a ser a base da rota do REVENDEDOR
   * (`PATCH /api/revenda/marca`), e la o descarte silencioso e armadilha: ele
   * mandaria `{"comissaoPercentual": 50}`, receberia 200, leria o valor antigo
   * na tela e tentaria de novo. `.strict()` responde 400 dizendo o nome do
   * campo — e as duas asserções abaixo sao o que impede alguem de "consertar"
   * o 400 removendo o strict.
   */
  it("campo fora do esquema RECUSA, e a mensagem diz qual foi", async () => {
    // dominioStatus e do operador, nao do formulario: quem confirma HTTPS e a
    // rota /dominio-ativo, depois de alguem ter rodado o script.
    const res = await patch(7, { dominioStatus: "ativo", ativo: false });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/dominioStatus/);
    // E nao grava o resto do corpo: metade de um PATCH e pior que nenhum.
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("corpo so com campo desconhecido nao vira 500", async () => {
    // dominioStatus sozinho e o caso real — o operador tenta confirmar o HTTPS
    // pela rota errada. Erro do pedido, nao do servidor.
    const res = await patch(7, { dominioStatus: "ativo" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/nao edita/i);
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

  /**
   * APAGAR o dominio tambem devolve o status para pendente.
   *
   * Enquanto o reajuste vivia dentro do `if (dominio)`, limpar o campo deixava
   * `dominioStatus` em "ativo" apontando para nada — e era esse estado que
   * fazia `POST /usuarios` criar um acesso que nunca consegue entrar. O
   * certificado do dominio anterior deixa de valer nos dois casos.
   */
  it("apagar o dominio tambem devolve o status para pendente", async () => {
    const res = await patch(7, { dominio: null });
    expect(res.status).toBe(200);
    const [, gravado] = storageMock.updateMarca.mock.calls[0];
    expect(gravado.dominio).toBeNull();
    expect(gravado.dominioStatus).toBe("pendente");
  });

  /**
   * Reenviar o MESMO dominio nao mexe no status: quem confirma o HTTPS e
   * `POST /dominio-ativo`, e uma gravacao que so repetiu o valor de sempre nao
   * pode desfazer aquela confirmacao.
   */
  it("reenviar o mesmo dominio nao derruba o status ja confirmado", async () => {
    const res = await patch(7, { dominio: "app.crednet.com.br", nomeProduto: "CredNet" });
    expect(res.status).toBe(200);
    const [, gravado] = storageMock.updateMarca.mock.calls[0];
    expect(gravado).not.toHaveProperty("dominioStatus");
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
    ["GET", "/api/admin/marcas/7/usuarios"],
    ["POST", "/api/admin/marcas/7/usuarios"],
    ["DELETE", "/api/admin/marcas/7/usuarios/90"],
    ["GET", "/api/admin/marcas/7/eventos"],
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

/**
 * ── A DIVISAO DO ESQUEMA ────────────────────────────────────────────────────
 *
 * `esquemaMarcaDoRevendedor` vai ser importado pela rota `PATCH
 * /api/revenda/marca` (fase 2). O que estiver escrito nele o revendedor edita;
 * o que nao estiver, ele nao alcanca. Nao ha segunda lista em lugar nenhum, e e
 * por isso que ESTE arquivo e que testa o conteudo dela: quando alguem
 * acrescentar um campo comercial na metade errada, e aqui que a conta nao
 * fecha — nao numa rota que ainda nem existe.
 */
describe("esquemaMarca em duas metades", () => {
  const PROIBIDOS_AO_REVENDEDOR = [
    "comissaoPercentual", "revendaAtiva", "statusComercial",
    "repasseRazaoSocial", "repasseCnpj", "repasseChavePix", "repasseEmail",
    "slug", "dominio", "ativo", "emailRemetente",
    "responsavelRazaoSocial", "responsavelCnpj",
  ];

  it("a metade do revendedor nao tem nenhum campo comercial, de repasse ou de endereco", () => {
    const doRevendedor = Object.keys(esquemaMarcaDoRevendedor.shape);
    for (const campo of PROIBIDOS_AO_REVENDEDOR) {
      expect(doRevendedor, `${campo} nao pode estar na metade do revendedor`).not.toContain(campo);
    }
  });

  it("os campos proibidos existem — na metade do superadmin", () => {
    // Sem esta contraprova a primeira asserção passaria tambem se alguem
    // simplesmente apagasse os campos das duas metades.
    const doSuperadmin = Object.keys(esquemaMarcaDoSuperadmin.shape);
    for (const campo of PROIBIDOS_AO_REVENDEDOR) {
      expect(doSuperadmin, `${campo} sumiu do esquema`).toContain(campo);
    }
  });

  it("as duas metades sao disjuntas: nenhum campo aparece nas duas", () => {
    // Campo repetido significa duas verdades sobre quem pode escreve-lo, e o
    // merge esconderia a divergencia — vence a definicao da metade de baixo.
    const doRevendedor = new Set(Object.keys(esquemaMarcaDoRevendedor.shape));
    const repetidos = Object.keys(esquemaMarcaDoSuperadmin.shape).filter(c => doRevendedor.has(c));
    expect(repetidos).toEqual([]);
  });

  it("a metade do revendedor recusa campo que nao e dela, dizendo o nome", () => {
    const r = esquemaMarcaDoRevendedor.partial().safeParse({ comissaoPercentual: "50" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.errors[0].code).toBe("unrecognized_keys");
  });
});

describe("PATCH /api/admin/marcas/:id — a camada comercial", () => {
  it("grava percentual, status e repasse", async () => {
    const res = await patch(7, {
      comissaoPercentual: 17.5,
      statusComercial: "suspenso",
      revendaAtiva: true,
      repasseCnpj: CNPJ_VALIDO,
      repasseChavePix: "financeiro@crednet.com.br",
    });
    expect(res.status).toBe(200);
    const [, gravado] = storageMock.updateMarca.mock.calls[0];
    // Duas casas sempre: e o formato que numeric(5,2) guarda e que a tela le.
    expect(gravado.comissaoPercentual).toBe("17.50");
    expect(gravado.statusComercial).toBe("suspenso");
    expect(gravado.repasseCnpj).toBe(CNPJ_VALIDO);
  });

  it("aceita o percentual como texto com virgula — e como inteiro", async () => {
    expect((await patch(7, { comissaoPercentual: "17,5" })).status).toBe(200);
    expect(storageMock.updateMarca.mock.calls[0][1].comissaoPercentual).toBe("17.50");

    storageMock.updateMarca.mockClear();
    expect((await patch(7, { comissaoPercentual: 20 })).status).toBe(200);
    expect(storageMock.updateMarca.mock.calls[0][1].comissaoPercentual).toBe("20.00");
  });

  it("recusa percentual acima de 50 e abaixo de 0", async () => {
    // O teto e do dono (decisao 3) e tem CHECK no banco: acima dele a
    // plataforma fica com menos da metade e o piso de preco para de proteger.
    for (const valor of [50.01, 51, 100, -1]) {
      const res = await patch(7, { comissaoPercentual: valor });
      expect(res.status, `percentual ${valor}`).toBe(400);
    }
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("recusa a terceira casa decimal nos dois formatos, em vez de arredondar calado", async () => {
    // Os dois ramos da uniao tem de concordar sobre o mesmo valor: a regex ja
    // recusava "17,555", e o numero 17.555 virava 17,56 sem uma palavra.
    for (const valor of [17.555, "17,555"]) {
      const res = await patch(7, { comissaoPercentual: valor });
      expect(res.status, String(valor)).toBe(400);
    }
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("duas casas continuam passando — o teste acima nao pode recusar 17,55", async () => {
    // `v * 100 === Math.round(v * 100)` seria o teste obvio da regra acima e
    // recusaria este valor: 17.55 * 100 da 1754.9999999999998.
    expect((await patch(7, { comissaoPercentual: 17.55 })).status).toBe(200);
    expect(storageMock.updateMarca.mock.calls[0][1].comissaoPercentual).toBe("17.55");
  });

  it("recusa percentual nulo em vez de grava-lo como zero", async () => {
    // `z.coerce.number()` transformaria null em 0 e zeraria em silencio a
    // comissao de uma marca que negociou 20%.
    const res = await patch(7, { comissaoPercentual: null });
    expect(res.status).toBe(400);
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("recusa status comercial fora do par ativo/suspenso", async () => {
    const res = await patch(7, { statusComercial: "cancelado" });
    expect(res.status).toBe(400);
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("recusa CNPJ com digito verificador errado, nos dois campos", async () => {
    for (const campo of ["responsavelCnpj", "repasseCnpj"]) {
      const res = await patch(7, { [campo]: "11.222.333/0001-82" });
      expect(res.status, campo).toBe(400);
      expect((await res.json()).message).toMatch(/digito verificador/i);
    }
    expect(storageMock.updateMarca).not.toHaveBeenCalled();
  });

  it("aceita CNPJ valido e continua aceitando null para limpar", async () => {
    expect((await patch(7, { responsavelCnpj: CNPJ_VALIDO })).status).toBe(200);
    expect((await patch(7, { responsavelCnpj: null })).status).toBe(200);
    expect(storageMock.updateMarca.mock.calls[1][1]).toEqual({ responsavelCnpj: null });
  });

  it("valida a landing pelo esquema compartilhado e recusa chave inventada", async () => {
    expect((await patch(7, { landing: { headline: "Credito para provedores" } })).status).toBe(200);
    const [, gravado] = storageMock.updateMarca.mock.calls[0];
    // O parse completa os padroes: preco ligado (decisao 12), depoimento nao.
    expect(gravado.landing).toMatchObject({
      headline: "Credito para provedores", mostrarPrecos: true, mostrarDepoimentos: false,
    });

    const res = await patch(7, { landing: { headlineee: "x" } });
    expect(res.status).toBe(400);
  });

  it("valida a imagem de compartilhamento como PNG de verdade", async () => {
    expect((await patch(7, { ogImagePng: PNG_VALIDO })).status).toBe(200);
    const res = await patch(7, { ogImagePng: `data:image/png;base64,${Buffer.from("nao").toString("base64")}` });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/^Imagem de compartilhamento:/);
  });
});

/**
 * A trilha e obrigatoria desde a fase 1 (decisao 15). O que estes testes
 * protegem nao e a existencia do INSERT — e o fato de ele nao poder derrubar a
 * acao, e de `alterar_comissao` ser um verbo proprio: quem audita comissao
 * filtra por acao, e nao le o diff de toda edicao de marca procurando um campo.
 */
describe("trilha de auditoria da marca", () => {
  it("PATCH grava editar_marca com o antes/depois, como superadmin", async () => {
    await patch(7, { suporteWhatsapp: "5531988887777" });
    const evento = eventosMock.registrarEventoDaMarca.mock.calls[0][0];
    expect(evento).toMatchObject({ marcaId: 7, userId: 1, atorRole: "superadmin", acao: "editar_marca" });
    expect(evento.detalhe.campos.suporteWhatsapp)
      .toEqual({ de: "5531999998888", para: "5531988887777" });
  });

  it("o logo entra na trilha como presenca, nunca como conteudo", async () => {
    // 256 KB de SVG por edicao, numa tabela append-only, e megabytes por marca
    // — e a pergunta que a trilha responde e "mudou?", nao "mudou para qual".
    await patch(7, { logoSvg: SVG_VALIDO });
    const evento = eventosMock.registrarEventoDaMarca.mock.calls[0][0];
    expect(evento.detalhe.campos.logoSvg).toEqual({ de: "presente", para: "presente" });
    expect(JSON.stringify(evento.detalhe)).not.toContain("<svg");
  });

  it("mudar o percentual grava tambem alterar_comissao, com o de e o para", async () => {
    await patch(7, { comissaoPercentual: 25 });
    const acoes = eventosMock.registrarEventoDaMarca.mock.calls.map(c => c[0].acao);
    expect(acoes).toEqual(["editar_marca", "alterar_comissao"]);
    const comissao = eventosMock.registrarEventoDaMarca.mock.calls[1][0];
    expect(comissao.detalhe).toEqual({ de: "20.00", para: "25.00" });
  });

  it("reenviar o MESMO percentual nao inventa uma alteracao", async () => {
    // "20" e "20.00" sao o mesmo numero; comparar as strings acusaria mudanca
    // em toda gravacao que reenviasse o valor de sempre.
    await patch(7, { comissaoPercentual: "20", nomeProduto: "CredNet" });
    const acoes = eventosMock.registrarEventoDaMarca.mock.calls.map(c => c[0].acao);
    expect(acoes).toEqual(["editar_marca"]);
  });

  it("a alteracao de percentual nao escreve em mais nada alem da propria marca", async () => {
    // O lancamento ja gravado guarda o percentual VIGENTE no instante em que o
    // dinheiro entrou. Se esta rota um dia recalcular algo, meses ja pagos
    // mudam sozinhos.
    await patch(7, { comissaoPercentual: 30 });
    expect(storageMock.updateMarca).toHaveBeenCalledTimes(1);
    expect(storageMock.updateMarca.mock.calls[0][1]).toEqual({ comissaoPercentual: "30.00" });
  });

  it("falha ao gravar o evento NAO derruba a edicao", async () => {
    // O servico e best-effort de proposito; a rota nao pode reintroduzir a
    // dependencia que ele foi escrito para remover.
    eventosMock.registrarEventoDaMarca.mockRejectedValueOnce(new Error("banco fora"));
    const res = await patch(7, { nomeProduto: "CredNet Pro" });
    expect(res.status).toBe(200);
  });

  it("GET /eventos passa o limite adiante e 404 quando a marca nao existe", async () => {
    eventosMock.listarEventosDaMarca.mockResolvedValue([{ id: 1, acao: "editar_marca" }]);
    const res = await fetch(`${base}/api/admin/marcas/7/eventos?limite=5`);
    expect(res.status).toBe(200);
    expect(eventosMock.listarEventosDaMarca).toHaveBeenCalledWith(7, 5);

    storageMock.getMarca.mockResolvedValue(undefined);
    expect((await fetch(`${base}/api/admin/marcas/404/eventos`)).status).toBe(404);
  });
});

describe("equipe revendedora da marca", () => {
  const criar = (id: number | string, corpo: unknown) =>
    fetch(`${base}/api/admin/marcas/${id}/usuarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });

  const NOVO = { name: "Ana Ribeiro", email: "ana@crednet.com.br" };

  it("cria com o papel, a marca e o estado que o login exige", async () => {
    const res = await criar(7, NOVO);
    expect(res.status).toBe(201);
    const gravado = storageMock.createUser.mock.calls[0][0];
    expect(gravado).toMatchObject({
      role: "revendedor",
      marcaId: 7,
      // O CHECK `users_papel_coerente` recusa revendedor com provedor; e o 0 da
      // sessao dele nao e um provedor de id 0.
      providerId: null,
      // Nao ha caminho de verificacao para revendedor: o reenvio resolve a
      // marca pelo PROVEDOR, que ele nao tem, e o login exige verificado.
      emailVerified: true,
      mustChangePassword: true,
    });
  });

  it("a senha temporaria volta na resposta e vai HASHEADA para o banco", async () => {
    const res = await criar(7, NOVO);
    const corpo = await res.json();
    expect(corpo.senhaTemporaria).toMatch(/^[A-Za-z2-9]{14}$/);
    // Nem O/0 nem I/l/1: esta senha e ditada por telefone.
    expect(corpo.senhaTemporaria).not.toMatch(/[Ol01I]/);
    expect(storageMock.createUser.mock.calls[0][0].password).toBe(`hash-de:${corpo.senhaTemporaria}`);
    // E o hash nunca volta para quem chamou.
    expect(corpo.usuario).not.toHaveProperty("password");
    expect(JSON.stringify(corpo.usuario)).not.toContain("hash-de:");
  });

  it("duas criacoes nao repetem a senha", async () => {
    const a = await (await criar(7, NOVO)).json();
    const b = await (await criar(7, { ...NOVO, email: "bia@crednet.com.br" })).json();
    expect(a.senhaTemporaria).not.toBe(b.senhaTemporaria);
  });

  it("grava criar_usuario_revenda na trilha, sem a senha", async () => {
    await criar(7, NOVO);
    const evento = eventosMock.registrarEventoDaMarca.mock.calls[0][0];
    expect(evento).toMatchObject({
      marcaId: 7, userId: 1, atorRole: "superadmin", acao: "criar_usuario_revenda",
    });
    expect(JSON.stringify(evento.detalhe)).not.toContain("hash-de:");
  });

  it("422 enquanto o dominio da marca nao tem HTTPS ativo", async () => {
    // Ordem do onboarding (decisao 10). Sem isto a pessoa recebe uma conta sem
    // porta: `hostPertenceAMarca` so aceita o dominio proprio ATIVO, e a recusa
    // do login e generica — ela leria "Email ou senha incorretos" para sempre.
    storageMock.getMarca.mockResolvedValue({ ...CREDNET, dominioStatus: "pendente" });
    const res = await criar(7, NOVO);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("MARCA_SEM_DOMINIO_ATIVO");
    expect(storageMock.createUser).not.toHaveBeenCalled();
  });

  /**
   * `dominioStatus: "ativo"` com `dominio: null` e um estado ALCANCAVEL pela
   * tela — o campo esta no formulario e o PATCH aceita `null`. Enquanto o 422
   * olhava so o status, este caso passava com 201, e o acesso nascia morto:
   * `hostPertenceAMarca` exige que `resolverMarcaPorHost` devolva origem
   * "dominio-proprio", o que nao acontece sem dominio gravado.
   */
  it("422 quando a marca nao tem dominio nenhum, mesmo com o status dizendo ativo", async () => {
    storageMock.getMarca.mockResolvedValue({ ...CREDNET, dominio: null, dominioStatus: "ativo" });
    const res = await criar(7, NOVO);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("MARCA_SEM_DOMINIO_ATIVO");
    expect(storageMock.createUser).not.toHaveBeenCalled();
  });

  /** Marca desligada nao resolve host: `resolverMarcaPorHost` filtra por `ativo`. */
  it("422 quando a marca esta desligada — ela nao responde no proprio dominio", async () => {
    storageMock.getMarca.mockResolvedValue({ ...CREDNET, ativo: false });
    const res = await criar(7, NOVO);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("MARCA_DESLIGADA");
    expect(storageMock.createUser).not.toHaveBeenCalled();
  });

  it("422 enquanto a revenda da marca esta desligada", async () => {
    storageMock.getMarca.mockResolvedValue({ ...CREDNET, revendaAtiva: false });
    const res = await criar(7, NOVO);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("MARCA_SEM_REVENDA_ATIVA");
    expect(storageMock.createUser).not.toHaveBeenCalled();
  });

  /**
   * O e-mail sai com o ID DA MARCA, e nao com uma marca pronta.
   *
   * Quem cria e o superadmin, do dominio da plataforma: uma marca resolvida do
   * host aqui seria a da casa, e o botao apontaria para a raiz — exatamente o
   * endereco em que este login e recusado. Passar o id nao tem como estar
   * errado.
   */
  it("manda o e-mail de boas-vindas com o id da marca, e sem a senha", async () => {
    const res = await criar(7, NOVO);
    expect(res.status).toBe(201);
    expect(emailMock.sendBoasVindasRevendedorEmail).toHaveBeenCalledTimes(1);
    const [para, dados, marcaId] = emailMock.sendBoasVindasRevendedorEmail.mock.calls[0];
    expect(para).toBe(NOVO.email);
    expect(marcaId).toBe(7);
    // A senha vai na RESPOSTA, para quem cria; nao no e-mail. Ver
    // `blocoDaCredencial` em server/services/email.ts.
    expect(dados).toEqual({ nome: NOVO.name, emailDeAcesso: NOVO.email });
    expect((await res.json()).emailEnviado).toBe(true);
  });

  /**
   * Falha de envio NAO derruba a criacao — a regra do repositorio para todo
   * aviso (ver `avisarProvedor`). O usuario ja existe quando o e-mail sai;
   * responder 500 faria o operador clicar de novo numa acao que ja surtiu
   * efeito, e o segundo clique levaria 409 de e-mail em uso.
   *
   * `emailEnviado: false` existe para a TELA nao prometer o que nao aconteceu.
   */
  it("falha no envio nao derruba a criacao, e a resposta diz que o e-mail nao saiu", async () => {
    emailMock.sendBoasVindasRevendedorEmail.mockRejectedValue(new Error("domain not verified"));
    const res = await criar(7, NOVO);
    expect(res.status).toBe(201);
    const corpo = await res.json();
    expect(corpo.emailEnviado).toBe(false);
    expect(corpo.senhaTemporaria).toBeTruthy();
    expect(storageMock.createUser).toHaveBeenCalledTimes(1);
  });

  it("409 em e-mail ja usado, e 400 em corpo invalido ou com campo a mais", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ id: 3 });
    expect((await criar(7, NOVO)).status).toBe(409);

    storageMock.getUserByEmail.mockResolvedValue(undefined);
    expect((await criar(7, { name: "A", email: "nao-e-email" })).status).toBe(400);
    // `role` no corpo seria o caminho para criar superadmin por esta porta.
    expect((await criar(7, { ...NOVO, role: "superadmin" })).status).toBe(400);
    expect(storageMock.createUser).not.toHaveBeenCalled();
  });

  it("404 em marca inexistente, e id nao numerico nao chega ao banco", async () => {
    storageMock.getMarca.mockResolvedValue(undefined);
    expect((await criar(7, NOVO)).status).toBe(404);

    storageMock.getMarca.mockClear();
    const res = await fetch(`${base}/api/admin/marcas/abc/usuarios`);
    expect(res.status).toBe(404);
    expect(storageMock.getMarca).not.toHaveBeenCalled();
  });

  it("GET devolve a equipe pela consulta de colunas nomeadas", async () => {
    marcasStorageMock.getUsuariosDaMarca.mockResolvedValue([
      {
        id: 90, name: "Ana", email: "ana@crednet.com.br", role: "revendedor",
        emailVerified: true, mustChangePassword: true, createdAt: null,
      },
    ]);
    const res = await fetch(`${base}/api/admin/marcas/7/usuarios`);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
    expect(marcasStorageMock.getUsuariosDaMarca).toHaveBeenCalledWith(7);
  });
});

describe("remocao de acesso da equipe", () => {
  const ANA = { id: 90, name: "Ana", email: "ana@crednet.com.br", role: "revendedor", marcaId: 7 };
  const remover = (marcaId: number, userId: number) =>
    fetch(`${base}/api/admin/marcas/${marcaId}/usuarios/${userId}`, { method: "DELETE" });

  it("remove e grava remover_usuario_revenda", async () => {
    storageMock.getUser.mockResolvedValue(ANA);
    const res = await remover(7, 90);
    expect(res.status).toBe(200);
    expect(storageMock.deleteUser).toHaveBeenCalledWith(90);
    expect(eventosMock.registrarEventoDaMarca.mock.calls[0][0]).toMatchObject({
      marcaId: 7, acao: "remover_usuario_revenda", atorRole: "superadmin",
    });
  });

  it("404 UNIFORME para quem nao existe e para quem e de outra marca", async () => {
    // As duas respostas precisam ser indistinguiveis: este e o formato que a
    // rota espelhada do revendedor vai usar, e la um 403 diria a um concorrente
    // que o id existe.
    storageMock.getUser.mockResolvedValue(undefined);
    const inexistente = await remover(7, 90);
    storageMock.getUser.mockResolvedValue({ ...ANA, marcaId: 99 });
    const deOutraMarca = await remover(7, 90);

    expect(inexistente.status).toBe(404);
    expect(deOutraMarca.status).toBe(404);
    expect(await inexistente.json()).toEqual(await deOutraMarca.json());
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("nao remove usuario de provedor nem superadmin por esta porta", async () => {
    for (const role of ["admin", "user", "superadmin"]) {
      storageMock.getUser.mockResolvedValue({ ...ANA, role });
      expect((await remover(7, 90)).status, role).toBe(404);
    }
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("nao remove o proprio usuario da sessao", async () => {
    sessao = { ...SUPERADMIN, userId: 90 };
    storageMock.getUser.mockResolvedValue(ANA);
    const res = await remover(7, 90);
    expect(res.status).toBe(409);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("nao remove o ultimo revendedor da marca", async () => {
    // Ficaria uma marca com revenda ligada e ninguem para entrar nela.
    storageMock.getUser.mockResolvedValue(ANA);
    marcasStorageMock.contarRevendedoresDaMarca.mockResolvedValue(0);
    const res = await remover(7, 90);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("ULTIMO_REVENDEDOR");
    // A pergunta e "sobra alguem SEM este?", e ela e feita no banco.
    expect(marcasStorageMock.contarRevendedoresDaMarca).toHaveBeenCalledWith(7, 90);
    expect(storageMock.deleteUser).not.toHaveBeenCalled();
  });

  it("quem ja esta na trilha recusa com 409, e nao com 500", async () => {
    // `marca_eventos.user_id` e NOT NULL: a trilha nao solta a linha. Como
    // `deleteUser` nao traduz FK de proposito, sem esta traducao o superadmin
    // lia "Erro interno do servidor" e clicava de novo.
    storageMock.getUser.mockResolvedValue(ANA);
    storageMock.deleteUser.mockRejectedValue(Object.assign(new Error("fk"), { code: "23503" }));
    const res = await remover(7, 90);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("USUARIO_COM_TRILHA");
  });
});

describe("DELETE /api/admin/marcas/:id — quando a marca nao pode sair", () => {
  const apagar = (id: number) => fetch(`${base}/api/admin/marcas/${id}`, { method: "DELETE" });

  const vinculos = (parcial: Record<string, any> = {}) => ({
    usuariosRevenda: 0, lancamentosPendentes: 0, fechamentosNaoPagos: 0,
    historico: {
      eventos: 0, precos: 0, lancamentos: 0, fechamentos: 0,
      pedidosDeCredito: 0, faturas: 0, conversasDeVisitante: 0, pedidosDeTitular: 0,
    },
    ...parcial,
  });

  it("marca sem nenhum vinculo continua sendo excluida", async () => {
    const res = await apagar(7);
    expect(res.status).toBe(200);
    expect(storageMock.deleteMarca).toHaveBeenCalledWith(7);
  });

  it("409 com equipe ou comissao em aberto, contando o que existe", async () => {
    storageMock.deleteMarca.mockRejectedValue(
      new MarcaComVinculosError(7, vinculos({ usuariosRevenda: 2, lancamentosPendentes: 3 }) as any),
    );
    const res = await apagar(7);
    expect(res.status).toBe(409);
    const corpo = await res.json();
    expect(corpo.code).toBe(CODIGO_MARCA_COM_REVENDA);
    expect(corpo.message).toMatch(/2 acesso\(s\) da equipe revendedora/);
    expect(corpo.message).toMatch(/3 lançamento\(s\) de comissão pendente\(s\)/);
    // Nao lista o que esta zerado. A asserção mira a frase da CONTAGEM, e nao a
    // palavra solta: o texto de orientacao logo depois fala de fechar comissao,
    // e um `not.toMatch(/fechamento/)` cru quebraria ao reescrever a orientacao.
    expect(corpo.message).not.toMatch(/\d+ fechamento\(s\)/);
  });

  it("409 diferente quando o que impede e historico que precisa sobreviver", async () => {
    const v = vinculos();
    storageMock.deleteMarca.mockRejectedValue(
      new MarcaComVinculosError(7, { ...v, historico: { ...v.historico, eventos: 4, pedidosDeCredito: 1 } } as any),
    );
    const res = await apagar(7);
    const corpo = await res.json();
    expect(res.status).toBe(409);
    expect(corpo.code).toBe(CODIGO_MARCA_COM_HISTORICO);
    expect(corpo.message).toMatch(/4 registro\(s\) na trilha de auditoria/);
    expect(corpo.message).toMatch(/1 pedido\(s\) de crédito/);
  });

  it("nenhuma das duas mensagens manda fazer coisa que a tela nao tem", async () => {
    // O 409 do provedor ja mandou "exporte o historico" quando nao havia
    // exportacao nenhuma, e o operador procura o botao antes de acreditar que
    // ele nao existe. As telas de comissao sao da fase 4 e continuam sem
    // existir; a exportacao tambem nao.
    const v = vinculos();
    const textos: string[] = [];
    for (const erro of [
      new MarcaComVinculosError(7, vinculos({ usuariosRevenda: 1 }) as any),
      new MarcaComVinculosError(7, { ...v, historico: { ...v.historico, eventos: 1 } } as any),
    ]) {
      storageMock.deleteMarca.mockRejectedValue(erro);
      textos.push((await (await apagar(7)).json()).message);
    }
    for (const texto of textos) {
      expect(texto).not.toMatch(/aba Comiss|tela de Comiss|exporte/i);
    }
  });

  /**
   * A EXCECAO QUE CAIU, e por que ela pode cair.
   *
   * Este texto terminava em "precisa ser feita por quem administra o banco" e
   * so isso, porque `/admin/marcas` nao tinha controle nenhum para `ativo` —
   * so o selo "Inativa". Sugerir "desligue a marca" mandaria o operador
   * procurar um botao inexistente, que e o defeito que o teste acima guarda.
   *
   * O interruptor "Marca no ar" entrou na aba Comercial
   * (`client/src/pages/admin/admin-marcas.tsx`, `switch-marca-ativa`, gravando
   * `ativo` por `corpoComercial`), entao a alternativa passou a existir e a
   * mensagem passou a oferece-la. Este teste e o par do de cima: um proibe
   * apontar para o que nao existe, o outro exige apontar para o que existe.
   */
  it("o 409 de historico oferece a saida nao destrutiva, que agora existe na tela", async () => {
    const v = vinculos();
    storageMock.deleteMarca.mockRejectedValue(
      new MarcaComVinculosError(7, { ...v, historico: { ...v.historico, eventos: 1 } } as any),
    );
    const { message } = await (await apagar(7)).json();
    expect(message).toMatch(/Marca no ar/);
    expect(message).toMatch(/aba Comercial/);
    // E continua dizendo que APAGAR de vez nao e coisa desta tela.
    expect(message).toMatch(/administra o banco/);
  });

  it("violacao de FK que escape da contagem tambem vira 409, nao 500", async () => {
    // As contagens saem do pool e o DELETE roda depois: uma linha criada no
    // meio chega como 23503. O estado nao mudou (a transacao voltou atras).
    storageMock.deleteMarca.mockRejectedValue(Object.assign(new Error("fk"), { code: "23503" }));
    expect((await apagar(7)).status).toBe(409);
  });
});
