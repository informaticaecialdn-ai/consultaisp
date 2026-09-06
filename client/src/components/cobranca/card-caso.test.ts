/**
 * O card do quadro depois do enxugamento (pedido do dono, 06/09/2026: "o card
 * está muito grande… simplificar o card com o nome do cliente, CPF e dados dos
 * valores vencidos").
 *
 * Estes testes travam as DUAS metades do pedido: o que FICOU no card e o que
 * SAIU dele para o painel — porque um card que volta a crescer é exatamente a
 * regressão que o dono reclamou. As funções puras rodam de verdade; o JSX é
 * travado pelo fonte, como o resto da suíte de cobrança.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  casoFechado, diasNoStatusDoCaso, MOTIVO_SEM_TEMPO_NA_COLUNA, resumoDoAcordo,
  STATUS_FECHADOS, textoDaFaixaDoDia, textoDoTempoNaColuna, TOM_DA_FAIXA_DO_DIA, vencimentoMaisAntigo,
} from "./CardCaso";
import { proximoContato } from "./formatacao";

const fonte = readFileSync(new URL("./CardCaso.tsx", import.meta.url), "utf8");
const painel = readFileSync(new URL("./PainelDoCaso.tsx", import.meta.url), "utf8");
/** `brl` usa espaço FINO NÃO SEPARÁVEL depois do "R$"; o teste compara com espaço comum. */
const NBSP = new RegExp(String.fromCharCode(160), "g");
const semNbsp = (s: string) => s.replace(NBSP, " ");

describe("vencimentoMaisAntigo", () => {
  it("é hoje menos os dias de atraso; sem atraso não há vencimento", () => {
    const hoje = new Date(2026, 8, 5);
    expect(vencimentoMaisAntigo(46, hoje)?.toISOString().slice(0, 10)).toBe("2026-07-21");
    expect(vencimentoMaisAntigo(0, hoje)).toBeNull();
  });
});

describe("resumoDoAcordo", () => {
  it("parcelamento: parcelas × valor, entrada, pagas/total e a próxima (com aviso de atraso)", () => {
    expect(semNbsp(resumoDoAcordo({ id: 1, tipo: "parcelamento", status: "ativa", valorNegociado: 300, entrada: 50, parcelas: 3, valorParcela: 100, parcelasPagas: 1, proximaParcela: { numero: 2, vencimento: "2026-09-10", valor: 100, atrasada: false }, aceitaEm: null })))
      .toBe("3x de R$ 100,00 · entrada R$ 50,00 · 1/3 pagas · próxima 10/09/2026");
    expect(semNbsp(resumoDoAcordo({ id: 1, tipo: "parcelamento", status: "ativa", valorNegociado: 300, entrada: 0, parcelas: 3, valorParcela: 100, parcelasPagas: 2, proximaParcela: { numero: 3, vencimento: "2026-08-10", valor: 100, atrasada: true }, aceitaEm: null })))
      .toBe("3x de R$ 100,00 · 2/3 pagas · próxima 10/08/2026 (atrasada)");
  });
  it("à vista: o valor negociado", () => {
    expect(semNbsp(resumoDoAcordo({ id: 2, tipo: "a_vista", status: "proposta", valorNegociado: 250, entrada: 0, parcelas: 1, valorParcela: null, parcelasPagas: 0, proximaParcela: null, aceitaEm: null }))).toBe("à vista R$ 250,00");
  });
});

describe("casoFechado", () => {
  it("os quatro desfechos saem da esteira; o resto continua vivo", () => {
    for (const s of STATUS_FECHADOS) expect(casoFechado(s)).toBe(true);
    for (const s of ["aberto", "em_contato", "negociando", "acordo_ativo"]) expect(casoFechado(s)).toBe(false);
  });
});

/**
 * A faixa do dia é a ordem em que a coluna vem do servidor (vencido, hoje,
 * sem data, agendado). É o ÚNICO selo que sobrou no card: sem ele o operador
 * não sabe por que aquele card está na frente.
 */
describe("faixa do dia no card", () => {
  const hoje = new Date(2026, 8, 6, 10, 0);
  const emDias = (dias: number) => new Date(2026, 8, 6 + dias, 9, 0).toISOString();

  it("cada faixa tem o texto e o tom que o operador lê de longe", () => {
    const faixa = (iso: string | null) => proximoContato(iso, hoje);
    expect(faixa(emDias(-3))).toMatchObject({ urgencia: "vencido", texto: "vencido há 3 dias" });
    expect(faixa(emDias(0))).toMatchObject({ urgencia: "hoje", texto: "hoje" });
    expect(faixa(emDias(2))).toMatchObject({ urgencia: "futuro", texto: "em 2 dias" });
    expect(faixa(null)).toMatchObject({ urgencia: "sem_data", texto: "sem data" });

    // vencido e SEM DATA são os dois vermelhos: caso parado vira dívida perdida
    expect(TOM_DA_FAIXA_DO_DIA.vencido).toBe("danger");
    expect(TOM_DA_FAIXA_DO_DIA.sem_data).toBe("danger");
    expect(TOM_DA_FAIXA_DO_DIA.hoje).toBe("gated");
    expect(TOM_DA_FAIXA_DO_DIA.futuro).toBe("neutro");
  });

  /**
   * O card não tem espaço para dois selos que dizem a mesma coisa: "sem data"
   * e "sem próxima ação" são o MESMO campo vazio (`proximoContatoEm === null`).
   * Fica a frase que diz o que fazer.
   */
  it("caso parado: a faixa lê 'sem próxima ação', e não 'sem data'", () => {
    expect(textoDaFaixaDoDia("sem_data", "sem data")).toBe("sem próxima ação");
    expect(textoDaFaixaDoDia("vencido", "vencido há 3 dias")).toBe("vencido há 3 dias");
    expect(textoDaFaixaDoDia("hoje", "hoje")).toBe("hoje");
    expect(textoDaFaixaDoDia("futuro", "em 2 dias")).toBe("em 2 dias");
  });

  it("o selo está no card e some no caso fechado", () => {
    expect(fonte).toContain("card-faixa-do-dia-${item.id}");
    expect(fonte).toContain("TOM_DA_FAIXA_DO_DIA[contato.urgencia]");
    expect(fonte).toContain("textoDaFaixaDoDia(contato.urgencia, contato.texto)");
    expect(fonte).toContain("{!fechado && (");
  });
});

describe("o que FICOU no card", () => {
  it("nome do cliente, em uma linha, com o nome inteiro no title", () => {
    expect(fonte).toContain("card-nome-${item.id}");
    expect(fonte).toContain("title={cliente.nome}");
    // uma linha só: o clamp de duas linhas era do card antigo
    expect(fonte).not.toContain("[-webkit-line-clamp:2]");
  });

  it("o documento, mono tabular e MASCARADO — a listagem nunca mostra CPF em claro", () => {
    expect(fonte).toContain("card-documento-${item.id}");
    expect(fonte).toContain("{cliente.cpfCnpj}");
    expect(fonte).toContain("TITULO_DO_DOCUMENTO");
    expect(fonte).toMatch(/Documento mascarado/);
    expect(fonte).toContain('const NUM = "font-mono tabular-nums"');
  });

  it("o valor vencido em destaque com o atraso D+N ao lado", () => {
    expect(fonte).toContain("card-divida-${item.id}");
    expect(fonte).toContain("{brl(item.valorAtual)}");
    expect(fonte).toContain("var(--money-neg)");
    expect(fonte).toContain("<PilulaAtraso dias={cliente.diasAtraso} />");
  });

  it("duas ações rápidas: Contato e Conversa, e FORA do corpo clicável", () => {
    // A da conversa entrou a pedido do dono, logo depois do card enxuto (06/09/2026).
    expect(fonte).toContain("card-contato-${item.id}");
    expect(fonte).toContain("card-conversa-${item.id}");
    expect(fonte).toMatch(/As ações rápidas ficam FORA do corpo clicável/);
    // os botões são irmãos do corpo, não filhos: clicar neles não abre o painel
    expect(fonte).toMatch(/<\/div>\s*<\/div>\s*\n\s*\{\/\*/);
  });
});

/**
 * O QUE SAIU. Cada linha aqui é uma parede que o card tinha e não tem mais —
 * e cada uma é conferida no destino: nada foi apagado, tudo mudou de lugar.
 */
describe("o botão da conversa", () => {
  // Pedido do dono (06/09/2026): "o card precisa ter botao para ir para a conversa".
  it("com conversa aberta, LEVA até ela pela tela de atendimento", () => {
    expect(fonte).toContain("card-conversa-${item.id}");
    expect(fonte).toContain("${ROTA_CHAT_COBRANCA}?conversa=");
    expect(fonte).toContain("ROTA_CHAT_COBRANCA = \"/cobranca/chat\"");
  });
  it("sem conversa, INICIA — e sem chat ligado o botão explica em vez de sumir", () => {
    expect(fonte).toContain("acoes.onEnviarParaChat?.(item)");
    expect(fonte).toContain("O chat do provedor ainda não está ligado");
  });
  it("fica fora do corpo clicável, para não abrir o painel junto", () => {
    const acoes = fonte.slice(fonte.indexOf("As ações rápidas ficam FORA do corpo clicável"));
    expect(acoes).toContain("card-contato-${item.id}");
    expect(acoes).toContain("card-conversa-${item.id}");
  });
});

describe("o que SAIU do card e foi para o painel", () => {
  const mudancas: Array<[string, RegExp, RegExp]> = [
    ["a ação da régua escrita por extenso", /etapa\.acao/, /etapa\.acao/],
    ["o canal sugerido", /ROTULO_CANAL\[etapa\.canalSugerido\]/, /ROTULO_CANAL\[etapa\.canalSugerido\]/],
    ["o bloco de follow-up", /card-followup-/, /painel-followup/],
    ["a próxima ação escrita", /card-proxima-acao-/, /painel-proxima-acao/],
    ["o acordo detalhado", /resumoDoAcordo\(acordo\)/, /resumoDoAcordo\(acordoVivo\)/],
    ["o telefone com WhatsApp", /<LinkWhatsapp/, /<LinkWhatsapp/],
    ["a situação do contrato no ERP", /situacaoDoErp|<SeloErp/, /<SeloErp/],
    ["o tempo na coluna", /card-tempo-na-coluna-/, /painel-tempo-na-coluna/],
    ["o selo da conversa do chat", /card-chat-/, /painel-chat/],
    ["o botão de pegar o caso", /card-pegar-/, /painel-pegar/],
    ["o botão de enviar para o chat", /card-enviar-chat-/, /painel-enviar-chat/],
    ["o atalho para o 360", /card-360-/, /painel-360/],
    ["o botão de acordo", /card-acordo-botao-/, /painel-acordo/],
  ];

  for (const [oQue, noCard, noPainel] of mudancas) {
    it(`${oQue}: saiu do card e está no painel`, () => {
      expect(fonte).not.toMatch(noCard);
      expect(painel).toMatch(noPainel);
    });
  }

  it("o card cabe em poucas linhas: nome, documento, valor+atraso, faixa do dia e um botão", () => {
    // Um bloco identificável por linha do card — o card antigo tinha treze.
    const blocos = Array.from(new Set((fonte.match(/`card-[a-z0-9-]+-\$\{item\.id\}`/g) ?? []).map(s => s.slice(1, -"-${item.id}`".length))));
    expect(blocos.sort()).toEqual([
      "card-abrir",      // o corpo clicável
      "card-alca",       // a alça de arrasto
      "card-arrastavel", // o <article> do dnd-kit
      "card-caso",       // o card
      "card-contato",    // ação rápida
      "card-conversa",   // ação rápida: leva à conversa (pedido do dono)
      "card-divida",     // valor + atraso
      "card-documento",
      "card-faixa-do-dia",
      "card-nome",
    ]);
  });
});

/**
 * ARRASTAR ≠ ABRIR (o cuidado que o pedido do dono exige): a alça é só o
 * ícone, e o corpo é um botão de verdade — teclado e anel de foco inclusos.
 */
describe("clicar abre o painel; arrastar continua arrastando", () => {
  it("a alça de arrasto é o ÍCONE, não o bloco de identidade inteiro", () => {
    expect(fonte).toContain("card-alca-${item.id}");
    expect(fonte).toContain("<GripVertical");
    expect(fonte).toContain("ref={alca.ref}");
    expect(fonte).toContain("setActivatorNodeRef");
    // o `alca.ref` e o corpo clicável são elementos DIFERENTES
    expect(fonte).toMatch(/ref=\{alca\.ref\}[\s\S]{0,1400}O CORPO abre o painel/);
  });

  it("o corpo é role=button, focável, com Enter e Espaço", () => {
    expect(fonte).toContain("card-abrir-${item.id}");
    expect(fonte).toContain('role: "button"');
    expect(fonte).toContain("tabIndex: 0");
    expect(fonte).toContain('if (e.key !== "Enter" && e.key !== " ") return;');
    // Espaço rolaria a coluna
    expect(fonte).toContain("e.preventDefault();");
    expect(fonte).toContain("Abrir o caso de ${cliente.nome}");
    expect(fonte).toContain("FOCO");
  });

  it("no overlay do arrasto não há clique, alça nem botão", () => {
    expect(fonte).toContain("const abrir = !overlay && acoes.onAbrir ? () => acoes.onAbrir?.(item) : null;");
    expect(fonte).toContain("{!overlay && (");
  });

  it("`onAbrir` é opcional: sem ele o card não promete um painel que não abre", () => {
    expect(fonte).toContain("onAbrir?: (item: ItemDaFila) => void;");
    expect(fonte).toContain("{...(abrir");
  });
});

/**
 * Estas continuam exportadas daqui porque nasceram no card — quem as mostra
 * hoje é o painel, e a fonte da verdade não se duplica.
 */
describe("o tempo na coluna (hoje mostrado no painel)", () => {
  const hoje = new Date(2026, 8, 6, 15, 0);

  it("prefere o número que a rota contou", () => {
    expect(diasNoStatusDoCaso({ diasNoStatus: 4, statusDesde: "2026-01-01T00:00:00Z" }, hoje)).toBe(4);
    expect(diasNoStatusDoCaso({ diasNoStatus: 0 }, hoje)).toBe(0);
  });

  it("sem o número, deriva de statusDesde por dia civil", () => {
    expect(diasNoStatusDoCaso({ statusDesde: new Date(2026, 8, 3, 23, 0).toISOString() }, hoje)).toBe(3);
    expect(diasNoStatusDoCaso({ statusDesde: new Date(2026, 8, 6, 1, 0).toISOString() }, hoje)).toBe(0);
  });

  it("sem os dois é null — a tela mostra '—' com o motivo, e nunca zero", () => {
    expect(diasNoStatusDoCaso({}, hoje)).toBeNull();
    expect(diasNoStatusDoCaso({ diasNoStatus: null, statusDesde: null }, hoje)).toBeNull();
    expect(diasNoStatusDoCaso({ statusDesde: "não é data" }, hoje)).toBeNull();
    expect(textoDoTempoNaColuna(null)).toBe("—");
    expect(MOTIVO_SEM_TEMPO_NA_COLUNA).toMatch(/ainda não informa/);
    // updatedAt não vale como substituto, e o motivo diz por quê
    expect(MOTIVO_SEM_TEMPO_NA_COLUNA).toMatch(/updatedAt/);
    expect(painel).toContain("MOTIVO_SEM_TEMPO_NA_COLUNA");
  });

  it("data no futuro (relógio adiantado) vira 0, nunca negativo", () => {
    expect(diasNoStatusDoCaso({ statusDesde: new Date(2026, 8, 9).toISOString() }, hoje)).toBe(0);
    expect(diasNoStatusDoCaso({ diasNoStatus: -3 }, hoje)).toBe(0);
  });

  it("zero é 'chegou hoje' — outra coisa que ausência", () => {
    expect(textoDoTempoNaColuna(0)).toBe("chegou hoje");
    expect(textoDoTempoNaColuna(1)).toBe("há 1 dia aqui");
    expect(textoDoTempoNaColuna(12)).toBe("há 12 dias aqui");
  });
});

describe("os tokens do sistema", () => {
  it("nada de paleta crua do Tailwind nem de sombra grande", () => {
    expect(fonte).not.toMatch(/\b(bg|text|border)-(slate|gray|zinc|blue|emerald|red|amber|green)-\d{2,3}\b/);
    expect(fonte).not.toMatch(/shadow-(md|lg|xl|2xl)\b/);
  });
});
