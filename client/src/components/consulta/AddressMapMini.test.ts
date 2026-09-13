// @vitest-environment jsdom
/**
 * O mini-mapa do relatório da Consulta ISP, na demonstração e fora dela.
 *
 * Sem latitude/longitude do ERP, o componente geocodifica pelo Nominatim —
 * `nominatim.openstreetmap.org`, um terceiro — com o endereço do consultado na
 * URL. Na demonstração pública nada sai para terceiros (regra 1 da spec; a
 * única exceção aceita é o proxy de tiles `/api/tiles`, que só leva z/x/y). Lá
 * o ponto sai de uma coordenada fixa das quatro cidades do mundo fictício —
 * as mesmas de `server/demo/pessoas-ficticias.ts`.
 *
 * O componente é o real; o `maplibre-gl` é trocado por um dublê que só anota
 * onde o mapa foi centrado (jsdom não tem WebGL), e o `fetch` é espionado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CIDADES_DA_DEMO } from "../../../../server/demo/pessoas-ficticias";

const auth = vi.hoisted(() => ({ demoMode: false }));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth }));

const mapa = vi.hoisted(() => ({ centros: [] as Array<[number, number]> }));
vi.mock("maplibre-gl", () => {
  class MapaDuble {
    constructor(opcoes: { center: [number, number] }) { mapa.centros.push(opcoes.center); }
    resize() {}
    once() {}
    remove() {}
  }
  class MarcadorDuble {
    setLngLat() { return this; }
    addTo() { return this; }
  }
  return { default: { Map: MapaDuble, Marker: MarcadorDuble } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

import AddressMapMini from "./AddressMapMini";

const fetchEspiao = vi.fn(async (_url: string) => ({ ok: true, json: async () => [{ lat: "-23.3", lon: "-51.1" }] }));
const chamadasAoNominatim = () => fetchEspiao.mock.calls.map(([url]) => String(url)).filter(url => url.includes("nominatim"));

beforeEach(() => {
  auth.demoMode = false;
  mapa.centros = [];
  fetchEspiao.mockClear();
  vi.stubGlobal("fetch", fetchEspiao);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function montar(props: Record<string, string | undefined>) {
  await act(async () => { render(createElement(AddressMapMini, props)); });
  await act(async () => { await Promise.resolve(); });
}

describe("AddressMapMini fora da demonstração", () => {
  it("sem coordenada do ERP geocodifica pelo Nominatim, como sempre", async () => {
    await montar({ address: "Rua Tupi", addressNumber: "10", city: "Ibiporã", state: "PR" });
    expect(chamadasAoNominatim().length).toBeGreaterThan(0);
    expect(mapa.centros).toEqual([[-51.1, -23.3]]);
  });
});

describe("AddressMapMini na demonstração", () => {
  beforeEach(() => {
    auth.demoMode = true;
  });

  it("sem coordenada do ERP não chama fetch nenhum e centra na cidade da demo", async () => {
    await montar({ address: "Rua Tupi", addressNumber: "10", city: "Ibiporã", state: "PR", cep: "86200-000" });
    expect(fetchEspiao).not.toHaveBeenCalled();
    const ibipora = CIDADES_DA_DEMO.find(c => c.nome === "Ibiporã")!;
    expect(mapa.centros).toEqual([[ibipora.longitude, ibipora.latitude]]);
  });

  it("só com o CEP, resolve a cidade pelo prefixo — sem fetch", async () => {
    await montar({ cep: "86800-123" });
    expect(fetchEspiao).not.toHaveBeenCalled();
    const apucarana = CIDADES_DA_DEMO.find(c => c.nome === "Apucarana")!;
    expect(mapa.centros).toEqual([[apucarana.longitude, apucarana.latitude]]);
  });

  it("cidade fora da demo: 'Endereço não encontrado', sem fetch e sem mapa", async () => {
    await montar({ address: "Rua XV", city: "Curitiba", state: "PR", cep: "80020-000" });
    expect(fetchEspiao).not.toHaveBeenCalled();
    expect(mapa.centros).toEqual([]);
    expect(screen.getByText("Endereço não encontrado")).toBeTruthy();
  });

  it("coordenada vinda do ERP continua valendo, sem fetch", async () => {
    await montar({ city: "Londrina", state: "PR", latitude: "-23.3301", longitude: "-51.1702" });
    expect(fetchEspiao).not.toHaveBeenCalled();
    expect(mapa.centros).toEqual([[-51.1702, -23.3301]]);
  });

  it("cobre exatamente as cidades do mundo fictício, com a coordenada de lá", async () => {
    for (const cidade of CIDADES_DA_DEMO) {
      cleanup();
      mapa.centros = [];
      await montar({ city: cidade.nome, state: cidade.uf });
      expect(mapa.centros, cidade.nome).toEqual([[cidade.longitude, cidade.latitude]]);
    }
    expect(fetchEspiao).not.toHaveBeenCalled();
  });
});
