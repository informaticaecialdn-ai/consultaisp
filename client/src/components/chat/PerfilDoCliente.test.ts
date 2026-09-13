/**
 * O selo da CONEXÃO no painel do chat, na demonstração e fora dela.
 *
 * `PerfilDoCliente` lê `demoMode` de `useAuth` — o mesmo sinal da faixa de
 * demonstração, projeção de `emModoDemo()` no servidor. O `AuthProvider` real
 * só preenche esse campo por `fetch` num efeito, que o SSR não roda; por isso
 * o hook é trocado aqui por um estado controlado, e o painel é renderizado de
 * verdade nos dois lados. O que se prova: com a demo ligada o selo diz "Dados
 * fictícios" e nunca "Dados reais"; com ela desligada nada muda.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextoDoChat } from "@shared/cobranca/contexto-chat";
import type { DetalheChat } from "./tipos";

const auth = vi.hoisted(() => ({ demoMode: false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth }));

import { PerfilDoCliente } from "./PerfilDoCliente";

const AGORA = "2026-09-12T11:30:00.000Z";

const DADOS: DetalheChat = {
  conversa: {
    conversationId: "demo-conv-1-1", customerId: 1, casoId: null, recuperacaoId: null,
    nome: "Ana Silva", telefone: "43999990000", status: "OPEN", ultimoEventoEm: AGORA, carteira: "ativo",
  },
  cliente: { id: 1, nome: "Ana Silva", telefone: "43999990000", endereco: null, cidade: "Londrina" },
  cobranca: null,
  recuperacao: null,
  equipamentos: [],
  mensagens: [],
  pagina: 1,
  temMais: false,
};

const CONTEXTO: ContextoDoChat = {
  cliente: {
    id: 1, nome: "Ana Silva", documento: "000.000.000-00", telefone: "43999990000", email: null,
    endereco: null, bairro: null, cidade: "Londrina", uf: "PR", cep: null, statusContrato: "active",
    clienteDesde: null, plano: null, mensalidade: null, ispScore: null, risco: null, divida: null,
    diasAtraso: null, sincronizadoEm: AGORA,
  },
  pagamentos: { pagas: 0, comData: 0, pontualidade: null },
  faturas: [],
  temMaisFaturas: false,
  faturasSemData: 0,
  conexoes: [{ login: "ana@ppp", mac: "64DBF7ED1D24", ip: "100.72.14.9", contrato: "40122", serial: "ALCLFC65623D", online: true, fonte: "mk" }],
  ordens: [],
  erp: {
    fonte: "mk", atualizadoEm: AGORA, status: "disponivel", mensagem: null,
    financeiroAoVivo: true, valoresDe: "ao_vivo", lidoEm: AGORA,
  },
};

const renderizar = () =>
  renderToStaticMarkup(
    createElement(PerfilDoCliente, {
      dados: DADOS, contexto: CONTEXTO, carregando: false, erro: false,
      atualizar: () => {}, pagamento: () => {},
    }),
  );

describe("o selo da conexão no painel do chat", () => {
  beforeEach(() => {
    auth.demoMode = false;
  });

  it("fora da demonstração, o ERP respondeu: 'Dados reais', como sempre", () => {
    const html = renderizar();
    expect(html).toContain('data-testid="chat-bloco-conexao"');
    expect(html).toContain("Dados reais");
    expect(html).not.toContain("Dados fictícios");
  });

  it("na demonstração (demoMode do servidor): 'Dados fictícios' com o motivo, nunca 'Dados reais'", () => {
    auth.demoMode = true;
    const html = renderizar();
    expect(html).toContain("Dados fictícios");
    expect(html).toContain("conector de demonstração");
    expect(html).not.toContain("Dados reais");
  });

  it("só o demoMode liga o selo: o mesmo contexto, com a demo desligada de novo, volta ao de antes", () => {
    const antes = renderizar();
    auth.demoMode = true;
    expect(renderizar()).not.toBe(antes);
    auth.demoMode = false;
    expect(renderizar()).toBe(antes);
  });
});
