/**
 * O kanban de cobrança — o que a tela promete e a fiação que a expõe.
 *
 * O vitest daqui não monta .tsx, então estes testes travam o CONTRATO pelo
 * fonte: a página consome a rota certa, com os parâmetros que o servidor
 * aceita; os KPIs vêm do servidor, e não de `itens.length`; o quadro está
 * ligado no App, na sidebar e na fila. `queryDoKanban` é lógica pura e roda
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
const sidebar = ler("../../components/app-sidebar.tsx");
const fila = ler("./fila.tsx");
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
    expect(pagina).toContain("lerRespostaDaFila(filaCrua)");
    expect(pagina).toContain("kpis?.casosVivos");
    expect(pagina).toContain("kpis?.vencidos");
    expect(pagina).toContain("kpis?.emAberto");
    // Contar na página seria `num(itens.length)`, `itens.filter(...)`, `itens.reduce(...)` — como a fila faz.
    expect(pagina).not.toMatch(/num\(itens\.length\)|itens\.filter|itens\.reduce/);
  });

  it("tem os três escopos do dono: minha fila, toda a equipe e a fila geral", () => {
    expect(pagina).toContain('{ k: "eu", rotulo: "Minha fila" }');
    expect(pagina).toContain('{ k: "todos", rotulo: "Toda a equipe" }');
    expect(pagina).toContain('{ k: "geral", rotulo: "Fila geral" }');
  });

  it("filtra por etapa da régua e carteira, e limpa os filtros", () => {
    expect(pagina).toContain('data-testid="filtro-etapa"');
    expect(pagina).toContain('data-testid="filtro-carteira"');
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
});

describe("fiação", () => {
  it("o App carrega a página e a rota é só de provedor", () => {
    expect(app).toContain('lazy(pagina(() => import("@/pages/cobranca/kanban")))');
    expect(app).toContain('<Route path="/cobranca/kanban" component={CobrancaKanbanPage} />');
    expect(app).toMatch(/"\/cobranca\/fila",\s*"\/cobranca\/kanban"/);
  });

  it("a sidebar tem o item Kanban ao lado da Fila do dia", () => {
    expect(sidebar).toContain('url: "/cobranca/kanban"');
    expect(sidebar).toContain('testId: "link-cobranca-kanban"');
    expect(sidebar).toContain('testId: "link-cobranca-fila"');
  });

  it("a fila e o kanban apontam um para o outro", () => {
    expect(fila).toContain('data-testid="link-kanban"');
    expect(fila).toContain("ROTA_KANBAN");
    expect(pagina).toContain('data-testid="link-fila-lista"');
    expect(pagina).toContain("ROTA_FILA");
  });
});
