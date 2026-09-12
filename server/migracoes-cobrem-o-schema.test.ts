import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";

/**
 * Toda tabela e coluna que o `drizzle-kit push` criaria precisa nascer de uma
 * MIGRAÇÃO.
 *
 * Por que isto existe — medido em 12/09/2026, ao criar o primeiro banco do
 * zero desta base (o da demonstração): até ali todo ambiente tinha nascido de
 * `drizzle-kit push`, e as migrações vieram por cima de um banco que já tinha
 * tudo. Resultado: quatro tabelas e dez colunas de `shared/schema.ts`, e as
 * onze tabelas de `shared/crm-schema.ts`, só existiam em produção. Duas delas
 * quebravam a própria sequência (a 0008 e a 0015 liam o que ninguém criava);
 * as outras quebrariam em EXECUÇÃO — o Drizzle emite toda coluna declarada em
 * cada `select()`, e um banco novo derrubaria o login, a consulta por
 * endereço, a Consulta Cadastral inteira e os webhooks do CRM. As correções
 * são `migrations/0007b_schema_do_push.sql` e `migrations/0038_crm_do_push.sql`.
 *
 * Nada mais pega essa classe: o `tsc` lê o schema, não o banco; a suíte roda
 * contra banco de mentira; e produção, onde o push já criou tudo, nunca falha.
 * Só um ambiente novo revela — e ambiente novo é raro o bastante para a deriva
 * se acumular por meses entre um e outro.
 *
 * A FRONTEIRA é a lista `schema` do `drizzle.config.ts`, lida do próprio
 * arquivo: é exatamente o que o push cria. Por isso `shared/models/chat.ts`
 * (tabelas `conversations` e `messages`, sobra de template) fica de fora — o
 * push nunca as criou, nenhum código as importa, e elas não existem em
 * produção. Varrer `shared/` inteiro acusaria as duas; uma lista de exceções
 * escrita à mão envelheceria. Arquivo novo de schema entra no config e, com
 * isso, entra aqui.
 *
 * O QUE ESTE TESTE NÃO COBRE, medido no mesmo dia: NOMES de constraint. A
 * `0000_initial_schema.sql` deixa o Postgres batizar as chaves estrangeiras
 * (`users_provider_id_fkey`) e os uniques (`users_email_key`); o push de
 * produção usou os nomes do drizzle (`users_provider_id_providers_id_fk`,
 * `users_email_unique`). São 51 constraints, iguais em tudo menos no nome, e
 * nenhum código depende deles — os dois `erro.constraint ===` do servidor usam
 * constraints que migração criou com nome explícito. Renomear 51 constraints
 * seria mexer na base de toda tabela sem ganho nenhum. O risco que sobra é de
 * quem ESCREVE migração: referenciar constraint antiga pelo nome precisa tratar
 * os dois (`DROP CONSTRAINT IF EXISTS` para cada um).
 *
 * O teste é ESTÁTICO de propósito (lê TypeScript e SQL, não sobe Postgres):
 * roda em qualquer máquina, em menos de um segundo, junto com o resto.
 */

const RAIZ = path.resolve(__dirname, "..");

/**
 * Objetos do schema do drizzle que existem de verdade sem nascer de migração.
 * Cada entrada precisa dizer QUEM cria o objeto — sem isso a lista vira o
 * lugar onde a deriva se esconde.
 */
const CRIADOS_FORA_DAS_MIGRACOES: Record<string, string> = {};

/** Os arquivos da lista `schema` do `drizzle.config.ts`, normalizados. */
function arquivosDoSchemaDoDrizzle(): string[] {
  const config = readFileSync(path.join(RAIZ, "drizzle.config.ts"), "utf-8");
  const lista = config.match(/schema\s*:\s*\[([^\]]*)\]/);
  const unico = config.match(/schema\s*:\s*["']([^"']+)["']/);
  const brutos = lista
    ? Array.from(lista[1].matchAll(/["']([^"']+)["']/g), (m) => m[1])
    : unico
      ? [unico[1]]
      : [];
  return brutos.map((p) => path.normalize(p));
}

/** Posição do delimitador que fecha o bloco aberto logo antes de `inicio`. */
function fimDoBloco(texto: string, inicio: number, abre: string, fecha: string): number {
  let i = inicio;
  let profundidade = 1;
  while (i < texto.length && profundidade > 0) {
    if (texto[i] === abre) profundidade++;
    else if (texto[i] === fecha) profundidade--;
    i++;
  }
  return i - 1;
}

/** tabela -> colunas, de todo `pgTable("nome", { ... })` dos arquivos do schema do drizzle. */
function colunasDeclaradas(): Map<string, Set<string>> {
  const tabelas = new Map<string, Set<string>>();
  for (const arquivo of arquivosDoSchemaDoDrizzle()) {
    const fonte = readFileSync(path.join(RAIZ, arquivo), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "") // JSDoc pode trazer código de exemplo
      .replace(/^\s*\/\/.*$/gm, ""); // coluna comentada não é coluna
    const abertura = /pgTable\(\s*["']([^"']+)["']\s*,\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = abertura.exec(fonte))) {
      const corpo = fonte.slice(abertura.lastIndex, fimDoBloco(fonte, abertura.lastIndex, "{", "}"));
      const colunas = tabelas.get(m[1]) ?? new Set<string>();
      for (const c of corpo.matchAll(/\b\w+\s*:\s*\w+\(\s*["']([a-z0-9_]+)["']/g)) {
        colunas.add(c[1]);
      }
      tabelas.set(m[1], colunas);
    }
  }
  return tabelas;
}

/** `"public"."providers"` -> `providers`; `"id"` -> `id`. */
function identificador(bruto: string): string {
  return (bruto.split(".").pop() ?? bruto).replace(/"/g, "").toLowerCase();
}

/** Divide a lista de um `CREATE TABLE` só nas vírgulas de fora de parêntese — `numeric(10,7)` fica inteiro. */
function itensDoTopo(corpo: string): string[] {
  const itens: string[] = [];
  let atual = "";
  let profundidade = 0;
  for (const c of corpo) {
    if (c === "(") profundidade++;
    if (c === ")") profundidade--;
    if (c === "," && profundidade === 0) {
      itens.push(atual);
      atual = "";
      continue;
    }
    atual += c;
  }
  if (atual.trim()) itens.push(atual);
  return itens;
}

/** Palavras que abrem um item de `CREATE TABLE`/`ADD` sem ser nome de coluna. */
const NAO_E_COLUNA = new Set(["constraint", "primary", "unique", "foreign", "check", "exclude", "like"]);

interface CriadoPelasMigracoes {
  /**
   * Tabelas que um `CREATE TABLE` (ou um `RENAME TO`) de fato cria.
   *
   * Separado das colunas de propósito: um `ALTER TABLE x ADD COLUMN` numa
   * tabela que nenhuma migração criou NÃO cria a tabela — no Postgres ele
   * falha. Contar a tabela como criada por causa do ALTER esconderia
   * exatamente a deriva que este teste existe para pegar; foi o caso da
   * `bigdata_consultations`, que a 0015 alterava sem ninguém tê-la criado.
   */
  tabelas: Set<string>;
  /** tabela -> colunas criadas, por `CREATE TABLE` ou `ADD COLUMN`. */
  colunas: Map<string, Set<string>>;
}

/** O que as migrações criam, na ordem real do runner (`.sort()` em server/migrate.ts). */
function criadoPelasMigracoes(): CriadoPelasMigracoes {
  const tabelas = new Set<string>();
  const colunas = new Map<string, Set<string>>();
  const colunasDe = (tabela: string): Set<string> => {
    if (!colunas.has(tabela)) colunas.set(tabela, new Set());
    return colunas.get(tabela)!;
  };

  const pasta = path.join(RAIZ, "migrations");
  for (const arquivo of readdirSync(pasta).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(pasta, arquivo), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--[^\n]*/g, "");

    const criacao = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = criacao.exec(sql))) {
      const tabela = identificador(m[1]);
      tabelas.add(tabela);
      const corpo = sql.slice(criacao.lastIndex, fimDoBloco(sql, criacao.lastIndex, "(", ")"));
      for (const item of itensDoTopo(corpo)) {
        const primeira = item.trim().match(/^("?\w+"?)/);
        if (!primeira) continue;
        const nome = identificador(primeira[1]);
        if (!NAO_E_COLUNA.has(nome)) colunasDe(tabela).add(nome);
      }
    }

    // Cada ALTER termina no próprio `;` — inclusive dentro de um bloco DO $$.
    const alteracao = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+([\s\S]*?);/gi;
    while ((m = alteracao.exec(sql))) {
      const tabela = identificador(m[1]);
      const resto = m[2];
      const renomeDaTabela = resto.match(/^\s*RENAME\s+TO\s+("?\w+"?)/i);
      if (renomeDaTabela) {
        const destino = identificador(renomeDaTabela[1]);
        if (tabelas.has(tabela)) tabelas.add(destino);
        colunas.get(tabela)?.forEach((c) => colunasDe(destino).add(c));
        continue;
      }
      for (const a of resto.matchAll(/\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)/gi)) {
        const nome = identificador(a[1]);
        if (!NAO_E_COLUNA.has(nome)) colunasDe(tabela).add(nome);
      }
      for (const r of resto.matchAll(/\bRENAME\s+(?:COLUMN\s+)?("?\w+"?)\s+TO\s+("?\w+"?)/gi)) {
        colunasDe(tabela).add(identificador(r[2]));
      }
    }
  }
  return { tabelas, colunas };
}

describe("migrações cobrem o schema do drizzle", () => {
  it("os leitores acham o que precisam achar", () => {
    // Um caminho digitado errado no config tiraria um arquivo de schema
    // inteiro da conferência, em silêncio.
    const arquivos = arquivosDoSchemaDoDrizzle();
    expect(arquivos).toContain(path.normalize("shared/schema.ts"));
    for (const arquivo of arquivos) {
      expect(existsSync(path.join(RAIZ, arquivo)), `${arquivo} está no drizzle.config.ts e não existe`).toBe(true);
    }

    // Sem estas guardas, um leitor quebrado que não lê NADA faria o teste
    // principal passar em silêncio — zero declarado, zero faltando.
    const declaradas = colunasDeclaradas();
    const criado = criadoPelasMigracoes();
    expect(declaradas.size).toBeGreaterThan(20);
    expect(declaradas.get("providers")?.has("isp_credits")).toBe(true);
    expect(criado.tabelas.has("providers")).toBe(true);
    expect(criado.colunas.get("providers")?.has("isp_credits")).toBe(true);
    // Só a 0007b cria estes dois: provam que o leitor de SQL enxerga
    // `CREATE TABLE IF NOT EXISTS` e `ADD COLUMN IF NOT EXISTS`.
    expect(criado.tabelas.has("bigdata_consultations")).toBe(true);
    expect(criado.colunas.get("users")?.has("reset_token")).toBe(true);
  });

  it("toda tabela e coluna do schema do drizzle nasce de alguma migração", () => {
    const declaradas = colunasDeclaradas();
    const criado = criadoPelasMigracoes();

    const faltando: string[] = [];
    for (const [tabela, colunas] of Array.from(declaradas)) {
      if (tabela in CRIADOS_FORA_DAS_MIGRACOES) continue;
      if (!criado.tabelas.has(tabela)) {
        faltando.push(`${tabela} (a tabela inteira)`);
        continue;
      }
      const existentes = criado.colunas.get(tabela) ?? new Set<string>();
      for (const coluna of Array.from(colunas)) {
        if (!existentes.has(coluna)) faltando.push(`${tabela}.${coluna}`);
      }
    }

    expect(
      faltando,
      `No schema do drizzle e criado por NENHUMA migração:\n` +
        `${faltando.map((f) => `  - ${f}`).join("\n")}\n\n` +
        `Num banco novo isso não existe — e o Drizzle emite toda coluna declarada em cada select().\n` +
        `Quase sempre é deriva de \`drizzle-kit push\`: criado direto no banco, migração nunca escrita.\n` +
        `Conserto: escreva a migração, idempotente (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).\n` +
        `Precedentes: migrations/0007b_schema_do_push.sql e migrations/0038_crm_do_push.sql.\n` +
        `Se o objeto nasce de outro jeito (biblioteca que cria a tabela no boot), registre em\n` +
        `CRIADOS_FORA_DAS_MIGRACOES dizendo quem o cria.`,
    ).toEqual([]);
  });
});
