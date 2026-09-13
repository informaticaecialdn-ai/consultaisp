// @vitest-environment jsdom
/**
 * A barra de consulta RENDERIZADA (jsdom + Testing Library): quem vê o CPF
 * digitado é o ViaCEP, um terceiro — então o que se prova é a rede, não o fonte.
 *
 * O defeito: a busca de CEP disparava sempre que o campo passava por 8 dígitos.
 * Um CPF de 11 dígitos digitado tecla a tecla passa por 8 no meio do caminho, e
 * os 8 primeiros dígitos do CPF iam para viacep.com.br (LGPD: dado pessoal do
 * consultado entregue a quem não tem base legal nenhuma para recebê-lo). No
 * campo de CEP de instalação, colar um CPF era pior: o campo corta em 8 e manda.
 *
 * Esperar a digitação parar em 8 dígitos (a 1ª correção) não bastava: quem
 * digita lendo o documento leva 700 ms entre teclas, quem corrige o fim de um
 * CPF apaga até 8 dígitos e para, e o CNPJ formatado para na "/" com a raiz de
 * 8 dígitos no campo. Por isso o ViaCEP só é chamado por AÇÃO de quem opera.
 *
 * O componente é o real; só o `fetch` é dublado. Timers falsos controlam a
 * pausa da digitação.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ConsultaSearchBar from "./ConsultaSearchBar";

const CPF = "52998224725";
const CEP = "86200000";
const ENDERECO = { cep: "86200-000", logradouro: "Rua Tupi", bairro: "Centro", localidade: "Ibiporã", uf: "PR" };

const fetchEspiao = vi.fn(async (_url: string) => ({ ok: true, json: async () => ENDERECO }));
const chamadasAoViaCep = () => fetchEspiao.mock.calls.map(([url]) => String(url)).filter(url => url.includes("viacep"));

beforeEach(() => {
  fetchEspiao.mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("fetch", fetchEspiao);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const onSearch = vi.fn();

function montar() {
  onSearch.mockClear();
  render(createElement(ConsultaSearchBar, { onSearch, isLoading: false, hasResult: false, onClear: () => {} }));
  return screen.getByTestId("input-isp-search") as HTMLInputElement;
}

/** Tecla a tecla, com o intervalo de quem digita de verdade entre uma e outra. */
async function digitar(campo: HTMLInputElement, valor: string, intervaloMs = 150) {
  for (let i = 1; i <= valor.length; i++) {
    fireEvent.change(campo, { target: { value: valor.slice(0, i) } });
    await act(async () => { vi.advanceTimersByTime(intervaloMs); });
  }
}

/** Deixa o campo parado bastante tempo e as promessas pendentes resolverem. */
async function esperarParado() {
  await act(async () => { vi.advanceTimersByTime(5_000); });
}

describe("ConsultaSearchBar — o ViaCEP só vê CEP", () => {
  it("digitar um CPF tecla a tecla não manda nenhum pedaço dele ao ViaCEP", async () => {
    const campo = montar();
    await digitar(campo, CPF);
    await esperarParado();
    expect(chamadasAoViaCep()).toEqual([]);
  });

  it("o CPF formatado, tecla a tecla, também não vaza", async () => {
    const campo = montar();
    await digitar(campo, "529.982.247-25");
    await esperarParado();
    expect(chamadasAoViaCep()).toEqual([]);
  });

  it("CPF digitado devagar, lendo o documento (700 ms entre teclas), não vaza", async () => {
    const campo = montar();
    await digitar(campo, CPF, 700);
    await esperarParado();
    expect(chamadasAoViaCep()).toEqual([]);
  });

  it("corrigir o fim de um CPF — apagar até 8 dígitos e parar para conferir — não vaza", async () => {
    const campo = montar();
    fireEvent.change(campo, { target: { value: CPF } });
    await act(async () => { vi.advanceTimersByTime(150); });
    for (const tamanho of [10, 9, 8]) {
      fireEvent.change(campo, { target: { value: CPF.slice(0, tamanho) } });
      await act(async () => { vi.advanceTimersByTime(150); });
    }
    await esperarParado();
    expect(chamadasAoViaCep()).toEqual([]);
  });

  it("CNPJ formatado com a pausa natural depois da / (a raiz de 8 dígitos) não vaza", async () => {
    const campo = montar();
    await digitar(campo, "11.222.333/");
    await esperarParado();
    await digitar(campo, "11.222.333/0001-81");
    await esperarParado();
    expect(chamadasAoViaCep()).toEqual([]);
  });

  it("um CEP parado no campo só vai ao ViaCEP quando a pessoa pede — uma vez — e abre o painel", async () => {
    const campo = montar();
    await digitar(campo, CEP);
    await esperarParado();
    expect(chamadasAoViaCep()).toEqual([]);

    const botao = screen.getByTestId("button-consultar-isp");
    expect(botao.textContent).toContain("Buscar CEP");
    fireEvent.click(botao);
    await esperarParado();
    expect(chamadasAoViaCep()).toEqual([`https://viacep.com.br/ws/${CEP}/json/`]);
    expect(screen.getByTestId("cep-expanded-panel").textContent).toContain("Rua Tupi");
    // Buscar o endereço não é consultar: a consulta só sai com o número do imóvel.
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("Enter no campo com um CEP também busca o endereço", async () => {
    const campo = montar();
    await digitar(campo, CEP);
    fireEvent.keyDown(campo, { key: "Enter" });
    await esperarParado();
    expect(chamadasAoViaCep()).toEqual([`https://viacep.com.br/ws/${CEP}/json/`]);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("mudar o campo depois de pedir descarta a resposta atrasada do CEP antigo", async () => {
    let responder: (v: unknown) => void = () => {};
    const campo = montar();
    await digitar(campo, CEP);
    fetchEspiao.mockImplementationOnce(() => new Promise(r => { responder = r; }) as never);
    fireEvent.click(screen.getByTestId("button-consultar-isp"));
    await digitar(campo, `${CEP}1`);
    await act(async () => { responder({ ok: true, json: async () => ENDERECO }); });
    await esperarParado();
    expect(screen.queryByTestId("cep-expanded-panel")).toBeNull();
    expect((screen.getByTestId("button-consultar-isp") as HTMLButtonElement).disabled).toBe(false);
  });

  it("colar um CPF no campo de CEP de instalação não o corta em 8 dígitos e manda", async () => {
    const campo = montar();
    fireEvent.change(campo, { target: { value: CPF } });
    fireEvent.click(screen.getByText("Verificar também por endereço de instalação"));
    const cepInstalacao = screen.getByTestId("input-install-cep") as HTMLInputElement;
    fireEvent.change(cepInstalacao, { target: { value: "529.982.247-25" } });
    await esperarParado();
    expect(chamadasAoViaCep()).toEqual([]);
  });

  it("o CEP de instalação digitado continua sendo buscado", async () => {
    const campo = montar();
    fireEvent.change(campo, { target: { value: CPF } });
    fireEvent.click(screen.getByText("Verificar também por endereço de instalação"));
    const cepInstalacao = screen.getByTestId("input-install-cep") as HTMLInputElement;
    await digitar(cepInstalacao, CEP);
    await esperarParado();
    expect(chamadasAoViaCep()).toEqual([`https://viacep.com.br/ws/${CEP}/json/`]);
  });
});
