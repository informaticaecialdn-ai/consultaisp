// @vitest-environment jsdom
/**
 * O diálogo de emissão RENDERIZADO (jsdom + Testing Library), não o fonte.
 *
 * O teste de fonte vizinho (`ConfissaoDeDivida.test.ts`) confere que as rotas
 * e os campos existem; ele não tinha como ver o defeito que a revisão final
 * achou: o contato e o representante entravam direto na chave da leitura da
 * base, então cada tecla era uma chave nova sem dado — o bloco `{base && …}`
 * desmontava, levando junto o campo sendo digitado (foco perdido a cada
 * letra), e cada letra virava uma leitura AO VIVO no ERP do provedor. Para PJ
 * o representante é obrigatório: o caminho quebrado era o de toda emissão PJ.
 *
 * O componente é o real; só o `fetch` é dublado (é por ele que `apiRequest`
 * fala com o servidor) e o QueryClient é deste arquivo. Timers falsos
 * controlam a pausa da digitação; `shouldAdvanceTime` deixa o resto do
 * relógio (o do React Query e o da Testing Library) andar sozinho.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import type { BaseDaConfissaoDto, EstadoDaAssinatura } from "@shared/cobranca/confissao";
import { ConfissaoDeDivida } from "./ConfissaoDeDivida";

const ESTADO: EstadoDaAssinatura = {
  configurada: true, ativa: true, ambiente: "producao", modelo: "padrao", modeloRevisado: false, provedorAssina: false,
  authMode: "assinaturaTela-tokenWhatsapp", custo: { creditos: 5, reais: 0, texto: "1 documento da cota do plano" }, prazoAssinaturaDias: 15,
  chatDisponivel: false, motivo: null,
};

/** A base que o servidor devolveria para a query pedida — o contato digitado volta no devedor, como no `montarBase`. */
function baseDaQuery(query: string): BaseDaConfissaoDto {
  const q = new URLSearchParams(query);
  return {
    origem: "saldo_integral", casoId: 9, negociacaoId: null,
    cliente: { nome: "Padaria Ltda", documento: "11222333000181", pessoaJuridica: true, email: q.get("email"), telefone: q.get("telefone"), endereco: null },
    valorTotal: 819.76, valorOriginal: null, descontoPct: null, recebidoDoAcordo: null,
    encargos: { multa: 0, juros: 0, multaPct: 2, jurosMesPct: 1 },
    parcelas: [{ n: 1, rotulo: "parcela", valor: 819.76, vencimento: "2026-09-26" }], anexo: [], faturasIndeterminadas: 0, faturasDeSaida: [],
    erpSource: "mk", erpLidoEm: "2026-09-10T13:00:00.000Z", dividaAtualDoErp: 819.76,
    vencimento: { minimo: "2026-09-26", maximo: "2026-12-09", escolhido: null },
    bloqueios: [], avisos: [], prescrita: false, baseHash: `${query.length.toString(16)}`.padStart(64, "0"), previa: null,
    custo: { creditos: 5, reais: 0, texto: "1 documento da cota do plano + 5 créditos (R$ 0,50) da conta ZapSign do provedor" }, ambiente: "producao", modeloRevisado: false,
  };
}

const CAMINHO_DA_BASE = "/api/cobranca/clientes/42/confissoes/base?";
const leiturasDaBase: string[] = [];
const seguradas: Array<() => void> = [];
let segurarLeituras = false;

function resposta(corpo: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

beforeEach(() => {
  leiturasDaBase.length = 0;
  seguradas.length = 0;
  segurarLeituras = false;
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
  // Toda notificação do React Query dentro de act(): sem isso o React avisa
  // "update not wrapped in act" a cada leitura que volta.
  notifyManager.setNotifyFunction(fn => { act(() => { fn(); }); });
  vi.stubGlobal("fetch", vi.fn(async (entrada: string) => {
    const url = String(entrada);
    if (url === "/api/cobranca/confissoes/estado") return resposta(ESTADO);
    if (url === "/api/cobranca/clientes/42/confissoes") return resposta([]);
    if (url.startsWith(CAMINHO_DA_BASE)) {
      leiturasDaBase.push(url);
      const corpo = baseDaQuery(url.slice(CAMINHO_DA_BASE.length));
      if (segurarLeituras) return new Promise(resolver => { seguradas.push(() => resolver(resposta(corpo))); });
      return resposta(corpo);
    }
    throw new Error(`fetch inesperado no teste: ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  notifyManager.setNotifyFunction(fn => { fn(); });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Avança o relógio falso DENTRO de act(): dispara a pausa da digitação e deixa a leitura voltar. */
async function avancar(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Renderiza o bloco do 360, abre o diálogo e espera a primeira base chegar. */
async function abrirDialogo() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(createElement(QueryClientProvider, { client },
    createElement(ConfissaoDeDivida, { customerId: 42, casoId: 9, clienteNome: "Padaria Ltda", podeAdministrar: true, chatCasoId: null })));
  await avancar(50);
  const emitirNoBloco = screen.getByTestId("acao-emitir-confissao") as HTMLButtonElement;
  expect(emitirNoBloco.disabled).toBe(false);
  await user.click(emitirNoBloco);
  await avancar(50);
  expect(leiturasDaBase).toHaveLength(1);
  return { user, email: screen.getByLabelText("E-mail do cliente") as HTMLInputElement };
}

const botaoEmitir = () => screen.getByTestId("confirmar-emissao") as HTMLButtonElement;

describe("diálogo de emissão da confissão — renderizado", () => {
  it("digitar 'maria@' letra a letra não desmonta o campo nem tira o foco, mesmo com a base relida entre as teclas", async () => {
    const { user, email } = await abrirDialogo();
    await user.click(email);
    for (const letra of "maria@") {
      await user.keyboard(letra);
      expect(email.isConnected, `depois de "${letra}"`).toBe(true);
      expect(document.activeElement, `foco depois de "${letra}"`).toBe(email);
      // Passa a pausa: a leitura sai e volta — e o campo continua o MESMO elemento, com foco.
      await avancar(700);
      expect(screen.getByLabelText("E-mail do cliente"), `leitura depois de "${letra}"`).toBe(email);
      expect(document.activeElement, `foco depois da leitura de "${letra}"`).toBe(email);
    }
    expect(email.value).toBe("maria@");
    // O que o servidor recebe é o que foi digitado — o contato continua indo à base (e ao hash).
    expect(leiturasDaBase.at(-1)).toContain("email=maria%40");
  });

  it("com timers falsos, N teclas em sequência geram UMA leitura da base depois da pausa, não N", async () => {
    const { user, email } = await abrirDialogo();
    await user.type(email, "maria@example.com");
    expect(leiturasDaBase, "nenhuma leitura enquanto se digita").toHaveLength(1);
    await avancar(700);
    expect(leiturasDaBase).toHaveLength(2);
    expect(leiturasDaBase[1]).toBe(`${CAMINHO_DA_BASE}email=maria%40example.com`);
    await avancar(5_000);
    expect(leiturasDaBase, "e nenhuma leitura atrasada depois").toHaveLength(2);
    // O representante (obrigatório no PJ) segue a mesma regra.
    await user.type(screen.getByLabelText("Representante legal · nome"), "João da Silva");
    await avancar(700);
    expect(leiturasDaBase).toHaveLength(3);
  });

  it("enquanto a nova leitura não volta, o formulário anterior segue na tela e o Emitir fica desabilitado", async () => {
    const { user, email } = await abrirDialogo();
    expect(botaoEmitir().disabled, "a base das escolhas de agora chegou").toBe(false);
    segurarLeituras = true;
    await user.type(email, "maria@example.com");
    expect(botaoEmitir().disabled, "o digitado ainda não foi lido").toBe(true);
    await avancar(700);
    expect(seguradas, "a leitura nova saiu e não voltou").toHaveLength(1);
    expect(screen.getByLabelText("E-mail do cliente")).toBe(email);
    expect(screen.getByText("valor confessado")).toBeTruthy();
    expect(screen.getByTestId("confissao-base-atualizando")).toBeTruthy();
    expect(botaoEmitir().disabled, "a base na tela é a da leitura anterior").toBe(true);
    await act(async () => { seguradas[0](); });
    await avancar(50);
    expect(screen.queryByTestId("confissao-base-atualizando")).toBeNull();
    expect(botaoEmitir().disabled, "a base das escolhas de agora voltou").toBe(false);
  });
});
