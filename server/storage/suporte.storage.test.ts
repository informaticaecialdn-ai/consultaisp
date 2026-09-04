import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A trava da personificacao, do lado do storage.
 *
 * Enquanto uma janela de acesso vale, o superadmin ve o dado pessoal completo
 * dos clientes de um provedor. Quem decide se ela vale e `acessoDeSuporteValido`,
 * chamado a cada requisicao. Um erro aqui nao derruba nada e nao aparece em
 * tela: so deixa uma porta aberta.
 *
 * Por isso estes testes nao mockam o storage — eles exercitam o SQL DE VERDADE.
 * O chunk do Drizzle e compilado pelo dialeto Postgres e depois APLICADO a um
 * banco de mentira que sabe avaliar as formas emitidas, `now()` inclusive. Um
 * teste que apenas conferisse o retorno de um mock passaria verde com a
 * comparacao de prazo invertida.
 *
 * O relogio desse banco de mentira fica em 2031, longe do relogio real do
 * processo — e de proposito. E a unica maneira de provar, sem duas maquinas,
 * que o prazo e contado pelo BANCO: uma implementacao que calculasse
 * `new Date(Date.now() + duracao)` gravaria uma expiracao em 2026, e toda janela
 * nasceria vencida contra o `now()` de 2031. O teste vira vermelho no ato.
 */
const suporte = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({
  // Proxy porque o banco de mentira so pode ser montado DEPOIS dos imports (ele
  // precisa do schema), e `vi.mock` corre antes de todos eles.
  db: new Proxy({} as any, {
    get: (_alvo, chave) => suporte.db[chave],
  }),
  pool: {},
}));

import { getTableColumns, is, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { acessosSuporte } from "@shared/schema";
import { DURACAO_PADRAO_DO_ACESSO_MS, SuporteStorage } from "./suporte.storage";

const dialeto = new PgDialect();

/** camel key <- nome da coluna no banco, para ler o SQL compilado. */
const CHAVE_POR_COLUNA = new Map(
  Object.entries(getTableColumns(acessosSuporte)).map(([chave, coluna]) => [(coluna as any).name, chave]),
);

const HORA = 60 * 60 * 1000;
/** O relogio do BANCO. Distante do relogio do processo de proposito. */
const RELOGIO_INICIAL = new Date("2031-05-20T09:00:00.000Z");

/**
 * Compila um chunk do Drizzle e devolve o SQL com os parametros ja embutidos.
 *
 * Os parametros sao metade do que se quer conferir — e neles que o `provider_id`
 * viaja. Deixar `$1` no texto esconderia justamente o valor a checar.
 */
function compilar(chunk: unknown): string {
  const { sql: texto, params } = dialeto.sqlToQuery(chunk as SQL);
  return texto
    .replace(/\$(\d+)/g, (_m, n) => {
      const p = params[Number(n) - 1];
      if (p === null || p === undefined) return "null";
      if (typeof p === "number") return String(p);
      if (p instanceof Date) return `'${p.toISOString()}'`;
      return `'${String(p)}'`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function valorLiteral(bruto: string): unknown {
  const t = bruto.trim();
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^'.*'$/.test(t)) return t.slice(1, -1);
  throw new Error(`literal nao simulado: ${bruto}`);
}

function coluna(bruto: string): string {
  const m = bruto.trim().match(/^"[\w]+"\."(\w+)"$/);
  if (!m) throw new Error(`referencia de coluna nao simulada: ${bruto}`);
  const chave = CHAVE_POR_COLUNA.get(m[1]);
  if (!chave) throw new Error(`coluna desconhecida: ${m[1]}`);
  return chave;
}

/**
 * Avalia um WHERE compilado contra uma linha em memoria.
 *
 * Cobre exatamente as formas que o storage emite. Qualquer forma nova cai no
 * `throw`, e isso e o ponto: um filtro que este simulador nao entende e um
 * filtro que este arquivo nao esta mais provando.
 */
function filtrar(sqlTexto: string, linha: Record<string, any>, agora: Date): boolean {
  const corpo = sqlTexto.replace(/^\((.*)\)$/, "$1");
  return corpo.split(" and ").every(termo => {
    const t = termo.trim();

    let m = t.match(/^("[\w]+"\."\w+") is null$/);
    if (m) return linha[coluna(m[1])] == null;

    m = t.match(/^("[\w]+"\."\w+") is not null$/);
    if (m) return linha[coluna(m[1])] != null;

    m = t.match(/^("[\w]+"\."\w+") = (.+)$/);
    if (m) return linha[coluna(m[1])] === valorLiteral(m[2]);

    m = t.match(/^("[\w]+"\."\w+") (>|<) now\(\)$/);
    if (m) {
      const valor = linha[coluna(m[1])] as Date | null;
      if (valor == null) return false;
      return m[2] === ">" ? valor.getTime() > agora.getTime() : valor.getTime() < agora.getTime();
    }

    throw new Error(`termo de filtro nao simulado: ${t}`);
  });
}

/** Avalia uma expressao de SET / VALUES compilada. Mesmas regras do `filtrar`. */
function avaliar(sqlTexto: string, linha: Record<string, any>, agora: Date): unknown {
  const t = sqlTexto.trim();

  if (t === "now()") return new Date(agora);

  let m = t.match(/^now\(\) \+ (-?\d+) \* interval '1 millisecond'$/);
  if (m) return new Date(agora.getTime() + Number(m[1]));

  m = t.match(/^coalesce\(("[\w]+"\."\w+"), (.+)\)$/);
  if (m) {
    const atual = linha[coluna(m[1])];
    if (atual != null) return atual;
    return m[2].trim() === "now()" ? new Date(agora) : valorLiteral(m[2]);
  }

  m = t.match(/^("[\w]+"\."\w+") \+ (-?\d+)$/);
  if (m) return (Number(linha[coluna(m[1])]) || 0) + Number(m[2]);

  throw new Error(`expressao nao simulada: ${t}`);
}

/** Ordena pelo ORDER BY compilado (`"tbl"."col" desc`). */
function ordenar(linhas: any[], sqlTexto: string): any[] {
  const m = sqlTexto.match(/^("[\w]+"\."\w+")( desc| asc)?$/);
  if (!m) throw new Error(`ordenacao nao simulada: ${sqlTexto}`);
  const chave = coluna(m[1]);
  const sinal = (m[2] ?? "").trim() === "desc" ? -1 : 1;
  return [...linhas].sort((a, b) => {
    const va = a[chave] instanceof Date ? a[chave].getTime() : a[chave];
    const vb = b[chave] instanceof Date ? b[chave].getTime() : b[chave];
    return va === vb ? 0 : (va < vb ? -1 : 1) * sinal;
  });
}

/**
 * O banco de mentira: uma tabela em memoria com relogio proprio.
 *
 * `relogio` e o que `now()` devolve. Move-lo e como esperar duas horas.
 */
function criarBanco() {
  const estado = {
    linhas: [] as Record<string, any>[],
    proximoId: 1,
    relogio: new Date(RELOGIO_INICIAL),
    /** Todo WHERE compilado que passou por aqui, para assercao direta. */
    filtros: [] as string[],
    /** Todo VALUES compilado, idem. */
    inseridos: [] as string[],
  };

  const nova = (): Record<string, any> =>
    Object.fromEntries(Object.keys(getTableColumns(acessosSuporte)).map(k => [k, null]));

  const casar = (cond: unknown) => {
    const texto = compilar(cond);
    estado.filtros.push(texto);
    return estado.linhas.filter(l => filtrar(texto, l, estado.relogio));
  };

  const banco: any = {
    select() {
      let alvo: any[] = [];
      const cadeia: any = {
        from() { alvo = estado.linhas; return cadeia; },
        where(cond: unknown) { alvo = casar(cond); return cadeia; },
        orderBy(o: unknown) { alvo = ordenar(alvo, compilar(o)); return cadeia; },
        limit: async (n: number) => alvo.slice(0, n).map(l => ({ ...l })),
      };
      return cadeia;
    },

    insert() {
      return {
        values(v: Record<string, unknown>) {
          const linha = nova();
          linha.id = estado.proximoId++;
          linha.usos = 0;
          // O DEFAULT NOW() da coluna `liberado_em`, do lado do banco.
          linha.liberadoEm = new Date(estado.relogio);
          for (const [chave, valor] of Object.entries(v)) {
            if (is(valor, SQL)) {
              const texto = compilar(valor);
              estado.inseridos.push(texto);
              linha[chave] = avaliar(texto, linha, estado.relogio);
            } else {
              linha[chave] = valor;
            }
          }
          estado.linhas.push(linha);
          return { returning: async () => [{ ...linha }] };
        },
      };
    },

    update() {
      let atribuicoes: Record<string, unknown> = {};
      const aplicar = (cond: unknown) => {
        const atingidas = casar(cond);
        for (const linha of atingidas) {
          for (const [chave, valor] of Object.entries(atribuicoes)) {
            linha[chave] = is(valor, SQL) ? avaliar(compilar(valor), linha, estado.relogio) : valor;
          }
        }
        return atingidas;
      };
      const cadeia: any = {
        set(v: Record<string, unknown>) { atribuicoes = v; return cadeia; },
        where(cond: unknown) {
          const atingidas = aplicar(cond);
          const p: any = Promise.resolve(atingidas.length);
          p.returning = async (_proj?: unknown) => atingidas.map(l => ({ id: l.id }));
          return p;
        },
      };
      return cadeia;
    },

    async transaction(fn: (tx: any) => Promise<unknown>) { return fn(banco); },
  };

  return { banco, estado };
}

let estado: ReturnType<typeof criarBanco>["estado"];
const storage = new SuporteStorage();

/** Avanca o relogio DO BANCO. */
function passar(ms: number) {
  estado.relogio = new Date(estado.relogio.getTime() + ms);
}

const PROVEDOR = 42;
const VIZINHO = 77;
const DONO = 5;       // admin do provedor 42, quem clica em "liberar"
const SUPORTE = 900;  // superadmin
const OUTRO_SUPORTE = 901;

beforeEach(() => {
  const banco = criarBanco();
  suporte.db = banco.banco;
  estado = banco.estado;
});

describe("a janela de acesso vale enquanto o prazo do BANCO nao venceu", () => {
  it("logo depois de liberada, ela vale", async () => {
    const criado = await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);

    const valido = await storage.acessoDeSuporteValido(PROVEDOR);
    expect(valido?.id).toBe(criado.id);
    expect(valido?.liberadoPor).toBe(DONO);
  });

  it("uma hora depois ainda vale; duas horas e um minuto depois, nao", async () => {
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);

    passar(HORA);
    expect(await storage.acessoDeSuporteValido(PROVEDOR)).toBeDefined();

    passar(HORA + 60_000);
    expect(await storage.acessoDeSuporteValido(PROVEDOR)).toBeUndefined();
  });

  /**
   * A prova de que o prazo nasce do relogio do banco.
   *
   * O relogio do banco de mentira esta em 2031 e o do processo em 2026: se o
   * storage calculasse a expiracao com `Date.now()`, `expira_em` cairia cinco
   * anos ATRAS de `now()` e a janela nasceria vencida — o `toBeDefined` acima
   * ja acusaria. Aqui a assercao e direta sobre o SQL emitido, para o caso
   * quebrar dizendo o porque.
   */
  it("`expira_em` e calculado em SQL, e nao com a hora do processo", async () => {
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);

    const comNow = estado.inseridos.filter(t => t.includes("now()"));
    expect(comNow).toHaveLength(1);
    expect(comNow[0]).toContain(String(DURACAO_PADRAO_DO_ACESSO_MS));

    const criada = estado.linhas[0];
    expect(criada.expiraEm.getTime() - criada.liberadoEm.getTime()).toBe(DURACAO_PADRAO_DO_ACESSO_MS);
    // Cinco anos a frente do relogio do processo: veio do banco, nao daqui.
    expect(criada.expiraEm.getUTCFullYear()).toBe(2031);
  });

  it("a validade e filtrada por `now()` no banco, e nao em JavaScript", async () => {
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO);
    estado.filtros.length = 0;

    await storage.acessoDeSuporteValido(PROVEDOR);

    expect(estado.filtros).toHaveLength(1);
    expect(estado.filtros[0]).toContain("now()");
    expect(estado.filtros[0]).toContain('"revogado_em" is null');
    expect(estado.filtros[0]).toContain(`"provider_id" = ${PROVEDOR}`);
  });

  it("duracao fora da faixa e recusada — janela de personificacao nao se concede por engano", async () => {
    await expect(storage.liberarAcessoDeSuporte(PROVEDOR, DONO, 0)).rejects.toThrow(/Duracao invalida/);
    await expect(storage.liberarAcessoDeSuporte(PROVEDOR, DONO, -HORA)).rejects.toThrow(/Duracao invalida/);
    await expect(storage.liberarAcessoDeSuporte(PROVEDOR, DONO, 365 * 24 * HORA)).rejects.toThrow(/Duracao invalida/);
    expect(estado.linhas).toHaveLength(0);
  });
});

describe("revogar fecha a janela na hora", () => {
  it("depois de revogada a janela nao vale mais, mesmo dentro do prazo", async () => {
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);

    passar(10 * 60_000);
    expect(await storage.revogarAcessoDeSuporte(PROVEDOR, DONO)).toBe(1);

    expect(await storage.acessoDeSuporteValido(PROVEDOR)).toBeUndefined();
    expect(estado.linhas[0].revogadoEm).toBeInstanceOf(Date);
    expect(estado.linhas[0].revogadoPor).toBe(DONO);
  });

  // A distincao entre "alguem interrompeu" e "o prazo acabou" e o que uma
  // auditoria le nesta tabela. Carimbar revogacao em janela ja morta apagaria a
  // segunda historia e inventaria a primeira.
  it("nao carimba revogacao em janela que ja tinha expirado sozinha", async () => {
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);
    passar(3 * HORA);

    expect(await storage.revogarAcessoDeSuporte(PROVEDOR, DONO)).toBe(0);
    expect(estado.linhas[0].revogadoEm).toBeNull();
    expect(estado.linhas[0].revogadoPor).toBeNull();
  });

  it("revogar so alcanca o proprio provedor — o vizinho continua com a dele", async () => {
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);
    const doVizinho = await storage.liberarAcessoDeSuporte(VIZINHO, 6, DURACAO_PADRAO_DO_ACESSO_MS);

    expect(await storage.revogarAcessoDeSuporte(PROVEDOR, DONO)).toBe(1);

    expect(await storage.acessoDeSuporteValido(PROVEDOR)).toBeUndefined();
    expect((await storage.acessoDeSuporteValido(VIZINHO))?.id).toBe(doVizinho.id);
  });

  it("liberar tambem so alcanca o proprio provedor", async () => {
    const doVizinho = await storage.liberarAcessoDeSuporte(VIZINHO, 6, DURACAO_PADRAO_DO_ACESSO_MS);
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);

    // A liberacao do 42 revoga janelas do 42, nunca a do 77.
    expect((await storage.acessoDeSuporteValido(VIZINHO))?.id).toBe(doVizinho.id);
  });
});

describe("clicar em liberar de novo", () => {
  // Duas janelas validas ao mesmo tempo tornariam "revogar" ambiguo: o provedor
  // clica em encerrar, uma some, o suporte continua dentro pela outra.
  it("nunca deixa duas janelas validas: a anterior e revogada e uma nova nasce", async () => {
    const primeira = await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);
    passar(90 * 60_000);
    const segunda = await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);

    expect(segunda.id).not.toBe(primeira.id);
    expect(estado.linhas.filter(l => l.revogadoEm == null && l.expiraEm > estado.relogio)).toHaveLength(1);
    expect((await storage.acessoDeSuporteValido(PROVEDOR))?.id).toBe(segunda.id);
  });

  // O historico e o produto desta tabela: a janela cortada tem que continuar
  // dizendo quanto tempo durou de verdade.
  it("o historico guarda as duas janelas, com a primeira marcada como cortada", async () => {
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);
    passar(90 * 60_000);
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);

    const historico = await storage.historicoDeAcessos(PROVEDOR);
    expect(historico).toHaveLength(2);

    const [recente, antiga] = historico;
    expect(recente.revogadoEm).toBeNull();
    expect(antiga.revogadoEm).toBeInstanceOf(Date);
    expect(antiga.revogadoPor).toBe(DONO);
    expect(antiga.revogadoEm!.getTime() - antiga.liberadoEm.getTime()).toBe(90 * 60_000);
  });

  it("o historico e por provedor, do mais recente para tras", async () => {
    await storage.liberarAcessoDeSuporte(VIZINHO, 6, DURACAO_PADRAO_DO_ACESSO_MS);
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);

    const historico = await storage.historicoDeAcessos(PROVEDOR);
    expect(historico.map(l => l.providerId)).toEqual([PROVEDOR]);
  });
});

describe("o uso da janela fica registrado", () => {
  it("a primeira entrada grava quem entrou e quando", async () => {
    const criado = await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);
    expect(criado.usadoPor).toBeNull();
    expect(criado.usos).toBe(0);

    passar(5 * 60_000);
    await storage.registrarUsoDoAcesso(criado.id, SUPORTE);

    const [linha] = await storage.historicoDeAcessos(PROVEDOR);
    expect(linha.usadoPor).toBe(SUPORTE);
    expect(linha.usos).toBe(1);
    expect(linha.primeiroUsoEm!.getTime()).toBe(linha.liberadoEm.getTime() + 5 * 60_000);
    expect(linha.ultimoUsoEm!.getTime()).toBe(linha.primeiroUsoEm!.getTime());
  });

  // Sobrescrever `usado_por` apagaria quem abriu a porta — o dado mais caro da
  // linha. `ultimo_uso_em` e `usos`, ao contrario, tem que continuar andando.
  it("a segunda entrada move o ultimo uso e a contagem, mas nao apaga quem entrou primeiro", async () => {
    const criado = await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);

    passar(5 * 60_000);
    await storage.registrarUsoDoAcesso(criado.id, SUPORTE);
    const primeiroUso = estado.linhas[0].primeiroUsoEm as Date;

    passar(20 * 60_000);
    await storage.registrarUsoDoAcesso(criado.id, OUTRO_SUPORTE);

    const [linha] = await storage.historicoDeAcessos(PROVEDOR);
    expect(linha.usadoPor).toBe(SUPORTE);
    expect(linha.primeiroUsoEm!.getTime()).toBe(primeiroUso.getTime());
    expect(linha.ultimoUsoEm!.getTime()).toBe(primeiroUso.getTime() + 20 * 60_000);
    expect(linha.usos).toBe(2);
  });

  it("registrar uso mira a linha pelo id, sem tocar na janela do vizinho", async () => {
    const doProvedor = await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);
    const doVizinho = await storage.liberarAcessoDeSuporte(VIZINHO, 6, DURACAO_PADRAO_DO_ACESSO_MS);

    await storage.registrarUsoDoAcesso(doProvedor.id, SUPORTE);

    const [linhaVizinho] = await storage.historicoDeAcessos(VIZINHO);
    expect(linhaVizinho.id).toBe(doVizinho.id);
    expect(linhaVizinho.usos).toBe(0);
    expect(linhaVizinho.usadoPor).toBeNull();
  });

  // Janela liberada e nunca aberta e informacao: o provedor autorizou e ninguem
  // viu dado nenhum. Se `usado_por` nascesse preenchido, isso se perderia.
  it("janela nunca usada continua sem dono de uso depois de expirar", async () => {
    await storage.liberarAcessoDeSuporte(PROVEDOR, DONO, DURACAO_PADRAO_DO_ACESSO_MS);
    passar(3 * HORA);

    const [linha] = await storage.historicoDeAcessos(PROVEDOR);
    expect(linha.usadoPor).toBeNull();
    expect(linha.primeiroUsoEm).toBeNull();
    expect(linha.usos).toBe(0);
  });
});
