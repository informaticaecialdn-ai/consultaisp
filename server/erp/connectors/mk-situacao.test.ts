/**
 * `situacaoParaStatus` — a tradução que faltava.
 *
 * O MK devolve a situação do cliente no próprio payload de
 * `WSMKConsultaClientes` e ninguém a lia. Sem ela, `status` só era escrito para
 * quem aparecia na busca de inadimplentes, e ninguém podia ser REBAIXADO:
 * medido em 28/08/2026 na NsLink, 659 de 870 clientes cortados por
 * inadimplência constavam como ativos no Consulta ISP.
 *
 * O caso que dá nome ao arquivo é o `undefined`: situação que a função não
 * reconhece NÃO pode virar "ativo". Num bureau, promover ex-caloteiro a cliente
 * em dia é o erro mais caro que existe — o provedor instala confiando.
 */
import { describe, it, expect } from "vitest";
import { situacaoParaStatus } from "./mk";

describe("situacaoParaStatus", () => {
  it("\"Ativo\" NAO vira contrato ativo — e o ponto da funcao", () => {
    // Medido em 28/08/2026: dos 754 cadastros "Ativo" do MK da NsLink, 560 nao
    // tem contrato nenhum. "Ativo" descreve o CADASTRO, nao o vinculo. Quem
    // afirma contrato vigente e WSMKContratosPorCliente, e so ele.
    for (const s of ["Ativo", "ATIVO", "ativo", "Ativa", " ativo "]) {
      expect(situacaoParaStatus(s)).toBeUndefined();
    }
  });

  it("reconhece as formas de cancelado", () => {
    for (const s of ["Cancelado", "CANCELADA", "Inativo", "Desativado", "Desabilitado", "Encerrado"]) {
      expect(situacaoParaStatus(s)).toBe("cancelled");
    }
  });

  it("reconhece suspensão e bloqueio", () => {
    expect(situacaoParaStatus("Suspenso")).toBe("suspended");
    expect(situacaoParaStatus("Bloqueado")).toBe("suspended");
  });

  it("situação desconhecida devolve undefined — nunca 'ativo'", () => {
    // O upsert só escreve status quando ele vem. Devolver "active" aqui faria a
    // função promover ex-cliente a adimplente por não entender um rótulo novo.
    expect(situacaoParaStatus("Em análise")).toBeUndefined();
    expect(situacaoParaStatus("Pré-cadastro")).toBeUndefined();
    expect(situacaoParaStatus("qualquer coisa nova")).toBeUndefined();
  });

  it("vazio, nulo e não-texto devolvem undefined", () => {
    expect(situacaoParaStatus("")).toBeUndefined();
    expect(situacaoParaStatus("   ")).toBeUndefined();
    expect(situacaoParaStatus(null)).toBeUndefined();
    expect(situacaoParaStatus(undefined)).toBeUndefined();
    expect(situacaoParaStatus({})).toBeUndefined();
  });

  it("não confunde 'cancelado' com prefixo de outra palavra", () => {
    // "Cancelamento solicitado" ainda é cancelamento; o prefixo cobre.
    expect(situacaoParaStatus("Cancelamento solicitado")).toBe("cancelled");
    // Mas nada que apenas contenha a palavra no meio vira cancelado por acaso.
    expect(situacaoParaStatus("Sem cancelamento previsto")).toBeUndefined();
  });
});
