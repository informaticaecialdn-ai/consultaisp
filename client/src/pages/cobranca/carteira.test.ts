/**
 * A realidade mensal da carteira de ativos — as funções puras do seletor de
 * mês e dos quatro chips (Pagou · Inadimplente · A vencer · Sem fatura), no
 * molde do Provedor.ai. Regra de ouro: sem base de fatura, traço e motivo.
 */
import { describe, expect, it } from "vitest";
import { chipsDoMes, deslocarMes, ESPACO_META, mesAtual, rotuloDoMes } from "./carteira";
import type { RespostaDoMes } from "@/components/cobranca/tipos";

const semNbsp = (s: string | null) => (s ?? "").replace(/ /g, " ");

describe("seletor de mês", () => {
  it("mesAtual é AAAA-MM; rotuloDoMes é 'set/26'; deslocarMes vira o ano", () => {
    expect(mesAtual(new Date(2026, 8, 5))).toBe("2026-09");
    expect(rotuloDoMes("2026-09")).toBe("set/26");
    expect(deslocarMes("2026-01", -1)).toBe("2025-12");
    expect(deslocarMes("2026-12", 1)).toBe("2027-01");
  });
});

describe("chipsDoMes", () => {
  const resumo: RespostaDoMes = {
    live: true,
    motivo: null,
    resumo: {
      mes: "2026-09", base: true, faturado: 1000, recebido: 0, recebidoConfirmado: false, emConciliacao: 250,
      inadimplente: 300, numInadimplentes: 3, aVencer: 450, numAVencer: 5, semFatura: 12, clientes: { emDia: 500, inadimplentes: 24 }, atualizadoEm: null,
    },
  };

  it("com base: os quatro valores reais, e 'pagou' diz que é baixa no ERP sem valor confirmado", () => {
    const chips = chipsDoMes(resumo);
    expect(chips.map(c => c.id)).toEqual(["pago", "inadimplente", "a_vencer", "sem_fatura"]);
    expect(semNbsp(chips[0].valor)).toBe("R$ 250,00");
    expect(chips[0].sub).toContain("25% do faturado");
    expect(chips[0].sub).toContain("sem o valor pago confirmado");
    expect(semNbsp(chips[1].valor)).toBe("R$ 300,00");
    expect(chips[1].sub).toBe("3 faturas vencidas");
    expect(semNbsp(chips[2].valor)).toBe("R$ 450,00");
    expect(chips[3].valor).toBe("12");
  });

  it("sem base (ou sem resposta): traço em tudo, nunca zero", () => {
    for (const dados of [undefined, { live: false, motivo: "sem fatura do ERP", resumo: null } as RespostaDoMes]) {
      const chips = chipsDoMes(dados);
      expect(chips[0].valor).toBe("—");
      expect(chips[1].valor).toBe("—");
      expect(chips[2].valor).toBe("—");
      expect(chips[3].valor).toBeNull();
      expect(chips[0].sub).toBe("sem faturas no mês");
    }
  });
});

describe("os dois espaços", () => {
  it("ativos e ex têm carteira, rota e situação ERP próprias", () => {
    expect(ESPACO_META.ativos).toMatchObject({ carteira: "ativo", rota: "/cobranca/ativos", situacaoErp: "Ativo" });
    expect(ESPACO_META.ex).toMatchObject({ carteira: "ex_cliente", rota: "/cobranca/ex-clientes", situacaoErp: "Ex-cliente" });
  });
});
