/**
 * O HANDOFF do Kanban de cobrança — as medidas que o desenho fixou.
 *
 * O dono entregou um pacote de design em 07/09/2026 ("fazer o redesign do
 * kanban em cobrança, exatamente como nesse arquivo") com um protótipo em HTML
 * e um README de alta fidelidade: cores, tipografia, espaçamentos e estados
 * finais, todos saindo de `client/src/index.css`.
 *
 * Este arquivo trava os números que o desenho decidiu e que um refactor
 * distraído desfaz sem quebrar nada: a largura da coluna, o tom de cada posto,
 * o raio de cada peça, a faixa de 3px que liga o card à coluna de onde ele veio.
 * Nenhum deles é preferência — cada um veio escrito no handoff.
 *
 * O que este arquivo NÃO trava é comportamento: isso é de `card-caso.test.ts`,
 * `kanban.test.ts` e `movimentos-cobranca.test.ts`. Aqui é só a régua.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BORDA_DO_TOM, COR_DO_TOM, FUNDO_DO_TOM, tomDaColunaDoKanban } from "./movimentos-cobranca";
import { acaoRapidaDoCaso, passoDoCaso, ROTULO_DA_ACAO_RAPIDA } from "./CardCaso";

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const card = ler("./CardCaso.tsx");
const quadro = ler("./KanbanCobranca.tsx");
const lista = ler("./ListaDeCasos.tsx");
const filtro = ler("./filtro-atraso.tsx");
const pagina = ler("../../pages/cobranca/kanban.tsx");

describe("os tons por coluna", () => {
  /*
   * A tabela do handoff, seção 4. "A contatar" é deliberadamente NEUTRO ESCURO
   * e não azul-lilás — o próprio README explica: azul e lilás no mesmo quadro
   * ficaram indistinguíveis, e a separação passou a ser por VALOR, não por
   * matiz.
   */
  const TABELA = [
    ["aberto", "var(--text-2)", "var(--surface-3)", "var(--border-strong)"],
    ["em_contato", "var(--info)", "var(--info-bg)", "var(--info-border)"],
    ["negociando", "var(--gated)", "var(--gated-bg)", "var(--gated-border)"],
    ["acordo_ativo", "var(--ok)", "var(--ok-bg)", "var(--ok-border)"],
    ["cancelamento", "var(--past)", "var(--past-bg)", "var(--past-border)"],
  ] as const;

  it.each(TABELA)("%s: topo %s, fundo do cabeçalho %s, borda %s", (status, cor, fundo, borda) => {
    const tom = tomDaColunaDoKanban(status);
    expect(COR_DO_TOM[tom]).toBe(cor);
    expect(FUNDO_DO_TOM[tom]).toBe(fundo);
    expect(BORDA_DO_TOM[tom]).toBe(borda);
  });

  it("todo tom tem os três, e nenhum é hex nem paleta do Tailwind", () => {
    for (const tom of Object.keys(COR_DO_TOM) as Array<keyof typeof COR_DO_TOM>) {
      for (const mapa of [COR_DO_TOM, FUNDO_DO_TOM, BORDA_DO_TOM]) {
        expect(mapa[tom], tom).toMatch(/^var\(--[a-z0-9-]+\)$/);
      }
    }
  });
});

describe("a coluna", () => {
  it("296px de largura, raio de 10px e fundo --surface-2", () => {
    expect(quadro).toContain("export const LARGURA_COLUNA_COBRANCA = 296;");
    expect(quadro).toContain("rounded-[10px]");
    expect(quadro).toContain('background: "var(--surface-2)"');
  });

  it("o cabeçalho é TINGIDO no tom do posto e fechado por uma linha do mesmo tom", () => {
    expect(quadro).toContain("const fundoDoCabecalho =");
    expect(quadro).toContain("const bordaDoCabecalho =");
    expect(quadro).toContain("style={{ background: fundoDoCabecalho, borderBottom: `1px solid ${bordaDoCabecalho}` }}");
    // coluna fechada não tinge: ela não é posto de trabalho
    expect(quadro).toContain('coluna.fechada ? "var(--surface-3)" : FUNDO_DO_TOM[tom]');
  });

  it("o ponto colorido saiu — o cabeçalho inteiro já carrega o tom", () => {
    expect(quadro).toMatch(/O ponto colorido saiu/);
    expect(quadro).toContain('<h2 className="truncate text-[13px] font-semibold');
  });

  it("a contagem é mono 15px e o valor da coluna 10.5px", () => {
    expect(quadro).toContain('text-[15px] font-medium leading-none tabular-nums');
    expect(quadro).toContain('text-[10.5px] tabular-nums text-[var(--text-faint)]');
  });

  it("os três estados de arrasto continuam pintados por token", () => {
    expect(quadro).toContain('"0 0 0 2px var(--brand)"');
    expect(quadro).toContain('"0 0 0 2px var(--danger)"');
    expect(quadro).toContain('"0 0 0 1px var(--brand)"');
    expect(quadro).toContain('transition: "box-shadow .15s, opacity .15s"');
  });
});

describe("o card", () => {
  it("leva uma faixa de 3px no tom da COLUNA de onde ele veio", () => {
    expect(card).toContain("const tomDaColuna = COR_DO_TOM[tomDaColunaDoKanban(item.status)]");
    expect(card).toContain("style={{ borderLeft: `3px solid ${tomDaColuna}` }}");
  });

  it("o poço da etapa e do passo: grade de 50px, raio 6px, fundo --surface-2", () => {
    expect(card).toContain("grid-cols-[50px_1fr]");
    expect(card).toContain("rounded-md border border-[var(--border-faint)] bg-[var(--surface-2)]");
    expect(card).toContain("card-poco-${item.id}");
  });

  it("o rótulo do poço é mono 9.5px em caixa alta; o passo tem peso e o topo não", () => {
    expect(card).toContain('text-[9.5px] font-semibold uppercase leading-[1.4] tracking-[var(--track-wide)]');
    expect(card).toContain('text-[11.5px] leading-[1.4] text-[var(--text-2)]');
    expect(card).toContain('text-[11.5px] font-medium leading-[1.4] text-[var(--text)]');
  });

  it("o valor fica à direita, mono 15px, e o atraso embaixo dele", () => {
    expect(card).toContain('text-[15px] font-semibold leading-none text-[var(--money-neg)]');
    expect(card).toContain("<PilulaAtraso dias={cliente.diasAtraso} />");
  });

  it("caso fechado não mostra poço: não há etapa nem passo em quem saiu da esteira", () => {
    const poco = card.slice(card.indexOf("card-poco-"), card.indexOf("card-poco-") + 40);
    expect(poco).toBeTruthy();
    expect(card).toMatch(/\{!fechado && \(\s*\n\s*<dl/);
  });
});

describe("o passo do poço", () => {
  /*
   * O PASSO é o que fazer agora. O follow-up ESCRITO no caso vence a ação
   * genérica da régua: quem escreveu "ligar depois das 18h, fala com a esposa"
   * sabe mais do que a etapa sabe.
   */
  const etapa = { id: "d15_29", rotulo: "Negociação e recuperação", acao: "Ligar e propor parcelamento" } as never;

  it("o follow-up escrito vence a ação da régua", () => {
    expect(passoDoCaso({ proximaAcao: "Ligar depois das 18h" } as never, etapa)).toBe("Ligar depois das 18h");
  });

  it("sem follow-up, vale a ação da etapa", () => {
    expect(passoDoCaso({ proximaAcao: null } as never, etapa)).toBe("Ligar e propor parcelamento");
    expect(passoDoCaso({ proximaAcao: "   " } as never, etapa)).toBe("Ligar e propor parcelamento");
  });

  it("sem os dois é null — e a tela mostra o traço com o motivo, nunca texto inventado", () => {
    expect(passoDoCaso({ proximaAcao: null } as never, null)).toBeNull();
    expect(passoDoCaso({} as never, { rotulo: "x" } as never)).toBeNull();
    expect(card).toContain("MOTIVO_SEM_PASSO_NO_CARD");
  });
});

describe("a ação rápida muda com o posto", () => {
  it.each([
    ["aberto", "contato", "Contato"],
    ["em_contato", "propor", "Propor"],
    ["negociando", "aceite", "Aceite"],
    ["acordo_ativo", "parcelas", "Parcelas"],
  ])("%s → %s (%s)", (status, acao, rotulo) => {
    expect(acaoRapidaDoCaso(status)).toBe(acao);
    expect(ROTULO_DA_ACAO_RAPIDA[acaoRapidaDoCaso(status)].rotulo).toBe(rotulo);
  });

  it("coluna desconhecida cai em contato — o verbo mais seguro", () => {
    expect(acaoRapidaDoCaso("status_que_nao_existe")).toBe("contato");
  });

  it("'Parcelas' não promete a baixa no card: ela abre o caso, e o title diz isso", () => {
    // Dar baixa exige saber QUAL parcela, e o card não as carrega.
    expect(ROTULO_DA_ACAO_RAPIDA.parcelas.titulo).toMatch(/a baixa é feita na ficha do cliente/);
    expect(card).toContain('if (qual === "parcelas") return acoes.onAbrir?.(item) ?? acoes.onContato(item);');
  });
});

describe("as pílulas de atraso", () => {
  it("são um grupo de rádio de verdade, com as seis faixas abertas", () => {
    expect(filtro).toContain('role="radiogroup"');
    expect(filtro).toContain('role="radio"');
    expect(filtro).toContain("aria-checked={ativa}");
  });

  it("raio 14px, altura 28px, mono 11.5px — a medida do handoff", () => {
    expect(filtro).toContain("min-h-[28px] items-center rounded-[14px] border px-2.5 font-mono text-[11.5px]");
  });

  it("ativa em --brand/--brand-soft/--brand-ink; inativa em --surface-2", () => {
    expect(filtro).toContain("border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-ink)]");
    expect(filtro).toContain("border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]");
  });

  it("clicar na faixa ligada desliga — o caminho de volta para 'todas'", () => {
    expect(filtro).toContain('onClick={() => onChange(ativa ? "" : o.valor)}');
  });
});

describe("a visão lista", () => {
  it("as oito colunas do handoff, na ordem", () => {
    const cabecalho = lista.slice(lista.indexOf("<thead"), lista.indexOf("</thead>"));
    for (const coluna of ["cliente", "documento", "vencido", "atraso", "coluna", "etapa da régua", "próximo passo", "faixa do dia"]) {
      expect(cabecalho, coluna).toContain(`>${coluna}</Th>`);
    }
  });

  it("reusa as primitivas de tabela do codebase, e não desenha uma nova", () => {
    expect(lista).toContain('from "@/components/painel/ui"');
    expect(lista).toContain("<TabelaPainel");
  });

  it("DIZ quantos casos o teto por coluna deixou de fora — lista que parece completa e não é seria pior que o quadro", () => {
    expect(lista).toContain("-ocultos`}");
    expect(lista).toMatch(/não couberam/);
    expect(lista).toContain("if (coluna.truncado) ocultos +=");
  });

  it("a página troca de visão sem trocar de recorte: os dois leem a mesma resposta", () => {
    expect(pagina).toContain("<Segmentado opcoes={OPCOES_VISAO}");
    expect(pagina).toContain("visao={visao}");
    expect(quadro).toContain('visao === "lista" ? (');
    expect(quadro).toContain("<ListaDeCasos quadro={quadro}");
  });

  it("arrastar continua sendo gesto de quadro: o DndContext não envolve a lista", () => {
    const trecho = quadro.slice(quadro.indexOf('visao === "lista" ? ('), quadro.indexOf("</DndContext>"));
    expect(trecho).toContain("<ListaDeCasos");
    expect(trecho.indexOf("<ListaDeCasos")).toBeLessThan(trecho.indexOf("<DndContext"));
  });
});

describe("nada de paleta crua do Tailwind em nenhuma das peças novas", () => {
  it.each([
    ["CardCaso.tsx", card],
    ["KanbanCobranca.tsx", quadro],
    ["ListaDeCasos.tsx", lista],
    ["filtro-atraso.tsx", filtro],
    ["kanban.tsx", pagina],
  ])("%s", (_nome, fonte) => {
    expect(fonte).not.toMatch(/\b(bg|text|border)-(slate|gray|zinc|neutral|blue|emerald|red|amber|green)-\d/);
    expect(fonte).not.toMatch(/shadow-(md|lg|xl|2xl)\b/);
  });
});
