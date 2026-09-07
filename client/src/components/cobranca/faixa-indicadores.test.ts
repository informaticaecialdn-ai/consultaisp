/**
 * A faixa de indicadores do quadro — o que ela não pode perder ao encolher.
 *
 * Pedido do dono (06/09/2026): "melhorar essas informações, toma metade da
 * tela". Encolher um bloco de indicadores é fácil de fazer errado de dois
 * jeitos: sumindo com indicador, ou sumindo com a explicação de cada um. Este
 * teste trava os dois — os OITO continuam lá, cada um com `title` — e a
 * geometria do sistema, que é onde uma tira de números costuma escorregar
 * (número sem `tabular-nums`, cinza cru do Tailwind no hairline, raio grande).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const faixa = ler("./FaixaDeIndicadores.tsx");
const kanban = ler("../../pages/cobranca/kanban.tsx");

/** O bloco de itens que o quadro passa para a faixa. */
const itens = kanban.slice(kanban.indexOf("<FaixaDeIndicadores"), kanban.indexOf('data-testid="filtros-kanban"'));

describe("nenhum indicador se perdeu na compactação", () => {
  const OITO = [
    ["casos vivos", /Casos vivos no recorte/],
    ["contato vencido", /Passou da data marcada/],
    ["para hoje", /Contato marcado para hoje/],
    ["críticos", /prioridade crítica/],
    ["sem próxima ação", /parado vira dívida perdida/],
    ["em aberto", /Soma dos casos vivos/],
    ["recuperado", /tituloDaRecuperacao/],
    ["fluxo de hoje", /tituloDoFluxoDoDia\(kpis\)/],
  ] as const;

  it.each(OITO)("%s continua no quadro, com a explicação junto", (rotulo, titulo) => {
    expect(itens).toContain(rotulo);
    expect(itens).toMatch(titulo);
  });

  it("são exatamente oito células — nem uma a mais escondida", () => {
    expect((itens.match(/chave: "/g) ?? []).length).toBe(8);
  });

  it("o subtítulo de cada card virou `title`: explicação não ocupa linha fixa", () => {
    // Todo item leva `titulo:` — nenhum número fica sem o que ele significa.
    expect((itens.match(/titulo:/g) ?? []).length).toBe(8);
  });
});

describe("a geometria é a do sistema", () => {
  it("o número é mono e tabular; o rótulo é mono, caixa alta e com o tracking do token", () => {
    expect(faixa).toContain("tabular-nums");
    expect(faixa).toContain("tracking-[var(--track-wide)]");
    expect(faixa).toContain("uppercase");
  });

  it("o hairline nasce do gap sobre o token da borda, e não de um cinza do Tailwind", () => {
    expect(faixa).toContain("gap-px");
    expect(faixa).toContain("bg-[var(--border)]");
    expect(faixa).not.toMatch(/\b(bg|text|border)-(slate|gray|zinc|neutral|blue|emerald|red|amber)-\d/);
  });

  it("raio de card (8px) e nada de sombra flutuante", () => {
    expect(faixa).toContain("rounded-lg");
    expect(faixa).not.toMatch(/shadow-(md|lg|xl|2xl)/);
  });

  it("cor semântica só quando significa risco: sem cor, o número é --text", () => {
    expect(faixa).toContain('style={{ color: i.cor ?? "var(--text)" }}');
  });
});

describe("o quadro não perdeu a régua do traço", () => {
  it("recuperado sem base continua TRACO, nunca R$ 0,00", () => {
    expect(itens).toContain("recuperacao?.base ? brl(recuperacao.valor) : TRACO");
  });

  it("o rótulo do recuperado carrega o período e o escopo, que o subtítulo levava", () => {
    // "recuperado" sozinho seria lido como recuperado DO QUADRO; é da carteira.
    expect(itens).toContain("recuperado ${DIAS_DA_RECUPERACAO}d · carteira");
  });
});
