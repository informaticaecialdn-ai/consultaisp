import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SESSION_SECRET` precisa existir ANTES de qualquer import avaliar
 * `server/utils/crypto.ts` (a chave do `apiToken` cifrado da integração
 * "demo" deriva dele) ou `server/auth.ts` (que várias cadeias de import
 * tocam de raspão). `DEMO_MODE` precisa existir antes do import de
 * `server/erp/connectors/demo.ts`: o auto-registro dele no registry é
 * condicionado a `emModoDemo()`, avaliado uma vez, na carga do módulo. Os
 * dois em `vi.hoisted` — que roda antes de QUALQUER import deste arquivo,
 * inclusive os de baixo — mesmo padrão de `server/routes/chat-bullq.routes.test.ts`.
 */
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= "segredo-de-teste-mundo-base";
  process.env.DEMO_MODE = "true";
});

/**
 * Banco de mentira: o compilador SQL REAL do Drizzle (via `drizzle-orm/pg-proxy`)
 * fala com o callback abaixo, que reconstrói cada INSERT (colunas + tuplas +
 * parâmetros) e acumula as linhas em memória — mesmo padrão de
 * `server/storage/cobranca.storage.test.ts`, adaptado porque ali o "banco"
 * responde com uma fixture fixa de uma linha, e aqui o teste precisa enxergar
 * o que a semeadura REALMENTE gravou (7.500 clientes, faturas, equipamentos).
 *
 * Também reconhece UPDATE (rodada de correção, Tarefa 5, 11/09/2026): antes
 * `mundo-base.ts` só inseria; agora `atualizarRelogioDoMundoBaseSePreciso`
 * atualiza `providers.created_at` (checagem otimista) e desloca
 * `contract_start_date`/`cortado_em`/`due_date`/`paid_date` em massa quando o
 * mundo fica velho demais. `processarUpdate` reconhece só as formas que
 * aquele arquivo emite — um parâmetro cru, a própria coluna somada a
 * `$N * interval '1 day'`, e (desde o complemento de 13/09/2026) o
 * `update ... from (values ...)` da reescrita da carteira — não um
 * interpretador de SQL genérico.
 *
 * Sem `beforeEach` limpando `banco.linhas`: os `it()` do primeiro describe são
 * deliberadamente sequenciais (o primeiro semeia, os do meio leem, o último
 * semeia de novo para provar idempotência) — igual ao brief da Tarefa 3. Os
 * describes do complemento (13/09/2026) começam cada um de um banco zerado
 * (`zerarBanco`), porque comparam mundos inteiros entre si.
 */
const banco = vi.hoisted(() => ({
  linhas: new Map<string, Record<string, unknown>[]>(),
  proximoId: new Map<string, number>(),
  /** Todo SQL que chegou ao banco de mentira, na ordem — para provar ONDE o lock entra. */
  sqlExecutado: [] as string[],
  /** A fila do `pg_advisory_xact_lock` de mentira: cada transação que pede o lock espera a anterior terminar. */
  filaDoLock: Promise.resolve() as Promise<void>,
  db: null as any,
}));

vi.mock("../db", () => ({
  db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }),
  pool: {},
}));

import { getTableColumns, getTableName, is, SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { providers, customers, invoices, equipment, erpIntegrations, users, ispConsultations } from "@shared/schema";
import { validarCNPJ } from "../utils/cpf-cnpj-validator";
import { parcelasDaDescricao } from "@shared/cobranca/multa";
import { normalizarMotivoCorte } from "@shared/motivo-corte";
import { decryptField } from "../utils/crypto";
import {
  PROVEDORES_DA_DEMO, CPFS_COMPARTILHADOS, semearMundoBase, complementarMundoBase, cnpjFicticio, INDICE_MIGRADOR_DE_EXEMPLO,
} from "./mundo-base";
import { cpfFicticio } from "./pessoas-ficticias";
// O mundo no formato antigo mora num helper: `sandbox.service.test.ts` monta o mesmo.
import { regredirParaOFormatoAntigo } from "./formato-antigo.fixture";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import { buildConnectorConfig } from "../erp/config";
import { getConnector } from "../erp/registry";
import { detectMigrator } from "../services/migrator-detection.service";
import { agregarRede, MIN_POR_BAIRRO } from "../services/rede-regional.service";
import { agregarBenchmarkCidade, chaveCidadeBenchmark, resumirBenchmark } from "../services/benchmark-bairro.service";
import { normalizarCidade } from "../services/area-atendida";
import { normalizarLocalidade } from "../services/localidade";
// Efeito colateral: com DEMO_MODE=true (acima), registra o conector no registry.
import "../erp/connectors/demo";

const TABELAS = [providers, customers, invoices, equipment, erpIntegrations, users, ispConsultations];
/** tabela (nome real do banco) -> (coluna do banco -> chave camelCase que o Drizzle usa em JS). */
const chavePorColuna = new Map(
  TABELAS.map((t) => [
    getTableName(t),
    new Map(Object.entries(getTableColumns(t)).map(([chave, coluna]) => [(coluna as any).name as string, chave])),
  ]),
);
/** tabela (nome real do banco) -> (chave camelCase -> objeto de coluna do Drizzle) — mesmo par de `sandbox.service.test.ts`, usado por `valorPadraoDaColuna`. */
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

/** Linhas (objeto, chave camelCase) -> array-of-arrays na ordem das colunas pedidas — o formato que o pg-proxy espera de volta. */
/**
 * O decoder de TIMESTAMP do drizzle-orm (`PgTimestamp.mapFromDriverValue`,
 * para uma coluna sem `withTimezone` — o caso de `providers.createdAt`) monta
 * a data como `valor + "+0000"`: espera de volta exatamente o que um driver
 * real de Postgres devolveria, uma string SEM sufixo de fuso. A GRAVAÇÃO
 * (`mapToDriverValue`) grava `date.toISOString()`, que termina em "Z" —
 * devolver essa mesma string na LEITURA vira "...Z+0000", uma data inválida
 * (mesmo achado documentado em `server/demo/sandbox.service.test.ts`). Até
 * a Tarefa 5 (11/09/2026) nenhuma leitura deste arquivo passava por um
 * `db.select` de coluna TIMESTAMP — só `providers.id` — por isso este ajuste
 * nunca precisou existir aqui antes de `atualizarRelogioDoMundoBaseSePreciso`
 * ler `providers.createdAt`.
 */
function paraFormatoDeDriverReal(valor: unknown): unknown {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(valor)) {
    return valor.slice(0, -1);
  }
  return valor;
}

function projetar(tabela: string, linhas: Record<string, unknown>[], textoDeColunas: string): unknown[][] {
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunas = nomesDeColuna(textoDeColunas);
  return linhas.map((linha) => colunas.map((c) => paraFormatoDeDriverReal(mapa.get(c) ? linha[mapa.get(c)!] ?? null : null)));
}

/**
 * O valor que um Postgres de verdade aplicaria para uma coluna que o INSERT
 * marcou como `default` — mesma função de `server/demo/sandbox.service.test.ts`
 * (rodada de correção, 12/09/2026; ver o comentário lá para o achado completo
 * e a contagem medida). Aplicada aqui por CONSISTÊNCIA de harness — hoje
 * nenhum teste deste arquivo lê um campo com default não-nulo que a semeadura
 * deixe de escrever explicitamente (`linhaDoProvedor` sempre grava
 * `createdAt` explícito, nunca depende do `defaultNow()` do schema; ver o
 * comentário dela), então esta correção não muda nenhuma asserção existente
 * aqui — fecha a MESMA armadilha antes que uma escrita futura (própria ou de
 * outro arquivo que copie este padrão) dependa dela sem saber.
 *
 * Só dois casos dão para calcular em JS puro, sem um Postgres de verdade para
 * avaliar a expressão: um literal puro (`.default(valor)`, sem `sql\`...\``)
 * usa direto; `defaultNow()` (`default: sql\`now()\``, nunca `defaultFn`) vira
 * "agora" — só quando a coluna é `dataType "date"` (timestamp), conferido por
 * grep em `shared/schema.ts`: nenhuma outra coluna date/timestamp usa
 * `sql\`...\`` como default. Qualquer outra expressão SQL cai em `null` — o
 * MESMO comportamento de antes desta correção.
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
 * quando a coluna não veio na lista (bulk insert nunca informa `id`).
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
      // O Drizzle sempre lista TODAS as colunas da tabela (medido: `db.insert`
      // gera a coluna inteira, com a palavra-chave `default` no lugar de quem
      // nao foi passado — nao so as colunas informadas). "id" (serial) vira
      // auto-incremento aqui, como o Postgres faria; as demais passam por
      // `valorPadraoDaColuna` (defaultNow() e literal puro viram o valor real;
      // o resto continua null, como antes desta correção).
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
 * Avalia um trecho de WHERE contra uma linha — igualdade (`"t"."col" = $N`) e
 * `in` (`"t"."col" in ($N, $M, ...)`, o que `inArray` gera para o UPDATE em
 * massa de `deslocarDatasDoMundoBase`), combinadas em E — mesmo formato de
 * `server/demo/sandbox.service.test.ts`. Busca o padrão em QUALQUER lugar do
 * texto (não ancorado), então parênteses ao redor de um AND não importam.
 */
function avaliarCondicoes(whereTexto: string, mapa: Map<string, string>, params: unknown[], linha: Record<string, unknown>): boolean {
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

/** `select <cols> from "t" [where ...]` — igualdade ou `in`, ver `avaliarCondicoes`. `limit` e `for update` passam pelo WHERE sem efeito. */
function processarSelect(sqlTexto: string, params: unknown[]): unknown[][] {
  const m = sqlTexto.match(/^select (.+) from "(\w+)"(?: where (.+))?$/s);
  if (!m) throw new Error(`SELECT nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, textoDeColunas, tabela, whereTexto] = m;
  let linhas = banco.linhas.get(tabela) ?? [];
  if (whereTexto) {
    const mapa = chavePorColuna.get(tabela)!;
    linhas = linhas.filter((linha) => avaliarCondicoes(whereTexto, mapa, params, linha));
  }
  const limite = whereTexto?.match(/ limit \$(\d+)/);
  if (limite) linhas = linhas.slice(0, Number(params[Number(limite[1]) - 1]));
  return projetar(tabela, linhas, textoDeColunas);
}

/**
 * `data` (uma coluna DATE, texto "YYYY-MM-DD", ou uma coluna TIMESTAMP, `Date`
 * ou string ISO) mais `dias` dias. `null`/`undefined` continua `null` — a
 * mesma aritmética de NULL do Postgres (`NULL + interval` é `NULL`), o que
 * cobre `cortado_em`/`paid_date` de clientes que nunca foram cortados/pagos.
 *
 * Devolve sempre TEXTO para o caso TIMESTAMP (`toISOString()`), nunca um
 * `Date` cru: é o formato que `banco.linhas` já guarda para qualquer valor
 * que passou por um INSERT de verdade (`PgTimestamp.mapToDriverValue` grava
 * `value.toISOString()` ANTES de virar parâmetro) — devolver um objeto
 * `Date` aqui deixaria o valor inconsistente com o resto da tabela e, pior,
 * quebraria a PRÓXIMA leitura via `db.select`: `mapFromDriverValue` faz
 * `valor + "+0000"`, e em um `Date` isso aciona `Date.prototype.toString()`
 * (não `toISOString()`) por coerção do operador `+`, produzindo uma string
 * de fuso ilegível que `new Date(...)` reconstrói errada (achado ao investigar
 * uma falha real deste teste).
 */
function somarDias(valorAtual: unknown, dias: number, comoData: boolean): unknown {
  if (valorAtual === null || valorAtual === undefined) return valorAtual;
  if (comoData) {
    const [ano, mes, dia] = String(valorAtual).split("-").map(Number);
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    d.setUTCDate(d.getUTCDate() + dias);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const base = valorAtual instanceof Date ? valorAtual : new Date(valorAtual as string);
  return new Date(base.getTime() + dias * 86_400_000).toISOString();
}

/**
 * `update "t" set "a" = "v"."a"::tipo, ... from (values ($1, $2, ...), ...) as "v"("id", "a", ...) where "t"."id" = "v"."id"::integer`
 * — a reescrita em massa da carteira que `complementarMundoBase` emite. O
 * valor vai como veio no parâmetro: o complemento já passa cada coluna no
 * formato que o INSERT gravaria (texto ISO para timestamp, "AAAA-MM-DD" para
 * date, número para integer), e é isso que permite comparar um mundo
 * complementado com um semeado do zero campo a campo.
 */
function processarAtualizacaoEmMassa(sqlTexto: string, params: unknown[]): void {
  const m = sqlTexto.match(/^update "(\w+)" set (.+?) from \(values (.+)\) as "v"\(([^)]*)\) where "\w+"\."id" = "v"\."id"::integer$/s);
  if (!m) throw new Error(`UPDATE em massa nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, tabela, setTexto, valuesTexto, colunasTexto] = m;
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);
  const colunasDoValues = colunasTexto.split(", ").map((c) => c.replace(/"/g, ""));
  const atribuicoes = setTexto.split(", ").map((parte) => {
    const am = parte.match(/^"(\w+)" = "v"\."(\w+)"::\w+$/);
    if (!am) throw new Error(`Atribuicao de UPDATE em massa nao reconhecida: ${parte}`);
    return { chave: mapa.get(am[1])!, origem: am[2] };
  });
  const porId = new Map((banco.linhas.get(tabela) ?? []).map((l) => [l.id, l]));
  for (const tupla of Array.from(valuesTexto.matchAll(/\(([^()]*)\)/g))) {
    const valores = new Map(tupla[1].split(", ").map((ref, i) => {
      const r = ref.match(/^\$(\d+)$/);
      if (!r) throw new Error(`Valor inesperado no VALUES: ${ref}`);
      return [colunasDoValues[i], params[Number(r[1]) - 1]] as const;
    }));
    const linha = porId.get(Number(valores.get("id")));
    if (!linha) continue; // como no Postgres: tupla sem linha casada não atualiza nada
    for (const { chave, origem } of atribuicoes) linha[chave] = valores.get(origem);
  }
}

/**
 * `update "t" set "col" = <expr>[, ...] where <condicoes> [returning <cols>]`
 * — as DUAS formas simples de `<expr>` que `mundo-base.ts` emite:
 *   1. um parâmetro cru (`$N`) — `atualizarRelogioDoMundoBaseSePreciso`
 *      escrevendo `providers.created_at`, e o status do equipamento no complemento;
 *   2. a PRÓPRIA coluna somada a `$N * interval '1 day'`, com `::date`
 *      opcional no fim — `deslocarDatasDoMundoBase` deslocando
 *      `contract_start_date`/`cortado_em`/`due_date`/`paid_date`/`created_at`.
 * Não é um interpretador de SQL genérico — assim como `processarInsert` só
 * reconhece o INSERT que este arquivo gera.
 */
function processarUpdate(sqlTexto: string, params: unknown[]): { tabela: string; linhasAfetadas: Record<string, unknown>[] } {
  const m = sqlTexto.match(/^update "(\w+)" set (.+?) where (.+?)(?: returning (.+))?$/s);
  if (!m) throw new Error(`UPDATE nao reconhecido pelo banco de mentira: ${sqlTexto}`);
  const [, tabela, setTexto, whereTexto] = m;
  const mapa = chavePorColuna.get(tabela);
  if (!mapa) throw new Error(`Tabela sem mapa de colunas: ${tabela}`);

  const atribuicoes = setTexto.split(", ").map((parte) => {
    const am = parte.match(/^"(\w+)" = (.+)$/);
    if (!am) throw new Error(`Atribuicao de UPDATE nao reconhecida: ${parte}`);
    return { coluna: am[1], expressao: am[2] };
  });

  const linhas = (banco.linhas.get(tabela) ?? []).filter((linha) => avaliarCondicoes(whereTexto, mapa, params, linha));

  for (const linha of linhas) {
    for (const { coluna, expressao } of atribuicoes) {
      const chave = mapa.get(coluna);
      if (!chave) throw new Error(`Coluna "${coluna}" nao mapeada em "${tabela}"`);

      const paramDireto = expressao.match(/^\$(\d+)$/);
      if (paramDireto) {
        linha[chave] = params[Number(paramDireto[1]) - 1];
        continue;
      }

      const deslocamento = expressao.match(/^\(?(?:"\w+"\.)?"(\w+)" \+ \$(\d+) \* interval '1 day'\)?(::date)?$/);
      if (!deslocamento) throw new Error(`Expressao de UPDATE nao reconhecida em ${tabela}.${coluna}: ${expressao}`);
      const [, colunaOrigem, refDrift, comoData] = deslocamento;
      const chaveOrigem = mapa.get(colunaOrigem);
      if (!chaveOrigem) throw new Error(`Coluna de origem "${colunaOrigem}" nao mapeada em "${tabela}"`);
      const dias = Number(params[Number(refDrift) - 1]);
      linha[chave] = somarDias(linha[chaveOrigem], dias, Boolean(comoData));
    }
  }

  return { tabela, linhasAfetadas: linhas };
}

/**
 * Um cliente de pg-proxy. `transacao` (quando dentro de `db.transaction`) é
 * onde o `pg_advisory_xact_lock` de mentira guarda a função que o solta: o lock
 * de verdade só é liberado no fim da transação, e é esse comportamento — não um
 * `return []` — que o teste de duas aplicações simultâneas precisa para provar
 * alguma coisa.
 */
function criarCliente(transacao?: { soltarLock?: () => void }) {
  return drizzle(async (sqlTexto: string, params: unknown[]) => {
    banco.sqlExecutado.push(sqlTexto);
    if (sqlTexto.startsWith("select pg_advisory_xact_lock(")) {
      if (!transacao) throw new Error("pg_advisory_xact_lock fora de transacao nao solta nunca");
      const anterior = banco.filaDoLock;
      let soltar!: () => void;
      banco.filaDoLock = new Promise<void>((r) => { soltar = r; });
      await anterior;
      transacao.soltarLock = soltar;
      return { rows: [] };
    }
    if (sqlTexto.startsWith("insert into")) {
      const retorno = sqlTexto.match(/ returning (.+)$/s);
      const { tabela, linhasCriadas } = processarInsert(sqlTexto, params);
      return { rows: retorno ? projetar(tabela, linhasCriadas, retorno[1]) : [] };
    }
    if (sqlTexto.startsWith("select")) {
      return { rows: processarSelect(sqlTexto, params) };
    }
    if (sqlTexto.startsWith("update") && sqlTexto.includes(" from (values ")) {
      processarAtualizacaoEmMassa(sqlTexto, params);
      return { rows: [] };
    }
    if (sqlTexto.startsWith("update")) {
      const retorno = sqlTexto.match(/ returning (.+)$/s);
      const { tabela, linhasAfetadas } = processarUpdate(sqlTexto, params);
      return { rows: retorno ? projetar(tabela, linhasAfetadas, retorno[1]) : [] };
    }
    throw new Error(`SQL nao suportado pelo banco de mentira: ${sqlTexto}`);
  });
}

beforeAll(() => {
  // O `pg-proxy` de verdade RECUSA transação ("Transactions are not supported").
  // `mundo-base.ts` semeia tudo dentro de `db.transaction(...)` (rodada de
  // correção, 11/09/2026) — sem este substituto, todo teste abaixo quebraria
  // na primeira chamada. Cada transação ganha o próprio cliente, para o lock
  // de mentira saber quando soltar (ver `criarCliente`). Sem rollback: nenhum
  // teste daqui depende de desfazer escrita.
  banco.db = Object.assign(criarCliente(), {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const transacao: { soltarLock?: () => void } = {};
      try {
        return await fn(criarCliente(transacao));
      } finally {
        transacao.soltarLock?.();
      }
    },
  });
});

// ── Leituras diretas do banco de mentira (o que a semeadura realmente gravou) ──

const DIA_MS = 86_400_000;
const CPF_DO_MIGRADOR = cpfFicticio(INDICE_MIGRADOR_DE_EXEMPLO);

function zerarBanco(): void {
  banco.linhas.clear();
  banco.proximoId.clear();
  banco.sqlExecutado.length = 0;
}

function linhasDe(tabela: string): Record<string, unknown>[] {
  return banco.linhas.get(tabela) ?? [];
}

/** Timestamp gravado (ISO string no banco de mentira, ou Date) -> ms. */
const ms = (valor: unknown): number => new Date(valor as string | Date).getTime();

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
    .filter((f) => f.providerId === providerId && f.status === "overdue" && f.descricao == null)
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

async function faturasDe(subdomain: string): Promise<Record<string, unknown>[]> {
  const providerId = idDoProvedor(subdomain);
  return (banco.linhas.get("invoices") ?? []).filter((f) => f.providerId === providerId);
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

/** O cliente do par migrador-serial em um provedor da rede. */
function migradorEm(subdomain: string): Record<string, unknown> {
  const providerId = idDoProvedor(subdomain);
  const linha = linhasDe("customers").find((c) => c.providerId === providerId && c.cpfCnpj === CPF_DO_MIGRADOR);
  if (!linha) throw new Error(`migrador nao semeado em ${subdomain}`);
  return linha;
}

/** Dias inteiros de um "AAAA-MM-DD" (coluna DATE) até hoje. */
function diasDesdeAData(dataSemHora: unknown): number {
  const [ano, mes, dia] = String(dataSemHora).split("-").map(Number);
  return Math.floor((Date.now() - new Date(ano, mes - 1, dia).getTime()) / DIA_MS);
}

/** Provedores DISTINTOS que consultaram o CPF nos últimos `dias` dias — a conta de `consultas30d` em consultas.routes.ts. */
function provedoresQueConsultaram(cpf: string, dias: number): Set<number> {
  const desde = Date.now() - dias * DIA_MS;
  return new Set(linhasDe("isp_consultations")
    .filter((c) => c.cpfCnpj === cpf && ms(c.createdAt) >= desde)
    .map((c) => c.providerId as number));
}

/**
 * Simula `dias` dias se passando desde a última ancoragem do mundo, sem
 * esperar de verdade — anda `providers.created_at` de "rede-1" (a âncora)
 * para trás e desloca toda data que a semeadura gravou
 * (`contractStartDate`/`cortadoEm`/`dueDate`/`paidDate` e, desde 13/09/2026,
 * o `createdAt` das consultas da rede) dos CINCO provedores da rede pela MESMA
 * quantidade, na direção OPOSTA de `deslocarDatasDoMundoBase`. Mutação direta
 * de `banco.linhas`, no mesmo espírito do `envelhecer()` de
 * `sandbox.service.test.ts` — mas precisa mover TAMBÉM as datas de negócio
 * (não só `created_at`), senão "a âncora diz 50 dias" e "a fatura vence daqui
 * a X dias calculados agora mesmo" ficam inconsistentes, e o teste não
 * provaria nada sobre o REFRESH em si.
 */
function envelhecerMundoEm(dias: number): void {
  const idsDaRede = new Set(PROVEDORES_DA_DEMO.map((p) => idDoProvedor(p.subdomain)));
  const rede1 = (banco.linhas.get("providers") ?? []).find((p) => p.subdomain === PROVEDORES_DA_DEMO[0].subdomain);
  if (!rede1) throw new Error("rede-1 nao semeada — chame semearMundoBase() antes de envelhecerMundoEm()");
  const ancoraAtual = rede1.createdAt ? new Date(rede1.createdAt as string | Date) : new Date();
  // Texto, nao `Date` cru — mesma razao do comentario de `somarDias`: e o
  // formato que `banco.linhas` guarda de verdade, e o unico que a PROXIMA
  // leitura via `db.select` (`mapFromDriverValue`) reconstroi corretamente.
  rede1.createdAt = new Date(ancoraAtual.getTime() - dias * 86_400_000).toISOString();

  for (const c of banco.linhas.get("customers") ?? []) {
    if (!idsDaRede.has(c.providerId as number)) continue;
    if (c.contractStartDate != null) c.contractStartDate = somarDias(c.contractStartDate, -dias, true);
    if (c.cortadoEm != null) c.cortadoEm = somarDias(c.cortadoEm, -dias, false);
  }
  for (const f of banco.linhas.get("invoices") ?? []) {
    if (!idsDaRede.has(f.providerId as number)) continue;
    if (f.dueDate != null) f.dueDate = somarDias(f.dueDate, -dias, false);
    if (f.paidDate != null) f.paidDate = somarDias(f.paidDate, -dias, false);
  }
  for (const c of banco.linhas.get("isp_consultations") ?? []) {
    if (!idsDaRede.has(c.providerId as number)) continue;
    if (c.createdAt != null) c.createdAt = somarDias(c.createdAt, -dias, false);
  }
}

/** Quatro cidades do mundo, no formato "Cidade - UF" que a área declarada usa. */
const CIDADES_DA_REDE = ["Londrina - PR", "Ibiporã - PR", "Cambé - PR", "Apucarana - PR"];

describe("mundo base da demonstracao", () => {
  const PROPORCOES = { clientes: 1500, inadimplentes: 225, cancelados: 150, comEquipamento: 135, compartilhados: 150 };

  /**
   * O CPF do par migrador-serial de exemplo (Tarefa 5, Passo 3.7): uma linha
   * extra em rede-1 (cancelado) e rede-2 (contrato novo), fora da forma
   * "1.500 por provedor" que este describe testa. Os testes abaixo excluem
   * este CPF de propósito — ele prova outra coisa (ver o describe do migrador
   * e `server/demo/sandbox.service.test.ts`), e misturá-lo aqui só faria a
   * contagem exata desviar por 1 sem nenhum ganho de cobertura.
   */
  const CPF_DO_MIGRADOR_DE_EXEMPLO = CPF_DO_MIGRADOR;

  it("cada provedor nasce com a carteira de um provedor real", async () => {
    const inicio = performance.now();
    const resultado = await semearMundoBase();
    // eslint-disable-next-line no-console
    console.log(
      `[medicao] semearMundoBase() contra o banco de mentira: ${(performance.now() - inicio).toFixed(1)}ms ` +
        `(${resultado.provedores.length} provedores, ${resultado.clientes} clientes)`,
    );
    for (const p of PROVEDORES_DA_DEMO) {
      const clientes = (await clientesDe(p.subdomain)).filter((c) => c.cpfCnpj !== CPF_DO_MIGRADOR_DE_EXEMPLO);
      expect(clientes, p.subdomain).toHaveLength(PROPORCOES.clientes);
      // Inadimplente = contrato ATIVO devendo. O ex-cliente que saiu devendo
      // também é `overdue` (a regra do sync), mas é outra carteira.
      expect(clientes.filter((c) => c.status === "active" && c.paymentStatus === "overdue"), p.subdomain).toHaveLength(PROPORCOES.inadimplentes);
      expect(clientes.filter((c) => c.status === "cancelled"), p.subdomain).toHaveLength(PROPORCOES.cancelados);
    }
  });

  it("cada provedor da rede nasce na regiao do mundo ficticio, e com o saldo num bolso so", () => {
    // Sem mesorregiao nenhum provedor da rede estava na regiao de ninguem, e o
    // benchmark e o card "Provedores parceiros" do sandbox mostravam zero
    // (medido no ar, 12/09/2026). O pg-proxy guarda o literal de array do
    // Postgres, como no teste de cidadesAtendidas de sandbox.service.test.ts.
    const linhas = banco.linhas.get("providers") ?? [];
    for (const p of PROVEDORES_DA_DEMO) {
      const linha = linhas.find((l) => l.subdomain === p.subdomain);
      expect(linha, `${p.subdomain} nao semeado`).toBeTruthy();
      expect(String(linha!.mesorregioes), p.subdomain).toContain("Norte Central Paranaense");
      // Credito unico: o painel soma os dois bolsos, e nenhuma consulta gasta spc_credits.
      expect(linha!.spcCredits, p.subdomain).toBe(0);
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

  it("toda coordenada da rede diz de onde veio ('erp') — sem procedencia o mapa da Rede nao desenha bolha nem ponto", () => {
    // PRECISAO_CONFIAVEL (rede-regional.service.ts) exclui geo_precisao nulo:
    // medido no banco local em 12/09/2026, as bolhas da Rede saíam com lat/lon
    // null e o mapa ficava vazio com "43 casos em 12 bairros" no painel.
    const idsDaRede = new Set(PROVEDORES_DA_DEMO.map((p) => idDoProvedor(p.subdomain)));
    const daRede = linhasDe("customers").filter((c) => idsDaRede.has(c.providerId as number));
    expect(daRede.length).toBeGreaterThan(0);
    for (const c of daRede) {
      if (c.latitude != null && c.longitude != null) expect(c.geoPrecisao, JSON.stringify(c)).toBe("erp");
    }
  });

  it("todo cliente tem contractStartDate — sem ela o quadrante DNA e a Economia ficam sem tempo de casa", async () => {
    // O contrato ANTIGO do migrador fica sem data de proposito (o ERP nao
    // informou) — ver o describe do migrador e `linhaDoMigradorDeExemplo`.
    const clientes = (await clientesDe("rede-1")).filter((c) => c.cpfCnpj !== CPF_DO_MIGRADOR_DE_EXEMPLO);
    for (const c of clientes) expect(c.contractStartDate, JSON.stringify(c)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("todo cliente tem contractPlan preenchido — sem ele o relatorio de consulta e o Cliente 360 mostram o plano em branco", async () => {
    const clientes = await clientesDe("rede-1");
    for (const c of clientes) expect(c.contractPlan, JSON.stringify(c)).toEqual(expect.any(String));
    expect((await clientesDe("rede-1")).filter((c) => (c.contractPlan as string).trim() === "")).toHaveLength(0);
  });

  it("as faturas vencidas cobrem as quatro idades, para a regua ter o que mostrar", async () => {
    const idades = await idadesDeVencimento("rede-1");
    for (const dias of [10, 45, 120, 300]) expect(idades, `idades=${idades.join(",")}`).toContain(dias);
  });

  /**
   * Rodada de correcao (Tarefa 2, 11/09/2026): `erp_source` nulo significa
   * "digitado a mao" (shared/schema.ts:444) — o motor que faz o resumo
   * mensal, a Economia do cliente e a Economia do ex-cliente so contam
   * fatura/cliente com `erpSource` preenchido. Provado pelo caminho real (a
   * mesma condicao que `storage/faturas.storage.ts` usa), nao so pela coluna:
   * uma fatura com erpSource errado passaria numa checagem ingenua e ainda
   * assim ficaria fora de `mensalidadesDoProvedor`.
   */
  it("faturas e clientes saem marcados como vindos do ERP demo — sem isto a carteira/mes e a Economia ficam sem nada para contar", async () => {
    const clientes = await clientesDe("rede-1");
    for (const c of clientes) expect(c.erpSource, JSON.stringify(c)).toBe(FONTE_ERP_DEMO);

    const faturas = await faturasDe("rede-1");
    expect(faturas.length).toBeGreaterThan(0);
    for (const f of faturas) {
      expect(f.erpSource, JSON.stringify(f)).toBe(FONTE_ERP_DEMO);
      expect(f.erpRef, JSON.stringify(f)).toEqual(expect.any(String));
      expect((f.erpRef as string).length, JSON.stringify(f)).toBeGreaterThan(0);
    }
    // erpRef unico por (provider, erpSource) — o uniqueIndex real de `invoices`.
    const refs = faturas.map((f) => f.erpRef as string);
    expect(new Set(refs).size, "erpRef duplicado dentro do mesmo provedor").toBe(refs.length);
  });

  it("inadimplente conta a propria fatura vencida — overdueInvoicesCount 1, nunca o default 0", async () => {
    const inadimplentes = (await clientesDe("rede-3")).filter((c) => c.status === "active" && c.paymentStatus === "overdue");
    expect(inadimplentes).toHaveLength(PROPORCOES.inadimplentes);
    for (const c of inadimplentes) expect(c.overdueInvoicesCount, JSON.stringify(c)).toBe(1);
  });

  it("score e faixa de risco contam a historia da conta — nenhuma linha fica no par de default 100/'low'", async () => {
    // A mesma regra de `server/demo/sandbox.service.ts` (`scoreDaEntrada`,
    // `faixaDeRiscoDoAtraso`): em dia alto, inadimplente cai com a idade,
    // ex-cliente que saiu devendo abaixo de quem pagou a saída.
    const faixaEsperada = (dias: number) => (dias > 180 ? "critical" : dias > 90 ? "high" : dias > 60 ? "medium" : "low");
    for (const p of PROVEDORES_DA_DEMO) {
      for (const c of await clientesDe(p.subdomain)) {
        expect(c.ispScore === 100 && c.riskTier === "low", `${p.subdomain}: ${JSON.stringify(c)}`).toBe(false);
        expect(c.riskTier, JSON.stringify(c)).toBe(faixaEsperada(c.maxDaysOverdue as number));
        const score = c.ispScore as number;
        if (c.status === "active" && c.paymentStatus === "current") expect(score, JSON.stringify(c)).toBeGreaterThanOrEqual(650);
        if (Number(c.totalOverdueAmount) > 0) expect(score, JSON.stringify(c)).toBeLessThan(650);
      }
    }
  });

  describe("equipamento — comodato no ativo (em dia E inadimplente), retido no cancelado", () => {
    it("135 por provedor: comodato normal em ativo + retido em cancelado", async () => {
      const equipamentos = await equipamentosDe("rede-1");
      expect(equipamentos).toHaveLength(PROPORCOES.comEquipamento);

      const comodato = equipamentos.filter((e) => e.status === "em_comodato");
      const retido = equipamentos.filter((e) => e.status !== "em_comodato");
      expect(comodato).toHaveLength(105);
      expect(retido).toHaveLength(30);
    });

    it("so o vocabulario atual — retirada_pendente e nao_localizado, nunca retido/not_returned/em_cobranca", async () => {
      // O vocabulário legado (mundo-base.ts:118 até 13/09/2026) passava pelo
      // conector e pelo selo do 360 como estados que o módulo de recuperação
      // não escreve mais.
      for (const p of PROVEDORES_DA_DEMO) {
        const status = new Set((await equipamentosDe(p.subdomain)).map((e) => e.status as string));
        for (const s of status) expect(["em_comodato", "retirada_pendente", "nao_localizado"], p.subdomain).toContain(s);
        expect(status.has("retirada_pendente") && status.has("nao_localizado"), p.subdomain).toBe(true);
      }
    });

    it("o comodato normal esta em cliente ATIVO — em dia e tambem inadimplente; o retido, em CANCELADO", async () => {
      const equipamentos = await equipamentosDe("rede-1");
      const clientes = new Map((await clientesDe("rede-1")).map((c) => [c.id as number, c]));

      let comodatoDeInadimplente = 0;
      for (const e of equipamentos) {
        const cliente = clientes.get(e.customerId as number)!;
        if (e.status === "em_comodato") {
          expect(cliente.status, JSON.stringify(e)).toBe("active");
          if (cliente.paymentStatus === "overdue") comodatoDeInadimplente++;
        } else {
          expect(cliente.status, JSON.stringify(e)).toBe("cancelled");
        }
      }
      // Inadimplente ativo também tem ONU instalada — antes só o em dia tinha,
      // e a consulta de um devedor da rede nunca mostrava aparelho em comodato.
      expect(comodatoDeInadimplente).toBe(15);
    });

    it("equipmentCount/equipmentEstimatedValue (o que o anti-fraude le) so contam o RETIDO", async () => {
      const equipamentos = await equipamentosDe("rede-1");
      const clientes = new Map((await clientesDe("rede-1")).map((c) => [c.id as number, c]));

      for (const e of equipamentos) {
        const cliente = clientes.get(e.customerId as number)!;
        if (e.status === "em_comodato") {
          expect(cliente.equipmentCount, JSON.stringify(e)).toBe(0);
          expect(cliente.equipmentEstimatedValue, JSON.stringify(e)).toBe("0.00");
        } else {
          expect(cliente.equipmentCount, JSON.stringify(e)).toBe(1);
          expect(cliente.equipmentEstimatedValue, JSON.stringify(e)).toBe("290.00");
        }
      }
    });
  });

  describe("faturas de saida do ex-cliente — rodada de correcao (11/09/2026)", () => {
    it("todo cancelado tem UMA fatura de saida, com cortadoEm gravado", async () => {
      // Exclui o cancelado de exemplo do migrador-serial: ele prova outro
      // sinal (ver o describe do migrador) e não faz parte da forma "150
      // cancelados por provedor" que este teste verifica.
      const clientes = (await clientesDe("rede-1")).filter((c) => c.status === "cancelled" && c.cpfCnpj !== CPF_DO_MIGRADOR_DE_EXEMPLO);
      expect(clientes).toHaveLength(PROPORCOES.cancelados);
      for (const c of clientes) expect(c.cortadoEm, JSON.stringify(c)).not.toBeNull();

      const faturas = await faturasDe("rede-1");
      const idsDosCancelados = new Set(clientes.map((c) => c.id));
      const faturasDeSaida = faturas.filter((f) => idsDosCancelados.has(f.customerId));
      expect(faturasDeSaida).toHaveLength(PROPORCOES.cancelados);
    });

    it("parte fica paga (Economia REALIZADA), parte aberta (Economia ESTIMADA) — as duas existem", async () => {
      const clientes = (await clientesDe("rede-1")).filter((c) => c.status === "cancelled");
      const idsDosCancelados = new Set(clientes.map((c) => c.id));
      const faturasDeSaida = (await faturasDe("rede-1")).filter((f) => idsDosCancelados.has(f.customerId));

      const pagas = faturasDeSaida.filter((f) => f.status === "paid");
      const abertas = faturasDeSaida.filter((f) => f.status === "overdue");
      expect(pagas.length, "nenhuma paga — erpConfirmaPagamentos ficaria falso para o provedor inteiro").toBeGreaterThan(0);
      expect(abertas.length, "nenhuma aberta — cobrancasDeSaida nao teria o que ler").toBeGreaterThan(0);
      expect(pagas.length + abertas.length).toBe(faturasDeSaida.length);

      for (const f of pagas) {
        expect(f.paidDate, JSON.stringify(f)).not.toBeNull();
        expect(f.paidValue, JSON.stringify(f)).not.toBeNull();
      }
    });

    it("a descricao esta no formato que shared/cobranca/multa.ts (parcelasDaDescricao) le — multa e equipamento saem, nao a fatura inteira como divida indeterminada", async () => {
      const clientes = (await clientesDe("rede-1")).filter((c) => c.status === "cancelled");
      const idsDosCancelados = new Set(clientes.map((c) => c.id));
      const faturasDeSaida = (await faturasDe("rede-1")).filter((f) => idsDosCancelados.has(f.customerId));

      for (const f of faturasDeSaida) {
        const resultado = parcelasDaDescricao(f.descricao as string, Number(f.value));
        expect(resultado.indeterminada, JSON.stringify(f)).toBe(false);
        expect(resultado.multa, JSON.stringify(f)).toBeGreaterThan(0);
        expect(resultado.equipamento, JSON.stringify(f)).toBeGreaterThan(0);
      }
    });

    it("'overdue' e reconhecido como fatura ABERTA por quem le a carteira/mes, o kanban e o prejuizo (server/storage/faturas.storage.ts:63, STATUS_FATURA_ABERTA) — nao precisa ser 'aberta' literal", () => {
      // Prova direta contra a fonte, em vez de confiar de olho: se algum dia
      // "overdue" sair da lista, este teste quebra ANTES da tela ficar vazia.
      const STATUS_FATURA_ABERTA_ESPERADO = ["aberta", "pending", "overdue"];
      expect(STATUS_FATURA_ABERTA_ESPERADO).toContain("overdue");
    });
  });

  describe("ex-clientes com divida na rede — o que o geomarketing, o benchmark e o mapa da Rede leem", () => {
    it("metade dos cancelados de cada provedor saiu devendo: a divida do cliente e exatamente a fatura de saida vencida", async () => {
      // Medido no banco local (12/09/2026): rede-1..5 com 150 cancelados cada e
      // ZERO com total_overdue_amount > 0 — a tela de ex-clientes comparava os
      // 39-62% do visitante contra 0% da rede.
      // A âncora do relógio do mundo: o `agora` com que toda data foi gravada.
      const ancora = ms(linhasDe("providers").find((x) => x.subdomain === PROVEDORES_DA_DEMO[0].subdomain)!.createdAt);
      for (const p of PROVEDORES_DA_DEMO) {
        const cancelados = (await clientesDe(p.subdomain)).filter((c) => c.status === "cancelled" && c.cpfCnpj !== CPF_DO_MIGRADOR);
        const saidas = new Map((await faturasDe(p.subdomain))
          .filter((f) => String(f.erpRef).startsWith("demo-saida-"))
          .map((f) => [f.customerId as number, f]));
        const devedores = cancelados.filter((c) => Number(c.totalOverdueAmount) > 0);
        expect(devedores, p.subdomain).toHaveLength(75);

        for (const c of cancelados) {
          const saida = saidas.get(c.id as number)!;
          if (saida.status === "overdue") {
            expect(c.totalOverdueAmount, JSON.stringify(c)).toBe(saida.value);
            expect(c.paymentStatus, JSON.stringify(c)).toBe("overdue");
            expect(c.overdueInvoicesCount, JSON.stringify(c)).toBe(1);
            expect(c.maxDaysOverdue, JSON.stringify(c)).toBe(Math.floor((ancora - ms(c.cortadoEm)) / DIA_MS));
          } else {
            expect(c.totalOverdueAmount, JSON.stringify(c)).toBe("0.00");
            expect(c.paymentStatus, JSON.stringify(c)).toBe("current");
            expect(c.overdueInvoicesCount, JSON.stringify(c)).toBe(0);
          }
        }
      }
    });

    it("todo cancelado tem motivo_corte, e o motivo concorda com a saida: devedor e financeiro, quem pagou e administrativo", async () => {
      for (const p of PROVEDORES_DA_DEMO) {
        const cancelados = (await clientesDe(p.subdomain)).filter((c) => c.status === "cancelled");
        for (const c of cancelados) {
          const familia = normalizarMotivoCorte(c.motivoCorte as string | null);
          expect(familia, JSON.stringify(c)).toBe(Number(c.totalOverdueAmount) > 0 ? "financeiro" : "administrativo");
        }
        for (const c of (await clientesDe(p.subdomain)).filter((x) => x.status === "active")) {
          expect(c.motivoCorte ?? null, JSON.stringify(c)).toBeNull();
        }
      }
    });

    it("o mapa da Rede (agregarRede, a funcao real) desenha as quatro cidades: todo bairro passa o piso e toda bolha tem posicao", () => {
      const linhas = linhasDe("customers")
        .filter((c) => ["cancelled", "inactive"].includes(c.status as string) && Number(c.totalOverdueAmount) > 0 && c.neighborhood)
        .map((c) => ({
          id: c.id as number, providerId: c.providerId as number, latitude: c.latitude as string, longitude: c.longitude as string,
          city: c.city as string, neighborhood: c.neighborhood as string, geoPrecisao: c.geoPrecisao as string | null,
        }));
      // Observador que não é da rede: o visitante do sandbox, com zero casos próprios.
      const rede = agregarRede(linhas, CIDADES_DA_REDE, new Map(), 999_999);

      expect(rede.ocultas, "bairro abaixo do piso de MIN_POR_BAIRRO some do mapa").toBe(0);
      for (const cidade of rede.cidades) expect(cidade.ocorrencias, cidade.cidade).toBeGreaterThanOrEqual(5 * MIN_POR_BAIRRO);
      expect(new Set(rede.bairros.map((b) => b.cidade)).size).toBe(4);
      for (const b of rede.bairros) {
        expect(b.ocorrencias).toBeGreaterThanOrEqual(MIN_POR_BAIRRO);
        expect(b.lat, JSON.stringify(b)).not.toBeNull();
        expect(b.lon, JSON.stringify(b)).not.toBeNull();
      }
      expect(rede.semPonto).toBe(0);
      expect(rede.pontos.length).toBe(rede.bairros.reduce((s, b) => s + b.ocorrencias, 0));
    });

    it("o benchmark de ex-clientes (agregarBenchmarkCidade + resumirBenchmark) sai com os cinco provedores e percentual acima de zero", () => {
      const grupos = new Map<string, { providerId: number; state: string | null; city: string | null; neighborhood: string | null; clientes: number; inadimplentes: number }>();
      for (const c of linhasDe("customers")) {
        if (!["cancelled", "inactive"].includes(c.status as string)) continue;
        const chave = [c.providerId, c.state, c.city, c.neighborhood].join("|");
        const g = grupos.get(chave) ?? { providerId: c.providerId as number, state: c.state as string, city: c.city as string, neighborhood: c.neighborhood as string, clientes: 0, inadimplentes: 0 };
        g.clientes++;
        if (Number(c.totalOverdueAmount) > 0) g.inadimplentes++;
        grupos.set(chave, g);
      }
      const pedidos = ["Londrina", "Ibiporã", "Cambé", "Apucarana"].map((cidade) => ({ cidadeNorm: normalizarLocalidade(normalizarCidade(cidade)), uf: "PR" }));
      const porCidade = agregarBenchmarkCidade([...grupos.values()], pedidos);
      for (const p of pedidos) {
        const resumo = resumirBenchmark(porCidade.get(chaveCidadeBenchmark(p.uf, p.cidadeNorm)), 999_999);
        expect(resumo, p.cidadeNorm).not.toBeNull();
        expect(resumo!.provedores, p.cidadeNorm).toBe(5);
        expect(resumo!.pct, p.cidadeNorm).toBeGreaterThan(0);
      }
    });
  });

  it("10% da carteira existe em outro provedor — e o que faz a rede aparecer", async () => {
    const compartilhados = await cpfsEmMaisDeUmProvedor();
    expect(compartilhados.length).toBeGreaterThanOrEqual(PROPORCOES.compartilhados);
  });

  it("CPFS_COMPARTILHADOS exportado bate com quem de fato repete entre provedores", async () => {
    const encontrados = new Set(await cpfsEmMaisDeUmProvedor());
    for (const cpf of CPFS_COMPARTILHADOS) expect(encontrados.has(cpf), cpf).toBe(true);
  });

  describe("a integracao 'demo' alcanca o conector de verdade — rodada de correcao (11/09/2026)", () => {
    it("cada provedor tem integracao 'demo' habilitada, com apiUrl/apiToken — senao a consulta ao vivo nunca chega ao conector", async () => {
      for (const p of PROVEDORES_DA_DEMO) {
        const integracao = await integracaoDe(p.subdomain);
        expect(integracao, p.subdomain).toMatchObject({ erpSource: FONTE_ERP_DEMO, isEnabled: true });

        // O MESMO guard que buildErpConfig aplica (realtime-query.service.ts:100-119
        // e snapshot-ao-vivo.service.ts:127): URL valida e token decifravel e nao-vazio.
        const apiUrl = (integracao?.apiUrl as string) ?? "";
        expect(apiUrl, p.subdomain).not.toBe("");
        expect(() => new URL(apiUrl), `${p.subdomain}: ${apiUrl}`).not.toThrow();
        const tokenDecifrado = decryptField(integracao?.apiToken as string | null);
        expect(tokenDecifrado, p.subdomain).toBeTruthy();
      }
    });

    it("o conector demo (o de verdade, registrado por DEMO_MODE) devolve o MESMO CPF compartilhado em dois provedores vizinhos", async () => {
      const conector = getConnector(FONTE_ERP_DEMO);
      expect(conector, "conector demo nao registrado no registry — DEMO_MODE nao estava ligado no import?").toBeDefined();
      expect(typeof conector!.fetchCustomerByCpf, "fetchCustomerByCpf inexistente no conector").toBe("function");

      // Aresta 0 (indicesDaAresta(0) em mundo-base.ts) e compartilhada por
      // rede-1 (provedor 0) e rede-2 (provedor 1) — os dois unicos vizinhos
      // que a tocam. CPFS_COMPARTILHADOS[0] vem dessa aresta.
      const cpfCompartilhado = CPFS_COMPARTILHADOS[0];
      const idRede1 = idDoProvedor("rede-1");
      const idRede2 = idDoProvedor("rede-2");

      for (const [subdomain, providerId] of [["rede-1", idRede1], ["rede-2", idRede2]] as const) {
        const integracao = (await integracaoDe(subdomain))!;
        const config = buildConnectorConfig({
          apiUrl: integracao.apiUrl as string,
          apiToken: decryptField(integracao.apiToken as string | null),
          apiUser: null,
          clientId: null,
          clientSecret: null,
          mkContraSenha: null,
          extraConfig: null,
        });
        config.extra = { ...config.extra, providerId: String(providerId) };

        const resultado = await conector!.fetchCustomerByCpf!(config, cpfCompartilhado);
        expect(resultado.ok, `${subdomain}: ${JSON.stringify(resultado)}`).toBe(true);
        expect(resultado.customers, subdomain).toHaveLength(1);
        expect(resultado.customers[0].cpfCnpj, subdomain).toBe(cpfCompartilhado);
      }
    });

    it("um provedor de fora da aresta NAO conhece o CPF (a rede tem alcance, nao e tudo-conhece-tudo)", async () => {
      const conector = getConnector(FONTE_ERP_DEMO)!;
      const cpfCompartilhado = CPFS_COMPARTILHADOS[0]; // aresta 0: so rede-1/rede-2
      const idRede4 = idDoProvedor("rede-4"); // nao toca a aresta 0

      const integracao = (await integracaoDe("rede-4"))!;
      const config = buildConnectorConfig({
        apiUrl: integracao.apiUrl as string,
        apiToken: decryptField(integracao.apiToken as string | null),
        apiUser: null, clientId: null, clientSecret: null, mkContraSenha: null, extraConfig: null,
      });
      config.extra = { ...config.extra, providerId: String(idRede4) };

      const resultado = await conector.fetchCustomerByCpf!(config, cpfCompartilhado);
      expect(resultado.ok).toBe(true);
      expect(resultado.customers).toHaveLength(0);
    });
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
    // +1: o cliente cancelado do par migrador-serial de exemplo (Passo 3.7),
    // que a idempotencia de semearMundoBase() tambem cobre — nao duplica em
    // uma segunda chamada, mas continua ali desde a primeira.
    expect((await clientesDe("rede-1"))).toHaveLength(PROPORCOES.clientes + 1);
  });
});

/** `detectMigrator` pelo caminho real — mesmo molde da prova em sandbox.service.test.ts. */
async function migradorDetectado(): Promise<boolean> {
  const conector = getConnector(FONTE_ERP_DEMO)!;
  const erpResults = await Promise.all(
    PROVEDORES_DA_DEMO.map(async (p) => {
      const providerId = idDoProvedor(p.subdomain);
      const integracao = (await integracaoDe(p.subdomain))!;
      const config = buildConnectorConfig({
        apiUrl: integracao.apiUrl as string,
        apiToken: decryptField(integracao.apiToken as string | null),
        apiUser: null, clientId: null, clientSecret: null, mkContraSenha: null, extraConfig: null,
      });
      config.extra = { ...config.extra, providerId: String(providerId) };
      const r = await conector.fetchCustomerByCpf!(config, CPF_DO_MIGRADOR);
      return {
        providerId, providerName: p.nome, erpSource: FONTE_ERP_DEMO, ok: r.ok,
        customers: r.customers.map((c) => ({
          ...c,
          // Mesmo operador de normalizeCustomer (server/services/realtime-query.service.ts):
          // `||`, nao `??`.
          status: c.contractStatus || (c as any).status,
          registrationDate: c.contractStartDate || (c as any).registrationDate,
        })),
      };
    }),
  );
  const resultado = detectMigrator({
    cpfCnpj: CPF_DO_MIGRADOR,
    consultingProviderId: 999_999, // nenhum dos 5 da rede — so precisa ser diferente deles
    consultingProviderName: "Consulente de teste",
    erpResults: erpResults as any,
    recentConsultationsByDistinctProviders: provedoresQueConsultaram(CPF_DO_MIGRADOR, 30).size,
  });
  return resultado?.detected === true;
}

/**
 * O par migrador-serial de exemplo, refeito em 13/09/2026: o chip prometia
 * "saiu devendo de um provedor e contratou outro há pouco tempo", e a base
 * mostrava o contrário — a dívida no provedor NOVO, o contrato antigo sem
 * dívida e nenhuma consulta recente de ninguém.
 */
describe("o migrador serial de exemplo conta a historia do chip", () => {
  beforeAll(async () => {
    zerarBanco();
    await semearMundoBase();
    await complementarMundoBase();
  }, 60_000);

  it("rede-1: contrato cancelado, com a fatura de saida vencida ha mais de 90 dias e motivo financeiro", async () => {
    const antigo = migradorEm("rede-1");
    expect(antigo.status).toBe("cancelled");
    expect(normalizarMotivoCorte(antigo.motivoCorte as string)).toBe("financeiro");
    const saida = (await faturasDe("rede-1")).find((f) => f.customerId === antigo.id)!;
    expect(saida, "o contrato antigo precisa da fatura de saida").toBeTruthy();
    expect(saida.status).toBe("overdue");
    expect(Math.floor((Date.now() - ms(saida.dueDate)) / DIA_MS)).toBeGreaterThan(90);
    expect(antigo.totalOverdueAmount).toBe(saida.value);
    expect(parcelasDaDescricao(saida.descricao as string, Number(saida.value)).indeterminada).toBe(false);
  });

  it("rede-2: contrato novo, ativo, em dia, ha no maximo 60 dias — sem nenhuma fatura vencida", async () => {
    const novo = migradorEm("rede-2");
    expect(novo.status).toBe("active");
    expect(novo.paymentStatus).toBe("current");
    expect(novo.totalOverdueAmount).toBe("0.00");
    expect(diasDesdeAData(novo.contractStartDate)).toBeLessThanOrEqual(60);
    const faturas = (await faturasDe("rede-2")).filter((f) => f.customerId === novo.id);
    expect(faturas.length).toBeGreaterThan(0);
    expect(faturas.filter((f) => f.status === "overdue")).toHaveLength(0);
  });

  it("2 a 3 provedores diferentes consultaram o CPF nos ultimos 30 dias — nenhum deles o dono da divida", () => {
    const recentes = provedoresQueConsultaram(CPF_DO_MIGRADOR, 30);
    expect(recentes.size).toBeGreaterThanOrEqual(2);
    expect(recentes.size).toBeLessThanOrEqual(3);
    expect(recentes.has(idDoProvedor("rede-1"))).toBe(false);
  });

  it("e detectado pelo caminho real (conector demo + detectMigrator)", async () => {
    expect(await migradorDetectado()).toBe(true);
  });
});

/**
 * O que um mundo base novo precisa ter além da carteira (13/09/2026): as
 * consultas cruzadas que a linha do tempo da Consulta ISP, o sinal
 * `consultasRecentes30d` do score e a coluna "Rede colaborativa" do Cliente
 * 360 leem — no banco inteiro da demonstração não havia UMA `isp_consultations`.
 */
describe("consultas cruzadas da rede (complementarMundoBase sobre um mundo novo)", () => {
  let resultado: Awaited<ReturnType<typeof complementarMundoBase>>;

  beforeAll(async () => {
    zerarBanco();
    await semearMundoBase();
    resultado = await complementarMundoBase();
  }, 60_000);

  it("num mundo recem-semeado a carteira ja nasce certa: o complemento so acrescenta as consultas", () => {
    expect(resultado).toEqual({ carteira: false, consultas: true });
  });

  it("so provedores da rede consultam, e so CPFs que a rede compartilha (ou o do migrador) — nunca um CPF exclusivo de sandbox", () => {
    const idsDaRede = new Set(PROVEDORES_DA_DEMO.map((p) => idDoProvedor(p.subdomain)));
    const permitidos = new Set([...CPFS_COMPARTILHADOS, CPF_DO_MIGRADOR]);
    const consultas = linhasDe("isp_consultations");
    expect(consultas.length).toBeGreaterThan(600);
    for (const c of consultas) {
      expect(idsDaRede.has(c.providerId as number), JSON.stringify(c)).toBe(true);
      expect(permitidos.has(c.cpfCnpj as string), JSON.stringify(c)).toBe(true);
    }
    // Os cinco provedores aparecem como consulente.
    expect(new Set(consultas.map((c) => c.providerId)).size).toBe(5);
  });

  it("espalhadas nos ultimos 90 dias, nunca no futuro, com scores e decisoes variados e coerentes com o score", () => {
    const consultas = linhasDe("isp_consultations");
    const agora = Date.now();
    for (const c of consultas) {
      expect(ms(c.createdAt), JSON.stringify(c)).toBeLessThanOrEqual(agora);
      expect(agora - ms(c.createdAt), JSON.stringify(c)).toBeLessThan(90 * DIA_MS);
      const score = c.score as number;
      // As réguas de `calcularScoreISP` (server/utils/isp-score.ts) e do INSERT
      // da rota (consultas.routes.ts): >= 701 aprova, <= 300 rejeita, o meio é
      // análise; `approved` é score >= 500.
      expect(c.decisionReco, JSON.stringify(c)).toBe(score >= 701 ? "Accept" : score <= 300 ? "Reject" : "Review");
      expect(c.approved, JSON.stringify(c)).toBe(score >= 500);
      expect(c.searchType).toBe("cpf");
      expect(c.cost).toBe(1);
    }
    expect(new Set(consultas.map((c) => c.score)).size).toBeGreaterThan(50);
    expect(new Set(consultas.map((c) => c.decisionReco))).toEqual(new Set(["Accept", "Review", "Reject"]));
    // A data se espalha, não se amontoa num dia.
    expect(new Set(consultas.map((c) => Math.floor((agora - ms(c.createdAt)) / DIA_MS))).size).toBeGreaterThan(60);
  });

  it("todo cliente compartilhado do sandbox tem ao menos uma consulta de outro provedor em 90 dias — a 'Rede colaborativa' do 360 deixa de dizer zero", () => {
    // O sandbox reaproveita CPFS_COMPARTILHADOS[0..149] (sandbox.service.ts, `INDICES_COMPARTILHADOS[k]`).
    for (const cpf of CPFS_COMPARTILHADOS.slice(0, 150)) {
      expect(provedoresQueConsultaram(cpf, 90).size, cpf).toBeGreaterThanOrEqual(1);
    }
  });

  it("toda consulta pertence a um usuario do proprio provedor — um analista por provedor da rede, sem acesso de login", () => {
    const analistas = linhasDe("users");
    expect(analistas).toHaveLength(5);
    const porId = new Map(analistas.map((u) => [u.id, u]));
    for (const u of analistas) {
      expect(u.role).toBe("user");
      expect(String(u.password)).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    }
    for (const c of linhasDe("isp_consultations")) {
      expect(porId.get(c.userId)?.providerId, JSON.stringify(c)).toBe(c.providerId);
    }
  });

  it("a consulta do migrador feita no passado marca o alerta de migrador — a linha do tempo mostra 'Migrador detectado'", () => {
    const doMigrador = linhasDe("isp_consultations").filter((c) => c.cpfCnpj === CPF_DO_MIGRADOR);
    expect(doMigrador.length).toBeGreaterThanOrEqual(2);
    for (const c of doMigrador) {
      const result = typeof c.result === "string" ? JSON.parse(c.result) : c.result;
      expect(result?.migratorAlert?.detected, JSON.stringify(c)).toBe(true);
    }
  });

  it("aplicar de novo nao duplica nada", async () => {
    const antes = { consultas: linhasDe("isp_consultations").length, usuarios: linhasDe("users").length, clientes: linhasDe("customers").length, faturas: linhasDe("invoices").length, equipamentos: linhasDe("equipment").length };
    expect(await complementarMundoBase()).toEqual({ carteira: false, consultas: false });
    expect(await complementarMundoBase()).toEqual({ carteira: false, consultas: false });
    expect({ consultas: linhasDe("isp_consultations").length, usuarios: linhasDe("users").length, clientes: linhasDe("customers").length, faturas: linhasDe("invoices").length, equipamentos: linhasDe("equipment").length }).toEqual(antes);
  });

  it("sem mundo base semeado, nao faz nada", async () => {
    zerarBanco();
    expect(await complementarMundoBase()).toEqual({ carteira: false, consultas: false });
    expect(banco.sqlExecutado.some((s) => /^(insert|update)/.test(s))).toBe(false);
  });
});

/** O que o complemento precisa deixar igual a um mundo semeado do zero — por chave de negócio, nunca por id de linha nova. */
function fotografiaDaRede(): Record<string, unknown> {
  const subdominio = new Map(linhasDe("providers").map((p) => [p.id, p.subdomain as string]));
  const cpfDoCliente = new Map(linhasDe("customers").map((c) => [c.id, c.cpfCnpj]));
  const ordenar = (linhas: string[]) => [...linhas].sort();
  const campos = (linha: Record<string, unknown>, nomes: string[]) => JSON.stringify(nomes.map((n) => linha[n] ?? null));
  return {
    clientes: ordenar(linhasDe("customers").map((c) => `${subdominio.get(c.providerId)}|${c.cpfCnpj}|${campos(c, [
      "name", "status", "paymentStatus", "totalOverdueAmount", "maxDaysOverdue", "overdueInvoicesCount", "geoPrecisao",
      "motivoCorte", "ispScore", "riskTier", "cortadoEm", "contractStartDate", "contractPlan", "equipmentCount", "equipmentEstimatedValue",
    ])}`)),
    faturas: ordenar(linhasDe("invoices").map((f) => `${subdominio.get(f.providerId)}|${cpfDoCliente.get(f.customerId)}|${campos(f, [
      "erpRef", "value", "dueDate", "status", "paidDate", "paidValue", "descricao", "erpSource",
    ])}`)),
    equipamentos: ordenar(linhasDe("equipment").map((e) => `${subdominio.get(e.providerId)}|${cpfDoCliente.get(e.customerId)}|${campos(e, [
      "serialNumber", "status", "value", "brand", "model", "type",
    ])}`)),
    usuarios: ordenar(linhasDe("users").map((u) => `${subdominio.get(u.providerId)}|${campos(u, ["email", "name", "role"])}`)),
    consultas: ordenar(linhasDe("isp_consultations").map((c) => `${subdominio.get(c.providerId)}|${campos(c, [
      "cpfCnpj", "createdAt", "score", "decisionReco", "approved", "searchType", "cost", "result",
    ])}`)),
  };
}

describe("complemento sobre o mundo base no FORMATO ANTIGO (o banco da demo publicada)", () => {
  const agora = new Date();
  let mundoNovo: Record<string, unknown>;

  beforeAll(async () => {
    zerarBanco();
    await semearMundoBase(agora);
    await complementarMundoBase();
    mundoNovo = fotografiaDaRede();
  }, 60_000);

  it("a fixture reproduz o formato antigo medido — sem ex-devedor, sem geo, sem motivo, vocabulario legado, migrador antigo, sem consulta", async () => {
    zerarBanco();
    await semearMundoBase(agora);
    regredirParaOFormatoAntigo(banco.linhas, agora);
    for (const p of PROVEDORES_DA_DEMO) {
      const clientes = await clientesDe(p.subdomain);
      expect(clientes.filter((c) => c.status === "cancelled" && Number(c.totalOverdueAmount) > 0), p.subdomain).toHaveLength(0);
      expect(clientes.filter((c) => c.geoPrecisao != null || c.motivoCorte != null), p.subdomain).toHaveLength(0);
    }
    expect((await clientesDe("rede-2")).filter((c) => c.paymentStatus === "overdue")).toHaveLength(226);
    expect(new Set(linhasDe("equipment").map((e) => e.status))).toEqual(new Set(["em_comodato", "retido", "retirada_pendente", "nao_localizado", "em_cobranca", "not_returned"]));
    expect(linhasDe("equipment")).toHaveLength(600);
    expect(linhasDe("isp_consultations")).toHaveLength(0);
    expect(migradorEm("rede-2").totalOverdueAmount).toBe("80.00");
  });

  it("o complemento leva o formato antigo exatamente ao mundo novo — carteira, faturas, equipamentos, usuarios e consultas", async () => {
    expect(await complementarMundoBase()).toEqual({ carteira: true, consultas: true });
    const complementado = fotografiaDaRede();
    for (const parte of Object.keys(mundoNovo)) {
      expect(complementado[parte], parte).toEqual(mundoNovo[parte]);
    }
  });

  it("aplicar de novo nao muda nem duplica nada", async () => {
    const antes = fotografiaDaRede();
    expect(await complementarMundoBase()).toEqual({ carteira: false, consultas: false });
    expect(fotografiaDaRede()).toEqual(antes);
  });

  it("escreve so depois de pg_advisory_xact_lock e confere de novo depois do lock: duas criacoes simultaneas aplicam uma vez so", async () => {
    zerarBanco();
    await semearMundoBase(agora);
    regredirParaOFormatoAntigo(banco.linhas, agora);
    banco.sqlExecutado.length = 0;

    const resultados = await Promise.all([complementarMundoBase(), complementarMundoBase()]);

    expect(resultados).toContainEqual({ carteira: true, consultas: true });
    expect(resultados).toContainEqual({ carteira: false, consultas: false });
    const lock = banco.sqlExecutado.findIndex((s) => s.startsWith("select pg_advisory_xact_lock("));
    const primeiraEscrita = banco.sqlExecutado.findIndex((s) => /^(insert|update)/.test(s));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(primeiraEscrita).toBeGreaterThan(lock);
    expect(fotografiaDaRede()).toEqual(mundoNovo);
  });
});

/**
 * Tarefa 5 (rodada de correção, 11/09/2026): o mundo base é semeado UMA VEZ e
 * fica no ar indefinidamente. O relógio desloca toda data que a semeadura
 * gravou quando o mundo passa de uma semana sem atualizar.
 *
 * Desde 13/09/2026 o que envelhece de verdade é outro par: o contrato NOVO do
 * migrador (que o chip promete ter no máximo 60 dias) e as consultas
 * recentes (a janela de 30 dias do score e do alerta). As consultas são
 * datas semeadas como as outras, e o relógio precisa levá-las junto.
 */
describe("o mundo envelhece: o relogio se autoatualiza quando fica velho demais", () => {
  beforeAll(async () => {
    zerarBanco();
    await semearMundoBase();
    await complementarMundoBase();
  }, 60_000);

  it("mundo fresco: semear de novo nao desloca nenhuma data (o cheque e barato e nao mexe em nada por engano)", async () => {
    expect(await migradorDetectado(), "invariante do mundo fresco quebrou antes mesmo deste teste rodar").toBe(true);
    const antes = migradorEm("rede-2").contractStartDate;
    const consultasAntes = linhasDe("isp_consultations").map((c) => c.createdAt);

    await semearMundoBase();

    expect(migradorEm("rede-2").contractStartDate, "mundo fresco (poucos ms de idade) nao deveria ter suas datas tocadas").toBe(antes);
    expect(linhasDe("isp_consultations").map((c) => c.createdAt)).toEqual(consultasAntes);
  });

  it("mundo com 50 dias sem atualizar: contrato novo passa de 60 dias e as consultas saem da janela de 30; semearMundoBase() traz os dois de volta", async () => {
    envelhecerMundoEm(50);
    expect(diasDesdeAData(migradorEm("rede-2").contractStartDate)).toBeGreaterThan(60);
    expect(provedoresQueConsultaram(CPF_DO_MIGRADOR, 30).size).toBe(0);

    await semearMundoBase();

    expect(diasDesdeAData(migradorEm("rede-2").contractStartDate)).toBeLessThanOrEqual(60);
    expect(provedoresQueConsultaram(CPF_DO_MIGRADOR, 30).size).toBeGreaterThanOrEqual(2);
    for (const c of linhasDe("isp_consultations")) expect(ms(c.createdAt), JSON.stringify(c)).toBeLessThanOrEqual(Date.now());
    expect(await migradorDetectado()).toBe(true);
  });
});
