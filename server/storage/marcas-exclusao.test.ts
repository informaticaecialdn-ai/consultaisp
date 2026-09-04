/**
 * A guarda de `deleteMarca`, e por que ela precisa de teste proprio.
 *
 * A rota `DELETE /api/admin/marcas/:id` e testada com o storage dublado: la se
 * prova que um `MarcaComVinculosError` vira 409 com o texto certo. O que aquele
 * arquivo NAO consegue provar e o que este prova:
 *
 * 1. Que a pergunta acontece ANTES do primeiro comando. Sem isso, a sequencia
 *    do `deleteMarca` desvincula os provedores e so estoura na violacao de FK
 *    do DELETE seguinte. A transacao volta atras, mas o superadmin le "Erro
 *    interno do servidor" sobre uma recusa que e decisao, e clica de novo.
 * 2. Que a contagem olha TODAS as tabelas que apontam para `marcas`, e nao so
 *    as tres que o desenho cita. `marca_eventos.marca_id` e NOT NULL e nasce na
 *    primeira edicao da marca — se a contagem o ignorasse, toda marca ja editada
 *    cairia no 500 por FK em vez do 409 explicativo.
 * 3. Que "fechamento nao pago" e o COMPLEMENTO de 'pago', e nao uma lista de
 *    status conhecidos: o SQL emitido e conferido caractere a caractere, porque
 *    um `eq(status,'aberto')` passaria por qualquer teste que so contasse
 *    chamadas.
 * 4. Que `contarRevendedoresDaMarca(marca, exceto)` exclui no BANCO. Contar
 *    todos e subtrair 1 na aplicacao da a mesma resposta ate o dia em que duas
 *    remocoes acontecem juntas — e as duas passariam, deixando a marca sem
 *    ninguem.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const dbFalso = vi.hoisted(() => {
  const estado = {
    /** Fila de respostas por TABELA — chave e o objeto da tabela do Drizzle. */
    contagens: new Map<any, number[]>(),
    /** Condicoes recebidas, na ordem, para conferir o SQL emitido. */
    condicoes: [] as Array<{ tabela: any; cond: any }>,
    desvinculou: false,
    apagou: false,
  };

  const cadeia: any = {
    select: () => ({
      from: (tabela: any) => ({
        where: async (cond: any) => {
          estado.condicoes.push({ tabela, cond });
          const fila = estado.contagens.get(tabela);
          return [{ n: fila && fila.length ? fila.shift() : 0 }];
        },
      }),
    }),
    transaction: async (fn: (tx: any) => Promise<unknown>) =>
      fn({
        update: () => ({ set: () => ({ where: async () => { estado.desvinculou = true; } }) }),
        delete: () => ({ where: async () => { estado.apagou = true; } }),
      }),
  };
  return { cadeia, estado };
});
vi.mock("../db", () => ({ db: dbFalso.cadeia, pool: {} }));

import {
  comissaoFechamentos,
  comissaoLancamentos,
  marcaEventos,
  users,
} from "@shared/schema";
import {
  CODIGO_MARCA_COM_HISTORICO,
  CODIGO_MARCA_COM_REVENDA,
  MarcasStorage,
  contarRevendedoresDaMarca,
  contarVinculosDaMarca,
} from "./marcas.storage";

const dialeto = new PgDialect();

/** SQL com os parametros embutidos — sao eles que carregam 'pago' e o id. */
function compilar(chunk: any): string {
  const { sql, params } = dialeto.sqlToQuery(chunk);
  return sql
    .replace(/\$(\d+)/g, (_m, n) => {
      const p = params[Number(n) - 1];
      return typeof p === "number" ? String(p) : `'${String(p)}'`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const storage = new MarcasStorage();

/** A condicao da n-esima consulta feita sobre `tabela`. */
function condicaoDe(tabela: any, ocorrencia = 0): string {
  const daTabela = dbFalso.estado.condicoes.filter(c => c.tabela === tabela);
  return compilar(daTabela[ocorrencia].cond);
}

beforeEach(() => {
  dbFalso.estado.contagens.clear();
  dbFalso.estado.condicoes = [];
  dbFalso.estado.desvinculou = false;
  dbFalso.estado.apagou = false;
});

describe("contarVinculosDaMarca", () => {
  it("conta usuario, comissao e todo o historico que aponta para a marca", async () => {
    dbFalso.estado.contagens.set(users, [2]);
    // Duas consultas na mesma tabela: pendentes primeiro, total depois.
    dbFalso.estado.contagens.set(comissaoLancamentos, [1, 4]);
    dbFalso.estado.contagens.set(comissaoFechamentos, [0, 3]);
    dbFalso.estado.contagens.set(marcaEventos, [9]);

    const v = await contarVinculosDaMarca(7);

    expect(v.usuariosRevenda).toBe(2);
    expect(v.lancamentosPendentes).toBe(1);
    expect(v.fechamentosNaoPagos).toBe(0);
    expect(v.historico.lancamentos).toBe(4);
    expect(v.historico.fechamentos).toBe(3);
    expect(v.historico.eventos).toBe(9);
  });

  it("a trilha de auditoria esta entre as tabelas consultadas", async () => {
    // Ela e a que quebra primeiro na pratica: nasce na primeira edicao da
    // marca, e a FK dela e NOT NULL.
    await contarVinculosDaMarca(7);
    expect(dbFalso.estado.condicoes.map(c => c.tabela)).toContain(marcaEventos);
  });

  it("'fechamento nao pago' e o complemento de 'pago', nao uma lista de status", async () => {
    // Um `eq(status, 'aberto')` contaria zero para um fechamento 'aprovado' e
    // deixaria a marca sumir com comissao aprovada e ainda nao paga.
    await contarVinculosDaMarca(7);
    const pendentes = condicaoDe(comissaoFechamentos, 0);
    expect(pendentes).toContain("<>");
    expect(pendentes).toContain("'pago'");
  });

  it("so olha a marca pedida", async () => {
    await contarVinculosDaMarca(7);
    for (const { cond } of dbFalso.estado.condicoes) {
      expect(compilar(cond)).toMatch(/marca_id" = 7/);
    }
  });
});

describe("contarRevendedoresDaMarca", () => {
  it("filtra por marca e papel", async () => {
    dbFalso.estado.contagens.set(users, [3]);
    expect(await contarRevendedoresDaMarca(7)).toBe(3);
    const cond = condicaoDe(users);
    expect(cond).toContain("'revendedor'");
    expect(cond).toMatch(/marca_id" = 7/);
  });

  it("com `exceto`, a exclusao vai no SQL — nao numa subtracao depois", async () => {
    dbFalso.estado.contagens.set(users, [0]);
    expect(await contarRevendedoresDaMarca(7, 90)).toBe(0);
    const cond = condicaoDe(users);
    expect(cond).toMatch(/id" <> 90/);
  });
});

describe("deleteMarca", () => {
  it("marca sem nenhum vinculo e apagada, e os provedores sao desvinculados antes", async () => {
    await storage.deleteMarca(7);
    expect(dbFalso.estado.desvinculou).toBe(true);
    expect(dbFalso.estado.apagou).toBe(true);
  });

  it("recusa por equipe ou comissao em aberto, sem tocar em nada", async () => {
    dbFalso.estado.contagens.set(users, [1]);
    await expect(storage.deleteMarca(7)).rejects.toMatchObject({ codigo: CODIGO_MARCA_COM_REVENDA });
    // A guarda vem antes do primeiro comando: nem o UPDATE que desvincula rodou.
    expect(dbFalso.estado.desvinculou).toBe(false);
    expect(dbFalso.estado.apagou).toBe(false);
  });

  it("recusa com codigo diferente quando so ha historico", async () => {
    dbFalso.estado.contagens.set(marcaEventos, [4]);
    await expect(storage.deleteMarca(7)).rejects.toMatchObject({
      codigo: CODIGO_MARCA_COM_HISTORICO,
      vinculos: { historico: { eventos: 4 } },
    });
    expect(dbFalso.estado.apagou).toBe(false);
  });

  it("com os dois grupos, vence o acionavel — e o unico que tem o que fazer", async () => {
    dbFalso.estado.contagens.set(users, [1]);
    dbFalso.estado.contagens.set(marcaEventos, [10]);
    await expect(storage.deleteMarca(7)).rejects.toMatchObject({ codigo: CODIGO_MARCA_COM_REVENDA });
  });

  it("o erro carrega as contagens, que sao o que a mensagem do 409 usa", async () => {
    dbFalso.estado.contagens.set(users, [2]);
    dbFalso.estado.contagens.set(comissaoLancamentos, [5, 5]);
    await expect(storage.deleteMarca(7)).rejects.toMatchObject({
      vinculos: { usuariosRevenda: 2, lancamentosPendentes: 5 },
    });
  });
});
