import { describe, expect, it } from "vitest";
import { cpfFicticio, pessoaFicticia, CIDADES_DA_DEMO } from "./pessoas-ficticias";
import { validarCpfCnpj } from "../utils/cpf-cnpj-validator";
import { CPFS_COMPARTILHADOS } from "./mundo-base";

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

  it("indices diferentes nao repetem CPF dentro do mesmo periodo (0..19.999)", () => {
    const cpfs = new Set(Array.from({ length: 20_000 }, (_, i) => cpfFicticio(i)));
    expect(cpfs.size).toBe(20_000);
  });

  it("999.998 (ultimo indice do primeiro periodo) tambem nasce valido e distinto de 999.999", () => {
    const a = cpfFicticio(999_998);
    const b = cpfFicticio(999_999);
    expect(a, "999998").toMatch(/^999\d{8}$/);
    expect(validarCpfCnpj(a).valid, "999998").toBe(true);
    expect(b, "999999").toMatch(/^999\d{8}$/);
    expect(validarCpfCnpj(b).valid, "999999").toBe(true);
    expect(a).not.toBe(b);
  });

  it("periodo de 999.999 e documentado, nao um bug: o indice 999.999 reinicia o ciclo e repete o CPF do indice 0", () => {
    // Fix round 2: as duas rodadas anteriores tentaram EVITAR essa repeticao
    // desviando o unico resto proibido (999999, que geraria CPF com os 11
    // digitos iguais) para um valor fixo escolhido a dedo — primeiro "999998"
    // (colidiu, virou bug), depois "500.000" (colidiu com BASE_ARESTA de
    // server/demo/mundo-base.ts, virou bug de novo). Com modulo 999.999 nao ha
    // mais valor proibido para desviar: o indice 999.999 simplesmente cai no
    // mesmo resto do indice 0 (999999 % 999999 === 0), por construcao. E a
    // UNICA repeticao que existe no gerador inteiro, e e exatamente o que
    // "periodo" quer dizer — nao uma colisao escondida.
    expect(cpfFicticio(999_999)).toBe(cpfFicticio(0));
    expect(cpfFicticio(5 + 999_999)).toBe(cpfFicticio(5));
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

  describe("invariante cruzado com o mundo base (fix round 2)", () => {
    // server/demo/mundo-base.ts so exporta PROVEDORES_DA_DEMO, CPFS_COMPARTILHADOS,
    // cnpjFicticio e semearMundoBase — BASE_UNICO, PASSO_UNICO e
    // CLIENTES_POR_PROVEDOR sao privados do modulo, e esta rodada de fix so pode
    // tocar pessoas-ficticias.ts, este teste e o relatorio (nao mundo-base.ts).
    // Reproduzidos aqui a partir de mundo-base.ts linhas 47 e 87-88 em vez de
    // exportar de la. Se mundo-base.ts mudar esses numeros, este teste fica
    // desatualizado silenciosamente — e um risco aceito, registrado no relatorio.
    const BASE_UNICO = 0;
    const PASSO_UNICO = 10_000;
    const QUANTIDADE_DE_PROVEDORES = 5; // PROVEDORES_DA_DEMO.length
    const CLIENTES_POR_PROVEDOR = 1500; // teto do cursor unico por provedor (uso real medido: 1350)

    function indicesUnicosReproduzidos(): number[] {
      const indices: number[] = [];
      for (let provedor = 0; provedor < QUANTIDADE_DE_PROVEDORES; provedor++) {
        for (let cursor = 0; cursor < CLIENTES_POR_PROVEDOR; cursor++) {
          indices.push(BASE_UNICO + provedor * PASSO_UNICO + cursor);
        }
      }
      return indices;
    }

    it("os CPFs que o semeador realmente usa (faixa unica de cada provedor + compartilhados) nao se repetem entre si", () => {
      const cpfsUnicos = indicesUnicosReproduzidos().map(cpfFicticio);
      const todosOsCpfs = [...cpfsUnicos, ...CPFS_COMPARTILHADOS];
      expect(new Set(todosOsCpfs).size).toBe(todosOsCpfs.length);
    });

    it("cpfFicticio(999_999) nao e igual a CPFS_COMPARTILHADOS[0] — a colisao que esta rodada corrigiu", () => {
      // Antes deste fix, 500_000 (o substituto do valor proibido) era
      // exatamente BASE_ARESTA em mundo-base.ts, entao cpfFicticio(999_999)
      // saia igual a CPFS_COMPARTILHADOS[0] (== cpfFicticio(500_000)).
      expect(cpfFicticio(999_999)).not.toBe(CPFS_COMPARTILHADOS[0]);
    });
  });
});
