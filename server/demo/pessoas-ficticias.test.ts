import { describe, expect, it } from "vitest";
import { cpfFicticio, pessoaFicticia, CIDADES_DA_DEMO } from "./pessoas-ficticias";
import { validarCpfCnpj } from "../utils/cpf-cnpj-validator";

describe("pessoas ficticias", () => {
  it("todo CPF tem digito valido e nasce na faixa 999 (nao emitida)", () => {
    // 20.000 — a ordem de grandeza real de uso (5 provedores x 1.500 clientes
    // + sandboxes de visitante), nao os 500 do brief original.
    for (let i = 0; i < 20_000; i++) {
      const cpf = cpfFicticio(i);
      expect(cpf, `i=${i}`).toMatch(/^999\d{8}$/);
      // O brief assumia `.valido`; o validador real devolve `.valid` — ver
      // server/utils/cpf-cnpj-validator.ts (validarCpfCnpj), conferido antes
      // de escrever este teste.
      expect(validarCpfCnpj(cpf).valid, `i=${i}`).toBe(true);
    }
  });

  it("o mesmo indice devolve sempre a mesma pessoa", () => {
    expect(pessoaFicticia(7)).toEqual(pessoaFicticia(7));
  });

  it("indices diferentes nao repetem CPF — inclusive 999.998 e 999.999, o par que colidia antes do fix", () => {
    // Fix round 1: a primeira versao desviava o unico indice que geraria CPF
    // com os 11 digitos iguais (999999) para o valor de outro indice natural
    // (999998), colidindo os dois em silencio. Os dois entram explicitamente
    // aqui, alem do bloco de 20.000, para a regressao nunca mais passar batido.
    const indices = [...Array.from({ length: 20_000 }, (_, i) => i), 999_998, 999_999];
    const cpfs = new Set(indices.map((i) => cpfFicticio(i)));
    expect(cpfs.size).toBe(indices.length);
  });

  it("999.998 e 999.999 tambem nascem com CPF valido, nao so distinto um do outro", () => {
    for (const i of [999_998, 999_999]) {
      const cpf = cpfFicticio(i);
      expect(cpf, `i=${i}`).toMatch(/^999\d{8}$/);
      expect(validarCpfCnpj(cpf).valid, `i=${i}`).toBe(true);
    }
  });

  it("so as quatro cidades do mapa, com UF PR", () => {
    expect(CIDADES_DA_DEMO.map((c) => c.nome)).toEqual(["Londrina", "Ibiporã", "Cambé", "Apucarana"]);
    for (const c of CIDADES_DA_DEMO) expect(c.uf).toBe("PR");
    for (let i = 0; i < 50; i++) {
      expect(CIDADES_DA_DEMO.some((c) => c.nome === pessoaFicticia(i).cidade)).toBe(true);
    }
  });

  // Alem do brief: uma tarefa futura grava latitude/longitude direto em
  // `customers` a partir da pessoa ficticia, sem geocodificacao sob demanda
  // (o mapa de calor le a coluna direto). Ver a nota de contexto desta tarefa.
  it("toda pessoa nasce com coordenada dentro da propria cidade", () => {
    for (let i = 0; i < 50; i++) {
      const pessoa = pessoaFicticia(i);
      const cidade = CIDADES_DA_DEMO.find((c) => c.nome === pessoa.cidade)!;
      expect(Math.abs(Number(pessoa.latitude) - cidade.latitude), `i=${i}`).toBeLessThan(0.1);
      expect(Math.abs(Number(pessoa.longitude) - cidade.longitude), `i=${i}`).toBeLessThan(0.1);
    }
  });

  it("indices diferentes tendem a pessoas diferentes (nomes nao cravados no indice 1:1)", () => {
    const nomes = new Set(Array.from({ length: 50 }, (_, i) => pessoaFicticia(i).nome));
    expect(nomes.size).toBeGreaterThan(1);
  });
});
