/**
 * A migração 0042 lida como TEXTO, no molde da 0032: o contrato que, se mudar,
 * quebra em silêncio no próximo boot de uma instância nova.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ler = (rel: string) => readFileSync(`${RAIZ}${rel}`, "utf8");
const migracao = ler("migrations/0042_cobranca_gestao_operacional.sql");

describe("0042 — gestão operacional da cobrança", () => {
  it("não abre transação própria: quem transaciona é o runner", () => {
    // `server/migrate.ts` faz BEGIN, roda o arquivo, grava em `_migrations` e só
    // então COMMIT. Um COMMIT dentro do arquivo fecha a transação do runner: o
    // INSERT em `_migrations` passa a rodar solto e, se ele falhar, o DDL já
    // está gravado sem registro — o próximo boot tenta aplicar de novo. Era a
    // única das 42 assim, e ainda não tinha sido aplicada em lugar nenhum.
    expect(migracao).not.toMatch(/^\s*BEGIN\s*;/mi);
    expect(migracao).not.toMatch(/^\s*COMMIT\s*;/mi);
  });

  it("cria as três tabelas do lote, todas presas ao provedor", () => {
    for (const tabela of ["cobranca_gestao_config", "cobranca_contestacoes", "cobranca_contatos_orcamento"]) {
      const bloco = migracao.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela} \\(([\\s\\S]*?)\\);`, "i"))?.[1];
      expect(bloco, tabela).toBeDefined();
      expect(bloco, tabela).toMatch(/provider_id integer( NOT NULL)? (PRIMARY KEY )?REFERENCES providers\(id\)/);
    }
  });
});
