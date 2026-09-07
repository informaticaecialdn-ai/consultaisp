/**
 * Os indicadores do quadro — o que não pode se perder a cada rodada de desenho.
 *
 * Este bloco encolheu duas vezes, nas duas por pedido do dono:
 *   06/09/2026 — "melhorar essas informações, toma metade da tela": oito cards
 *                de 76px viraram oito células de uma tira de 48px;
 *   07/09/2026 — o handoff de design: a tira vira QUATRO cartões com número
 *                herói e uma linha de apoio permanente.
 *
 * Encolher um bloco de indicadores erra de três jeitos, e o teste trava os três:
 * sumir com um número sem dizer para onde ele foi; sumir com a EXPLICAÇÃO de um
 * número que ficou; e mostrar um número derivado que mente quando falta uma das
 * parcelas dele.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { travadosAgora } from "../../pages/cobranca/kanban";

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const faixa = ler("./FaixaDeIndicadores.tsx");
const kanban = ler("../../pages/cobranca/kanban.tsx");

/** O bloco de itens que o quadro passa para a faixa. */
const itens = kanban.slice(kanban.indexOf("<FaixaDeIndicadores"), kanban.indexOf('data-testid="filtros-kanban"'));

describe("os quatro cartões do handoff", () => {
  const QUATRO = [
    ["em aberto", /soma dos casos vivos do recorte/],
    ["casos vivos", /tituloDoFluxoDoDia\(kpis\)/],
    ["travados agora", /não andam/],
    ["recuperado", /tituloDaRecuperacao/],
  ] as const;

  it.each(QUATRO)("%s está no quadro, com a explicação junto", (rotulo, titulo) => {
    expect(itens).toContain(rotulo);
    expect(itens).toMatch(titulo);
  });

  it("são exatamente quatro — o desenho tem quatro slots", () => {
    expect((itens.match(/chave: "/g) ?? []).length).toBe(4);
  });

  it("todo número leva `titulo`: número sem explicação não sobe", () => {
    expect((itens.match(/titulo:/g) ?? []).length).toBe(4);
  });

  it("cada cartão traz a linha de APOIO — a explicação deixou de morar só no tooltip", () => {
    // Na tira o subtítulo virou `title`, e tooltip não sobrevive a print nem a
    // celular. Aqui `apoio` é texto permanente.
    expect((itens.match(/apoio:/g) ?? []).length).toBe(4);
    expect(faixa).toContain("apoio?: ReactNode");
  });
});

describe("o que saiu da tira não sumiu do produto", () => {
  /*
   * "para hoje" e "críticos" tinham célula própria na tira e não têm cartão no
   * desenho. Os dois continuam na tela, em lugares onde valem mais: "para
   * hoje" é a faixa do dia de cada card, e a prioridade crítica é o que sobe
   * dentro de cada coluna na ordem do dia. O comentário da página registra
   * isso — sem ele, a próxima pessoa lê o diff e conclui que se perderam.
   */
  it("a página diz para onde foram", () => {
    expect(kanban).toMatch(/`para hoje` e `críticos` saíram da tira/);
    expect(kanban).toMatch(/faixa do dia\s*\n\s*\*?\s*no card/);
  });

  it("o fluxo do dia virou a linha de apoio de casos vivos, com os mesmos testids", () => {
    expect(kanban).toContain('data-testid="fluxo-do-dia"');
    expect(kanban).toContain('data-testid="fluxo-entraram"');
    expect(kanban).toContain('data-testid="fluxo-resolvidos"');
    // e continua sem inventar zero quando o servidor não conta
    expect(kanban).toContain('typeof n === "number" ? num(n) : TRACO');
  });
});

describe("travados agora — o número derivado", () => {
  /*
   * É a soma de "contato vencido" com "sem próxima ação". As duas condições são
   * disjuntas por construção no servidor (uma exige data de próximo contato, a
   * outra exige a ausência dela), então a soma não conta ninguém duas vezes.
   *
   * O risco é o outro: somar com `?? 0` quando uma das parcelas falta. Isso
   * mostraria só os vencidos com o rótulo de travados — um número MENOR que o
   * real, apresentado como se fosse o total. Pior que "—".
   */
  it("soma as duas parcelas", () => {
    expect(travadosAgora({ vencidos: 23, semProximaAcao: 18 } as never)).toBe(41);
  });

  it("falta UMA das parcelas e o resultado é null, nunca a outra sozinha", () => {
    expect(travadosAgora({ vencidos: 23 } as never)).toBeNull();
    expect(travadosAgora({ semProximaAcao: 18 } as never)).toBeNull();
    expect(travadosAgora({ vencidos: 23, semProximaAcao: null } as never)).toBeNull();
    expect(travadosAgora(null)).toBeNull();
  });

  it("zero é resposta legítima: nada travado é diferente de não sei", () => {
    expect(travadosAgora({ vencidos: 0, semProximaAcao: 0 } as never)).toBe(0);
  });
});

describe("a geometria é a do handoff e a do sistema", () => {
  it("número mono, tabular, com clamp para não quebrar no meio do valor", () => {
    expect(faixa).toContain("tabular-nums");
    expect(faixa).toContain("clamp(21px,2vw,26px)");
    expect(faixa).toContain("whitespace-nowrap");
  });

  it("rótulo mono em caixa alta com o tracking do token", () => {
    expect(faixa).toContain("tracking-[var(--track-wide)]");
    expect(faixa).toContain("uppercase");
  });

  it("faixa de 3px à esquerda no tom do indicador, e raio de card", () => {
    expect(faixa).toContain("borderLeft: `3px solid ${i.tom ?? \"var(--border-strong)\"}`");
    expect(faixa).toContain("rounded-lg");
    expect(faixa).not.toMatch(/shadow-(md|lg|xl|2xl)/);
  });

  it("cor semântica só quando significa risco: sem cor, o número é --text", () => {
    expect(faixa).toContain('style={{ color: i.cor ?? "var(--text)"');
  });

  it("nada de paleta crua do Tailwind", () => {
    expect(faixa).not.toMatch(/\b(bg|text|border)-(slate|gray|zinc|neutral|blue|emerald|red|amber)-\d/);
  });
});

describe("o quadro não perdeu a régua do traço", () => {
  it("recuperado sem base continua TRACO, nunca R$ 0,00", () => {
    expect(itens).toContain("recuperacao?.base ? brl(recuperacao.valor) : TRACO");
  });

  it("o rótulo do recuperado carrega o período e o escopo", () => {
    expect(itens).toContain("recuperado ${DIAS_DA_RECUPERACAO}d · carteira");
  });

  it("o rótulo do 'em aberto' segue o RECORTE, e não diz 'minha fila' com o quadro em outro escopo", () => {
    expect(itens).toContain("em aberto · ${rotuloDoEscopo(escopo)}");
    expect(kanban).toContain("export function rotuloDoEscopo");
  });
});
