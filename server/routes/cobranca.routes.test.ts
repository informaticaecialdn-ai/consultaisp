import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import {
  MOTIVO_CASO_FECHADO,
  MOTIVO_NEGATIVADO_NAO_VOLTA,
  MOTIVO_NEGOCIACAO_ENCERRADA,
  ORIGEM_INDISPONIVEL,
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
  fluxoDaEsteira: vi.fn(async (): Promise<any> => ({ entraram: 0, resolvidos: 0 })),
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
  clientesAtivosEmDia: vi.fn(async (): Promise<any> => ({ linhas: [], total: 0 })),
  clientesDoMes: vi.fn(async (): Promise<number[]> => []),
  faturasDoCliente: vi.fn(async (): Promise<any> => ({
    linhas: [], total: 0, limite: 200, doErp: 0, vencidas: 0, valorVencido: 0, vencimentoMaisAntigo: null,
  })),
  // O ARPU da Economia (R24): a mensalidade lida das faturas do ERP. Sem
  // fatura gravada o padrao e `null`, que e o caso do cliente do fixture.
  mensalidadeDoCliente: vi.fn(async (): Promise<any> => null),
  mensalidadesDoProvedor: vi.fn(async (): Promise<any> => new Map()),
  historicosDePagamentosDoProvedor: vi.fn(async (): Promise<any> => new Map()),
  erpConfirmaPagamentos: vi.fn(async (): Promise<any> => true),
  cobrancasDeSaida: vi.fn(async (): Promise<any> => new Map()),
  getErpIntegracoesResumo: vi.fn(async (): Promise<any> => [{ erpSource: "ixc", isEnabled: true }]),
  devedoresComVencimento: vi.fn(async (): Promise<any[]> => []),
  baseDeFaturas: vi.fn(async (): Promise<any> => ({ total: 0, atualizadoEm: null })),
  coberturaDaMensalidade: vi.fn(async (): Promise<any> => ({ ativos: 0, comMensalidade: 0, comDataDeContrato: 0 })),
  resumoDoMes: vi.fn(async (): Promise<any> => ({
    mes: "2026-09", base: false, faturado: 0, recebido: 0, recebidoConfirmado: false, emConciliacao: 0, inadimplente: 0, numInadimplentes: 0,
    aVencer: 0, numAVencer: 0, semFatura: 0, clientes: { emDia: 0, inadimplentes: 0 }, atualizadoEm: null,
  })),
  getEquipmentByCustomer: vi.fn(async (): Promise<any[]> => []),
  getRecoveryCases: vi.fn(async (): Promise<any[]> => []),
  getRecentConsultationsForDocument: vi.fn(async (): Promise<any[]> => []),
  getAlertsByCustomer: vi.fn(async (): Promise<any[]> => []),
  conversasDoChatPorCaso: vi.fn(async (): Promise<Map<number, any>> => new Map()),
  negociacoesVivasPorCaso: vi.fn(async (): Promise<Map<number, any>> => new Map()),
  getConversaDoChatPorCaso: vi.fn(async (): Promise<any> => undefined),
  confissaoEnviadaDaNegociacao: vi.fn(async (): Promise<any> => undefined),
  confissaoAssinadaVivaDoCliente: vi.fn(async (): Promise<any> => undefined),
  confissoesAssinadasVivasPorCliente: vi.fn(async (): Promise<Map<number, any>> => new Map()),
}));
const snapshotMock = vi.hoisted(() => ({
  snapshotAoVivoDoCliente: vi.fn(async (): Promise<any> => ({ ok: false, erpSource: null, encontrado: false, cliente: null, erro: "Sem integração", latenciaMs: 1, lidoEm: "2026-09-05T12:00:00.000Z", doCache: false })),
}));
vi.mock("../services/cobranca/snapshot-ao-vivo.service", () => snapshotMock);
const retornoMock = vi.hoisted(() => ({ cancelarConfissao: vi.fn(async (): Promise<any> => ({ id: 77, status: "cancelada" })) }));
vi.mock("../services/confissao/confissao-retorno.service", () => retornoMock);
vi.mock("../storage", () => ({ storage: storageMock }));
// O 360 le o historico direto de FaturasStorage (nao pela fachada): o duble diz o que o ERP confirmou.
const historicoMock = vi.hoisted(() => ({ atual: null as any }));
vi.mock("../storage/faturas.storage", async (original) => {
  const real = await original<typeof import("../storage/faturas.storage")>();
  class FaturasStorageFake { historicoDePagamentosDoCliente = async () => historicoMock.atual ?? { historicoInsuficiente: true, faturasPagas: 0, faturasPagasComAtraso: 0, recebido: 0, taxaAtraso: null, ultimaConfirmacaoEm: null, fonte: null }; }
  return { ...real, FaturasStorage: FaturasStorageFake };
});

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

import { documentoLegivel, ispScoreReal, registerCobrancaRoutes } from "./cobranca.routes";
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

describe("carteiras separadas em toda a operacao", () => {
  it('recusa aceitar negociacao da outra carteira sem alterar status', async () => {
    sessao = ADMIN;
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, casoId: 9, status: 'proposta' });
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    expect((await json('PATCH', '/api/cobranca/negociacoes/3?carteira=ex_cliente', { status: 'aceita' })).status).toBe(404);
    expect(storageMock.atualizarStatusDaNegociacao).not.toHaveBeenCalled();
  });
  it('recusa pagar parcela da outra carteira antes do recebimento', async () => {
    sessao = ADMIN;
    storageMock.obterParcela.mockResolvedValueOnce({ id: 11, negociacaoId: 3, status: 'pendente' });
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, casoId: 9, status: 'aceita' });
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    expect((await json('POST', '/api/cobranca/parcelas/11/pagar?carteira=ex_cliente', { valorPago: 100 })).status).toBe(404);
    expect(storageMock.marcarParcelaPaga).not.toHaveBeenCalled();
  });
  it('recusa alterar caso de outra carteira antes de escrever', async () => {
    sessao = ADMIN;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    expect((await json('PATCH', '/api/cobranca/casos/9?carteira=ex_cliente', { prioridade: 'alta' })).status).toBe(404);
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });
  it('resumo mensal recusa ex-clientes', async () => {
    sessao = ADMIN;
    expect((await json('GET', '/api/cobranca/carteira/mes?carteira=ex_cliente')).status).toBe(400);
  });
  it.each(['360', '360/ao-vivo'])('detalhe %s recusa cliente de outra carteira', async detalhe => {
    sessao = ADMIN;
    storageMock.getCustomersByProvider.mockResolvedValue([clienteMaria]);
    expect((await json('GET', '/api/cobranca/clientes/1/' + detalhe + '?carteira=ex_cliente')).status).toBe(404);
    expect((await json('GET', '/api/cobranca/clientes/1/' + detalhe + '?carteira=inventada')).status).toBe(400);
  });
  it.each(['regua', 'dna'])('%s mostra somente contagens da carteira solicitada', async endpoint => {
    sessao = ADMIN;
    const contagens = [{ etapa: 'lembrete_atraso', quadrante: 'B3', carteira: 'ativo', casos: 2, valor: 100 }, { etapa: 'lembrete_atraso', quadrante: 'B3', carteira: 'ex_cliente', casos: 5, valor: 900 }];
    storageMock.contarCasosPorEtapa.mockResolvedValue(contagens);
    storageMock.contarCasosPorQuadrante.mockResolvedValue(contagens);
    const r = await json('GET', '/api/cobranca/' + endpoint + '?carteira=ativo');
    expect(r.status).toBe(200);
    expect((await r.json()).contagens).toEqual([contagens[0]]);
  });
  it.each(["ativo", "ex_cliente"])("passa %s aos indicadores e bairros, alem da lista", async carteira => {
    sessao = ADMIN;
    const r = await json("GET", `/api/cobranca/carteira?carteira=${carteira}`);
    expect(r.status).toBe(200);
    expect(storageMock.kpisDaCobranca).toHaveBeenCalledWith(42, expect.any(Date), carteira);
    expect(storageMock.composicaoDaCarteira).toHaveBeenCalledWith(42, carteira);
    expect(storageMock.bairrosDaCarteira).toHaveBeenCalledWith(42, carteira);
  });

  it.each(["ativo", "ex_cliente"])("a fila %s e seus indicadores usam a mesma carteira", async carteira => {
    sessao = OPERADOR;
    const r = await json("GET", `/api/cobranca/fila?responsavel=eu&carteira=${carteira}`);
    expect(r.status).toBe(200);
    expect(storageMock.filaDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({ carteira, responsavelUserId: 8 }));
    for (const chamada of storageMock.listarCasosDeCobranca.mock.calls) {
      expect(chamada[1]).toMatchObject({ carteira });
    }
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalled();
  });

  it("a fila recusa carteira desconhecida em vez de misturar os clientes", async () => {
    sessao = ADMIN;
    expect((await json("GET", "/api/cobranca/fila?carteira=inventada")).status).toBe(400);
    expect(storageMock.filaDeCobranca).not.toHaveBeenCalled();
  });
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
  statusDesde: emDias(-3),
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

describe("documentoLegivel", () => {
  /*
   * Decisao do dono (06/09/2026): a carteira e do provedor, entao o documento
   * do cliente DELE sai por extenso. Ate aqui saia "123.456.***-01" — e o
   * operador nao conferia identidade ao telefone nem achava o cliente no ERP
   * sem abrir outra tela. O que continua mascarado e o cliente de OUTRO
   * provedor: 'lgpd-masking' na consulta e 'mascararDocumento' em
   * services/bigdata-domicilio.ts, cada um com o proprio teste.
   */
  it("CPF e CNPJ saem pontuados, inteiros", () => {
    expect(documentoLegivel("12345678901")).toBe("123.456.789-01");
    expect(documentoLegivel("123.456.789-01")).toBe("123.456.789-01");
    expect(documentoLegivel("12345678000199")).toBe("12.345.678/0001-99");
  });

  it("documento ausente ou incompleto nao vira pontuacao inventada", () => {
    // 9 digitos pontuados como CPF seriam um documento que nao existe.
    expect(documentoLegivel("123456789")).toBe("123456789");
    expect(documentoLegivel(null)).toBe("");
    expect(documentoLegivel("")).toBe("");
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

describe("GET /api/cobranca/carteira/prejuizo", () => {
  const politicaComCustos = () => ({
    id: 1, providerId: 42, ...POLITICA_PADRAO, updatedAt: new Date("2026-09-05T12:00:00Z"),
    economia: { ...POLITICA_PADRAO.economia, cac: 120, capexInstalacao: 650, opexLink: 15, opexRedePop: 10, opexSuporte: 10, opexManutencaoNoc: 10, impostoReceitaPct: 8, cicloMeses: 36, confirmado: false },
  });
  it("exige a carteira e recusa periodo fora do formato", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/cobranca/carteira/prejuizo")).status).toBe(400);
    expect((await json("GET", "/api/cobranca/carteira/prejuizo?carteira=ativo&periodo=set-26")).status).toBe(400);
    expect((await json("GET", "/api/cobranca/carteira/prejuizo?carteira=inventada")).status).toBe(400);
    expect(storageMock.devedoresComVencimento).not.toHaveBeenCalled();
  });
  it("sem fatura do ERP: live=false com o motivo, e o periodo resolvido mesmo assim", async () => {
    sessao = OPERADOR;
    const r = await json("GET", "/api/cobranca/carteira/prejuizo?carteira=ex_cliente&periodo=2026-T1");
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.live).toBe(false);
    expect(b.motivo).toMatch(/fatura a fatura/);
    expect(b.periodo).toEqual({ texto: "2026-T1", rotulo: "T1/26", granularidade: "trimestre", de: "2026-01-01", ate: "2026-04-01" });
    expect(b.eixo).toBe("devem_desde");
    // Sem devedor no periodo o conjunto vazio soma ZERO; o traco e para "ha devedor e ninguem passou no gate".
    expect(b.resumo).toMatchObject({ devedores: 0, prejuizo: 0 });
    // Sempre o provedor da sessao, nunca um da query.
    expect(storageMock.devedoresComVencimento).toHaveBeenCalledWith(42, "ex_cliente", expect.any(Date));
    expect(storageMock.baseDeFaturas).toHaveBeenCalledWith(42);
  });
  it("com base: soma os avaliados pelo mesmo gate do 360, e a mensalidade e lida SO dos devedores", async () => {
    sessao = OPERADOR;
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce(politicaComCustos());
    storageMock.baseDeFaturas.mockResolvedValueOnce({ total: 40, atualizadoEm: new Date("2026-09-09T06:05:00Z") });
    storageMock.devedoresComVencimento.mockResolvedValueOnce([
      // mes 6 devendo 179,80 → −723,55 no ledger (margem 37,708 × 6 − 770 − 179,80)
      { id: 1, statusErp: "active", dividaAtual: 179.8, contractStartDate: "2026-03-09", cortadoEm: null, devemDesde: "2026-09-01", ultimaFatura: "2026-09-01" },
      // sem fatura vencida gravada: balde "sem data"
      { id: 2, statusErp: "active", dividaAtual: 50, contractStartDate: "2026-03-09", cortadoEm: null, devemDesde: null, ultimaFatura: null },
    ]);
    storageMock.mensalidadesDoProvedor.mockResolvedValueOnce(new Map([[1, { valor: 89.9, concordam: 1, faturas: 1, maisRecente: null, baixadas: 0 }]]));
    const b = await (await json("GET", "/api/cobranca/carteira/prejuizo?carteira=ativo&periodo=2026-09")).json();
    expect(b.live).toBe(true);
    expect(b.confirmado).toBe(false);
    expect(b.resumo).toMatchObject({ devedores: 1, avaliados: 1, prejuizo: 723.55, dividaAvaliada: 179.8, instalacaoNaoRecuperada: 543.75, dividaDoRecorte: 179.8, dividaDaCarteira: 229.8, semData: { clientes: 1, divida: 50 } });
    expect(b.serie).toEqual([{ mes: "2026-09", devedores: 1, dividaReal: 179.8, prejuizo: 723.55 }]);
    expect(b.atualizadoEm).toBe("2026-09-09T06:05:00.000Z");
    expect(storageMock.mensalidadesDoProvedor).toHaveBeenCalledWith(42, [1, 2]);
  });
  it("sem periodo na query, o mes corrente", async () => {
    sessao = OPERADOR;
    const b = await (await json("GET", "/api/cobranca/carteira/prejuizo?carteira=ativo")).json();
    const agora = new Date();
    expect(b.periodo.texto).toBe(`${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`);
  });
});

describe("o chip de prejuizo na lista da carteira", () => {
  it("resolve os devedores do periodo pela mesma soma do card, nas duas carteiras", async () => {
    sessao = OPERADOR;
    storageMock.devedoresComVencimento.mockResolvedValue([
      { id: 1, statusErp: "cancelled", dividaAtual: 589.65, contractStartDate: "2025-09-01", cortadoEm: null, devemDesde: "2026-03-05", ultimaFatura: "2026-03-05" },
      { id: 2, statusErp: "cancelled", dividaAtual: 100, contractStartDate: "2025-09-01", cortadoEm: null, devemDesde: "2026-07-05", ultimaFatura: "2026-07-05" },
    ]);
    const r = await json("GET", "/api/cobranca/carteira?carteira=ex_cliente&prejuizo=1&periodo=2026-T1");
    expect(r.status).toBe(200);
    expect(storageMock.devedoresComVencimento).toHaveBeenCalledWith(42, "ex_cliente", expect.any(Date));
    storageMock.devedoresComVencimento.mockReset();
    storageMock.devedoresComVencimento.mockResolvedValue([]);
  });
  it("chip do mes e chip de prejuizo nao se somam; prejuizo sem carteira e recusado", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/cobranca/carteira?carteira=ativo&prejuizo=1&mesStatus=pago")).status).toBe(400);
    expect((await json("GET", "/api/cobranca/carteira?prejuizo=1")).status).toBe(400);
  });
});

describe("GET /360 — o pagamento REAL do ERP entra na Economia (0036)", () => {
  afterEach(() => { historicoMock.atual = null; });
  it("com faturas pagas sincronizadas, a ficha recebe pagas/recebido/pct_em_dia e o pendente some", async () => {
    sessao = OPERADOR;
    historicoMock.atual = { historicoInsuficiente: false, faturasPagas: 12, faturasPagasComAtraso: 3, recebido: 1078.8, taxaAtraso: 0.25, ultimaConfirmacaoEm: new Date("2026-09-01T00:00:00Z"), fonte: "pagamentos_com_data" };
    // Com custos na politica e a mensalidade lida das faturas a Economia abre; o historico a torna REALIZADA.
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce({
      id: 1, providerId: 42, ...POLITICA_PADRAO, updatedAt: new Date("2026-09-05T12:00:00Z"),
      economia: { ...POLITICA_PADRAO.economia, cac: 120, capexInstalacao: 650, opexLink: 15, opexRedePop: 10, opexSuporte: 10, opexManutencaoNoc: 10, impostoReceitaPct: 8, cicloMeses: 36, confirmado: false },
    });
    storageMock.mensalidadeDoCliente.mockResolvedValueOnce({ valor: 89.9, concordam: 3, faturas: 4, maisRecente: null, baixadas: 2 });
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
    const body = await (await json("GET", "/api/cobranca/clientes/1/360")).json();
    expect(body.pendentes.map((x: any) => x.campo)).not.toContain("historicoPagamento");
    expect(body.ficha.economia?.fonte_receita).toBe("recebida");
    expect(body.ficha.economia?.receita_recebida).toBe(1078.8);
  });
  it("sem fatura paga, a Economia segue projetada e o pendente explica", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
    const body = await (await json("GET", "/api/cobranca/clientes/1/360")).json();
    expect(body.pendentes.find((x: any) => x.campo === "historicoPagamento")?.motivo).toMatch(/nenhuma fatura paga sincronizada/);
  });
});

describe("a multa de cancelamento sai da dívida da Economia — no 360 e no card (dono, 09/09/2026)", () => {
  const politicaComCustos = () => ({
    id: 1, providerId: 42, ...POLITICA_PADRAO, updatedAt: new Date("2026-09-05T12:00:00Z"),
    economia: { ...POLITICA_PADRAO.economia, cac: 120, capexInstalacao: 650, opexLink: 15, opexRedePop: 10, opexSuporte: 10, opexManutencaoNoc: 10, impostoReceitaPct: 8, cicloMeses: 36, confirmado: false },
  });
  it("360: a cobrança de saída do cliente vai na entrada da ficha, o ledger vê só a dívida de serviço e a ficha diz quanto ficou de fora", async () => {
    sessao = OPERADOR;
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce(politicaComCustos());
    storageMock.mensalidadeDoCliente.mockResolvedValueOnce({ valor: 89.9, concordam: 3, faturas: 4, maisRecente: null, baixadas: 2 });
    storageMock.cobrancasDeSaida.mockResolvedValueOnce(new Map([[1, { multa: 600, equipamento: 0, indeterminadas: 0, faturas: 1 }]]));
    storageMock.getCustomersByProvider.mockResolvedValueOnce([{ ...clienteMaria, totalOverdueAmount: "719.86", contractStartDate: "2026-07-05" }]);
    const body = await (await json("GET", "/api/cobranca/clientes/1/360")).json();
    expect(storageMock.cobrancasDeSaida).toHaveBeenCalledWith(42, [1], expect.any(Date));
    expect(body.fichaEntrada.cobrancaDeSaida).toEqual({ multa: 600, equipamento: 0, indeterminadas: 0, faturas: 1 });
    expect(body.ficha.economia?.inadimplencia_aberta).toBe(119.86);
    expect(body.ficha.multaForaDoPrejuizo).toBe(600);
  });
  it("360: se a leitura das faturas falhar, nada é excluído — a ficha abre como sempre", async () => {
    sessao = OPERADOR;
    storageMock.cobrancasDeSaida.mockRejectedValueOnce(new Error("banco fora"));
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
    const res = await json("GET", "/api/cobranca/clientes/1/360");
    expect(res.status).toBe(200);
    expect((await res.json()).ficha.multaForaDoPrejuizo).toBe(0);
  });
  it("card: se a leitura das faturas falhar, nada é excluído e o card responde 200 — igual ao 360", async () => {
    sessao = OPERADOR;
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce(politicaComCustos());
    storageMock.devedoresComVencimento.mockResolvedValueOnce([
      { id: 1, statusErp: "active", dividaAtual: 719.86, contractStartDate: "2026-07-05", cortadoEm: null, devemDesde: "2026-08-05", ultimaFatura: "2026-08-05", plano: null },
    ]);
    storageMock.mensalidadesDoProvedor.mockResolvedValueOnce(new Map([[1, { valor: 89.9, concordam: 2, faturas: 2, baixadas: 0 }]]));
    storageMock.cobrancasDeSaida.mockRejectedValueOnce(new Error("banco fora"));
    const res = await json("GET", "/api/cobranca/carteira/prejuizo?carteira=ativo&periodo=2026-T3");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resumo.dividaAvaliada).toBe(719.86);
    expect(body.resumo.multaForaDoPrejuizo).toBe(0);
  });
  it("card: o ERP não confirma pagamento e a fonte é a da integração LIGADA — lida do resumo, sem decifrar credencial", async () => {
    sessao = OPERADOR;
    storageMock.erpConfirmaPagamentos.mockResolvedValueOnce(false);
    storageMock.getErpIntegracoesResumo.mockResolvedValueOnce([{ erpSource: "ixc", isEnabled: false }, { erpSource: "mk", isEnabled: true }]);
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce(politicaComCustos());
    storageMock.devedoresComVencimento.mockResolvedValueOnce([
      { id: 1, statusErp: "cancelled", dividaAtual: 100, contractStartDate: "2025-09-01", cortadoEm: null, devemDesde: "2026-08-05", ultimaFatura: "2026-08-05", plano: null },
    ]);
    storageMock.mensalidadesDoProvedor.mockResolvedValueOnce(new Map([[1, { valor: 89.9, concordam: 6, faturas: 6, baixadas: 6 }]]));
    const body = await (await json("GET", "/api/cobranca/carteira/prejuizo?carteira=ex_cliente&periodo=2026-T3")).json();
    // O ex-cliente sem fatura paga entra ESTIMADO — nao fica mais de fora.
    expect(body.resumo.avaliados).toBe(1);
    expect(body.resumo.estimados).toBe(1);
    expect(body.resumo.motivosDoTraco).toEqual([]);
    expect(storageMock.getErpIntegracoesResumo).toHaveBeenCalledWith(42);
  });
  it("card: as cobranças de saída dos devedores do recorte entram na soma, e o resumo diz o total que ficou de fora", async () => {
    sessao = OPERADOR;
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce(politicaComCustos());
    storageMock.devedoresComVencimento.mockResolvedValueOnce([
      { id: 1, statusErp: "active", dividaAtual: 719.86, contractStartDate: "2026-07-05", cortadoEm: null, devemDesde: "2026-08-05", ultimaFatura: "2026-08-05", plano: null },
    ]);
    storageMock.mensalidadesDoProvedor.mockResolvedValueOnce(new Map([[1, { valor: 89.9, concordam: 2, faturas: 2, baixadas: 0 }]]));
    storageMock.cobrancasDeSaida.mockResolvedValueOnce(new Map([[1, { multa: 600, equipamento: 0, indeterminadas: 0, faturas: 1 }]]));
    const body = await (await json("GET", "/api/cobranca/carteira/prejuizo?carteira=ativo&periodo=2026-T3")).json();
    expect(storageMock.cobrancasDeSaida).toHaveBeenCalledWith(42, [1], expect.any(Date));
    expect(body.resumo.avaliados).toBe(1);
    expect(body.resumo.dividaAvaliada).toBe(119.86);
    expect(body.resumo.dividaDoRecorte).toBe(719.86);
    expect(body.resumo.multaForaDoPrejuizo).toBe(600);
  });
});

describe("GET /360 — quando o ERP do provedor nunca confirmou pagamento, o motivo é do provedor (0036)", () => {
  it("NsLink (MK sem a API licenciada): a ficha e o pendente culpam o MK; o plano gravado pela 0036 entra e sai da lista de pendentes", async () => {
    sessao = OPERADOR;
    storageMock.erpConfirmaPagamentos.mockResolvedValueOnce(false);
    storageMock.getCustomersByProvider.mockResolvedValueOnce([{ ...clienteMaria, status: "cancelled", erpSource: "mk", contractPlan: "Smart 800MB + Watch Tv" }]);
    const body = await (await json("GET", "/api/cobranca/clientes/1/360?carteira=ex_cliente")).json();
    // Sem preco do plano e sem mensalidade, a ficha manda cadastrar o preco; o pendente do historico culpa o MK.
    expect(body.ficha.economiaPendente).toMatch(/não tem preço cadastrado/);
    expect(body.pendentes.find((x: any) => x.campo === "historicoPagamento")?.motivo).toMatch(/o MK ainda não entregou nenhuma ao Consulta ISP .* MK Solutions/);
    expect(body.fichaEntrada.plano).toBe("Smart 800MB + Watch Tv");
    expect(body.cliente.plano).toBe("Smart 800MB + Watch Tv");
    expect(body.pendentes.map((x: any) => x.campo)).not.toContain("plano");
  });
  it("provedor com pagas na base: o ex-cliente sem paga leva o motivo do cliente, e sem plano o pendente explica", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([{ ...clienteMaria, status: "cancelled" }]);
    const body = await (await json("GET", "/api/cobranca/clientes/1/360?carteira=ex_cliente")).json();
    expect(body.pendentes.find((x: any) => x.campo === "historicoPagamento")?.motivo).toMatch(/nenhuma fatura paga sincronizada do ERP para este cliente.*estimada \(ex-cliente/);
    expect(body.pendentes.find((x: any) => x.campo === "plano")?.motivo).toMatch(/nao informou o plano/);
  });
  it("a falha da pergunta ao provedor nao derruba o 360: motivo de sempre", async () => {
    sessao = OPERADOR;
    storageMock.erpConfirmaPagamentos.mockRejectedValueOnce(new Error("banco fora"));
    storageMock.getCustomersByProvider.mockResolvedValueOnce([{ ...clienteMaria, status: "cancelled", erpSource: "mk" }]);
    const res = await json("GET", "/api/cobranca/clientes/1/360?carteira=ex_cliente");
    expect(res.status).toBe(200);
    expect((await res.json()).pendentes.find((x: any) => x.campo === "historicoPagamento")?.motivo).toMatch(/nenhuma fatura paga sincronizada do ERP para este cliente/);
  });
  it("o card do prejuízo pergunta ao provedor e passa a fonte da integração ligada", async () => {
    sessao = OPERADOR;
    storageMock.erpConfirmaPagamentos.mockResolvedValueOnce(false);
    storageMock.getErpIntegracoesResumo.mockResolvedValueOnce([{ erpSource: "ixc", isEnabled: false }, { erpSource: "mk", isEnabled: true }]);
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce({
      id: 1, providerId: 42, ...POLITICA_PADRAO, updatedAt: new Date("2026-09-05T12:00:00Z"),
      economia: { ...POLITICA_PADRAO.economia, cac: 120, capexInstalacao: 650, opexLink: 15, opexRedePop: 10, opexSuporte: 10, opexManutencaoNoc: 10, impostoReceitaPct: 8, cicloMeses: 36, confirmado: false },
    });
    storageMock.devedoresComVencimento.mockResolvedValueOnce([
      { id: 1, statusErp: "cancelled", dividaAtual: 100, contractStartDate: "2025-09-01", cortadoEm: null, devemDesde: "2026-02-05", ultimaFatura: "2026-02-05", plano: null },
    ]);
    storageMock.mensalidadesDoProvedor.mockResolvedValueOnce(new Map([[1, { valor: 89.9, concordam: 6, faturas: 6, baixadas: 6 }]]));
    const body = await (await json("GET", "/api/cobranca/carteira/prejuizo?carteira=ex_cliente&periodo=2026-T1")).json();
    // Sem fatura paga o ex-cliente entra ESTIMADO — e o resumo diz quantos.
    expect(body.resumo.avaliados).toBe(1);
    expect(body.resumo.estimados).toBe(1);
    expect(storageMock.erpConfirmaPagamentos).toHaveBeenCalledWith(42);
  });
});

describe("GET /360 — o caminho ESTIMADO de ponta a ponta (ex-cliente sem fatura paga, com custos e mensalidade)", () => {
  it("a ficha sai com fonte 'estimada' e o motivo no selo; o pendente do historico continua listado", async () => {
    sessao = OPERADOR;
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce({
      id: 1, providerId: 42, ...POLITICA_PADRAO, updatedAt: new Date("2026-09-05T12:00:00Z"),
      economia: { ...POLITICA_PADRAO.economia, cac: 120, capexInstalacao: 650, opexLink: 15, opexRedePop: 10, opexSuporte: 10, opexManutencaoNoc: 10, impostoReceitaPct: 8, cicloMeses: 36, confirmado: false },
    });
    storageMock.mensalidadeDoCliente.mockResolvedValueOnce({ valor: 89.9, concordam: 3, faturas: 4, maisRecente: null, baixadas: 2 });
    storageMock.faturasDoCliente.mockResolvedValueOnce({ linhas: [], total: 1, limite: 1, doErp: 1, vencidas: 1, valorVencido: 100, vencimentoMaisAntigo: new Date("2026-03-05T00:00:00Z"), vencimentoMaisRecente: new Date("2026-03-05T00:00:00Z") });
    storageMock.getCustomersByProvider.mockResolvedValueOnce([{ ...clienteMaria, status: "cancelled", totalOverdueAmount: "100.00", contractStartDate: "2025-09-05" }]);
    const body = await (await json("GET", "/api/cobranca/clientes/1/360?carteira=ex_cliente")).json();
    expect(body.ficha.economia?.fonte_receita).toBe("estimada");
    expect(body.ficha.economia?.receita_estimada).toBe(439.4);   // 89,90 × 6 − 100
    expect(body.ficha.economiaEstimada).toMatch(/sem fatura paga sincronizada deste cliente — o resultado do contrato é estimado/);
    expect(body.pendentes.map((x: any) => x.campo)).toContain("historicoPagamento");
  });
});

describe("GET /360 — o fim do ciclo e a evidência da mensalidade chegam à ficha", () => {
  it("ex-cliente: ultimaFaturaEmitidaEm vem da fatura vencida mais recente (limite 1) e baixadas vai na mensalidade", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([{ ...clienteMaria, status: "cancelled" }]);
    storageMock.faturasDoCliente.mockResolvedValueOnce({ linhas: [], total: 1, limite: 1, doErp: 1, vencidas: 1, valorVencido: 589.65, vencimentoMaisAntigo: new Date("2026-03-05T00:00:00Z"), vencimentoMaisRecente: new Date("2026-03-05T00:00:00Z") });
    storageMock.mensalidadeDoCliente.mockResolvedValueOnce({ valor: 89.9, concordam: 3, faturas: 4, maisRecente: null, baixadas: 2 });
    const res = await json("GET", "/api/cobranca/clientes/1/360?carteira=ex_cliente");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(storageMock.faturasDoCliente).toHaveBeenCalledWith(42, 1, { limite: 1, hoje: expect.any(Date) });
    expect(body.fichaEntrada.ultimaFaturaEmitidaEm).toBe("2026-03-05");
    expect(body.fichaEntrada.primeiraFaturaVencidaEm).toBe("2026-03-05");
    expect(body.fichaEntrada.mensalidadeObservada).toMatchObject({ valor: 89.9, concordam: 3, faturas: 4, baixadas: 2 });
    // Sem fatura paga o ex-cliente sai ESTIMADO (09/09/2026); aqui a politica e a padrao, sem custos.
    expect(body.ficha.economiaPendente).toMatch(/faltam os custos do provedor/);
  });
  it("se a leitura das faturas falhar, a ficha abre sem o fim do ciclo — nunca derruba o 360", async () => {
    sessao = OPERADOR;
    storageMock.getCustomersProvider = undefined;
    storageMock.getCustomersByProvider.mockResolvedValueOnce([{ ...clienteMaria, status: "cancelled" }]);
    storageMock.faturasDoCliente.mockRejectedValueOnce(new Error("banco fora"));
    const res = await json("GET", "/api/cobranca/clientes/1/360?carteira=ex_cliente");
    expect(res.status).toBe(200);
    expect((await res.json()).fichaEntrada.ultimaFaturaEmitidaEm).toBeNull();
  });
});

describe("o chip de prejuízo na lista — os três segmentos passam pelo recorte", () => {
  const devedoresDoT1 = [
    { id: 2, statusErp: "active", dividaAtual: 100, contractStartDate: "2025-09-01", cortadoEm: null, devemDesde: "2026-02-05", ultimaFatura: "2026-02-05" },
    { id: 77, statusErp: "active", dividaAtual: 50, contractStartDate: "2025-09-01", cortadoEm: null, devemDesde: "2026-03-05", ultimaFatura: "2026-03-05" },
    { id: 1, statusErp: "active", dividaAtual: 80, contractStartDate: "2025-09-01", cortadoEm: null, devemDesde: "2026-07-05", ultimaFatura: "2026-07-05" },
  ];
  it("ativos: casos e candidatos fora do período saem, e quem está em dia nunca entra", async () => {
    sessao = OPERADOR;
    storageMock.devedoresComVencimento.mockResolvedValueOnce(devedoresDoT1);
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [linhaCaso({ id: 1, cliente: { ...linhaCaso().cliente, id: 1 } }), linhaCaso({ id: 2, cliente: { ...linhaCaso().cliente, id: 2 } })], total: 2 });
    storageMock.clientesParaAbrirCaso.mockResolvedValueOnce([
      { customerId: 3, nome: "Fora", cpfCnpj: "111", statusErp: "active", carteira: "ativo", dividaAtual: 50, diasAtraso: 10, faturasAbertas: 1, contractStartDate: null },
    ]);
    const res = await json("GET", "/api/cobranca/carteira?carteira=ativo&prejuizo=1&periodo=2026-T1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(storageMock.devedoresComVencimento).toHaveBeenCalledWith(42, "ativo", expect.any(Date));
    expect(body.itens.map((i: any) => i.customerId)).toEqual([2]);
    expect(storageMock.clientesAtivosEmDia).not.toHaveBeenCalled();
  });
  it("ex-clientes: o mesmo recorte, que o chip do mês nunca teve aqui", async () => {
    sessao = OPERADOR;
    storageMock.devedoresComVencimento.mockResolvedValueOnce(devedoresDoT1.map(d => ({ ...d, statusErp: "cancelled" })));
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [linhaCaso({ id: 1, cliente: { ...linhaCaso().cliente, id: 1 } }), linhaCaso({ id: 77, cliente: { ...linhaCaso().cliente, id: 77 } })], total: 2 });
    storageMock.clientesParaAbrirCaso.mockResolvedValueOnce([]);
    const body = await (await json("GET", "/api/cobranca/carteira?carteira=ex_cliente&prejuizo=1&periodo=2026-T1")).json();
    expect(body.itens.map((i: any) => i.customerId)).toEqual([77]);
    expect(storageMock.clientesDoMes).not.toHaveBeenCalled();
  });
});

describe("GET /api/cobranca/carteira/mes", () => {
  it("sem fatura do ERP: live=false com o motivo; com base: o resumo inteiro e o mes pedido", async () => {
    sessao = OPERADOR;
    const semBase = await json("GET", "/api/cobranca/carteira/mes?mes=2026-09");
    expect(semBase.status).toBe(200);
    const b1 = await semBase.json();
    expect(b1.live).toBe(false);
    expect(b1.motivo).toMatch(/fatura a fatura/);
    expect(storageMock.resumoDoMes).toHaveBeenCalledWith(42, "2026-09", expect.any(Date));

    storageMock.resumoDoMes.mockResolvedValueOnce({
      mes: "2026-08", base: true, faturado: 1000, recebido: 0, recebidoConfirmado: false, emConciliacao: 250, inadimplente: 300, numInadimplentes: 3,
      aVencer: 450, numAVencer: 5, semFatura: 12, clientes: { emDia: 500, inadimplentes: 24 }, atualizadoEm: new Date("2026-09-05T03:00:00Z"),
    });
    const comBase = await json("GET", "/api/cobranca/carteira/mes?mes=2026-08");
    const b2 = await comBase.json();
    expect(b2.live).toBe(true);
    expect(b2.motivo).toBeNull();
    expect(b2.resumo).toMatchObject({ mes: "2026-08", inadimplente: 300, aVencer: 450, semFatura: 12, atualizadoEm: "2026-09-05T03:00:00.000Z" });

    const invalido = await json("GET", "/api/cobranca/carteira/mes?mes=2026-13");
    expect(invalido.status).toBe(400);
  });

  it("sem mes na query, o mes corrente", async () => {
    sessao = OPERADOR;
    await json("GET", "/api/cobranca/carteira/mes");
    const agora = new Date();
    expect(storageMock.resumoDoMes).toHaveBeenLastCalledWith(42, `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`, expect.any(Date));
  });
});

describe("GET /api/cobranca/carteira", () => {
  it("o chip do mes vira um recorte de ids: os tres segmentos passam por ele", async () => {
    sessao = OPERADOR;
    storageMock.clientesDoMes.mockResolvedValueOnce([2, 77]);
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [linhaCaso({ id: 1, cliente: { ...linhaCaso().cliente, id: 1 } }), linhaCaso({ id: 2, cliente: { ...linhaCaso().cliente, id: 2 } })], total: 2 });
    storageMock.clientesParaAbrirCaso.mockResolvedValueOnce([
      { customerId: 3, nome: "Fora", cpfCnpj: "111", statusErp: "active", carteira: "ativo", dividaAtual: 50, diasAtraso: 10, faturasAbertas: 1, contractStartDate: null },
    ]);
    storageMock.clientesAtivosEmDia.mockResolvedValueOnce({ linhas: [], total: 0 });
    const res = await json("GET", "/api/cobranca/carteira?carteira=ativo&mes=2026-09&mesStatus=a_vencer");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(storageMock.clientesDoMes).toHaveBeenCalledWith(42, "2026-09", "a_vencer");
    // caso do cliente 1 e o candidato 3 ficam de fora; o em-dia recebe o recorte de ids
    expect(body.itens.map((i: any) => i.customerId)).toEqual([2]);
    expect(storageMock.clientesAtivosEmDia).toHaveBeenCalledWith(42, expect.objectContaining({ ids: [2, 77] }), expect.anything());

    // "inadimplente" nunca lista quem esta em dia; ex-clientes nao tem mes
    storageMock.clientesAtivosEmDia.mockClear();
    storageMock.clientesDoMes.mockResolvedValueOnce([2]);
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [], total: 0 });
    await json("GET", "/api/cobranca/carteira?carteira=ativo&mesStatus=inadimplente");
    expect(storageMock.clientesAtivosEmDia).not.toHaveBeenCalled();
    storageMock.clientesDoMes.mockClear();
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [], total: 0 });
    await json("GET", "/api/cobranca/carteira?carteira=ex_cliente&mesStatus=pago");
    expect(storageMock.clientesDoMes).not.toHaveBeenCalled();
  });

  it("espaco de ativos: quem esta em dia entra DEPOIS de quem deve, e so sem filtro de devedor", async () => {
    sessao = OPERADOR;
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [linhaCaso({ id: 1 })], total: 1 });
    storageMock.clientesAtivosEmDia.mockResolvedValueOnce({
      linhas: [{ customerId: 77, nome: "Zelia Em Dia", cpfCnpj: "98765432100", statusErp: "active", telefone: null, cidade: "Ibipora", bairro: "Centro", contractStartDate: "2020-01-01" }],
      total: 546,
    });
    const res = await json("GET", "/api/cobranca/carteira?carteira=ativo&busca=zel&bairro=Centro");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(storageMock.clientesAtivosEmDia).toHaveBeenCalledWith(42, { busca: "zel", bairro: "Centro" }, { offset: 0, limite: 49 });
    expect(body.itens.map((i: any) => i.customerId)).toEqual([1, 77]);
    const emDia = body.itens[1];
    expect(emDia).toMatchObject({ nome: "Zelia Em Dia", dividaAtual: 0, diasAtraso: 0, caso: null, carteira: "ativo", documento: "987.654.321-00" });
    expect(body.total).toBe(1 + 546);
    expect(body.totais).toEqual({ casos: 1, semCaso: 0, emDia: 546 });

    // filtro de devedor (divida, etapa, status, saude, quadrante, responsavel) deixa o segmento de fora
    storageMock.clientesAtivosEmDia.mockClear();
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [], total: 0 });
    await json("GET", "/api/cobranca/carteira?carteira=ativo&divida=ate-100");
    expect(storageMock.clientesAtivosEmDia).not.toHaveBeenCalled();

    // e o espaco de ex-clientes nunca lista quem esta em dia
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [], total: 0 });
    await json("GET", "/api/cobranca/carteira?carteira=ex_cliente");
    expect(storageMock.clientesAtivosEmDia).not.toHaveBeenCalled();
  });

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

    expect(storageMock.kpisDaCobranca).toHaveBeenCalledWith(42, expect.any(Date), undefined);
    expect(storageMock.composicaoDaCarteira).toHaveBeenCalledWith(42, undefined);
    expect(storageMock.bairrosDaCarteira).toHaveBeenCalledWith(42, undefined);
    expect(storageMock.getPoliticaDeCobranca).toHaveBeenCalledWith(42);
    expect(storageMock.getCustomersByProvider).toHaveBeenCalledWith(42);
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, {}, { pagina: 1, porPagina: 50 });
    expect(storageMock.clientesParaAbrirCaso).toHaveBeenCalledWith(42, 0, expect.any(Number));

    expect(body.total).toBe(2);
    expect(body.itens).toHaveLength(2);
    const [comCaso, semCaso] = body.itens;
    // o documento do cliente DO PROVEDOR sai por extenso, pontuado
    expect(comCaso.documento).toBe("123.456.789-01");
    expect(JSON.stringify(body)).not.toContain("documentoMascarado");
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
      id: 1, documento: "123.456.789-01", whatsapp: "5531999990000",
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
    expect(body.cliente.cpfCnpj).toBe("123.456.789-01");
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
  it("follow-up: a proxima acao e a data vao para o caso na mesma chamada; string vazia apaga a acao", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ id: 9 }));
    const quando = emDias(1);
    const res = await json("POST", "/api/cobranca/casos/9/eventos", {
      tipo: "contato", canal: "telefone", resultado: "nao_atendeu", proximaAcao: "  Ligar de novo  ", proximoContatoEm: quando.toISOString(),
    });
    expect(res.status).toBe(201);
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({ casoId: 9, tipo: "contato", resultado: "nao_atendeu" }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 9, { proximoContatoEm: quando, proximaAcao: "Ligar de novo" }, 8);

    storageMock.atualizarCasoDeCobranca.mockClear();
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ id: 9 }));
    const apaga = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "contato", canal: "telefone", resultado: "falou", proximaAcao: "" });
    expect(apaga.status).toBe(201);
    // "falou" num caso aberto tambem MOVE o caso: as duas escritas vao no mesmo patch.
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 9, { status: "em_contato", proximaAcao: null }, 8);

    // longa demais e recusada pelo schema, antes de tocar o storage
    storageMock.atualizarCasoDeCobranca.mockClear();
    const longa = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "contato", canal: "telefone", resultado: "falou", proximaAcao: "x".repeat(121) });
    expect(longa.status).toBe(400);
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });

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

  /**
   * A ESTEIRA: o caso anda pelo trabalho feito. Registrar a conversa e o que
   * tira o caso de "ninguem ligou ainda" — o operador nao arrasta a mao o que
   * acabou de fazer.
   */
  it("contato que conversou move o caso aberto para em contato, sem evento a mais", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ id: 9, status: "aberto" }));
    const res = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "contato", canal: "telefone", resultado: "falou" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ movimento: { de: "aberto", para: "em_contato" } });
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 9, { status: "em_contato" }, 8);
    // Um evento so: o contato. `aberto -> em_contato` nao tem evento proprio
    // na maquina de estados — o contato registrado ja diz quem moveu e quando.
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledTimes(1);
  });

  it("tentativa nao move: nao atendeu, caixa postal, numero errado e recusou deixam o caso onde esta", async () => {
    sessao = OPERADOR;
    for (const resultado of ["nao_atendeu", "caixa_postal", "numero_errado", "recusou"]) {
      storageMock.atualizarCasoDeCobranca.mockClear();
      storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ id: 9, status: "aberto" }));
      const res = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "contato", canal: "telefone", resultado });
      expect(res.status, resultado).toBe(201);
      expect((await res.json()).movimento, resultado).toBeNull();
      expect(storageMock.atualizarCasoDeCobranca, resultado).not.toHaveBeenCalled();
    }
  });

  it("so o caso ABERTO anda pelo contato: em contato, negociando, acordo e negativado ficam", async () => {
    sessao = OPERADOR;
    for (const status of ["em_contato", "negociando", "acordo_ativo", "negativado"]) {
      storageMock.atualizarCasoDeCobranca.mockClear();
      storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ id: 9, status }));
      const res = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "contato", canal: "telefone", resultado: "falou" });
      expect(res.status, status).toBe(201);
      expect((await res.json()).movimento, status).toBeNull();
      expect(storageMock.atualizarCasoDeCobranca, status).not.toHaveBeenCalled();
    }
  });

  it("caso fechado nao e tocado: 409 antes de gravar contato ou mover coluna", async () => {
    sessao = OPERADOR;
    for (const status of ["pago", "baixado", "encerrado", "cancelamento"]) {
      storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ id: 9, status }));
      const res = await json("POST", "/api/cobranca/casos/9/eventos", { tipo: "contato", canal: "telefone", resultado: "falou" });
      expect(res.status, status).toBe(409);
    }
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("a promessa de pagamento move o caso e continua gravando a promessa, sem inventar outro status", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ id: 9, status: "aberto" }));
    const res = await json("POST", "/api/cobranca/casos/9/eventos", {
      tipo: "contato", canal: "whatsapp", resultado: "promessa_pagamento", promessaPara: daquiADias(3),
    });
    expect(res.status).toBe(201);
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({
      tipo: "contato", resultado: "promessa_pagamento", metadata: { promessaPara: daquiADias(3) },
    }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(42, 9, { status: "em_contato" }, 8);
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
    // 5% e o que a faixa de 31 a 60 dias da carteira ATIVA permite sem
    // aprovacao (politica de acordo, 0029) — acima disso o caso vira excecao
    // e nao nasce aceito, e este teste e sobre a parcela unica.
    const res = await json("POST", "/api/cobranca/casos/9/negociacoes", { tipo: "quitacao_desconto", valorNegociado: 380, aceita: true });
    expect(res.status).toBe(201);
    const [, dados, parcelas] = storageMock.criarNegociacao.mock.calls[0] as any[];
    expect(dados).toMatchObject({ descontoPct: 5, entrada: 0, aceita: true, primeiroVencimento: daquiADias(0) });
    expect(parcelas).toEqual([{ numero: 1, valor: 380, vencimento: daquiADias(0) }]);
  });
});

/**
 * A politica de ACORDO (0029) mede a proposta contra a faixa da CARTEIRA. O
 * envelope geral (`negociacao`) continua sendo o teto intransponivel; entre a
 * faixa e o teto de excecao a proposta entra, mas dependendo de alguem
 * aprovar — e por isso NAO nasce aceita, mesmo com "o cliente ja aceitou".
 */
describe("POST negociacoes — a faixa da carteira", () => {
  const negociacaoCriada = (extra: Record<string, unknown> = {}) => async (_p: number, dados: any, parcelas: any[]) => ({
    id: 5, providerId: 42, casoId: 9, customerId: 1, tipo: dados.tipo, valorOriginal: "400.00",
    valorNegociado: String(dados.valorNegociado), descontoPct: String(dados.descontoPct), entrada: String(dados.entrada ?? 0),
    parcelas: parcelas.length, valorParcela: null, primeiroVencimento: parcelas[0]?.vencimento ?? null,
    status: dados.aceita ? "aceita" : "proposta", criadoPorUserId: 8, aceitaEm: null, quebradaEm: null,
    createdAt: new Date(), updatedAt: new Date(), parcelamento: [], ...extra,
  });

  it("dentro da faixa passa e nao deixa nota de aprovacao", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    storageMock.criarNegociacao.mockImplementationOnce(negociacaoCriada());
    const res = await json("POST", "/api/cobranca/casos/9/negociacoes", { tipo: "quitacao_desconto", valorNegociado: 380 });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.exigeAprovacao).toBe(false);
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });

  it("acima da faixa e dentro do teto de excecao: entra como PROPOSTA, com nota pedindo aprovacao", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    storageMock.criarNegociacao.mockImplementationOnce(negociacaoCriada());
    const res = await json("POST", "/api/cobranca/casos/9/negociacoes", { tipo: "quitacao_desconto", valorNegociado: 340, aceita: true });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.exigeAprovacao).toBe(true);
    expect(body.motivosDaExcecao[0]).toMatch(/Desconto de 15% acima dos 5% da faixa de 31 a 60 dias/);
    // "o cliente ja aceitou" NAO fecha um acordo que depende de aprovacao
    expect((storageMock.criarNegociacao.mock.calls[0] as any[])[1].aceita).toBe(false);
    const [, dados] = storageMock.criarNegociacao.mock.calls[0] as unknown as [number, { aprovacao: unknown }];
    expect(dados.aprovacao).toMatchObject({ exigeAprovacao: true, carteira: "ativo" });
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });

  it("acima do teto de excecao e 422, com o limite na frase e nada gravado", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    // O provedor apertou a excecao dos ativos a 10%: 15% passa da faixa (5%) e
    // dela — e ainda cabe no envelope geral (20%), entao quem recusa e a faixa.
    const acordo = structuredClone(POLITICA_PADRAO.acordo);
    acordo.ativo.tetoDeExcecaoPct = 10;
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce({
      id: 1, providerId: 42, etapas: [], negociacao: POLITICA_PADRAO.negociacao, encargos: POLITICA_PADRAO.encargos,
      janelaContato: POLITICA_PADRAO.janelaContato, economia: POLITICA_PADRAO.economia, acordo,
      pausada: false, pausadaMotivo: null, updatedAt: new Date(),
    });
    const res = await json("POST", "/api/cobranca/casos/9/negociacoes", { tipo: "quitacao_desconto", valorNegociado: 340 });
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.violacoes[0]).toMatch(/teto de exceção de 10% para clientes ativos/);
    expect(storageMock.criarNegociacao).not.toHaveBeenCalled();
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });

  it("a MESMA proposta passa na carteira de ex-clientes: a faixa e outra", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ carteira: "ex_cliente", cliente: { ...linhaCaso().cliente, diasAtraso: 200 } }));
    storageMock.criarNegociacao.mockImplementationOnce(negociacaoCriada());
    const res = await json("POST", "/api/cobranca/casos/9/negociacoes", { tipo: "quitacao_desconto", valorNegociado: 340 });
    expect(res.status).toBe(201);
    expect((await res.json()).exigeAprovacao).toBe(false);
  });

  it("o envelope geral continua vindo primeiro: 50% de desconto e a frase da politica, nao a da faixa", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ carteira: "ex_cliente" }));
    const res = await json("POST", "/api/cobranca/casos/9/negociacoes", { tipo: "quitacao_desconto", valorNegociado: 200 });
    expect(res.status).toBe(422);
    expect((await res.json()).violacoes).toEqual(["Desconto de 50% excede o teto de 20% da política."]);
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
    expect(storageMock.atualizarStatusDaNegociacao).toHaveBeenCalledWith(42, 3, "aceita", 8, { podeAprovarExcecao: false });
    expect(storageMock.obterCasoDeCobranca).toHaveBeenCalledWith(42, 9);
    expect(body.negociacao.status).toBe("aceita");
    expect(body.caso.status).toBe("acordo_ativo");
  });
});

/**
 * O FREIO DA EXCECAO. A tela de politica promete que a proposta acima da faixa
 * "entra, mas fica esperando um administrador aprovar" — entao o operador que
 * propos nao pode ser quem aceita. A marca da excecao e a nota que o POST
 * grava (`metadata.exigeAprovacao`), lida da linha do tempo do caso.
 */
describe("PATCH negociacoes — aceitar uma proposta de EXCECAO", () => {
  const notaDeExcecao = (negociacaoId = 3) => [{
    id: 90, providerId: 42, casoId: 9, customerId: 1, userId: 8, tipo: "nota", canal: "sistema",
    resultado: null, notas: "Proposta #3 fora da faixa da politica",
    metadata: { exigeAprovacao: true, negociacaoId, motivos: ["Desconto de 15% acima dos 5% da faixa de 31 a 60 dias."], carteira: "ativo" },
    ocorridoEm: new Date(), createdAt: new Date(),
  }];
  const aceitaDoStorage = {
    id: 3, casoId: 9, customerId: 1, tipo: "quitacao_desconto", valorOriginal: "400.00", valorNegociado: "340.00",
    descontoPct: "15.00", entrada: "0.00", parcelas: 1, valorParcela: "340.00", primeiroVencimento: "2026-10-01",
    status: "aceita", criadoPorUserId: 8, aceitaEm: new Date(), quebradaEm: null, createdAt: new Date(), updatedAt: new Date(),
  };

  it("403 para o operador, com quem pode aprovar e o motivo da excecao — e nada muda no storage", async () => {
    sessao = OPERADOR;
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, casoId: 9, status: "proposta" });
    storageMock.atualizarStatusDaNegociacao.mockRejectedValueOnce(new ErroDeCobranca("APROVACAO_OBRIGATORIA", "Esta proposta exige aprovação de um administrador do provedor."));
    const res = await json("PATCH", "/api/cobranca/negociacoes/3", { casoId: 9, status: "aceita" });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.message).toMatch(/administrador do provedor/);
    expect(body.code).toBe("APROVACAO_OBRIGATORIA");
    expect(storageMock.atualizarStatusDaNegociacao).toHaveBeenCalledWith(42, 3, "aceita", 8, { podeAprovarExcecao: false });
    expect(storageMock.listarEventosDoCaso).not.toHaveBeenCalled();
  });

  it("o admin do provedor aceita a MESMA proposta, e a linha do tempo nem e consultada", async () => {
    sessao = ADMIN;
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, casoId: 9, status: "proposta" });
    storageMock.atualizarStatusDaNegociacao.mockResolvedValueOnce(aceitaDoStorage);
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ status: "acordo_ativo" }));
    const res = await json("PATCH", "/api/cobranca/negociacoes/3", { casoId: 9, status: "aceita" });
    expect(res.status).toBe(200);
    expect(storageMock.atualizarStatusDaNegociacao).toHaveBeenCalledWith(42, 3, "aceita", 7, { podeAprovarExcecao: true });
    expect(storageMock.listarEventosDoCaso).not.toHaveBeenCalled();
  });

  it("negociacao comum segue como antes: o operador aceita sozinho", async () => {
    sessao = OPERADOR;
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, casoId: 9, status: "proposta" });
    // A linha do tempo tem nota de OUTRA negociacao — nao e desta proposta.
    storageMock.atualizarStatusDaNegociacao.mockResolvedValueOnce(aceitaDoStorage);
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso({ status: "acordo_ativo" }));
    const res = await json("PATCH", "/api/cobranca/negociacoes/3", { casoId: 9, status: "aceita" });
    expect(res.status).toBe(200);
    expect(storageMock.atualizarStatusDaNegociacao).toHaveBeenCalledWith(42, 3, "aceita", 8, { podeAprovarExcecao: false });
  });

  it("o freio e so na entrada do acordo: o operador ainda cancela a propria proposta de excecao", async () => {
    sessao = OPERADOR;
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, casoId: 9, status: "proposta" });
    storageMock.atualizarStatusDaNegociacao.mockResolvedValueOnce({ ...aceitaDoStorage, status: "cancelada", aceitaEm: null });
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    const res = await json("PATCH", "/api/cobranca/negociacoes/3", { casoId: 9, status: "cancelada" });
    expect(res.status).toBe(200);
    expect(storageMock.listarEventosDoCaso).not.toHaveBeenCalled();
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
    expect(storageMock.marcarParcelaPaga).toHaveBeenCalledWith(42, 12, 100, expect.any(Date), 8, undefined);
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
    expect(storageMock.marcarParcelaPaga).toHaveBeenCalledWith(42, 12, 50, expect.any(Date), 8, undefined);
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
    expect(storageMock.marcarParcelaPaga).toHaveBeenCalledWith(42, 12, 106.68, expect.any(Date), 8, undefined);
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
    expect(body.itens[0].cliente.cpfCnpj).toBe("123.456.789-01");
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
  it("devolve os indicadores sobre o mesmo recorte das colunas (casos vivos, em aberto, vencidos, para hoje, criticos)", async () => {
    sessao = OPERADOR;
    storageMock.fluxoDaEsteira.mockResolvedValueOnce({ entraram: 3, resolvidos: 1 });
    const ontem = new Date(Date.now() - 86_400_000);
    storageMock.listarCasosDeCobranca.mockImplementation(async (_p: number, filtros: any): Promise<any> => {
      if (filtros?.status === "todos" || Array.isArray(filtros?.status)) return { linhas: [], total: 0 };
      return {
        linhas: [
          linhaCaso({ id: 1, valorAtual: 100, proximoContatoEm: ontem, prioridade: "critica" }),
          linhaCaso({ id: 2, valorAtual: 50.5, proximoContatoEm: null }),
        ],
        total: 2,
      };
    });
    const res = await json("GET", "/api/cobranca/kanban");
    const body = await res.json();
    expect(res.status).toBe(200);
    // follow-up: o caso 2 nao tem data — e caso PARADO, nao "para hoje"
    // criticos: o indicador que so a fila tinha, contado na MESMA varredura
    expect(body.kpis).toEqual({
      casosVivos: 2, emAberto: 150.5, vencidos: 1, paraHoje: 1, semProximaAcao: 1, criticos: 1,
      // fluxo do dia: agregacao propria, no mesmo recorte, desde a meia-noite local
      entraramHoje: 3, resolvidosHoje: 1,
    });
    const [, filtrosDoFluxo, desde] = storageMock.fluxoDaEsteira.mock.calls[0] as any[];
    expect(filtrosDoFluxo).toEqual({});
    expect(desde.getHours()).toBe(0);
    expect(desde.getMinutes()).toBe(0);
    expect(body.kpisMotivo).toBeNull();
    // uma varredura so: nove colunas + a dos indicadores
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledTimes(10);
    storageMock.listarCasosDeCobranca.mockReset();
    storageMock.listarCasosDeCobranca.mockResolvedValue({ linhas: [], total: 0 });
  });

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
    storageMock.listarCasosDeCobranca.mockImplementation(async (_p: number, filtros: any) => (filtros.status ? porStatus[filtros.status[0]] : undefined) ?? { linhas: [], total: 0 });

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

    // vivas: uma pagina de `porColuna` na ORDEM DO DIA (vencido, hoje, sem data, agendado);
    // fechadas: varredura de 200 na ordem padrao, porque ali a ordem e a do encerramento.
    const filtrosDaBarra = { carteira: "ativo", etapa: "lembrete_atraso", busca: "maria", responsavelUserId: null };
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, { ...filtrosDaBarra, status: ["aberto"] }, { pagina: 1, porPagina: 50, ordem: "dia", hoje: expect.any(Date) });
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, { ...filtrosDaBarra, status: ["pago"] }, { pagina: 1, porPagina: 200 });
    // uma chamada por coluna + a varredura dos indicadores (sem `status`)
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledTimes(ORDEM_ESPERADA.length + 1);

    // o card e a linha da fila: documento mascarado, selo da regua e tom de agora
    const card = coluna("aberto").casos[0];
    expect(card.cliente.cpfCnpj).toBe("123.456.789-01");
    expect(card.regua).toMatchObject({ etapa: "negociacao_recuperacao" });
    expect(card).toMatchObject({ quadrante: "B3", tomSugerido: "cuidado" });
    expect(JSON.stringify(body)).not.toContain("12345678901");
  });

  it("coluna viva acima de porColuna vem truncada com o total exato; responsavel=eu e o usuario da sessao", async () => {
    sessao = OPERADOR;
    storageMock.listarCasosDeCobranca.mockImplementation(async (_p: number, filtros: any) =>
      filtros.status?.[0] === "aberto" ? { linhas: [linhaCaso({ id: 1 }), linhaCaso({ id: 2 })], total: 7200 } : { linhas: [], total: 0 });
    const res = await json("GET", "/api/cobranca/kanban?responsavel=eu&porColuna=2");
    const body = await res.json();
    expect(res.status).toBe(200);
    const aberto = body.colunas.find((c: any) => c.status === "aberto");
    expect(aberto).toMatchObject({ total: 7200, truncado: true });
    expect(aberto.casos).toHaveLength(2);
    expect(body.total).toBe(7200);
    // "Minha fila" no quadro e MEUS + a fila geral (o que a tela de fila fazia):
    // com o filtro exato por dono, o caso sem responsavel sumia e "Pegar para
    // mim" nunca aparecia no escopo padrao.
    expect(storageMock.listarCasosDeCobranca).toHaveBeenCalledWith(42, { meusMaisFilaGeral: 8, status: ["aberto"] }, { pagina: 1, porPagina: 2, ordem: "dia", hoje: expect.any(Date) });
  });

  it("o fluxo indisponivel vira null nos indicadores — a tela mostra \"—\", nunca zero", async () => {
    sessao = OPERADOR;
    storageMock.fluxoDaEsteira.mockRejectedValueOnce(new Error("timeout"));
    const res = await json("GET", "/api/cobranca/kanban");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.kpis.entraramHoje).toBeNull();
    expect(body.kpis.resolvidosHoje).toBeNull();
    expect(body.kpis.casosVivos).toBe(0);
  });

  it("cada card diz ha quantos dias esta parado na coluna, contado no servidor", async () => {
    sessao = OPERADOR;
    storageMock.listarCasosDeCobranca.mockImplementation(async (_p: number, filtros: any) =>
      filtros.status?.[0] === "aberto"
        ? {
            linhas: [
              linhaCaso({ id: 1, statusDesde: emDias(-3) }),
              linhaCaso({ id: 2, statusDesde: new Date() }),
              // Replica sem a 0030: sem a data, o card nao inventa "0 dias".
              linhaCaso({ id: 3, statusDesde: null }),
            ],
            total: 3,
          }
        : { linhas: [], total: 0 });
    const res = await json("GET", "/api/cobranca/kanban");
    const body = await res.json();
    const casos = body.colunas.find((c: any) => c.status === "aberto").casos;
    expect(casos.map((c: any) => c.diasNoStatus)).toEqual([3, 0, null]);
    expect(typeof casos[0].statusDesde).toBe("string");
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

  /**
   * A politica de ACORDO (0029) e a `economia` viajam no mesmo PUT. A
   * `economia` estava FORA da lista de chaves aceitas: a tela de politica
   * manda os custos em todo PUT, entao o corpo inteiro voltava 400 "campo
   * desconhecido" — nem custo nem pausa gravavam por essa tela.
   */
  it("aceita `economia` e `acordo` no mesmo PUT — as duas sao parte da politica", async () => {
    sessao = ADMIN;
    const acordo = structuredClone(POLITICA_PADRAO.acordo);
    acordo.ex_cliente.origemDaCobranca = "asaas";
    const economia = { ...POLITICA_PADRAO.economia, cac: 180, confirmado: true };
    const res = await json("PUT", "/api/cobranca/politica", { ...corpoValido, economia, acordo });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.politica.acordo.ex_cliente.origemDaCobranca).toBe("asaas");
    expect(body.politica.economia).toMatchObject({ cac: 180, confirmado: true });
    expect(storageMock.upsertPoliticaDeCobranca).toHaveBeenCalledWith(42, expect.objectContaining({
      acordo: expect.objectContaining({ ex_cliente: expect.objectContaining({ origemDaCobranca: "asaas" }) }),
      economia: expect.objectContaining({ cac: 180 }),
    }));
  });

  /**
   * A origem `erp` existe no vocabulario e o `<select>` a mostra desabilitada
   * — mas quem RECUSA e o servidor, como no `naoImplementado` dos conectores.
   * Sem isto um PUT por curl gravava `erp` e dali saiam ofertas com desconto
   * para um canal onde nenhum conector escreve cobranca.
   */
  it("400 ao gravar origem indisponivel (`erp`), com a mesma frase da tela — e nada e gravado", async () => {
    sessao = ADMIN;
    const acordo = structuredClone(POLITICA_PADRAO.acordo);
    acordo.ativo.origemDaCobranca = "erp" as never;
    const res = await json("PUT", "/api/cobranca/politica", { ...corpoValido, acordo });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.errors["acordo.ativo.origemDaCobranca"]).toEqual([ORIGEM_INDISPONIVEL.erp]);
    expect(storageMock.upsertPoliticaDeCobranca).not.toHaveBeenCalled();
  });

  it("o acordo e puxado ao envelope geral, com a frase do porque", async () => {
    sessao = ADMIN;
    const acordo = structuredClone(POLITICA_PADRAO.acordo);
    acordo.ex_cliente.faixas = [{ acimaDeDias: 0, ateDias: null, descontoMaxPct: 90, maxParcelas: 24, entradaMinimaPct: 20 }];
    const res = await json("PUT", "/api/cobranca/politica", { ...corpoValido, acordo });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.politica.acordo.ex_cliente.faixas[0]).toMatchObject({ descontoMaxPct: 30, maxParcelas: 10 });
    expect(body.ajustes.join(" ")).toMatch(/teto geral da negociação/);
  });

  it("400 quando as faixas do acordo deixam um atraso sem cobertura", async () => {
    sessao = ADMIN;
    const acordo = structuredClone(POLITICA_PADRAO.acordo);
    acordo.ativo.faixas = [{ acimaDeDias: 0, ateDias: 30, descontoMaxPct: 0, maxParcelas: 1, entradaMinimaPct: 100 }];
    const res = await json("PUT", "/api/cobranca/politica", { ...corpoValido, acordo });
    expect(res.status).toBe(400);
    expect((await res.json()).errors["acordo.ativo.faixas"][0]).toMatch(/acima de 30 dias/);
    expect(storageMock.upsertPoliticaDeCobranca).not.toHaveBeenCalled();
  });

  it("a politica GRAVADA e lida inteira: os custos confirmados e o acordo do provedor chegam a tela", async () => {
    sessao = OPERADOR;
    const acordo = structuredClone(POLITICA_PADRAO.acordo);
    acordo.ativo.origemDaCobranca = "manual";
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce({
      id: 1, providerId: 42, etapas: [], negociacao: POLITICA_PADRAO.negociacao, encargos: POLITICA_PADRAO.encargos,
      janelaContato: POLITICA_PADRAO.janelaContato, economia: { ...POLITICA_PADRAO.economia, cac: 199, confirmado: true },
      acordo, pausada: false, pausadaMotivo: null, updatedAt: new Date(),
    });
    const body = await (await json("GET", "/api/cobranca/politica")).json();
    expect(body.politica.economia).toMatchObject({ cac: 199, confirmado: true });
    expect(body.politica.acordo.ativo.origemDaCobranca).toBe("manual");
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

/* ── Detalhe do caso ─────────────────────────────────────────────────── */

/**
 * `GET /api/cobranca/casos/:id/detalhe` — a resposta unica que o painel abre
 * quando o operador clica no card do quadro (pedido do dono, 06/09/2026).
 *
 * O que se prova aqui:
 *   · sem sessao nao passa, e caso de outro provedor e 404 ANTES de qualquer
 *     leitura por customerId;
 *   · o documento sai mascarado, como em toda rota de cobranca;
 *   · sem fatura gravada a origem e DECLARADA com motivo, e o vencimento mais
 *     antigo e null — nunca "hoje menos os dias de atraso";
 *   · a ordem das faturas e a do storage, sem reordenacao no meio do caminho;
 *   · uma chamada por lista, nenhuma por linha.
 */
describe("GET /api/cobranca/casos/:id/detalhe", () => {
  const faturasGravadas = {
    linhas: [
      { id: 30, erpSource: "mk", erpRef: "553", vencimento: new Date("2026-09-10T00:00:00Z"), valor: 99.9, descricao: "Setembro", status: "aberta", baixadaEm: null },
      { id: 20, erpSource: "mk", erpRef: "552", vencimento: new Date("2026-08-10T00:00:00Z"), valor: 99.9, descricao: "Agosto", status: "aberta", baixadaEm: null },
      { id: 10, erpSource: "mk", erpRef: "551", vencimento: new Date("2026-07-10T00:00:00Z"), valor: 200.2, descricao: "Julho", status: "baixada_no_erp", baixadaEm: new Date("2026-08-01T00:00:00Z") },
    ],
    total: 3, limite: 200, doErp: 3, vencidas: 2, valorVencido: 199.8,
    vencimentoMaisAntigo: new Date("2026-08-10T00:00:00Z"),
  };

  it("401 sem sessao, e nada e lido", async () => {
    sessao = {};
    const res = await json("GET", "/api/cobranca/casos/9/detalhe");
    expect(res.status).toBe(401);
    expect(storageMock.obterCasoDeCobranca).not.toHaveBeenCalled();
    expect(storageMock.faturasDoCliente).not.toHaveBeenCalled();
  });

  it("404 para caso de outro provedor — e as faturas nem chegam a ser lidas", async () => {
    sessao = ADMIN;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(undefined);
    const res = await json("GET", "/api/cobranca/casos/9/detalhe");
    expect(res.status).toBe(404);
    expect(storageMock.obterCasoDeCobranca).toHaveBeenCalledWith(42, 9);
    expect(storageMock.faturasDoCliente).not.toHaveBeenCalled();
    expect(storageMock.listarEventosDoCaso).not.toHaveBeenCalled();
  });

  it("400 quando o id nao e id", async () => {
    sessao = ADMIN;
    expect((await json("GET", "/api/cobranca/casos/zero/detalhe")).status).toBe(400);
    expect(storageMock.obterCasoDeCobranca).not.toHaveBeenCalled();
  });

  it("uma resposta so, com o documento mascarado e as faturas na ordem do storage", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    storageMock.faturasDoCliente.mockResolvedValueOnce(faturasGravadas);
    storageMock.listarEventosDoCaso.mockResolvedValueOnce([
      { id: 2, casoId: 9, userId: 8, tipo: "contato", canal: "telefone", resultado: "falou", ocorridoEm: emDias(-1) },
      { id: 1, casoId: 9, userId: null, tipo: "etapa_mudou", canal: "sistema", ocorridoEm: emDias(-4) },
    ]);
    storageMock.listarNegociacoesDoCaso.mockResolvedValueOnce([
      {
        id: 4, casoId: 9, customerId: 1, tipo: "parcelamento", valorOriginal: "400.00", valorNegociado: "400.00",
        descontoPct: "0", entrada: "0", parcelas: 2, valorParcela: "200.00", primeiroVencimento: "2026-10-10",
        status: "proposta", criadoPorUserId: 8, aceitaEm: null, quebradaEm: null, createdAt: emDias(-1), updatedAt: emDias(-1),
        parcelamento: [{ id: 40, negociacaoId: 4, numero: 1, valor: "200.00", vencimento: "2026-10-10", pagoEm: null, valorPago: null, status: "aberta" }],
      },
    ]);
    storageMock.getUsersByProvider.mockResolvedValueOnce(equipe);

    const res = await json("GET", "/api/cobranca/casos/9/detalhe");
    const body = await res.json();
    expect(res.status).toBe(200);

    // Toda leitura leva o provedor da sessao, e cada lista sai de UMA chamada.
    expect(storageMock.faturasDoCliente).toHaveBeenCalledWith(42, 1, { limite: 200 });
    expect(storageMock.faturasDoCliente).toHaveBeenCalledTimes(1);
    expect(storageMock.listarEventosDoCaso).toHaveBeenCalledWith(42, 9);
    expect(storageMock.listarNegociacoesDoCaso).toHaveBeenCalledWith(42, 9);
    expect(storageMock.listarNegociacoesDoCaso).toHaveBeenCalledTimes(1);

    // O documento do proprio cliente sai por extenso, pontuado (decisao de 06/09/2026).
    expect(body.caso.cliente.cpfCnpj).toBe("123.456.789-01");
    expect(body.caso.cliente.documento).toBe("123.456.789-01");
    expect(JSON.stringify(body)).not.toContain("documentoMascarado");
    expect(JSON.stringify(body)).not.toContain("hash-secreto");

    // A divida diz de onde vem cada numero.
    expect(body.divida).toMatchObject({
      valorAtual: 400, diasAtraso: 45, faturasVencidas: 2, origem: "agregado_do_sync",
      motivoSemVencimento: null, porFatura: { vencidas: 2, valor: 199.8 },
    });
    expect(body.divida.vencimentoMaisAntigo).toBe("2026-08-10T00:00:00.000Z");

    // As faturas, na ordem do storage — da mais recente para a mais antiga.
    expect(body.faturas.origem).toBe("erp");
    expect(body.faturas.motivo).toBeNull();
    expect(body.faturas.total).toBe(3);
    expect(body.faturas.linhas.map((f: any) => f.erpRef)).toEqual(["553", "552", "551"]);
    expect(body.faturas.linhas[0]).toMatchObject({ id: 30, valor: 99.9, status: "aberta", descricao: "Setembro" });
    expect(body.faturas.linhas[2]).toMatchObject({ status: "baixada_no_erp" });
    // Fatura NAO e boleto: nada de linha digitavel nem PIX nesta resposta.
    for (const chave of ["linhaDigitavel", "pix", "codigoDeBarras", "link"]) {
      expect(body.faturas.linhas[0]).not.toHaveProperty(chave);
    }

    // O historico, com quem registrou.
    expect(body.eventos.total).toBe(2);
    expect(body.eventos.linhas[0].usuarioNome).toBe("Beto");
    expect(body.eventos.linhas[1].usuarioNome).toBeNull();

    expect(body.negociacoes[0]).toMatchObject({ id: 4, valorNegociado: 400, parcelas: 2 });
    expect(body.negociacoes[0].parcelamento[0]).toMatchObject({ numero: 1, valor: 200 });
  });

  it("sem fatura gravada: a origem e declarada com motivo, e o vencimento mais antigo e NULO", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    const res = await json("GET", "/api/cobranca/casos/9/detalhe");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.faturas.linhas).toEqual([]);
    expect(body.faturas.total).toBe(0);
    expect(body.faturas.origem).toBe("indisponivel");
    expect(body.faturas.motivo).toMatch(/ainda nao gravou fatura a fatura/);
    // A divida agregada continua sendo mostrada — o que NAO existe e a data.
    expect(body.divida.valorAtual).toBe(400);
    expect(body.divida.vencimentoMaisAntigo).toBeNull();
    expect(body.divida.motivoSemVencimento).toMatch(/ainda nao gravou fatura a fatura/);
    expect(body.divida.porFatura).toBeNull();
  });

  it("fatura so de importacao CSV nao se passa por dado do ERP", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    storageMock.faturasDoCliente.mockResolvedValueOnce({
      linhas: [{ id: 1, erpSource: null, erpRef: null, vencimento: new Date("2026-08-10T00:00:00Z"), valor: 50, descricao: null, status: "overdue", baixadaEm: null }],
      total: 1, limite: 200, doErp: 0, vencidas: 1, valorVencido: 50, vencimentoMaisAntigo: new Date("2026-08-10T00:00:00Z"),
    });
    const body = await (await json("GET", "/api/cobranca/casos/9/detalhe")).json();
    expect(body.faturas.origem).toBe("importacao");
    expect(body.faturas.motivo).toMatch(/importacao CSV/);
  });

  it("o historico para no teto e diz quantos existem", async () => {
    sessao = OPERADOR;
    storageMock.obterCasoDeCobranca.mockResolvedValueOnce(linhaCaso());
    storageMock.listarEventosDoCaso.mockResolvedValueOnce(
      Array.from({ length: 250 }, (_, i) => ({ id: i + 1, casoId: 9, userId: null, tipo: "nota", ocorridoEm: emDias(-i) })),
    );
    const body = await (await json("GET", "/api/cobranca/casos/9/detalhe")).json();
    expect(body.eventos.linhas).toHaveLength(200);
    expect(body.eventos.total).toBe(250);
    expect(body.eventos.limite).toBe(200);
  });
});

describe("o plano do ERP (contract_plan, 0036) chega aos itens da carteira — casos, candidatos e em dia", () => {
  it("caso: o plano da linha; candidato: o plano do storage; em dia: idem; ausente = null, nunca texto inventado", async () => {
    sessao = OPERADOR;
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [linhaCaso({ id: 1, cliente: { ...linhaCaso().cliente, id: 1, plano: "Smart 700MB" } })], total: 1 });
    storageMock.clientesParaAbrirCaso.mockResolvedValueOnce([
      { customerId: 3, nome: "Sem plano", cpfCnpj: "111", statusErp: "active", carteira: "ativo", dividaAtual: 50, diasAtraso: 10, faturasAbertas: 1, contractStartDate: null, plano: null },
      { customerId: 4, nome: "Com plano", cpfCnpj: "222", statusErp: "active", carteira: "ativo", dividaAtual: 60, diasAtraso: 12, faturasAbertas: 1, contractStartDate: null, plano: "Fibra 500" },
    ]);
    storageMock.clientesAtivosEmDia.mockResolvedValueOnce({ linhas: [{ customerId: 5, nome: "Em dia", cpfCnpj: "333", statusErp: "active", telefone: null, cidade: null, bairro: null, contractStartDate: null, plano: "Smart 1000" }], total: 1 });
    const body = await (await json("GET", "/api/cobranca/carteira?carteira=ativo")).json();
    const porId = new Map(body.itens.map((i: any) => [i.customerId, i.plano]));
    expect(porId.get(1)).toBe("Smart 700MB");
    expect(porId.get(3)).toBeNull();
    expect(porId.get(4)).toBe("Fibra 500");
    expect(porId.get(5)).toBe("Smart 1000");
  });
});

describe("acordo × confissão e os selos", () => {
  it("cancelar ou quebrar negociação com confissão enviada cancela a confissão ANTES; se o ZapSign falhar, a negociação não muda", async () => {
    sessao = ADMIN;
    storageMock.obterNegociacao.mockResolvedValue({ id: 3, casoId: 9, status: "aceita" });
    storageMock.atualizarStatusDaNegociacao.mockResolvedValue({ id: 3, casoId: 9, status: "cancelada" });
    storageMock.confissaoEnviadaDaNegociacao.mockResolvedValueOnce({ id: 77, status: "enviada" });
    expect((await json("PATCH", "/api/cobranca/negociacoes/3", { status: "cancelada" })).status).toBe(200);
    expect(retornoMock.cancelarConfissao).toHaveBeenCalledWith(42, 77, 7);
    expect(retornoMock.cancelarConfissao.mock.invocationCallOrder[0]).toBeLessThan(storageMock.atualizarStatusDaNegociacao.mock.invocationCallOrder[0]);
    vi.clearAllMocks();
    storageMock.obterNegociacao.mockResolvedValue({ id: 3, casoId: 9, status: "aceita" });
    storageMock.confissaoEnviadaDaNegociacao.mockResolvedValueOnce({ id: 77, status: "enviada" });
    const { ErroDeConfissao } = await import("../assinatura/erro");
    retornoMock.cancelarConfissao.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "fora", 502));
    const r = await json("PATCH", "/api/cobranca/negociacoes/3", { status: "quebrada" });
    expect(r.status).toBe(502);
    expect((await r.json()).message).toContain("confissão de dívida ligada a este acordo");
    expect(storageMock.atualizarStatusDaNegociacao).not.toHaveBeenCalled();
  });
  it("romper o acordo com a confissão sumida do ZapSign (404): 409 dizendo o que fazer, e nem a negociação nem a confissão mudam", async () => {
    // Qualquer operador rompe acordo (a rota não pede papel). Abrir mão de um
    // título que pode ter sido assinado na conta antiga é decisão SÓ do admin,
    // pela rota de cancelar a confissão — esta rota nunca pede essa saída.
    sessao = OPERADOR;
    storageMock.obterNegociacao.mockResolvedValue({ id: 3, casoId: 9, status: "aceita" });
    storageMock.confissaoEnviadaDaNegociacao.mockResolvedValueOnce({ id: 77, status: "enviada" });
    const { ErroDeConfissao } = await import("../assinatura/erro");
    retornoMock.cancelarConfissao.mockRejectedValueOnce(new ErroDeConfissao("NAO_ENCONTRADA", "O documento não existe no ZapSign", 404));
    const r = await json("PATCH", "/api/cobranca/negociacoes/3", { status: "quebrada" });
    expect(r.status).toBe(409);
    expect((await r.json()).message).toBe("A confissão desta negociação não foi encontrada no ZapSign. Um administrador precisa cancelá-la no Cliente 360 antes de romper o acordo.");
    expect(retornoMock.cancelarConfissao.mock.calls).toEqual([[42, 77, 8]]);
    expect(storageMock.atualizarStatusDaNegociacao).not.toHaveBeenCalled();
  });
  it("a lista da carteira e o 360 carregam o selo da confissão assinada viva", async () => {
    sessao = ADMIN;
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [linhaCaso()], total: 1 });
    storageMock.confissoesAssinadasVivasPorCliente.mockResolvedValueOnce(new Map([[linhaCaso().cliente.id, { id: 77, assinadaEm: new Date("2026-09-01T12:00:00Z"), valorTotal: 819.76, ambiente: "producao" }]]));
    const lista = await (await json("GET", "/api/cobranca/carteira?carteira=ativo")).json();
    expect(lista.itens[0].confissao).toEqual({ id: 77, assinadaEm: "2026-09-01T12:00:00.000Z", valorTotal: 819.76, ambiente: "producao" });
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
    // Fronteira de fuso: 2026-09-02T01:00:00Z = 01/09 22h em Brasilia (UTC-3).
    // O dia UTC ja e 02/09; o dia de Brasilia, que e o que vale para a
    // interrupcao da prescricao, ainda e 01/09.
    storageMock.confissaoAssinadaVivaDoCliente.mockResolvedValueOnce({ id: 77, assinadaEm: new Date("2026-09-02T01:00:00Z"), valorTotal: "819.76", ambiente: "producao" });
    const ficha = await (await json("GET", `/api/cobranca/clientes/${clienteMaria.id}/360`)).json();
    // `confissaoAssinada`, e nao `confissaoViva`: "viva" e rascunho|enviada (`confissaoViva()` em shared/cobranca/confissao.ts).
    expect(ficha.confissaoAssinada).toEqual({ id: 77, assinadaEm: "2026-09-02T01:00:00.000Z", valorTotal: 819.76, ambiente: "producao" });
    expect(ficha).not.toHaveProperty("confissaoViva");
    expect(ficha.fichaEntrada.confissaoAssinadaEm).toBe("2026-09-01");
    expect(ficha.ficha.prescricao.interrompida_em).toBe("2026-09-01");
  });
  it("só o título de PRODUÇÃO interrompe a prescrição; o selo prefere a produção e o TESTE só aparece sem título de produção", async () => {
    // O dono testa o ZapSign em sandbox num cliente REAL da carteira (a base vem
    // do ERP): a ficha dele não pode declarar "prescrição interrompida" por um
    // documento sem validade jurídica. A escolha do selo é a regra real
    // (`confissaoDoSelo`, a mesma que o storage aplica sobre as linhas do cliente).
    sessao = ADMIN;
    const { confissaoDoSelo } = await import("@shared/cobranca/confissao");
    const ficha360 = async (linhas: Array<{ id: number; status: string; ambiente: string; assinadaEm: Date; valorTotal: string }>) => {
      storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteMaria]);
      storageMock.confissaoAssinadaVivaDoCliente.mockImplementationOnce(async () => confissaoDoSelo(linhas) ?? undefined);
      return (await json("GET", `/api/cobranca/clientes/${clienteMaria.id}/360`)).json();
    };
    const TESTE_12_09 = { id: 90, status: "assinada", ambiente: "sandbox", assinadaEm: new Date("2026-09-12T15:00:00Z"), valorTotal: "10.00" };

    // 1. Só o teste de sandbox: selo TESTE, prescrição NÃO interrompida.
    const soTeste = await ficha360([TESTE_12_09]);
    expect(soTeste.confissaoAssinada).toMatchObject({ id: 90, ambiente: "sandbox" });
    expect(soTeste.fichaEntrada.confissaoAssinadaEm).toBeNull();
    expect(soTeste.ficha.prescricao?.interrompida_em ?? null).toBeNull();

    // 2. Título de produção de 01/08 + teste de 12/09: o título é o selo e a data.
    const comTitulo = await ficha360([TESTE_12_09, { id: 70, status: "assinada", ambiente: "producao", assinadaEm: new Date("2026-08-01T15:00:00Z"), valorTotal: "819.76" }]);
    expect(comTitulo.confissaoAssinada).toMatchObject({ id: 70, ambiente: "producao" });
    expect(comTitulo.fichaEntrada.confissaoAssinadaEm).toBe("2026-08-01");
    expect(comTitulo.ficha.prescricao.interrompida_em).toBe("2026-08-01");

    // 3. Título de produção quitado + teste mais antigo: nenhum selo e nenhuma interrupção.
    const quitado = await ficha360([{ id: 71, status: "quitada", ambiente: "producao", assinadaEm: new Date("2026-08-02T15:00:00Z"), valorTotal: "500.00" }, { ...TESTE_12_09, id: 60, assinadaEm: new Date("2026-07-20T15:00:00Z") }]);
    expect(quitado.confissaoAssinada).toBeNull();
    expect(quitado.fichaEntrada.confissaoAssinadaEm).toBeNull();
    expect(quitado.ficha.prescricao?.interrompida_em ?? null).toBeNull();
  });
});
