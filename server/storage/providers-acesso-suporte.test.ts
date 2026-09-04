import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Apagar um provedor nao pode apagar a prova de que alguem olhou o dado dos
 * clientes dele.
 *
 * `acessos_suporte` tem FK para `providers.id` e para `users.id`, nenhuma com
 * ON DELETE CASCADE — decisao de quem criou a tabela, para a trilha nao evaporar
 * junto com o que ela audita. O efeito colateral e que `deleteProvider`, uma
 * fila de dezessete comandos SOLTOS (sem transacao), passa a esbarrar na FK no
 * penultimo deles. O perigo nao e o 500: e o estado que ele deixa — clientes,
 * faturas, consultas e equipamentos ja apagados, provedor ainda de pe — e o
 * conserto obvio a partir dali ser um DELETE na trilha.
 *
 * O que estes testes fixam: a recusa acontece ANTES do primeiro DELETE, ela
 * nunca toca em `acessos_suporte`, e o caminho de quem NAO tem historico
 * continua igual ao que era.
 *
 * O Postgres nao entra aqui. O que precisa de prova e a ORDEM e o ALVO dos
 * comandos, e isso o dialeto do Drizzle compila sozinho.
 */
const estado = vi.hoisted(() => ({
  selects: [] as { tabela: unknown; campos: unknown; where: unknown }[],
  deletes: [] as { tabela: unknown; where: unknown }[],
  /** tabela do Drizzle -> linhas que o SELECT nela devolve. */
  retorno: new Map<unknown, unknown[]>(),
}));

vi.mock("../db", () => ({
  db: {
    select: (campos?: unknown) => ({
      from: (tabela: unknown) => ({
        where: async (cond: unknown) => {
          estado.selects.push({ tabela, campos, where: cond });
          return estado.retorno.get(tabela) ?? [];
        },
      }),
    }),
    delete: (tabela: unknown) => ({
      where: async (cond: unknown) => {
        estado.deletes.push({ tabela, where: cond });
      },
    }),
  },
  pool: {},
}));

import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { acessosSuporte, providers, supportThreads, users } from "@shared/schema";
import {
  CODIGO_PROVEDOR_COM_TRILHA_DE_SUPORTE,
  ProvedorComTrilhaDeSuporteError,
  ProvidersStorage,
} from "./providers.storage";

const dialeto = new PgDialect();
const paraSql = (q: unknown) => dialeto.sqlToQuery(q as SQL);
const nomes = (lista: { tabela: unknown }[]) => lista.map(c => getTableName(c.tabela as any));

const PROVEDOR = 42;

let storage: ProvidersStorage;

beforeEach(() => {
  estado.selects.length = 0;
  estado.deletes.length = 0;
  estado.retorno.clear();
  // Sem historico e o caso comum; cada teste que quer trilha diz isso.
  estado.retorno.set(acessosSuporte, [{ acessos: 0 }]);
  estado.retorno.set(supportThreads, []);
  storage = new ProvidersStorage();
});

describe("deleteProvider com trilha de acesso de suporte", () => {
  it("recusa a exclusao quando existe historico de acesso", async () => {
    estado.retorno.set(acessosSuporte, [{ acessos: 3 }]);

    const erro = await storage.deleteProvider(PROVEDOR).catch(e => e);

    expect(erro).toBeInstanceOf(ProvedorComTrilhaDeSuporteError);
    expect(erro.codigo).toBe(CODIGO_PROVEDOR_COM_TRILHA_DE_SUPORTE);
    expect(erro.providerId).toBe(PROVEDOR);
    expect(erro.acessos).toBe(3);
    // A mensagem e lida por uma pessoa que acabou de clicar em excluir: ela
    // precisa dizer o que impede, nao "violacao de chave estrangeira".
    expect(erro.message).toContain("trilha de auditoria");
  });

  // O teste que mais importa. Sem a guarda no topo, a recusa so aconteceria no
  // penultimo comando — com a carteira do provedor ja destruida.
  it("recusa ANTES de apagar qualquer coisa: nenhum DELETE e emitido", async () => {
    estado.retorno.set(acessosSuporte, [{ acessos: 1 }]);

    await expect(storage.deleteProvider(PROVEDOR)).rejects.toBeInstanceOf(
      ProvedorComTrilhaDeSuporteError,
    );

    expect(estado.deletes).toHaveLength(0);
    // E so uma pergunta foi feita: a da trilha. Nem a leitura das threads de
    // suporte chegou a acontecer.
    expect(nomes(estado.selects)).toEqual(["acessos_suporte"]);
  });

  it("pergunta pela trilha DO provedor que se quer apagar", async () => {
    estado.retorno.set(acessosSuporte, [{ acessos: 1 }]);

    await storage.deleteProvider(PROVEDOR).catch(() => {});

    const consulta = paraSql(estado.selects[0].where);
    expect(consulta.sql).toContain("provider_id");
    expect(consulta.params).toContain(PROVEDOR);
  });

  // O driver do Postgres devolve count() como string quando o ::int se perde no
  // caminho. "3" e verdade e "0" e falso, e nenhuma comparacao frouxa decide
  // isso sozinha — por isso a conversao explicita, e por isso os dois casos.
  it("trata a contagem que chega como texto", async () => {
    estado.retorno.set(acessosSuporte, [{ acessos: "3" }]);
    await expect(storage.deleteProvider(PROVEDOR)).rejects.toBeInstanceOf(
      ProvedorComTrilhaDeSuporteError,
    );
    expect(estado.deletes).toHaveLength(0);

    estado.deletes.length = 0;
    estado.retorno.set(acessosSuporte, [{ acessos: "0" }]);
    await expect(storage.deleteProvider(PROVEDOR)).resolves.toBeUndefined();
    expect(nomes(estado.deletes)).toContain("providers");
  });

  // Trilha ausente e trilha vazia sao a mesma resposta: nao ha o que preservar.
  it("segue em frente quando a consulta da trilha nao devolve linha", async () => {
    estado.retorno.set(acessosSuporte, []);

    await expect(storage.deleteProvider(PROVEDOR)).resolves.toBeUndefined();

    expect(nomes(estado.deletes)).toContain("providers");
  });
});

describe("deleteProvider sem historico: o caminho antigo nao mudou", () => {
  it("apaga as mesmas tabelas, na mesma ordem, terminando no provedor", async () => {
    await expect(storage.deleteProvider(PROVEDOR)).resolves.toBeUndefined();

    expect(nomes(estado.deletes)).toEqual([
      "support_threads",
      "invoices",
      "contracts",
      "anti_fraud_alerts",
      "equipment",
      "customers",
      "isp_consultations",
      "spc_consultations",
      "erp_sync_logs",
      "erp_integrations",
      "plan_changes",
      "provider_invoices",
      "credit_orders",
      "provider_documents",
      "provider_partners",
      "users",
      "providers",
    ]);
  });

  it("apaga as mensagens das threads que existirem", async () => {
    estado.retorno.set(supportThreads, [{ id: 7 }, { id: 9 }]);

    await storage.deleteProvider(PROVEDOR);

    expect(nomes(estado.deletes)[0]).toBe("support_messages");
  });

  // A trilha nao e uma tabela filha como as outras: nem no caminho feliz ela
  // pode ser apagada. Se um dia alguem a acrescentar a fila de deletes para
  // "resolver o FK", este teste fica vermelho.
  it("nunca emite DELETE em acessos_suporte", async () => {
    await storage.deleteProvider(PROVEDOR);

    expect(nomes(estado.deletes)).not.toContain(getTableName(acessosSuporte));
  });

  it("o ultimo comando e o do provedor, depois dos usuarios", async () => {
    await storage.deleteProvider(PROVEDOR);

    const emitidos = nomes(estado.deletes);
    expect(emitidos.indexOf(getTableName(users))).toBeLessThan(
      emitidos.indexOf(getTableName(providers)),
    );
  });
});
