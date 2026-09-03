import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O desenho da pausa, do lado do storage.
 *
 * A marca de corte automatico mora na coluna `status`, que `registrarResultadoSync`
 * reescrevia em TODA varredura. O efeito era invisivel em teste de rota e mortal
 * em producao: `pausarPorFalhas` gravava `pausado_por_falhas` e a propria
 * varredura que acabara de falhar passava por cima com 'error'. A integracao
 * ficava desligada sem dizer QUEM a desligou, e a tela do superadmin nao tinha
 * como oferecer "religar".
 *
 * Estes testes exercitam o SQL de verdade: o chunk gerado pelo Drizzle e
 * compilado pelo dialeto Postgres e depois APLICADO a uma linha simulada. Um
 * teste que so procurasse a palavra "CASE" no texto passaria verde com um CASE
 * invertido.
 */
const dbFalso = vi.hoisted(() => {
  const estado: {
    colunas: Record<string, unknown> | null;
    condicao: any;
    linhas: any[];
    execucoes: any[];
    inseridos: any[];
  } = { colunas: null, condicao: null, linhas: [], execucoes: [], inseridos: [] };

  /**
   * O fim da cadeia de leitura: uma promessa das linhas projetadas que TAMBEM
   * responde a `.limit()`. Os tres metodos exercitados aqui terminam de jeitos
   * diferentes — um em `orderBy`, dois em `limit` — e um fake que so soubesse um
   * deles obrigaria a inventar um segundo mock para o mesmo storage.
   */
  const finalizar = () => {
    const chaves = Object.keys(estado.colunas ?? {});
    const linhas = estado.linhas.map(l => Object.fromEntries(chaves.map(k => [k, l[k] ?? null])));
    const p: any = Promise.resolve(linhas);
    p.limit = (n: number) => Promise.resolve(linhas.slice(0, n));
    return p;
  };

  const cadeia: any = {
    select(colunas: Record<string, unknown>) { estado.colunas = colunas; return cadeia; },
    from() { return cadeia; },
    where(condicao: any) { estado.condicao = condicao; return cadeia; },
    orderBy() { return finalizar(); },
    insert() {
      return {
        values(v: any) {
          estado.inseridos.push(v);
          return { returning: async () => [v] };
        },
      };
    },
    async execute(chunk: any) { estado.execucoes.push(chunk); },
    async transaction(fn: (tx: any) => Promise<unknown>) { return fn(cadeia); },
  };
  return { cadeia, estado };
});
vi.mock("../db", () => ({ db: dbFalso.cadeia, pool: {} }));

import { PgDialect } from "drizzle-orm/pg-core";
import { ErpStorage } from "./erp.storage";

const dialeto = new PgDialect();

/**
 * Compila o chunk do Drizzle e devolve o SQL com os parametros ja embutidos.
 *
 * Os parametros sao o ponto do teste — e neles que 'error'/'idle' viajam. Deixar
 * `$1` no texto esconderia exatamente o valor que precisa ser conferido.
 */
function compilar(chunk: any): string {
  const { sql, params } = dialeto.sqlToQuery(chunk);
  const texto = sql.replace(/\$(\d+)/g, (_m, n) => {
    const p = params[Number(n) - 1];
    return typeof p === "number" ? String(p) : `'${String(p)}'`;
  });
  return texto.replace(/\s+/g, " ").trim();
}

/**
 * Aplica um UPDATE de uma tabela so a uma linha em memoria.
 *
 * Cobre exatamente as formas que `registrarResultadoSync` emite — literal,
 * NOW(), `col + n` e o CASE de preservacao. Qualquer forma nova cai no `throw`,
 * que e de proposito: um UPDATE que este simulador nao entende e um UPDATE que
 * este teste nao esta mais provando.
 */
function aplicarUpdate(linha: Record<string, any>, sqlTexto: string): Record<string, any> {
  const inicioSet = sqlTexto.indexOf(" SET ") + 5;
  const fimSet = sqlTexto.indexOf(" WHERE ");
  const atribuicoes = sqlTexto
    .slice(inicioSet, fimSet)
    .split(/,\s*(?=[a-z_]+\s*=)/);

  const saida = { ...linha };
  for (const bruta of atribuicoes) {
    const [coluna, ...resto] = bruta.split("=");
    const nome = coluna.trim();
    const expr = resto.join("=").trim();

    const caseM = expr.match(/^CASE WHEN (\w+) = '([^']*)' THEN (\w+) ELSE '([^']*)' END$/);
    const somaM = expr.match(/^(\w+) \+ (\d+)$/);

    if (caseM) {
      const [, colTestada, esperado, colPreservada, alternativa] = caseM;
      saida[nome] = linha[colTestada] === esperado ? linha[colPreservada] : alternativa;
    } else if (expr === "NOW()") {
      saida[nome] = new Date();
    } else if (somaM) {
      saida[nome] = (linha[somaM[1]] ?? 0) + Number(somaM[2]);
    } else if (/^'.*'$/.test(expr)) {
      saida[nome] = expr.slice(1, -1);
    } else {
      throw new Error(`forma de atribuicao nao simulada: ${nome} = ${expr}`);
    }
  }
  return saida;
}

const erp = new ErpStorage();

/** Roda o metodo real e devolve a linha depois do UPDATE que ele emitiu. */
async function sincronizarSobre(
  linha: Record<string, any>,
  r: Parameters<ErpStorage["registrarResultadoSync"]>[2],
): Promise<Record<string, any>> {
  await erp.registrarResultadoSync(42, "ixc", r);
  expect(dbFalso.estado.execucoes).toHaveLength(1);
  return aplicarUpdate(linha, compilar(dbFalso.estado.execucoes[0]));
}

beforeEach(() => {
  dbFalso.estado.colunas = null;
  dbFalso.estado.condicao = null;
  dbFalso.estado.linhas = [];
  dbFalso.estado.execucoes = [];
  dbFalso.estado.inseridos = [];
});

describe("registrarResultadoSync preserva a marca de corte automatico", () => {
  const PAUSADA = {
    status: "pausado_por_falhas",
    last_sync_status: "error",
    total_synced: 100,
    total_errors: 7,
  };
  const NORMAL = {
    status: "idle",
    last_sync_status: "success",
    total_synced: 100,
    total_errors: 0,
  };

  // O defeito original em uma linha: a varredura que falhava apagava a marca que
  // a pausa acabara de escrever, e o corte ficava indistinguivel de um desligar
  // manual.
  it("uma falha NAO apaga status='pausado_por_falhas'", async () => {
    const depois = await sincronizarSobre(PAUSADA, { status: "error", upserted: 0, errors: 3 });
    expect(depois.status).toBe("pausado_por_falhas");
  });

  // Nem o sucesso religa sozinho: quem limpa a marca e o superadmin, no PUT.
  // Sem isto, um ERP que volta ao ar por um instante desfaria o corte sem que
  // ninguem tivesse olhado a causa.
  it("um sucesso tambem NAO apaga a marca — religar e ato do superadmin", async () => {
    const depois = await sincronizarSobre(PAUSADA, { status: "success", upserted: 10, errors: 0 });
    expect(depois.status).toBe("pausado_por_falhas");
  });

  it("numa integracao nao pausada, sucesso grava 'idle'", async () => {
    const depois = await sincronizarSobre(NORMAL, { status: "success", upserted: 10, errors: 0 });
    expect(depois.status).toBe("idle");
  });

  it("numa integracao nao pausada, falha grava 'error'", async () => {
    const depois = await sincronizarSobre(NORMAL, { status: "error", upserted: 0, errors: 3 });
    expect(depois.status).toBe("error");
  });

  it("'partial' cai no ramo de 'idle', e nao no de erro", async () => {
    const depois = await sincronizarSobre(NORMAL, { status: "partial", upserted: 8, errors: 2 });
    expect(depois.status).toBe("idle");
  });

  // `status` e o ESTADO da integracao; `last_sync_status` e o DESFECHO da
  // varredura. E por isso que preservar um nao pode congelar o outro: o
  // superadmin precisa ver que a integracao pausada continua falhando.
  it("last_sync_status e escrito sempre, pausada ou nao", async () => {
    const pausada = await sincronizarSobre(PAUSADA, { status: "error", upserted: 0, errors: 3 });
    expect(pausada.last_sync_status).toBe("error");

    dbFalso.estado.execucoes = [];
    const pausadaComSucesso = await sincronizarSobre(PAUSADA, { status: "success", upserted: 4, errors: 0 });
    expect(pausadaComSucesso.last_sync_status).toBe("success");
    expect(pausadaComSucesso.status).toBe("pausado_por_falhas");

    dbFalso.estado.execucoes = [];
    const normal = await sincronizarSobre(NORMAL, { status: "error", upserted: 0, errors: 1 });
    expect(normal.last_sync_status).toBe("error");
  });

  it("os contadores continuam somando mesmo com a marca preservada", async () => {
    const depois = await sincronizarSobre(PAUSADA, { status: "partial", upserted: 5, errors: 2 });
    expect(depois.total_synced).toBe(105);
    expect(depois.total_errors).toBe(9);
  });

  it("a linha de historico da varredura continua sendo gravada", async () => {
    await erp.registrarResultadoSync(42, "ixc", {
      status: "error", upserted: 0, errors: 3, syncType: "auto", mensagem: "ERP fora do ar",
    });
    expect(dbFalso.estado.inseridos).toHaveLength(1);
    expect(dbFalso.estado.inseridos[0]).toMatchObject({
      providerId: 42, erpSource: "ixc", status: "error", syncType: "auto",
    });
  });
});

describe("registrarReativacao", () => {
  // A razao de existir: `contarFalhasConsecutivas` para na primeira linha que
  // nao e 'error'. Esta linha e essa parada. Sem ela as tres falhas que
  // causaram o corte ficariam no topo do historico para sempre, e a tolerancia
  // de 3 viraria 1 depois do primeiro corte.
  it("insere uma linha 'reativado' que interrompe a contagem de falhas", async () => {
    await erp.registrarReativacao(42, "ixc");
    expect(dbFalso.estado.inseridos).toHaveLength(1);
    const linha = dbFalso.estado.inseridos[0];
    expect(linha).toMatchObject({
      providerId: 42,
      erpSource: "ixc",
      status: "reativado",
      syncType: "manual",
      upserted: 0,
      errors: 0,
      recordsProcessed: 0,
      recordsFailed: 0,
    });
    expect(linha.syncedAt).toBeInstanceOf(Date);
    expect(typeof linha.payload?.mensagem).toBe("string");
  });

  it("a contagem de falhas para na linha de reativacao", async () => {
    // A ordem e a que `contarFalhasConsecutivas` le: do mais recente para tras.
    dbFalso.estado.linhas = [
      { status: "error" },
      { status: "reativado" },
      { status: "error" },
      { status: "error" },
      { status: "error" },
    ];
    expect(await erp.contarFalhasConsecutivas(42, "ixc")).toBe(1);
  });

  // Reativar nao leu um registro sequer do ERP. Se contasse como sucesso, o boot
  // logo depois de religar pularia a varredura e a integracao recem-religada
  // ficaria sem dado novo ate a proxima janela.
  it("'reativado' nao entra na lista branca de `ultimoSyncBemSucedido`", async () => {
    dbFalso.estado.linhas = [{ quando: new Date("2026-09-03T03:00:00Z") }];
    await erp.ultimoSyncBemSucedido();
    // O db falso aceitaria qualquer `where`, entao a assercao e sobre o filtro
    // COMPILADO: uma lista branca, e 'reativado' fora dela.
    const filtro = compilar(dbFalso.estado.condicao);
    expect(filtro).toContain("'success'");
    expect(filtro).toContain("'partial'");
    expect(filtro).not.toContain("reativado");
  });
});

describe("o resumo do provedor", () => {
  it("nao devolve syncIntervalHours — numero que agendador nenhum honra", async () => {
    dbFalso.estado.linhas = [{
      erpSource: "ixc",
      isEnabled: true,
      status: "pausado_por_falhas",
      lastSyncAt: new Date("2026-09-01T10:00:00Z"),
      lastSyncStatus: "error",
      totalSynced: 120,
      totalErrors: 9,
      // Valor improvavel de proposito: a assercao procura o VALOR no JSON, e nao
      // so a chave — um campo apenas renomeado publicaria o mesmo numero.
      syncIntervalHours: 777,
      apiUrl: "https://erp.example",
      apiToken: "segredo",
    }];
    const [resumo] = await erp.getErpIntegracoesResumo(42);
    expect(resumo).not.toHaveProperty("syncIntervalHours");
    expect(JSON.stringify(resumo)).not.toContain("777");
  });

  it("continua entregando o estado, inclusive a marca de corte", async () => {
    dbFalso.estado.linhas = [{
      erpSource: "ixc",
      isEnabled: false,
      status: "pausado_por_falhas",
      lastSyncAt: new Date("2026-09-01T10:00:00Z"),
      lastSyncStatus: "error",
      totalSynced: 120,
      totalErrors: 9,
      // Valor improvavel de proposito: a assercao procura o VALOR no JSON, e nao
      // so a chave — um campo apenas renomeado publicaria o mesmo numero.
      syncIntervalHours: 777,
      apiUrl: "https://erp.example",
      apiToken: "segredo",
    }];
    const [resumo] = await erp.getErpIntegracoesResumo(42);
    expect(resumo).toEqual({
      erpSource: "ixc",
      isEnabled: false,
      configurado: true,
      status: "pausado_por_falhas",
      lastSyncAt: new Date("2026-09-01T10:00:00Z"),
      lastSyncStatus: "error",
      totalSynced: 120,
      totalErrors: 9,
    });
  });
});
