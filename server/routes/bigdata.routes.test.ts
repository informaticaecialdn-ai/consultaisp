/**
 * O identificador da consulta cadastral, e o log que nao existia.
 *
 * Ate esta versao `POST /api/bigdata-consultations` nao tinha UMA linha de log:
 * nem sucesso, nem erro, nem o estorno do credito. E o credito e debitado ANTES
 * do insert, entao havia um intervalo real em que o provedor pagava e nada era
 * gravado — bureau fora do ar, timeout, credencial recusada no meio. Esse
 * evento nao deixava rastro nenhum.
 *
 * Os testes abaixo travam as duas metades do contrato:
 *   1. TODO caminho de saida devolve o codigo, inclusive os de erro;
 *   2. todo caminho escreve log com o mesmo codigo, e nenhum log leva o
 *      documento inteiro.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { FORMATO_DO_IDENTIFICADOR } from "../services/identificador-consulta";

const CPF = "52998224725";          // valido nos digitos verificadores
const CNPJ = "33000167000101";
const QUERY_ID = "7c1f0d2e-4b8a-4f11-9c3d-1a2b3c4d5e6f";   // o QueryId da BigDataCorp

const storageMock = vi.hoisted(() => ({
  getBigdataIntegration: vi.fn(async (): Promise<any> => ({ login: "conta", password: "senha" })),
  upsertBigdataIntegration: vi.fn(async () => ({})),
  getBigdataConsultations: vi.fn(async (): Promise<any[]> => []),
  getProvider: vi.fn(async (): Promise<any> => ({ id: 42, ispCredits: 0 })),
  debitarBigdataCredito: vi.fn(async () => true),
  estornarBigdataCredito: vi.fn(async () => undefined),
  createBigdataConsultation: vi.fn(async (d: any) => ({ ...d, id: 900, createdAt: new Date("2026-09-03T12:00:00Z") })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

const logMock = vi.hoisted(() => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}));
vi.mock("../logger", () => ({ logger: logMock }));

/**
 * O resultado da consulta de pessoa, so com o que a rota le. `bruto` carrega o
 * QueryId — e o campo que ninguem lia, e que a BigDataCorp pede no suporte.
 */
const resultadoCpf = () => ({
  dados: { encontrado: true } as any,
  identidade: { nome: "FULANO DE TAL" },
  enderecos: [], telefones: [], emails: ["fulano@exemplo.com"],
  renda: {}, risco: {}, inadimplencia: {}, processos: [], rastro: {},
  ocupacao: {}, perfil: {}, mercado: {}, capacidade: {},
  domicilio: {}, cruzamentoDomicilio: null, riscoFamiliar: {},
  validacaoTelefone: null, imovel: null,
  datasetsIndisponiveis: [] as string[], datasetsComFalha: [] as string[],
  datasetsChamados: ["basic_data"], latenciaMs: 1234,
  bruto: { QueryId: QUERY_ID },
});

const resultadoCnpj = () => ({
  encontrado: true,
  empresa: { cnpj: CNPJ, razaoSocial: "EMPRESA TESTE" },
  enderecos: [], telefones: [], emails: [], inadimplencia: {}, processos: [],
  datasetsIndisponiveis: [] as string[], datasetsComFalha: [] as string[],
  datasetsChamados: ["basic_data"], latenciaMs: 999,
  bruto: { QueryId: QUERY_ID },
});

const servicoMock = vi.hoisted(() => ({
  consultarCpf: vi.fn(),
  extras: vi.fn((): string[] => []),
}));
vi.mock("../services/bigdata.service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/bigdata.service")>();
  // NIVEIS e NIVEL_PADRAO ficam reais: o custo em creditos e regra de negocio e
  // e o que o teste do saldo insuficiente esta medindo.
  return { ...real, consultarCpf: servicoMock.consultarCpf, extrasDoNivel: servicoMock.extras };
});

const empresaMock = vi.hoisted(() => ({ consultarCnpj: vi.fn() }));
vi.mock("../services/bigdata-empresa", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/bigdata-empresa")>();
  // O veredito tem teste proprio; aqui ele so precisa nao interpretar um
  // resultado de mentira. O que este arquivo mede e o codigo e o log.
  return {
    ...real, consultarCnpj: empresaMock.consultarCnpj,
    decidirVereditoEmpresa: vi.fn(() => ({ veredito: "aprovado", motivos: [] })),
  };
});

vi.mock("../services/bigdata-veredito", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/bigdata-veredito")>();
  return { ...real, decidirVeredito: vi.fn(() => ({ veredito: "aprovado", motivos: [] })) };
});

vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Autenticacao necessaria" });
    next();
  },
  requireProvider: (req: any, res: any, next: any) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Autenticacao necessaria" });
    if (!(Number(req.session?.providerId) > 0)) return res.status(403).json({ message: "Somente provedores" });
    next();
  },
}));

import { registerBigdataRoutes } from "./bigdata.routes";

let server: Server;
let base: string;
let sessao: Record<string, unknown> = {};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerBigdataRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  sessao = { userId: 7, providerId: 42, role: "admin" };
  storageMock.getBigdataIntegration.mockResolvedValue({ login: "conta", password: "senha" });
  storageMock.debitarBigdataCredito.mockResolvedValue(true);
  storageMock.getProvider.mockResolvedValue({ id: 42, ispCredits: 0 });
  storageMock.createBigdataConsultation.mockImplementation(
    async (d: any) => ({ ...d, id: 900, createdAt: new Date("2026-09-03T12:00:00Z") }));
  servicoMock.extras.mockReturnValue([]);
  servicoMock.consultarCpf.mockResolvedValue(resultadoCpf());
  empresaMock.consultarCnpj.mockResolvedValue(resultadoCnpj());
});

async function consultar(body: unknown) {
  const res = await fetch(`${base}/api/bigdata-consultations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

/** Todo objeto de contexto que foi para o log, em qualquer nivel. */
function contextosLogados(): any[] {
  return [logMock.info, logMock.warn, logMock.error, logMock.debug]
    .flatMap(fn => fn.mock.calls.map(c => c[0]))
    .filter(c => c && typeof c === "object");
}

/**
 * O ponto do pedido: com dois provedores consultando o mesmo CPF no mesmo
 * minuto, nao havia como amarrar as linhas de log entre si.
 */
describe("todo caminho de saida devolve o identificador", () => {
  const casos: Array<[string, () => Promise<{ status: number; body: any }>, number]> = [
    ["corpo invalido", () => consultar({}), 400],
    ["CPF com digito errado", () => consultar({ cpfCnpj: "11111111111" }), 400],
    ["CNPJ com digito errado", () => consultar({ cpfCnpj: "11111111111111" }), 400],
    ["consulta bem-sucedida de CPF", () => consultar({ cpfCnpj: CPF }), 200],
    ["consulta bem-sucedida de CNPJ", () => consultar({ cpfCnpj: CNPJ }), 200],
  ];

  for (const [nome, chamar, status] of casos) {
    it(nome, async () => {
      const r = await chamar();
      expect(r.status).toBe(status);
      expect(r.body.consultaId).toMatch(FORMATO_DO_IDENTIFICADOR);
    });
  }

  it("credencial nao configurada", async () => {
    storageMock.getBigdataIntegration.mockResolvedValue(undefined);
    const r = await consultar({ cpfCnpj: CPF });
    expect(r.status).toBe(400);
    expect(r.body.naoConfigurado).toBe(true);
    expect(r.body.consultaId).toMatch(FORMATO_DO_IDENTIFICADOR);
  });

  it("saldo insuficiente — CPF e CNPJ", async () => {
    storageMock.debitarBigdataCredito.mockResolvedValue(false);
    for (const doc of [CPF, CNPJ]) {
      const r = await consultar({ cpfCnpj: doc });
      expect(r.status).toBe(402);
      expect(r.body.consultaId, `documento ${doc}`).toMatch(FORMATO_DO_IDENTIFICADOR);
    }
  });

  it("bureau fora do ar (503) — o caminho em que NAO existe linha no banco", async () => {
    servicoMock.consultarCpf.mockRejectedValue(new Error("ECONNRESET"));
    const r = await consultar({ cpfCnpj: CPF });
    expect(r.status).toBe(503);
    expect(r.body.consultaId).toMatch(FORMATO_DO_IDENTIFICADOR);
    expect(storageMock.createBigdataConsultation).not.toHaveBeenCalled();
  });

  it("credencial recusada pelo bureau (400)", async () => {
    servicoMock.consultarCpf.mockRejectedValue(Object.assign(new Error("recusada"), { codigo: -111 }));
    const r = await consultar({ cpfCnpj: CPF });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("Credencial recusada");
    expect(r.body.consultaId).toMatch(FORMATO_DO_IDENTIFICADOR);
  });

  it("cada requisicao recebe um codigo proprio", async () => {
    const a = await consultar({ cpfCnpj: CPF });
    const b = await consultar({ cpfCnpj: CPF });
    expect(a.body.consultaId).not.toBe(b.body.consultaId);
  });
});

describe("a linha gravada recebe o codigo da resposta", () => {
  it("CPF: um codigo so para a requisicao inteira", async () => {
    const r = await consultar({ cpfCnpj: CPF });
    const gravado = storageMock.createBigdataConsultation.mock.calls[0][0] as any;
    expect(gravado.consultaId).toBe(r.body.consultaId);
  });

  it("CNPJ: o mesmo codigo, gerado antes do ramo de documento", async () => {
    const r = await consultar({ cpfCnpj: CNPJ });
    const gravado = storageMock.createBigdataConsultation.mock.calls[0][0] as any;
    expect(gravado.consultaId).toBe(r.body.consultaId);
  });
});

/**
 * O QueryId ja vinha gravado em `result.bruto` desde sempre e ninguem lia.
 * Quando o dado do bureau vem errado, quem resolve e a BigDataCorp — e e este
 * numero que ela pede.
 */
describe("o protocolo da propria BigDataCorp", () => {
  it("sai na resposta e no log de conclusao — CPF", async () => {
    const r = await consultar({ cpfCnpj: CPF });
    expect(r.body.protocoloDaOrigem).toEqual({ origem: "BigDataCorp", protocolo: QUERY_ID });

    const fim = logMock.info.mock.calls.find(c => String(c[1]).includes("concluída"));
    expect(fim?.[0].protocoloOrigem).toBe(QUERY_ID);
  });

  it("sai na resposta e no log de conclusao — CNPJ", async () => {
    const r = await consultar({ cpfCnpj: CNPJ });
    expect(r.body.protocoloDaOrigem).toEqual({ origem: "BigDataCorp", protocolo: QUERY_ID });
  });

  it("envelope sem QueryId devolve null, nao quebra a consulta", async () => {
    servicoMock.consultarCpf.mockResolvedValue({ ...resultadoCpf(), bruto: {} });
    const r = await consultar({ cpfCnpj: CPF });
    expect(r.status).toBe(200);
    expect(r.body.protocoloDaOrigem).toBeNull();
  });
});

describe("o log que a rota nao tinha", () => {
  it("inicio e conclusao saem com o mesmo codigo da resposta", async () => {
    const r = await consultar({ cpfCnpj: CPF });
    const linhas = logMock.info.mock.calls.filter(c => String(c[1]).startsWith("[Cadastral]"));
    expect(linhas.length).toBeGreaterThanOrEqual(2);
    for (const [ctx] of linhas) expect(ctx.consultaId).toBe(r.body.consultaId);
    expect(linhas.some(c => String(c[1]).includes("iniciada"))).toBe(true);
    expect(linhas.some(c => String(c[1]).includes("concluída"))).toBe(true);
  });

  it("o caminho que NAO grava linha ainda loga, com o motivo", async () => {
    storageMock.debitarBigdataCredito.mockResolvedValue(false);
    const r = await consultar({ cpfCnpj: CPF });

    const recusa = logMock.warn.mock.calls.find(c => c[0]?.motivo === "saldo-insuficiente");
    expect(recusa).toBeDefined();
    expect(recusa![0].consultaId).toBe(r.body.consultaId);
    expect(storageMock.createBigdataConsultation).not.toHaveBeenCalled();
  });

  it("credito cobrado e nenhuma linha gravada: a falha E o estorno viram log", async () => {
    servicoMock.consultarCpf.mockRejectedValue(new Error("ECONNRESET"));
    const r = await consultar({ cpfCnpj: CPF });

    // O estorno e um movimento que o provedor ve no extrato; sem esta linha
    // nao havia como ligar o movimento a consulta que o causou.
    const estorno = logMock.info.mock.calls.find(c => String(c[1]).includes("estorno integral"));
    expect(estorno?.[0].consultaId).toBe(r.body.consultaId);
    expect(estorno?.[0].estornado).toBe(1);
    expect(storageMock.estornarBigdataCredito).toHaveBeenCalledWith(42, 1);

    const falha = logMock.error.mock.calls[0];
    expect(falha[0].consultaId).toBe(r.body.consultaId);
    expect(falha[0].motivo).toBe("falha-do-bureau");
  });

  it("credencial recusada e distinguida da falha do bureau no log", async () => {
    servicoMock.consultarCpf.mockRejectedValue(Object.assign(new Error("x"), { codigo: -111 }));
    await consultar({ cpfCnpj: CPF });
    expect(logMock.error.mock.calls[0][0].motivo).toBe("credencial-recusada");
  });

  it("bureau indisponivel sem diferenca a estornar nao inventa linha de estorno", async () => {
    /**
     * Com um nivel so (02/09/2026), `custoCreditos` ja E o custo do padrao:
     * a diferenca a estornar da zero e nao ha movimento de credito. O log de
     * estorno parcial esta dentro do `if (estorno > 0)` de proposito — logar
     * um estorno de zero mandaria o suporte procurar um movimento que o
     * extrato do provedor nao tem.
     *
     * O ramo volta a valer no dia em que existir um nivel mais caro que o
     * padrao; ate la a consulta e concluida avisando `bureauIndisponivel`.
     */
    servicoMock.extras.mockReturnValue(["partner_qualquer"]);
    servicoMock.consultarCpf.mockResolvedValue({
      ...resultadoCpf(), datasetsIndisponiveis: ["partner_qualquer"],
    });
    const r = await consultar({ cpfCnpj: CPF });
    expect(r.status).toBe(200);
    expect(r.body.bureauIndisponivel).toBe(true);
    expect(storageMock.estornarBigdataCredito).not.toHaveBeenCalled();

    // O aviso continua no log de conclusao, com o codigo — e por ele que o
    // suporte explica "o bloco de mercado nao apareceu nesta consulta".
    const fim = logMock.info.mock.calls.find(c => String(c[1]).includes("concluída"));
    expect(fim?.[0].bureauIndisponivel).toBe(true);
    expect(fim?.[0].consultaId).toBe(r.body.consultaId);
  });

  it("cada recusa anterior a cobranca diz POR QUE nao gravou linha", async () => {
    const esperado: Array<[unknown, string]> = [
      [{}, "corpo-invalido"],
      [{ cpfCnpj: "11111111111" }, "documento-invalido"],
      [{ cpfCnpj: "11111111111111" }, "documento-invalido"],
    ];
    for (const [corpo, motivo] of esperado) {
      logMock.warn.mockClear();
      const r = await consultar(corpo);
      const linha = logMock.warn.mock.calls.find(c => c[0]?.motivo === motivo);
      expect(linha, `corpo ${JSON.stringify(corpo)}`).toBeDefined();
      expect(linha![0].consultaId).toBe(r.body.consultaId);
    }

    logMock.warn.mockClear();
    storageMock.getBigdataIntegration.mockResolvedValue(undefined);
    const semCred = await consultar({ cpfCnpj: CPF });
    const linhaCred = logMock.warn.mock.calls.find(c => c[0]?.motivo === "sem-credencial");
    expect(linhaCred?.[0].consultaId).toBe(semCred.body.consultaId);
  });

  it("NENHUM log carrega o documento inteiro", async () => {
    await consultar({ cpfCnpj: CPF });
    await consultar({ cpfCnpj: CNPJ });
    servicoMock.consultarCpf.mockRejectedValue(new Error("ECONNRESET"));
    await consultar({ cpfCnpj: CPF });

    const texto = JSON.stringify(contextosLogados());
    expect(texto).not.toContain(CPF);
    expect(texto).not.toContain(CNPJ);
    // Quatro digitos e o que o suporte precisa para casar a linha com a
    // consulta descrita, e nao remonta o documento.
    expect(texto).toContain(CPF.slice(0, 4) + "***");
  });
});

describe("GET /api/bigdata-consultations", () => {
  it("o historico devolve o codigo, e traco para as consultas anteriores a ele", async () => {
    storageMock.getBigdataConsultations.mockResolvedValue([
      { id: 1, cpfCnpj: CPF, veredito: "aprovado", createdAt: new Date(), datasets: ["basic_data"], result: {}, consultaId: "CI-2609-K7F3M2" },
      { id: 2, cpfCnpj: CPF, veredito: "aprovado", createdAt: new Date(), datasets: ["basic_data"], result: {}, consultaId: null },
    ]);
    const res = await fetch(`${base}/api/bigdata-consultations`);
    const body = await res.json() as any;
    expect(body.consultations[0].consultaId).toBe("CI-2609-K7F3M2");
    expect(body.consultations[1].consultaId).toBeNull();
  });
});
