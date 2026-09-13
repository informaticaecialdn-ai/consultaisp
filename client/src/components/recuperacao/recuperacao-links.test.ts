/**
 * O WhatsApp do kanban de recuperação na demonstração pública e fora dela.
 *
 * O card e o drawer montavam `https://wa.me/<número do cliente>` por conta
 * própria — duas cópias do `LinkWhatsapp` da cobrança. No sandbox o número é
 * fictício, mas plausível: o link abria conversa com quem tiver aquele número
 * de verdade. Na demo nada sai: o drawer, que sabe se a retirada já tem
 * conversa (a mesma consulta do `ChatDaRecuperacao`), leva ao atendimento
 * simulado; o card, que não sabe, vira botão que explica. Fora da demo, o
 * mesmo `<a>` de sempre.
 *
 * Renderização SSR de verdade. O `Sheet` do Radix abre num portal, que o SSR
 * não desenha, então vira passagem direta; o `ChatDaRecuperacao` tem teste
 * próprio e sai do caminho. A conversa entra pelo cache, sem rede.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardKanban } from "./tipos";

const auth = vi.hoisted(() => ({ demoMode: false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth }));
vi.mock("@/components/ui/sheet", () => {
  const passa = ({ children }: { children?: unknown }) => children ?? null;
  return { Sheet: passa, SheetContent: passa, SheetHeader: passa, SheetTitle: passa, SheetDescription: passa };
});
vi.mock("@/components/chat/ChatDaRecuperacao", () => ({ ChatDaRecuperacao: () => null }));

import { AVISO_WHATSAPP_SIMULADO } from "@/components/cobranca/ui";
import { CardEquipamento, type AcoesCard } from "./CardEquipamento";
import { DrawerCaso } from "./DrawerCaso";

const CLIENTE = {
  id: 3, nome: "Ana Silva", documento: "000.000.000-00", telefone: "(43) 99999-0000", whatsapp: "5543999990000",
  endereco: "Rua A, 1", bairro: "Centro", cidade: "Londrina", uf: "PR", situacao: "Cancelado", dividaEmAberto: 120, diasEmAtraso: 40,
};
const CASO = {
  status: "aberto", prioridade: "media", rescisaoEm: "2026-08-01", prazoAt: "2026-09-30", diasRetido: 20, diasRestantes: 10,
  agendadoEm: null, metodo: null, responsavel: null, notificadoEm: null, bureauStatus: "nenhum", contestadoEm: null,
  encerradoEm: null, notas: null, tentativas: { total: 1, ultima: null },
};
const ABERTO: CardKanban = {
  chave: "caso:7", coluna: "ate30", caseId: 7,
  equipamento: { id: 45, tipo: "ONU", marca: "Huawei", modelo: "HG8245", serie: "SN1", mac: "AA:BB", patrimonio: null, valor: 250, status: "not_returned" },
  cliente: CLIENTE,
  caso: CASO,
};
const FECHADO: CardKanban = { ...ABERTO, coluna: "recuperado", caso: { ...CASO, status: "recuperado", encerradoEm: "2026-08-21T10:00:00.000Z" } };
const ACOES: AcoesCard = { onPrioridade() {}, onEtapa() {}, onContato() {}, onAgendar() {}, onDetalhes() {}, onAbrirCaso() {}, onEnviarParaChat() {} };

const WA = "https://wa.me/5543999990000";

// O `Link` do wouter lê `location` fora de um Router; no SSR o caminho vem de `ssrPath`.
const noKanban = (el: ReturnType<typeof createElement>) => createElement(Router, { ssrPath: "/recuperacao" }, el);

const card = (c: CardKanban) => renderToStaticMarkup(noKanban(createElement(CardEquipamento, { card: c, acoes: ACOES })));

/** O drawer do caso 7 com a conversa da retirada no cache (ou sem conversa). */
function drawer(c: CardKanban, conversa: { conversationId: string; status: string } | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  qc.setQueryData(["/api/equipment/recovery-cases/7/events"], []);
  qc.setQueryData(["/api/chat-bullq/recuperacao/7/conversa"], conversa);
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc },
      noKanban(createElement(DrawerCaso, {
        card: c, aberto: true, onFechar() {}, responsaveis: [],
        onContato() {}, onAgendar() {}, onConcluir() {}, onBaixar() {}, onAbrirCaso() {},
      }))),
  );
  qc.clear();
  return html;
}

describe("WhatsApp no card de recuperação", () => {
  beforeEach(() => { auth.demoMode = false; });

  it("fora da demonstração: o link para o wa.me, como sempre", () => {
    expect(card(ABERTO)).toContain(`href="${WA}"`);
    expect(card(FECHADO)).toContain(`href="${WA}"`);
  });

  it("na demonstração: botão com a explicação, nenhum wa.me", () => {
    auth.demoMode = true;
    for (const c of [ABERTO, FECHADO]) {
      const html = card(c);
      expect(html).not.toContain("wa.me");
      expect(html).toContain(`title="${AVISO_WHATSAPP_SIMULADO}"`);
    }
  });
});

describe("WhatsApp no drawer do caso", () => {
  beforeEach(() => { auth.demoMode = false; });

  it("fora da demonstração: o link para o wa.me, e a conversa no cache não muda nada", () => {
    const comConversa = drawer(FECHADO, { conversationId: "conv-7", status: "OPEN" });
    expect(comConversa).toContain(`href="${WA}"`);
    expect(drawer(FECHADO, null)).toBe(comConversa);
  });

  it("na demonstração, com conversa: leva ao atendimento simulado da retirada", () => {
    auth.demoMode = true;
    const html = drawer(FECHADO, { conversationId: "conv-7", status: "OPEN" });
    expect(html).not.toContain("wa.me");
    expect(html).toContain('href="/equipamentos/chat?conversa=conv-7"');
  });

  it("na demonstração, sem conversa: botão com a explicação", () => {
    auth.demoMode = true;
    const html = drawer(FECHADO, null);
    expect(html).not.toContain("wa.me");
    expect(html).toContain(`title="${AVISO_WHATSAPP_SIMULADO}"`);
  });
});