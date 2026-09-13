/**
 * O link do WhatsApp na demonstração pública e fora dela.
 *
 * O número do cliente do sandbox é fictício, mas plausível: `wa.me/55…`
 * abria conversa com quem tiver aquele número de verdade, a partir do Painel
 * do caso e do Cliente 360. Na demo o ícone continua no mesmo lugar, mas não
 * sai: com conversa simulada leva a ela, sem conversa vira botão que explica.
 * Fora da demo, o `<a>` de sempre, byte a byte.
 *
 * `useAuth` é trocado por um estado controlado: o AuthProvider real só
 * preenche `demoMode` por fetch num efeito, que o SSR não roda.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ demoMode: false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth }));

import { AVISO_WHATSAPP_SIMULADO, LinkWhatsapp } from "./ui";

/** O HTML de antes desta mudança, capturado do componente original. */
const HTML_FORA_DA_DEMO =
  '<a href="https://wa.me/5543999990000" target="_blank" rel="noreferrer noopener" aria-label="Abrir WhatsApp de Ana Silva" title="Abrir conversa no WhatsApp" class="inline-flex min-h-7 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-[var(--ok)] hover:bg-[var(--ok-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">WhatsApp</a>';

// O `Link` do wouter lê `location` fora de um Router; no SSR o caminho vem de `ssrPath`.
const renderizar = (rotaDaConversa?: string | null) =>
  renderToStaticMarkup(
    createElement(Router, { ssrPath: "/cobranca/esteira" },
      createElement(LinkWhatsapp, { whatsapp: "5543999990000", nome: "Ana Silva", rotaDaConversa }, "WhatsApp")),
  );

describe("LinkWhatsapp", () => {
  beforeEach(() => {
    auth.demoMode = false;
  });

  it("fora da demonstração: o mesmo <a> para o wa.me, com ou sem conversa", () => {
    expect(renderizar()).toBe(HTML_FORA_DA_DEMO);
    expect(renderizar("/cobranca/chat?conversa=conv-1&carteira=ativo")).toBe(HTML_FORA_DA_DEMO);
  });

  it("na demonstração, sem conversa: botão que explica, nenhum wa.me", () => {
    auth.demoMode = true;
    const html = renderizar();
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("href=");
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain(`title="${AVISO_WHATSAPP_SIMULADO}"`);
    expect(html).toContain(">WhatsApp</button>");
  });

  it("na demonstração, com conversa: leva ao atendimento simulado, nenhum wa.me", () => {
    auth.demoMode = true;
    const html = renderizar("/cobranca/chat?conversa=conv-1&carteira=ativo");
    expect(html).not.toContain("wa.me");
    expect(html).toContain('href="/cobranca/chat?conversa=conv-1&amp;carteira=ativo"');
    expect(html).not.toContain('target="_blank"');
  });

  it("o aviso diz que é simulado e não promete conversa com o cliente", () => {
    expect(AVISO_WHATSAPP_SIMULADO).toMatch(/demonstração/);
    expect(AVISO_WHATSAPP_SIMULADO).toMatch(/simulado/);
  });
});
