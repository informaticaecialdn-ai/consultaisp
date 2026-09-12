import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { spcSimulado, cadastralSimulado } from "./bureaus-simulados";
import { consultarSpc } from "../services/spc/spc.service";
import { consultarCpf, type Credencial } from "../services/bigdata.service";
import { pessoaFicticia, cpfFicticio } from "./pessoas-ficticias";

describe("bureaus simulados", () => {
  it("o mesmo documento devolve sempre o mesmo resultado", () => {
    expect(spcSimulado("99912345607")).toEqual(spcSimulado("99912345607"));
    expect(cadastralSimulado("99912345607")).toEqual(cadastralSimulado("99912345607"));
  });

  it("documentos diferentes produzem situacoes diferentes", () => {
    const varios = ["99900000019", "99911111150", "99922222291", "99933333332"].map(spcSimulado);
    expect(new Set(varios.map(r => r.restricao)).size).toBeGreaterThan(1);
    expect(new Set(varios.map(r => r.score)).size).toBeGreaterThan(1);
  });

  it("todo resultado vem marcado como simulado — a tela precisa poder avisar", () => {
    expect(spcSimulado("99912345607").simulado).toBe(true);
    expect(cadastralSimulado("99912345607").simulado).toBe(true);
  });

  it("score fica na faixa do produto (0 a 1000)", () => {
    for (let i = 0; i < 50; i++) {
      const r = spcSimulado(`999${String(i).padStart(8, "0")}`);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1000);
    }
  });

  it("nenhum documento com cobranca ativa e execucao sai com score de risco alto (cadastral)", () => {
    // Regressao do achado 2 da rodada de revisao: risco.score/nivel saiam de
    // um hash independente de emCobrancaAgora/temExecucao/dividaAtiva, e uma
    // fatia media (13,7% em 2.000 documentos, achado do revisor e confirmado
    // por medicao propria antes do conserto) mostrava score de risco baixo
    // (>=850, nivel A) ao lado de divida em cobranca com execucao judicial —
    // a pior contradicao possivel numa ferramenta de venda. Medindo, nao
    // afirmando: roda a amostra e conta, nao so confia que o fix bastou.
    const N = 2000;
    let comCobrancaExecucaoEDivida = 0;
    const contraditorios: string[] = [];

    for (let i = 0; i < N; i++) {
      const doc = `999${String(i).padStart(8, "0")}`;
      const r = cadastralSimulado(doc);
      const casoDeInteresse = r.dados.emCobrancaAgora === true && r.dados.temExecucao === true && (r.dados.dividaAtiva ?? 0) >= 2000;
      if (casoDeInteresse) {
        comCobrancaExecucaoEDivida++;
        if ((r.risco.score ?? 0) >= 850) {
          contraditorios.push(`${doc} -> score ${r.risco.score}, nivel ${r.risco.nivel}`);
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[achado 2] amostra=${N} comCobrancaExecucaoEDivida=${comCobrancaExecucaoEDivida} ` +
      `contraditorios=${contraditorios.length}`,
    );
    expect(comCobrancaExecucaoEDivida).toBeGreaterThan(0); // a amostra precisa cobrir o caso de interesse
    expect(contraditorios, contraditorios.join("; ")).toHaveLength(0);
  });

  describe("relogio real: frescor no carimbo, determinismo no conteudo", () => {
    // Regressao do ruling das datas: a demonstracao tem que mostrar o dia
    // REAL de hoje (frescor), sem deixar de contar sempre a MESMA historia
    // para o mesmo documento (determinismo). O teste de determinismo que ja
    // existe ("o mesmo documento devolve sempre o mesmo resultado") passa por
    // ACIDENTE de granularidade — as duas chamadas caem no mesmo dia UTC,
    // entao ficaria verde mesmo se alguem devolvesse um ancora fixo. Este
    // teste prende as duas propriedades SEPARADAMENTE, travando o relogio em
    // dois dias DIFERENTES (7 dias de distancia).
    afterEach(() => {
      vi.useRealTimers();
    });

    it("consultadoEm e as datas internas deslocam com 'hoje'; score/nivel/situacao/valores nao mudam", () => {
      const doc = "99912345607";
      const DIA_MS = 86_400_000;

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-10T12:00:00.000Z"));
      const spcDia1 = spcSimulado(doc);
      const bdcDia1 = cadastralSimulado(doc);

      vi.setSystemTime(new Date("2026-01-17T12:00:00.000Z")); // +7 dias exatos
      const spcDia2 = spcSimulado(doc);
      const bdcDia2 = cadastralSimulado(doc);

      // ── Frescor: o carimbo da consulta É o "hoje" mockado em cada execução.
      expect(spcDia1.consultadoEm).toBe("2026-01-10");
      expect(spcDia2.consultadoEm).toBe("2026-01-17");

      // ── Frescor: datas internas do histórico deslocam os MESMOS 7 dias.
      expect(spcDia1.cadastralData.dataNascimento).toBeTruthy();
      const deslocamentoNascimento =
        (new Date(spcDia2.cadastralData.dataNascimento!).getTime() -
          new Date(spcDia1.cadastralData.dataNascimento!).getTime()) / DIA_MS;
      expect(deslocamentoNascimento).toBe(7);

      expect(bdcDia1.identidade.dataSituacao).toBeTruthy();
      const deslocamentoDataSituacao =
        (new Date(bdcDia2.identidade.dataSituacao!).getTime() -
          new Date(bdcDia1.identidade.dataSituacao!).getTime()) / DIA_MS;
      expect(deslocamentoDataSituacao).toBe(7);

      // ── Determinismo de conteúdo: mesmo documento, mesma história — só a
      // data-calendário muda. Cobre exatamente o que a re-revisão confirmou
      // por execução (score, nível, emCobrancaAgora, dividaAtiva).
      expect(spcDia2.score).toBe(spcDia1.score);
      expect(spcDia2.restricao).toBe(spcDia1.restricao);
      expect(spcDia2.status).toBe(spcDia1.status);
      expect(spcDia2.restrictions.map(r => [r.type, r.value, r.severity, r.creditor])).toEqual(
        spcDia1.restrictions.map(r => [r.type, r.value, r.severity, r.creditor]),
      );

      expect(bdcDia2.risco.score).toBe(bdcDia1.risco.score);
      expect(bdcDia2.risco.nivel).toBe(bdcDia1.risco.nivel);
      expect(bdcDia2.dados.emCobrancaAgora).toBe(bdcDia1.dados.emCobrancaAgora);
      expect(bdcDia2.dados.temExecucao).toBe(bdcDia1.dados.temExecucao);
      expect(bdcDia2.dados.dividaAtiva).toBe(bdcDia1.dados.dividaAtiva);
    });
  });

  describe("modo demo desvia as duas entradas reais antes de qualquer rede", () => {
    const original = process.env.DEMO_MODE;
    beforeEach(() => {
      process.env.DEMO_MODE = "true";
      vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
      if (original === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = original;
      vi.unstubAllGlobals();
    });

    it("consultarSpc nunca chama fetch em modo demo", async () => {
      const resultado = await consultarSpc("99912345607");
      expect(resultado.simulado).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("consultarCpf nunca chama fetch em modo demo", async () => {
      const cred: Credencial = { login: "x", password: "y" };
      const resultado = await consultarCpf(1, cred, "99912345607");
      expect(resultado.simulado).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  /**
   * Item 4 do plano de 2026-09-11: antes desta correção, nome/endereço/telefone
   * vinham SEMPRE de um hash do documento, independente de
   * `server/demo/pessoas-ficticias.ts` — a mesma fonte que
   * `server/demo/mundo-base.ts`/`sandbox.service.ts` usam para os clientes que
   * a Consulta ISP mostra. Medido: `99950400007` saía "Rosana Cardoso Andrade,
   * Apucarana" na Consulta ISP e "Carlos Costa Souza, Cambé" no SPC — duas
   * pessoas para o MESMO documento, em duas telas do mesmo produto.
   */
  describe("identidade coerente com o mundo ficticio (item 4)", () => {
    it("um CPF do mundo ficticio devolve, nos dois bureaus, a MESMA identidade que pessoaFicticia usaria para o mesmo indice", () => {
      const indice = 12345; // um indice qualquer — nao precisa ser um dos reservados
      const cpf = cpfFicticio(indice);
      const doMundo = pessoaFicticia(indice);

      const spc = spcSimulado(cpf);
      const cadastral = cadastralSimulado(cpf);

      expect(spc.cadastralData.nome).toBe(doMundo.nome);
      expect(spc.cadastralData.cidade).toBe(doMundo.cidade);
      expect(cadastral.identidade.nome).toBe(doMundo.nome);
      expect(cadastral.enderecos[0]).toMatchObject({
        logradouro: doMundo.logradouro,
        numero: doMundo.numero,
        bairro: doMundo.bairro,
        cidade: doMundo.cidade,
        uf: doMundo.uf,
        cep: doMundo.cep,
      });
      expect(cadastral.telefones[0].ddd).toBe("43");
      expect(cadastral.telefones[0].numero).toBe(doMundo.telefone.replace(/^\(\d{2}\)\s*/, "").replace("-", ""));
    });

    it("o CPF exato medido na revisao (99950400007) para de contradizer entre os bureaus", () => {
      const cpf = "99950400007";
      const doMundo = pessoaFicticia(504000); // INDICE_MIGRADOR_DE_EXEMPLO, server/demo/mundo-base.ts
      expect(spcSimulado(cpf).cadastralData.nome).toBe(doMundo.nome);
      expect(cadastralSimulado(cpf).identidade.nome).toBe(doMundo.nome);
    });

    it("um documento FORA do mundo ficticio continua determinístico por hash — nada quebra sem pessoaFicticia para consultar", () => {
      const cpf = "12345678900"; // nunca produzido por cpfFicticio (nao tem o nucleo "999" valido)
      expect(spcSimulado(cpf)).toEqual(spcSimulado(cpf));
      expect(cadastralSimulado(cpf)).toEqual(cadastralSimulado(cpf));
    });

    it("mae, pai, genero, nascimento e idade continuam vindo do hash — pessoaFicticia nao os rastreia", () => {
      const indice = 777;
      const cpf = cpfFicticio(indice);
      const cadastral = cadastralSimulado(cpf);
      // Nao ha "esperado" para comparar (pessoaFicticia nao tem estes campos);
      // o teste so prova que eles continuam presentes e nao viram undefined.
      expect(cadastral.identidade.nomeMae).toBeTruthy();
      expect(cadastral.identidade.nomePai).toBeTruthy();
      expect(["M", "F"]).toContain(cadastral.identidade.genero);
      expect(cadastral.identidade.nascimento).toBeTruthy();
    });
  });
});
