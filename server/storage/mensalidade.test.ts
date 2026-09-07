/**
 * A MENSALIDADE lida das faturas — o ARPU que destrava a Economia do 360.
 *
 * Por que este teste existe. Em 06/09/2026 o dono abriu o Cliente 360 e viu a
 * "Economia do cliente · visão financeira" inteira com "—" e um selo
 * "PENDENTE · R24": ARPU, CAC, CAPEX, OPEX, margem, payback, lucro, LTV, tudo.
 * A causa era uma só, e não era falta de configuração: sem ARPU não há
 * cálculo, e o ARPU tinha um caminho único — o nome do plano do cliente casado
 * com um preço digitado à mão em Política > Economia. Esse caminho está
 * cortado dos DOIS lados: `customers` não guarda o plano (o `contractPlan` que
 * o conector traz é descartado no upsert) e o mapa de preços nasce vazio.
 *
 * O valor, porém, está no banco desde a migração 0027: as faturas do ERP,
 * fatura a fatura, com o que o provedor realmente cobra deste assinante.
 * Medido em produção em 06/09/2026, entre os clientes de contrato vivo com
 * data de contrato: 92,4% (IXC), 71,5% (SGP) e 66,3% (MK) têm faturas cujo
 * valor concorda, com médias de R$ 141, R$ 151 e R$ 99 — mensalidades
 * plausíveis. É o mesmo recurso do Provedor.ai quando o ERP não expõe o preço
 * do plano (semeadura por MODA do valor faturado).
 *
 * O que este teste trava é o que faz a diferença entre ler e chutar: a MODA
 * (não a média, que sobe com multa e juros; não a maior, que pega o acordo
 * inteiro numa fatura só), o recorte por provedor, e a recusa a devolver
 * número quando não há fatura do ERP.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  respostas: [] as unknown[][],
  db: null as any,
}));
vi.mock("../db", () => ({ db: new Proxy({} as any, { get: (_a, k) => banco.db[k] }), pool: {} }));

/*
 * O driver pg-proxy entrega a linha POSICIONAL — um array na ordem do select —,
 * e não um objeto com as chaves do `db.select({...})`. Empurrar um objeto aqui
 * compila, roda e faz a leitura devolver `null` calada, porque o mapeamento não
 * acha nada. Estes helpers deixam a ordem do select explícita no teste.
 */
const linhaDaModa = (valor: string | null, n: number, maisRecente: string | null) => [valor, n, maisRecente];
const linhaDoTotal = (total: number) => [total];
const linhaDaCobertura = (ativos: number, comMensalidade: number, comData: number) => [ativos, comMensalidade, comData];

import { drizzle } from "drizzle-orm/pg-proxy";
import { FaturasStorage } from "./faturas.storage";

const PROVEDOR = 42;
const CLIENTE = 7;
let storage: FaturasStorage;

beforeEach(() => {
  banco.consultas.length = 0;
  banco.respostas.length = 0;
  banco.db = drizzle(async (sql, params) => {
    banco.consultas.push({ sql, params });
    return { rows: banco.respostas.shift() ?? [] };
  });
  storage = new FaturasStorage();
});

describe("mensalidadeDoCliente", () => {
  it("pega a MODA do valor: o que mais se repete, e não a média nem a maior", async () => {
    // O grupo campeão já vem primeiro do banco — o que o SQL precisa garantir
    // é a ORDEM que produz isso.
    banco.respostas.push([linhaDaModa("129.90", 3, "2026-08-10T00:00:00Z")]);
    banco.respostas.push([linhaDoTotal(5)]);

    const m = await storage.mensalidadeDoCliente(PROVEDOR, CLIENTE);
    expect(m).toMatchObject({ valor: 129.9, concordam: 3, faturas: 5 });
    // A data decodifica pela MESMA coluna (`mapWith(due_date)`), então volta
    // como Date e não como o texto cru do driver.
    expect(m!.maisRecente).toBeInstanceOf(Date);

    const c = banco.consultas[0];
    // Agrupa por valor e ordena por contagem — é isso que é a moda.
    expect(c.sql).toContain('group by "invoices"."value"');
    expect(c.sql).toMatch(/order by count\(\*\) desc/);
    // Empate na contagem: vence o vencimento mais novo.
    expect(c.sql).toMatch(/max\("invoices"\."due_date"\) desc/);
    expect(c.sql).toContain("limit");
  });

  it("só fatura do ERP entra: a linha de import CSV foi digitada e não prova o que o provedor cobra", async () => {
    banco.respostas.push([]);
    await storage.mensalidadeDoCliente(PROVEDOR, CLIENTE);
    expect(banco.consultas[0].sql).toContain('"invoices"."erp_source" is not null');
  });

  it("multi-tenant: o provedor entra na consulta, e o cliente também", async () => {
    banco.respostas.push([]);
    await storage.mensalidadeDoCliente(PROVEDOR, CLIENTE);
    const c = banco.consultas[0];
    expect(c.params).toContain(PROVEDOR);
    expect(c.params).toContain(CLIENTE);
    const ocorrencias = Array.from(c.sql.matchAll(/"provider_id" = \$(\d+)/g));
    expect(ocorrencias.length).toBeGreaterThan(0);
    for (const o of ocorrencias) expect(c.params[Number(o[1]) - 1]).toBe(PROVEDOR);
  });

  it("sem fatura nenhuma, devolve null — a ficha diz 'não tem fatura', não inventa mensalidade", async () => {
    banco.respostas.push([]);
    expect(await storage.mensalidadeDoCliente(PROVEDOR, CLIENTE)).toBeNull();
    // E não gasta a segunda consulta: sem moda não há o que contar.
    expect(banco.consultas).toHaveLength(1);
  });

  it("valor zero, negativo ou ilegível não vira mensalidade", async () => {
    for (const valor of ["0", "0.00", "-15.00", "abacaxi", null]) {
      banco.consultas.length = 0;
      banco.respostas.length = 0;
      banco.respostas.push([linhaDaModa(valor, 2, null)]);
      banco.respostas.push([linhaDoTotal(2)]);
      expect(await storage.mensalidadeDoCliente(PROVEDOR, CLIENTE), `valor ${valor}`).toBeNull();
    }
  });

  it("arredonda a centavo: o valor vai para a tela e para o cálculo do ledger", async () => {
    banco.respostas.push([linhaDaModa("99.999", 1, null)]);
    banco.respostas.push([linhaDoTotal(1)]);
    expect((await storage.mensalidadeDoCliente(PROVEDOR, CLIENTE))?.valor).toBe(100);
  });

  it("uma fatura só é evidência fraca, e a leitura DIZ isso em vez de esconder", async () => {
    banco.respostas.push([linhaDaModa("250.00", 1, null)]);
    banco.respostas.push([linhaDoTotal(1)]);
    const m = await storage.mensalidadeDoCliente(PROVEDOR, CLIENTE);
    // O número sai — é o que o ERP cobra —, mas com a evidência junto, para a
    // tela poder qualificar. Esconder daria "—" a quem tem fatura.
    expect(m).toMatchObject({ valor: 250, concordam: 1, faturas: 1 });
  });
});

describe("coberturaDaMensalidade", () => {
  it("conta a carteira VIVA e quantos dela têm fatura do ERP, numa consulta só", async () => {
    banco.respostas.push([linhaDaCobertura(13203, 12331, 12000)]);
    const c = await storage.coberturaDaMensalidade(PROVEDOR);
    expect(c).toEqual({ ativos: 13203, comMensalidade: 12331, comDataDeContrato: 12000 });
    // Uma consulta agregada, nunca N+1: a maior carteira em produção tem 29 mil clientes.
    expect(banco.consultas).toHaveLength(1);
    expect(banco.consultas[0].sql).toContain('from "customers"');
    expect(banco.consultas[0].sql).toContain("exists");
    expect(banco.consultas[0].params).toContain(PROVEDOR);
  });

  it("só contrato vivo: ex-cliente não entra na conta de prontidão", async () => {
    banco.respostas.push([linhaDaCobertura(0, 0, 0)]);
    await storage.coberturaDaMensalidade(PROVEDOR);
    expect(banco.consultas[0].params).toEqual(expect.arrayContaining(["active", "suspended"]));
  });

  it("banco sem linha vira zero — aqui zero é a resposta, não a ausência dela", async () => {
    banco.respostas.push([]);
    expect(await storage.coberturaDaMensalidade(PROVEDOR)).toEqual({ ativos: 0, comMensalidade: 0, comDataDeContrato: 0 });
  });
});

describe("o índice que a leitura exige", () => {
  /*
   * Medido na produção em 06/09/2026, ANTES do índice: a consulta de cobertura
   * levou 38.033 ms — trinta e oito segundos, a cada abertura da tela de
   * Política. `invoices` não tinha índice nenhum por cliente, e o EXISTS virava
   * varredura sequencial de 46 mil faturas, 13 mil vezes. Com
   * `idx_invoices_provider_customer`: 45 ms.
   *
   * Este teste existe porque a consulta é escrita num arquivo e o índice em
   * outro: quem apagar o índice não vê o efeito em teste nenhum, e a lentidão
   * só aparece em produção, na tela de quem está configurando.
   */
  const migracao = readFileSync(new URL("../../migrations/0031_invoices_cliente_idx.sql", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../../shared/schema.ts", import.meta.url), "utf8");

  it("a migração cria o índice e é idempotente", () => {
    expect(migracao).toMatch(/CREATE INDEX IF NOT EXISTS idx_invoices_provider_customer/);
    expect(migracao).toMatch(/ON invoices \(provider_id, customer_id\)/);
  });

  it("o schema declara o mesmo índice — senão os dois divergem em silêncio", () => {
    expect(schema).toContain('index("idx_invoices_provider_customer").on(t.providerId, t.customerId)');
  });

  it("provider_id lidera: multi-tenant filtra por provedor antes de tudo", () => {
    expect(migracao).toMatch(/\(provider_id, customer_id\)/);
    expect(migracao).not.toMatch(/\(customer_id, provider_id\)/);
  });
});
