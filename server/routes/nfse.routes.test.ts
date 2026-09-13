/**
 * NFS-e na demonstração pública: a tela funciona inteira (configurado, emitir,
 * consultar, cancelar) e a Focus NFe nunca é chamada. Fora da demonstração, o
 * caminho de sempre — sem token, 400; com token, a chamada à Focus.
 *
 * `fetch` global é trocado por um espião durante cada teste: é por ele que
 * `services/focusnfe.ts` sai para a rede. As requisições do próprio teste ao
 * servidor local usam a referência guardada ANTES da troca.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(async (_id: number): Promise<any> => ({
    id: 42, name: "Provedor Teste", cnpj: "12345678000190", createdAt: new Date("2026-09-12T15:00:00.000Z"),
  })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireProvider: (_req: any, _res: any, next: any) => next(),
}));

import { registerNfseRoutes } from "./nfse.routes";

const http = globalThis.fetch;
let server: Server;
let base: string;
let saida: ReturnType<typeof vi.fn>;

const CORPO = {
  tomador: {
    cnpjCpf: "12.345.678/0001-90", razaoSocial: "Tomador Teste", email: "fiscal@tomador.com.br",
    logradouro: "Rua A", numero: "10", bairro: "Centro", cep: "86010-000",
  },
  descricao: "Licenciamento SaaS",
  valor: 149,
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: 7, providerId: 42 }; next(); });
  app.use(registerNfseRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  saida = vi.fn(async () => new Response(JSON.stringify({ mensagem: "Recebido" }), { status: 202 }));
  vi.stubGlobal("fetch", saida);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEMO_MODE;
  delete process.env.FOCUS_NFE_TOKEN;
});

const emitir = () => http(`${base}/api/nfse/emit`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(CORPO),
});

describe("NFS-e com DEMO_MODE ligado (e sem token da Focus)", () => {
  beforeEach(() => { process.env.DEMO_MODE = "true"; });

  it("GET /api/nfse/config responde configurado, em ambiente de demonstracao", async () => {
    const config = await (await http(`${base}/api/nfse/config`)).json();
    expect(config).toMatchObject({ configured: true, environment: "demonstracao" });
  });

  it("emitir, consultar e cancelar respondem sucesso simulado sem nenhuma chamada para fora", async () => {
    const res = await emitir();
    expect(res.status).toBe(202);
    const nota = await res.json();
    expect(nota.ref).toMatch(/^demo-42-\d+$/);
    expect(nota).toMatchObject({ status: "authorized", mensagem: expect.stringMatching(/simulada/) });
    expect(nota.numero).toMatch(/^\d{6}$/);

    const consulta = await (await http(`${base}/api/nfse/${nota.ref}`)).json();
    // O numero sai da referencia: consultar a mesma nota devolve o mesmo numero.
    expect(consulta).toMatchObject({ status: "authorized", ref: nota.ref, numero: nota.numero });

    const cancelamento = await (await http(`${base}/api/nfse/${nota.ref}`, { method: "DELETE" })).json();
    expect(cancelamento).toMatchObject({ status: "cancelled", ref: nota.ref });

    expect(saida).not.toHaveBeenCalled();
  });

  /**
   * O prestador era o CNPJ da PLATAFORMA e o município São Paulo, para um
   * provedor fictício de Londrina. Na demonstração a nota é do próprio sandbox.
   */
  it("config do sandbox: CNPJ do provedor da sessão, Londrina 4113700 e serviço de internet", async () => {
    const texto = await (await http(`${base}/api/nfse/config`)).text();
    expect(JSON.parse(texto)).toMatchObject({
      cnpjPrestador: "12345678000190",
      codigoMunicipio: "4113700",
      municipio: "Londrina",
      uf: "PR",
      descricaoPadrao: expect.stringMatching(/internet/i),
    });
    expect(texto).not.toContain("64199963000149");
    expect(texto).not.toContain("3550308");
    expect(storageMock.getProvider).toHaveBeenCalledWith(42);
  });

  it("GET /api/nfse lista 5 a 8 notas simuladas, iguais a cada chamada e sem rede", async () => {
    const res = await http(`${base}/api/nfse`);
    expect(res.status).toBe(200);
    const notas = await res.json();
    expect(Array.isArray(notas)).toBe(true);
    expect(notas.length).toBeGreaterThanOrEqual(5);
    expect(notas.length).toBeLessThanOrEqual(8);
    expect(await (await http(`${base}/api/nfse`)).json()).toEqual(notas);
    for (const n of notas) expect(n.ref).toMatch(/^demo-42-\d+$/);
    expect(notas.some((n: any) => n.status === "processing")).toBe(true);
    expect(saida).not.toHaveBeenCalled();
  });

  it("a lista e a consulta falam da mesma nota: mesmo número pela mesma referência", async () => {
    const notas = await (await http(`${base}/api/nfse`)).json();
    const autorizada = notas.find((n: any) => n.status === "authorized");
    const consulta = await (await http(`${base}/api/nfse/${autorizada.ref}`)).json();
    expect(consulta).toMatchObject({ ref: autorizada.ref, numero: autorizada.numero });
  });
});

describe("NFS-e com DEMO_MODE desligado", () => {
  it("config byte a byte a de antes, sem ler o provedor", async () => {
    const texto = await (await http(`${base}/api/nfse/config`)).text();
    expect(texto).toBe(
      '{"configured":false,"environment":"homologacao","cnpjPrestador":"64199963000149","inscricaoMunicipal":"",' +
      '"codigoMunicipio":"3550308","aliquotaIss":2.9,"codigoServico":"01.07",' +
      '"descricaoPadrao":"Licenciamento de uso de software SaaS - Consulta ISP - Analise de credito para provedores de internet"}',
    );
    expect(storageMock.getProvider).not.toHaveBeenCalled();
  });

  it("GET /api/nfse continua sem rota: cai adiante (404 aqui) sem tocar o banco", async () => {
    const res = await http(`${base}/api/nfse`);
    expect(res.status).toBe(404);
    expect(storageMock.getProvider).not.toHaveBeenCalled();
  });

  it("sem token: configured false e emitir recusa com 400, como antes", async () => {
    const config = await (await http(`${base}/api/nfse/config`)).json();
    expect(config).toMatchObject({ configured: false, environment: "homologacao" });

    const res = await emitir();
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("FOCUS_NFE_TOKEN");
    expect(saida).not.toHaveBeenCalled();
  });

  it("com token: emitir chama a Focus NFe com a referencia nfse-", async () => {
    process.env.FOCUS_NFE_TOKEN = "token-de-teste";
    const res = await emitir();
    expect(res.status).toBe(202);
    const nota = await res.json();
    expect(nota).toMatchObject({ status: "processing" });
    expect(nota.ref).toMatch(/^nfse-42-\d+$/);
    expect(saida).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/homologacao\.focusnfe\.com\.br\/v2\/nfse\?ref=nfse-42-/),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
