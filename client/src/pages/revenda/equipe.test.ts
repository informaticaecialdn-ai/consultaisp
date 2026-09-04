/**
 * As duas remoções proibidas na Equipe do revendedor.
 *
 * O servidor recusa as duas de qualquer forma — isto aqui é o que evita que o
 * operador descubra a regra por um toast de erro depois do clique.
 */
import { describe, it, expect } from "vitest";
import { motivoParaNaoRemover, problemasDoConvite, dataDeEntrada } from "./equipe";

describe("motivoParaNaoRemover", () => {
  it("com equipe de duas pessoas ou mais, remover outra pessoa é permitido", () => {
    expect(motivoParaNaoRemover({ alvoId: 9, meuId: 3, totalDaEquipe: 2 })).toBeNull();
  });

  it("ninguém remove a própria conta", () => {
    const motivo = motivoParaNaoRemover({ alvoId: 3, meuId: 3, totalDaEquipe: 4 });
    expect(motivo).toContain("própria conta");
  });

  it("a última pessoa nunca sai: marca sem usuário revendedor é marca sem dono", () => {
    /* Sem ninguém, o login pelo domínio próprio deixa de aceitar qualquer
       pessoa e só o superadmin consegue recriar a primeira conta. */
    const motivo = motivoParaNaoRemover({ alvoId: 9, meuId: 3, totalDaEquipe: 1 });
    expect(motivo).toContain("única pessoa");
  });

  it("sozinho na equipe, a frase é a que diz o que fazer — não a que repete que você é você", () => {
    const motivo = motivoParaNaoRemover({ alvoId: 3, meuId: 3, totalDaEquipe: 1 });
    expect(motivo).toContain("Adicione outra");
    expect(motivo).not.toContain("própria conta");
  });

  it("sem saber quem sou eu, só a regra da última pessoa continua valendo", () => {
    /* `meuId` nulo acontece enquanto o `/api/auth/me` não respondeu. Chutar que
       a linha é minha esconderia um botão legítimo. */
    expect(motivoParaNaoRemover({ alvoId: 3, meuId: null, totalDaEquipe: 3 })).toBeNull();
    expect(motivoParaNaoRemover({ alvoId: 3, meuId: null, totalDaEquipe: 1 })).toContain("única pessoa");
  });
});

describe("problemasDoConvite", () => {
  it("nome e e-mail válidos passam", () => {
    expect(problemasDoConvite({ nome: "Ana Prado", email: "ana@crednet.com.br" })).toEqual({});
  });

  it("só espaço em branco no nome não é nome", () => {
    expect(problemasDoConvite({ nome: "   ", email: "ana@crednet.com.br" })).toHaveProperty("nome");
  });

  it("e-mail vazio e e-mail sem domínio são recusados antes da viagem", () => {
    expect(problemasDoConvite({ nome: "Ana", email: "" })).toHaveProperty("email");
    expect(problemasDoConvite({ nome: "Ana", email: "ana@crednet" })).toHaveProperty("email");
  });
});

describe("dataDeEntrada", () => {
  it("data ausente ou ilegível vira travessão", () => {
    expect(dataDeEntrada(null)).toBe("—");
    expect(dataDeEntrada("nao e data")).toBe("—");
  });

  it("formata em pt-BR", () => {
    expect(dataDeEntrada("2026-09-03T14:32:00.000Z")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});
