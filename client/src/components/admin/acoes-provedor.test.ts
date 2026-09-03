import { describe, expect, it } from "vitest";
import {
  ACOES_PROVEDOR,
  acaoExcluirProvedor,
  acaoReativarProvedor,
  acaoSuspenderProvedor,
} from "./acoes-provedor";

const NOME = "NSLink";

describe("suspender", () => {
  // O defeito era exatamente este: o controle brando disparava o DELETE em
  // cascata. Suspender nao pode, em hipotese nenhuma, apagar linha.
  it("nunca usa DELETE", () => {
    expect(acaoSuspenderProvedor(7, NOME).metodo).toBe("PATCH");
  });

  it("so muda o status para suspended", () => {
    const acao = acaoSuspenderProvedor(7, NOME);
    expect(acao.caminho).toBe("/api/admin/providers/7");
    expect(acao.corpo).toEqual({ status: "suspended" });
  });

  it("a confirmacao promete que nada e apagado e que da para voltar", () => {
    const texto = acaoSuspenderProvedor(7, NOME).confirmacao!;
    expect(texto).toContain(NOME);
    expect(texto).toMatch(/reativar/i);
    expect(texto).toMatch(/nenhum dado/i);
  });

  it("o toast fala de suspensao, nao de exclusao", () => {
    expect(acaoSuspenderProvedor(7, NOME).sucesso).toMatch(/suspens/i);
    expect(acaoSuspenderProvedor(7, NOME).sucesso).not.toMatch(/exclu|remov|apagad/i);
  });
});

describe("reativar", () => {
  it("devolve o status active e nao pede confirmacao", () => {
    const acao = acaoReativarProvedor(7, NOME);
    expect(acao.metodo).toBe("PATCH");
    expect(acao.corpo).toEqual({ status: "active" });
    expect(acao.confirmacao).toBeNull();
  });
});

describe("excluir", () => {
  it("e o unico DELETE, e assume ser definitivo", () => {
    const acao = acaoExcluirProvedor(7, NOME);
    expect(acao.metodo).toBe("DELETE");
    expect(acao.corpo).toBeUndefined();
    expect(acao.reversivel).toBe(false);
  });

  // A confirmacao antiga do botao de lista dizia so "Desativar NSLink?" —
  // nem o nome do que seria destruido aparecia.
  it("a confirmacao lista o que some e avisa que nao da para desfazer", () => {
    const texto = acaoExcluirProvedor(7, NOME).confirmacao!;
    expect(texto).toContain(NOME);
    expect(texto).toMatch(/nao pode ser desfeita/i);
    for (const dado of ["usuarios", "clientes", "consultas", "faturas", "equipamentos"]) {
      expect(texto).toContain(dado);
    }
  });

  it("o toast nao chama exclusao de desativacao", () => {
    expect(acaoExcluirProvedor(7, NOME).sucesso).not.toMatch(/desativad|suspens/i);
  });
});

describe("o rotulo bate com o verbo", () => {
  it("acao reversivel nunca e DELETE; DELETE sempre pede confirmacao", () => {
    for (const criar of ACOES_PROVEDOR) {
      const acao = criar(7, NOME);
      if (acao.reversivel) expect(acao.metodo).not.toBe("DELETE");
      if (acao.metodo === "DELETE") {
        expect(acao.reversivel).toBe(false);
        expect(acao.confirmacao).toBeTruthy();
      }
    }
  });

  it("toda acao irreversivel avisa que e irreversivel", () => {
    for (const criar of ACOES_PROVEDOR) {
      const acao = criar(7, NOME);
      if (!acao.reversivel) expect(acao.confirmacao).toMatch(/nao pode ser desfeita|permanentemente/i);
    }
  });
});
