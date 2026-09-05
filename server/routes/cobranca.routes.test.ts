import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import {
  MOTIVO_CASO_FECHADO,
  MOTIVO_NEGATIVADO_NAO_VOLTA,
  MOTIVO_NEGOCIACAO_ENCERRADA,
  POLITICA_PADRAO,
  STATUS_DE_CASO,
  casoFechado,
} from "@shared/cobranca";

/**
 * Foco: o que as rotas de cobranca PROMETEM e o storage nao consegue provar
 * sozinho — que toda leitura e escrita leva o providerId da sessao, que o
 * operador `user` nao configura, nao atribui e nao decreta desfecho, que a
 * politica recusa com a frase certa, que a maquina de estados devolve 409
 * com o motivo dela, que os codigos do storage viram 409 e nao 500, que os
 * indicadores da fila cobrem o recorte inteiro e nao a pagina, que o kanban
 * tem uma coluna por status e so os fechados recentes, que pagar a ultima
 * parcela fecha o caso, e que a ficha 360 nao inventa campo.
 *
 * O storage inteiro vira espiao: aqui se prova o contrato da rota, nao o SQL
 * (esse tem o proprio teste em server/storage/cobranca.storage.test.ts).
 *
 * `podeAdministrarOProvedor` entra como o REAL, importado de
 * provider.routes.ts: quem pode mexer na politica e metade do que se testa, e
 * a regra do superadmin-so-em-janela-de-suporte mora la. `ErroDeCobranca`
 * tambem e o real: a rota tem de reconhecer a classe que o storage lanca.
 */
const LISTA_VAZIA = async (): Promise<any> => ({ linhas: [], total: 0 });
const storageMock = vi.hoisted(() => ({
  kpisDaCobranca: vi.fn(async (): Promise<any> => ({ ativosComDivida: 3, exClientesComDivida: 10, emAberto: 5000, contatadosHoje: 1, recuperado30d: 300 })),
  composicaoDaCarteira: vi.fn(async (): Promise<any> => ({ emDia: 100, emCobranca: 3, exComDivida: 10 })),
  bairrosDaCarteira: vi.fn(async (): Promise<any[]> => [{ bairro: "Centro", total: 4 }]),
  getPoliticaDeCobranca: vi.fn(async (): Promise<any> => undefined),
  upsertPoliticaDeCobranca: vi.fn(async (_p: number, dados: any): Promise<any> => ({ id: 1, providerId: _p, ...dados, updatedAt: new Date("2026-09-05T12:00:00Z") })),
  getCustomersByProvider: vi.fn(async (): Promise<any[]> => []),
  getUsersByProvider: vi.fn(async (): Promise<any[]> => []),
  listarCasosDeCobranca: vi.fn(async (): Promise<any> => ({ linhas: [], total: 0 })),
  obterCasoDeCobranca: vi.fn(async (): Promise<any> => undefined),
  casoAbertoDoCliente: vi.fn(async (): Promise<any> => undefined),
  abrirCasoDeCobranca: vi.fn(async (_p: number, dados: any): Promise<any> => ({ id: 77, status: "aberto", ...dados })),
  atualizarCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9 })),
  fecharCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9 })),
  cancelarCaso: vi.fn(async (): Promise<any> => ({ id: 9, status: "cancelamento" })),
  contarCasosPorEtapa: vi.fn(async (): Promise<any[]> => []),
  contarCasosPorQuadrante: vi.fn(async (): Promise<any[]> => []),
  registrarEventoDeCobranca: vi.fn(async (_p: number, ev: any): Promise<any> => ({ id: 500, providerId: _p, ...ev })),
  listarEventosDoCaso: vi.fn(async (): Promise<any[]> => []),
  listarEventosDoCliente: vi.fn(async (): Promise<any[]> => []),
  criarNegociacao: vi.fn(async (): Promise<any> => undefined),
  atualizarStatusDaNegociacao: vi.fn(async (): Promise<any> => undefined),
  listarNegociacoesDoCaso: vi.fn(async (): Promise<any[]> => []),
  obterNegociacao: vi.fn(async (): Promise<any> => undefined),
  listarParcelasDaNegociacao: vi.fn(async (): Promise<any[]> => []),
  obterParcela: vi.fn(async (): Promise<any> => undefined),
  marcarParcelaPaga: vi.fn(async (): Promise<any> => undefined),
  filaDeCobranca: vi.fn(async (): Promise<any[]> => []),
  clientesParaAbrirCaso: vi.fn(async (): Promise<any[]> => []),
  getEquipmentByCustomer: vi.fn(async (): Promise<any[]> => []),
  getRecoveryCases: vi.fn(async (): Promise<any[]> => []),
  getRecentConsultationsForDocument: vi.fn(async (): Promise<any[]> => []),
  getAlertsByCustomer: vi.fn(async (): Promise<any[]> => []),
  conversasDoChatPorCaso: vi.fn(async (): Promise<Map<number, any>> => new Map()),
  getConversaDoChatPorCaso: vi.fn(async (): Promise<any> => undefined),
}));
const snapshotMock = vi.hoisted(() => ({
  snapshotAoVivoDoCliente: vi.fn(async (): Promise<any> => ({ ok: false, erpSource: null, encontrado: false, cliente: null, erro: "Sem integração", latenciaMs: 1, lidoEm: "2026-09-05T12:00:00.000Z", doCache: false })),
}));
vi.mock("../services/cobranca/snapshot-ao-vivo.service", () => snapshotMock);
vi.mock("../storage", () => ({ storage: storageMock }));

// cobranca.storage.ts (de onde vem `carteiraDoStatusErp` e `ErroDeCobranca`)
// e provider.routes.ts puxam o pool do Postgres e o segredo de sessao ao
// serem importados; nada disso e o que se testa.
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "segredo-de-teste-sem-nenhum-valor-real";
});
vi.mock("../db", () => ({
  pool: { query: async () => ({ rows: [] }), on: () => undefined, connect: async () => ({ release: () => undefined }) },
  db: {},
}));
vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Autenticacao necessaria" });
    next();
  },
  requireProvider: (req: any, res: any, next: any) => {
    if (!req.session?.providerId) return res.status(403).json({ message: "Somente provedores" });
    next();
  },
}));
vi.mock("../password", () => ({ hashPassword: vi.fn(async (s: string) => `hash:${s}`) }));
vi.mock("../services/email", () => ({ sendUsuarioAdicionadoEmail: vi.fn(async () => undefined) }));
vi.mock("../services/marca.service", () => ({
  resolverMarcaPorId: vi.fn(async () => ({ marcaId: null, nomeProduto: "Consulta ISP", suporteEmail: null })),
  urlDeEntrada: vi.fn(() => "https://consultaisp.example"),
  MARCA_PLATAFORMA: { marcaId: null, nomeProduto: "Consulta ISP", suporteEmail: null },
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { ispScoreReal, mascararDocumento, registerCobrancaRoutes } from "./cobranca.routes";
import { ErroDeCobranca } from "../storage/cobranca.storage";

let server: Server;
let base: string;
let sessao: Record<string, any> = {};

const ADMIN = { userId: 7, providerId: 42, role: "admin" };
const OPERADOR = { userId: 8, providerId: 42, role: "user" };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessao;
    next();
  });
  app.use(registerCobrancaRoutes());
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  sessao = {};
});

const json = (method: string, caminho: string, corpo?: unknown) =>
  fetch(`${base}${caminho}`, {
    method,
    headers: corpo === undefined ? {} : { "content-type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

/* ── Fixtures ────────────────────────────────────────────────────────── */

/** Contrato de 2010: fiel para sempre, e o teste nao envelhece. 45 dias e 2 faturas: oscila → B3, "cuidado". */
const clienteMaria = {
  id: 1, providerId: 42, name: "Maria", cpfCnpj: "12345678901", phone: "31999990000", email: "m@x",
  address: "Rua A", addressNumber: "10", complement: null, neighborhood: "Centro", city: "BH", state: "MG", cep: "30000000",
  status: "active", paymentStatus: "overdue", totalOverdueAmount: "400.00", maxDaysOverdue: 45, overdueInvoicesCount: 2,
  ispScore: 720, riskTier: "low", motivoCorte: null, cortadoEm: null, contractStartDate: "2010-01-01",
  erpSource: "ixc", lastSyncAt: null,
};

const linhaCaso = (extra: Record<string, unknown> = {}) => ({
  id: 9, status: "aberto", carteira: "ativo", abertoEm: new Date("2026-09-01T10:00:00Z"), etapaAtual: "negociacao_recuperacao",
  diasAtrasoAbertura: 45, valorAbertura: 400, valorAtual: 400, responsavelUserId: null, responsavelNome: null,
  prioridade: "normal", proximoContatoEm: null, ultimoContatoEm: null, quadranteDna: "B3", tom: "cuidado",
  encerradoEm: null, motivoEncerramento: null,
  cliente: {
    id: 1, nome: "Maria", cpfCnpj: "12345678901", telefone: "31999990000", email: "m@x", cidade: "BH", bairro: "Centro",
    statusErp: "active", dividaAtual: 400, diasAtraso: 45, faturasAbertas: 2, plano: null, contractStartDate: "2010-01-01",
  },
  ...extra,
});

const equipe = [
  { id: 7, name: "Ana", email: "ana@x", password: "hash-secreto", role: "admin", providerId: 42 },
  { id: 8, name: "Beto", email: "beto@x", password: "hash-secreto-2", role: "user", providerId: 42 },
];

const daquiADias = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
};

/** Um instante a N dias de agora (negativo = passado), para os campos de data-hora. */
const emDias = (dias: number) => new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

/* ── Mascara e score ─────────────────────────────────────────────────── */

describe("mascararDocumento", () => {
  it("CPF mostra os seis primeiros e os dois ultimos; CNPJ esconde o miolo e o DV", () => {
    expect(mascararDocumento("123.456.789-01")).toBe("123.456.***-01");
    expect(mascararDocumento("12345678000199")).toBe("12.345.***/0001-**");
    expect(mascararDocumento("")).toBe("****");
  });
});

describe("ispScoreReal", () => {
  it("o par (100, 'low') e o DEFAULT da coluna, nao um score: sai null nos dois", () => {
    expect(ispScoreReal({ ispScore: 100, riskTier: "low" })).toEqual({ ispScore: null, riskTier: null });
    expect(ispScoreReal({ ispScore: 100, riskTier: null })).toEqual({ ispScore: null, riskTier: null });
    expect(ispScoreReal(undefined)).toEqual({ ispScore: null, riskTier: null });
  });

  it("qualquer outro par e calculo gravado — inclusive 100 com faixa coerente", () => {
    expect(ispScoreReal({ ispScore: 720, riskTier: "low" })).toEqual({ ispScore: 720, riskTier: "low" });
    expect(ispScoreReal({ ispScore: 100, riskTier: "critical" })).toEqual({ ispScore: 100, riskTier: "critical" });
    expect(ispScoreReal({ ispScore: null, riskTier: "low" })).toEqual({ ispScore: null, riskTier: "low" });
  });
});

/* ── Carteira ────────────────────────────────────────────────────────── */

describe("GET /api/cobranca/carteira", () => {
  it("401 sem sessao, e o storage nem e consultado", async () => {
    const res = await json("GET", "/api/cobranca/carteira");
    expect(res.status).toBe(401);
    expect(storageMock.listarCasosDeCobranca).not.toHaveBeenCalled();
    expect(storageMock.kpisDaCobranca).not.toHaveBeenCalled();
  });

  it("isola por providerId da sessao em toda leitura e devolve os dois segmentos: casos e sem caso", async () => {
    sessao = ADMIN;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria, { ...clienteMaria, id: 2, name: "Joao", cpfCnpj: "98765432100", ispScore: 200 }]);
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [linhaCaso()], total: 1 });
    storageMock.clientesParaAbrirCaso.mockResolvedValueOnce([
      { customerId: 2, nome: "Joao", cpfCnpj: "98765432100", statusErp: "cancelled", carteira: "ex_cliente", dividaAtual: 900, diasAtraso: 200, faturasAbertas: 4, contractStartDate: null },
    ]);

    const res = await json("GET", "/api/cobranca/carteira?carteira=&status=");
    const body = await res.json();
    expect(res.status).toBe(200);

    expect(storageMock.kpisDaCobranca).toHaveBeenCalledWith(42, expect.any(Date));
    expect(storageMock.composicaoDaCarteira).toHaveBeenCalledWith(42);
    expect(storageMock.bairrosDaCarteira).toHaveBeenCalledWith(42);
    expect(storageMock.getPoliticaDeCobranca).toHaveBeenCalledWith(42);
    expect(storageMock.getCustomersByProvider).toHaveBeenCalledWith(42);
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, {}, { pagina: 1, porPagina: 50 });
    expect(storageMock.clientesParaAbrirCaso).toHaveBeenCalledWith(42, 0, expect.any(Number));

    expect(body.total).toBe(2);
    expect(body.itens).toHaveLength(2);
    const [comCaso, semCaso] = body.itens;
    // o documento sai mascarado e o cru nao viaja
    expect(comCaso.documentoMascarado).toBe("123.456.***-01");
    expect(JSON.stringify(body)).not.toContain("12345678901");
    // DNA calculado ao vivo das colunas de customers (2010 → fiel; 45 dias → oscila)
    expect(comCaso).toMatchObject({ customerId: 1, quadrante: "B3", tom: "cuidado", fidelidade: "fiel", confiabilidade: "oscila", ispScore: 720 });
    expect(comCaso.caso).toMatchObject({ id: 9, status: "aberto", etapa: "negociacao_recuperacao", responsavel: null });
    expect(comCaso.regua).toMatchObject({ etapa: "negociacao_recuperacao" });
    // sem data de contrato nao ha DNA — "—", nunca "novo"
    expect(semCaso).toMatchObject({ customerId: 2, caso: null, quadrante: null, fidelidade: null, carteira: "ex_cliente", ispScore: 200, bairro: "Centro" });
    expect(semCaso.regua).toMatchObject({ etapa: "divida_antiga" });
    expect(body.kpis.emAberto).toBe(5000);
    expect(body.bairros).toEqual([{ bairro: "Centro", total: 4 }]);
  });

  it("isp_score no default da coluna (100/'low') sai null e nao entra em faixa de saude nenhuma", async () => {
    sessao = ADMIN;
    const semScore = { ...clienteMaria, id: 3, cpfCnpj: "11122233344", ispScore: 100, riskTier: "low" };
    const casoSemScore = linhaCaso({ id: 30, cliente: { ...linhaCaso().cliente, id: 3, cpfCnpj: "11122233344" } });
    storageMock.getCustomersByProvider.mockResolvedValue([semScore]);
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [casoSemScore], total: 1 });
    storageMock.clientesParaAbrirCaso.mockResolvedValue([
      { customerId: 3, nome: "Maria", cpfCnpj: "11122233344", statusErp: "active", carteira: "ativo", dividaAtual: 400, diasAtraso: 45, faturasAbertas: 2, contractStartDate: "2010-01-01" },
    ]);

    const body = await (await json("GET", "/api/cobranca/carteira")).json();
    expect(body.itens[0]).toMatchObject({ customerId: 3, ispScore: null, riskTier: null });

    // O filtro "critica" NAO pesca quem nao tem score: 100 nao e critico, e ausencia.
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [casoSemScore], total: 1 });
    const critica = await (await json("GET", "/api/cobranca/carteira?saude=critica")).json();
    expect(critica.itens).toEqual([]);
    expect(critica.total).toBe(0);
    storageMock.getCustomersByProvider.mockResolvedValue([]);
    storageMock.clientesParaAbrirCaso.mockResolvedValue([]);
  });

  it("status=sem_caso pula o segmento de casos; um status de caso pula o segmento sem caso", async () => {
    sessao = ADMIN;
    await json("GET", "/api/cobranca/carteira?status=sem_caso");
    expect(storageMock.listarCasosDeCobranca).not.toHaveBeenCalled();
    expect(storageMock.clientesParaAbrirCaso).toHaveBeenCalledWith(42, 0, expect.any(Number));

    vi.clearAllMocks();
    await json("GET", "/api/cobranca/carteira?status=negativado,acordo_ativo&carteira=ex_cliente&quadrante=c3");
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(
      42,
      { status: ["negativado", "acordo_ativo"], carteira: "ex_cliente", quadrante: "C3" },
      { pagina: 1, porPagina: 50 },
    );
    expect(storageMock.clientesParaAbrirCaso).not.toHaveBeenCalled();
  });

  it("filtro de saude entra em memoria sobre isp_score, nos dois segmentos", async () => {
    sessao = ADMIN;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria, { ...clienteMaria, id: 2, cpfCnpj: "98765432100", ispScore: 200 }]);
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [linhaCaso(), linhaCaso({ id: 10, cliente: { ...linhaCaso().cliente, id: 2, cpfCnpj: "98765432100" } })], total: 2 });
    storageMock.clientesParaAbrirCaso.mockResolvedValueOnce([
      { customerId: 2, nome: "Joao", cpfCnpj: "98765432100", statusErp: "cancelled", carteira: "ex_cliente", dividaAtual: 900, diasAtraso: 200, faturasAbertas: 4, contractStartDate: null },
    ]);
    const res = await json("GET", "/api/cobranca/carteira?saude=critica");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.itens.map((i: any) => i.customerId)).toEqual([2, 2]);
    expect(body.total).toBe(2);
  });

  it("400 para quadrante e status fora do vocabulario", async () => {
    sessao = ADMIN;
    expect((await json("GET", "/api/cobranca/carteira?quadrante=D9")).status).toBe(400);
    const res = await json("GET", "/api/cobranca/carteira?status=inventado");
    expect(res.status).toBe(400);
    expect((await res.json()).errors.status[0]).toContain("inventado");
    expect(storageMock.listarCasosDeCobranca).not.toHaveBeenCalled();
  });
});

/* ── Cliente 360 ─────────────────────────────────────────────────────── */

describe("GET /api/cobranca/clientes/:customerId/360", () => {
  it("404 para cliente que nao e do provedor da sessao", async () => {
    sessao = ADMIN;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([]);
    const res = await json("GET", "/api/cobranca/clientes/1/360");
    expect(res.status).toBe(404);
    expect(storageMock.getCustomersByProvider).toHaveBeenCalledWith(42);
    expect(storageMock.listarEventosDoCliente).not.toHaveBeenCalled();
  });

  it("monta a ficha so com o que existe: documento completo aqui, nome do usuario nos eventos, nada fabricado", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({
      linhas: [linhaCaso(), linhaCaso({ id: 3, status: "baixado", encerradoEm: new Date("2025-01-01T00:00:00Z") })],
      total: 2,
    });
    storageMock.listarEventosDoCliente.mockResolvedValueOnce([
      { id: 1, casoId: 9, customerId: 1, userId: 7, tipo: "contato", canal: "telefone", resultado: "nao_atendeu", notas: null, metadata: null, ocorridoEm: new Date() },
      { id: 2, casoId: 9, customerId: 1, userId: null, tipo: "etapa_mudou", canal: "sistema", resultado: null, notas: null, metadata: {}, ocorridoEm: new Date() },
    ]);
    storageMock.getUsersByProvider.mockResolvedValueOnce(equipe);
    storageMock.getEquipmentByCustomer.mockResolvedValueOnce([
      { id: 4, type: "ONU", brand: "Huawei", model: "HG8145", serialNumber: "ABC", mac: null, assetTag: null, status: "em_comodato", value: "290.00", inRecoveryProcess: false },
    ]);
    storageMock.getRecoveryCases.mockResolvedValueOnce([
      { id: 50, customerId: 1, status: "pre_recuperacao", priority: "alta", terminationDate: new Date(), deadlineAt: new Date(), equipmentType: "ONU", equipmentBrand: null, equipmentModel: null, equipmentSerialNumber: "ABC" },
      { id: 51, customerId: 2, status: "pre_recuperacao", priority: "alta", terminationDate: new Date(), deadlineAt: new Date(), equipmentType: "ONU", equipmentBrand: null, equipmentModel: null, equipmentSerialNumber: "ZZZ" },
    ]);
    storageMock.listarNegociacoesDoCaso.mockResolvedValue([]);

    const res = await json("GET", "/api/cobranca/clientes/1/360");
    const body = await res.json();
    expect(res.status).toBe(200);

    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, { status: "todos", busca: "12345678901" }, { pagina: 1, porPagina: 200 });
    expect(storageMock.listarEventosDoCliente).toHaveBeenCalledWith(42, 1);
    expect(storageMock.getEquipmentByCustomer).toHaveBeenCalledWith(1, 42);
    expect(storageMock.getRecoveryCases).toHaveBeenCalledWith(42);
    expect(storageMock.listarNegociacoesDoCaso).toHaveBeenCalledWith(42, 9);
    expect(storageMock.listarNegociacoesDoCaso).toHaveBeenCalledWith(42, 3);

    expect(body.cliente).toMatchObject({
      id: 1, documento: "12345678901", documentoMascarado: "123.456.***-01", whatsapp: "5531999990000",
      endereco: "Rua A, 10", plano: null, carteira: "ativo", dividaAtual: 400, diasAtraso: 45, ispScore: 720, riskTier: "low",
    });
    expect(body.dna).toMatchObject({ quadrante: "B3", abordagem: "cuidado", tom: "cuidado", historicoInsuficiente: true });
    expect(body.regua.etapa.id).toBe("negociacao_recuperacao");
    expect(body.caso.id).toBe(9);
    expect(body.casosAnteriores.map((c: any) => c.id)).toEqual([3]);
    expect(body.eventos[0].usuarioNome).toBe("Ana");
    expect(body.eventos[1].usuarioNome).toBeNull();
    expect(body.equipamentos[0]).toMatchObject({ id: 4, tipo: "ONU", serie: "ABC", valor: 290 });
    expect(body.recuperacao.map((r: any) => r.id)).toEqual([50]);
    expect(body.divida.atualizado.total).toBeGreaterThan(400);

    // o que a base nao tem NAO vai como zero: a chave nao existe
    for (const chave of ["nps", "csat", "ltv", "propensao", "health", "scores", "faturas"]) {
      expect(body).not.toHaveProperty(chave);
      expect(body.cliente).not.toHaveProperty(chave);
    }
    expect(JSON.stringify(body)).not.toContain("hash-secreto");
  });

  it("o sinal do bureau sai como contagem e data — nunca o id ou o nome de outro provedor", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
    storageMock.listarNegociacoesDoCaso.mockResolvedValue([]);
    const agora = Date.now();
    storageMock.getRecentConsultationsForDocument.mockResolvedValueOnce([
      { id: 1, providerId: 42, createdAt: new Date(agora - 2 * 86_400_000) },            // o proprio: nao conta
      { id: 2, providerId: 77, createdAt: new Date(agora - 3 * 86_400_000) },            // outro, 3 dias
      { id: 3, providerId: 77, createdAt: new Date(agora - 40 * 86_400_000) },           // outro, 40 dias
      { id: 4, providerId: 91, createdAt: new Date(agora - 80 * 86_400_000) },           // terceiro, 80 dias
    ]);
    storageMock.getAlertsByCustomer.mockResolvedValueOnce([
      { id: 5, providerId: 42, customerId: 1, type: "defaulter_consulted", severity: "high", status: "open", resolved: false, createdAt: new Date(agora - 86_400_000), daysOverdue: 45, overdueAmount: "400.00", equipmentNotReturned: true, message: "Consultado por Provedor Vizinho Ltda", consultingProviderName: "Provedor Vizinho Ltda", consultingProviderId: 77 },
      { id: 6, providerId: 99, customerId: 1, type: "defaulter_consulted", severity: "high", status: "open", resolved: false, createdAt: new Date(), message: "de outro tenant" },
    ]);

    const res = await json("GET", "/api/cobranca/clientes/1/360");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.getRecentConsultationsForDocument).toHaveBeenCalledWith("12345678901", 90);
    expect(storageMock.getAlertsByCustomer).toHaveBeenCalledWith(1);
    expect(body.rede).toMatchObject({ consultasOutros90d: 3, consultasOutros30d: 1, provedoresDistintos90d: 2 });
    expect(body.rede.ultimaConsultaEm.slice(0, 10)).toBe(new Date(agora - 3 * 86_400_000).toISOString().slice(0, 10));
    expect(body.alertas).toHaveLength(1);
    expect(body.alertas[0]).toMatchObject({ id: 5, tipo: "defaulter_consulted", severidade: "high", resolvido: false, diasAtraso: 45, valorEmAberto: 400, equipamentoNaoDevolvido: true });
    const texto = JSON.stringify(body);
    expect(texto).not.toContain("Provedor Vizinho");
    expect(texto).not.toContain("consultingProvider");
    expect(texto).not.toContain("\"77\"");
  });

  it("a ficha abre mesmo se o bureau falhar: rede zerada, alertas vazios", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
    storageMock.listarNegociacoesDoCaso.mockResolvedValue([]);
    storageMock.getRecentConsultationsForDocument.mockRejectedValueOnce(new Error("indice fora"));
    storageMock.getAlertsByCustomer.mockRejectedValueOnce(new Error("indice fora"));
    const res = await json("GET", "/api/cobranca/clientes/1/360");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rede).toMatchObject({ consultasOutros90d: 0, consultasOutros30d: 0, provedoresDistintos90d: 0, ultimaConsultaEm: null });
    expect(body.alertas).toEqual([]);
  });
});

describe("GET /api/cobranca/clientes/:customerId/360/ao-vivo", () => {
  it("401 sem sessao e 404 para cliente de outro provedor — o ERP nunca e chamado", async () => {
    expect((await json("GET", "/api/cobranca/clientes/1/360/ao-vivo")).status).toBe(401);
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([]);
    expect((await json("GET", "/api/cobranca/clientes/1/360/ao-vivo")).status).toBe(404);
    expect(snapshotMock.snapshotAoVivoDoCliente).not.toHaveBeenCalled();
  });

  it("chama o snapshot com o provedor da sessao e o documento do cliente; ?forcar=1 fura o cache", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValue([clienteMaria]);
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce({
      ok: true, erpSource: "sgp", encontrado: true, erro: null, latenciaMs: 812, lidoEm: "2026-09-05T12:00:00.000Z", doCache: false,
      cliente: { nome: "Maria", plano: "Fibra 300", statusContrato: "active", motivoCorte: null, cortadoEm: null, contractStartDate: "2023-05-10", dividaAtual: 400, diasAtraso: 45, faturasAbertas: 2, telefone: null, email: null, equipamentos: [{ tipo: "ONU", marca: "Huawei", modelo: "HG8145V5", serie: "HWTC1", mac: "A1B2C3D4E5F6", valor: 290, emRecuperacao: false }] },
    });
    const res = await json("GET", "/api/cobranca/clientes/1/360/ao-vivo");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(snapshotMock.snapshotAoVivoDoCliente).toHaveBeenCalledWith(42, "12345678901", { forcar: false });
    expect(body.cliente.plano).toBe("Fibra 300");
    expect(body.cliente.equipamentos[0].mac).toBe("A1B2C3D4E5F6");

    await json("GET", "/api/cobranca/clientes/1/360/ao-vivo?forcar=1");
    expect(snapshotMock.snapshotAoVivoDoCliente).toHaveBeenLastCalledWith(42, "12345678901", { forcar: true });
  });

  it("ERP sem integracao nao e erro HTTP: 200 com ok=false e o motivo", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
    const res = await json("GET", "/api/cobranca/clientes/1/360/ao-vivo");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.erro).toBe("Sem integração");
  });
});

/* ── Abrir caso ──────────────────────────────────────────────────────── */

describe("POST /api/cobranca/casos", () => {
  it("422 para cliente sem divida vencida — a regua da fase 1 anda sobre dias de atraso", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([{ ...clienteMaria, maxDaysOverdue: 0, totalOverdueAmount: "90.00" }]);
    const res = await json("POST", "/api/cobranca/casos", { customerId: 1 });
    expect(res.status).toBe(422);
    expect(storageMock.abrirCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("422 para divida prescrita", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([{ ...clienteMaria, maxDaysOverdue: 1900 }]);
    const res = await json("POST", "/api/cobranca/casos", { customerId: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).message).toMatch(/prescrita/i);
  });

  it("409 quando o cliente ja tem caso vivo", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
    storageMock.casoAbertoDoCliente.mockResolvedValueOnce({ id: 33 });
    const res = await json("POST", "/api/cobranca/casos", { customerId: 1 });
    expect(res.status).toBe(409);
    expect((await res.json()).casoId).toBe(33);
    expect(storageMock.casoAbertoDoCliente).toHaveBeenCalledWith(42, 1);
  });

  it("400 para proximo contato no passado, antes de qualquer leitura", async () => {
    sessao = OPERADOR;
    const res = await json("POST", "/api/cobranca/casos", { customerId: 1, proximoContatoEm: emDias(-1).toISOString() });
    expect(res.status).toBe(400);
    expect((await res.json()).errors.proximoContatoEm[0]).toMatch(/ja passou/);
    expect(storageMock.getCustomersByProvider).not.toHaveBeenCalled();
    expect(storageMock.abrirCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("operador nao abre caso para OUTRO responsavel; para si mesmo ou na fila geral pode", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValue([clienteMaria]);
    storageMock.getUsersByProvider.mockResolvedValue(equipe);
    const negado = await json("POST", "/api/cobranca/casos", { customerId: 1, responsavelUserId: 7 });
    expect(negado.status).toBe(403);
    expect(storageMock.abrirCasoDeCobranca).not.toHaveBeenCalled();

    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ id: 77, responsavelUserId: 8, responsavelNome: "Beto" }));
    const proprio = await json("POST", "/api/cobranca/casos", { customerId: 1, responsavelUserId: 8 });
    expect(proprio.status).toBe(201);
    expect(storageMock.abrirCasoDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({ customerId: 1, responsavelUserId: 8 }));

    // `null` explicito sem caso ainda = fila geral: nao tira o caso de ninguem.
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ id: 78 }));
    const geral = await json("POST", "/api/cobranca/casos", { customerId: 1, responsavelUserId: null });
    expect(geral.status).toBe(201);
    expect(storageMock.abrirCasoDeCobranca).toHaveBeenLastCalledWith(42, expect.objectContaining({ customerId: 1, responsavelUserId: null }));
  });

  it("abre com a foto do momento: carteira, etapa da regua, quadrante e tom calculados", async () => {
    sessao = ADMIN;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ id: 77 }));
    const res = await json("POST", "/api/cobranca/casos", { customerId: 1, prioridade: "alta" });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(storageMock.abrirCasoDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({
      customerId: 1, carteira: "ativo", diasAtrasoAbertura: 45, valorAbertura: 400,
      etapaAtual: "negociacao_recuperacao", quadranteDna: "B3", tom: "cuidado", prioridade: "alta", responsavelUserId: null,
    }));
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({ casoId: 77, userId: 7, tipo: "nota" }));
    expect(body.id).toBe(77);
    expect(body.cliente.cpfCnpj).toBe("123.456.***-01");
  });
});

/* ── PATCH caso: RBAC e maquina de estados ───────────────────────────── */

describe("PATCH /api/cobranca/casos/:id", () => {
  it("404 para caso de outro provedor", async () => {
    sessao = ADMIN;
    const res = await json("PATCH", "/api/cobranca/casos/9", { prioridade: "alta" });
    expect(res.status).toBe(404);
    expect(storageMock.obterCasoDeCobranca).toHaveBeenCalledWith(42, 9);
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("400 para proximo contato no passado — antes de ler o caso", async () => {
    sessao = ADMIN;
    const res = await json("PATCH", "/api/cobranca/casos/9", { proximoContatoEm: emDias(-2).toISOString() });
    expect(res.status).toBe(400);
    expect((await res.json()).errors.proximoContatoEm[0]).toMatch(/ja passou/);
    expect(storageMock.obterCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("operador nao atribui responsavel a outro; pega para si e devolve a fila o que e dele", async () => {
    sessao = OPERADOR;
    storageMock.getUsersByProvider.mockResolvedValue(equipe);
    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso());
    expect((await json("PATCH", "/api/cobranca/casos/9", { responsavelUserId: 7 })).status).toBe(403);
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();

    expect((await json("PATCH", "/api/cobranca/casos/9", { responsavelUserId: 8 })).status).toBe(200);
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 9, { responsavelUserId: 8 }, 8);

    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso({ responsavelUserId: 8, responsavelNome: "Beto" }));
    expect((await json("PATCH", "/api/cobranca/casos/9", { responsavelUserId: null })).status).toBe(200);
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenLastCalledWith(42, 9, { responsavelUserId: null }, 8);
  });

  it("admin atribui a qualquer um da equipe, mas nao a quem nao e do provedor", async () => {
    sessao = ADMIN;
    storageMock.getUsersByProvider.mockResolvedValue(equipe);
    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso());
    expect((await json("PATCH", "/api/cobranca/casos/9", { responsavelUserId: 8 })).status).toBe(200);
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 9, { responsavelUserId: 8 }, 7);
    const estranho = await json("PATCH", "/api/cobranca/casos/9", { responsavelUserId: 999 });
    expect(estranho.status).toBe(400);
    expect((await estranho.json()).errors.responsavelUserId[0]).toMatch(/nao e usuario/);
  });

  it("409 com o motivo da maquina de estados", async () => {
    sessao = ADMIN;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ status: "pago" }));
    const fechado = await json("PATCH", "/api/cobranca/casos/9", { status: "aberto" });
    expect(fechado.status).toBe(409);
    expect((await fechado.json()).message).toBe(MOTIVO_CASO_FECHADO);

    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ status: "negativado" }));
    const negativado = await json("PATCH", "/api/cobranca/casos/9", { status: "aberto" });
    expect(negativado.status).toBe(409);
    expect((await negativado.json()).message).toBe(MOTIVO_NEGATIVADO_NAO_VOLTA);

    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    const repetido = await json("PATCH", "/api/cobranca/casos/9", { status: "aberto" });
    expect(repetido.status).toBe(409);
    expect((await repetido.json()).message).toMatch(/já está em/);

    // Cancelar caso ja fechado tambem e a maquina de estados quem recusa.
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ status: "pago" }));
    const cancelarFechado = await json("PATCH", "/api/cobranca/casos/9", { status: "cancelamento", motivo: "x" });
    expect(cancelarFechado.status).toBe(409);
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
    expect(storageMock.fecharCasoDeCobranca).not.toHaveBeenCalled();
    expect(storageMock.cancelarCaso).not.toHaveBeenCalled();
  });

  it("negociando e acordo_ativo nao entram pelo PATCH: nascem da negociacao", async () => {
    sessao = ADMIN;
    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso());
    const res = await json("PATCH", "/api/cobranca/casos/9", { status: "acordo_ativo" });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/negociacoes/);
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("negativar muda o status e grava o evento de negativacao com o usuario", async () => {
    sessao = ADMIN;
    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso());
    const res = await json("PATCH", "/api/cobranca/casos/9", { status: "negativado", motivo: "pre-aviso enviado em 01/08" });
    expect(res.status).toBe(200);
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 9, { status: "negativado" }, 7);
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({
      casoId: 9, userId: 7, tipo: "negativacao", notas: "pre-aviso enviado em 01/08",
    }));
    expect(storageMock.fecharCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("baixar fecha pelo storage, com motivo e usuario", async () => {
    sessao = ADMIN;
    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso());
    const res = await json("PATCH", "/api/cobranca/casos/9", { status: "baixado", motivo: "valor irrisorio" });
    expect(res.status).toBe(200);
    expect(storageMock.fecharCasoDeCobranca).toHaveBeenCalledWith(42, 9, "baixado", "valor irrisorio", 7);
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("operador nao baixa, nao encerra e nao registra cancelamento — a frase diz o verbo", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso());
    const baixar = await json("PATCH", "/api/cobranca/casos/9", { status: "baixado", motivo: "x" });
    expect(baixar.status).toBe(403);
    expect((await baixar.json()).message).toBe("Apenas administradores podem baixar um caso de cobranca");
    const encerrar = await json("PATCH", "/api/cobranca/casos/9", { status: "encerrado" });
    expect(encerrar.status).toBe(403);
    expect((await encerrar.json()).message).toBe("Apenas administradores podem encerrar um caso de cobranca");
    const cancelar = await json("PATCH", "/api/cobranca/casos/9", { status: "cancelamento", motivo: "pediu cancelamento" });
    expect(cancelar.status).toBe(403);
    expect((await cancelar.json()).message).toBe("Apenas administradores podem registrar o cancelamento de um caso");
    expect(storageMock.fecharCasoDeCobranca).not.toHaveBeenCalled();
    expect(storageMock.cancelarCaso).not.toHaveBeenCalled();
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("operador fecha como pago, leva o caso a em_contato e o traz de volta a aberto sem passar pela negociacao", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso());
    const pago = await json("PATCH", "/api/cobranca/casos/9", { status: "pago" });
    expect(pago.status).toBe(200);
    expect(storageMock.fecharCasoDeCobranca).toHaveBeenCalledWith(42, 9, "pago", null, 8);

    const contato = await json("PATCH", "/api/cobranca/casos/9", { status: "em_contato" });
    expect(contato.status).toBe(200);
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 9, { status: "em_contato" }, 8);
    // em_contato nao tem evento proprio: o contato registrado e a historia.
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();

    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso({ status: "em_contato" }));
    const volta = await json("PATCH", "/api/cobranca/casos/9", { status: "aberto" });
    expect(volta.status).toBe(200);
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenLastCalledWith(42, 9, { status: "aberto" }, 8);
  });

  it("cancelamento exige motivo e vai por cancelarCaso — nunca por fecharCaso nem por evento da rota", async () => {
    sessao = ADMIN;
    const semMotivo = await json("PATCH", "/api/cobranca/casos/9", { status: "cancelamento" });
    expect(semMotivo.status).toBe(400);
    expect((await semMotivo.json()).errors.motivo[0]).toMatch(/motivo/i);
    expect(storageMock.obterCasoDeCobranca).not.toHaveBeenCalled();

    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso({ status: "em_contato" }));
    const res = await json("PATCH", "/api/cobranca/casos/9", { status: "cancelamento", motivo: "cliente pediu cancelamento" });
    expect(res.status).toBe(200);
    expect(storageMock.cancelarCaso).toHaveBeenCalledWith(42, 9, "cliente pediu cancelamento", 7);
    expect(storageMock.fecharCasoDeCobranca).not.toHaveBeenCalled();
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
    // O contrato que a rota conta: cancelamento e status terminal da maquina de estados.
    expect(STATUS_DE_CASO).toContain("cancelamento");
    expect(casoFechado("cancelamento")).toBe(true);
  });
});

/* ── Eventos ─────────────────────────────────────────────────────────── */

describe("POST /api/cobranca/casos/:id/eventos", () => {
  it("recusa os tipos que o sistema grava, e contato sem canal", async () => {
    sessao = OPERADOR;
    const sistema = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "etapa_mudou" });
    expect(sistema.status).toBe(400);
    expect((await sistema.json()).errors.tipo[0]).toMatch(/sistema/);
    const semCanal = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "contato", resultado: "falou" });
    expect(semCanal.status).toBe(400);
    expect((await semCanal.json()).errors.canal).toBeDefined();
    const promessaSemData = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "promessa", canal: "telefone" });
    expect((await promessaSemData.json()).errors.promessaPara).toBeDefined();
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });

  it("400 para promessa e para proximo contato no passado", async () => {
    sessao = OPERADOR;
    const promessa = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "promessa", canal: "telefone", promessaPara: daquiADias(-1) });
    expect(promessa.status).toBe(400);
    expect((await promessa.json()).errors.promessaPara[0]).toMatch(/ja passou/);
    const contato = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "contato", canal: "telefone", proximoContatoEm: emDias(-1).toISOString() });
    expect(contato.status).toBe(400);
    expect((await contato.json()).errors.proximoContatoEm[0]).toMatch(/ja passou/);
    expect(storageMock.obterCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("409 em caso fechado", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ status: "encerrado" }));
    const res = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "nota", notas: "x" });
    expect(res.status).toBe(409);
  });

  it("registra o contato com o usuario da sessao e agenda o proximo toque na mesma chamada", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    const proximo = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await json("POST", "/api/cobranca/casos/9/eventos", {
      tipo: "contato", canal: "whatsapp", resultado: "nao_atendeu", notas: "caixa cheia", proximoContatoEm: proximo,
    });
    expect(res.status).toBe(201);
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({
      casoId: 9, userId: 8, tipo: "contato", canal: "whatsapp", resultado: "nao_atendeu", notas: "caixa cheia",
    }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 9, { proximoContatoEm: new Date(proximo) }, 8);
  });

  it("GET lista os eventos do caso com o nome de quem registrou", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    storageMock.listarEventosDoCaso.mockResolvedValueOnce([{ id: 1, casoId: 9, userId: 8, tipo: "nota", ocorridoEm: new Date() }]);
    storageMock.getUsersByProvider.mockResolvedValueOnce(equipe);
    const res = await json("GET", "/api/cobranca/casos/9/eventos");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.listarEventosDoCaso).toHaveBeenCalledWith(42, 9);
    expect(body[0].usuarioNome).toBe("Beto");
  });
});

/* ── Negociacoes ─────────────────────────────────────────────────────── */

describe("POST /api/cobranca/casos/:id/negociacoes", () => {
  it("422 com as violacoes da politica, nas frases dela", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValue(linhaCaso());
    const desconto = await json("POST", "/api/cobranca/casos/9/negociacoes", { tipo: "quitacao_desconto", valorNegociado: 200 });
    expect(desconto.status).toBe(422);
    expect((await desconto.json()).violacoes).toEqual(["Desconto de 50% excede o teto de 20% da política."]);

    const parcelas = await json("POST", "/api/cobranca/casos/9/negociacoes", {
      tipo: "parcelamento", valorNegociado: 400, entrada: 80, parcelas: 12, primeiroVencimento: daquiADias(10),
    });
    expect(parcelas.status).toBe(422);
    expect((await parcelas.json()).violacoes).toEqual(["Máximo de 6 parcelas pela política; pedido: 12."]);
    expect(storageMock.criarNegociacao).not.toHaveBeenCalled();
  });

  it("409 quando a divida que a tela viu nao e mais a do servidor", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ valorAtual: 350 }));
    const res = await json("POST", "/api/cobranca/casos/9/negociacoes", { tipo: "quitacao_desconto", valorOriginal: 400, valorNegociado: 350 });
    expect(res.status).toBe(409);
    expect((await res.json()).valorOriginal).toBe(350);
  });

  it("409 NEGOCIACAO_VIVA quando o storage recusa a segunda proposta — a classe real, com o caminho na frase", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ status: "negociando" }));
    storageMock.criarNegociacao.mockRejectedValueOnce(new ErroDeCobranca("NEGOCIACAO_VIVA", "Caso 9 ja tem negociacao #3 viva"));
    const res = await json("POST", "/api/cobranca/casos/9/negociacoes", { tipo: "quitacao_desconto", valorNegociado: 340 });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("NEGOCIACAO_VIVA");
    expect(body.message).toMatch(/negociacao viva/);
    expect(body.message).toMatch(/negociacoes\/:id/);
  });

  it("parcelamento gera as parcelas em centavos exatos e grava na mesma transacao do storage", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    storageMock.criarNegociacao.mockImplementationOnce(async (_p: number, dados: any, parcelas: any[]) => ({
      id: 3, providerId: 42, casoId: 9, customerId: 1, tipo: dados.tipo, valorOriginal: "400.00", valorNegociado: "400.00",
      descontoPct: "0.00", entrada: "80.00", parcelas: parcelas.length, valorParcela: "106.66", primeiroVencimento: parcelas[0].vencimento,
      status: "proposta", criadoPorUserId: 8, aceitaEm: null, quebradaEm: null, createdAt: new Date(), updatedAt: new Date(),
      parcelamento: parcelas.map((p, i) => ({ id: 10 + i, providerId: 42, negociacaoId: 3, ...p, valor: p.valor.toFixed(2), pagoEm: null, valorPago: null, status: "pendente" })),
    }));
    const vencimento = daquiADias(10);
    const res = await json("POST", "/api/cobranca/casos/9/negociacoes", {
      tipo: "parcelamento", valorOriginal: 400, valorNegociado: 400, entrada: 80, parcelas: 3, primeiroVencimento: vencimento,
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    const [, dados, parcelas] = storageMock.criarNegociacao.mock.calls[0] as any[];
    expect(storageMock.criarNegociacao.mock.calls[0][0]).toBe(42);
    expect(dados).toMatchObject({ casoId: 9, tipo: "parcelamento", valorOriginal: 400, valorNegociado: 400, entrada: 80, criadoPorUserId: 8, aceita: false, primeiroVencimento: vencimento });
    expect(parcelas.map((p: any) => p.valor)).toEqual([106.66, 106.66, 106.68]);
    expect(body.parcelamento).toHaveLength(3);
    expect(body.valorNegociado).toBe(400);
  });

  it("quitacao e uma parcela so, vencendo hoje quando a tela nao manda data", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    storageMock.criarNegociacao.mockImplementationOnce(async (_p: number, dados: any, parcelas: any[]) => ({
      id: 4, providerId: 42, casoId: 9, customerId: 1, tipo: dados.tipo, valorOriginal: "400.00", valorNegociado: "340.00",
      descontoPct: "15.00", entrada: "0.00", parcelas: 1, valorParcela: "340.00", primeiroVencimento: parcelas[0].vencimento,
      status: "aceita", criadoPorUserId: 8, aceitaEm: new Date(), quebradaEm: null, createdAt: new Date(), updatedAt: new Date(), parcelamento: [],
    }));
    const res = await json("POST", "/api/cobranca/casos/9/negociacoes", { tipo: "quitacao_desconto", valorNegociado: 340, aceita: true });
    expect(res.status).toBe(201);
    const [, dados, parcelas] = storageMock.criarNegociacao.mock.calls[0] as any[];
    expect(dados).toMatchObject({ descontoPct: 15, entrada: 0, aceita: true, primeiroVencimento: daquiADias(0) });
    expect(parcelas).toEqual([{ numero: 1, valor: 340, vencimento: daquiADias(0) }]);
  });
});

describe("PATCH /api/cobranca/negociacoes/:id", () => {
  it("409 com o motivo da maquina de estados; cumprida so pela ultima parcela", async () => {
    sessao = OPERADOR;
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, casoId: 9, status: "quebrada" });
    const encerrada = await json("PATCH", "/api/cobranca/negociacoes/3", { casoId: 9, status: "aceita" });
    expect(encerrada.status).toBe(409);
    expect((await encerrada.json()).message).toBe(MOTIVO_NEGOCIACAO_ENCERRADA);

    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, casoId: 9, status: "proposta" });
    const pulo = await json("PATCH", "/api/cobranca/negociacoes/3", { casoId: 9, status: "ativa" });
    expect(pulo.status).toBe(409);
    expect((await pulo.json()).message).toMatch(/não se vai/);

    const cumprida = await json("PATCH", "/api/cobranca/negociacoes/3", { casoId: 9, status: "cumprida" });
    expect(cumprida.status).toBe(409);
    expect(storageMock.atualizarStatusDaNegociacao).not.toHaveBeenCalled();
    expect(storageMock.obterNegociacao).toHaveBeenCalledWith(42, 3);
  });

  it("acha a negociacao pelo id e pelo provedor; um casoId que nao bate e 404, nao correcao silenciosa", async () => {
    sessao = OPERADOR;
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, casoId: 9, status: "proposta" });
    const outroCaso = await json("PATCH", "/api/cobranca/negociacoes/3", { casoId: 10, status: "aceita" });
    expect(outroCaso.status).toBe(404);
    expect(storageMock.atualizarStatusDaNegociacao).not.toHaveBeenCalled();
    expect(storageMock.listarNegociacoesDoCaso).not.toHaveBeenCalled();
  });

  it("aceitar passa pelo storage com o usuario e devolve o caso ja em acordo ativo — sem precisar do casoId no corpo", async () => {
    sessao = OPERADOR;
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, casoId: 9, status: "proposta" });
    storageMock.atualizarStatusDaNegociacao.mockResolvedValueOnce({
      id: 3, casoId: 9, customerId: 1, tipo: "parcelamento", valorOriginal: "400.00", valorNegociado: "400.00", descontoPct: "0.00",
      entrada: "80.00", parcelas: 3, valorParcela: "106.66", primeiroVencimento: "2026-10-01", status: "aceita", criadoPorUserId: 8,
      aceitaEm: new Date(), quebradaEm: null, createdAt: new Date(), updatedAt: new Date(),
    });
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ status: "acordo_ativo" }));
    const res = await json("PATCH", "/api/cobranca/negociacoes/3", { status: "aceita" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.atualizarStatusDaNegociacao).toHaveBeenCalledWith(42, 3, "aceita", 8);
    expect(storageMock.obterCasoDeCobranca).toHaveBeenCalledWith(42, 9);
    expect(body.negociacao.status).toBe("aceita");
    expect(body.caso.status).toBe("acordo_ativo");
  });
});

/* ── Parcelas ────────────────────────────────────────────────────────── */

describe("POST /api/cobranca/parcelas/:id/pagar", () => {
  it("409 para parcela ja paga ou cancelada; 404 quando o negociacaoId do corpo nao bate", async () => {
    sessao = OPERADOR;
    storageMock.obterParcela.mockResolvedValueOnce({ id: 12, negociacaoId: 3, numero: 3, status: "paga" });
    const paga = await json("POST", "/api/cobranca/parcelas/12/pagar", { negociacaoId: 3, valorPago: 106.68 });
    expect(paga.status).toBe(409);
    storageMock.obterParcela.mockResolvedValueOnce({ id: 12, negociacaoId: 3, numero: 3, status: "cancelada" });
    const cancelada = await json("POST", "/api/cobranca/parcelas/12/pagar", { negociacaoId: 3, valorPago: 106.68 });
    expect(cancelada.status).toBe(409);
    storageMock.obterParcela.mockResolvedValueOnce({ id: 12, negociacaoId: 3, numero: 3, status: "pendente" });
    const outra = await json("POST", "/api/cobranca/parcelas/12/pagar", { negociacaoId: 4, valorPago: 106.68 });
    expect(outra.status).toBe(404);
    expect(storageMock.obterParcela).toHaveBeenCalledWith(42, 12);
    expect(storageMock.marcarParcelaPaga).not.toHaveBeenCalled();
  });

  it("valor zero ou negativo nem chega ao storage", async () => {
    sessao = OPERADOR;
    expect((await json("POST", "/api/cobranca/parcelas/12/pagar", { valorPago: 0 })).status).toBe(400);
    expect((await json("POST", "/api/cobranca/parcelas/12/pagar", { valorPago: -5 })).status).toBe(400);
    expect(storageMock.obterParcela).not.toHaveBeenCalled();
  });

  it("409 NEGOCIACAO_NAO_ACEITA: parcela de proposta nao se paga — o aceite e um ato registrado", async () => {
    sessao = OPERADOR;
    storageMock.obterParcela.mockResolvedValueOnce({ id: 12, negociacaoId: 3, numero: 1, status: "pendente" });
    storageMock.marcarParcelaPaga.mockRejectedValueOnce(new ErroDeCobranca("NEGOCIACAO_NAO_ACEITA", "Negociacao #3 ainda e proposta"));
    const res = await json("POST", "/api/cobranca/parcelas/12/pagar", { valorPago: 100 });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("NEGOCIACAO_NAO_ACEITA");
    expect(body.message).toMatch(/status=aceita/);
    expect(storageMock.marcarParcelaPaga).toHaveBeenCalledWith(42, 12, 100, expect.any(Date), 8);
  });

  it("outros codigos do storage tambem sao 409 com a mensagem dele, nunca 500", async () => {
    sessao = OPERADOR;
    storageMock.obterParcela.mockResolvedValueOnce({ id: 12, negociacaoId: 3, numero: 1, status: "pendente" });
    storageMock.marcarParcelaPaga.mockRejectedValueOnce(new ErroDeCobranca("NEGOCIACAO_ENCERRADA", "Negociacao #3 esta quebrada e nao recebe pagamento"));
    const res = await json("POST", "/api/cobranca/parcelas/12/pagar", { valorPago: 100 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "Negociacao #3 esta quebrada e nao recebe pagamento", code: "NEGOCIACAO_ENCERRADA" });
  });

  it("pagamento parcial: a parcela volta pendente com o acumulado, o acordo segue e `parcial` diz isso", async () => {
    sessao = OPERADOR;
    const negociacao = { id: 3, casoId: 9, customerId: 1, tipo: "parcelamento", valorOriginal: "400.00", valorNegociado: "400.00", descontoPct: "0.00", entrada: "80.00", parcelas: 3, valorParcela: "106.66", primeiroVencimento: "2026-10-01", status: "ativa", criadoPorUserId: 8, aceitaEm: new Date(), quebradaEm: null, createdAt: new Date(), updatedAt: new Date() };
    const parcelaParcial = { id: 12, providerId: 42, negociacaoId: 3, numero: 1, valor: "106.66", vencimento: "2026-10-01", pagoEm: null, valorPago: "50.00", status: "pendente" };
    storageMock.obterParcela.mockResolvedValueOnce({ id: 12, negociacaoId: 3, numero: 1, status: "pendente", valorPago: null });
    storageMock.marcarParcelaPaga.mockResolvedValueOnce({ parcela: parcelaParcial, negociacao, acordoCumprido: false, parcial: true });
    storageMock.listarParcelasDaNegociacao.mockResolvedValueOnce([parcelaParcial]);
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ status: "acordo_ativo" }));

    const res = await json("POST", "/api/cobranca/parcelas/12/pagar", { valorPago: 50 });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.marcarParcelaPaga).toHaveBeenCalledWith(42, 12, 50, expect.any(Date), 8);
    expect(storageMock.listarParcelasDaNegociacao).toHaveBeenCalledWith(42, 3);
    expect(body).toMatchObject({ acordoCumprido: false, parcial: true });
    expect(body.parcela).toMatchObject({ id: 12, status: "pendente", valorPago: 50 });
    expect(body.caso.status).toBe("acordo_ativo");
  });

  it("pagar a ultima parcela cumpre o acordo e o caso volta fechado como pago", async () => {
    sessao = OPERADOR;
    const parcelaPaga = { id: 12, providerId: 42, negociacaoId: 3, numero: 3, valor: "106.68", vencimento: "2026-12-01", pagoEm: new Date(), valorPago: "106.68", status: "paga" };
    storageMock.obterParcela.mockResolvedValueOnce({ id: 12, negociacaoId: 3, numero: 3, status: "atrasada" });
    storageMock.listarParcelasDaNegociacao.mockResolvedValueOnce([parcelaPaga]);
    storageMock.marcarParcelaPaga.mockResolvedValueOnce({
      parcela: parcelaPaga,
      negociacao: { id: 3, casoId: 9, customerId: 1, tipo: "parcelamento", valorOriginal: "400.00", valorNegociado: "400.00", descontoPct: "0.00", entrada: "80.00", parcelas: 3, valorParcela: "106.66", primeiroVencimento: "2026-10-01", status: "cumprida", criadoPorUserId: 8, aceitaEm: new Date(), quebradaEm: null, createdAt: new Date(), updatedAt: new Date() },
      acordoCumprido: true,
      parcial: false,
    });
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ status: "pago", encerradoEm: new Date() }));

    const res = await json("POST", "/api/cobranca/parcelas/12/pagar", { negociacaoId: 3, valorPago: 106.68 });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.marcarParcelaPaga).toHaveBeenCalledWith(42, 12, 106.68, expect.any(Date), 8);
    expect(storageMock.obterCasoDeCobranca).toHaveBeenCalledWith(42, 9);
    expect(body.acordoCumprido).toBe(true);
    expect(body.parcial).toBe(false);
    expect(body.negociacao.status).toBe("cumprida");
    expect(body.caso.status).toBe("pago");
    expect(body.parcela).toMatchObject({ id: 12, valorPago: 106.68, status: "paga" });
  });
});

/* ── Fila ────────────────────────────────────────────────────────────── */

describe("GET /api/cobranca/fila", () => {
  afterEach(() => {
    storageMock.listarCasosDeCobranca.mockImplementation(LISTA_VAZIA);
  });

  it("responsavel=eu pede a fila do usuario da sessao; os indicadores cobrem o recorte INTEIRO (meus + fila geral), nao a pagina", async () => {
    sessao = OPERADOR;
    // A pagina que a tela lista tem UM caso; o recorte tem tres.
    storageMock.filaDeCobranca.mockResolvedValueOnce([linhaCaso()]);
    storageMock.listarCasosDeCobranca.mockImplementation(async (_p: number, filtros: any) => {
      if (filtros.responsavelUserId === 8) return { linhas: [linhaCaso({ id: 9, prioridade: "critica", proximoContatoEm: null, valorAtual: 400 })], total: 1 };
      if (filtros.responsavelUserId === null) {
        return {
          linhas: [
            linhaCaso({ id: 10, valorAtual: 150.5, proximoContatoEm: emDias(2) }),
            linhaCaso({ id: 11, valorAtual: 49.5, proximoContatoEm: emDias(-1) }),
          ],
          total: 2,
        };
      }
      throw new Error(`recorte inesperado: ${JSON.stringify(filtros)}`);
    });

    const res = await json("GET", "/api/cobranca/fila");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.filaDeCobranca).toHaveBeenCalledWith(42, { responsavelUserId: 8, hoje: expect.any(Date), limite: 100 });
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, { responsavelUserId: 8 }, { pagina: 1, porPagina: 200 });
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, { responsavelUserId: null }, { pagina: 1, porPagina: 200 });

    expect(body.itens).toHaveLength(1);
    expect(body.itens[0].cliente.cpfCnpj).toBe("123.456.***-01");
    expect(body.itens[0]).toMatchObject({ id: 9, quadrante: "B3", tomSugerido: "cuidado" });
    expect(body.itens[0].diretiva).toMatch(/Bom cliente/);
    expect(JSON.stringify(body)).not.toContain("12345678901");

    expect(body.total).toBe(3);
    // sem data + vencido = 2 para hoje; o de daqui a 2 dias nao
    expect(body.kpis).toEqual({ casos: 3, valor: 600, paraHoje: 2, criticos: 1 });
    expect(body.kpisMotivo).toBeNull();
    expect(body).toMatchObject({ escopo: "eu", limite: 100 });
  });

  it("responsavel=todos varre um recorte so; limite vai ate 500 e 501 e recusado", async () => {
    sessao = OPERADOR;
    await json("GET", "/api/cobranca/fila?responsavel=todos&limite=500");
    expect(storageMock.filaDeCobranca).toHaveBeenLastCalledWith(42, { responsavelUserId: undefined, hoje: expect.any(Date), limite: 500 });
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledTimes(1);
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, {}, { pagina: 1, porPagina: 200 });

    const demais = await json("GET", "/api/cobranca/fila?limite=501");
    expect(demais.status).toBe(400);
  });

  it("acima do teto de varredura os indicadores vem null com o motivo; o total continua exato", async () => {
    sessao = OPERADOR;
    const pagina = Array.from({ length: 200 }, (_, i) => linhaCaso({ id: 1000 + i }));
    storageMock.listarCasosDeCobranca.mockImplementation(async () => ({ linhas: pagina, total: 9000 }));
    const res = await json("GET", "/api/cobranca/fila?responsavel=todos");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(9000);
    expect(body.kpis).toBeNull();
    expect(body.kpisMotivo).toMatch(/nao sao calculados/);
  });
});

/* ── Kanban ──────────────────────────────────────────────────────────── */

describe("GET /api/cobranca/kanban", () => {
  afterEach(() => {
    storageMock.listarCasosDeCobranca.mockImplementation(LISTA_VAZIA);
  });

  const ORDEM_ESPERADA = ["aberto", "em_contato", "negociando", "acordo_ativo", "pago", "cancelamento", "negativado", "baixado", "encerrado"];

  it("uma coluna por status na ordem do operador; vivas com o count exato, fechadas so os ultimos 30 dias; os filtros vao ao storage", async () => {
    sessao = OPERADOR;
    const porStatus: Record<string, any> = {
      aberto: { linhas: [linhaCaso({ id: 1 }), linhaCaso({ id: 2 })], total: 2 },
      negociando: { linhas: [linhaCaso({ id: 3, status: "negociando" })], total: 1 },
      pago: { linhas: [linhaCaso({ id: 4, status: "pago", encerradoEm: emDias(-5) }), linhaCaso({ id: 5, status: "pago", encerradoEm: emDias(-60) })], total: 2 },
      cancelamento: { linhas: [linhaCaso({ id: 6, status: "cancelamento", encerradoEm: emDias(-1) })], total: 1 },
      encerrado: { linhas: [linhaCaso({ id: 7, status: "encerrado", encerradoEm: emDias(-90) })], total: 1 },
    };
    storageMock.listarCasosDeCobranca.mockImplementation(async (_p: number, filtros: any) => porStatus[filtros.status[0]] ?? { linhas: [], total: 0 });

    const res = await json("GET", "/api/cobranca/kanban?etapa=lembrete_atraso&responsavel=geral&carteira=ativo&busca=maria&porColuna=50");
    const body = await res.json();
    expect(res.status).toBe(200);

    expect(body.colunas.map((c: any) => c.status)).toEqual(ORDEM_ESPERADA);
    // paridade: todo status da maquina de estados tem coluna, e nenhuma coluna e inventada
    expect([...ORDEM_ESPERADA].sort()).toEqual([...STATUS_DE_CASO].sort());
    const coluna = (s: string) => body.colunas.find((c: any) => c.status === s);
    expect(coluna("aberto")).toMatchObject({ rotulo: "Aberto", fechada: false, total: 2, truncado: false });
    expect(coluna("aberto").casos.map((c: any) => c.id)).toEqual([1, 2]);
    expect(coluna("em_contato")).toMatchObject({ rotulo: "Em contato", fechada: false, total: 0, casos: [] });
    expect(coluna("negociando").total).toBe(1);
    // fechadas: so quem fechou nos 30 dias, o mais recente primeiro
    expect(coluna("pago")).toMatchObject({ fechada: true, total: 1, truncado: false });
    expect(coluna("pago").casos.map((c: any) => c.id)).toEqual([4]);
    expect(coluna("cancelamento")).toMatchObject({ rotulo: "Cancelamento", fechada: true, total: 1 });
    expect(coluna("encerrado")).toMatchObject({ fechada: true, total: 0, casos: [] });
    expect(coluna("negativado").fechada).toBe(false);
    expect(body.total).toBe(2 + 1 + 1 + 1);
    expect(body.porColuna).toBe(50);
    expect(typeof body.fechadosDesde).toBe("string");

    // vivas: uma pagina de `porColuna`; fechadas: varredura de 200 — ambas com os filtros da barra
    const filtrosDaBarra = { carteira: "ativo", etapa: "lembrete_atraso", busca: "maria", responsavelUserId: null };
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, { ...filtrosDaBarra, status: ["aberto"] }, { pagina: 1, porPagina: 50 });
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, { ...filtrosDaBarra, status: ["pago"] }, { pagina: 1, porPagina: 200 });
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledTimes(ORDEM_ESPERADA.length);

    // o card e a linha da fila: documento mascarado, selo da regua e tom de agora
    const card = coluna("aberto").casos[0];
    expect(card.cliente.cpfCnpj).toBe("123.456.***-01");
    expect(card.regua).toMatchObject({ etapa: "negociacao_recuperacao" });
    expect(card).toMatchObject({ quadrante: "B3", tomSugerido: "cuidado" });
    expect(JSON.stringify(body)).not.toContain("12345678901");
  });

  it("coluna viva acima de porColuna vem truncada com o total exato; responsavel=eu e o usuario da sessao", async () => {
    sessao = OPERADOR;
    storageMock.listarCasosDeCobranca.mockImplementation(async (_p: number, filtros: any) =>
      filtros.status[0] === "aberto" ? { linhas: [linhaCaso({ id: 1 }), linhaCaso({ id: 2 })], total: 7200 } : { linhas: [], total: 0 });
    const res = await json("GET", "/api/cobranca/kanban?responsavel=eu&porColuna=2");
    const body = await res.json();
    expect(res.status).toBe(200);
    const aberto = body.colunas.find((c: any) => c.status === "aberto");
    expect(aberto).toMatchObject({ total: 7200, truncado: true });
    expect(aberto.casos).toHaveLength(2);
    expect(body.total).toBe(7200);
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, { responsavelUserId: 8, status: ["aberto"] }, { pagina: 1, porPagina: 2 });
  });

  it("400 para etapa ou porColuna fora do vocabulario, sem tocar o storage", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/cobranca/kanban?etapa=inventada")).status).toBe(400);
    expect((await json("GET", "/api/cobranca/kanban?porColuna=201")).status).toBe(400);
    expect(storageMock.listarCasosDeCobranca).not.toHaveBeenCalled();
  });
});

/* ── Regua, DNA, equipe ──────────────────────────────────────────────── */

describe("GET /api/cobranca/regua e /dna", () => {
  it("a regua devolve as etapas resolvidas da politica, a pausa e as contagens; ex-cliente sem aviso de suspensao", async () => {
    sessao = OPERADOR;
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce({
      id: 1, providerId: 42, etapas: [{ id: "lembrete_atraso", responsavelUserId: 8 }], negociacao: POLITICA_PADRAO.negociacao,
      encargos: POLITICA_PADRAO.encargos, janelaContato: POLITICA_PADRAO.janelaContato, pausada: true, pausadaMotivo: "ferias coletivas", updatedAt: new Date(),
    });
    storageMock.contarCasosPorEtapa.mockResolvedValueOnce([{ etapa: "lembrete_atraso", carteira: "ativo", casos: 4, valor: 900 }]);
    storageMock.getUsersByProvider.mockResolvedValueOnce(equipe);
    const res = await json("GET", "/api/cobranca/regua");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.contarCasosPorEtapa).toHaveBeenCalledWith(42);
    expect(body).toMatchObject({ pausada: true, pausadaMotivo: "ferias coletivas", fonte: "politica" });
    expect(body.contagens).toEqual([{ etapa: "lembrete_atraso", carteira: "ativo", casos: 4, valor: 900 }]);
    const lembrete = body.etapas.find((e: any) => e.id === "lembrete_atraso");
    expect(lembrete).toMatchObject({ responsavelUserId: 8, responsavelNome: "Beto", janela: "D+1 → D+14" });
    expect(body.porCarteira.ex_cliente.map((e: any) => e.id)).not.toContain("aviso_suspensao");
    expect(body.porCarteira.ativo.map((e: any) => e.id)).toContain("aviso_suspensao");
    expect(JSON.stringify(body)).not.toContain("hash-secreto");
  });

  it("o DNA soma por quadrante e separa o sem classificacao", async () => {
    sessao = OPERADOR;
    storageMock.contarCasosPorQuadrante.mockResolvedValueOnce([
      { quadrante: "B3", carteira: "ativo", casos: 2, valor: 800 },
      { quadrante: "B3", carteira: "ex_cliente", casos: 1, valor: 100 },
      { quadrante: null, carteira: "ex_cliente", casos: 5, valor: 1000 },
    ]);
    const res = await json("GET", "/api/cobranca/dna");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.contarCasosPorQuadrante).toHaveBeenCalledWith(42);
    expect(body.total).toBe(8);
    expect(body.semClassificacao).toBe(5);
    const b3 = body.quadrantes.find((q: any) => q.codigo === "B3");
    expect(b3).toMatchObject({ casos: 3, valor: 900, abordagem: "cuidado", familia: "gated", porCarteira: { ativo: { casos: 2, valor: 800 }, ex_cliente: { casos: 1, valor: 100 } } });
    expect(body.quadrantes).toHaveLength(9);
    expect(body.contagens).toHaveLength(3);
  });
});

describe("GET /api/cobranca/equipe", () => {
  it("devolve id, nome e papel — nunca o hash de senha", async () => {
    sessao = OPERADOR;
    storageMock.getUsersByProvider.mockResolvedValueOnce(equipe);
    const res = await json("GET", "/api/cobranca/equipe");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.getUsersByProvider).toHaveBeenCalledWith(42);
    expect(body.usuarios).toEqual([
      { id: 7, nome: "Ana", role: "admin", email: "ana@x" },
      { id: 8, nome: "Beto", role: "user", email: "beto@x" },
    ]);
    expect(JSON.stringify(body)).not.toContain("hash-secreto");
  });
});

/* ── Politica ────────────────────────────────────────────────────────── */

describe("PUT /api/cobranca/politica", () => {
  const corpoValido = {
    etapas: [],
    negociacao: { maxParcelas: 10, entradaMinimaPct: 10, descontoMaxPct: 30, saldoMinimoParcelar: 100 },
    encargos: { multaPct: 2, jurosMesPct: 1 },
    janelaContato: { horaInicio: 9, horaFim: 18, sabado: false, sabadoHoraFim: 12, domingo: false, feriado: false },
    pausada: false,
    pausadaMotivo: null,
  };

  it("operador nao altera a politica; superadmin fora da janela de suporte tambem nao", async () => {
    sessao = OPERADOR;
    const res = await json("PUT", "/api/cobranca/politica", corpoValido);
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe("Apenas administradores podem alterar a politica de cobranca");

    sessao = { userId: 1, providerId: 42, role: "superadmin" };
    expect((await json("PUT", "/api/cobranca/politica", corpoValido)).status).toBe(403);
    expect(storageMock.upsertPoliticaDeCobranca).not.toHaveBeenCalled();
  });

  it("superadmin DENTRO da janela de suporte deste provedor administra", async () => {
    sessao = { userId: 1, providerId: 42, role: "superadmin", suporte: { acessoId: 5, providerId: 42 } };
    const res = await json("PUT", "/api/cobranca/politica", corpoValido);
    expect(res.status).toBe(200);
    expect(storageMock.upsertPoliticaDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({ negociacao: corpoValido.negociacao }));
  });

  it("admin grava, e os tetos legais entram como clamp com a frase do porque", async () => {
    sessao = ADMIN;
    const res = await json("PUT", "/api/cobranca/politica", {
      ...corpoValido,
      encargos: { multaPct: 10, jurosMesPct: 1 },
      janelaContato: { ...corpoValido.janelaContato, domingo: true },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ajustes).toEqual([
      "Multa de 10% reduzida a 2%: teto do CDC art. 52 §1º.",
      "Contato no domingo desligado: proibido pelo CDC art. 42.",
    ]);
    expect(body.politica.encargos.multaPct).toBe(2);
    expect(body.politica.janelaContato.domingo).toBe(false);
    expect(storageMock.upsertPoliticaDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({
      encargos: { multaPct: 2, jurosMesPct: 1 },
      negociacao: corpoValido.negociacao,
      pausada: false,
      pausadaMotivo: null,
    }));
    expect(body.etapas).toHaveLength(7);
  });

  it("400 com fieldErrors uteis: campo fora da faixa, campo desconhecido, responsavel de outro provedor", async () => {
    sessao = ADMIN;
    const faixa = await json("PUT", "/api/cobranca/politica", { ...corpoValido, negociacao: { ...corpoValido.negociacao, maxParcelas: 0 } });
    expect(faixa.status).toBe(400);
    expect((await faixa.json()).errors).toEqual({ "negociacao.maxParcelas": ["mínimo 1"] });

    const desconhecido = await json("PUT", "/api/cobranca/politica", { ...corpoValido, negociacoes: {} });
    expect(desconhecido.status).toBe(400);
    expect((await desconhecido.json()).errors).toEqual({ negociacoes: ["campo desconhecido"] });

    storageMock.getUsersByProvider.mockResolvedValueOnce(equipe);
    const estranho = await json("PUT", "/api/cobranca/politica", { ...corpoValido, etapas: [{ id: "lembrete_atraso", responsavelUserId: 999 }] });
    expect(estranho.status).toBe(400);
    expect((await estranho.json()).errors.etapas[0]).toMatch(/999/);
    expect(storageMock.upsertPoliticaDeCobranca).not.toHaveBeenCalled();
  });

  it("pausar manda so `pausada`: a mescla com a politica gravada preserva a negociacao configurada", async () => {
    sessao = ADMIN;
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce({
      id: 1, providerId: 42, etapas: [], negociacao: { maxParcelas: 12, entradaMinimaPct: 5, descontoMaxPct: 40, saldoMinimoParcelar: 50 },
      encargos: POLITICA_PADRAO.encargos, janelaContato: POLITICA_PADRAO.janelaContato, pausada: false, pausadaMotivo: null, updatedAt: new Date(),
    });
    const res = await json("PUT", "/api/cobranca/politica", { pausada: true, pausadaMotivo: "auditoria" });
    expect(res.status).toBe(200);
    expect(storageMock.upsertPoliticaDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({
      pausada: true, pausadaMotivo: "auditoria",
      negociacao: { maxParcelas: 12, entradaMinimaPct: 5, descontoMaxPct: 40, saldoMinimoParcelar: 50 },
    }));
  });

  it("GET devolve o padrao (configurada=false) quando o provedor nunca gravou", async () => {
    sessao = OPERADOR;
    const res = await json("GET", "/api/cobranca/politica");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.getPoliticaDeCobranca).toHaveBeenCalledWith(42);
    expect(body.configurada).toBe(false);
    expect(body.politica.negociacao).toEqual(POLITICA_PADRAO.negociacao);
    expect(body.tetos.multaPct).toBe(2);
  });
});
