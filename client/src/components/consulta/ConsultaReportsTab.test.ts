/**
 * Trava a contagem da aba Relatórios pela SUGESTÃO DE DECISÃO do motor.
 *
 * Existe porque a página contava todo `!approved` como Rejeitada, e `approved`
 * é só `score >= 500` gravado no servidor: uma consulta "Analisar" com score
 * 400 virava Rejeitada, e uma "Analisar" com 550 virava Aprovada. O provedor
 * via "Aprovadas 0 · Rejeitadas 3" com três consultas que o Histórico, na mesma
 * tela, mostrava como "Analisar".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import * as aba from "./ConsultaReportsTab";

const consulta = (decisionReco: string | null, score: number) => ({
  decisionReco, score, approved: score >= 500, cost: 0, result: {},
});

function renderizar(consultations: any[]) {
  return renderToStaticMarkup(createElement(aba.default as any, { consultations, avgScore: 0 }));
}

describe("Relatórios — três faixas pela sugestão de decisão", () => {
  it("o caso da auditoria: três Analisar não aparecem como Rejeitadas", () => {
    const html = renderizar([consulta("Review", 400), consulta("Review", 420), consulta("Review", 450)]);
    expect(html).toContain("Aprovadas (0)");
    expect(html).toContain("Para analisar (3)");
    expect(html).toContain("Rejeitadas (0)");
  });

  it("Accept, Review e Reject caem cada um na sua faixa, qualquer que seja o approved", () => {
    const html = renderizar([
      consulta("Accept", 720),
      consulta("Review", 550), // approved = true, mas a sugestão é analisar
      consulta("Review", 400), // approved = false, mas a sugestão é analisar
      consulta("Reject", 200),
    ]);
    expect(html).toContain("Aprovadas (1)");
    expect(html).toContain("Para analisar (2)");
    expect(html).toContain("Rejeitadas (1)");
  });

  it("sem decisão gravada conta como analisar — o mesmo parecer que o Histórico mostra", () => {
    expect(aba.contarPorDecisao([consulta(null, 300), consulta("Accept", 800)]))
      .toEqual({ aprovar: 1, analisar: 1, rejeitar: 0 });
  });

  it("a página não deriva mais a contagem de approved", () => {
    const fonte = readFileSync(fileURLToPath(new URL("../../pages/consulta/consulta-isp.tsx", import.meta.url)), "utf8");
    expect(fonte).not.toMatch(/\.approved\b/);
  });
});
