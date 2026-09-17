/**
 * A linha da lista de Conversas renderizada de verdade (SSR), na fidelidade da
 * referência do Provedor.ai (correção 3, 17/09/2026): a terceira linha — a dos
 * selos — só existe quando há o que dizer. Conversa no curso normal (aberta, com
 * agente, aguardando o cliente) fica em duas linhas; escalada e encerrada ganham
 * o selo de estado; sem histórico, o selo "sem histórico".
 *
 * E a carteira: na cobrança a lista já é de uma carteira só, então o selo sai;
 * em equipamentos ela mistura clientes e ex-clientes, e o selo fica — na segunda
 * linha, à direita, sem abrir a terceira.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import { API_CHAT_BULLQ } from "@/components/cobranca/tipos";
import { API_ATENDIMENTOS, type ResumoChat } from "@/components/chat/tipos";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ demoMode: false }) }));

import ChatOperacional from "./chat";

const EM = "2026-09-17T12:00:00.000Z";

const linha = (conversationId: string, status: string, extra: Partial<ResumoChat> = {}): ResumoChat => ({
  conversationId, customerId: 1, casoId: 1, recuperacaoId: null, nome: `Cliente ${conversationId}`,
  telefone: "43999990000", status, ultimoEventoEm: EM, carteira: "ativo", ...extra,
});

const ITENS: ResumoChat[] = [
  linha("aberta", "OPEN"),
  linha("agente", "BOT"),
  linha("aguardando", "WAITING"),
  linha("escalada", "PENDING"),
  linha("encerrada", "CLOSED"),
  linha("sem-historico", "BOT", { ultimoEventoEm: null }),
  linha("ex-cliente", "OPEN", { carteira: "ex_cliente" }),
];

function renderizar(origem: "cobranca" | "equipamentos") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const url =
    origem === "cobranca"
      ? `${API_ATENDIMENTOS}?origem=cobranca&pagina=1&carteira=ativo`
      : `${API_ATENDIMENTOS}?origem=equipamentos&pagina=1`;
  qc.setQueryData([url], { itens: ITENS, temMais: false });
  qc.setQueryData([`${API_CHAT_BULLQ}/integracao/diagnostico`], {
    codigo: "PRONTO", mensagem: "ok", servicoDisponivel: true, canalConfigurado: true, estadoCanal: "connected",
  });
  try {
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc },
        createElement(Router, { ssrPath: origem === "cobranca" ? "/cobranca/chat" : "/equipamentos/chat", ssrSearch: origem === "cobranca" ? "carteira=ativo" : "" },
          createElement(ChatOperacional))),
    );
  } finally {
    qc.clear();
  }
}

/** O HTML de cada linha da fila, na ordem. */
const linhas = (html: string) => {
  const partes = html.split('data-testid="fila-chat-linha"').slice(1);
  expect(partes).toHaveLength(ITENS.length);
  return Object.fromEntries(ITENS.map((item, i) => [item.conversationId, partes[i].slice(0, partes[i].indexOf("</button>"))]));
};

describe("a linha de selos da lista, como na referência", () => {
  const cobranca = linhas(renderizar("cobranca"));

  it("no curso normal (aberta, com agente, aguardando o cliente) a linha fica em duas: nenhum selo", () => {
    for (const id of ["aberta", "agente", "aguardando"]) {
      expect(cobranca[id], id).not.toContain('data-testid="fila-chat-selos"');
      // O estado não some para o leitor de tela.
      expect(cobranca[id], id).toMatch(/<span class="sr-only"> · (Atendimento humano|Com agente|Aguardando cliente)<\/span>/);
    }
  });

  it("escalada e encerrada ganham a linha com o selo de estado", () => {
    const selos = (id: string) => cobranca[id].slice(cobranca[id].indexOf('data-testid="fila-chat-selos"'));
    expect(cobranca.escalada).toContain('data-testid="fila-chat-selos"');
    expect(selos("escalada")).toContain("Aguardando atendente");
    expect(cobranca.encerrada).toContain('data-testid="fila-chat-selos"');
    expect(selos("encerrada")).toContain("Encerrada");
    expect(cobranca.escalada).not.toContain('class="sr-only"> · Aguardando atendente');
  });

  it("sem histórico abre a linha só com esse selo, mesmo com a conversa no curso normal", () => {
    const selos = cobranca["sem-historico"].slice(cobranca["sem-historico"].indexOf('data-testid="fila-chat-selos"'));
    expect(cobranca["sem-historico"]).toContain('data-testid="fila-chat-selos"');
    expect(selos).toContain("sem histórico");
    expect(selos).not.toMatch(/>Com agente<\/span>/);
  });

  it("na cobrança nenhuma linha repete o selo da carteira: a lista já é de uma carteira só", () => {
    for (const [id, html] of Object.entries(cobranca)) expect(html, id).not.toMatch(/>(Cliente|Ex-clientes?)<\/span>/);
  });

  it("em equipamentos a carteira aparece na segunda linha, sem abrir a terceira", () => {
    const equipamentos = linhas(renderizar("equipamentos"));
    expect(equipamentos["ex-cliente"]).not.toContain('data-testid="fila-chat-selos"');
    expect(equipamentos["ex-cliente"]).toMatch(/title="Carteira fixada na abertura do caso"[^>]*>Ex-clientes?<\/span>/);
    expect(equipamentos.aberta).toMatch(/title="Carteira fixada na abertura do caso"[^>]*>Cliente<\/span>/);
  });
});
