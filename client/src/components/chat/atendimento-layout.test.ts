/**
 * O layout do chat no porte do Provedor.ai, renderizado de verdade (SSR) —
 * não só o texto da fonte. Com o cache já cheio (conversa, multicanal e
 * política), o `Atendimento` precisa sair com:
 *
 *  - a funcionária digital com o nome dela e o selo IA, separada da conta do
 *    provedor (selo EQUIPE) e do cliente (sem cabeçalho);
 *  - a pílula de transferência quando a voz do provedor muda;
 *  - o chip único do dia no topo e o negrito do WhatsApp no corpo;
 *  - o compositor com o aviso do canal no topo, os atalhos (PIX, Parcelar,
 *    360, SMS, e-mail, reforços, próxima ação), a linha de entrada e o rodapé
 *    Sessão → Envio com a janela de contato;
 *  - a ficha do cliente à direita, com o topo e as negociações do caso;
 *  - e, fora do atendimento humano, o aviso "assuma" com o campo travado.
 *
 * E, sem o detalhe da conversa (o serviço caiu, ou ainda está lendo), o aviso do
 * canal continua na tela — é quando o diagnóstico mais importa. A pílula "Envio"
 * só fica verde com envio aceito, e nunca com o canal com problema.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import { POLITICA_PADRAO, TETOS_LEGAIS } from "@shared/cobranca";
import { API_POLITICA } from "@/components/cobranca/tipos";
import type { DadosMulticanal } from "./multicanal";
import { API_ATENDIMENTOS, type DetalheChat } from "./tipos";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ demoMode: false }) }));

import { Atendimento } from "./Atendimento";

const CONVERSA = "conv-77";
const T = (min: number) => new Date(Date.UTC(2026, 8, 17, 12, min)).toISOString();

const dados = (status: string, tom: string | null = null): DetalheChat => ({
  conversa: {
    conversationId: CONVERSA, customerId: 501, casoId: 77, recuperacaoId: null,
    nome: "Ana Souza", telefone: "43999990000", status, ultimoEventoEm: T(20), carteira: "ativo",
  },
  cliente: { id: 501, nome: "Ana Souza", telefone: "43999990000", endereco: null, cidade: "Londrina" },
  cobranca: {
    id: 77, carteira: "ativo", status: "em_contato", valor: 189.9, diasAtraso: 12, quadrante: "B2", tom,
    responsavel: "Paula", proximaAcao: "Aguardar resposta do cliente", proximoContatoEm: T(0),
    orientacao: { etapa: null, agente: "Clara", diretiva: "Lembrete gentil.", proximoPasso: "", propensao: null },
  },
  recuperacao: null,
  equipamentos: [],
  mensagens: [
    { id: "m1", direcao: "OUTBOUND", texto: "Olá, *Ana*! Aqui é a Clara, da Rede Demo.", tipo: "TEXT", status: "READ", quem: "Clara", ia: true, em: T(0) },
    { id: "m2", direcao: "INBOUND", texto: "8909", tipo: "TEXT", status: "RECEIVED", quem: "Ana Souza", em: T(2) },
    { id: "m3", direcao: "OUTBOUND", texto: "Segue a segunda via.", tipo: "TEXT", status: "DELIVERED", quem: "Equipe Rede Demo", ia: false, em: T(20) },
  ],
  pagina: 1,
  temMais: false,
});

const MULTICANAL: DadosMulticanal = {
  mensagens: [],
  canais: { sms: true, email: true },
  propostas: [{ id: 5, rotulo: "Proposta #5 · R$ 120,00" }],
  config: { reforcoAtivo: false, intervaloHoras: 48, canais: ["sms"] },
};

function renderizar(
  status: string,
  {
    detalhe = "ok",
    canalPronto,
    tom = null,
    aoVoltar,
    semProximaAcao = false,
  }: {
    detalhe?: "ok" | "erro" | "carregando" | "releitura-falhou";
    canalPronto?: boolean;
    tom?: string | null;
    aoVoltar?: () => void;
    semProximaAcao?: boolean;
  } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const url = `${API_ATENDIMENTOS}/${encodeURIComponent(CONVERSA)}`;
  const escopo = new URLSearchParams({ origem: "cobranca", carteira: "ativo" }).toString();
  const detalheLido = dados(status, tom);
  if (semProximaAcao && detalheLido.cobranca) detalheLido.cobranca = { ...detalheLido.cobranca, proximaAcao: null, proximoContatoEm: null };
  if (detalhe === "ok") qc.setQueryData([url, escopo], { pages: [detalheLido], pageParams: [1] });
  if (detalhe === "erro" || detalhe === "releitura-falhou")
    // O detalhe depende do fork: CHAT_FALHOU/CHAT_DESLIGADO chegam aqui como erro. Na primeira leitura
    // não há dado nenhum no cache; na releitura de fundo (o intervalo de 10 s) o dado lido antes fica.
    qc.getQueryCache().build(qc, { queryKey: [url, escopo] }).setState({
      status: "error",
      fetchStatus: "idle",
      data: detalhe === "releitura-falhou" ? { pages: [detalheLido], pageParams: [1] } : undefined,
      dataUpdatedAt: detalhe === "releitura-falhou" ? Date.now() - 20_000 : 0,
      error: new Error("502: Não foi possível falar com o serviço de conversas"),
      errorUpdatedAt: Date.now(),
      errorUpdateCount: 1,
      fetchFailureCount: 1,
    });
  qc.setQueryData([`${url}/multicanal?${escopo}`], MULTICANAL);
  qc.setQueryData([API_POLITICA], {
    politica: { ...POLITICA_PADRAO, janelaContato: { ...POLITICA_PADRAO.janelaContato, horaInicio: 8, horaFim: 20 } },
    etapas: [], configurada: true, updatedAt: T(0), tetos: TETOS_LEGAIS, cobertura: null,
  });
  try {
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc },
        createElement(Router, { ssrPath: "/cobranca/chat", ssrSearch: `conversa=${CONVERSA}&carteira=ativo` },
          createElement(Atendimento, {
            conversationId: CONVERSA, origem: "cobranca", carteira: "ativo", canalPronto, aoVoltar,
            avisoDoCanal: createElement("p", { "data-testid": "aviso-do-canal" }, "O WhatsApp não está conectado."),
          }))),
    );
  } finally {
    qc.clear();
  }
}

/** A tag de abertura do elemento com este testid — onde mora a classe dele. */
const tagDo = (html: string, testId: string) => {
  const tag = html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0];
  expect(tag, `não achei ${testId}`).toBeDefined();
  return tag!;
};

const trecho = (html: string, de: string, ate?: string) => {
  const inicio = html.indexOf(de);
  expect(inicio, `não achei ${de}`).toBeGreaterThanOrEqual(0);
  const fim = ate ? html.indexOf(ate, inicio) : html.length;
  return html.slice(inicio, fim < 0 ? html.length : fim);
};

describe("a conversa em atendimento humano", () => {
  const html = renderizar("OPEN");

  it("a funcionária sai com o nome e o selo IA; a conta do provedor, com EQUIPE; o cliente, sem cabeçalho", () => {
    const funcionaria = trecho(html, 'data-testid="chat-autor-funcionaria"', "</p>");
    expect(funcionaria).toContain("Clara");
    expect(funcionaria).toMatch(/>IA</);
    const equipe = trecho(html, 'data-testid="chat-autor-equipe"', "</p>");
    expect(equipe).toContain("Equipe Rede Demo");
    expect(equipe).toContain("Equipe</span>");
    expect(html.match(/data-testid="chat-autor-/g)).toHaveLength(2);
    expect(html.match(/data-testid="chat-balao"/g)).toHaveLength(3);
  });

  it("a troca de voz do provedor vira a pílula de transferência", () => {
    const pilula = trecho(html, 'data-testid="chat-transferencia"', "</p>");
    expect(pilula).toContain("Conversa transferida");
    expect(pilula).toMatch(/Clara<\/b> → <b[^>]*>Equipe Rede Demo/);
  });

  it("um chip de dia no topo; o negrito do WhatsApp vira <strong>", () => {
    expect(html.match(/data-testid="chat-dia"/g)).toHaveLength(1);
    expect(html).toContain('<strong class="font-semibold">Ana</strong>');
  });

  it("o compositor: aviso do canal no topo, atalhos e a linha de entrada", () => {
    const compositor = trecho(html, "<form");
    expect(compositor.indexOf('data-testid="aviso-do-canal"')).toBeLessThan(
      compositor.indexOf('aria-label="Ações complementares da conversa"'),
    );
    const atalhos = trecho(compositor, 'aria-label="Ações complementares da conversa"', 'for="mensagem-');
    for (const rotulo of ["Enviar PIX / 2ª via", "Parcelar", "Cliente 360", "Enviar SMS", "Enviar e-mail", "Reforços · desligados"])
      expect(atalhos).toContain(rotulo);
    // A próxima ação é do envio: fica ao pé do campo, no rodapé, e não entre os atalhos.
    // O "(opcional)" sai só no celular (max-sm:hidden), para a linha do rodapé caber em 44px.
    expect(atalhos).not.toContain("Próxima ação");
    expect(trecho(compositor, 'data-testid="chat-rodape-politica"')).toContain(
      'Próxima ação<span class="max-sm:hidden"> (opcional)</span>',
    );
    expect(compositor).toContain('aria-label="Emojis"');
    expect(compositor).toContain('aria-label="Mensagens rápidas"');
    expect(compositor).toContain('placeholder="Escreva uma mensagem…"');
    expect(compositor).toContain('data-testid="chat-enviar"');
    expect(compositor).not.toContain('data-testid="chat-aviso-assumir"');
  });

  it("o rodapé: Sessão → Envio e a janela de contato da política", () => {
    const rodape = trecho(html, 'data-testid="chat-rodape-politica"');
    expect(rodape).toContain('data-testid="chat-rodape-sessao"');
    expect(rodape).toContain('data-testid="chat-rodape-envio"');
    expect(rodape).toContain("8–20h");
    expect(rodape).toContain("CDC 42");
    expect(rodape).toContain("WhatsApp do provedor · atendimento humano");
    // A janela de contato é texto que se lê: --text-muted, não o --text-faint abaixo de AA.
    expect(rodape).toMatch(/<span class="[^"]*text-\[var\(--text-muted\)\][^"]*"><span>janela de contato<\/span>/);
  });

  it("conversa aberta não é canal pronto: sem envio aceito, a pílula Envio não acende verde", () => {
    const envio = tagDo(html, "chat-rodape-envio");
    expect(envio).not.toContain("--ok");
    expect(envio).toContain("--surface-2");
  });

  it("à direita, a ficha do cliente com o topo, as negociações e o 360 completo", () => {
    const ficha = trecho(html, 'aria-label="Contexto do atendimento"');
    expect(ficha).toContain('data-testid="chat-perfil-topo"');
    expect(ficha).toContain("Proposta #5 · R$ 120,00");
    expect(ficha).toContain('href="/cobranca/cliente/501?carteira=ativo"');
    expect(ficha).toContain("Abrir Cliente 360 completo");
  });

  it("nunca a palavra 'Carregando'", () => {
    expect(html).not.toMatch(/Carregando/);
  });
});

describe("o rodapé do compositor, com texto que se lê", () => {
  it("a região viva da espera do envio existe desde o início, vazia", () => {
    expect(renderizar("OPEN")).toMatch(/<span role="status" class="[^"]*text-\[var\(--text-2\)\][^"]*" data-testid="chat-envio-espera"><\/span>/);
  });

  it("tom acolhedor: o âmbar fica no ícone, e a frase em --text-2", () => {
    const rodape = trecho(renderizar("OPEN", { tom: "humanizado_vulneravel" }), 'data-testid="chat-rodape-politica"');
    const frase = rodape.lastIndexOf("<span", rodape.indexOf("Tom acolhedor · sem pressão"));
    const bloco = rodape.slice(frase, rodape.indexOf("Tom acolhedor · sem pressão"));
    expect(bloco).toMatch(/^<span class="[^"]*text-\[var\(--text-2\)\][^"]*">/);
    expect(bloco.slice(0, bloco.indexOf(">") + 1)).not.toContain("--gated");
    expect(bloco).toMatch(/<svg(?=[^>]*aria-hidden="true")[^>]*text-\[var\(--gated\)\]/);
  });

  it("sem tom acolhedor, a frase não aparece", () => {
    expect(renderizar("OPEN")).not.toContain("Tom acolhedor");
  });
});

describe("o canal com problema, com a conversa aberta", () => {
  const html = renderizar("OPEN", { canalPronto: false });

  it("a pílula Envio pinta atenção e diz por quê — nunca o verde de sucesso", () => {
    const envio = tagDo(html, "chat-rodape-envio");
    expect(envio).not.toContain("--ok");
    expect(envio).toContain("--gated");
    expect(envio).toContain("O canal do WhatsApp está com problema");
  });

  it("em atenção, o texto é --text-2 e o âmbar fica na borda e no ícone (--gated sobre --gated-bg dava ~3,6:1)", () => {
    const envio = tagDo(html, "chat-rodape-envio");
    const classe = envio.match(/class="([^"]*)"/)![1].split(" ");
    expect(classe).toContain("text-[var(--text-2)]");
    expect(classe).toContain("border-[var(--gated)]");
    expect(classe).not.toContain("text-[var(--gated)]");
    const pilula = trecho(html, 'data-testid="chat-rodape-envio"', "</span>");
    expect(pilula).toMatch(/<svg(?=[^>]*aria-hidden="true")[^>]*text-\[var\(--gated\)\]/);
  });
});

describe("a releitura de fundo que falha, com a conversa já na tela (correção 3)", () => {
  it("a conversa fica, com o aviso de histórico desatualizado — nunca a troca pelo 'Não foi possível carregar'", () => {
    const html = renderizar("OPEN", { detalhe: "releitura-falhou" });
    expect(html).toContain('data-testid="atendimento-integrado"');
    expect(html).not.toContain('data-testid="atendimento-carregando"');
    expect(html).not.toContain("Não foi possível carregar");
    // O que já tinha sido lido continua: balões e ficha.
    expect(html.match(/data-testid="chat-balao"/g)).toHaveLength(3);
    expect(html).toContain('data-testid="chat-perfil-topo"');
    // O aviso é alerta, e diz o que fazer.
    expect(html).toMatch(/<p role="alert"[^>]*>(?:(?!<\/p>)[\s\S])*O histórico pode estar desatualizado/);
    // A trava de envio por erro vale: o botão Enviar está desligado.
    expect(tagDo(html, "chat-enviar")).toContain('disabled=""');
  });

  it("com a leitura em dia, o aviso não aparece", () => {
    expect(renderizar("OPEN")).not.toContain("O histórico pode estar desatualizado");
  });

  it("sem dado nenhum, o erro continua sendo o estado da coluna", () => {
    const html = renderizar("OPEN", { detalhe: "erro" });
    expect(html).toContain('data-testid="atendimento-carregando"');
    expect(html).toContain("Não foi possível carregar");
    expect(html).not.toContain("O histórico pode estar desatualizado");
  });
});

describe("o cabeçalho no celular (correção 3)", () => {
  const html = renderizar("OPEN", { aoVoltar: () => {} });
  const cabecalho = trecho(html, "<header", "</header>");

  it("'Mais ações' é um botão de menu só no celular; 'Dados do caso' e 'Devolver' ficam fora dele", () => {
    const mais = tagDo(cabecalho, "chat-mais-acoes");
    expect(mais).toContain('aria-label="Mais ações"');
    expect(mais).toContain('aria-haspopup="menu"');
    expect(mais).toContain("sm:hidden");
    expect(mais).toContain("[@media(pointer:coarse)]:w-11");
    expect(mais).toContain("[@media(pointer:coarse)]:min-h-11");
    expect(mais).toContain("focus-visible:outline-2");
    // O menu fechado não desenha nada: nenhum item no HTML.
    expect(cabecalho).not.toContain("chat-menu-encerrar");
    // Encerrar e atualizar em linha somem abaixo de sm; devolver e "Dados do caso" não.
    expect(tagDo(cabecalho, "chat-encerrar")).toContain("max-sm:hidden");
    expect(tagDo(cabecalho, "chat-devolver-assistente")).not.toContain("hidden");
    const dadosDoCaso = cabecalho.slice(cabecalho.lastIndexOf("<button", cabecalho.indexOf(">Dados do caso<")), cabecalho.indexOf(">Dados do caso<"));
    expect(dadosDoCaso).not.toContain("max-sm:hidden");
    expect(cabecalho).toMatch(/<button[^>]*max-sm:hidden[^>]*aria-label="Atualizar mensagens"/);
  });

  it("fora do atendimento humano, 'Tomar conversa' também fica fora do menu", () => {
    const bot = trecho(renderizar("BOT", { aoVoltar: () => {} }), "<header", "</header>");
    expect(tagDo(bot, "chat-assumir")).not.toContain("hidden");
    expect(bot).toContain('data-testid="chat-mais-acoes"');
  });

  it("o follow-up trunca no celular e leva o texto inteiro no title", () => {
    const followUp = tagDo(cabecalho, "atendimento-followup-atual");
    expect(followUp).toContain("max-sm:truncate");
    expect(followUp).toMatch(/title="próxima ação: Aguardar resposta do cliente · [^"]+ · Paula"/);
    const parado = tagDo(trecho(renderizar("OPEN", { semProximaAcao: true }), "<header", "</header>"), "atendimento-followup-atual");
    expect(parado).toContain('title="caso sem próxima ação — parado na fila"');
  });

  it("a volta às conversas mora no cabeçalho do celular, no lugar do avatar — e só quando a página a manda", () => {
    const voltar = tagDo(cabecalho, "chat-voltar");
    expect(voltar).toContain('aria-label="Voltar às conversas"');
    expect(voltar).toContain("sm:hidden");
    expect(voltar).toContain("[@media(pointer:coarse)]:w-11");
    expect(cabecalho).toMatch(/<span aria-hidden="true" class="[^"]*max-sm:hidden[^"]*">AS<\/span>/);
    // Sem aoVoltar (360, recuperação), nada de volta e o avatar de sempre.
    const semVolta = trecho(renderizar("OPEN"), "<header", "</header>");
    expect(semVolta).not.toContain("chat-voltar");
    expect(semVolta).toMatch(/<span aria-hidden="true" class="(?![^"]*max-sm:hidden)[^"]*">AS<\/span>/);
    // Carregando, sem cabeçalho, a volta fica no topo da coluna.
    expect(trecho(renderizar("OPEN", { detalhe: "carregando", aoVoltar: () => {} }), 'data-testid="atendimento-carregando"')).toContain(
      'data-testid="chat-voltar-carregando"',
    );
  });
});

describe("sem o detalhe da conversa, o aviso do canal não some", () => {
  it("o serviço caiu: o aviso do canal vem antes do 'Não foi possível carregar'", () => {
    const html = renderizar("OPEN", { detalhe: "erro", canalPronto: false });
    const bloco = trecho(html, 'data-testid="atendimento-carregando"');
    expect(bloco).toContain('data-testid="aviso-do-canal"');
    expect(bloco).toContain("Não foi possível carregar");
    expect(bloco.indexOf('data-testid="aviso-do-canal"')).toBeLessThan(bloco.indexOf("Não foi possível carregar"));
    expect(bloco).toContain("Tentar novamente");
    expect(html).not.toContain('data-testid="atendimento-integrado"');
  });

  it("ainda lendo o detalhe: o aviso do canal já está na tela", () => {
    const html = renderizar("OPEN", { detalhe: "carregando", canalPronto: false });
    expect(trecho(html, 'data-testid="atendimento-carregando"')).toContain('data-testid="aviso-do-canal"');
    expect(html).not.toContain("Não foi possível carregar");
  });
});

describe("a conversa fora do atendimento humano", () => {
  const html = renderizar("BOT");

  it("o compositor avisa para assumir e trava o campo; SMS e e-mail não aparecem", () => {
    const aviso = trecho(html, 'data-testid="chat-aviso-assumir"', "</div></div>");
    expect(aviso).toContain("Assuma o atendimento para continuar a conversa.");
    expect(html).toMatch(/<textarea[^>]*disabled=""[^>]*placeholder="Tome a conversa para responder"/);
    expect(html).not.toContain('data-testid="chat-abrir-sms"');
    expect(html).toContain('data-testid="chat-assumir"');
    expect(html).toContain("Tomar conversa");
  });
});
