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

import { getTableColumns, getTableName, is } from "drizzle-orm";
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
  apagarSandbox,
  SALDO_INICIAL,
} from "./sandbox.service";
import { PROVEDORES_DA_DEMO, INDICE_MIGRADOR_DE_EXEMPLO } from "./mundo-base";
import { cpfFicticio } from "./pessoas-ficticias";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import { buildConnectorConfig } from "../erp/config";
import { getConnector } from "../erp/registry";
import { detectMigrator } from "../services/migrator-detection.service";
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
        linha[chave] = coluna === "id" ? proximoId(tabela) : null;
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

  it("expira so o sandbox, nunca o mundo base", async () => {
    const velho = await criarSandbox();
    await envelhecer(velho.providerId, 25 * 60 * 60 * 1000);
    const ids = await sandboxesExpirados();
    expect(ids).toContain(velho.providerId);
    for (const p of PROVEDORES_DA_DEMO) expect(ids).not.toContain(idDe(p.subdomain));
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
