/**
 * O chat da retirada no drawer do kanban de recuperação.
 *
 * Dois defeitos que valiam para provedor real. O primeiro: o drawer montava o
 * chat para qualquer caso, e o chat oferecia "Iniciar contato" até em caso
 * recuperado ou baixado — um botão que o servidor sempre recusa (409), porque
 * caso encerrado não tem retirada a combinar. O segundo: no 409 a tela trocava
 * o motivo que o servidor escreveu por "Confira a integração", mandando o
 * operador procurar defeito numa integração que estava funcionando.
 *
 * O componente é renderizado de verdade por SSR, com a conversa já no cache
 * (sem rede). O erro do "iniciar" não dá para produzir em SSR — a mutação só
 * falha depois de um clique —, então a frase do alerta é provada pela função
 * que o componente usa, alimentada pelo mesmo `erroDaResposta` que o
 * `apiRequest` usa com o corpo real da rota, e a ligação é travada na fonte.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { erroDaResposta } from "@/lib/queryClient";
import { avisoDoChat, ChatDaRecuperacao } from "./ChatDaRecuperacao";

const CASO = 7;

function renderizar(props: { encerrado: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  // Caso ainda sem conversa: é aqui que o botão de iniciar aparece (ou não).
  queryClient.setQueryData([`/api/chat-bullq/recuperacao/${CASO}/conversa`], null);
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient },
      createElement(ChatDaRecuperacao, { casoId: CASO, ...props })),
  );
  queryClient.clear();
  return html;
}

describe("ChatDaRecuperacao — caso encerrado", () => {
  it("caso aberto sem conversa oferece iniciar o contato", () => {
    expect(renderizar({ encerrado: false })).toContain("Iniciar contato");
  });

  it("caso encerrado não oferece iniciar contato e diz por quê", () => {
    const html = renderizar({ encerrado: true });
    expect(html).not.toContain("Iniciar contato");
    expect(html).toContain("Caso encerrado");
  });

  it("o drawer passa ao chat a regra de encerrado do kanban", () => {
    const fonte = readFileSync(path.resolve(__dirname, "../recuperacao/DrawerCaso.tsx"), "utf8");
    expect(fonte).toMatch(/<ChatDaRecuperacao\b[^>]*\bencerrado=\{encerrado\}/);
    expect(fonte).toMatch(/const encerrado = card \? ehColunaEncerrada\(card\.coluna\) : false;/);
  });
});

describe("ChatDaRecuperacao — erro ao iniciar", () => {
  it("no 409 mostra o motivo do servidor, não o palpite de integração", () => {
    // Corpo exato que `falha()` em chat-bullq.routes.ts devolve para ErroDaPonteDoChat CONFLITO.
    const erro = erroDaResposta(409, JSON.stringify({
      message: "Revise o caso encerrado ou contestado antes do contato", codigo: "CONFLITO",
    }));
    const aviso = avisoDoChat(erro, false);
    expect(aviso).toBe("Revise o caso encerrado ou contestado antes do contato");
    expect(aviso).not.toContain("integração");
  });

  it("sem frase do servidor cai no aviso genérico", () => {
    expect(avisoDoChat(new Error(""), false)).toContain("Não foi possível abrir o chat");
  });

  it("falha ao ler a conversa continua com o aviso genérico; sem erro, sem aviso", () => {
    expect(avisoDoChat(null, true)).toContain("Não foi possível abrir o chat");
    expect(avisoDoChat(null, false)).toBeNull();
  });

  it("o alerta do componente usa o erro da mutação", () => {
    const fonte = readFileSync(path.resolve(__dirname, "ChatDaRecuperacao.tsx"), "utf8");
    expect(fonte).toMatch(/avisoDoChat\(\s*iniciar\.error/);
  });
});
