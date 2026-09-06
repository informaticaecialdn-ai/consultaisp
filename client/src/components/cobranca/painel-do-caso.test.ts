/**
 * O painel do caso — o "card na tela" que o dono pediu em 06/09/2026 com
 * "todas as informações da dívida, todos os boletos, e histórico da cobrança".
 *
 * Duas coisas se travam aqui:
 *   • as FUNÇÕES PURAS rodam de verdade — o que cada situação de fatura pode
 *     afirmar, e o resumo da tabela;
 *   • as TRÊS SEÇÕES e os textos honestos são travados pelo fonte, como o
 *     resto da suíte de cobrança (o vitest daqui não monta .tsx).
 *
 * A regra que mais importa é a do dono: BLOCO AUSENTE ≠ BLOCO VAZIO. A rota
 * pode não mandar as faturas, e isso não é "o cliente não tem boleto".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diaDaFatura, resumoDasFaturas, situacaoDaFatura } from "./PainelDoCaso";
import {
  faturaEstaAberta, lerDetalheDoCaso, lerFaturaDoCaso, MOTIVO_BAIXADA_NO_ERP,
  MOTIVO_NENHUMA_FATURA, MOTIVO_SEM_FATURAS, MOTIVO_SEM_HISTORICO,
  ROTULO_STATUS_DE_FATURA, somaDasFaturasAbertas, type FaturaDoCaso,
} from "./tipos";

const fonte = readFileSync(new URL("./PainelDoCaso.tsx", import.meta.url), "utf8");
const quadro = readFileSync(new URL("./KanbanCobranca.tsx", import.meta.url), "utf8");

const HOJE = new Date(2026, 8, 6, 10, 0);

function fatura(p: Partial<FaturaDoCaso>): FaturaDoCaso {
  return { id: 1, erpRef: null, erpSource: null, vencimento: null, valor: null, descricao: null, status: "aberta", baixadaEm: null, ...p };
}

/* ── O que cada situação de fatura PODE afirmar ──────────────────────── */

describe("situacaoDaFatura", () => {
  it("aberta e vencida é 'vencida'; aberta e futura é 'a vencer'", () => {
    expect(situacaoDaFatura(fatura({ status: "aberta", vencimento: "2026-08-10T00:00:00.000Z" }), HOJE))
      .toMatchObject({ rotulo: "vencida", tom: "danger" });
    expect(situacaoDaFatura(fatura({ status: "aberta", vencimento: "2026-09-20T00:00:00.000Z" }), HOJE))
      .toMatchObject({ rotulo: "a vencer", tom: "gated" });
    // vence HOJE ainda não venceu
    expect(situacaoDaFatura(fatura({ status: "aberta", vencimento: "2026-09-06T00:00:00.000Z" }), HOJE).rotulo).toBe("a vencer");
  });

  it("os nomes legados do CSV (pending, overdue) contam como aberta", () => {
    expect(faturaEstaAberta("pending")).toBe(true);
    expect(faturaEstaAberta("overdue")).toBe(true);
    expect(faturaEstaAberta("aberta")).toBe(true);
    expect(faturaEstaAberta("baixada_no_erp")).toBe(false);
    expect(faturaEstaAberta("paid")).toBe(false);
    expect(situacaoDaFatura(fatura({ status: "overdue", vencimento: "2026-07-01T00:00:00.000Z" }), HOJE).rotulo).toBe("vencida");
  });

  /**
   * O ponto que o dono não deixa passar: "baixada no ERP" NÃO é "paga". A
   * fatura sumiu dos pendentes numa varredura completa — pagamento provável,
   * sem confirmação de valor. O selo e o title dizem isso.
   */
  it("'baixada no ERP' é pagamento PROVÁVEL, e o title explica o que isso é", () => {
    const s = situacaoDaFatura(fatura({ status: "baixada_no_erp", baixadaEm: "2026-09-02T12:00:00.000Z" }), HOJE);
    expect(s.rotulo).toBe("baixada no ERP");
    expect(s.tom).toBe("info");
    expect(s.titulo).toMatch(/sumiu da lista de pendentes numa varredura completa/);
    expect(s.titulo).toMatch(/pagamento provável/i);
    expect(s.titulo).toMatch(/SEM confirmação de valor/);
    expect(s.titulo).toMatch(/Sumiu dos pendentes em 02\/09\/2026/);
    // e o rótulo NÃO diz "paga"
    expect(s.rotulo).not.toMatch(/paga/);
  });

  it("'paga' só para a baixa com valor confirmado — hoje, só o CSV", () => {
    const s = situacaoDaFatura(fatura({ status: "paid" }), HOJE);
    expect(s).toMatchObject({ rotulo: "paga", tom: "ok" });
    expect(s.titulo).toMatch(/só a importação por CSV/);
  });

  it("status desconhecido sai como veio, em tom neutro — nunca se chuta", () => {
    const s = situacaoDaFatura(fatura({ status: "sei_la" }), HOJE);
    expect(s).toMatchObject({ rotulo: "sei_la", tom: "neutro" });
    expect(s.titulo).toMatch(/como veio do ERP/);
  });

  it("aberta sem vencimento não é chamada de vencida", () => {
    const s = situacaoDaFatura(fatura({ status: "aberta", vencimento: null }), HOJE);
    expect(s.rotulo).toBe("aberta");
    expect(s.titulo).toMatch(/Sem data de vencimento no ERP/);
  });

  it("o dia sai do texto, sem `new Date` — a coluna é UTC e escorregaria para o dia anterior", () => {
    expect(diaDaFatura("2026-09-10T00:00:00.000Z")).toBe("2026-09-10");
    expect(diaDaFatura("2026-09-10")).toBe("2026-09-10");
    expect(diaDaFatura(null)).toBeNull();
    expect(diaDaFatura("não é data")).toBeNull();
    expect(fonte).not.toMatch(/new Date\(f\.vencimento/);
  });
});

describe("resumoDasFaturas", () => {
  const lista = [
    fatura({ id: 1, status: "aberta", vencimento: "2026-07-10T00:00:00.000Z", valor: 100 }),
    fatura({ id: 2, status: "aberta", vencimento: "2026-08-10T00:00:00.000Z", valor: 99.9 }),
    fatura({ id: 3, status: "aberta", vencimento: "2026-10-10T00:00:00.000Z", valor: 50 }),
    fatura({ id: 4, status: "baixada_no_erp", vencimento: "2026-06-10T00:00:00.000Z", valor: 80 }),
    fatura({ id: 5, status: "paid", vencimento: "2026-05-10T00:00:00.000Z", valor: 70 }),
  ];

  it("conta cada situação e soma só o que continua PENDENTE", () => {
    expect(resumoDasFaturas(lista, HOJE)).toEqual({
      total: 5, vencidas: 2, aVencer: 1, baixadas: 1, pagas: 1, somaAberta: 249.9,
    });
  });

  it("nenhuma fatura aberta com valor: a soma é null, e a tela mostra '—' — nunca R$ 0,00", () => {
    expect(resumoDasFaturas([fatura({ status: "paid", valor: 70 })], HOJE).somaAberta).toBeNull();
    expect(resumoDasFaturas([fatura({ status: "aberta", valor: null })], HOJE).somaAberta).toBeNull();
    expect(resumoDasFaturas([], HOJE)).toEqual({ total: 0, vencidas: 0, aVencer: 0, baixadas: 0, pagas: 0, somaAberta: null });
    expect(somaDasFaturasAbertas([])).toBeNull();
    expect(somaDasFaturasAbertas(lista)).toBe(249.9);
  });
});

/* ── O contrato da rota, lido com tolerância ─────────────────────────── */

describe("lerDetalheDoCaso", () => {
  it("bloco ausente vira null; bloco vazio vira lista vazia — e são coisas diferentes", () => {
    const nada = lerDetalheDoCaso({});
    expect(nada).toEqual({ caso: null, divida: null, faturas: null, eventos: null, negociacoes: null });

    const vazio = lerDetalheDoCaso({ faturas: [], eventos: [], negociacoes: [] });
    expect(vazio.faturas).toEqual([]);
    expect(vazio.eventos).toEqual([]);
    expect(vazio.negociacoes).toEqual([]);
  });

  it("resposta que não é objeto não derruba a tela", () => {
    for (const cru of [null, undefined, 42, "erro", []]) {
      expect(lerDetalheDoCaso(cru).faturas).toBeNull();
    }
  });

  it("a dívida aceita os dois vocabulários e nunca inventa `base`", () => {
    const d = lerDetalheDoCaso({ divida: { total: "1234.50", diasAtraso: 46, vencidas: 3, aVencer: 1, maisAntiga: "2026-07-21" } }).divida;
    expect(d).toMatchObject({ total: 1234.5, diasAtraso: 46, faturasVencidas: 3, faturasAVencer: 1, vencimentoMaisAntigo: "2026-07-21", base: false });
    expect(d?.faturasAbertas).toBeNull();
  });

  it("a fatura aceita camelCase e snake_case; sem id não entra na lista", () => {
    expect(lerFaturaDoCaso({ id: 7, erp_ref: "A1", due_date: "2026-09-10", value: "88.20", status: "aberta", baixada_em: null }))
      .toEqual({ id: 7, erpRef: "A1", erpSource: null, vencimento: "2026-09-10", valor: 88.2, descricao: null, status: "aberta", baixadaEm: null });
    expect(lerFaturaDoCaso({ erpRef: "sem id" })).toBeNull();
    expect(lerFaturaDoCaso("linha")).toBeNull();
    expect(lerDetalheDoCaso({ faturas: [{ id: 1, status: "aberta" }, "lixo", { semId: true }] }).faturas).toHaveLength(1);
  });

  it("o vocabulário de status cobre o do sync e o legado do CSV", () => {
    expect(ROTULO_STATUS_DE_FATURA.aberta).toBe("aberta");
    expect(ROTULO_STATUS_DE_FATURA.pending).toBe("aberta");
    expect(ROTULO_STATUS_DE_FATURA.overdue).toBe("aberta");
    expect(ROTULO_STATUS_DE_FATURA.baixada_no_erp).toBe("baixada no ERP");
    expect(ROTULO_STATUS_DE_FATURA.paid).toBe("paga");
  });
});

/* ── As três seções que o dono pediu ─────────────────────────────────── */

describe("o painel, pelo fonte", () => {
  it("busca GET /api/cobranca/casos/:id/detalhe com TanStack Query, e só com o painel aberto", () => {
    expect(fonte).toContain("apiDetalheDoCaso(casoId)");
    expect(fonte).toContain("useQuery<unknown>");
    expect(fonte).toContain("enabled: aberto && casoId !== null");
    expect(fonte).toContain("lerDetalheDoCaso(data)");
  });

  it("A DÍVIDA INTEIRA: quanto, atraso, faturas abertas, a mais antiga e o valor na abertura", () => {
    expect(fonte).toContain('testId="painel-divida"');
    expect(fonte).toContain('testId="painel-divida-total"');
    expect(fonte).toContain('rotulo="faturas abertas"');
    expect(fonte).toContain('rotulo="mais antiga"');
    expect(fonte).toContain('rotulo="na abertura"');
    // sem o bloco da rota, os números são o agregado do quadro — e a tela DIZ isso
    expect(fonte).toContain("MOTIVO_SEM_DIVIDA_DETALHADA");
    expect(fonte).toContain('data-testid="painel-divida-motivo"');
  });

  it("TODOS OS BOLETOS: tabela com vencimento, valor, situação e a origem no ERP", () => {
    expect(fonte).toContain('testId="painel-faturas"');
    expect(fonte).toContain('testId="tabela-faturas"');
    for (const coluna of ["<Th>vencimento</Th>", "<Th>descrição</Th>", "<Th>situação</Th>"]) expect(fonte).toContain(coluna);
    expect(fonte).toContain('<Th alinhamento="direita">valor</Th>');
    expect(fonte).toContain("fatura-${f.id}");
    // a origem (qual ERP, qual número lá) vai no title da linha
    expect(fonte).toContain("origem ${f.erpSource}");
    expect(fonte).toContain("nº ${f.erpRef} no ERP");
    // e o número é sempre mono tabular (Td num)
    expect(fonte).toMatch(/<Td num/);
  });

  it("a tela DIZ o que 'baixada no ERP' significa, e não a chama de paga", () => {
    expect(fonte).toContain("MOTIVO_BAIXADA_NO_ERP");
    expect(fonte).toContain('data-testid="faturas-nota"');
    expect(MOTIVO_BAIXADA_NO_ERP).toMatch(/varredura completa/);
    expect(MOTIVO_BAIXADA_NO_ERP).toMatch(/Nenhum ERP nos diz quanto foi pago/);
  });

  it("O HISTÓRICO: a linha do tempo do caso, com data, autor e resultado", () => {
    expect(fonte).toContain('testId="painel-historico"');
    expect(fonte).toContain("<LinhaDoTempo");
    expect(fonte).toContain('testId="painel-linha-do-tempo"');
    // acordos com as parcelas, ao lado do histórico
    expect(fonte).toContain('testId="painel-acordos"');
    expect(fonte).toContain("acordo-${n.id}");
    expect(fonte).toContain("parcela-${p.id}");
  });

  it("as ações que saíram do card estão todas aqui, incluindo o destino do acordo", () => {
    for (const id of ["painel-contato", "painel-acordo", "painel-pegar", "painel-enviar-chat", "painel-360", "painel-fechar"]) {
      expect(fonte).toContain(`data-testid="${id}"`);
    }
    // em "negociando" o aceite mora na ficha: o diálogo só CRIA negociação
    expect(fonte).toContain('destinoDoBotaoDeAcordo(item.status) === "ficha"');
    expect(fonte).toContain("rotuloDoBotaoDeAcordo(item.status)");
    expect(fonte).toContain("acoes.onNegociar !== undefined");
  });

  it("fecha com Esc (Radix) e pelo botão", () => {
    expect(fonte).toContain("<Sheet open={aberto} onOpenChange={o => { if (!o) onFechar(); }}>");
    expect(fonte).toContain('onClick={onFechar} data-testid="painel-fechar"');
  });
});

/**
 * Integridade do dado: a tela nunca promete o que o sistema não faz. Cada
 * ausência tem um motivo escrito, e ausência de BLOCO não vira lista vazia.
 */
describe("o painel é honesto sobre o que não tem", () => {
  it("bloco que a rota não mandou: '—' com o motivo, e o motivo distingue de 'não há'", () => {
    expect(fonte).toContain("MOTIVO_SEM_FATURAS");
    expect(fonte).toContain("MOTIVO_NENHUMA_FATURA");
    expect(fonte).toContain("MOTIVO_SEM_HISTORICO");
    expect(fonte).toContain("MOTIVO_SEM_ACORDOS");
    expect(fonte).toContain('testId="painel-faturas-ausente"');
    expect(fonte).toContain('testId="painel-faturas-vazio"');
    expect(MOTIVO_SEM_FATURAS).toMatch(/A rota não devolveu/);
    expect(MOTIVO_NENHUMA_FATURA).toMatch(/Nenhuma fatura deste cliente veio do ERP/);
    expect(MOTIVO_SEM_HISTORICO).toMatch(/A rota não devolveu/);
    // e são frases DIFERENTES: "não mandou" ≠ "não há"
    expect(MOTIVO_SEM_FATURAS).not.toBe(MOTIVO_NENHUMA_FATURA);
  });

  it("enquanto a resposta está a caminho não se diz que ela não veio", () => {
    expect(fonte).toContain("const pendente = aberto && casoId !== null && isLoading && !isError;");
    expect(fonte).toMatch(/nunca com o texto "a rota não mandou"/);
    expect(fonte).toContain("{pendente ? (");
  });

  it("skeleton em vez de 'Carregando…', e só depois de 300 ms", () => {
    expect(fonte).toContain("useSkeletonAtrasado(pendente)");
    expect(fonte).toContain("<Skeleton");
    expect(fonte).not.toMatch(/Carregando/);
  });

  it("falha na rota vira aviso com 'tentar de novo', e o que veio do quadro continua na tela", () => {
    expect(fonte).toContain('testId="painel-erro"');
    expect(fonte).toContain("<AvisoNaoCarregou");
    expect(fonte).toMatch(/A identidade e o follow-up acima vêm do quadro/);
  });

  it("o documento continua MASCARADO no painel — o inteiro só na ficha do cliente", () => {
    expect(fonte).toContain('data-testid="painel-documento"');
    expect(fonte).toMatch(/nunca mostra CPF\/CNPJ em claro/);
    expect(fonte).not.toContain("documento:");
  });
});

describe("a fiação com o quadro", () => {
  it("o painel é montado UMA vez no quadro, e o caso aberto vem do quadro mais recente", () => {
    expect(quadro).toContain("<PainelDoCaso");
    expect(quadro).toContain("const [casoNoPainel, setCasoNoPainel] = useState<ItemDaFila | null>(null);");
    expect(quadro).toContain("porId.get(casoNoPainel.id) ?? casoNoPainel");
    expect(quadro).toContain("aberto={casoNoPainel !== null}");
    expect(quadro).toContain("onFechar={() => setCasoNoPainel(null)}");
  });

  it("clicar no card abre o painel; o overlay do arrasto não recebe `onAbrir`", () => {
    expect(quadro).toContain("onAbrir: setCasoNoPainel");
    expect(quadro).toContain("acoes={acoesComPainel}");
    // o card do DragOverlay usa `acoes` cru, sem onAbrir
    expect(quadro).toMatch(/<CardCaso item=\{cardAtivo\}[^>]*acoes=\{acoes\}[^>]*overlay \/>/);
  });
});

describe("os tokens do sistema", () => {
  it("nada de paleta crua do Tailwind nem de sombra grande", () => {
    expect(fonte).not.toMatch(/\b(bg|text|border)-(slate|gray|zinc|blue|emerald|red|amber|green)-\d{2,3}\b/);
    expect(fonte).not.toMatch(/shadow-(md|lg|xl|2xl)\b/);
  });

  it("reaproveita as primitivas do painel e da cobrança em vez de redesenhar", () => {
    for (const primitiva of ["BOTAO_MARCA", "BOTAO_SECUNDARIO", "TabelaPainel", "Th", "Td", "SeloCobranca", "Linha", "GRADE_LINHAS", "Kicker"]) {
      expect(fonte).toContain(primitiva);
    }
    // todo número mono tabular
    expect(fonte).toContain('const NUM = "font-mono tabular-nums"');
  });
});
