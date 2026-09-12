import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SESSION_SECRET` precisa existir ANTES de qualquer import avaliar
 * `server/utils/crypto.ts` (a chave do `apiToken` cifrado da integração
 * "demo" deriva dele) ou `server/auth.ts`. `DEMO_MODE` precisa existir antes
 * do import de `server/erp/connectors/demo.ts` (auto-registro condicionado a
 * `emModoDemo()`, avaliado uma vez, na carga do módulo). Os dois em
 * `vi.hoisted` — mesmo padrão de `server/demo/mundo-base.test.ts`.
 */
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "segredo-de-teste-sandbox";
  process.env.DEMO_MODE = "true";
});

/**
 * Banco de mentira, no mesmo molde de `server/demo/mundo-base.test.ts`: o
 * compilador SQL REAL do Drizzle (via `drizzle-orm/pg-proxy`) fala com o
 * callback abaixo, que reconstrói cada INSERT/SELECT/DELETE e acumula as
 * linhas em memória. Estende o de `mundo-base.test.ts` com um handler de
 * DELETE, porque `apagarSandbox` apaga de verdade (mundo-base.ts nunca
 * apagava nada).
 *
 * Sem `beforeEach` limpando `banco.linhas`: os `it()` abaixo são
 * deliberadamente sequenciais (mesmo padrão do arquivo irmão).
 */
const banco = vi.hoisted(() => ({
  linhas: new Map<string, Record<string, unknown>[]>(),
  proximoId: new Map<string, number>(),
  db: null as any,
}));

vi.mock("../db", () => ({
  db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }),
  pool: {},
}));

import { getTableColumns, getTableName, is, SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import {
  providers,
  users,
  customers,
  invoices,
  equipment,
  erpIntegrations,
  cobrancaCasos,
  cobrancaEventos,
  cobrancaNegociacoes,
  cobrancaParcelas,
  antiFraudAlerts,
  proactiveAlerts,
  ispConsultations,
  spcConsultations,
  // As tabelas abaixo não são escritas por `criarSandbox`, mas
  // `storage.deleteProvider` (reusada por `apagarSandbox`, rodada de
  // correção 11/09/2026) lê/escreve nelas, e o teste de completude semeia
  // TODA tabela com FK para `providers` — o banco de mentira precisa do
  // mapa de colunas de cada uma delas para não estourar "Tabela sem mapa".
  contracts,
  providerInvoices,
  creditOrders,
  planChanges,
  providerPartners,
  erpSyncLogs,
  supportThreads,
  supportMessages,
  acessosSuporte,
  cobrancaConfissoes,
  cobrancaConfissoesPdf,
  cobrancaPolitica,
  antiFraudRules,
  assinaturaIntegracoes,
  bigdataConsultations,
  bigdataIntegrations,
  chatAutonomiaConfig,
  chatAutonomiaEstado,
  chatAutonomiaFila,
  chatBullqConversas,
  chatBullqIntegracoes,
  comissaoLancamentos,
  equipmentRecoveryCases,
  equipmentRecoveryEvents,
  marcaEventos,
  providerDocuments,
} from "@shared/schema";
import {
  criarSandbox,
  sandboxesExpirados,
  contarSandboxesVivos,
  apagarSandbox,
  SALDO_INICIAL,
} from "./sandbox.service";
import { PROVEDORES_DA_DEMO, INDICE_MIGRADOR_DE_EXEMPLO } from "./mundo-base";
import { limparSandboxesExpirados } from "./limpeza.service";
import { cpfFicticio } from "./pessoas-ficticias";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import { buildConnectorConfig } from "../erp/config";
import { getConnector } from "../erp/registry";
import { detectMigrator } from "../services/migrator-detection.service";
import { decryptField } from "../utils/crypto";
import { motivosGravados, rotuloDoAlerta } from "@shared/antifraude-avaliacao";
import { maskAlertForProvider } from "../utils/mask-alert";
import { casoFechado } from "@shared/cobranca/estados";
import { logger } from "../logger";
// Efeito colateral: com DEMO_MODE=true (acima), registra o conector "demo" no registry.
import "../erp/connectors/demo";

const TABELAS = [
  providers,
  users,
  customers,
  invoices,
  equipment,
  erpIntegrations,
  cobrancaCasos,
  cobrancaEventos,
  cobrancaNegociacoes,
  cobrancaParcelas,
  antiFraudAlerts,
  proactiveAlerts,
  ispConsultations,
  spcConsultations,
  contracts,
  providerInvoices,
  creditOrders,
  planChanges,
  providerPartners,
  erpSyncLogs,
  supportThreads,
  supportMessages,
  acessosSuporte,
  cobrancaConfissoes,
  cobrancaConfissoesPdf,
  cobrancaPolitica,
  antiFraudRules,
  assinaturaIntegracoes,
  bigdataConsultations,
  bigdataIntegrations,
  chatAutonomiaConfig,
  chatAutonomiaEstado,
  chatAutonomiaFila,
  chatBullqConversas,
  chatBullqIntegracoes,
  comissaoLancamentos,
  equipmentRecoveryCases,
  equipmentRecoveryEvents,
  marcaEventos,
  providerDocuments,
];
/** tabela (nome real do banco) -> (coluna do banco -> chave camelCase que o Drizzle usa em JS). */
const chavePorColuna = new Map(
  TABELAS.map((t) => [
    getTableName(t),
    new Map(Object.entries(getTableColumns(t)).map(([chave, coluna]) => [(coluna as any).name as string, chave])),
  ]),
);
/** tabela (nome real do banco) -> (chave camelCase -> objeto de coluna do Drizzle) — usado por `valorPadraoDaColuna` para checar `hasDefault`/`default`/`dataType` sem reconstruir o schema à mão. */
const colunaPorCampo = new Map(TABELAS.map((t) => [getTableName(t), getTableColumns(t) as Record<string, any>]));

function proximoId(tabela: string): number {
  const atual = (banco.proximoId.get(tabela) ?? 0) + 1;
  banco.proximoId.set(tabela, atual);
  return atual;
}

/** `"id"` ou `"tabela"."id"` -> `"id"`. */
function nomesDeColuna(textoDeColunas: string): string[] {
  return textoDeColunas.split(", ").map((c) => {
    const m = c.match(/^(?:"(\w+)"\.)?"(\w+)"$/);
    if (!m) throw new Error(`Coluna nao reconhecida pelo banco de mentira: ${c}`);
    return m[2];
  });
}

/**
 * O decoder de TIMESTAMP do drizzle-orm (`PgTimestamp.mapFromDriverValue`,
 * para uma coluna sem `withTimezone` — o caso de `invoices.dueDate`,
 * `customers.cortadoEm` etc.) monta a data como `valor + "+0000"`: ele
 * espera de volta exatamente o que um driver real de Postgres devolveria
 * para "timestamp without time zone", uma string SEM sufixo de fuso. A
 * GRAVAÇÃO (`mapToDriverValue`) grava `date.toISOString()`, que termina em
 * "Z" — devolver essa mesma string na LEITURA vira "...Z+0000", uma data
 * invalida (confirmado por sonda isolada contra o drizzle-orm real antes de
 * escrever isto). `mundo-base.test.ts` nunca precisou disto porque seus
 * helpers leem `banco.linhas` direto, sem passar pelo decoder — este arquivo
 * precisa porque o conector "demo" (produção) FAZ um SELECT de verdade e lê
 * `fatura.dueDate` já decidido.
 */
function paraFormatoDeDriverReal(valor: unknown): unknown {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(valor)) {
    return valor.slice(0, -1);
  }
  return valor;
}

/** Linhas (objeto, chave camelCase) -> array-of-arrays na ordem das colunas pedidas — o formato que o pg-proxy espera de volta. */
function projetar(tabela: string, linhas: Record<string, unknown>[], textoDeColunas: string): unknown[][] {
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunas = nomesDeColuna(textoDeColunas);
  return linhas.map((linha) => colunas.map((c) => paraFormatoDeDriverReal(mapa.get(c) ? linha[mapa.get(c)!] ?? null : null)));
}

/**
 * O valor que um Postgres de verdade aplicaria para uma coluna que o INSERT
 * marcou como `default` (rodada de correção, 12/09/2026). Antes desta função
 * TODA coluna não-`id` virava `null` aqui — `defaultNow()` incluído —, e isso
 * era o defeito real por trás do "sweep apaga 20" documentado no relatório da
 * rodada: `providers.createdAt` (`defaultNow()`) nascia `null` para todo
 * provider inserido sem valor explícito (todo sandbox de `criarSandbox()`, que
 * nunca passa `createdAt`), e `sandboxesExpirados()` trata `createdAt` nulo
 * como epoch — mais velho que 24h, sempre "expirado". Como este arquivo é
 * sequencial e cumulativo (ver o comentário no topo), cada sandbox de um
 * `it()` anterior que nunca chamou `envelhecer`/`apagarSandbox` ficava
 * empilhado como "já expirado" por este defeito, não pela idade real.
 *
 * Só dois casos dão para calcular em JS puro, sem um Postgres de verdade para
 * avaliar a expressão:
 *   1. um literal puro (`.default(valor)`, sem `sql\`...\``) — usa direto;
 *   2. `defaultNow()` — que o Drizzle grava como `default: sql\`now()\``,
 *      nunca como `defaultFn` — vira "agora". Só entra aqui quando a coluna é
 *      `dataType "date"` (timestamp): conferido por grep em `shared/schema.ts`
 *      antes de escrever isto — nenhuma OUTRA coluna date/timestamp do schema
 *      usa `sql\`...\`` como default, então a checagem por dataType basta e
 *      não depende de inspecionar o texto interno do fragmento SQL.
 * Qualquer outra expressão SQL (ex.: `sql\`'{}'::text[]\`` num array, ou
 * `sql\`'[]'::jsonb\`` num jsonb) cai em `null` — o MESMO comportamento de
 * antes desta correção, porque não há Postgres aqui para avaliar a expressão,
 * e nenhum teste deste arquivo depende do valor dessas colunas.
 */
function valorPadraoDaColuna(coluna: { hasDefault: boolean; default?: unknown; defaultFn?: () => unknown; dataType: string } | undefined): unknown {
  if (!coluna?.hasDefault) return null;
  if (typeof coluna.defaultFn === "function") return coluna.defaultFn();
  const bruto = coluna.default;
  if (bruto === undefined) return null;
  if (is(bruto, SQL)) return coluna.dataType === "date" ? new Date().toISOString() : null;
  return bruto;
}

/**
 * Reconstrói um INSERT de verdade — `insert into "t" ("a","b") values ($1,$2),($3,$4) [returning ...]`
 * — e acumula cada tupla como linha (camelCase), atribuindo `id` auto-incremental
 * quando a coluna não veio na lista (bulk insert nunca informa `id`, e um
 * `.returning()` SEM argumento — `storage.createProvider`/`createUser` — lista
 * TODAS as colunas da tabela, mas isso não muda o formato: é só uma lista
 * mais longa de identificadores entre aspas).
 */
function processarInsert(sqlTexto: string, params: unknown[]): { tabela: string; linhasCriadas: Record<string, unknown>[] } {
  const m = sqlTexto.match(/^insert into "(\w+)" \(([^)]*)\) values (.+?)(?: returning (.+))?$/s);
  if (!m) throw new Error(`INSERT nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const tabela = m[1];
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunasDaTabela = colunaPorCampo.get(tabela);
  const colunas = m[2].split(", ").map((c) => c.replace(/"/g, ""));
  const tuplas = Array.from(m[3].matchAll(/\(([^()]*)\)/g)).map((t) => t[1].split(", "));

  const acumulado = banco.linhas.get(tabela) ?? [];
  const linhasCriadas: Record<string, unknown>[] = [];
  for (const tupla of tuplas) {
    const linha: Record<string, unknown> = {};
    colunas.forEach((coluna, idx) => {
      const chave = mapa.get(coluna);
      if (!chave) throw new Error(`Coluna "${coluna}" nao mapeada em "${tabela}"`);
      const valorBruto = tupla[idx];
      if (valorBruto === "default") {
        linha[chave] = coluna === "id" ? proximoId(tabela) : valorPadraoDaColuna(colunasDaTabela?.[chave]);
        return;
      }
      const ref = valorBruto?.match(/^\$(\d+)$/);
      if (!ref) throw new Error(`Valor inesperado (nao e parametro nem default) em ${tabela}.${coluna}: ${valorBruto}`);
      linha[chave] = params[Number(ref[1]) - 1];
    });
    acumulado.push(linha);
    linhasCriadas.push(linha);
  }
  banco.linhas.set(tabela, acumulado);
  return { tabela, linhasCriadas };
}

/**
 * Avalia um trecho de WHERE contra uma linha — três formas, que juntas
 * cobrem tudo que este par de arquivos e `storage.deleteProvider` emitem:
 * `"t"."col" = $N` (igualdade), `"t"."col" in ($N, $M, ...)` (usada pelo
 * `inArray` de `deleteProvider` para apagar `support_messages` pelos ids de
 * thread), e o literal `false` (o que o Drizzle gera para um `inArray` com
 * lista VAZIA — nenhuma linha bate). Todas as condições encontradas são
 * combinadas em E, que é tudo que os dois arquivos precisam.
 */
function avaliarCondicoes(whereTexto: string, mapa: Map<string, string>, params: unknown[], linha: Record<string, unknown>): boolean {
  if (whereTexto.trim() === "false") return false;
  const igualdades = Array.from(whereTexto.matchAll(/"(?:\w+)"\."(\w+)" = \$(\d+)/g));
  for (const c of igualdades) {
    if (linha[mapa.get(c[1])!] !== params[Number(c[2]) - 1]) return false;
  }
  const listas = Array.from(whereTexto.matchAll(/"(?:\w+)"\."(\w+)" in \(([^)]*)\)/g));
  for (const c of listas) {
    const indices = c[2].split(", ").map((ref) => Number(ref.replace("$", "")) - 1);
    const permitidos = indices.map((i) => params[i]);
    if (!permitidos.includes(linha[mapa.get(c[1])!])) return false;
  }
  return true;
}

/** `select <cols> from "t" [where ...]` — igualdade, `in` ou `false`, ver `avaliarCondicoes`. */
function processarSelect(sqlTexto: string, params: unknown[]): unknown[][] {
  const m = sqlTexto.match(/^select (.+) from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`SELECT nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, textoDeColunas, tabela, whereTexto] = m;
  let linhas = banco.linhas.get(tabela) ?? [];
  if (whereTexto) {
    const mapa = chavePorColuna.get(tabela)!;
    linhas = linhas.filter((linha) => avaliarCondicoes(whereTexto, mapa, params, linha));
  }
  return projetar(tabela, linhas, textoDeColunas);
}

/**
 * `select count(*)::int from "t" [where ...]` — o guard de LGPD de
 * `storage.deleteProvider` (`server/storage/providers.storage.ts:191-194`),
 * que conta `acessos_suporte` antes de decidir se apaga. Formato conferido
 * por sonda isolada contra o drizzle-orm real antes de escrever isto: SEM
 * alias (`sql<number>` é só o tipo do TypeScript, não aparece no SQL).
 */
function processarCount(sqlTexto: string, params: unknown[]): unknown[][] {
  const m = sqlTexto.match(/^select count\(\*\)::int from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`COUNT nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, tabela, whereTexto] = m;
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const linhas = (banco.linhas.get(tabela) ?? []).filter((linha) => !whereTexto || avaliarCondicoes(whereTexto, mapa, params, linha));
  return [[String(linhas.length)]];
}

/**
 * `delete from "t" [where ...]` — `apagarSandbox` e `storage.deleteProvider`
 * (reusada por ela, rodada de correção 11/09/2026) são os únicos códigos
 * deste par de arquivos que apagam (mundo-base.ts nunca precisou). Remove do
 * banco de mentira toda linha que bater com as condições — mesmo avaliador
 * que `processarSelect` usa, igualdade/`in`/`false` incluídos.
 */
function processarDelete(sqlTexto: string, params: unknown[]): void {
  const m = sqlTexto.match(/^delete from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`DELETE nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, tabela, whereTexto] = m;
  const linhasAtuais = banco.linhas.get(tabela) ?? [];
  if (!whereTexto) {
    banco.linhas.set(tabela, []);
    return;
  }
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const restantes = linhasAtuais.filter((linha) => !avaliarCondicoes(whereTexto, mapa, params, linha));
  banco.linhas.set(tabela, restantes);
}

beforeAll(() => {
  const proxy = drizzle(async (sqlTexto: string, params: unknown[]) => {
    if (sqlTexto.startsWith("insert into")) {
      const retorno = sqlTexto.match(/ returning (.+)$/s);
      const { tabela, linhasCriadas } = processarInsert(sqlTexto, params);
      return { rows: retorno ? projetar(tabela, linhasCriadas, retorno[1]) : [] };
    }
    if (sqlTexto.startsWith("select count(*)::int from")) {
      return { rows: processarCount(sqlTexto, params) };
    }
    if (sqlTexto.startsWith("select")) {
      return { rows: processarSelect(sqlTexto, params) };
    }
    if (sqlTexto.startsWith("delete from")) {
      processarDelete(sqlTexto, params);
      return { rows: [] };
    }
    throw new Error(`SQL nao suportado pelo banco de mentira: ${sqlTexto}`);
  });
  // O `pg-proxy` de verdade RECUSA transação. `criarSandbox`/`apagarSandbox`
  // usam `db.transaction(...)` — mesmo substituto de `mundo-base.test.ts`:
  // chama o callback com o MESMO proxy, o que basta para provar que as
  // escritas/remoções acontecem "dentro".
  banco.db = Object.assign(proxy, {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(proxy),
  });
});

// ── Leituras diretas do banco de mentira ────────────────────────────────────

async function clientesDe(providerId: number): Promise<Record<string, unknown>[]> {
  return (banco.linhas.get("customers") ?? []).filter((c) => c.providerId === providerId);
}

async function equipamentosDe(providerId: number): Promise<Record<string, unknown>[]> {
  return (banco.linhas.get("equipment") ?? []).filter((e) => e.providerId === providerId);
}

async function providerDe(providerId: number): Promise<Record<string, unknown>> {
  const linha = (banco.linhas.get("providers") ?? []).find((p) => p.id === providerId);
  if (!linha) throw new Error(`Provider nao encontrado: ${providerId}`);
  return linha;
}

async function casosDeCobrancaDe(providerId: number): Promise<Record<string, unknown>[]> {
  return (banco.linhas.get("cobranca_casos") ?? []).filter((c) => c.providerId === providerId);
}

async function faturasDe(providerId: number): Promise<Record<string, unknown>[]> {
  return (banco.linhas.get("invoices") ?? []).filter((f) => f.providerId === providerId);
}

async function integracaoDe(providerId: number): Promise<Record<string, unknown> | undefined> {
  return (banco.linhas.get("erp_integrations") ?? []).find((i) => i.providerId === providerId);
}

async function alertasAntiFraudeDe(providerId: number): Promise<Record<string, unknown>[]> {
  return (banco.linhas.get("anti_fraud_alerts") ?? []).filter((a) => a.providerId === providerId);
}

function idDe(subdomain: string): number {
  const linha = (banco.linhas.get("providers") ?? []).find((p) => p.subdomain === subdomain);
  if (!linha) throw new Error(`Provedor nao semeado: ${subdomain}`);
  return linha.id as number;
}

/** Todos os CPFs de clientes dos 5 provedores do mundo base — lidos do banco de mentira, sem recalcular índice nenhum. */
async function todosOsCpfsDaBase(): Promise<Set<string>> {
  const idsDaBase = new Set(PROVEDORES_DA_DEMO.map((p) => idDe(p.subdomain)));
  const cpfs = (banco.linhas.get("customers") ?? [])
    .filter((c) => idsDaBase.has(c.providerId as number))
    .map((c) => c.cpfCnpj as string);
  return new Set(cpfs);
}

/** Um CPF de cada situação, para a tela sugerir o que testar — deduzido por PROPRIEDADE, nunca por fórmula de índice. */
async function cpfsDeExemplo(providerId: number): Promise<Array<{ situacao: string; cpf: string }>> {
  const clientes = await clientesDe(providerId);
  const cpfsDaBase = await todosOsCpfsDaBase();

  const limpo = clientes.find(
    (c) => c.paymentStatus === "current" && c.status === "active" && !cpfsDaBase.has(c.cpfCnpj as string),
  );
  const devendoNaRede = clientes.find((c) => cpfsDaBase.has(c.cpfCnpj as string));
  if (!limpo) throw new Error("nenhum cliente 'limpo' encontrado no sandbox");
  if (!devendoNaRede) throw new Error("nenhum cliente 'devendo_na_rede' encontrado no sandbox");

  return [
    { situacao: "limpo", cpf: limpo.cpfCnpj as string },
    { situacao: "devendo_na_rede", cpf: devendoNaRede.cpfCnpj as string },
    { situacao: "migrador_serial", cpf: cpfFicticio(INDICE_MIGRADOR_DE_EXEMPLO) },
  ];
}

/** Move `createdAt` do sandbox `ms` milissegundos para trás — simula o tempo passar sem esperar 24h de verdade. */
async function envelhecer(providerId: number, ms: number): Promise<void> {
  const linha = (banco.linhas.get("providers") ?? []).find((p) => p.id === providerId);
  if (!linha) throw new Error(`Provider nao encontrado: ${providerId}`);
  linha.createdAt = new Date(Date.now() - ms);
}

describe("sandbox do visitante", () => {
  it("nasce com a carteira de um provedor de verdade", async () => {
    const inicio = performance.now();
    const s = await criarSandbox();
    // eslint-disable-next-line no-console
    console.log(`[medicao] criarSandbox() contra o banco de mentira: ${(performance.now() - inicio).toFixed(1)}ms (inclui semearMundoBase, primeira chamada)`);
    expect(s.subdomain).toMatch(/^sandbox-[a-f0-9]{16}$/);
    const clientes = await clientesDe(s.providerId);
    expect(clientes).toHaveLength(1500);
    expect(clientes.filter((c) => c.paymentStatus === "overdue")).toHaveLength(225);
    expect(clientes.filter((c) => c.status === "cancelled")).toHaveLength(150);
    expect(await equipamentosDe(s.providerId)).toHaveLength(120);
    // Nao existe coluna "saldo" — providers tem ispCredits e spcCredits,
    // separadas (shared/schema.ts:167-168). Os dois nascem em SALDO_INICIAL.
    const provider = await providerDe(s.providerId);
    expect(provider.ispCredits).toBe(SALDO_INICIAL);
    expect(provider.spcCredits).toBe(SALDO_INICIAL);
  });

  it("150 CPFs da carteira tambem existem na rede — senao a consulta so diz 'nada consta'", async () => {
    const s = await criarSandbox();
    const cpfsDaBase = await todosOsCpfsDaBase();
    const cpfsDoSandbox = (await clientesDe(s.providerId)).map((c) => c.cpfCnpj as string);
    const naRede = cpfsDoSandbox.filter((cpf) => cpfsDaBase.has(cpf));
    expect(naRede).toHaveLength(150);
  });

  it("todo cliente ja nasce com coordenada — o mapa de calor nao espera geocodificacao", async () => {
    const s = await criarSandbox();
    const semCoordenada = (await clientesDe(s.providerId)).filter((c) => !c.latitude || !c.longitude);
    expect(semCoordenada).toHaveLength(0);
  });

  it("tres CPFs de exemplo, um de cada situacao, para a tela sugerir o que testar", async () => {
    const s = await criarSandbox();
    const exemplos = await cpfsDeExemplo(s.providerId);
    expect(exemplos.map((e) => e.situacao).sort()).toEqual(["devendo_na_rede", "limpo", "migrador_serial"]);
  });

  /**
   * Teste dedicado da rodada de correção (12/09/2026) — prova, isolada de
   * qualquer outro `it()`, que o banco de mentira aplica o default REAL de
   * `providers.createdAt` (`defaultNow()`) num INSERT sem valor explícito
   * (exatamente o que `tentarCriarSandbox` faz), em vez de gravar `null`.
   *
   * Sem `valorPadraoDaColuna` (o fix), `criadoEm` seria `null`, este teste
   * falharia nas duas asserções abaixo (`null` não é uma `Date` válida, e
   * `sandboxesExpirados()` trataria este sandbox recém-nascido como epoch —
   * "mais velho que 24h" — incluindo-o na lista logo após criar).
   */
  it("um sandbox recem-criado nasce com createdAt de AGORA (defaultNow() aplicado pelo banco de mentira), nunca null — e por isso nao aparece como expirado", async () => {
    const s = await criarSandbox();
    const provider = await providerDe(s.providerId);

    expect(provider.createdAt, "createdAt nulo — o banco de mentira nao aplicou o default de providers.createdAt").not.toBeNull();
    const idadeMs = Date.now() - new Date(provider.createdAt as string).getTime();
    expect(idadeMs, "createdAt deveria ser proximo de agora, nao uma data arbitraria").toBeLessThan(60_000);

    // Prova pelo caminho REAL (db.select + decode de verdade do Drizzle):
    // um sandbox recem-criado nunca deveria aparecer como candidato a apagar.
    expect(await sandboxesExpirados()).not.toContain(s.providerId);
  });

  /**
   * Usa `toContain`/`not.toContain`, não `toEqual([velho.providerId])`: este
   * arquivo é sequencial e cumulativo, e outros `it()` (antes e depois deste)
   * também chamam `criarSandbox()` sem envelhecer nem apagar o resultado — a
   * lista de `sandboxesExpirados()` pode legitimamente conter outros ids além
   * de `velho`. O teste prova exatamente as duas coisas do seu nome (o
   * sandbox velho ENTRA, a rede NUNCA entra) e nada além disso.
   *
   * Nota da rodada de correção (12/09/2026): antes desta correção a lista
   * também vinha inflada por um defeito do banco de mentira — todo sandbox
   * criado sem `envelhecer`/`apagarSandbox` ficava com `createdAt` NULO
   * (tratado como epoch, "sempre expirado"), não só pela acumulação legítima
   * de outros `it()`. As duas asserções abaixo já passavam antes E continuam
   * passando agora, mas antes toleravam RUÍDO por acidente (a lista incluía
   * dezenas de ids que não deveriam estar expirados); agora toleram apenas a
   * acumulação legítima do desenho do arquivo. Ver `valorPadraoDaColuna`
   * (acima) e o relatório da rodada para a contagem medida antes/depois.
   */
  it("expira so o sandbox, nunca o mundo base", async () => {
    const velho = await criarSandbox();
    await envelhecer(velho.providerId, 25 * 60 * 60 * 1000);
    const ids = await sandboxesExpirados();
    expect(ids).toContain(velho.providerId);
    for (const p of PROVEDORES_DA_DEMO) expect(ids).not.toContain(idDe(p.subdomain));
  });

  /**
   * Revisão final de segurança antes da demonstração pública (item 3):
   * `contarSandboxesVivos` contava TODO sandbox da tabela, expirado ou não —
   * um sandbox com mais de 24h continuava ocupando vaga no teto até a
   * limpeza HORÁRIA o alcançar (ou para sempre, se a limpeza atrasar ou
   * parar). O teste mede por DELTA, não por valor absoluto: os `it()` deste
   * arquivo são deliberadamente sequenciais e acumulam sandboxes no mesmo
   * banco de mentira desde o início da suíte.
   *
   * `envelhecer(id, 0)` dá ao "vivo" um `createdAt` explícito de AGORA —
   * deixa o teste claro e determinístico, sem depender de quão rápido o
   * relógio de fundo anda entre a criação e a leitura.
   *
   * Nota da rodada de correção (12/09/2026): até esta correção o banco de
   * mentira NÃO simulava o `defaultNow()` da coluna — todo sandbox nascia com
   * `createdAt` NULO, que este filtro (o MESMO corte de `sandboxesExpirados`)
   * tratava como epoch e portanto já expirado, e `envelhecer(id, 0)` era a
   * ÚNICA coisa que salvava o "vivo" de contar como expirado por acidente.
   * Agora `processarInsert`/`valorPadraoDaColuna` aplicam o default REAL da
   * coluna (`defaultNow()` vira "agora"), então um sandbox recém-criado já
   * nasce corretamente "vivo" mesmo sem `envelhecer` — a chamada abaixo
   * continua por clareza (fixa o instante em vez de depender do relógio de
   * fundo), não mais por necessidade.
   */
  it("contarSandboxesVivos NAO conta sandbox ja expirado, mesmo que a linha ainda exista (limpeza horaria ainda nao passou)", async () => {
    const antes = await contarSandboxesVivos();

    const vivo = await criarSandbox();
    await envelhecer(vivo.providerId, 0);
    const expirado = await criarSandbox();
    await envelhecer(expirado.providerId, 25 * 60 * 60 * 1000);

    const depois = await contarSandboxesVivos();

    // So o "vivo" soma ao teto — o "expirado" existe na tabela (a limpeza
    // ainda nao rodou), mas nao ocupa mais vaga.
    expect(depois).toBe(antes + 1);
  });

  it("contarSandboxesVivos conta um sandbox recem-criado normalmente", async () => {
    const antes = await contarSandboxesVivos();
    const s = await criarSandbox();
    await envelhecer(s.providerId, 0);
    const depois = await contarSandboxesVivos();
    expect(depois).toBe(antes + 1);
  });

  it("apagar leva junto as linhas do provedor", async () => {
    const s = await criarSandbox();
    await apagarSandbox(s.providerId);
    expect(await clientesDe(s.providerId)).toHaveLength(0);
  });

  // ── Alocação de índices: prova por EXECUÇÃO, não por fórmula reconstruída ──

  it("os 1.500 clientes do sandbox nao colidem com o mundo base: 150 REAPROVEITAM CPF da rede de proposito, os outros 1.350 sao exclusivos", async () => {
    const s = await criarSandbox();
    const cpfsDoSandbox = (await clientesDe(s.providerId)).map((c) => c.cpfCnpj as string);
    expect(new Set(cpfsDoSandbox).size, "CPF repetido dentro do proprio sandbox").toBe(1500);

    const cpfsDaBase = await todosOsCpfsDaBase();
    const compartilhados = cpfsDoSandbox.filter((cpf) => cpfsDaBase.has(cpf));
    const exclusivos = cpfsDoSandbox.filter((cpf) => !cpfsDaBase.has(cpf));
    expect(compartilhados).toHaveLength(150);
    expect(exclusivos).toHaveLength(1350);
  });

  it("dois sandboxes concorrentes nunca geram o mesmo CPF exclusivo (prova por execucao contra o gerador real, nao por formula)", async () => {
    const cpfsDaBase = await todosOsCpfsDaBase();
    const exclusivosDe = async (providerId: number) =>
      (await clientesDe(providerId)).map((c) => c.cpfCnpj as string).filter((cpf) => !cpfsDaBase.has(cpf));

    const a = await criarSandbox();
    const b = await criarSandbox();
    const exclusivosA = await exclusivosDe(a.providerId);
    const exclusivosB = await exclusivosDe(b.providerId);
    expect(exclusivosA).toHaveLength(1350);
    expect(exclusivosB).toHaveLength(1350);
    expect(exclusivosA.filter((cpf) => exclusivosB.includes(cpf))).toHaveLength(0);
  });

  it("cada sandbox nasce com administrador proprio — dois sandboxes seguidos nao colidem em users.email (notNull+unique)", async () => {
    const a = await criarSandbox();
    const b = await criarSandbox();
    expect(a.userId).not.toBe(b.userId);
  });

  it("o quadro de cobranca ja nasce com um caso em cada uma das 9 colunas do kanban", async () => {
    const s = await criarSandbox();
    const casos = await casosDeCobrancaDe(s.providerId);
    const ORDEM_DO_KANBAN = ["aberto", "em_contato", "negociando", "acordo_ativo", "pago", "cancelamento", "negativado", "baixado", "encerrado"];
    expect(new Set(casos.map((c) => c.status))).toEqual(new Set(ORDEM_DO_KANBAN));
  });

  /**
   * Rodada de correção (Tarefa 3, 11/09/2026): ter uma LINHA por status não
   * prova que a COLUNA aparece no quadro. `montarColuna`
   * (`server/routes/cobranca.routes.ts`) só mostra uma coluna FECHADA
   * (`casoFechado`: pago, baixado, encerrado, cancelamento) quando o caso tem
   * `encerradoEm` DENTRO da janela de 30 dias (`JANELA_DE_FECHADOS_DIAS`) —
   * o mesmo filtro está reproduzido aqui, contra o que `criarSandbox()`
   * REALMENTE gravou. Antes desta correção, `encerradoEm` nascia sempre
   * `null` para as quatro, e as quatro colunas apareciam vazias no quadro
   * mesmo com o caso existindo (o teste acima, sozinho, nunca pegava isso).
   */
  it("as quatro colunas FECHADAS do kanban tem encerradoEm dentro da janela de 30 dias que montarColuna exige — senao a coluna aparece vazia mesmo com o caso existindo", async () => {
    const s = await criarSandbox();
    const casos = await casosDeCobrancaDe(s.providerId);
    const hoje = new Date();
    const fechadosDesde = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000); // JANELA_DE_FECHADOS_DIAS

    const statusFechados = casos.filter((c) => casoFechado(c.status as string));
    expect(statusFechados.map((c) => c.status).sort()).toEqual(["baixado", "cancelamento", "encerrado", "pago"]);

    for (const caso of statusFechados) {
      const encerradoEm = caso.encerradoEm as Date | string | null;
      expect(encerradoEm, `${caso.status}: encerradoEm nulo — a coluna nasce vazia`).not.toBeNull();
      const quando = new Date(encerradoEm as string | Date).getTime();
      expect(quando, `${caso.status}: encerradoEm fora da janela de 30 dias`).toBeGreaterThanOrEqual(fechadosDesde.getTime());
    }
  });

  it("faturas e clientes do sandbox saem marcados como vindos do ERP demo, com plano preenchido — sem isto a Economia e a carteira/mes ficam sem nada para contar", async () => {
    const s = await criarSandbox();
    const clientes = await clientesDe(s.providerId);
    for (const c of clientes) {
      expect(c.erpSource, JSON.stringify(c)).toBe(FONTE_ERP_DEMO);
      expect(c.contractPlan, JSON.stringify(c)).toEqual(expect.any(String));
    }

    const faturas = await faturasDe(s.providerId);
    expect(faturas.length).toBeGreaterThan(0);
    for (const f of faturas) {
      expect(f.erpSource, JSON.stringify(f)).toBe(FONTE_ERP_DEMO);
      expect((f.erpRef as string | null)?.length ?? 0, JSON.stringify(f)).toBeGreaterThan(0);
    }
    const refs = faturas.map((f) => f.erpRef as string);
    expect(new Set(refs).size, "erpRef duplicado dentro do mesmo sandbox").toBe(refs.length);
  });

  it("o provedor do sandbox nasce com cidadesAtendidas e addressState — senao o modo Rede do mapa manda o visitante configurar as proprias cidades", async () => {
    const s = await criarSandbox();
    const provider = await providerDe(s.providerId);
    expect(provider.addressState).toBe("PR");
    // `cidadesAtendidas` e coluna ARRAY: o pg-proxy nunca decodifica de volta
    // para JS (o banco de mentira le `banco.linhas` direto, sem passar pelo
    // decoder do Drizzle) — o que chega e o literal de array do Postgres que
    // `mapToDriverValue` gerou ao gravar, tipo `{"Londrina","Ibiporã",...}`.
    const cidades = provider.cidadesAtendidas as string;
    expect(cidades, "cidadesAtendidas vazio ou nulo").toBeTruthy();
    for (const cidade of ["Londrina", "Ibiporã", "Cambé", "Apucarana"]) {
      expect(cidades, cidades).toContain(cidade);
    }
  });

  it("o sandbox tem integracao 'demo' habilitada — sem ela a consulta ao vivo nunca alcanca o conector, nem para a PROPRIA carteira do sandbox", async () => {
    const s = await criarSandbox();
    const integracao = await integracaoDe(s.providerId);
    expect(integracao).toMatchObject({ erpSource: FONTE_ERP_DEMO, isEnabled: true });

    const apiUrl = (integracao?.apiUrl as string) ?? "";
    expect(apiUrl).not.toBe("");
    expect(() => new URL(apiUrl)).not.toThrow();
    expect(decryptField(integracao?.apiToken as string | null)).toBeTruthy();
  });

  /**
   * Rodada de correção (Tarefa 1, 11/09/2026): a raiz do defeito que motivou
   * esta rodada inteira — o visitante abre a PRÓPRIA carteira, vê um cliente
   * devendo, consulta o MESMO CPF, e a consulta respondia "nada consta"
   * porque o sandbox não tinha integração ERP nenhuma. Prova pelo caminho
   * REAL: o conector "demo" de verdade, respondendo pela integração que
   * `criarSandbox()` gravou — não por uma linha em `customers` inspecionada
   * isoladamente.
   */
  it("um cliente da PROPRIA carteira do sandbox e encontrado pela consulta ao vivo — a raiz do defeito que esta rodada corrige", async () => {
    const s = await criarSandbox();
    const clientes = await clientesDe(s.providerId);
    const inadimplente = clientes.find((c) => c.paymentStatus === "overdue")!;

    const integracao = (await integracaoDe(s.providerId))!;
    const config = buildConnectorConfig({
      apiUrl: integracao.apiUrl as string,
      apiToken: decryptField(integracao.apiToken as string | null),
      apiUser: null, clientId: null, clientSecret: null, mkContraSenha: null, extraConfig: null,
    });
    config.extra = { ...config.extra, providerId: String(s.providerId) };

    const conector = getConnector(FONTE_ERP_DEMO)!;
    const resultado = await conector.fetchCustomerByCpf!(config, inadimplente.cpfCnpj as string);
    expect(resultado.ok, JSON.stringify(resultado)).toBe(true);
    expect(resultado.customers).toHaveLength(1);
    expect(resultado.customers[0].totalOverdueAmount).toBeGreaterThan(0);
  });

  /**
   * Rodada de correção (Tarefa 4, 11/09/2026): sem alertas seedados, a aba
   * Anti-Fraude do sandbox SEMPRE abre vazia — a segunda funcionalidade que a
   * landing anuncia, e a demonstração nunca mostrava nada nela. Prova pelas
   * MESMAS transformações que `GET /api/anti-fraud/alerts`
   * (`server/routes/antifraude.routes.ts`) aplica antes de mandar para a
   * tela: `maskAlertForProvider` (o dono vê o próprio cliente sem máscara) e
   * `motivosGravados`/`rotuloDoAlerta` (o motivo que o card mostra) — não só
   * a existência da linha em `anti_fraud_alerts`.
   */
  it("o sandbox nasce com alertas de anti-fraude, na forma que a tela realmente le (mascaramento + motivo)", async () => {
    const s = await criarSandbox();
    const alertas = await alertasAntiFraudeDe(s.providerId);
    expect(alertas.length).toBeGreaterThan(0);

    const idsDaRede = new Set(PROVEDORES_DA_DEMO.map((p) => idDe(p.subdomain)));
    for (const alerta of alertas) {
      // Só "defaulter_consulted" chega na tela — "migrador_serial" é ignorado por design.
      expect(alerta.type).toBe("defaulter_consulted");
      // O consulente é sempre outro provedor de VERDADE da rede, nunca o próprio sandbox.
      expect(idsDaRede.has(alerta.consultingProviderId as number), JSON.stringify(alerta)).toBe(true);
      expect(alerta.consultingProviderId).not.toBe(s.providerId);

      // `riskFactors` e coluna JSONB: o pg-proxy grava o JSON.stringify que o
      // Drizzle gerou como parametro, e o banco de mentira devolve esse texto
      // cru (le `banco.linhas` direto, sem passar pelo decoder) — um
      // Postgres de verdade devolveria o array ja desserializado.
      const riskFactors = typeof alerta.riskFactors === "string" ? JSON.parse(alerta.riskFactors) : alerta.riskFactors;
      const motivos = motivosGravados(riskFactors);
      expect(motivos, JSON.stringify(alerta)).toContain("divida_ativa");
      expect(rotuloDoAlerta(motivos)).toBe("Fuga · cliente ativo com dívida");

      // `customerProviderId` simula o JOIN que `getAlertsByProvider` faz de
      // verdade (server/storage/antifraude.storage.ts) — sem ele
      // `maskAlertForProvider` não sabe que o cliente É do próprio dono.
      const mascarado = maskAlertForProvider({ ...alerta, customerProviderId: s.providerId }, s.providerId);
      expect(mascarado.customerName, "cliente do proprio dono nao deveria sair mascarado").toBe(alerta.customerName);
      expect(mascarado.customerCpfCnpj).toBe(alerta.customerCpfCnpj);
      // O nome do parceiro nunca sai cru — sempre o código anonimizado.
      expect(mascarado.consultingProviderName as string).toMatch(/^Provedor Parceiro ISP-/);
    }

    // Clientes distintos — os alertas não apontam todos para o mesmo cliente.
    expect(new Set(alertas.map((a) => a.customerId)).size).toBe(alertas.length);
  });

  // ── O sinal de migrador serial: prova pelo CAMINHO REAL, nao pela linha ──

  it("o CPF de exemplo 'migrador_serial' e detectado pelo caminho real (conector demo + detectMigrator) — nao so por uma linha inserida", async () => {
    const s = await criarSandbox();
    const exemplos = await cpfsDeExemplo(s.providerId);
    const migrador = exemplos.find((e) => e.situacao === "migrador_serial")!;

    const conector = getConnector(FONTE_ERP_DEMO)!;
    const erpResults = await Promise.all(
      PROVEDORES_DA_DEMO.map(async (p) => {
        const providerId = idDe(p.subdomain);
        const config = buildConnectorConfig({
          apiUrl: "demo://mundo-base", apiToken: "x", apiUser: null,
          clientId: null, clientSecret: null, mkContraSenha: null, extraConfig: null,
        });
        config.extra = { ...config.extra, providerId: String(providerId) };
        const r = await conector.fetchCustomerByCpf!(config, migrador.cpf);
        return {
          providerId, providerName: p.nome, erpSource: FONTE_ERP_DEMO, ok: r.ok,
          customers: r.customers.map((c) => ({
            ...c,
            // Mesmo operador de normalizeCustomer (server/services/realtime-query.service.ts:352,357):
            // `||`, não `??` — por igual a produção, não só "equivalente na prática".
            status: c.contractStatus || (c as any).status,
            registrationDate: c.contractStartDate || (c as any).registrationDate,
          })),
        };
      }),
    );

    const resultado = detectMigrator({
      cpfCnpj: migrador.cpf,
      consultingProviderId: s.providerId,
      consultingProviderName: "Provedor Demonstração",
      erpResults: erpResults as any,
      recentConsultationsByDistinctProviders: 1,
    });

    expect(resultado?.detected, JSON.stringify(erpResults)).toBe(true);
  });
});

/**
 * A limpeza do sandbox, cobrindo TODA tabela com FK para `providers` — não
 * as que alguém lembrou de listar. Achado real da rodada de correção
 * (11/09/2026): `apagarSandbox` cobria ~15 das 38 tabelas do schema com FK
 * para `providers`; qualquer linha numa das outras 23 fazia o
 * `DELETE FROM providers` final estourar violação de chave estrangeira —
 * dentro de uma transação, então a limpeza inteira revertia, e a Tarefa 7
 * (que captura por sandbox e segue para o próximo) nunca tentava de novo:
 * zumbi permanente.
 *
 * A lista de tabelas-alvo é DERIVADA DO SCHEMA (`getTableConfig`), nunca
 * digitada à mão: uma enumeração escrita a mão envelhece na primeira tabela
 * que outra feature criar amanhã; esta, não — ganha a FK, o teste passa a
 * semeá-la, e se `apagarSandbox` não souber limpá-la, ACENDE VERMELHO aqui.
 *
 * SEM EXCEÇÃO — 38 tabelas, 41 pares (tabela, coluna), zero exclusões
 * (rodada de correção 2, 11/09/2026). A primeira versão deste teste excluía
 * `acessos_suporte` (a guarda de LGPD de `storage.deleteProvider` recusa
 * apagar um provedor real com trilha de acesso de suporte, e o raciocínio
 * era "então não é resíduo, é desenho"). Isso reabria o MESMO zumbi
 * permanente por outro caminho: o admin do sandbox tem acesso à aba
 * "Suporte" do próprio painel, `POST /api/provider/acesso-suporte/liberar`
 * grava a linha na hora, e "revogar" NUNCA apaga — só marca `revogadoEm`. A
 * guarda ficava presa em ">0" para sempre a partir de UM clique de
 * curiosidade. `apagarSandbox` agora limpa `acessos_suporte` para
 * provedores `sandbox-*` (a guarda em si continua intacta para provedor
 * real — ver o comentário em `sandbox.service.ts`), então este teste não
 * tem mais nenhuma tabela para excluir.
 */
describe("limpeza do sandbox cobre toda tabela com FK para providers (derivado do schema, sem excecao)", () => {
  interface AlvoDeFk {
    tabela: PgTable;
    nomeTabela: string;
    chaveCamelCase: string;
  }

  /** Toda tabela exportada de `@shared/schema` com uma FK (de qualquer coluna) apontando para `providers.id`. */
  function tabelasComFkParaProviders(): AlvoDeFk[] {
    const alvos: AlvoDeFk[] = [];
    for (const valor of Object.values(schema)) {
      if (!valor || typeof valor !== "object" || !is(valor as object, PgTable)) continue;
      const tabela = valor as PgTable;
      const cfg = getTableConfig(tabela);
      const colunasDaTabela = getTableColumns(tabela);
      for (const fk of cfg.foreignKeys ?? []) {
        const ref = fk.reference();
        if (getTableName(ref.foreignTable) !== "providers") continue;
        for (const colunaRef of ref.columns) {
          const entrada = Object.entries(colunasDaTabela).find(([, c]) => c === colunaRef);
          if (!entrada) throw new Error(`Nao encontrei a chave JS da coluna FK em ${cfg.name}`);
          alvos.push({ tabela, nomeTabela: cfg.name, chaveCamelCase: entrada[0] });
        }
      }
    }
    return alvos;
  }

  /**
   * Uma linha mínima e válida para QUALQUER tabela: a coluna-alvo recebe
   * `providerId`; toda outra coluna NOT NULL sem default recebe um valor
   * genérico pelo `dataType` do drizzle (conferido por sonda isolada:
   * "number"/"string"/"boolean"/"json"/"date" cobrem as colunas deste
   * schema). O banco de mentira não confere integridade referencial nem
   * unicidade, então um `1`/`"x"` cru em outra FK (customerId, userId...)
   * não quebra a inserção — só a coluna sob teste importa.
   */
  function linhaGenericaParaTeste(tabela: PgTable, chaveAlvo: string, providerId: number): Record<string, unknown> {
    const colunas = getTableColumns(tabela);
    const linha: Record<string, unknown> = {};
    for (const [chave, colunaUntyped] of Object.entries(colunas)) {
      const coluna = colunaUntyped as { notNull: boolean; hasDefault: boolean; dataType: string };
      if (chave === chaveAlvo) {
        linha[chave] = providerId;
        continue;
      }
      if (!coluna.notNull || coluna.hasDefault) continue; // deixa o default (ou null) cuidar
      switch (coluna.dataType) {
        case "number": linha[chave] = 1; break;
        case "boolean": linha[chave] = false; break;
        case "json": linha[chave] = {}; break;
        case "date": linha[chave] = new Date("2026-01-01T00:00:00.000Z"); break;
        default: linha[chave] = "x"; // string — inclui DATE-como-texto (ver customers.contractStartDate)
      }
    }
    return linha;
  }

  it("apagarSandbox limpa toda tabela com FK para providers — lista derivada do schema, nunca digitada a mao, sem excecao", async () => {
    const alvos = tabelasComFkParaProviders();
    // Contagem EXATA, não só "> 30": 38 tabelas / 41 pares (3 tabelas —
    // anti_fraud_alerts, proactive_alerts, provider_documents — têm duas
    // colunas cada uma apontando para providers). Se o schema mudar de
    // forma e esse número desviar, é melhor um teste vermelho apontando o
    // número exato do que um "> 30" que deixa passar uma tabela a menos.
    expect(alvos.length, "universo de FKs para providers mudou — recontar antes de ajustar este numero").toBe(41);
    expect(new Set(alvos.map((a) => a.nomeTabela)).size).toBe(38);

    const s = await criarSandbox();

    for (const alvo of alvos) {
      const linha = linhaGenericaParaTeste(alvo.tabela, alvo.chaveCamelCase, s.providerId);
      await banco.db.insert(alvo.tabela).values(linha);
    }

    // A semeadura funcionou? (Distingue "meu teste nao semeou" de "apagarSandbox nao limpou".)
    const naoSemeadas: string[] = [];
    for (const alvo of alvos) {
      const linhas = (banco.linhas.get(alvo.nomeTabela) ?? []).filter((l) => l[alvo.chaveCamelCase] === s.providerId);
      if (linhas.length === 0) naoSemeadas.push(`${alvo.nomeTabela}.${alvo.chaveCamelCase}`);
    }
    expect(naoSemeadas, `semeadura do teste falhou em: ${naoSemeadas.join(", ")}`).toEqual([]);

    await apagarSandbox(s.providerId);

    const residuos: string[] = [];
    for (const alvo of alvos) {
      const linhas = (banco.linhas.get(alvo.nomeTabela) ?? []).filter((l) => l[alvo.chaveCamelCase] === s.providerId);
      if (linhas.length > 0) residuos.push(`${alvo.nomeTabela}.${alvo.chaveCamelCase} (${linhas.length} linha[s])`);
    }
    expect(residuos, `apagarSandbox nao limpou: ${residuos.join(", ")}`).toEqual([]);
  });
});

/**
 * Tarefa 7 (`server/demo/limpeza.service.ts`) delega TODA a seleção para
 * `sandboxesExpirados`/`apagarSandbox` — os mesmos dois já provados acima
 * ("expira so o sandbox, nunca o mundo base"). Esta prova roda a passada REAL
 * (nada de `./sandbox.service` mockado neste arquivo) contra o mundo base já
 * semeado: os 5 provedores da rede e a carteira deles têm que sobreviver a um
 * sweep que encontrou outro sandbox para apagar. Sem isto, o teste de
 * `sandboxesExpirados()` sozinho prova a seleção, mas não prova que o sweep
 * INTEIRO (que também chama `apagarSandbox`) deixa a rede intacta.
 *
 * O relógio dos 5 provedores da rede TAMBÉM é expirado aqui, de propósito —
 * não só o do sandbox alvo. Em produção o mundo base é semeado uma vez e fica
 * no ar para sempre: passadas 24h do primeiro seed, `rede-1..5` estão
 * genuinamente "velhos" pelo relógio, exatamente como o teste irmão acima
 * ("expira so o sandbox, nunca o mundo base") NÃO simula. Quem os protege do
 * sweep é só o prefixo do subdomain (`PREFIXO_SANDBOX`), nunca a idade — um
 * teste que deixasse a rede "nova" provaria a sobrevivência dela por
 * acidente de cronômetro, não pela trava de verdade.
 */
describe("a limpeza periodica (Tarefa 7) nunca alcanca o mundo base", () => {
  it("mundo base semeado E com o relogio expirado, sweep de verdade: os 5 provedores da rede e os clientes deles sobrevivem", async () => {
    const alvo = await criarSandbox();

    const idsDaBase = PROVEDORES_DA_DEMO.map((p) => idDe(p.subdomain));
    const clientesDaBaseAntes = new Map<number, number>();
    for (const id of idsDaBase) {
      const total = (await clientesDe(id)).length;
      expect(total, `mundo base ${id} deveria ja ter clientes semeados`).toBeGreaterThan(0);
      clientesDaBaseAntes.set(id, total);
    }

    // Expira o relogio de TODO MUNDO — o sandbox alvo e os 5 da rede — mais
    // velho que VIDA_DO_SANDBOX_MS. So o prefixo do subdomain pode salvar a
    // rede agora; a idade sozinha nao salva mais ninguem.
    await envelhecer(alvo.providerId, 25 * 60 * 60 * 1000);
    for (const id of idsDaBase) await envelhecer(id, 25 * 60 * 60 * 1000);

    // `>= 1`, nao `=== 1`, de proposito: este arquivo e sequencial e cumulativo
    // (ver o comentario no topo) — "velho" (teste "expira so o sandbox...") e
    // "expirado" (teste "contarSandboxesVivos NAO conta...") tambem ficaram
    // no banco, genuinamente envelhecidos 25h por `envelhecer()`, e nenhum dos
    // dois testes os apagou. Este sweep varre os dois JUNTO com o "alvo" desta
    // rodada — 3 candidatos legitimos, nao so 1 — e nada garante que nenhum
    // outro `it()` futuro passe a deixar mais sobras genuinas. O que importa
    // aqui e SO o alvo e a rede, verificados abaixo por id; o numero exato de
    // "apagados" e um detalhe de quantos outros testes tambem envelheceram um
    // sandbox sem limpar, nao desta prova.
    //
    // Ate a rodada de correcao de 12/09/2026 este numero vinha inflado por um
    // MOTIVO DIFERENTE: o banco de mentira nao simulava o `defaultNow()` de
    // `providers.createdAt`, entao TODO sandbox de um `it()` anterior que
    // nunca chamou `envelhecer`/`apagarSandbox` nascia com `createdAt` nulo,
    // tratado como epoch (sempre "expirado") e varrido aqui tambem — 17
    // sobras acidentais, medidas, empilhadas em cima dos 3 candidatos
    // legitimos (apagados=20 num sweep medido antes da correcao). O `>= 1` ja
    // tolerava esse ruido sem intencao; agora tolera so a acumulacao legitima
    // documentada acima. Ver `valorPadraoDaColuna` (topo do arquivo) e o
    // relatorio da rodada.
    const resultado = await limparSandboxesExpirados();
    expect(resultado.apagados, "o sandbox envelhecido deveria ter sido varrido").toBeGreaterThanOrEqual(1);

    // O sandbox alvo sumiu...
    expect(await clientesDe(alvo.providerId)).toHaveLength(0);

    // ...mas os 5 provedores da rede e a carteira de cada um continuam
    // intactos, mesmo tao "velhos pelo relogio" quanto o sandbox apagado.
    for (const id of idsDaBase) {
      expect(await providerDe(id)).toBeTruthy();
      expect(await clientesDe(id)).toHaveLength(clientesDaBaseAntes.get(id)!);
    }
  });
});

/**
 * Segundo sinal de identidade do sandbox (12/09/2026).
 *
 * Até aqui "é um sandbox descartável" era UMA string: `subdomain` começando
 * por `sandbox-`. A reserva do namespace no cadastro (rodada da Tarefa 6,
 * `auth.routes.ts` + `admin.routes.ts`) fecha as quatro portas por onde um
 * subdomínio entra hoje — mas ela é a ÚNICA coisa entre um provedor pagante e
 * a exclusão TOTAL e silenciosa da conta dele. Qualquer porta futura (um
 * script, uma migração, uma rota nova, um UPDATE na mão) que esqueça a
 * reserva reabre o buraco inteiro.
 *
 * E o estrago não tem volta nem aviso: desde que `apagarSandbox` limpa
 * `acessos_suporte` dentro do próprio delta, a guarda de LGPD de
 * `deleteProvider` — que ANTES salvava a conta por acidente, ao contar uma
 * trilha de suporte não-zero e lançar antes de apagar `users`/`customers`/o
 * próprio provedor — enxerga zero e deixa passar. Sem exceção, sem linha de
 * log que distinga "apaguei um sandbox" de "apaguei a NsLink".
 *
 * Então a identidade passa a exigir DUAS provas que só `criarSandbox` produz
 * juntas, na MESMA transação: o prefixo do subdomínio E o administrador
 * determinístico (`<subdomain>@demo.consultaisp.com.br`). Um provedor de
 * verdade teria que ter as duas ao mesmo tempo — e a segunda ninguém digita
 * por acidente.
 */
describe("apagar exige o segundo sinal, nao so o prefixo do subdominio", () => {
  it("provedor com subdominio 'sandbox-' mas SEM o administrador da demo sobrevive ao sweep e a chamada direta", async () => {
    const impostor = await criarSandbox();

    /**
     * Vira um provedor "de verdade": mesmo prefixo no subdomínio,
     * administrador com e-mail de gente. É exatamente o estado que a reserva
     * do cadastro impede HOJE — e que qualquer caminho futuro sem a reserva
     * volta a produzir.
     */
    const admin = (banco.linhas.get("users") ?? []).find((u) => u.providerId === impostor.providerId);
    expect(admin, "o sandbox deveria ter nascido com administrador proprio").toBeTruthy();
    admin!.email = "contato@provedorreal.com.br";

    const clientesAntes = (await clientesDe(impostor.providerId)).length;
    expect(clientesAntes, "o impostor precisa ter carteira para o teste provar algo").toBeGreaterThan(0);

    await envelhecer(impostor.providerId, 25 * 60 * 60 * 1000);

    // 1. A varredura nao o seleciona — velho pelo relogio e com o prefixo,
    //    mas sem o segundo sinal.
    expect(await sandboxesExpirados()).not.toContain(impostor.providerId);

    // 2. A chamada DIRETA recusa: um id errado vindo de qualquer chamador
    //    futuro nao pode virar exclusao de um provedor de verdade.
    await expect(apagarSandbox(impostor.providerId)).rejects.toThrow();

    // 3. E a passada real da limpeza deixa a conta inteira de pe.
    await limparSandboxesExpirados();
    expect(await providerDe(impostor.providerId)).toBeTruthy();
    expect(await clientesDe(impostor.providerId)).toHaveLength(clientesAntes);
  });

  /**
   * Escolha da rodada de correção (12/09/2026): um administrador que sumiu
   * (por qualquer motivo) faz o provider FALHAR o segundo sinal e nunca mais
   * ser apagado por `sandboxesExpirados()`/`limparSandboxesExpirados()` —
   * undeletable para sempre. Silenciar essa exclusão seria transformar a
   * guarda de segurança nova (Part 2) num vazamento lento e invisível: nada
   * distinguiria "este provider nunca foi um sandbox" de "este sandbox
   * perdeu o administrador e ficou preso". Por isso `sandboxesExpirados()`
   * loga um `logger.warn` — com `providerId` E `subdomain`, os dois dados
   * que uma investigação manual precisa — toda vez que um candidato bate
   * prefixo+idade mas falha o segundo sinal.
   *
   * Este teste prova exatamente esse log: sem ele (ou se o campo `providerId`
   * sumir do contexto do log), esta asserção falha.
   */
  it("provider sem o segundo sinal e avisado em log com o id do provider — sem isto o vazamento fica invisivel", async () => {
    const impostor = await criarSandbox();
    const admin = (banco.linhas.get("users") ?? []).find((u) => u.providerId === impostor.providerId);
    admin!.email = "outra-pessoa@provedorreal.com.br";
    await envelhecer(impostor.providerId, 25 * 60 * 60 * 1000);

    const espiao = vi.spyOn(logger, "warn").mockImplementation((() => undefined) as any);
    try {
      await sandboxesExpirados();
      const chamada = espiao.mock.calls.find(([contexto]) => (contexto as any)?.providerId === impostor.providerId);
      expect(chamada, "deveria logar um warn identificando o provider sem segundo sinal, pelo id").toBeTruthy();
      expect((chamada![0] as any).subdomain, "o log deveria trazer o subdomain tambem, para investigacao manual").toBe(impostor.subdomain);
    } finally {
      espiao.mockRestore();
    }
  });
});
