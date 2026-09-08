/**
 * A migração 0032 lida como TEXTO: as três coisas que, se mudarem, quebram em
 * silêncio meses depois.
 *
 * Não há teste de integração com banco neste repositório (regra da casa: a
 * camada de banco fica fina, a lógica vai para função pura). O que dá para
 * travar aqui é o CONTRATO da migração contra o código que vai reescrever esses
 * mesmos campos na próxima varredura.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ler = (rel: string) => readFileSync(`${RAIZ}${rel}`, "utf8");
const migracao = ler("migrations/0032_equipamento_agregado_real.sql");

describe("0032 — o agregado de equipamento", () => {
  it("não abre transação própria: quem transaciona é o runner", () => {
    // `server/migrate.ts` faz BEGIN, roda o arquivo, grava em `_migrations` e só
    // então COMMIT. Um COMMIT dentro do arquivo fecha a transação do runner: o
    // registro no ledger passa a rodar solto e uma falha depois dele deixa a
    // migração aplicada pela metade, sem nada para desfazer.
    expect(migracao).not.toMatch(/^\s*BEGIN\s*;/mi);
    expect(migracao).not.toMatch(/^\s*COMMIT\s*;/mi);
  });

  it("conta 'retido' com a MESMA lista de status do código", () => {
    // Se a migração e `contarEquipamentoRetido` discordarem, a primeira
    // varredura de ERP reescreve tudo com outro número e o susto volta ao
    // contrário — com o Anti-Fraude no meio.
    const storage = ler("server/storage/equipment.storage.ts");
    const daMigracao = [...migracao.matchAll(/'(retirada_pendente|nao_localizado|retido|em_cobranca|not_returned)'/g)]
      .map(m => m[1]);
    const doCodigo = [...storage.matchAll(/'(retirada_pendente|nao_localizado|retido|em_cobranca|not_returned)'/g)]
      .map(m => m[1]);
    expect(new Set(daMigracao)).toEqual(new Set(doCodigo));
    expect(daMigracao).toHaveLength(5);
  });

  it("casa por provider_id junto com customer_id — isolamento multi-tenant", () => {
    // Sem o provider_id no JOIN, um id de cliente repetido entre provedores
    // somaria patrimônio de outro tenant.
    expect(migracao).toMatch(/c\.provider_id\s*=\s*r\.provider_id/);
    expect(migracao).toMatch(/GROUP BY e\.provider_id,\s*e\.customer_id/);
  });

  it("é barata ao reaplicar: só escreve a linha que está diferente", () => {
    expect((migracao.match(/IS DISTINCT FROM/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("o schema acompanha a migração", () => {
  it("os defaults do Drizzle são 0, não mais 1 e 290", () => {
    // Divergência aqui não quebra nada hoje, mas volta na próxima vez que
    // alguém rodar `drizzle-kit push` — e aí o 290 renasce calado.
    const schema = ler("shared/schema.ts");
    expect(schema).toContain('integer("equipment_count").default(0)');
    expect(schema).toMatch(/equipment_estimated_value[^)]*\}\)\.default\("0"\)/);
    expect(schema).not.toContain('integer("equipment_count").default(1)');
  });

  it("o sync continua sem tocar nesses campos — quem escreve é o recálculo", () => {
    const customers = ler("server/storage/customers.storage.ts");
    const equipamento = ler("server/storage/equipment.storage.ts");
    // `upsertFromErp` já reescreveu 1/290 a cada passada; o comentário no código
    // guarda o porquê. Aqui trava-se o fato.
    expect(customers).not.toMatch(/updateFields\.equipmentCount/);
    expect(equipamento).toMatch(/recalculateCustomerEquipmentAggregate/);
  });
});
