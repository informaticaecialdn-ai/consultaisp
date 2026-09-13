/**
 * A aba Chat RENDERIZADA (SSR), com e sem a demonstração.
 *
 * Na demonstração não existe inbox externo: o chat simulado recusa a senha do
 * dono com 403, e a aba mandava o visitante entrar em chat.consultaisp.com.br
 * com uma senha que ninguém guarda. Com `demoMode` a aba avisa que o inbox não
 * existe ali e o formulário fica desligado; fora da demonstração ela sai como
 * sempre saiu.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import { API_CHAT_BULLQ } from "@/components/cobranca/tipos";

const auth = vi.hoisted(() => ({ demoMode: false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ demoMode: auth.demoMode }) }));

import { AbaChat } from "./AbaChat";

/** O corpo de `GET /api/chat-bullq/integracao` de um provedor provisionado, sem número ligado. */
function integracao(demoMode: boolean) {
  return {
    ligado: true, provisionado: true, organizationId: "demo-org-6", ownerEmail: "admin@sandbox-6.demo.invalid",
    canal: null, status: "provisionado", ultimoErro: null,
    // Na demonstração a ponte devolve o inbox vazio (`urlDoInbox`); fora dela, o endereço de produção.
    inboxUrl: demoMode ? "" : "https://chat.consultaisp.com.br/inbox",
  };
}

function abaEmHtml(demoMode: boolean): string {
  auth.demoMode = demoMode;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  qc.setQueryData([`${API_CHAT_BULLQ}/integracao`], integracao(demoMode));
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc },
      createElement(Router, { ssrPath: "/painel-provedor", ssrSearch: "tab=chat" }, createElement(AbaChat, { podeAdministrar: true }))),
  );
  qc.clear();
  return html;
}

const tag = (html: string, testId: string) => html.match(new RegExp(`<(?:input|button)[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

describe("aba Chat renderizada", () => {
  it("na demonstração: avisa que o inbox externo não existe, não promete chat.consultaisp.com.br e desliga o formulário de senha", () => {
    const html = abaEmHtml(true);
    expect(html).toContain("O inbox externo não existe na demonstração");
    expect(html).not.toContain("chat.consultaisp.com.br");
    expect(html).not.toContain("O inbox externo fica disponível");
    expect(tag(html, "chat-senha-nova")).toContain('disabled=""');
    expect(tag(html, "chat-senha-confirmacao")).toContain('disabled=""');
    expect(tag(html, "chat-definir-senha")).toContain('disabled=""');
    expect(html).not.toContain('data-testid="link-inbox-chat"');
  });

  it("fora da demonstração: o inbox e a senha saem como antes, com o formulário ligado para o administrador", () => {
    const html = abaEmHtml(false);
    expect(html).toContain("chat.consultaisp.com.br");
    expect(html).toContain("O inbox externo fica disponível para administrar canais e recursos adicionais.");
    expect(html).not.toContain("não existe na demonstração");
    expect(tag(html, "chat-senha-nova")).not.toContain("disabled");
    expect(tag(html, "chat-senha-confirmacao")).not.toContain("disabled");
    expect(html).toContain('data-testid="link-inbox-chat"');
  });
});
