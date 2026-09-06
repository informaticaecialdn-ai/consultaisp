/**
 * A COSTURA entre a rota do detalhe e o painel.
 *
 * Em 06/09/2026 duas frentes construíram as duas pontas ao mesmo tempo e
 * combinaram formas diferentes: a rota manda `faturas` e `eventos` dentro de
 * `{ linhas, total, limite }` (porque as duas listas têm teto e a tela precisa
 * dizer quantas ficaram de fora), e o leitor do cliente exigia array puro.
 * Resultado: o painel abria SEMPRE vazio, dizendo "a rota não devolveu" — a
 * mensagem mais enganosa possível, porque a rota tinha devolvido tudo. Os
 * 5.079 testes daquele dia passaram: nenhum cruzava as duas pontas.
 *
 * Este teste usa a forma REAL que a rota monta, extraída do fonte do servidor,
 * para a costura não voltar a arrebentar em silêncio.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lerDetalheDoCaso } from "./tipos";

const rota = readFileSync(new URL("../../../../server/routes/cobranca.routes.ts", import.meta.url), "utf8");

describe("a forma que a rota manda", () => {
  it("faturas e eventos vão com envelope { linhas, total, limite }", () => {
    // Se o servidor mudar de forma, este teste avisa antes de a tela esvaziar.
    const trecho = rota.slice(rota.indexOf("casos/:id/detalhe"), rota.indexOf("casos/:id/detalhe") + 4000);
    expect(trecho).toMatch(/faturas:\s*\{[^}]*linhas/s);
    expect(trecho).toMatch(/eventos:\s*\{[^}]*linhas/s);
  });
});

describe("lerDetalheDoCaso aceita as duas formas", () => {
  const fatura = { id: 1, erpRef: "77", vencimento: "2026-08-25", valor: 129.8, descricao: "Mensalidade", status: "aberta", erpSource: "mk", baixadaEm: null };
  const evento = { id: 9, tipo: "contato", canal: "telefone", resultado: "falou", notas: null, ocorridoEm: "2026-09-01T10:00:00.000Z", autor: "Ana" };

  it("envelope: as linhas chegam ao painel", () => {
    const d = lerDetalheDoCaso({
      caso: { id: 5 },
      faturas: { linhas: [fatura], total: 12, limite: 200 },
      eventos: { linhas: [evento], total: 3, limite: 100 },
      negociacoes: [],
    });
    expect(d.faturas).toHaveLength(1);
    expect(d.faturas![0]).toMatchObject({ vencimento: "2026-08-25", valor: 129.8 });
    expect(d.eventos).toHaveLength(1);
    expect(d.negociacoes).toEqual([]);
  });

  it("array puro continua valendo", () => {
    const d = lerDetalheDoCaso({ caso: { id: 5 }, faturas: [fatura], eventos: [evento] });
    expect(d.faturas).toHaveLength(1);
    expect(d.eventos).toHaveLength(1);
  });

  it("bloco AUSENTE é null; bloco VAZIO é lista vazia — a tela diz coisas diferentes", () => {
    const ausente = lerDetalheDoCaso({ caso: { id: 5 } });
    expect(ausente.faturas).toBeNull();
    expect(ausente.eventos).toBeNull();

    const vazio = lerDetalheDoCaso({ caso: { id: 5 }, faturas: { linhas: [], total: 0, limite: 200 }, eventos: { linhas: [], total: 0, limite: 100 } });
    expect(vazio.faturas).toEqual([]);
    expect(vazio.eventos).toEqual([]);
  });

  it("lixo no lugar da lista não derruba a tela", () => {
    const d = lerDetalheDoCaso({ caso: { id: 5 }, faturas: { total: 3 }, eventos: "nada" });
    expect(d.faturas).toBeNull();
    expect(d.eventos).toBeNull();
  });
});
