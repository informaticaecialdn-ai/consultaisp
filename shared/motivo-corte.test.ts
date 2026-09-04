/**
 * A normalizacao do motivo do corte, com os valores REAIS que o SGP da
 * Amplinet devolve — nao com exemplos inventados.
 *
 * A distribuicao medida em 04/09/2026, em 939 contratos:
 *   Suspenso · Financeiro 225 · Cancelado · Administrativo 214 ·
 *   Ativo · Financeiro 76 · Cancelado · Financeiro 65 ·
 *   Suspenso · Administrativo 31 · Cancelado · "Financeiro - SPC" 1 ·
 *   e 260 contratos com o campo VAZIO.
 */
import { describe, it, expect } from "vitest";
import { normalizarMotivoCorte, corteFinanceiro, MOTIVO_CORTE_ROTULO } from "./motivo-corte";

describe("normalizarMotivoCorte", () => {
  it("reconhece os valores que o SGP realmente devolve", () => {
    expect(normalizarMotivoCorte("Financeiro")).toBe("financeiro");
    expect(normalizarMotivoCorte("Administrativo")).toBe("administrativo");
    // Este ninguem tinha previsto, e apareceu em producao no primeiro provedor.
    expect(normalizarMotivoCorte("Financeiro - SPC")).toBe("financeiro");
  });

  it("nao depende de caixa, acento nem espaco em volta", () => {
    // O provedor digita o motivo a mao na tela do ERP.
    expect(normalizarMotivoCorte("  FINANCEIRO  ")).toBe("financeiro");
    expect(normalizarMotivoCorte("financeiro")).toBe("financeiro");
    expect(normalizarMotivoCorte("Administrativó")).toBe("administrativo");
  });

  it("casa por PREFIXO da familia, e nao pela palavra em qualquer posicao", () => {
    // "Administrativo - erro do financeiro" e administrativo. Procurar a
    // palavra "financeiro" em qualquer lugar acusaria de calote quem so teve um
    // erro de cadastro corrigido.
    expect(normalizarMotivoCorte("Administrativo - erro do financeiro")).toBe("administrativo");
    expect(normalizarMotivoCorte("Financeiro/Cobranca")).toBe("financeiro");
  });

  it("motivo desconhecido devolve null — e null NAO e administrativo", () => {
    /**
     * A regra que protege os dois lados: chutar para o benigno esconde
     * inadimplencia real do bureau, que e o produto inteiro; chutar para o
     * maligno acusa de calote quem so pediu para sair. Ausencia de informacao
     * nao vira dado.
     */
    expect(normalizarMotivoCorte("Mudanca de endereco")).toBeNull();
    expect(normalizarMotivoCorte("Insatisfacao com o servico")).toBeNull();
    expect(normalizarMotivoCorte("Tecnico")).toBeNull();
    // 260 dos 939 contratos medidos vem com o campo vazio.
    expect(normalizarMotivoCorte("")).toBeNull();
    expect(normalizarMotivoCorte("   ")).toBeNull();
    expect(normalizarMotivoCorte(null)).toBeNull();
    expect(normalizarMotivoCorte(undefined)).toBeNull();
  });
});

describe("corteFinanceiro", () => {
  it("so e verdadeiro com prova, nunca por exclusao", () => {
    // A comparacao ingenua `motivo !== "administrativo"` transformaria todo
    // motivo novo de ERP — e todo campo vazio — em acusacao de calote.
    expect(corteFinanceiro("Financeiro")).toBe(true);
    expect(corteFinanceiro("Financeiro - SPC")).toBe(true);
    expect(corteFinanceiro("Administrativo")).toBe(false);
    expect(corteFinanceiro("Mudanca de endereco")).toBe(false);
    expect(corteFinanceiro(null)).toBe(false);
    expect(corteFinanceiro("")).toBe(false);
  });
});

describe("MOTIVO_CORTE_ROTULO", () => {
  it("tem uma frase para cada familia, em portugues e sem jargao", () => {
    // O rotulo vai para a tela de um operador decidindo instalacao, nao para
    // um relatorio interno.
    expect(MOTIVO_CORTE_ROTULO.financeiro).toMatch(/pagamento/i);
    expect(MOTIVO_CORTE_ROTULO.administrativo).toMatch(/cliente/i);
    for (const rotulo of Object.values(MOTIVO_CORTE_ROTULO)) {
      expect(rotulo).toBe(rotulo.toLowerCase());   // substantivo minusculo, secao 8 do design
    }
  });
});
