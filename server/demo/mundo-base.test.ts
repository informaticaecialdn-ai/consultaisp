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
import { parcelasDaDescricao } from "@shared/cobranca/multa";
import { decryptField } from "../utils/crypto";
import { PROVEDORES_DA_DEMO, CPFS_COMPARTILHADOS, semearMundoBase, cnpjFicticio } from "./mundo-base";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import { buildConnectorConfig } from "../erp/config";
import { getConnector } from "../erp/registry";
// Efeito colateral: com DEMO_MODE=true (acima), registra o conector no registry.
import "../erp/connectors/demo";

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
      // nenhum teste desta suite le um campo com default nao-nulo que a
      // semeadura deixe de escrever explicitamente (equipmentCount/
      // equipmentEstimatedValue SEMPRE vao explicitos, por causa disso).
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
  const proxy = drizzle(async (sqlTexto: string, params: unknown[]) => {
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
  // O `pg-proxy` de verdade RECUSA transação ("Transactions are not supported").
  // `mundo-base.ts` agora semeia tudo dentro de `db.transaction(...)` (rodada
  // de correção, 11/09/2026) — sem este substituto, todo teste abaixo
  // quebraria na primeira chamada. Mesmo padrão de
  // `server/storage/cobranca.storage.test.ts`: chama o callback com o MESMO
  // proxy, o que basta para provar que as escritas acontecem "dentro".
  banco.db = Object.assign(proxy, {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(proxy),
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

  it("todo cliente tem contractStartDate — sem ela o quadrante DNA e a Economia ficam sem tempo de casa", async () => {
    const clientes = await clientesDe("rede-1");
    for (const c of clientes) expect(c.contractStartDate, JSON.stringify(c)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("as faturas vencidas cobrem as quatro idades, para a regua ter o que mostrar", async () => {
    const idades = await idadesDeVencimento("rede-1");
    for (const dias of [10, 45, 120, 300]) expect(idades, `idades=${idades.join(",")}`).toContain(dias);
  });

  describe("equipamento — rodada de correcao (11/09/2026): comodato no ativo, retido no cancelado", () => {
    it("8% do total, mas nao tudo retido: comodato normal em ativo + retido em cancelado", async () => {
      const equipamentos = await equipamentosDe("rede-1");
      expect(equipamentos).toHaveLength(PROPORCOES.comEquipamento);

      const comodato = equipamentos.filter((e) => e.status === "em_comodato");
      const retido = equipamentos.filter((e) => e.status !== "em_comodato");
      expect(comodato).toHaveLength(90);
      expect(retido).toHaveLength(30);
    });

    it("o comodato normal esta em cliente ATIVO; o retido, em CANCELADO", async () => {
      const equipamentos = await equipamentosDe("rede-1");
      const clientes = new Map((await clientesDe("rede-1")).map((c) => [c.id as number, c]));

      for (const e of equipamentos) {
        const cliente = clientes.get(e.customerId as number)!;
        if (e.status === "em_comodato") {
          expect(cliente.status, JSON.stringify(e)).toBe("active");
        } else {
          expect(cliente.status, JSON.stringify(e)).toBe("cancelled");
        }
      }
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
      const clientes = (await clientesDe("rede-1")).filter((c) => c.status === "cancelled");
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
    expect((await clientesDe("rede-1"))).toHaveLength(PROPORCOES.clientes);
  });
});
