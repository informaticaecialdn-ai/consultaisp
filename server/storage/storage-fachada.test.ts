/**
 * A fachada `DatabaseStorage` precisa expor TODO método público dos storages
 * que ela compõe.
 *
 * Por que este teste existe, com data e número: em 06/09/2026 a régua diária
 * de cobrança fechou a passada em produção com **7.041 erros** e **zero DNA
 * atualizado**, com a mesma linha repetida a cada caso —
 * `atualizarDnaDoCaso is not a function`. Os métodos `cancelarCaso`,
 * `atualizarDnaDoCaso`, `obterNegociacao` e `obterParcela` existiam em
 * `CobrancaStorage`, eram chamados por `storage.` no serviço, e simplesmente
 * nunca tinham sido delegados aqui. A fachada não é um proxy dinâmico: o que
 * não está escrito nela é `undefined` em runtime, e o TypeScript não acusa
 * porque o serviço fala com a interface, não com a classe.
 *
 * O sintoma na tela era "quadrante DNA nulo", anotado como pendência de
 * produto por dias — não era pendência, era este buraco.
 *
 * A comparação é feita sobre o PROTÓTIPO (métodos) e sobre as propriedades de
 * instância (as delegações são arrow functions atribuídas no construtor).
 */
import { describe, expect, it } from "vitest";
import { CobrancaStorage } from "./cobranca.storage";
import { FaturasStorage } from "./faturas.storage";

/** Nomes públicos de uma classe: protótipo + o que a instância cria. */
function metodosPublicos(alvo: object): string[] {
  const nomes = new Set<string>();
  for (const n of Object.getOwnPropertyNames(Object.getPrototypeOf(alvo))) nomes.add(n);
  for (const n of Object.getOwnPropertyNames(alvo)) nomes.add(n);
  return [...nomes].filter(n => n !== "constructor" && !n.startsWith("_") && typeof (alvo as Record<string, unknown>)[n] === "function").sort();
}

/**
 * A fachada é lida do FONTE, não instanciada: `new DatabaseStorage()` abriria
 * conexão com o banco, e este teste roda sem banco. Uma delegação tem sempre
 * a forma `nome = (…) => this._x.nome(…)` ou `nome(…) { … }`.
 */
import { readFileSync } from "node:fs";
const fonteDaFachada = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

function delegadoNaFachada(nome: string): boolean {
  return new RegExp(`(^|\\s)${nome}\\s*[=(]`, "m").test(fonteDaFachada);
}

describe("a fachada expõe todo método do storage de cobrança", () => {
  const cobranca = metodosPublicos(Object.create(CobrancaStorage.prototype));

  it("tem métodos para conferir (guarda contra o teste virar vazio)", () => {
    expect(cobranca.length).toBeGreaterThan(20);
  });

  it.each(cobranca)("%s está delegado em DatabaseStorage", (nome) => {
    expect(delegadoNaFachada(nome), `${nome} existe em CobrancaStorage e não está na fachada: em runtime seria undefined`).toBe(true);
  });

  it("os quatro do incidente de 06/09/2026 estão lá", () => {
    for (const nome of ["cancelarCaso", "atualizarDnaDoCaso", "obterNegociacao", "obterParcela"]) {
      expect(delegadoNaFachada(nome), nome).toBe(true);
    }
  });
});

describe("a fachada expõe todo método do storage de faturas", () => {
  const faturas = metodosPublicos(Object.create(FaturasStorage.prototype));

  it("tem métodos para conferir", () => {
    expect(faturas.length).toBeGreaterThan(3);
  });

  it.each(faturas)("%s está delegado em DatabaseStorage", (nome) => {
    expect(delegadoNaFachada(nome), `${nome} existe em FaturasStorage e não está na fachada`).toBe(true);
  });
});
