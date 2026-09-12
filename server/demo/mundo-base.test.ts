import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Banco de mentira: o compilador SQL REAL do Drizzle (via `drizzle-orm/pg-proxy`)
 * fala com o callback abaixo, que reconstrói cada INSERT (colunas + tuplas +
 * parâmetros) e acumula as linhas em memória — mesmo padrão de
 * `server/storage/cobranca.storage.test.ts`, adaptado porque ali o "banco"
 * responde com uma fixture fixa de uma linha, e aqui o teste precisa enxergar
 * o que a semeadura REALMENTE gravou (7.500 clientes, faturas, equipamentos).
 *
 * Sem `beforeEach` limpando `banco.linhas`: os `it()` abaixo são
 * deliberadamente sequenciais (o primeiro semeia, os do meio leem, o último
 * semeia de novo para provar idempotência) — igual ao brief da Tarefa 3.
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

import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { providers, customers, invoices, equipment, erpIntegrations } from "@shared/schema";
import { validarCNPJ } from "../utils/cpf-cnpj-validator";
import { PROVEDORES_DA_DEMO, CPFS_COMPARTILHADOS, semearMundoBase, cnpjFicticio } from "./mundo-base";

const TABELAS = [providers, customers, invoices, equipment, erpIntegrations];
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

/** Linhas (objeto, chave camelCase) -> array-of-arrays na ordem das colunas pedidas — o formato que o pg-proxy espera de volta. */
function projetar(tabela: string, linhas: Record<string, unknown>[], textoDeColunas: string): unknown[][] {
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunas = nomesDeColuna(textoDeColunas);
  return linhas.map((linha) => colunas.map((c) => (mapa.get(c) ? linha[mapa.get(c)!] ?? null : null)));
}

/**
 * Reconstrói um INSERT de verdade — `insert into "t" ("a","b") values ($1,$2),($3,$4) [returning ...]`
 * — e acumula cada tupla como linha (camelCase), atribuindo `id` auto-incremental
 * quando a coluna não veio na lista (bulk insert nunca informa `id`).
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
      // O Drizzle sempre lista TODAS as colunas da tabela (medido: `db.insert`
      // gera a coluna inteira, com a palavra-chave `default` no lugar de quem
      // nao foi passado — nao so as colunas informadas). "id" (serial) vira
      // auto-incremento aqui, como o Postgres faria; as demais viram null —
      // nenhum teste desta suite le um campo que a semeadura deixa no default.
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

/** `select <cols> from "t" [where "t"."col" = $1 [and ...]]` — só igualdade, é tudo que `mundo-base.ts` emite. */
function processarSelect(sqlTexto: string, params: unknown[]): unknown[][] {
  const m = sqlTexto.match(/^select (.+) from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`SELECT nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, textoDeColunas, tabela, whereTexto] = m;
  let linhas = banco.linhas.get(tabela) ?? [];
  if (whereTexto) {
    const mapa = chavePorColuna.get(tabela)!;
    const condicoes = Array.from(whereTexto.matchAll(/"(?:\w+)"\."(\w+)" = \$(\d+)/g));
    linhas = linhas.filter((linha) => condicoes.every((c) => linha[mapa.get(c[1])!] === params[Number(c[2]) - 1]));
  }
  return projetar(tabela, linhas, textoDeColunas);
}

beforeAll(() => {
  banco.db = drizzle(async (sqlTexto: string, params: unknown[]) => {
    if (sqlTexto.startsWith("insert into")) {
      const retorno = sqlTexto.match(/ returning (.+)$/s);
      const { tabela, linhasCriadas } = processarInsert(sqlTexto, params);
      return { rows: retorno ? projetar(tabela, linhasCriadas, retorno[1]) : [] };
    }
    if (sqlTexto.startsWith("select")) {
      return { rows: processarSelect(sqlTexto, params) };
    }
    throw new Error(`SQL nao suportado pelo banco de mentira: ${sqlTexto}`);
  });
});

// ── Leituras diretas do banco de mentira (o que a semeadura realmente gravou) ──

function idDoProvedor(subdomain: string): number {
  const linha = (banco.linhas.get("providers") ?? []).find((p) => p.subdomain === subdomain);
  if (!linha) throw new Error(`Provedor nao semeado: ${subdomain}`);
  return linha.id as number;
}

async function clientesDe(subdomain: string): Promise<Record<string, unknown>[]> {
  const providerId = idDoProvedor(subdomain);
  return (banco.linhas.get("customers") ?? []).filter((c) => c.providerId === providerId);
}

async function idadesDeVencimento(subdomain: string): Promise<number[]> {
  const providerId = idDoProvedor(subdomain);
  const agora = Date.now();
  return (banco.linhas.get("invoices") ?? [])
    .filter((f) => f.providerId === providerId)
    .map((f) => {
      // dueDate e coluna timestamp: o Drizzle converte o Date para ISO string
      // ANTES de virar parametro do driver (`PgTimestamp.mapToDriverValue`),
      // entao o que chega aqui e string — mas aceita Date tambem, por seguranca.
      const bruto = f.dueDate as Date | string;
      const dueMs = bruto instanceof Date ? bruto.getTime() : new Date(bruto).getTime();
      return Math.floor((agora - dueMs) / 86_400_000);
    });
}

async function equipamentosDe(subdomain: string): Promise<Record<string, unknown>[]> {
  const providerId = idDoProvedor(subdomain);
  return (banco.linhas.get("equipment") ?? []).filter((e) => e.providerId === providerId);
}

async function cpfsEmMaisDeUmProvedor(): Promise<string[]> {
  const porCpf = new Map<string, Set<number>>();
  for (const c of banco.linhas.get("customers") ?? []) {
    const cpf = c.cpfCnpj as string;
    const set = porCpf.get(cpf) ?? new Set<number>();
    set.add(c.providerId as number);
    porCpf.set(cpf, set);
  }
  return [...porCpf.entries()].filter(([, provedoresDoCpf]) => provedoresDoCpf.size > 1).map(([cpf]) => cpf);
}

async function integracaoDe(subdomain: string): Promise<Record<string, unknown> | undefined> {
  const providerId = idDoProvedor(subdomain);
  return (banco.linhas.get("erp_integrations") ?? []).find((i) => i.providerId === providerId);
}

async function totalDeProvedores(): Promise<number> {
  return (banco.linhas.get("providers") ?? []).length;
}

describe("mundo base da demonstracao", () => {
  const PROPORCOES = { clientes: 1500, inadimplentes: 225, cancelados: 150, comEquipamento: 120, compartilhados: 150 };

  it("cada provedor nasce com a carteira de um provedor real", async () => {
    const inicio = performance.now();
    const resultado = await semearMundoBase();
    // eslint-disable-next-line no-console
    console.log(
      `[medicao] semearMundoBase() contra o banco de mentira: ${(performance.now() - inicio).toFixed(1)}ms ` +
        `(${resultado.provedores.length} provedores, ${resultado.clientes} clientes)`,
    );
    for (const p of PROVEDORES_DA_DEMO) {
      const clientes = await clientesDe(p.subdomain);
      expect(clientes, p.subdomain).toHaveLength(PROPORCOES.clientes);
      expect(clientes.filter((c) => c.paymentStatus === "overdue"), p.subdomain).toHaveLength(PROPORCOES.inadimplentes);
      expect(clientes.filter((c) => c.status === "cancelled"), p.subdomain).toHaveLength(PROPORCOES.cancelados);
    }
  });

  it("nenhum cliente fica sem coordenada — o mapa de calor le latitude/longitude direto da coluna", async () => {
    for (const p of PROVEDORES_DA_DEMO) {
      const clientes = await clientesDe(p.subdomain);
      for (const c of clientes) {
        expect(c.latitude, JSON.stringify(c)).not.toBeNull();
        expect(c.longitude, JSON.stringify(c)).not.toBeNull();
      }
    }
  });

  it("as faturas vencidas cobrem as quatro idades, para a regua ter o que mostrar", async () => {
    const idades = await idadesDeVencimento("rede-1");
    for (const dias of [10, 45, 120, 300]) expect(idades, `idades=${idades.join(",")}`).toContain(dias);
  });

  it("8% tem equipamento em comodato", async () => {
    expect(await equipamentosDe("rede-1")).toHaveLength(PROPORCOES.comEquipamento);
  });

  it("10% da carteira existe em outro provedor — e o que faz a rede aparecer", async () => {
    const compartilhados = await cpfsEmMaisDeUmProvedor();
    expect(compartilhados.length).toBeGreaterThanOrEqual(PROPORCOES.compartilhados);
  });

  it("CPFS_COMPARTILHADOS exportado bate com quem de fato repete entre provedores", async () => {
    const encontrados = new Set(await cpfsEmMaisDeUmProvedor());
    for (const cpf of CPFS_COMPARTILHADOS) expect(encontrados.has(cpf), cpf).toBe(true);
  });

  it("cada provedor tem integracao 'demo' habilitada, senao a consulta nunca o chama", async () => {
    for (const p of PROVEDORES_DA_DEMO) {
      expect(await integracaoDe(p.subdomain), p.subdomain).toMatchObject({ erpSource: "demo", isEnabled: true });
    }
  });

  it("CNPJ ficticio de cada provedor tem digito verificador valido", () => {
    for (let i = 0; i < PROVEDORES_DA_DEMO.length; i++) {
      expect(validarCNPJ(cnpjFicticio(i)), `i=${i} cnpj=${cnpjFicticio(i)}`).toBe(true);
    }
  });

  it("semear duas vezes nao duplica nada", async () => {
    await semearMundoBase();
    await semearMundoBase();
    expect(await totalDeProvedores()).toBe(PROVEDORES_DA_DEMO.length);
    expect((await clientesDe("rede-1"))).toHaveLength(PROPORCOES.clientes);
  });
});
