/**
 * O parecer por IA da Consulta ISP na demonstração pública.
 *
 * Em demonstração o SDK nem é instanciado: o parecer é montado do próprio
 * relatório, determinístico, e sai pelo mesmo `onChunk`. Fora dela, o caminho
 * de sempre — o modelo, em stream. O espião no construtor do SDK falha o teste
 * se a demonstração tocar nele.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openaiMock = vi.hoisted(() => {
  const create = vi.fn(async (_params: unknown) => (async function* () {
    yield { choices: [{ delta: { content: "Parecer " } }] };
    yield { choices: [{ delta: { content: "do modelo" } }] };
  })());
  const OpenAI = vi.fn(function () { return { chat: { completions: { create } } }; });
  return { create, OpenAI };
});
vi.mock("openai", () => ({ default: openaiMock.OpenAI }));

import { parecerSimulado, streamConsultationAnalysis, streamAntiFraudAnalysis } from "./ai-analysis";

/** Um relatório de quem deve em dois provedores da rede e segurou a ONU. */
const RESULTADO = {
  cpfCnpj: "99950400007",
  notFound: false,
  score: 420,
  riskLabel: "Risco alto",
  decisionReco: "Reject",
  penalties: [{ reason: "Dívida ativa em outro provedor", points: -300 }],
  alerts: ["Consultado por 3 provedores em 30 dias"],
  providerDetails: [
    { customerName: "Rosana Cardoso Andrade", providerName: "Rede Norte", isSameProvider: false, daysOverdue: 47, overdueAmount: 189.9, hasUnreturnedEquipment: true, unreturnedEquipmentCount: 1 },
    { customerName: "Rosana Cardoso Andrade", providerName: "Paraná Norte", isSameProvider: false, daysOverdue: 120, overdueAmountRange: "R$ 100-500" },
  ],
  recommendedActions: ["Exigir quitação antes de contratar"],
};

async function coletar(dados: typeof RESULTADO | Record<string, unknown>) {
  const pedacos: string[] = [];
  await streamConsultationAnalysis(dados as any, t => pedacos.push(t));
  return pedacos;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.DEMO_MODE;
});

describe("streamConsultationAnalysis com DEMO_MODE ligado", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "true";
  });

  it("nao instancia o SDK nem chama o modelo", async () => {
    await coletar(RESULTADO);
    expect(openaiMock.OpenAI).not.toHaveBeenCalled();
    expect(openaiMock.create).not.toHaveBeenCalled();
  });

  it("entrega o parecer simulado em varios pedacos pelo mesmo onChunk, e o texto junto e o parecer inteiro", async () => {
    const pedacos = await coletar(RESULTADO);
    expect(pedacos.length).toBeGreaterThan(1);
    expect(pedacos.join("").trimEnd()).toBe(parecerSimulado(RESULTADO as any));
  });

  it("diz que e simulado logo na primeira linha e usa as quatro secoes do prompt", async () => {
    const texto = (await coletar(RESULTADO)).join("");
    expect(texto.split("\n")[0]).toMatch(/simulado/i);
    for (const secao of ["RESUMO EXECUTIVO", "PRINCIPAIS FATORES DE RISCO", "ANÁLISE DE PADRÃO", "CONDIÇÕES RECOMENDADAS"]) {
      expect(texto).toContain(`\n${secao}\n`);
    }
  });

  it("sai do proprio relatorio: score, decisao, penalidade, alerta, migracao, equipamento e acao sugerida", () => {
    const texto = parecerSimulado(RESULTADO as any);
    expect(texto).toContain("score ISP 420 (Risco alto)");
    expect(texto).toContain("decisão sugerida: rejeitar");
    expect(texto).toContain("- Dívida ativa em outro provedor (-300 pontos)");
    expect(texto).toContain("- Consultado por 3 provedores em 30 dias");
    expect(texto).toContain("Há dívida em 2 outros provedores da rede");
    expect(texto).toContain("Equipamento em comodato não devolvido em 1 provedor(es)");
    expect(texto).toContain("- Exigir quitação antes de contratar");
  });

  it("deterministico: o mesmo relatorio da sempre o mesmo texto", async () => {
    expect((await coletar(RESULTADO)).join("")).toBe((await coletar(RESULTADO)).join(""));
  });

  it("documento sem registro na rede sai com decisao de aprovar", () => {
    const texto = parecerSimulado({ cpfCnpj: "99900000000", notFound: true, score: 100 } as any);
    expect(texto).toContain("decisão sugerida: aprovar");
    expect(texto).toContain("CONDIÇÕES RECOMENDADAS");
  });
});

describe("streamConsultationAnalysis com DEMO_MODE desligado", () => {
  it("segue o caminho antigo: instancia o SDK, pede stream e repassa o que o modelo manda", async () => {
    const pedacos = await coletar(RESULTADO);
    expect(openaiMock.OpenAI).toHaveBeenCalledTimes(1);
    expect(openaiMock.create).toHaveBeenCalledWith(expect.objectContaining({ stream: true }));
    expect(pedacos).toEqual(["Parecer ", "do modelo"]);
  });
});

describe("streamAntiFraudAnalysis", () => {
  it("em demonstracao recusa sem tocar no SDK", async () => {
    process.env.DEMO_MODE = "true";
    await expect(streamAntiFraudAnalysis([], [], () => {})).rejects.toThrow(/não é processada/);
    expect(openaiMock.OpenAI).not.toHaveBeenCalled();
  });

  it("fora da demonstracao chama o modelo como antes", async () => {
    const pedacos: string[] = [];
    await streamAntiFraudAnalysis([], [], t => pedacos.push(t));
    expect(openaiMock.OpenAI).toHaveBeenCalledTimes(1);
    expect(pedacos).toEqual(["Parecer ", "do modelo"]);
  });
});
