/**
 * A realidade mensal da carteira de ativos — as funções puras do seletor de
 * mês e dos quatro chips (Pagou · Inadimplente · A vencer · Sem fatura), no
 * molde do Provedor.ai. Regra de ouro: sem base de fatura, traço e motivo.
 */
import { describe, expect, it } from "vitest";
import { chipsDoMes, deslocarMes, ESPACO_META, mesAtual, rotuloDoMes } from "./carteira";
import { brl } from "@/components/localizacao/ui";
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
    expect(ESPACO_META.ativos).toMatchObject({ carteira: "ativo", rota: "/cobranca/ativos", situacaoErp: "Ativo ou suspenso" });
    expect(ESPACO_META.ex).toMatchObject({ carteira: "ex_cliente", rota: "/cobranca/ex-clientes", situacaoErp: "Ex-cliente" });
  });
});

/**
 * O chip "Pagou o mês" mostra a SOMA dos dois baldes.
 *
 * Até 08/09/2026 ele mostrava um OU outro (`recebidoConfirmado ? recebido :
 * emConciliacao`). Enquanto o servidor cravava `recebidoConfirmado: false` o
 * ramo confirmado era código morto e ninguém viu; a entrega de recebimentos
 * ligou os dois lados ao mesmo tempo — passou a existir `status:'paid'` por
 * confirmação individual E o campo virou `recebido > 0`. A partir do primeiro
 * comprovante conferido, o card trocava de balde e escondia toda a conciliação
 * do mês, ao lado de uma porcentagem que continuava somando os dois.
 */
describe("Pagou o mês — número, porcentagem e lista têm de concordar", () => {
  const doMes = (recebido: number, emConciliacao: number, faturado = 1000) => chipsDoMes({
    live: true,
    resumo: { faturado, recebido, emConciliacao, recebidoConfirmado: recebido > 0, inadimplente: 0, aVencer: 0, semFatura: 0 },
  } as never)[0];

  it("soma confirmado e conciliação, em vez de escolher um", () => {
    expect(doMes(100, 45_000).valor).toBe(brl(45_100));
  });

  it("o primeiro comprovante conferido NÃO apaga a conciliação da tela", () => {
    const antes = doMes(0, 45_000).valor;
    const depois = doMes(100, 45_000).valor;
    expect(antes).toBe(brl(45_000));
    expect(depois).toBe(brl(45_100));
    // A regressão que existia: `depois` virava R$ 100,00.
    expect(depois).not.toBe(brl(100));
  });

  it("separa no texto o que é comprovado do que é apenas provável", () => {
    expect(doMes(100, 45_000).sub).toContain("confirmado, o resto baixado no ERP");
    expect(doMes(0, 45_000).sub).toContain("sem o valor pago confirmado");
    expect(doMes(100, 0).sub).toContain("confirmado com comprovante");
  });

  it("sem faturado no mês não inventa 0% — não há porcentagem a afirmar", () => {
    expect(doMes(0, 0, 0).sub).toContain("sem faturado no mês");
    expect(doMes(0, 0, 0).sub).not.toContain("0% do faturado");
  });
});
