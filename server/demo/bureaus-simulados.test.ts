import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { spcSimulado, cadastralSimulado } from "./bureaus-simulados";
import { consultarSpc } from "../services/spc/spc.service";
import { consultarCpf, type Credencial } from "../services/bigdata.service";

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
});
