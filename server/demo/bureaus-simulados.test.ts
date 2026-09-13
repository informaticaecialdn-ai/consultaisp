import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { spcSimulado, cadastralSimulado } from "./bureaus-simulados";
import { consultarSpc } from "../services/spc/spc.service";
import { consultarCpf, type Credencial } from "../services/bigdata.service";
import { pessoaFicticia, cpfFicticio } from "./pessoas-ficticias";

/** Um instante fixo: `consultadoEm` carrega hora, e duas chamadas seguidas no relógio real diferem em milissegundos. */
const QUANDO = new Date("2026-09-10T15:00:00.000Z");

describe("bureaus simulados", () => {
  it("o mesmo documento devolve sempre o mesmo resultado", () => {
    expect(spcSimulado("99912345607", QUANDO)).toEqual(spcSimulado("99912345607", QUANDO));
    expect(cadastralSimulado("99912345607", QUANDO)).toEqual(cadastralSimulado("99912345607", QUANDO));
  });

  it("documentos diferentes produzem situacoes diferentes", () => {
    const varios = ["99900000019", "99911111150", "99922222291", "99933333332"].map(doc => spcSimulado(doc));
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

      // ── Frescor: o carimbo da consulta É o instante mockado em cada execução
      // — com hora, como o SPC real devolve (ver o bloco "consultadoEm" abaixo).
      expect(spcDia1.consultadoEm).toBe("2026-01-10T12:00:00.000Z");
      expect(spcDia2.consultadoEm).toBe("2026-01-17T12:00:00.000Z");

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
      expect(spcSimulado(cpf, QUANDO)).toEqual(spcSimulado(cpf, QUANDO));
      expect(cadastralSimulado(cpf, QUANDO)).toEqual(cadastralSimulado(cpf, QUANDO));
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

  /**
   * Rodada 2 da auditoria de telas (13/09/2026): a cadastral simulada dizia
   * "Sobra por mês 5 A 10 SM" ao lado de "renda ATÉ 1 SM" — sobra e despesa
   * eram sorteadas da lista de faixas, cada uma com o próprio sal, sem olhar a
   * renda. E a ocupação contradizia os próprios dados: `dados.trocasEmprego10Anos`
   * e `ocupacao.trocas10Anos` saíam de hashes diferentes, quando no serviço real
   * (bigdata.service.ts) um é cópia do outro.
   */
  describe("capacidade e ocupação coerentes com a renda e com os dados", () => {
    const FAIXAS = ["ATÉ 1 SM", "1 A 2 SM", "2 A 3 SM", "3 A 5 SM", "5 A 10 SM"];
    const PISO_SM = [0, 1, 2, 3, 5];
    const TETO_SM = [1, 2, 3, 5, 10];
    const documentos = Array.from({ length: 200 }, (_, i) => cpfFicticio(510_000 + i));

    it("em 200 CPFs: despesa nunca acima da renda, sobra abaixo dela, e as duas juntas cabem no teto da renda", () => {
      const contraditorios: string[] = [];
      for (const doc of documentos) {
        const { capacidade, renda } = cadastralSimulado(doc);
        const r = FAIXAS.indexOf(renda.faixa!);
        const s = FAIXAS.indexOf(capacidade.sobraMensal!);
        const d = FAIXAS.indexOf(capacidade.despesaMensal!);
        expect([r, s, d], doc).not.toContain(-1);
        const sobraAbaixo = s < r || r === 0; // abaixo de "ATÉ 1 SM" não há faixa
        if (d > r || !sobraAbaixo || PISO_SM[s] + PISO_SM[d] > TETO_SM[r]) {
          contraditorios.push(`${doc}: renda ${renda.faixa}, despesa ${capacidade.despesaMensal}, sobra ${capacidade.sobraMensal}`);
        }
      }
      expect(contraditorios, contraditorios.slice(0, 5).join("; ")).toHaveLength(0);
    });

    it("em 200 CPFs: a ocupação diz o mesmo que dados e risco", () => {
      for (const doc of documentos) {
        const r = cadastralSimulado(doc);
        expect(r.dados.trocasEmprego10Anos, doc).toBe(r.ocupacao.trocas10Anos);
        expect(r.dados.mediaAnosPorVinculo, doc).toBe(r.ocupacao.mediaAnosPorVinculo);
        expect(r.risco.empregado, doc).toBe(r.ocupacao.empregadoAgora);
        expect(r.ocupacao.trocas5Anos, doc).toBeLessThanOrEqual(r.ocupacao.trocas10Anos);
        expect(r.ocupacao.trocas10Anos, doc).toBeLessThanOrEqual(r.ocupacao.trocasTotal);
      }
    });
  });

  /**
   * `consultadoEm` saía só com a data ("2026-09-13"). A tela do SPC formata com
   * hora (`toLocaleString`), e uma data sem hora vira meia-noite UTC: no
   * Brasil, "12/09 21:00" — dia e hora errados para uma consulta de agora. O
   * SPC real devolve instante completo com fuso (spc-parser.test.ts).
   */
  describe("consultadoEm do SPC", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("é o instante completo da consulta, e em Brasília cai no dia em que ela aconteceu", () => {
      vi.useFakeTimers();
      // 23h30 de 12/09 em Brasília = 02h30 de 13/09 em UTC.
      vi.setSystemTime(new Date("2026-09-13T02:30:00.000Z"));
      const { consultadoEm } = spcSimulado("99912345607");
      expect(consultadoEm).toBe("2026-09-13T02:30:00.000Z");
      const emBrasilia = new Date(consultadoEm!).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      });
      expect(emBrasilia).toBe("12/09, 23:30");
    });

    it("aceita o instante da consulta como parâmetro — a semeadura grava consulta de dias atrás", () => {
      const quando = new Date("2026-09-02T14:05:00.000Z");
      const r = spcSimulado("99912345607", quando);
      expect(r.consultadoEm).toBe(quando.toISOString());
      // O conteúdo não muda com o instante; só as datas deslocam.
      expect(r.score).toBe(spcSimulado("99912345607").score);
      expect(cadastralSimulado("99912345607", quando).identidade.dataSituacao)
        .not.toBe(cadastralSimulado("99912345607", new Date("2026-09-12T14:05:00.000Z")).identidade.dataSituacao);
    });
  });
});
