import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

/**
 * O storage da cobranca, provado pelo SQL que ele emite.
 *
 * Duas coisas aqui nao podem depender de ninguem lembrar:
 *
 *   1. TODA consulta filtra por `provider_id` — a tabela alvo, cada subquery,
 *      cada insert. A cobranca e o modulo que mais escreve sobre dado pessoal
 *      (nome, documento, telefone, divida, o que o funcionario anotou da
 *      ligacao); uma consulta sem o filtro mostra a carteira de um provedor
 *      para o operador de outro. O teste varre os metodos um a um e le o SQL.
 *
 *   2. Negociacao e parcelas nascem na MESMA transacao, e o caso e o evento
 *      vao junto. Uma proposta de 6x sem as 6 linhas nao e uma proposta.
 *
 * O Postgres nao entra. O `db` e o driver `pg-proxy` do proprio Drizzle: o
 * query builder REAL compila cada consulta e entrega texto + parametros a um
 * callback, que aqui grava tudo e responde com linhas combinadas. E um banco
 * de mentira que nao avalia WHERE nenhum — ele so devolve o que o teste
 * mandou — mas e o SQL de verdade, o mesmo que iria para o Postgres.
 *
 * O `pg-proxy` nao suporta transacao (lanca "Transactions are not supported");
 * o `transaction` e substituido por um que marca "dentro" e chama o callback
 * com o mesmo db — o que basta para provar que os writes acontecem la dentro.
 */
const banco = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[]; method: string; dentroDaTransacao: boolean }[],
  /** nome da tabela -> linhas (chaves camelCase, valores no formato do DRIVER: timestamp como texto, decimal como texto). */
  linhas: new Map<string, Record<string, unknown>[]>(),
  /** resposta para consultas agregadas (count, sum), que o simulador nao sabe montar sozinho. */
  agregados: [] as Array<{ quando: RegExp; linha: unknown[] }>,
  /** consultas que devem responder VAZIO (returning sem linha, select sem resultado), por regex no SQL. */
  vazias: [] as RegExp[],
  transacoes: 0,
  dentro: false,
  db: null as any,
}));

vi.mock("../db", () => ({
  // Proxy porque o banco de mentira so pode ser montado DEPOIS dos imports (ele
  // precisa do schema), e `vi.mock` corre antes de todos eles.
  db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }),
  pool: {},
}));

import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";

describe("indicadores e fila por carteira", () => {
  it.each(["ativo", "ex_cliente"] as const)("restringe contatos, parcelas, casos e entradas a %s", async carteira => {
    await storage.kpisDaCobranca(PROVEDOR, new Date(2026, 8, 6), carteira);
    const [saldo, ...movimentos] = banco.consultas;
    expect(saldo.sql).toMatch(/where .*"customers"\."status"/);
    expect(movimentos).toHaveLength(4);
    for (const consulta of movimentos) {
      expect(consulta.sql).toContain('"cobranca_casos"."carteira"');
      expect(consulta.params).toContain(carteira);
      expect(consulta.params).toContain(PROVEDOR);
    }
  });

  it.each(["ativo", "ex_cliente"] as const)("a fila restringe %s antes do limite", async carteira => {
    await storage.filaDeCobranca(PROVEDOR, { carteira, limite: 20 });
    expect(banco.consultas[0].sql).toContain('"cobranca_casos"."carteira"');
    expect(banco.consultas[0].params).toContain(carteira);
  });

  it("os bairros de ex-clientes excluem os contratos atuais no banco", async () => {
    await storage.bairrosDaCarteira(PROVEDOR, "ex_cliente");
    expect(banco.consultas[0].sql).toMatch(/not \("customers"\."status" in/);
  });
});
import {
  cobrancaCasos, cobrancaEventos, cobrancaNegociacoes, cobrancaParcelas, cobrancaPolitica, customers, users,
  CARTEIRAS_DE_COBRANCA, POLITICA_DE_COBRANCA_PADRAO, STATUS_CASO_COBRANCA, STATUS_CASO_FECHADO,
} from "@shared/schema";
import {
  CobrancaStorage, ErroDeCobranca, MOTIVO_NOTA_DNA_ARBITRADO,
  carteiraDoStatusErp, PRIORIDADES_DE_CASO, STATUS_DE_CLIENTE_ATUAL, STATUS_NEGOCIACAO,
} from "./cobranca.storage";
import { CustomersStorage, dataSemHora } from "./customers.storage";

const PROVEDOR = 6;
const OUTRO_PROVEDOR = 9;
const OPERADOR = 3;

const TABELAS = [cobrancaCasos, cobrancaEventos, cobrancaNegociacoes, cobrancaParcelas, cobrancaPolitica, customers, users];
const tabelaPorNome = new Map(TABELAS.map(t => [getTableName(t), t]));
const chavePorColuna = new Map(
  TABELAS.map(t => [
    getTableName(t),
    new Map(Object.entries(getTableColumns(t)).map(([chave, coluna]) => [(coluna as any).name as string, chave])),
  ]),
);

function tabelaAlvo(sqlTexto: string): string {
  const m = sqlTexto.match(/^insert into "(\w+)"/) ?? sqlTexto.match(/^update "(\w+)"/) ?? sqlTexto.match(/ from "(\w+)"/);
  return m?.[1] ?? "";
}

/**
 * A lista de colunas que a consulta devolve, na ordem. `null` quando ha uma
 * expressao (count, coalesce, case) — ai a resposta vem de `banco.agregados`.
 */
function colunasDevolvidas(sqlTexto: string): Array<{ tabela: string | null; coluna: string }> | null {
  let lista: string | undefined;
  const ret = sqlTexto.match(/ returning (.+)$/);
  if (ret) lista = ret[1];
  else if (sqlTexto.startsWith("select ")) lista = sqlTexto.slice(7, sqlTexto.indexOf(" from "));
  if (!lista) return null;
  const itens: Array<{ tabela: string | null; coluna: string }> = [];
  for (const item of lista.split(", ")) {
    const c = item.match(/^(?:"(\w+)"\.)?"(\w+)"$/);
    if (!c) return null;
    itens.push({ tabela: c[1] ?? null, coluna: c[2] });
  }
  return itens;
}

/** Linhas em formato de ARRAY, na ordem das colunas — e assim que o pg-proxy espera. */
function responder(sqlTexto: string, method: string): unknown[] {
  if (banco.vazias.some(r => r.test(sqlTexto))) return [];
  const alvo = tabelaAlvo(sqlTexto);
  if (method === "execute") return banco.linhas.get(alvo) ?? [];
  const colunas = colunasDevolvidas(sqlTexto);
  if (!colunas) {
    const agregado = banco.agregados.find(a => a.quando.test(sqlTexto));
    return agregado ? [agregado.linha] : [];
  }
  const base = banco.linhas.get(alvo) ?? [];
  return base.map(linha => colunas.map(({ tabela, coluna }) => {
    const nome = tabela ?? alvo;
    // Coluna de tabela juntada: a primeira linha combinada dela (um cliente, um usuario).
    const fonte = nome === alvo ? linha : (banco.linhas.get(nome) ?? [])[0];
    if (!fonte) return null;
    const chave = chavePorColuna.get(nome)?.get(coluna);
    return chave === undefined ? null : (fonte[chave] ?? null);
  }));
}

type Consulta = (typeof banco.consultas)[number];

/**
 * A prova central: a consulta carrega o provider_id ESPERADO.
 *  - INSERT: a coluna `provider_id` esta na lista e, em CADA tupla de values,
 *    o parametro nessa posicao e o provedor.
 *  - SELECT/UPDATE: toda ocorrencia de `"provider_id" = $n` liga ao provedor,
 *    e ha pelo menos uma. Os joins repetem `provider_id = provider_id` entre
 *    tabelas (sem parametro), e isso nao conta como filtro.
 */
function provaProviderId(c: Consulta, providerId: number) {
  if (c.sql.startsWith("insert into")) {
    const m = c.sql.match(/^insert into "\w+" \(([^)]*)\) values (.+?)(?: returning .+)?$/);
    expect(m, c.sql).not.toBeNull();
    const colunas = m![1].split(", ").map(x => x.replace(/"/g, ""));
    const posicao = colunas.indexOf("provider_id");
    expect(posicao, c.sql).toBeGreaterThanOrEqual(0);
    // O `on conflict ("provider_id")` do upsert tambem e um parentese; nao e tupla.
    const valores = m![2].split(" on conflict")[0];
    const tuplas = Array.from(valores.matchAll(/\(([^)]*)\)/g)).map(t => t[1].split(", "));
    expect(tuplas.length, c.sql).toBeGreaterThan(0);
    for (const tupla of tuplas) {
      const ph = tupla[posicao].match(/^\$(\d+)$/);
      expect(ph, `${c.sql} :: ${tupla.join(",")}`).not.toBeNull();
      expect(c.params[Number(ph![1]) - 1], c.sql).toBe(providerId);
    }
    return;
  }
  const ocorrencias = Array.from(c.sql.matchAll(/"provider_id" = \$(\d+)/g));
  expect(ocorrencias.length, `sem filtro de provider_id: ${c.sql}`).toBeGreaterThan(0);
  for (const o of ocorrencias) {
    expect(c.params[Number(o[1]) - 1], c.sql).toBe(providerId);
  }
}

const dialeto = new PgDialect();
const paraSql = (q: unknown) => dialeto.sqlToQuery(q as SQL);

/** As linhas combinadas que os fluxos precisam encontrar. */
function fixture() {
  banco.linhas.set("customers", [{
    id: 42, providerId: PROVEDOR, name: "Maria da Carteira", cpfCnpj: "12328395074", phone: "11999990000",
    status: "active", totalOverdueAmount: "350.00", maxDaysOverdue: 40, overdueInvoicesCount: 2,
    neighborhood: "Centro", city: "Embu-Guaçu", state: "SP", contractStartDate: "2021-03-20",
    paymentStatus: "overdue", erpSource: "mk",
  }]);
  banco.linhas.set("users", [{ id: OPERADOR, providerId: PROVEDOR, name: "Operador", email: "op@isp.com", role: "user" }]);
  banco.linhas.set("cobranca_casos", [{
    id: 10, providerId: PROVEDOR, customerId: 42, status: "aberto", carteira: "ativo",
    abertoEm: "2026-09-01 10:00:00", etapaAtual: "lembrete_atraso", diasAtrasoAbertura: 40,
    valorAbertura: "350.00", valorAtual: "350.00", responsavelUserId: null, prioridade: "normal",
  }]);
  banco.linhas.set("cobranca_negociacoes", [{
    id: 77, providerId: PROVEDOR, casoId: 10, customerId: 42, tipo: "parcelamento",
    valorOriginal: "350.00", valorNegociado: "300.00", descontoPct: "0.00", entrada: "0.00",
    parcelas: 3, valorParcela: "100.00", primeiroVencimento: "2026-09-10", status: "aceita",
    criadoPorUserId: OPERADOR, aceitaEm: "2026-09-02 10:00:00",
  }]);
  banco.linhas.set("cobranca_parcelas", [{
    id: 501, providerId: PROVEDOR, negociacaoId: 77, numero: 1, valor: "100.00", vencimento: "2026-09-10", status: "pendente",
  }]);
  banco.linhas.set("cobranca_eventos", [{
    id: 900, providerId: PROVEDOR, casoId: 10, customerId: 42, userId: OPERADOR, tipo: "contato", ocorridoEm: "2026-09-05 10:00:00",
  }]);
  banco.linhas.set("cobranca_politica", [{
    id: 1, providerId: PROVEDOR, etapas: [], negociacao: POLITICA_DE_COBRANCA_PADRAO.negociacao,
    encargos: POLITICA_DE_COBRANCA_PADRAO.encargos, janelaContato: POLITICA_DE_COBRANCA_PADRAO.janelaContato, pausada: false,
  }]);
}

let storage: CobrancaStorage;

beforeEach(() => {
  banco.consultas.length = 0;
  banco.agregados.length = 0;
  banco.vazias.length = 0;
  banco.linhas.clear();
  banco.transacoes = 0;
  banco.dentro = false;
  const proxy = drizzle(async (sqlTexto, params, method) => {
    banco.consultas.push({ sql: sqlTexto, params, method, dentroDaTransacao: banco.dentro });
    return { rows: responder(sqlTexto, method) };
  });
  banco.db = Object.assign(proxy, {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      banco.transacoes++;
      banco.dentro = true;
      try {
        return await fn(proxy);
      } finally {
        banco.dentro = false;
      }
    },
  });
  fixture();
  storage = new CobrancaStorage();
});

const so = (prefixo: string) => banco.consultas.filter(c => c.sql.startsWith(prefixo));
const inserts = (tabela: string) => banco.consultas.filter(c => c.sql.startsWith(`insert into "${tabela}"`));
const updates = (tabela: string) => banco.consultas.filter(c => c.sql.startsWith(`update "${tabela}"`));

/**
 * O storage pergunta "ha negociacao viva neste caso?" em dois lugares — a
 * guarda de `criarNegociacao` e a cascata do encerramento — com o mesmo
 * SELECT. O banco de mentira devolveria a negociacao 77 (aceita) da fixture
 * para qualquer um; este e o jeito de dizer "nao ha".
 */
const NEGOCIACOES_VIVAS_DO_CASO = /^select "id", "status" from "cobranca_negociacoes" where/;
const semNegociacaoVivaNoCaso = () => banco.vazias.push(NEGOCIACOES_VIVAS_DO_CASO);
/** O caso ja foi negativado um dia: ha evento `negativacao` na linha do tempo. */
const SONDA_DE_NEGATIVACAO = /^select 1 from "cobranca_eventos" where .*"tipo" = \$\d+\) limit/;
const jaNegativado = () => banco.agregados.push({ quando: SONDA_DE_NEGATIVACAO, linha: [1] });
const casoDaFixture = () => banco.linhas.get("cobranca_casos")![0];
const casoEm = (status: string) => banco.linhas.set("cobranca_casos", [{ ...casoDaFixture(), status }]);
const negociacaoEm = (status: string) =>
  banco.linhas.set("cobranca_negociacoes", [{ ...banco.linhas.get("cobranca_negociacoes")![0], status }]);

describe("todo WHERE carrega o provider_id", () => {
  const cenarios: Array<[string, () => Promise<unknown>]> = [
    ["getPoliticaDeCobranca", () => storage.getPoliticaDeCobranca(PROVEDOR)],
    ["upsertPoliticaDeCobranca", () => storage.upsertPoliticaDeCobranca(PROVEDOR, { pausada: true, pausadaMotivo: "ferias" })],
    ["listarCasosDeCobranca com todos os filtros", () => storage.listarCasosDeCobranca(PROVEDOR, {
      carteira: "ativo", etapa: "lembrete_atraso", responsavelUserId: null, busca: "Maria",
      quadrante: "B", faixaDivida: "100-300", bairro: "Centro",
    }, { pagina: 2, porPagina: 25 })],
    ["obterCasoDeCobranca", () => storage.obterCasoDeCobranca(PROVEDOR, 10)],
    ["casoAbertoDoCliente", () => storage.casoAbertoDoCliente(PROVEDOR, 42)],
    ["abrirCasoDeCobranca", () => {
      banco.linhas.set("cobranca_casos", []);
      return storage.abrirCasoDeCobranca(PROVEDOR, { customerId: 42, carteira: "ativo", diasAtrasoAbertura: 40, valorAbertura: 350 });
    }],
    ["atualizarCasoDeCobranca", () => storage.atualizarCasoDeCobranca(PROVEDOR, 10, { etapaAtual: "aviso_suspensao", responsavelUserId: OPERADOR }, OPERADOR)],
    ["fecharCasoDeCobranca", () => storage.fecharCasoDeCobranca(PROVEDOR, 10, "baixado", "prescrita", OPERADOR)],
    ["contarCasosPorEtapa", () => storage.contarCasosPorEtapa(PROVEDOR)],
    ["contarCasosPorQuadrante", () => storage.contarCasosPorQuadrante(PROVEDOR)],
    ["registrarEventoDeCobranca", () => storage.registrarEventoDeCobranca(PROVEDOR, { casoId: 10, userId: OPERADOR, tipo: "contato", canal: "telefone", resultado: "falou" })],
    ["listarEventosDoCaso", () => storage.listarEventosDoCaso(PROVEDOR, 10)],
    ["listarEventosDoCliente", () => storage.listarEventosDoCliente(PROVEDOR, 42)],
    ["criarNegociacao", () => {
      semNegociacaoVivaNoCaso();
      return storage.criarNegociacao(PROVEDOR, {
        casoId: 10, tipo: "parcelamento", valorOriginal: 350, valorNegociado: 300, criadoPorUserId: OPERADOR,
      }, [{ numero: 1, valor: 100, vencimento: "2026-09-10" }, { numero: 2, valor: 100, vencimento: "2026-10-10" }]);
    }],
    ["atualizarStatusDaNegociacao", () => storage.atualizarStatusDaNegociacao(PROVEDOR, 77, "quebrada", OPERADOR)],
    ["listarNegociacoesDoCaso", () => storage.listarNegociacoesDoCaso(PROVEDOR, 10)],
    ["listarParcelasDaNegociacao", () => storage.listarParcelasDaNegociacao(PROVEDOR, 77)],
    ["marcarParcelaPaga", () => storage.marcarParcelaPaga(PROVEDOR, 501, 100, new Date(), OPERADOR)],
    ["marcarParcelasAtrasadas", () => storage.marcarParcelasAtrasadas(PROVEDOR, new Date())],
    ["kpisDaCobranca", () => storage.kpisDaCobranca(PROVEDOR)],
    ["composicaoDaCarteira", () => storage.composicaoDaCarteira(PROVEDOR)],
    ["bairrosDaCarteira", () => storage.bairrosDaCarteira(PROVEDOR)],
    ["filaDeCobranca", () => storage.filaDeCobranca(PROVEDOR, { responsavelUserId: OPERADOR })],
    ["clientesParaAbrirCaso", () => storage.clientesParaAbrirCaso(PROVEDOR, 20)],
    ["cancelarCaso", () => storage.cancelarCaso(PROVEDOR, 10, "contrato cancelado no ERP", OPERADOR)],
    ["atualizarDnaDoCaso", () => storage.atualizarDnaDoCaso(PROVEDOR, 10, { quadranteDna: "B2", tom: "firme_gentil", arbitrado: true }, null)],
    ["obterCliente", () => storage.obterCliente(PROVEDOR, 42)],
    ["obterNegociacao", () => storage.obterNegociacao(PROVEDOR, 77)],
    ["obterParcela", () => storage.obterParcela(PROVEDOR, 501)],
  ];

  it.each(cenarios)("%s", async (_nome, executar) => {
    await executar();
    expect(banco.consultas.length).toBeGreaterThan(0);
    for (const consulta of banco.consultas) provaProviderId(consulta, PROVEDOR);
  });

  it("o provider_id que vai para o SQL e o do argumento, nao o da linha encontrada", async () => {
    // A linha combinada e do provedor 6; quem pergunta e o 9. Cada consulta
    // tem de perguntar pelo 9 — e a resposta certa (que o simulador nao da)
    // seria "nao existe".
    await storage.registrarEventoDeCobranca(OUTRO_PROVEDOR, { casoId: 10, tipo: "contato" }).catch(() => undefined);
    for (const consulta of banco.consultas) provaProviderId(consulta, OUTRO_PROVEDOR);
  });
});

describe("um caso vivo por cliente — a lista de fechados e uma so", () => {
  const predicadoDaMigracao = `WHERE status NOT IN (${STATUS_CASO_FECHADO.map(s => `'${s}'`).join(", ")})`;

  it("a migracao 0022 repete STATUS_CASO_FECHADO nos dois indices parciais, derrubando-os antes", () => {
    const migracao = fs.readFileSync(path.resolve(process.cwd(), "migrations/0022_cobranca_fluxo.sql"), "utf8");
    const ocorrencias = migracao.split(predicadoDaMigracao).length - 1;
    expect(ocorrencias).toBe(2);
    // Predicado de indice parcial nao se altera: e DROP + CREATE, os dois.
    expect(migracao).toContain("DROP INDEX IF EXISTS cobranca_casos_um_aberto_por_cliente;");
    expect(migracao).toContain("DROP INDEX IF EXISTS idx_cobranca_casos_fila;");
  });

  it("a migracao 0021 guarda a lista da fase 1 — historia nao se reescreve", () => {
    const migracao = fs.readFileSync(path.resolve(process.cwd(), "migrations/0021_cobranca.sql"), "utf8");
    const daFase1 = "WHERE status NOT IN ('pago', 'baixado', 'encerrado')";
    expect(migracao.split(daFase1).length - 1).toBe(2);
    expect(migracao).not.toContain("cancelamento");
  });

  it("os dois indices do schema compilam para o mesmo predicado", () => {
    const indices = getTableConfig(cobrancaCasos).indexes.map(i => i.config);
    const unico = indices.find(i => i.name === "cobranca_casos_um_aberto_por_cliente");
    expect(unico?.unique).toBe(true);
    expect(paraSql(unico!.where).sql).toBe(predicadoDaMigracao.replace("WHERE ", ""));
    const fila = indices.find(i => i.name === "idx_cobranca_casos_fila");
    expect(paraSql(fila!.where).sql).toBe(predicadoDaMigracao.replace("WHERE ", ""));
  });

  it("casoAbertoDoCliente exclui exatamente esses status", async () => {
    await storage.casoAbertoDoCliente(PROVEDOR, 42);
    const [q] = banco.consultas;
    const placeholders = STATUS_CASO_FECHADO.map(() => "\\$\\d+").join(", ");
    expect(q.sql).toMatch(new RegExp(`"cobranca_casos"\\."status" not in \\(${placeholders}\\)`));
    expect(q.params).toEqual([PROVEDOR, 42, ...STATUS_CASO_FECHADO, 1]);
  });

  it("negativado NAO encerra: o cliente negativado continua com caso vivo; cancelamento encerra", () => {
    expect(STATUS_CASO_FECHADO).not.toContain("negativado");
    expect(STATUS_CASO_FECHADO).toContain("cancelamento");
    expect(STATUS_CASO_COBRANCA).toContain("em_contato");
  });

  it("abrir recusa cliente que ja tem caso vivo, antes de inserir", async () => {
    await expect(storage.abrirCasoDeCobranca(PROVEDOR, {
      customerId: 42, carteira: "ativo", diasAtrasoAbertura: 40, valorAbertura: 350,
    })).rejects.toThrow(/ja tem caso/);
    expect(inserts("cobranca_casos")).toHaveLength(0);
  });

  it("abrir recusa cliente de outro provedor", async () => {
    banco.linhas.set("customers", []);
    await expect(storage.abrirCasoDeCobranca(PROVEDOR, {
      customerId: 42, carteira: "ativo", diasAtrasoAbertura: 40, valorAbertura: 350,
    })).rejects.toThrow(/nao pertence/);
    expect(inserts("cobranca_casos")).toHaveLength(0);
  });

  it("abrir grava a foto: valor_atual nasce igual ao valor_abertura, e a carteira vai como veio", async () => {
    banco.linhas.set("cobranca_casos", []);
    await storage.abrirCasoDeCobranca(PROVEDOR, { customerId: 42, carteira: "ex_cliente", diasAtrasoAbertura: 400, valorAbertura: 1234.5 });
    const [ins] = inserts("cobranca_casos");
    expect(ins.params).toContain("ex_cliente");
    expect(ins.params.filter(p => p === "1234.50")).toHaveLength(2);
    expect(ins.params).toContain(400);
  });
});

describe("negociacao + parcelas: uma transacao, e o caso e o evento vao junto", () => {
  // A fixture tem a negociacao 77 (aceita); sem isto a guarda de "uma viva por caso" recusa a proposta.
  beforeEach(semNegociacaoVivaNoCaso);

  const proposta = () => storage.criarNegociacao(PROVEDOR, {
    casoId: 10, tipo: "parcelamento", valorOriginal: 350, valorNegociado: 300, criadoPorUserId: OPERADOR,
  }, [
    { numero: 1, valor: 100, vencimento: "2026-09-10" },
    { numero: 2, valor: 100, vencimento: "2026-10-10" },
    { numero: 3, valor: 100, vencimento: "2026-11-10" },
  ]);

  it("tudo acontece dentro de UMA transacao", async () => {
    await proposta();
    expect(banco.transacoes).toBe(1);
    const escritas = banco.consultas.filter(c => !c.sql.startsWith("select"));
    expect(escritas.length).toBeGreaterThanOrEqual(4);
    for (const c of escritas) expect(c.dentroDaTransacao, c.sql).toBe(true);
  });

  it("as 3 parcelas entram num INSERT so, apontando para a negociacao recem-criada", async () => {
    const resultado = await proposta();
    const [ins] = inserts("cobranca_parcelas");
    expect(ins).toBeDefined();
    const valores = ins.sql.slice(ins.sql.indexOf(" values ") + 8).split(" returning")[0];
    expect(valores.match(/\([^)]*\)/g)).toHaveLength(3);
    // negociacao_id 77 vem do RETURNING do insert anterior, uma vez por tupla.
    expect(ins.params.filter(p => p === 77)).toHaveLength(3);
    expect(ins.params.filter(p => p === "100.00")).toHaveLength(3);
    expect(ins.params).toContain("2026-11-10");
    expect(resultado.parcelamento).toHaveLength(1); // o simulador devolve a linha combinada, nao as 3 — o que importa e o SQL acima
    expect(resultado.parcelas).toBe(3);
  });

  it("o customer_id da negociacao vem do CASO, e o vencimento da primeira parcela vira primeiro_vencimento", async () => {
    await proposta();
    const [ins] = inserts("cobranca_negociacoes");
    expect(ins.params).toContain(42);
    expect(ins.params).toContain("2026-09-10");
    expect(ins.params).toContain(3);
    expect(ins.params).toContain("proposta");
  });

  it("o caso passa a negociando e a linha do tempo ganha negociacao_proposta", async () => {
    await proposta();
    const [upd] = updates("cobranca_casos");
    expect(upd.params).toContain("negociando");
    const [ev] = inserts("cobranca_eventos");
    expect(ev.params).toContain("negociacao_proposta");
    expect(ev.params).toContain(OPERADOR);
  });

  it("nascendo aceita, o caso vai direto a acordo_ativo", async () => {
    await storage.criarNegociacao(PROVEDOR, {
      casoId: 10, tipo: "quitacao_desconto", valorOriginal: 350, valorNegociado: 250, descontoPct: 28.57, criadoPorUserId: OPERADOR, aceita: true,
    }, [{ numero: 1, valor: 250, vencimento: "2026-09-10" }]);
    expect(updates("cobranca_casos")[0].params).toContain("acordo_ativo");
    expect(inserts("cobranca_eventos")[0].params).toContain("acordo_aceito");
    expect(inserts("cobranca_negociacoes")[0].params).toContain("28.57");
  });

  it("caso de outro provedor: nada e escrito", async () => {
    banco.linhas.set("cobranca_casos", []);
    await expect(proposta()).rejects.toThrow(/nao pertence/);
    expect(so("insert")).toHaveLength(0);
  });

  it("caso encerrado nao recebe negociacao", async () => {
    banco.linhas.set("cobranca_casos", [{ ...banco.linhas.get("cobranca_casos")![0], status: "pago" }]);
    await expect(proposta()).rejects.toThrow(/encerrado/);
    expect(so("insert")).toHaveLength(0);
  });

  it("quebrada: parcelas pendentes sao canceladas e o caso volta a aberto", async () => {
    banco.linhas.set("cobranca_casos", [{ ...banco.linhas.get("cobranca_casos")![0], status: "acordo_ativo" }]);
    await storage.atualizarStatusDaNegociacao(PROVEDOR, 77, "quebrada", OPERADOR);
    const [parcelas] = updates("cobranca_parcelas");
    expect(parcelas.sql).toMatch(/"cobranca_parcelas"\."status" in \(\$\d+, \$\d+\)/);
    expect(parcelas.params).toEqual(expect.arrayContaining(["cancelada", "pendente", "atrasada", 77, PROVEDOR]));
    expect(updates("cobranca_casos")[0].params).toContain("aberto");
    expect(inserts("cobranca_eventos")[0].params).toContain("acordo_quebrado");
  });
});

describe("parcela paga", () => {
  const restantes = (n: number) => banco.agregados.push({ quando: /count\(\*\).*"cobranca_parcelas"/, linha: [n] });

  it("com parcelas restantes: a negociacao aceita vira ativa e o caso segue vivo", async () => {
    restantes(2);
    const r = await storage.marcarParcelaPaga(PROVEDOR, 501, 100, new Date("2026-09-09T12:00:00Z"), OPERADOR);
    expect(r?.acordoCumprido).toBe(false);
    expect(updates("cobranca_parcelas")[0].params).toEqual(expect.arrayContaining(["paga", "100.00", 501, PROVEDOR]));
    expect(updates("cobranca_negociacoes")[0].params).toContain("ativa");
    expect(updates("cobranca_casos")).toHaveLength(0);
    expect(inserts("cobranca_eventos").map(e => e.params.filter(p => p === "parcela_paga" || p === "encerramento")[0]))
      .toEqual(["parcela_paga"]);
  });

  it("a ultima parcela cumpre o acordo e encerra o caso como pago", async () => {
    restantes(0);
    // No Postgres a negociacao ja esta `cumprida` quando o encerramento procura vivas; o banco de mentira precisa ouvir isso.
    semNegociacaoVivaNoCaso();
    const r = await storage.marcarParcelaPaga(PROVEDOR, 501, 100, new Date("2026-09-09T12:00:00Z"), OPERADOR);
    expect(r?.acordoCumprido).toBe(true);
    expect(updates("cobranca_negociacoes")[0].params).toContain("cumprida");
    const [caso] = updates("cobranca_casos");
    expect(caso.params).toContain("pago");
    expect(caso.sql).toContain('"encerrado_em"');
    const tipos = inserts("cobranca_eventos").map(e => e.params.filter(p => p === "parcela_paga" || p === "encerramento")[0]);
    expect(tipos).toEqual(["parcela_paga", "encerramento"]);
  });

  it("parcela de outro provedor: nada e escrito", async () => {
    banco.linhas.set("cobranca_parcelas", []);
    await expect(storage.marcarParcelaPaga(PROVEDOR, 501, 100, new Date(), OPERADOR)).resolves.toBeUndefined();
    expect(so("update")).toHaveLength(0);
  });

  it("marcarParcelasAtrasadas compara a coluna DATE com o dia local, e devolve as negociacoes tocadas", async () => {
    const r = await storage.marcarParcelasAtrasadas(PROVEDOR, new Date(2026, 8, 5, 23, 30));
    const [upd] = updates("cobranca_parcelas");
    expect(upd.sql).toMatch(/"cobranca_parcelas"\."vencimento" < \$\d+/);
    expect(upd.params).toEqual(expect.arrayContaining(["atrasada", "pendente", "2026-09-05", PROVEDOR]));
    expect(r).toEqual({ marcadas: 1, negociacoes: [77] });
  });
});

describe("linha do tempo", () => {
  it("contato atualiza ultimo_contato_em do caso; nota nao", async () => {
    const quando = new Date("2026-09-05T14:00:00Z");
    await storage.registrarEventoDeCobranca(PROVEDOR, { casoId: 10, userId: OPERADOR, tipo: "contato", canal: "whatsapp", resultado: "nao_atendeu", ocorridoEm: quando });
    expect(updates("cobranca_casos")).toHaveLength(1);
    expect(updates("cobranca_casos")[0].sql).toContain('"ultimo_contato_em"');
    // O Drizzle grava timestamp como ISO em UTC (mapToDriverValue da coluna).
    expect(updates("cobranca_casos")[0].params).toContain(quando.toISOString());

    banco.consultas.length = 0;
    await storage.registrarEventoDeCobranca(PROVEDOR, { casoId: 10, userId: OPERADOR, tipo: "nota", notas: "ligar de novo sexta" });
    expect(updates("cobranca_casos")).toHaveLength(0);
  });

  it("o customer_id do evento e o do caso — o chamador nao escolhe", async () => {
    await storage.registrarEventoDeCobranca(PROVEDOR, { casoId: 10, tipo: "contato" });
    const [ev] = inserts("cobranca_eventos");
    expect(ev.params).toContain(42);
    expect(ev.params).toContain(null); // user_id nulo = sistema
  });

  it("mudar etapa e responsavel deixa um evento cada, com o antes e o depois", async () => {
    await storage.atualizarCasoDeCobranca(PROVEDOR, 10, { etapaAtual: "aviso_suspensao", responsavelUserId: OPERADOR, prioridade: "alta" }, OPERADOR);
    const eventos = inserts("cobranca_eventos");
    expect(eventos).toHaveLength(2);
    expect(eventos[0].params).toContain("etapa_mudou");
    expect(eventos[0].params).toContain(JSON.stringify({ de: "lembrete_atraso", para: "aviso_suspensao" }));
    expect(eventos[1].params).toContain("responsavel_mudou");
    expect(eventos[1].params).toContain(JSON.stringify({ de: null, para: OPERADOR }));
  });

  it("repetir a mesma etapa nao gera evento", async () => {
    await storage.atualizarCasoDeCobranca(PROVEDOR, 10, { etapaAtual: "lembrete_atraso" });
    expect(inserts("cobranca_eventos")).toHaveLength(0);
  });

  it("atualizar nao encerra: status terminal e recusado antes de qualquer consulta", async () => {
    await expect(storage.atualizarCasoDeCobranca(PROVEDOR, 10, { status: "pago" as any })).rejects.toThrow(/fecharCasoDeCobranca/);
    expect(banco.consultas).toHaveLength(0);
  });

  it("fechar exige status terminal, carimba encerrado_em e grava o encerramento", async () => {
    await expect(storage.fecharCasoDeCobranca(PROVEDOR, 10, "aberto" as any, null)).rejects.toThrow(/nao encerra/);
    await storage.fecharCasoDeCobranca(PROVEDOR, 10, "encerrado", "divida prescrita — CC 206 §5", OPERADOR);
    const [upd] = updates("cobranca_casos");
    expect(upd.sql).toContain('"encerrado_em"');
    expect(upd.params).toContain("encerrado");
    expect(inserts("cobranca_eventos")[0].params).toContain("encerramento");
  });

  it("fechar um caso ja fechado devolve como esta, sem reescrever encerrado_em", async () => {
    banco.linhas.set("cobranca_casos", [{ ...banco.linhas.get("cobranca_casos")![0], status: "pago" }]);
    const r = await storage.fecharCasoDeCobranca(PROVEDOR, 10, "baixado", null, OPERADOR);
    expect(r?.status).toBe("pago");
    expect(updates("cobranca_casos")).toHaveLength(0);
  });
});

describe("a carteira", () => {
  it("sem filtro de status, so casos vivos; paginacao vira limit/offset", async () => {
    await storage.listarCasosDeCobranca(PROVEDOR, {}, { pagina: 3, porPagina: 25 });
    const [dados, total] = banco.consultas;
    expect(dados.sql).toMatch(/"cobranca_casos"\."status" not in/);
    expect(dados.sql).toMatch(/limit \$\d+ offset \$\d+$/);
    expect(dados.params.slice(-2)).toEqual([25, 50]);
    expect(total.sql).toMatch(/^select count\(\*\) from "cobranca_casos" inner join "customers"/);
    expect(total.sql).toMatch(/"cobranca_casos"\."status" not in/);
  });

  it("os joins amarram cliente e responsavel ao MESMO provedor do caso", async () => {
    await storage.listarCasosDeCobranca(PROVEDOR);
    const [dados] = banco.consultas;
    expect(dados.sql).toContain('"customers"."provider_id" = "cobranca_casos"."provider_id"');
    expect(dados.sql).toContain('"users"."provider_id" = "cobranca_casos"."provider_id"');
  });

  it("quadrante: uma letra e o grupo, duas e o quadrante exato", async () => {
    await storage.listarCasosDeCobranca(PROVEDOR, { quadrante: "b" });
    expect(banco.consultas[0].sql).toMatch(/left\("cobranca_casos"\."quadrante_dna", 1\) = \$\d+/);
    expect(banco.consultas[0].params).toContain("B");

    banco.consultas.length = 0;
    await storage.listarCasosDeCobranca(PROVEDOR, { quadrante: "c3" });
    expect(banco.consultas[0].sql).toMatch(/"cobranca_casos"\."quadrante_dna" = \$\d+/);
    expect(banco.consultas[0].params).toContain("C3");
  });

  it("busca: documento procura pelos digitos, nome por ILIKE", async () => {
    await storage.listarCasosDeCobranca(PROVEDOR, { busca: "123.283" });
    expect(banco.consultas[0].sql).toContain(`regexp_replace("customers"."cpf_cnpj", '[^0-9]', '', 'g') like`);
    expect(banco.consultas[0].params).toContain("123283%");

    banco.consultas.length = 0;
    await storage.listarCasosDeCobranca(PROVEDOR, { busca: "Maria" });
    expect(banco.consultas[0].sql).toMatch(/"customers"\."name" ilike \$\d+/);
    expect(banco.consultas[0].params).toContain("%Maria%");
  });

  it("faixa de divida e sobre a divida de HOJE do cliente, nao a foto do caso", async () => {
    await storage.listarCasosDeCobranca(PROVEDOR, { faixaDivida: "300-1000" });
    const { sql: s, params } = banco.consultas[0];
    expect(s).toMatch(/coalesce\("customers"\."total_overdue_amount", 0\) >= \$\d+/);
    expect(s).toMatch(/coalesce\("customers"\."total_overdue_amount", 0\) < \$\d+/);
    expect(params).toEqual(expect.arrayContaining([300, 1000]));

    banco.consultas.length = 0;
    await storage.listarCasosDeCobranca(PROVEDOR, { faixaDivida: "ate-100" });
    expect(banco.consultas[0].sql).toMatch(/coalesce\("customers"\."total_overdue_amount", 0\) > 0/);
  });

  it("responsavel nulo e a fila geral; um id e o operador", async () => {
    await storage.listarCasosDeCobranca(PROVEDOR, { responsavelUserId: null });
    expect(banco.consultas[0].sql).toMatch(/"cobranca_casos"\."responsavel_user_id" is null/);
    banco.consultas.length = 0;
    await storage.listarCasosDeCobranca(PROVEDOR, { responsavelUserId: OPERADOR });
    expect(banco.consultas[0].sql).toMatch(/"cobranca_casos"\."responsavel_user_id" = \$\d+/);
  });

  it("a linha montada traz o cliente e o responsavel, e dinheiro como numero", async () => {
    const { linhas } = await storage.listarCasosDeCobranca(PROVEDOR);
    expect(linhas).toHaveLength(1);
    const [l] = linhas;
    expect(l.valorAtual).toBe(350);
    expect(l.cliente).toMatchObject({
      id: 42, nome: "Maria da Carteira", cpfCnpj: "12328395074", bairro: "Centro",
      dividaAtual: 350, diasAtraso: 40, faturasAbertas: 2, statusErp: "active",
      contractStartDate: "2021-03-20", plano: null,
    });
    expect(l.abertoEm).toBeInstanceOf(Date);
  });

  it("contagens por etapa e quadrante agrupam so casos vivos", async () => {
    await storage.contarCasosPorEtapa(PROVEDOR);
    expect(banco.consultas[0].sql).toMatch(/group by "cobranca_casos"\."etapa_atual", "cobranca_casos"\."carteira"/);
    expect(banco.consultas[0].sql).toMatch(/"status" not in/);
    banco.consultas.length = 0;
    await storage.contarCasosPorQuadrante(PROVEDOR);
    expect(banco.consultas[0].sql).toMatch(/group by "cobranca_casos"\."quadrante_dna", "cobranca_casos"\."carteira"/);
  });
});

describe("os numeros do cabecalho", () => {
  it("kpis: ativo com divida, ex com divida e em aberto vem de customers; contatados hoje conta cliente distinto desde a meia-noite local", async () => {
    const hoje = new Date(2026, 8, 5, 15, 45);
    await storage.kpisDaCobranca(PROVEDOR, hoje);
    const [carteira, contatos, parcelas, casos, entradas] = banco.consultas;
    expect(carteira.sql).toContain(`count(*) filter (where "customers"."status" in ($1, $2) and coalesce("customers"."total_overdue_amount", 0) > 0)`);
    expect(carteira.sql).toContain(`not ("customers"."status" in (`);
    expect(carteira.params.slice(0, 2)).toEqual([...STATUS_DE_CLIENTE_ATUAL]);

    expect(contatos.sql).toMatch(/count\(distinct (?:"cobranca_eventos"\.)?"customer_id"\)/);
    expect(contatos.params).toContain("contato");
    expect(contatos.params).toContain(new Date(2026, 8, 5, 0, 0, 0, 0).toISOString());

    expect(parcelas.sql).toMatch(/sum\((?:"cobranca_parcelas"\.)?"valor_pago"\)/);
    expect(parcelas.params).toContain("paga");

    // Caso pago SEM acordo — o que teve acordo ja esta nas parcelas.
    expect(casos.sql).toMatch(/not exists \(select 1 from "cobranca_negociacoes"/);
    expect(casos.params).toEqual(expect.arrayContaining(["aceita", "ativa", "cumprida", "pago"]));

    // A entrada e paga no aceite: negociacoes aceitas nos 30 dias. Quebrada fica fora ("aceita mas a entrada nunca veio").
    expect(entradas.sql).toMatch(/sum\((?:"cobranca_negociacoes"\.)?"entrada"\)/);
    expect(entradas.sql).toMatch(/"cobranca_negociacoes"\."aceita_em" >= \$\d+/);
    expect(entradas.params).toEqual(expect.arrayContaining(["aceita", "ativa", "cumprida"]));
    expect(entradas.params).not.toContain("quebrada");
  });

  it("recuperado30d soma as tres fontes: parcelas pagas, entradas aceitas e casos pagos sem acordo", async () => {
    banco.agregados.push({ quando: /sum\((?:"cobranca_parcelas"\.)?"valor_pago"\)/, linha: ["450.00"] });
    banco.agregados.push({ quando: /sum\((?:"cobranca_casos"\.)?"valor_atual"\)/, linha: ["120.50"] });
    banco.agregados.push({ quando: /sum\((?:"cobranca_negociacoes"\.)?"entrada"\)/, linha: ["200.10"] });
    const k = await storage.kpisDaCobranca(PROVEDOR);
    expect(k.recuperado30d).toBe(770.6);
  });

  it("composicao: em dia + em cobranca + ex com divida, de customers", async () => {
    banco.agregados.push({ quando: /^select count\(\*\) filter/, linha: [2500, 590, 7300] });
    const c = await storage.composicaoDaCarteira(PROVEDOR);
    expect(c).toEqual({ emDia: 2500, emCobranca: 590, exComDivida: 7300 });
    expect(banco.consultas[0].sql).toContain(`coalesce("customers"."total_overdue_amount", 0) <= 0`);
  });
});

describe("a fila do operador", () => {
  it("ordena por prioridade, depois vencido antes de futuro, depois maior divida", async () => {
    const hoje = new Date("2026-09-05T12:00:00Z");
    await storage.filaDeCobranca(PROVEDOR, { hoje, limite: 30 });
    const { sql: s, params } = banco.consultas[0];
    const ordem = s.slice(s.indexOf("order by"));
    expect(ordem).toMatch(/^order by case "cobranca_casos"\."prioridade" when 'critica' then 0 when 'alta' then 1 when 'normal' then 2 else 3 end, case when \("cobranca_casos"\."proximo_contato_em" is null or "cobranca_casos"\."proximo_contato_em" <= \$\d+\) then 0 else 1 end, "cobranca_casos"\."proximo_contato_em" asc, "cobranca_casos"\."valor_atual" desc limit \$\d+$/);
    expect(params).toContain(hoje.toISOString());
    expect(params).toContain(30);
  });

  it("com operador: os casos dele MAIS a fila geral; sem operador: todos", async () => {
    await storage.filaDeCobranca(PROVEDOR, { responsavelUserId: OPERADOR });
    expect(banco.consultas[0].sql).toMatch(/\("cobranca_casos"\."responsavel_user_id" = \$\d+ or "cobranca_casos"\."responsavel_user_id" is null\)/);
    banco.consultas.length = 0;
    await storage.filaDeCobranca(PROVEDOR);
    expect(banco.consultas[0].sql).not.toContain("responsavel_user_id\" =");
  });
});

describe("candidatos a caso — o que o job abre", () => {
  it("divida acima do minimo, ao menos 1 dia, sem caso vivo, sem baixa anterior, sem pago recente", async () => {
    await storage.clientesParaAbrirCaso(PROVEDOR, 20);
    const { sql: s, params } = banco.consultas[0];
    expect(s).toMatch(/coalesce\("customers"\."total_overdue_amount", 0\) > \$\d+/);
    expect(s).toMatch(/"customers"\."max_days_overdue" >= \$\d+/);
    expect(s.match(/not exists \(select 1 from "cobranca_casos"/g)).toHaveLength(3);
    expect(s).toMatch(/"cobranca_casos"\."status" in \(\$\d+, \$\d+\)/);
    expect(s).toContain("now() - interval '7 days'");
    expect(params).toEqual(expect.arrayContaining([20, 1, "baixado", "encerrado", "pago", ...STATUS_CASO_FECHADO]));
  });

  it("devolve a carteira ja decidida pelo status do ERP", async () => {
    const [c] = await storage.clientesParaAbrirCaso(PROVEDOR, 20);
    expect(c).toMatchObject({ customerId: 42, carteira: "ativo", dividaAtual: 350, diasAtraso: 40, contractStartDate: "2021-03-20" });
  });

  it("carteiraDoStatusErp: ativo e suspenso sao cliente; o resto e ex-cliente", () => {
    expect(carteiraDoStatusErp("active")).toBe("ativo");
    expect(carteiraDoStatusErp("suspended")).toBe("ativo");
    expect(carteiraDoStatusErp("cancelled")).toBe("ex_cliente");
    expect(carteiraDoStatusErp("inactive")).toBe("ex_cliente");
    expect(carteiraDoStatusErp(undefined)).toBe("ex_cliente");
  });
});

describe("politica", () => {
  it("upsert escreve SO o que veio, e resolve o conflito pelo provider_id", async () => {
    await storage.upsertPoliticaDeCobranca(PROVEDOR, { pausada: true, pausadaMotivo: "ferias coletivas" });
    const [ins] = inserts("cobranca_politica");
    expect(ins.sql).toContain('on conflict ("provider_id") do update set');
    const set = ins.sql.slice(ins.sql.indexOf("do update set"), ins.sql.indexOf(" returning"));
    expect(set).toContain('"pausada"');
    expect(set).toContain('"pausada_motivo"');
    expect(set).toContain('"updated_at"');
    expect(set).not.toContain('"etapas"');
    expect(set).not.toContain('"negociacao"');
    expect(set).not.toContain('"economia"');
  });

  it("a economia (os custos do provedor) e gravada como JSONB quando vem", async () => {
    const economia = { ...POLITICA_DE_COBRANCA_PADRAO.economia, cac: 180, impostoReceitaPct: 18, confirmado: true };
    await storage.upsertPoliticaDeCobranca(PROVEDOR, { economia });
    const [ins] = inserts("cobranca_politica");
    expect(ins.sql.slice(ins.sql.indexOf("do update set"))).toContain('"economia"');
    expect(ins.params).toContain(JSON.stringify(economia));
  });

  it("os defaults do schema sao os da migracao — 0021 para a fase 1, 0022 para a economia", () => {
    const m21 = fs.readFileSync(path.resolve(process.cwd(), "migrations/0021_cobranca.sql"), "utf8");
    expect(m21).toContain(`DEFAULT '${JSON.stringify(POLITICA_DE_COBRANCA_PADRAO.negociacao)}'::jsonb`);
    expect(m21).toContain(`DEFAULT '${JSON.stringify(POLITICA_DE_COBRANCA_PADRAO.encargos)}'::jsonb`);
    expect(m21).toContain(`DEFAULT '${JSON.stringify(POLITICA_DE_COBRANCA_PADRAO.janelaContato)}'::jsonb`);
    const m22 = fs.readFileSync(path.resolve(process.cwd(), "migrations/0022_cobranca_fluxo.sql"), "utf8");
    expect(m22).toContain("ALTER TABLE cobranca_politica ADD COLUMN IF NOT EXISTS economia JSONB NOT NULL");
    // A 0022 criou a coluna com o default de entao (sem precoPorPlano) — historico, nao muda.
    expect(m22).toContain(`"cicloMeses":36,"confirmado":false}'::jsonb`);
    // A 0023 e quem carrega o default ATUAL, igual ao do schema.
    const m23 = fs.readFileSync(path.join(process.cwd(), "migrations", "0023_cobranca_preco_por_plano.sql"), "utf8");
    expect(m23).toContain(`DEFAULT '${JSON.stringify(POLITICA_DE_COBRANCA_PADRAO.economia)}'::jsonb`);
  });
});

/**
 * Os 24 achados dos tres revisores, a parte que cabe ao storage — cada um
 * conferido no codigo antes de virar teste. A regra comum: o que o storage
 * recusa por regra de negocio sai como ErroDeCobranca com codigo, e NADA e
 * escrito antes da recusa.
 */
describe("achados da revisao — pagamento de parcela", () => {
  const restantes = (n: number) => banco.agregados.push({ quando: /count\(\*\).*"cobranca_parcelas"/, linha: [n] });

  it("A1: parcela de proposta nao aceita nao se paga — o cliente ainda nao disse sim", async () => {
    negociacaoEm("proposta");
    const erro = await storage.marcarParcelaPaga(PROVEDOR, 501, 100, new Date(), OPERADOR).catch(e => e);
    expect(erro).toBeInstanceOf(ErroDeCobranca);
    expect(erro.codigo).toBe("NEGOCIACAO_NAO_ACEITA");
    expect(so("update")).toHaveLength(0);
    expect(so("insert")).toHaveLength(0);
  });

  it("negociacao cumprida, quebrada ou cancelada nao recebe pagamento", async () => {
    for (const status of ["cumprida", "quebrada", "cancelada"]) {
      banco.consultas.length = 0;
      negociacaoEm(status);
      const erro = await storage.marcarParcelaPaga(PROVEDOR, 501, 100, new Date(), OPERADOR).catch(e => e);
      expect(erro.codigo, status).toBe("NEGOCIACAO_ENCERRADA");
      expect(so("update"), status).toHaveLength(0);
    }
  });

  it("o UPDATE so pega parcela pendente ou atrasada; sem linha, nada acontece — nem evento", async () => {
    banco.vazias.push(/^update "cobranca_parcelas" set/);
    const r = await storage.marcarParcelaPaga(PROVEDOR, 501, 100, new Date(), OPERADOR);
    expect(r).toBeUndefined();
    const [upd] = updates("cobranca_parcelas");
    expect(upd.sql).toMatch(/"cobranca_parcelas"\."status" in \(\$\d+, \$\d+\)/);
    expect(upd.params).toEqual(expect.arrayContaining(["pendente", "atrasada"]));
    expect(inserts("cobranca_eventos")).toHaveLength(0);
    expect(updates("cobranca_negociacoes")).toHaveLength(0);
    expect(updates("cobranca_casos")).toHaveLength(0);
  });

  it("valor zero ou negativo e recusado antes de qualquer consulta", async () => {
    await expect(storage.marcarParcelaPaga(PROVEDOR, 501, 0, new Date())).rejects.toMatchObject({ codigo: "VALOR_INVALIDO" });
    await expect(storage.marcarParcelaPaga(PROVEDOR, 501, -5, new Date())).rejects.toMatchObject({ codigo: "VALOR_INVALIDO" });
    expect(banco.consultas).toHaveLength(0);
  });

  it("pagamento parcial acumula valor_pago e mantem a parcela como esta — nem paga, nem negociacao ativa", async () => {
    const r = await storage.marcarParcelaPaga(PROVEDOR, 501, 40, new Date("2026-09-09T12:00:00Z"), OPERADOR);
    expect(r?.parcial).toBe(true);
    expect(r?.acordoCumprido).toBe(false);
    const [upd] = updates("cobranca_parcelas");
    const set = upd.sql.slice(0, upd.sql.indexOf(" where "));
    expect(set).toContain('"valor_pago"');
    expect(set).not.toContain('"status"');
    expect(set).not.toContain('"pago_em"');
    expect(upd.params).toContain("40.00");
    expect(updates("cobranca_negociacoes")).toHaveLength(0);
    expect(updates("cobranca_casos")).toHaveLength(0);
    const [ev] = inserts("cobranca_eventos");
    expect(ev.params).toContain("parcela_paga");
    expect(ev.params).toContain("Pagamento parcial da parcela 1: R$ 40,00 de R$ 100,00 (restam R$ 60,00).");
    expect(ev.params.some(p => typeof p === "string" && p.includes('"parcial":true'))).toBe(true);
  });

  it("o complemento que cobre a parcela a fecha com o acumulado, e ai a negociacao aceita vira ativa", async () => {
    restantes(1);
    banco.linhas.set("cobranca_parcelas", [{ ...banco.linhas.get("cobranca_parcelas")![0], valorPago: "40.00" }]);
    const r = await storage.marcarParcelaPaga(PROVEDOR, 501, 60, new Date("2026-09-10T12:00:00Z"), OPERADOR);
    expect(r?.parcial).toBe(false);
    const [upd] = updates("cobranca_parcelas");
    expect(upd.params).toEqual(expect.arrayContaining(["paga", "100.00"]));
    expect(updates("cobranca_negociacoes")[0].params).toContain("ativa");
  });

  it("um centavo a menos nao cobre: 99,99 numa parcela de 100 e parcial", async () => {
    const r = await storage.marcarParcelaPaga(PROVEDOR, 501, 99.99, new Date(), OPERADOR);
    expect(r?.parcial).toBe(true);
  });
});

describe("achados da revisao — negociacao", () => {
  const proposta = () => storage.criarNegociacao(PROVEDOR, {
    casoId: 10, tipo: "parcelamento", valorOriginal: 350, valorNegociado: 300, criadoPorUserId: OPERADOR,
  }, [{ numero: 1, valor: 300, vencimento: "2026-09-10" }]);

  it("uma negociacao viva por caso: com a 77 aceita, propor outra e NEGOCIACAO_VIVA e nada e escrito", async () => {
    const erro = await proposta().catch(e => e);
    expect(erro).toBeInstanceOf(ErroDeCobranca);
    expect(erro.codigo).toBe("NEGOCIACAO_VIVA");
    expect(erro.message).toContain("#77");
    const guarda = banco.consultas.find(c => NEGOCIACOES_VIVAS_DO_CASO.test(c.sql));
    expect(guarda?.params).toEqual(expect.arrayContaining(["proposta", "aceita", "ativa", 10, PROVEDOR]));
    expect(so("insert")).toHaveLength(0);
    expect(so("update")).toHaveLength(0);
  });

  it("caso encerrado recusa com CASO_ENCERRADO — a rota le o codigo, nao a mensagem", async () => {
    casoEm("cancelamento");
    const erro = await proposta().catch(e => e);
    expect(erro.codigo).toBe("CASO_ENCERRADO");
  });

  it("negociacao encerrada nao muda mais de status", async () => {
    negociacaoEm("cumprida");
    const erro = await storage.atualizarStatusDaNegociacao(PROVEDOR, 77, "cancelada", OPERADOR).catch(e => e);
    expect(erro.codigo).toBe("NEGOCIACAO_ENCERRADA");
    expect(so("update")).toHaveLength(0);
  });

  it("cascata: negociacao desfeita devolve o caso a aberto quando ele nunca foi negativado", async () => {
    casoEm("acordo_ativo");
    await storage.atualizarStatusDaNegociacao(PROVEDOR, 77, "quebrada", OPERADOR);
    expect(updates("cobranca_casos")[0].params).toContain("aberto");
    const sonda = banco.consultas.find(c => SONDA_DE_NEGATIVACAO.test(c.sql));
    expect(sonda?.params).toEqual(expect.arrayContaining([PROVEDOR, 10, "negativacao"]));
  });

  it("cascata: caso que ja foi negativado VOLTA a negativado, nao a fila", async () => {
    casoEm("acordo_ativo");
    jaNegativado();
    await storage.atualizarStatusDaNegociacao(PROVEDOR, 77, "quebrada", OPERADOR);
    const [upd] = updates("cobranca_casos");
    expect(upd.params).toContain("negativado");
    expect(upd.params).not.toContain("aberto");
  });

  it("cascata: proposta cancelada num caso negativado hoje deixa o caso como esta, sem sondar a linha do tempo", async () => {
    casoEm("negativado");
    negociacaoEm("proposta");
    await storage.atualizarStatusDaNegociacao(PROVEDOR, 77, "cancelada", OPERADOR);
    expect(updates("cobranca_casos")).toHaveLength(0);
    expect(banco.consultas.some(c => SONDA_DE_NEGATIVACAO.test(c.sql))).toBe(false);
  });
});

describe("achados da revisao — encerramento e cancelamento", () => {
  it("fechar cancela a negociacao viva e as parcelas pendentes dela, na mesma transacao, com nota", async () => {
    await storage.fecharCasoDeCobranca(PROVEDOR, 10, "baixado", "prescrita", OPERADOR);
    expect(banco.transacoes).toBe(1);
    const [neg] = updates("cobranca_negociacoes");
    expect(neg.params).toEqual(expect.arrayContaining(["cancelada", 77, PROVEDOR]));
    const [parc] = updates("cobranca_parcelas");
    expect(parc.sql).toMatch(/"cobranca_parcelas"\."negociacao_id" in \(\$\d+\)/);
    expect(parc.params).toEqual(expect.arrayContaining(["cancelada", "pendente", "atrasada", 77]));
    const eventos = inserts("cobranca_eventos");
    expect(eventos).toHaveLength(2);
    expect(eventos[0].params).toContain("encerramento");
    expect(eventos[1].params).toContain("nota");
    expect(eventos[1].params).toContain("Negociacao #77 (aceita) cancelada: o caso foi encerrado como baixado.");
    for (const c of banco.consultas.filter(c => !c.sql.startsWith("select"))) expect(c.dentroDaTransacao, c.sql).toBe(true);
  });

  it("sem negociacao viva, o encerramento nao toca negociacao nem parcela", async () => {
    semNegociacaoVivaNoCaso();
    await storage.fecharCasoDeCobranca(PROVEDOR, 10, "encerrado", null, OPERADOR);
    expect(updates("cobranca_negociacoes")).toHaveLength(0);
    expect(updates("cobranca_parcelas")).toHaveLength(0);
    expect(inserts("cobranca_eventos")).toHaveLength(1);
  });

  it("cancelarCaso: status cancelamento, evento proprio com o motivo aparado e a sugestao de recuperar o equipamento", async () => {
    semNegociacaoVivaNoCaso();
    await storage.cancelarCaso(PROVEDOR, 10, "  contrato cancelado no ERP  ", null);
    const [upd] = updates("cobranca_casos");
    expect(upd.sql).toContain('"encerrado_em"');
    expect(upd.params).toContain("cancelamento");
    expect(upd.params).toContain("contrato cancelado no ERP");
    const [ev] = inserts("cobranca_eventos");
    expect(ev.params).toContain("cancelamento");
    expect(ev.params).toContain("sistema"); // userId nulo = o job
    const metadata = ev.params.find(p => typeof p === "string" && p.startsWith("{")) as string;
    expect(JSON.parse(metadata)).toEqual({ status: "cancelamento", de: "aberto", motivo: "contrato cancelado no ERP", sugerirRecuperacao: true });
  });

  it("cancelar sem motivo e recusado antes de qualquer consulta", async () => {
    await expect(storage.cancelarCaso(PROVEDOR, 10, "   ", OPERADOR)).rejects.toMatchObject({ codigo: "MOTIVO_OBRIGATORIO" });
    expect(banco.consultas).toHaveLength(0);
  });

  it("fecharCasoDeCobranca com cancelamento vai pelo mesmo caminho — e exige o motivo do mesmo jeito", async () => {
    semNegociacaoVivaNoCaso();
    await storage.fecharCasoDeCobranca(PROVEDOR, 10, "cancelamento", "pediu cancelamento", OPERADOR);
    expect(inserts("cobranca_eventos")[0].params).toContain("cancelamento");
    await expect(storage.fecharCasoDeCobranca(PROVEDOR, 10, "cancelamento", null, OPERADOR)).rejects.toMatchObject({ codigo: "MOTIVO_OBRIGATORIO" });
  });

  it("cancelar caso ja fechado devolve como esta, sem reescrever", async () => {
    casoEm("pago");
    const r = await storage.cancelarCaso(PROVEDOR, 10, "motivo", OPERADOR);
    expect(r?.status).toBe("pago");
    expect(so("update")).toHaveLength(0);
  });
});

describe("o DNA do caso — arbitrado sem a data do contrato deixa aviso", () => {
  const dna = { quadranteDna: "B2", tom: "firme_gentil", arbitrado: true };

  it("grava quadrante e tom e, arbitrado, deixa a nota de sistema com o antes e o depois", async () => {
    await storage.atualizarDnaDoCaso(PROVEDOR, 10, dna, null);
    const [upd] = updates("cobranca_casos");
    expect(upd.params).toEqual(expect.arrayContaining(["B2", "firme_gentil", 10, PROVEDOR]));
    const sonda = banco.consultas.find(c => /"metadata"->>'motivo' = \$\d+/.test(c.sql));
    expect(sonda?.params).toContain(MOTIVO_NOTA_DNA_ARBITRADO);
    const [nota] = inserts("cobranca_eventos");
    expect(nota.params).toContain("nota");
    expect(nota.params).toContain("sistema");
    expect(nota.params).toContain(JSON.stringify({
      motivo: MOTIVO_NOTA_DNA_ARBITRADO, quadrante: "B2", tom: "firme_gentil", de: { quadrante: null, tom: null },
    }));
  });

  it("ja avisado uma vez: nao repete a nota", async () => {
    banco.agregados.push({ quando: /"metadata"->>'motivo' = \$\d+/, linha: [1] });
    await storage.atualizarDnaDoCaso(PROVEDOR, 10, dna, null);
    expect(inserts("cobranca_eventos")).toHaveLength(0);
  });

  it("com a data do contrato (nao arbitrado): grava sem nota; DNA igual ao gravado: nada", async () => {
    await storage.atualizarDnaDoCaso(PROVEDOR, 10, { ...dna, arbitrado: false });
    expect(updates("cobranca_casos")).toHaveLength(1);
    expect(inserts("cobranca_eventos")).toHaveLength(0);

    banco.consultas.length = 0;
    banco.linhas.set("cobranca_casos", [{ ...casoDaFixture(), quadranteDna: "B2", tom: "firme_gentil" }]);
    await storage.atualizarDnaDoCaso(PROVEDOR, 10, { ...dna, arbitrado: false });
    expect(updates("cobranca_casos")).toHaveLength(0);
  });

  it("caso fechado nao muda", async () => {
    casoEm("cancelamento");
    await storage.atualizarDnaDoCaso(PROVEDOR, 10, dna);
    expect(so("update")).toHaveLength(0);
    expect(so("insert")).toHaveLength(0);
  });
});

describe("leituras pontuais — o que a rota pediu", () => {
  it("obterCliente filtra por id E provedor, uma linha", async () => {
    const c = await storage.obterCliente(PROVEDOR, 42);
    expect(c?.name).toBe("Maria da Carteira");
    expect(banco.consultas[0].sql).toMatch(/"customers"\."id" = \$\d+ and "customers"\."provider_id" = \$\d+\) limit \$\d+$/);
  });

  it("obterNegociacao devolve a negociacao com as parcelas em ordem", async () => {
    const n = await storage.obterNegociacao(PROVEDOR, 77);
    expect(n?.id).toBe(77);
    expect(n?.parcelamento).toHaveLength(1);
    expect(banco.consultas[1].sql).toMatch(/order by "cobranca_parcelas"\."numero" asc/);
  });

  it("obterParcela", async () => {
    const p = await storage.obterParcela(PROVEDOR, 501);
    expect(p?.numero).toBe(1);
  });

  it("o que nao existe volta undefined, sem segunda consulta", async () => {
    banco.linhas.set("cobranca_negociacoes", []);
    expect(await storage.obterNegociacao(PROVEDOR, 77)).toBeUndefined();
    expect(banco.consultas).toHaveLength(1);
    banco.linhas.set("cobranca_parcelas", []);
    expect(await storage.obterParcela(PROVEDOR, 501)).toBeUndefined();
    banco.linhas.set("customers", []);
    expect(await storage.obterCliente(PROVEDOR, 42)).toBeUndefined();
  });
});

describe("customers.contract_start_date — a fidelidade do DNA", () => {
  const clientes = () => new CustomersStorage();
  const doErp = (contractStartDate?: Date) => ({
    providerId: PROVEDOR, cpfCnpj: "12328395074", name: "Maria da Carteira",
    totalOverdueAmount: 0, maxDaysOverdue: 0, overdueInvoicesCount: 0, erpSource: "mk", contractStartDate,
  });

  it("dataSemHora le as partes locais — o dia que o ERP disse, em qualquer fuso", () => {
    expect(dataSemHora(new Date(2021, 2, 20))).toBe("2021-03-20");
    expect(dataSemHora(new Date(2021, 11, 31, 23, 59, 59))).toBe("2021-12-31");
    expect(dataSemHora(new Date(2024, 0, 1, 0, 0, 0))).toBe("2024-01-01");
  });

  it("cliente novo nasce com a data, como YYYY-MM-DD", async () => {
    banco.linhas.set("customers", []);
    await clientes().upsertFromErp(doErp(new Date(2021, 2, 20)));
    const [ins] = inserts("customers");
    expect(ins.sql).toContain('"contract_start_date"');
    expect(ins.params).toContain("2021-03-20");
  });

  it("cliente que existe recebe a data quando o ERP a informa", async () => {
    await clientes().upsertFromErp(doErp(new Date(2019, 6, 1)));
    const [upd] = updates("customers");
    expect(upd.sql).toContain('"contract_start_date"');
    expect(upd.params).toContain("2019-07-01");
  });

  it("ERP que nao informa nao apaga a data que ja estava gravada", async () => {
    await clientes().upsertFromErp(doErp(undefined));
    const [upd] = updates("customers");
    // So o SET importa: o RETURNING lista todas as colunas, inclusive esta.
    expect(upd.sql.slice(0, upd.sql.indexOf(" where "))).not.toContain('"contract_start_date"');
  });
});

/**
 * O que o banco grava e o que o motor entende tem de ser o MESMO vocabulario.
 * `shared/cobranca` (dna, regua, politica, estados) e outra frente do mesmo
 * pedido: se as duas listas divergirem, o caso e gravado com um status que a
 * maquina de estados nao reconhece, ou a fila ordena por uma prioridade que a
 * tela nunca oferece. Este bloco quebra no primeiro desalinhamento.
 */
describe("paridade com shared/cobranca — o vocabulario e um so", () => {
  it("status fechados, carteiras e prioridades", async () => {
    const estados = await import("@shared/cobranca/estados");
    expect([...STATUS_CASO_FECHADO]).toEqual([...estados.STATUS_FECHADOS_DE_CASO]);
    expect([...CARTEIRAS_DE_COBRANCA]).toEqual([...estados.CARTEIRAS]);
    expect([...PRIORIDADES_DE_CASO]).toEqual([...estados.PRIORIDADES]);
    expect([...STATUS_NEGOCIACAO]).toEqual([...estados.STATUS_DE_NEGOCIACAO]);
    expect([...STATUS_CASO_COBRANCA].sort()).toEqual([...estados.STATUS_DE_CASO].sort());
  });

  it("os eventos que o storage grava sozinho existem na lista de tipos", async () => {
    const { TIPOS_DE_EVENTO } = await import("@shared/cobranca/estados");
    for (const tipo of ["etapa_mudou", "responsavel_mudou", "encerramento", "cancelamento", "negociacao_proposta", "acordo_aceito", "acordo_quebrado", "parcela_paga", "nota"]) {
      expect(TIPOS_DE_EVENTO, tipo).toContain(tipo);
    }
  });

  it("os defaults da politica sao os mesmos do schema e da migracao", async () => {
    const { POLITICA_PADRAO } = await import("@shared/cobranca/politica");
    expect(POLITICA_DE_COBRANCA_PADRAO.negociacao).toEqual(POLITICA_PADRAO.negociacao);
    expect(POLITICA_DE_COBRANCA_PADRAO.encargos).toEqual(POLITICA_PADRAO.encargos);
    expect(POLITICA_DE_COBRANCA_PADRAO.janelaContato).toEqual(POLITICA_PADRAO.janelaContato);
    expect(POLITICA_DE_COBRANCA_PADRAO.economia).toEqual(POLITICA_PADRAO.economia);
  });
});
