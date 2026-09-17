/**
 * O selo da CONEXÃO no painel do chat, na demonstração e fora dela.
 *
 * `PerfilDoCliente` lê `demoMode` de `useAuth` — o mesmo sinal da faixa de
 * demonstração, projeção de `emModoDemo()` no servidor. O `AuthProvider` real
 * só preenche esse campo por `fetch` num efeito, que o SSR não roda; por isso
 * o hook é trocado aqui por um estado controlado, e o painel é renderizado de
 * verdade nos dois lados. O que se prova: com a demo ligada o selo diz "Dados
 * fictícios" e nunca "Dados reais"; com ela desligada nada muda.
 *
 * Também aqui (correção da revisão do layout, 17/09/2026): o PIX copia e cola da
 * ficha sai RELIDO do ERP pela rota da 2ª via, nunca do contexto em cache; e o
 * topo da ficha passa na régua de contraste e de cor.
 */
import { createElement } from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextoDoChat } from "@shared/cobranca/contexto-chat";
import type { DetalheChat } from "./tipos";

const auth = vi.hoisted(() => ({ demoMode: false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth }));

import {
  AVISO_PIX_CLIQUE_DE_NOVO,
  AVISO_PIX_SEM_CODIGO,
  copiarPixRelendo,
  PerfilDoCliente,
  VALIDADE_DO_PIX_RELIDO_MS,
} from "./PerfilDoCliente";

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

/* ── O PIX copia e cola sai relido do ERP, nunca do cache da ficha ─────── */

const FATURA_COM_PIX: ContextoDoChat["faturas"][number] = {
  ref: "f-901", fonte: "mk", valor: 99.9, vencimento: "2026-09-01", descricao: "Mensalidade setembro",
  consultavel: true,
  pagamento: { link: null, pix: "00020126-PIX-DO-CACHE", linhaDigitavel: null, valor: 99.9, vencimento: "2026-09-01" },
};

const renderizarComFatura = (props: { urlDaSegundaVia?: string; mensagem?: string | null }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  try {
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc },
        createElement(PerfilDoCliente, {
          dados: DADOS,
          contexto: { ...CONTEXTO, faturas: [FATURA_COM_PIX], erp: { ...CONTEXTO.erp, mensagem: props.mensagem ?? null } },
          carregando: false, erro: false, atualizar: () => {}, pagamento: () => {},
          urlDaSegundaVia: props.urlDaSegundaVia,
        })),
    );
  } finally {
    qc.clear();
  }
};

describe("copiar o PIX de uma fatura da ficha", () => {
  const relido = (pix: string | null) => async () => ({ link: null, pix, linhaDigitavel: null, valor: 99.9, vencimento: "2026-09-01" });

  it("relê no ERP e copia o código RELIDO — nunca o que estava no cache", async () => {
    const ler = vi.fn(relido("00020126-PIX-RELIDO"));
    const escrever = vi.fn(async () => {});
    const r = await copiarPixRelendo({ guardado: null, agora: () => 1_000, ler, escrever });
    expect(ler).toHaveBeenCalledTimes(1);
    expect(escrever).toHaveBeenCalledWith("00020126-PIX-RELIDO");
    expect(ler.mock.invocationCallOrder[0]).toBeLessThan(escrever.mock.invocationCallOrder[0]);
    expect(r).toEqual({ copiado: true, aviso: null, guardar: null });
  });

  it("a fatura saiu das pendências (paga, baixada): nada é copiado, e o aviso é a frase do servidor", async () => {
    const escrever = vi.fn(async () => {});
    const r = await copiarPixRelendo({
      guardado: null, agora: () => 1_000, escrever,
      ler: async () => { throw new Error('404: {"message":"Esta fatura não está entre as pendências atuais deste cliente","codigo":"CASO_NAO_ENCONTRADO"}'); },
    });
    expect(escrever).not.toHaveBeenCalled();
    expect(r.copiado).toBe(false);
    expect(r.aviso).toContain("não está entre as pendências atuais");
  });

  it("o ERP não devolveu PIX agora: nada é copiado, e o caminho é a 2ª via", async () => {
    const escrever = vi.fn(async () => {});
    const r = await copiarPixRelendo({ guardado: null, agora: () => 1_000, ler: relido(null), escrever });
    expect(escrever).not.toHaveBeenCalled();
    expect(r).toEqual({ copiado: false, aviso: AVISO_PIX_SEM_CODIGO, guardar: null });
  });

  it("o navegador recusou copiar depois da leitura: guarda o RELIDO, e o segundo clique copia sem reler", async () => {
    const primeiro = await copiarPixRelendo({
      guardado: null, agora: () => 1_000, ler: relido("00020126-PIX-RELIDO"),
      escrever: async () => { throw new Error("NotAllowedError"); },
    });
    expect(primeiro).toEqual({ copiado: false, aviso: AVISO_PIX_CLIQUE_DE_NOVO, guardar: { pix: "00020126-PIX-RELIDO", em: 1_000 } });
    const ler = vi.fn(relido("outro"));
    const escrever = vi.fn(async () => {});
    const segundo = await copiarPixRelendo({ guardado: primeiro.guardar, agora: () => 1_000 + 30_000, ler, escrever });
    expect(ler).not.toHaveBeenCalled();
    expect(escrever).toHaveBeenCalledWith("00020126-PIX-RELIDO");
    expect(segundo.copiado).toBe(true);
  });

  it("o relido guardado vence em um minuto: depois disso, lê de novo", async () => {
    const ler = vi.fn(relido("00020126-PIX-NOVO"));
    const escrever = vi.fn(async () => {});
    await copiarPixRelendo({
      guardado: { pix: "00020126-PIX-VELHO", em: 1_000 }, agora: () => 1_000 + VALIDADE_DO_PIX_RELIDO_MS, ler, escrever,
    });
    expect(ler).toHaveBeenCalledTimes(1);
    expect(escrever).toHaveBeenCalledWith("00020126-PIX-NOVO");
  });

  it("sem a rota da 2ª via não há botão de copiar; com ela, o botão aparece e o PIX do cache não vai ao HTML", () => {
    expect(renderizarComFatura({})).not.toContain('data-testid="chat-perfil-copiar-pix"');
    const html = renderizarComFatura({ urlDaSegundaVia: "/api/chat-bullq/atendimentos/c1/segunda-via?origem=cobranca" });
    expect(html).toContain('data-testid="chat-perfil-copiar-pix"');
    expect(html).not.toContain("00020126-PIX-DO-CACHE");
  });

  it("a fonte: o clique passa pela rota da 2ª via, e o clipboard nunca recebe o pagamento do cache", () => {
    const fonte = readFileSync(join(__dirname, "PerfilDoCliente.tsx"), "utf8");
    expect(fonte).toContain('apiRequest("POST", urlDaSegundaVia, { ref: fatura })');
    expect(fonte).not.toMatch(/writeText\([^)]*pagamento\?*\.pix/);
    expect(fonte).not.toMatch(/writeText\(pix\)[\s\S]{0,40}f\.pagamento/);
  });
});

describe("a ficha na régua de contraste e de cor", () => {
  it("a mensagem do ERP no topo é --text-2 com o ícone âmbar — âmbar em texto de 11px sobre --brand-soft não passa AA", () => {
    const html = renderizarComFatura({ mensagem: "O ERP respondeu parcialmente." });
    const aviso = html.match(/<p role="status" class="([^"]*)"><svg[^>]*><\/svg>|<p role="status" class="([^"]*)">/);
    expect(aviso).not.toBeNull();
    const classe = aviso![1] ?? aviso![2];
    expect(classe).toContain("text-[var(--text-2)]");
    expect(classe).not.toContain("text-[var(--gated)]");
    expect(html).toContain("O ERP respondeu parcialmente.");
  });

  it("a linha de meta separa plano, Tel., Cliente desde e cidade com o ponto da referência", () => {
    const html = renderizarComFatura({});
    const meta = html.match(/<p[^>]*data-testid="chat-perfil-meta"[^>]*>([\s\S]*?)<\/p>/)![1];
    // Quatro itens (a cidade veio): três pontos, cada um decorativo, entre eles.
    expect(meta.match(/<span aria-hidden="true" class="text-\[var\(--text-muted\)\]">·<\/span>/g)).toHaveLength(3);
    const ordem = ["Plano não informado", "Tel.", "Cliente desde", "Londrina / PR"].map((t) => meta.indexOf(t));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    // Sem cidade, o ponto dela some junto: nada de ponto sobrando no fim.
    const semCidade = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: new QueryClient() },
        createElement(PerfilDoCliente, {
          dados: { ...DADOS, cliente: { ...DADOS.cliente!, cidade: null } },
          contexto: { ...CONTEXTO, cliente: { ...CONTEXTO.cliente, cidade: null, uf: null } },
          carregando: false, erro: false, atualizar: () => {}, pagamento: () => {},
        })),
    ).match(/<p[^>]*data-testid="chat-perfil-meta"[^>]*>([\s\S]*?)<\/p>/)![1];
    expect(semCidade.match(/>·<\/span>/g)).toHaveLength(2);
    expect(semCidade.trimEnd()).not.toMatch(/·<\/span>$/);
  });

  it("o quadrante é a pílula escura da referência — ● B2 · quadrante DNA — em tokens, retangular", () => {
    const comCaso = (quadrante: string | null) =>
      renderToStaticMarkup(
        createElement(QueryClientProvider, { client: new QueryClient() },
          createElement(PerfilDoCliente, {
            dados: {
              ...DADOS,
              cobranca: {
                id: 77, carteira: "ativo", status: "em_contato", valor: 189.9, diasAtraso: 12, quadrante, tom: null,
                responsavel: "Paula", proximaAcao: null, proximoContatoEm: null,
                orientacao: { etapa: null, agente: "Clara", diretiva: "Lembrete gentil.", proximoPasso: "", propensao: null },
              },
            },
            contexto: CONTEXTO, carregando: false, erro: false, atualizar: () => {}, pagamento: () => {},
          })),
      );
    const pilula = comCaso("B2").match(/<span[^>]*data-testid="chat-perfil-quadrante"[^>]*>[\s\S]*?quadrante DNA<\/span>/)![0];
    const classe = pilula.match(/class="([^"]*)"/)![1].split(" ");
    expect(classe).toEqual(expect.arrayContaining(["bg-[var(--text)]", "text-[var(--surface)]", "border-transparent", "rounded", "font-mono", "text-[10px]"]));
    expect(classe.some((c) => /^rounded-(full|md|lg|xl|2xl|3xl)$/.test(c))).toBe(false);
    expect(pilula).toMatch(/<span aria-hidden="true"[^>]*>●<\/span><span>B2<\/span> · quadrante DNA/);
    expect(pilula).toContain('title="Quadrante do DNA de pagamento · Lembrete gentil."');
    // Sem quadrante: o selo neutro com o traço — nunca a pílula escura vazia.
    const semDna = comCaso(null).match(/<span[^>]*data-testid="chat-perfil-quadrante"[^>]*>[\s\S]*?quadrante DNA<\/span>/)![0];
    expect(semDna).not.toContain("bg-[var(--text)]");
    expect(semDna).toContain("Sem DNA: o ERP não informou a data do contrato");
    expect(semDna).toContain("—");
  });

  it("o ladrilho das iniciais não é pintado de marca cheia: marca é ação, não pessoa", () => {
    const topo = renderizarComFatura({}).match(/data-testid="chat-perfil-topo"[\s\S]*?<\/span>/)![0];
    expect(topo).not.toContain("bg-[var(--brand)]");
    expect(topo).toContain("text-[var(--brand-ink)]");
  });
});
