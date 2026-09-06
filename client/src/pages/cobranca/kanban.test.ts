/**
 * O kanban de cobrança — o que a tela promete e a fiação que a expõe.
 *
 * O vitest daqui não monta .tsx, então estes testes travam o CONTRATO pelo
 * fonte: a página consome a rota certa, com os parâmetros que o servidor
 * aceita; os KPIs vêm do servidor, e não de `itens.length`; o quadro está
 * ligado no App e na sidebar. `queryDoKanban` é lógica pura e roda
 * de verdade.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { queryDoKanban } from "./kanban";

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const pagina = ler("./kanban.tsx");
const quadro = ler("../../components/cobranca/KanbanCobranca.tsx");
const card = ler("../../components/cobranca/CardCaso.tsx");
const app = ler("../../App.tsx");
const carteira = ler("./carteira.tsx");
const sidebar = ler("../../components/app-sidebar.tsx");
const tipos = ler("../../components/cobranca/tipos.ts");
const movimentos = ler("../../components/cobranca/movimentos-cobranca.ts");

describe("queryDoKanban — só o que a rota aceita, e nada vazio", () => {
  const base = { escopo: "todos" as const, etapa: "", carteira: "", busca: "" };

  it("toda a equipe sem filtro é a rota crua", () => {
    expect(queryDoKanban(base)).toBe("");
  });

  it("minha fila manda responsavel=eu; a geral, responsavel=geral", () => {
    expect(queryDoKanban({ ...base, escopo: "eu" })).toBe("?responsavel=eu");
    expect(queryDoKanban({ ...base, escopo: "geral" })).toBe("?responsavel=geral");
  });

  it("etapa, carteira e busca entram só quando preenchidos, com a busca aparada", () => {
    expect(queryDoKanban({ ...base, etapa: "d15_29", carteira: "ex_cliente", busca: "  Maria  " }))
      .toBe("?etapa=d15_29&carteira=ex_cliente&busca=Maria");
    expect(queryDoKanban({ ...base, busca: "   " })).toBe("");
  });
});

describe("a página do kanban", () => {
  it("consome GET /api/cobranca/kanban pela constante compartilhada", () => {
    expect(tipos).toContain('export const API_KANBAN = "/api/cobranca/kanban"');
    expect(pagina).toContain("`${API_KANBAN}${query}`");
    expect(pagina).toContain("lerKanban(data)");
  });

  it("os KPIs vêm do servidor pela fila, nunca contados na página", () => {
    expect(pagina).not.toContain("API_FILA");
    // os indicadores vem do QUADRO (mesmo recorte das colunas); a fila e reserva
    expect(pagina).toContain("const kpis = quadro.kpis;");
    expect(tipos).toContain("kpis: KpisDaFila | null;");
    expect(pagina).toContain("kpis?.casosVivos");
    expect(pagina).toContain("kpis?.vencidos");
    expect(pagina).toContain("kpis?.emAberto");
    expect(pagina).toContain("kpis?.criticos");
    // Contar na página seria `num(itens.length)`, `itens.filter(...)`, `itens.reduce(...)` — como a fila faz.
    expect(pagina).not.toMatch(/num\(itens\.length\)|itens\.filter|itens\.reduce/);
  });

  /**
   * O quadro passa a ser o único lugar do trabalho do dia (pedido do dono,
   * 06/09/2026): o que só a fila entregava — a ordem do dia, o KPI de críticos
   * e o canal sugerido — tem de estar aqui antes de a fila sair.
   */
  it("o KPI de críticos vem do servidor, com o rótulo e a leitura da fila", () => {
    expect(pagina).toContain('rotulo="críticos"');
    expect(pagina).toContain('sub="prioridade crítica"');
    expect(pagina).toContain('valor={isLoading ? "…" : num(kpis?.criticos)}');
    // a rota conta na MESMA varredura dos outros indicadores
    expect(tipos).toContain("criticos: numero(kpisCrus.criticos)");
  });

  it("diz que a coluna vem na ordem do dia, e a ordem é do servidor", () => {
    expect(pagina).toContain('data-testid="ordem-do-dia"');
    expect(pagina).toMatch(/ordem do dia/);
    expect(pagina).toMatch(/contato vencido \(o mais antigo primeiro\)/);
    expect(pagina).toMatch(/sem data — o caso parado/);
    // a página não reordena nada: quem ordena é o SQL da rota
    expect(pagina).not.toMatch(/\.sort\(/);
  });

  it("tem os três escopos do dono: minha fila, toda a equipe e a fila geral", () => {
    expect(pagina).toContain('{ k: "eu", rotulo: "Minha fila" }');
    expect(pagina).toContain('{ k: "todos", rotulo: "Toda a equipe" }');
    expect(pagina).toContain('{ k: "geral", rotulo: "Fila geral" }');
  });

  it("filtra por etapa da régua e carteira, e limpa os filtros", () => {
    expect(pagina).toContain('data-testid="filtro-etapa"');
    expect(pagina).toContain("<NavegacaoCarteiras carteira={carteira}");
    expect(pagina).not.toContain("Ativos e ex-clientes");
    expect(pagina).toContain('data-testid="limpar-filtros-kanban"');
    expect(pagina).toContain('data-testid="busca-kanban"');
  });

  it("abre os três diálogos: contato, negociação e cancelamento", () => {
    expect(pagina).toContain("<DialogoContato");
    expect(pagina).toContain("<DialogoNegociacao");
    expect(pagina).toContain("<DialogoCancelamento");
    expect(pagina).toContain("onNegociar={abrirNegociacao}");
    expect(pagina).toContain("onCancelar={abrirCancelamento}");
  });

  it("respeita a permissão de administrar (com personificação) e avisa quando a régua está pausada", () => {
    expect(pagina).toContain("podeAdministrarCobranca(user, personificando)");
    expect(pagina).toContain('data-testid="aviso-pausada"');
    expect(pagina).toContain('testId="erro-kanban"');
    expect(pagina).toContain('data-testid="kanban-vazio"');
  });

  it("só oferece 'pegar' a quem está logado, e o caso sem dono decide no card", () => {
    expect(pagina).toContain("onPegar: user ? (item: ItemDaFila) => pegar.mutate(item.id) : undefined");
    expect(card).toContain("item.responsavelUserId === null && acoes.onPegar !== undefined");
  });
});

describe("o quadro", () => {
  it("as colunas são o fluxo do operador, não a régua", () => {
    for (const status of ["aberto", "em_contato", "negociando", "acordo_ativo", "pago", "cancelamento"]) {
      expect(movimentos).toContain(`"${status}"`);
    }
  });

  it("o card oferece enviar para cobranca so com o chat pronto, e mostra o selo da conversa quando ja foi enviado", () => {
    expect(pagina).toContain("chatProntoParaEnviar(integracaoDoChat)");
    expect(pagina).toContain("onEnviarParaChat: chatPronto ? (item: ItemDaFila) => enviarParaChat.mutate(item) : undefined");
    expect(pagina).toContain("apiEnviarCasoParaChat(item.id)");
    expect(card).toContain("acoes.onEnviarParaChat && !item.chat");
    expect(card).toContain("card-enviar-chat-${item.id}");
    expect(card).toContain("card-chat-${item.id}");
  });

  it("move com mutation otimista e desfaz no erro", () => {
    expect(quadro).toContain("moverNoQuadro");
    expect(quadro).toContain("onError");
    expect(quadro).toContain("setQueryData");
  });

  it("o card mostra a etapa como selo, não como coluna", () => {
    expect(card).toContain("card-etapa-${item.id}");
    expect(card).toContain("etapaDoCard");
  });

  it("o card diz a faixa do dia e o canal sugerido — o que só a fila mostrava", () => {
    expect(card).toContain("card-faixa-do-dia-${item.id}");
    expect(card).toContain("TOM_DA_FAIXA_DO_DIA[contato.urgencia]");
    expect(card).toContain("card-canal-${item.id}");
    expect(card).toContain("ROTULO_CANAL[etapa.canalSugerido]");
  });
});

describe("fiação", () => {
  it("o App carrega a página e a rota é só de provedor", () => {
    expect(app).toContain('lazy(pagina(() => import("@/pages/cobranca/kanban")))');
    expect(app).toContain('<Route path="/cobranca/kanban" component={CobrancaKanbanPage} />');
    expect(app).toMatch(/"\/cobranca\/fila",\s*"\/cobranca\/kanban"/);
  });

  /**
   * A fila do dia saiu do menu em 06/09/2026 (pedido do dono): o Kanban e o
   * unico destino de trabalho de cada carteira.
   */
  it("cada carteira tem seu Kanban, e a fila nao voltou ao menu", () => {
    for (const c of ["ativo", "ex_cliente"]) expect(sidebar).toContain(`caminhoNaCarteira("/cobranca/kanban", "${c}")`);
    for (const menu of ["ativos", "ex-clientes"]) {
      expect(sidebar).toContain(`testId: "link-cobranca-${menu}-kanban"`);
      expect(sidebar).not.toContain(`testId: "link-cobranca-${menu}-fila"`);
    }
    expect(sidebar).not.toContain("/cobranca/fila");
  });

  /**
   * PENDENTE (fase 3): o botao "Lista" (`link-fila-lista`) continua no
   * cabecalho desta pagina apontando para `ROTA_FILA`. A tela de fila nao
   * existe mais — o endereco so redireciona de volta para ESTE quadro, entao o
   * botao recarrega a propria pagina. Ele sai junto com o import de
   * `ROTA_FILA` e o icone `ListTodo` em `kanban.tsx`; de proposito, nenhum
   * teste trava a permanencia dele.
   */
  it("a carteira abre o quadro, e o endereco antigo da fila so redireciona", () => {
    expect(carteira).toContain('data-testid="link-kanban"');
    expect(carteira).toContain("ROTA_KANBAN");
    expect(app).toContain('<Route path="/cobranca/fila"><RedirecionarFila /></Route>');
    expect(app).not.toContain('import("@/pages/cobranca/fila")');
  });
});

/**
 * ESTEIRA (pedido do dono, 06/09/2026): "o kanban precisa ser uma esteira de
 * resolução da cobrança". A coluna vira POSTO DE TRABALHO — verbo e gargalo —
 * e o topo mostra a VAZÃO do dia, não só o estoque.
 */
describe("a coluna é um posto de trabalho", () => {
  it("o cabeçalho diz o verbo — o que se faz ali para o caso sair", () => {
    expect(quadro).toContain("verboDaColuna(coluna.status)");
    expect(quadro).toContain("coluna-verbo-${coluna.status}");
    expect(quadro).toContain('Para o caso sair de "${coluna.rotulo}": ${verbo}.');
    // coluna fechada não tem verbo: o caso já saiu da esteira
    expect(quadro).toContain("coluna.fechada ? null : verboDaColuna(coluna.status)");
    for (const [status, verbo] of [
      ["aberto", "registrar contato"],
      ["em_contato", "propor acordo"],
      ["negociando", "registrar o aceite"],
      ["acordo_ativo", "conferir a parcela"],
    ]) {
      expect(movimentos).toContain(`${status}: "${verbo}"`);
    }
  });

  it("o cabeçalho conta o que TRAVA: contato vencido, sem próxima ação, sem dono", () => {
    expect(quadro).toContain("contarGargalosDaColuna(coluna.casos, hoje)");
    expect(quadro).toContain("coluna-gargalo-${coluna.status}");
    for (const trava of ["contato vencido", "sem próxima ação", "sem dono"]) expect(quadro).toContain(trava);
    // é o selo retangular do sistema, não um badge novo
    expect(quadro).toContain("<SeloCobranca");
  });

  it("coluna truncada diz que a conta é da PÁGINA, na tela e no title", () => {
    expect(quadro).toContain("coluna.truncado");
    expect(quadro).toContain("é a página, não a coluna inteira");
    expect(quadro).toContain(">na página</span>");
    expect(quadro).toContain('coluna.truncado ? " na página" : ""');
    // a conta é sobre os casos carregados; a página não inventa o que não veio
    expect(quadro).not.toMatch(/contarGargalosDaColuna\(coluna\.total/);
  });

  it("o gargalo só aparece na coluna viva, e coluna vazia não mostra conta nenhuma", () => {
    expect(quadro).toContain("{!coluna.fechada && <GargalosDaColuna coluna={coluna} hoje={hoje} />}");
    expect(quadro).toContain("if (g.base === 0) return null;");
  });
});

describe("o fluxo do dia", () => {
  it("mostra entraram e resolvidos hoje, do servidor", () => {
    expect(pagina).toContain('data-testid="fluxo-do-dia"');
    expect(pagina).toContain('data-testid="fluxo-entraram"');
    expect(pagina).toContain('data-testid="fluxo-resolvidos"');
    expect(pagina).toContain("kpis?.entraramHoje");
    expect(pagina).toContain("kpis?.resolvidosHoje");
    expect(tipos).toContain("entraramHoje: numero(kpisCrus.entraramHoje)");
    expect(tipos).toContain("resolvidosHoje: numero(kpisCrus.resolvidosHoje)");
  });

  it("sem o número do servidor é '—' com o motivo — nunca zero", () => {
    expect(pagina).toContain('typeof n === "number" ? num(n) : TRACO');
    expect(pagina).toContain("MOTIVO_SEM_FLUXO_DO_DIA");
    expect(pagina).toMatch(/Escrever 0 diria que o dia não rendeu/);
    // e os dois motivos são distintos: "a rota não conta ainda" ≠ "o recorte não foi varrido"
    expect(pagina).toContain("MOTIVO_RECORTE_SEM_INDICADORES");
    expect(pagina).toContain("kpis === null ? MOTIVO_RECORTE_SEM_INDICADORES : MOTIVO_SEM_FLUXO_DO_DIA");
    // e a conta não é feita aqui: contar na página daria a conta da página
    expect(pagina).not.toMatch(/colunas\.reduce\([^)]*entrar/i);
  });

  it("os dois números são mono tabular, como todo número do sistema", () => {
    expect(pagina).toMatch(/data-testid="fluxo-entraram"/);
    const trechos = pagina.match(/font-mono text-\[16px\] font-medium tabular-nums/g) ?? [];
    expect(trechos.length).toBe(2);
  });
});

describe("o card leva o verbo da coluna ao botão", () => {
  it("a página passa `onNegociar` para o card, e o card só oferece acordo com ele", () => {
    expect(pagina).toContain("onNegociar: abrirNegociacao");
    expect(card).toContain("acoes.onNegociar !== undefined");
    expect(card).toContain("card-acordo-botao-${item.id}");
  });

  it("em 'negociando' o principal é o acordo; em toda outra coluna, o contato", () => {
    expect(card).toContain('acaoPrincipalDoCard(item.status) === "acordo"');
    expect(movimentos).toContain('return status === "negociando" ? "acordo" : "contato";');
  });
});

describe("os tokens do sistema, sem paleta crua do Tailwind", () => {
  it("nada de cor literal do Tailwind nem de sombra grande no que a esteira acrescentou", () => {
    for (const fonte of [pagina, quadro, card]) {
      expect(fonte).not.toMatch(/\b(bg|text|border)-(slate|gray|zinc|blue|emerald|red|amber|green)-\d{2,3}\b/);
      expect(fonte).not.toMatch(/shadow-(md|lg|xl|2xl)\b/);
    }
  });

  it("o tempo na coluna e o fluxo do dia pintam por token", () => {
    expect(card).toContain("tomDoTempoNaColuna(diasAqui)");
    expect(pagina).toContain("var(--info-bg)");
    expect(pagina).toContain("var(--ok)");
  });
});
