/**
 * A política no cache do React Query tem UM formato: a resposta crua do GET.
 *
 * O bug (produção, não só demo): o Atendimento lia `[API_POLITICA]` com uma
 * `queryFn` própria que já devolvia a `Politica` convertida, enquanto o 360, o
 * kanban e a aba Cobrança do painel usam a MESMA chave com o fetcher padrão —
 * que guarda `{ politica, etapas, configurada, ... }`. Chave é endereço de
 * cache, não de função: quem lia primeiro decidia o formato para todo mundo.
 * Abrindo o 360 de um cliente com conversa, o 360 enchia o cache com a
 * resposta crua, o Atendimento a recebia como se fosse `Politica`, e a prévia
 * da negociação lia `politica.negociacao.descontoMaxPct` de undefined — a
 * página inteira caía no ErrorBoundary. Silenciosamente, o rodapé também
 * perdia a janela de contato do provedor.
 *
 * Aqui o Atendimento é renderizado de verdade (SSR) com o cache já preenchido
 * pela resposta crua, na ordem em que o 360 o deixa. E a fonte de `client/src`
 * é varrida para que nenhuma leitura dessa chave volte a trazer `queryFn` ou
 * `select` próprio.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import { POLITICA_PADRAO, TETOS_LEGAIS } from "@shared/cobranca";
import { API_POLITICA } from "@/components/cobranca/tipos";
import { API_ATENDIMENTOS, type DetalheChat } from "./tipos";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ demoMode: false }) }));

import { Atendimento } from "./Atendimento";

const AGORA = "2026-09-12T11:30:00.000Z";
const CONVERSA = "conv-24237";

/** O corpo de `GET /api/cobranca/politica`, como o servidor manda — com uma janela que é do provedor, não a de fábrica. */
const RESPOSTA_CRUA = {
  politica: { ...POLITICA_PADRAO, janelaContato: { ...POLITICA_PADRAO.janelaContato, horaInicio: 9, horaFim: 18 } },
  etapas: [],
  configurada: true,
  updatedAt: AGORA,
  tetos: TETOS_LEGAIS,
  cobertura: null,
};

const DADOS: DetalheChat = {
  conversa: {
    conversationId: CONVERSA, customerId: 24237, casoId: 77, recuperacaoId: null,
    nome: "Ana Silva", telefone: "43999990000", status: "OPEN", ultimoEventoEm: AGORA, carteira: "ex_cliente",
  },
  cliente: { id: 24237, nome: "Ana Silva", telefone: "43999990000", endereco: null, cidade: "Londrina" },
  // Com caso: é o que liga o botão Parcelar e entrega a política ao diálogo de negociação.
  cobranca: {
    id: 77, carteira: "ex_cliente", status: "em_contato", valor: 389.7, diasAtraso: 64, quadrante: null, tom: null,
    responsavel: null, proximaAcao: null, proximoContatoEm: null,
    orientacao: { etapa: null, agente: "Sofia", diretiva: "", proximoPasso: "", propensao: null },
  },
  recuperacao: null,
  equipamentos: [],
  mensagens: [{ id: "m1", direcao: "in", texto: "Oi", tipo: "text", status: "read", quem: "Ana Silva", em: AGORA }],
  pagina: 1,
  temMais: false,
};

/** O Atendimento montado sobre um cache que OUTRA tela já encheu com a política crua. */
function renderizarComCacheDo360() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  qc.setQueryData([API_POLITICA], RESPOSTA_CRUA);
  const url = `${API_ATENDIMENTOS}/${encodeURIComponent(CONVERSA)}`;
  const escopo = new URLSearchParams({ origem: "cobranca", carteira: "ex_cliente" }).toString();
  qc.setQueryData([url, escopo], { pages: [DADOS], pageParams: [1] });
  try {
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc },
        createElement(Router, { ssrPath: "/cobranca/cliente/24237", ssrSearch: "carteira=ex_cliente" },
          createElement(Atendimento, { conversationId: CONVERSA, origem: "cobranca", carteira: "ex_cliente" }))),
    );
  } finally {
    qc.clear();
  }
}

describe("a política crua no cache não derruba o atendimento", () => {
  it("renderiza o atendimento em vez de cair no ErrorBoundary", () => {
    const html = renderizarComCacheDo360();
    expect(html).toContain('data-testid="atendimento-integrado"');
  });

  it("o rodapé mostra a janela de contato que está DENTRO da resposta crua", () => {
    const html = renderizarComCacheDo360();
    const rodape = html.slice(html.indexOf('data-testid="chat-rodape-politica"'));
    expect(rodape).toContain("9–18h");
  });
});

/* ── Trava da fonte: toda leitura de [API_POLITICA] usa o fetcher padrão ── */

const RAIZ = join(__dirname, "..", "..");

function fontesDoClient(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) fontesDoClient(p, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** O objeto de opções de cada `useQuery(...)` cuja chave é `[API_POLITICA]`. */
function leiturasDaPolitica(): Array<{ arquivo: string; opcoes: string }> {
  const achadas: Array<{ arquivo: string; opcoes: string }> = [];
  for (const arquivo of fontesDoClient(RAIZ)) {
    const fonte = readFileSync(arquivo, "utf8");
    const chamada = /\buse(?:Infinite|Suspense)?Query\s*(?:<[^(]*?>)?\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = chamada.exec(fonte))) {
      let i = m.index + m[0].length;
      let profundidade = 1;
      const inicio = i;
      while (i < fonte.length && profundidade > 0) {
        if ("([{".includes(fonte[i])) profundidade++;
        else if (")]}".includes(fonte[i])) profundidade--;
        i++;
      }
      const opcoes = fonte.slice(inicio, i - 1);
      if (/queryKey\s*:\s*\[\s*API_POLITICA\s*\]/.test(opcoes)) {
        achadas.push({ arquivo: relative(RAIZ, arquivo).split("\\").join("/"), opcoes });
      }
    }
  }
  return achadas;
}

describe("uma chave, um formato", () => {
  it("nenhuma leitura de [API_POLITICA] transforma o dado no queryFn ou no select", () => {
    const leituras = leiturasDaPolitica();
    // A varredura acha as quatro telas conhecidas — senão ela passaria sem ler nada.
    expect(leituras.map(l => l.arquivo).sort()).toEqual(expect.arrayContaining([
      "components/chat/Atendimento.tsx",
      "components/painel/AbaCobranca.tsx",
      "pages/cobranca/cliente360.tsx",
      "pages/cobranca/kanban.tsx",
    ]));
    for (const { arquivo, opcoes } of leituras) {
      expect({ arquivo, queryFn: /\bqueryFn\s*:/.test(opcoes) }).toEqual({ arquivo, queryFn: false });
      expect({ arquivo, select: /\bselect\s*:/.test(opcoes) }).toEqual({ arquivo, select: false });
    }
  });
});
