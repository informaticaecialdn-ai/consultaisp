/**
 * A faixa "O WhatsApp não está conectado" na página de Conversas, renderizada de
 * verdade (SSR) — o texto da fonte não basta, porque o defeito era de ESTADO:
 *
 * Com `?caso=` (o card do quadro abrindo um caso que ainda não tem conversa) a
 * faixa sumia em qualquer largura. A coluna da direita mostrava o skeleton, o
 * erro ou o "Iniciar conversa" sem ela; a lista, escondida no celular, só a
 * trazia com `lg:hidden`. E o "Iniciar conversa" ficava ligado, porque a
 * integração continua `ativo` quando a instância cai depois de configurada
 * (NsLink, 16/09/2026): o operador mandava o primeiro contato por um WhatsApp
 * desconectado, sem aviso nenhum.
 *
 * "Visível" aqui é resolvido pelas classes de exibição de cada ancestral, em
 * duas larguras: celular (só as classes sem prefixo) e mesa de 1600px (todos os
 * breakpoints). Não é um navegador, mas pega exatamente o que escondia a faixa.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import type { DiagnosticoDoChat } from "@shared/chat-diagnostico";
import { API_CHAT_BULLQ, apiConversaDoCaso } from "@/components/cobranca/tipos";
import { API_ATENDIMENTOS } from "@/components/chat/tipos";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ demoMode: false }) }));

import ChatOperacional, { canalImpedeOPrimeiroContato, MOTIVO_CANAL_NAO_PRONTO } from "./chat";

const MENSAGEM_DESCONECTADO =
  "O WhatsApp não está conectado. Conclua o pareamento no Painel do Provedor para receber e enviar mensagens.";

const diagnostico = (codigo: DiagnosticoDoChat["codigo"]): DiagnosticoDoChat => ({
  codigo,
  mensagem: codigo === "PRONTO" ? "Serviço de conversas disponível e WhatsApp conectado." : MENSAGEM_DESCONECTADO,
  servicoDisponivel: true,
  canalConfigurado: true,
  estadoCanal: codigo === "PRONTO" ? "connected" : "disconnected",
});

type EstadoDaLeitura = "ok" | "carregando" | "erro";

/** Põe a leitura no cache num estado de erro, sem dado — como a query fica quando a rota falha. */
function comErro(qc: QueryClient, queryKey: unknown[]) {
  qc.getQueryCache().build(qc, { queryKey }).setState({
    status: "error",
    fetchStatus: "idle",
    data: undefined,
    error: new Error("500: falhou"),
    errorUpdatedAt: Date.now(),
    errorUpdateCount: 1,
    fetchFailureCount: 1,
  });
}

function renderizar({
  busca,
  canal = "AGUARDANDO_CONEXAO",
  leituraDoCanal = "ok",
  conversaDoCaso = "ok",
}: {
  busca: string;
  canal?: DiagnosticoDoChat["codigo"];
  leituraDoCanal?: EstadoDaLeitura;
  conversaDoCaso?: EstadoDaLeitura;
}) {
  // `retryOnMount: false`: a leitura do caso é `enabled` na página, e sem isto o React Query mostra o erro semeado como "carregando".
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, enabled: false } } });
  qc.setQueryData([`${API_ATENDIMENTOS}?origem=cobranca&pagina=1&carteira=ativo`], { itens: [], temMais: false });
  const chaveDoCanal = [`${API_CHAT_BULLQ}/integracao/diagnostico`];
  if (leituraDoCanal === "ok") qc.setQueryData(chaveDoCanal, diagnostico(canal));
  if (leituraDoCanal === "erro") comErro(qc, chaveDoCanal);
  // A integração segue `ativo` com o número configurado: é o estado da NsLink quando a instância caiu.
  qc.setQueryData([`${API_CHAT_BULLQ}/integracao`], {
    ligado: true, provisionado: true, canal: { id: "canal-1", nome: "NsLink" }, status: "ativo", ultimoErro: null,
  });
  const chaveDoCaso = [`${apiConversaDoCaso(77)}?carteira=ativo`];
  // 404 da rota vira `null`: o caso não tem conversa.
  if (conversaDoCaso === "ok") qc.setQueryData(chaveDoCaso, null);
  if (conversaDoCaso === "erro") comErro(qc, chaveDoCaso);
  try {
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc },
        createElement(Router, { ssrPath: "/cobranca/chat", ssrSearch: busca }, createElement(ChatOperacional))),
    );
  } finally {
    qc.clear();
  }
}

/* ── Visibilidade pelas classes dos ancestrais ────────────────────────── */

const ELEMENTOS_VAZIOS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const EXIBICAO = new Set(["hidden", "flex", "inline-flex", "block", "inline-block", "inline", "grid", "inline-grid", "contents", "table"]);
const LARGURA_DO_PREFIXO: Record<string, number> = { "": 0, sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };
const LARGURAS = { celular: 375, mesa: 1600 } as const;

/** As classes do elemento com este testid e de todos os ancestrais dele. */
function classesDaLinhagem(html: string, testId: string): string[][] {
  const posicao = html.indexOf(`data-testid="${testId}"`);
  expect(posicao, `não achei ${testId}`).toBeGreaterThanOrEqual(0);
  const inicioDoAlvo = html.lastIndexOf("<", posicao);
  const pilha: { tag: string; classes: string[] }[] = [];
  const tag = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  for (let m = tag.exec(html); m && m.index <= inicioDoAlvo; m = tag.exec(html)) {
    const [, fecha, nome, atributos, autoFechada] = m;
    if (fecha) {
      const aberta = pilha.map((p) => p.tag).lastIndexOf(nome);
      if (aberta >= 0) pilha.length = aberta;
      continue;
    }
    const classes = (atributos.match(/\sclass="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
    // O próprio alvo entra na linhagem, mesmo que seja vazio.
    if (m.index === inicioDoAlvo) {
      pilha.push({ tag: nome, classes });
      break;
    }
    if (autoFechada || ELEMENTOS_VAZIOS.has(nome.toLowerCase())) continue;
    pilha.push({ tag: nome, classes });
  }
  return pilha.map((p) => p.classes);
}

/** A exibição que vale nesta largura: a classe do maior breakpoint que se aplica. */
function escondidoNaLargura(classes: string[], largura: number): boolean {
  let vale: string | null = null;
  let de = -1;
  for (const classe of classes) {
    const partes = classe.split(":");
    const utilitario = partes[partes.length - 1];
    if (!EXIBICAO.has(utilitario)) continue;
    const prefixo = partes.slice(0, -1).join(":");
    const arbitrario = prefixo.match(/^min-\[(\d+)px\]$/);
    const minimo = arbitrario ? Number(arbitrario[1]) : LARGURA_DO_PREFIXO[prefixo];
    if (minimo === undefined || minimo > largura) continue;
    if (minimo >= de) {
      vale = utilitario;
      de = minimo;
    }
  }
  return vale === "hidden";
}

const visivel = (html: string, testId: string, largura: keyof typeof LARGURAS) =>
  classesDaLinhagem(html, testId).every((classes) => !escondidoNaLargura(classes, LARGURAS[largura]));

const tagDo = (html: string, testId: string) => {
  const aberta = html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0];
  expect(aberta, `não achei ${testId}`).toBeDefined();
  return aberta!;
};

describe("o próprio medidor de visibilidade", () => {
  it("resolve o breakpoint: `hidden lg:flex` some no celular e aparece na mesa; `lg:hidden`, o contrário", () => {
    expect(escondidoNaLargura(["hidden", "lg:flex"], 375)).toBe(true);
    expect(escondidoNaLargura(["hidden", "lg:flex"], 1600)).toBe(false);
    expect(escondidoNaLargura(["lg:hidden"], 375)).toBe(false);
    expect(escondidoNaLargura(["lg:hidden"], 1600)).toBe(true);
    expect(escondidoNaLargura(["overflow-hidden", "flex"], 375)).toBe(false);
    expect(escondidoNaLargura(["min-[1400px]:hidden"], 1600)).toBe(true);
  });

  it("a lista, antes da correção, escondia o aviso nas duas larguras com `?caso=`", () => {
    // É a prova do achado: a faixa da lista existe no HTML, mas não aparece em largura nenhuma.
    const html = renderizar({ busca: "caso=77&carteira=ativo" });
    expect(html).toContain('data-testid="chat-diagnostico-transporte-lista"');
    expect(visivel(html, "chat-diagnostico-transporte-lista", "celular")).toBe(false);
    expect(visivel(html, "chat-diagnostico-transporte-lista", "mesa")).toBe(false);
  });
});

describe("o caso que chegou do quadro, com o WhatsApp desconectado", () => {
  it("sem conversa: a faixa aparece no celular e na mesa, acima do 'Iniciar conversa'", () => {
    const html = renderizar({ busca: "caso=77&carteira=ativo" });
    expect(visivel(html, "chat-diagnostico-transporte", "celular")).toBe(true);
    expect(visivel(html, "chat-diagnostico-transporte", "mesa")).toBe(true);
    expect(html).toContain(MENSAGEM_DESCONECTADO);
    expect(html).toContain("Configurar WhatsApp");
    expect(html.indexOf('data-testid="chat-diagnostico-transporte"')).toBeLessThan(html.indexOf('data-testid="caso-sem-conversa"'));
  });

  it("sem conversa: 'Iniciar conversa' fica desligado e diz por quê — um link para o WhatsApp só, o do aviso", () => {
    const html = renderizar({ busca: "caso=77&carteira=ativo" });
    const botao = tagDo(html, "iniciar-conversa");
    expect(botao).toMatch(/\sdisabled=""/);
    expect(botao).toContain(`title="${MOTIVO_CANAL_NAO_PRONTO}"`);
    const motivo = html.slice(html.indexOf('data-testid="motivo-sem-conversa"'));
    expect(motivo.slice(0, motivo.indexOf("</p>"))).toContain(MOTIVO_CANAL_NAO_PRONTO);
    expect(motivo.slice(0, motivo.indexOf("</p>"))).not.toContain("Conectar o WhatsApp");
  });

  it("ainda lendo se o caso tem conversa: a faixa já está na tela, antes do skeleton", () => {
    const html = renderizar({ busca: "caso=77&carteira=ativo", conversaDoCaso: "carregando" });
    expect(html).not.toContain('data-testid="caso-sem-conversa"');
    expect(visivel(html, "chat-diagnostico-transporte", "celular")).toBe(true);
    expect(visivel(html, "chat-diagnostico-transporte", "mesa")).toBe(true);
    expect(html.indexOf('data-testid="chat-diagnostico-transporte"')).toBeLessThan(html.indexOf('aria-busy="true"'));
  });

  it("a leitura do caso falhou: a faixa continua, acima do erro", () => {
    const html = renderizar({ busca: "caso=77&carteira=ativo", conversaDoCaso: "erro" });
    expect(visivel(html, "chat-diagnostico-transporte", "celular")).toBe(true);
    expect(visivel(html, "chat-diagnostico-transporte", "mesa")).toBe(true);
    expect(html.indexOf('data-testid="chat-diagnostico-transporte"')).toBeLessThan(html.indexOf('data-testid="erro-conversa-do-caso"'));
  });
});

describe("o caso com o canal pronto, ou sem prova de problema", () => {
  it("canal pronto: sem faixa, e 'Iniciar conversa' ligado", () => {
    const html = renderizar({ busca: "caso=77&carteira=ativo", canal: "PRONTO" });
    expect(html).not.toContain('data-testid="chat-diagnostico-transporte"');
    expect(html).not.toContain('data-testid="chat-coluna-aviso-do-canal"');
    const botao = tagDo(html, "iniciar-conversa");
    expect(botao).not.toMatch(/\sdisabled=""/);
    expect(botao).toContain('title="Envia o primeiro contato e abre a conversa"');
  });

  it("conexão não confirmada: a faixa aparece, mas o botão não acusa o que não sabe", () => {
    const html = renderizar({ busca: "caso=77&carteira=ativo", canal: "CONEXAO_NAO_CONFIRMADA" });
    expect(visivel(html, "chat-diagnostico-transporte", "celular")).toBe(true);
    expect(tagDo(html, "iniciar-conversa")).not.toMatch(/\sdisabled=""/);
  });

  it("a verificação do canal falhou: a faixa diz que não confirmou, e o botão fica", () => {
    const html = renderizar({ busca: "caso=77&carteira=ativo", leituraDoCanal: "erro" });
    expect(visivel(html, "chat-diagnostico-transporte", "mesa")).toBe(true);
    expect(html).toContain("Não foi possível verificar a conexão do chat");
    expect(tagDo(html, "iniciar-conversa")).not.toMatch(/\sdisabled=""/);
  });
});

describe("sem nada aberto, em toda largura há uma faixa visível", () => {
  it("no celular, a da lista; na mesa, a da coluna", () => {
    const html = renderizar({ busca: "carteira=ativo" });
    expect(visivel(html, "chat-diagnostico-transporte-lista", "celular")).toBe(true);
    expect(visivel(html, "chat-diagnostico-transporte", "mesa")).toBe(true);
  });
});

describe("canalImpedeOPrimeiroContato", () => {
  it("só o que PROVA que a mensagem não sai trava o botão", () => {
    expect(canalImpedeOPrimeiroContato(undefined)).toBe(false);
    for (const codigo of ["PRONTO", "CONEXAO_NAO_CONFIRMADA", "RESPOSTA_INVALIDA"] as const)
      expect(canalImpedeOPrimeiroContato(diagnostico(codigo)), codigo).toBe(false);
    for (const codigo of ["CHAT_DESLIGADO", "SEM_CONFIGURACAO", "SERVICO_INDISPONIVEL", "ACESSO_RECUSADO", "SEM_CANAL", "CANAL_INATIVO", "AGUARDANDO_CONEXAO"] as const)
      expect(canalImpedeOPrimeiroContato(diagnostico(codigo)), codigo).toBe(true);
  });
});
