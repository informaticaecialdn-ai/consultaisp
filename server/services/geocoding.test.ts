import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/**
 * O defeito que estes testes travam.
 *
 * A tela de Localização ficou com "0 plotados / 1220 sem coordenada" em
 * produção porque o geocoder tratava três coisas diferentes como a mesma
 * resposta `null`: "não conheço este endereço", "sua chave foi recusada" e
 * "não consegui falar com o servidor". O backfill lia esse null como
 * "endereço irrecuperável" e marcava a base inteira.
 *
 * Cada teste aqui é um caminho que antes devolvia null em silêncio.
 *
 * O módulo lê GOOGLE_MAPS_API_KEY no import, então cada bloco define a
 * variável e importa com o registro de módulos limpo.
 */

const respostaGoogle = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const NOMINATIM_OK = [{ lat: "-23.3103", lon: "-51.1628" }];
const GOOGLE_OK = { status: "OK", results: [{ geometry: { location: { lat: -23.31, lng: -51.16 } } }] };

async function carregar(chaveGoogle?: string, intervaloNominatim = "5") {
  vi.resetModules();
  // O espaçamento real é de 1,1s; o teste do ritmo pede o seu explicitamente.
  process.env.GEOCODE_INTERVALO_NOMINATIM_MS = intervaloNominatim;
  if (chaveGoogle) process.env.GOOGLE_MAPS_API_KEY = chaveGoogle;
  else delete process.env.GOOGLE_MAPS_API_KEY;
  return import("./geocoding");
}

const urlDe = (c: unknown) => String((c as any[])[0]);

let fetchMock: ReturnType<typeof vi.fn>;
const chaveOriginal = process.env.GOOGLE_MAPS_API_KEY;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (chaveOriginal === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = chaveOriginal;
});

describe("chave do Google recusada — a causa que derrubou a plotagem", () => {
  it("REQUEST_DENIED cai para o Nominatim em vez de devolver nada", async () => {
    const geo = await carregar("chave-de-teste-longa-o-suficiente");
    fetchMock.mockImplementation(async (...args: unknown[]) =>
      urlDe(args).includes("googleapis")
        ? respostaGoogle({ status: "REQUEST_DENIED", error_message: "referer restrictions" })
        : respostaGoogle(NOMINATIM_OK));

    const r = await geo.geocodeCityDetalhado("Londrina", "PR");

    expect(r.coords).toEqual([-23.3103, -51.1628]);
    expect(fetchMock.mock.calls.some(c => urlDe(c).includes("nominatim"))).toBe(true);
  });

  it("REQUEST_DENIED repetido suspende o Google e passa a usar só o Nominatim", async () => {
    const geo = await carregar("chave-de-teste-longa-o-suficiente");
    fetchMock.mockImplementation(async (...args: unknown[]) =>
      urlDe(args).includes("googleapis")
        ? respostaGoogle({ status: "REQUEST_DENIED" })
        : respostaGoogle(NOMINATIM_OK));

    // Três falhas seguidas fecham o circuito (cidades distintas: o cache não entra no meio).
    for (const cidade of ["Londrina", "Maringá", "Cambé"]) {
      await geo.geocodeCityDetalhado(cidade, "PR");
    }
    expect(geo.usandoNominatim()).toBe(true);

    fetchMock.mockClear();
    await geo.geocodeCityDetalhado("Apucarana", "PR");
    expect(fetchMock.mock.calls.every(c => !urlDe(c).includes("googleapis"))).toBe(true);
  });
});

describe("falha de rede não é endereço inválido", () => {
  it("timeout devolve indisponivel, não 'não encontrado'", async () => {
    const geo = await carregar();
    fetchMock.mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));

    const r = await geo.geocodeCityDetalhado("Londrina", "PR");

    expect(r.coords).toBeUndefined();
    expect(r.falha).toBe("indisponivel");
  });

  it("indisponivel não entra no cache — a tentativa seguinte volta à rede e resolve", async () => {
    const geo = await carregar();
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    fetchMock.mockResolvedValue(respostaGoogle(NOMINATIM_OK));

    const primeira = await geo.geocodeCityDetalhado("Londrina", "PR");
    const segunda = await geo.geocodeCityDetalhado("Londrina", "PR");

    expect(primeira.falha).toBe("indisponivel");
    expect(segunda.coords).toEqual([-23.3103, -51.1628]);
  });

  it("HTTP 429 do Nominatim é indisponivel, não ausência de resultado", async () => {
    const geo = await carregar();
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));

    const r = await geo.geocodeCityDetalhado("Londrina", "PR");
    expect(r.falha).toBe("indisponivel");
  });
});

describe("resposta definitiva é cacheada e não repete a chamada", () => {
  it("lista vazia é 'não encontrado' e a segunda consulta sai do cache", async () => {
    const geo = await carregar();
    fetchMock.mockResolvedValue(respostaGoogle([]));

    const primeira = await geo.geocodeCityDetalhado("Cidade Que Não Existe", "ZZ");
    const chamadasApos = fetchMock.mock.calls.length;
    const segunda = await geo.geocodeCityDetalhado("Cidade Que Não Existe", "ZZ");

    expect(primeira.falha).toBe("nao_encontrado");
    expect(segunda.falha).toBe("nao_encontrado");
    expect(fetchMock.mock.calls.length).toBe(chamadasApos);
  });

  it("sucesso é cacheado — mil clientes na mesma cidade custam uma chamada", async () => {
    const geo = await carregar();
    fetchMock.mockResolvedValue(respostaGoogle(NOMINATIM_OK));

    await geo.geocodeCityDetalhado("Londrina", "PR");
    const chamadasApos = fetchMock.mock.calls.length;
    for (let i = 0; i < 10; i++) await geo.geocodeCityDetalhado("Londrina", "PR");

    expect(fetchMock.mock.calls.length).toBe(chamadasApos);
  });

  it("o contador de chamadas de rede só anda quando houve rede — é ele que dispensa a pausa", async () => {
    const geo = await carregar();
    fetchMock.mockResolvedValue(respostaGoogle(NOMINATIM_OK));

    const antes = geo.chamadasDeRede();
    await geo.geocodeCityDetalhado("Londrina", "PR");
    const depoisDaRede = geo.chamadasDeRede();
    await geo.geocodeCityDetalhado("Londrina", "PR");
    const depoisDoCache = geo.chamadasDeRede();

    expect(depoisDaRede).toBeGreaterThan(antes);
    expect(depoisDoCache).toBe(depoisDaRede);
  });
});

describe("resultado fora do Brasil", () => {
  it("é descartado como não encontrado, não como coordenada válida", async () => {
    const geo = await carregar();
    fetchMock.mockResolvedValue(respostaGoogle([{ lat: "48.8566", lon: "2.3522" }]));

    const r = await geo.geocodeCityDetalhado("Paris", "PR");
    expect(r.coords).toBeUndefined();
    expect(r.falha).toBe("nao_encontrado");
  });
});

describe("ViaCEP — a porta de entrada de quem não tem cidade no cadastro", () => {
  const VIACEP_OK = { localidade: "Londrina", uf: "PR", logradouro: "Rua X", bairro: "Centro" };

  it("CEP inexistente é definitivo; ViaCEP fora do ar não é", async () => {
    const geo = await carregar();

    fetchMock.mockResolvedValue(respostaGoogle({ erro: true }));
    expect((await geo.geocodeCepDetalhado("86010000")).falha).toBe("nao_encontrado");

    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    expect((await geo.geocodeCepDetalhado("86020000")).falha).toBe("indisponivel");

    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    expect((await geo.geocodeCepDetalhado("86030000")).falha).toBe("indisponivel");
  });

  it("o mesmo CEP não é consultado duas vezes — nem quando existe, nem quando não existe", async () => {
    const geo = await carregar();

    fetchMock.mockResolvedValue(respostaGoogle(VIACEP_OK));
    await geo.geocodeCepDetalhado("86010000");
    const aposPositivo = fetchMock.mock.calls.length;
    const repetido = await geo.geocodeCepDetalhado("86010-000");   // mesmo CEP, com máscara
    expect(repetido.local?.city).toBe("Londrina");
    expect(fetchMock.mock.calls.length).toBe(aposPositivo);

    fetchMock.mockResolvedValue(respostaGoogle({ erro: true }));
    await geo.geocodeCepDetalhado("99999999");
    const aposNegativo = fetchMock.mock.calls.length;
    await geo.geocodeCepDetalhado("99999999");
    expect(fetchMock.mock.calls.length).toBe(aposNegativo);
  });

  it("indisponivel não vira cache — a próxima tentativa volta à rede", async () => {
    const geo = await carregar();
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    fetchMock.mockResolvedValue(respostaGoogle(VIACEP_OK));

    expect((await geo.geocodeCepDetalhado("86010000")).falha).toBe("indisponivel");
    expect((await geo.geocodeCepDetalhado("86010000")).local?.city).toBe("Londrina");
  });
});

/**
 * O endereço do cliente — a ordem e a precisão que evitam o ponto "muito fora".
 *
 * A versão anterior perguntava o CEP antes da rua e aceitava a resposta que
 * viesse. Em cidade com CEP geral (Ibiporã, 86200-000) o geocoder responde ao
 * CEP com o CENTRO DA CIDADE, e cada cliente ganhava o centro com 100 m de
 * ruído gravado como se fosse a rua dele.
 */
describe("endereço do cliente — rua primeiro, precisão exigida", () => {
  const RUA = [{ lat: "-23.3103", lon: "-51.1628", class: "highway", type: "residential" }];
  const CASA = [{ lat: "-23.3111", lon: "-51.1633", class: "place", type: "house" }];
  const CEP_DE_RUA = [{ lat: "-23.3120", lon: "-51.1640", class: "place", type: "postcode" }];
  const CIDADE = [{ lat: "-23.3045", lon: "-51.1696", class: "boundary", type: "administrative" }];
  const VIACEP_DE_RUA = { localidade: "Londrina", uf: "PR", logradouro: "Rua X", bairro: "Centro" };
  const VIACEP_GERAL = { localidade: "Ibiporã", uf: "PR", logradouro: "", bairro: "" };

  const roteador = (rotas: Array<[string, unknown]>) =>
    fetchMock.mockImplementation(async (...args: unknown[]) => {
      const u = urlDe(args);
      const alvo = rotas.find(([trecho]) => u.includes(trecho));
      return respostaGoogle(alvo ? alvo[1] : []);
    });

  it("resolve pela rua com número e nem consulta o CEP", async () => {
    const geo = await carregar();
    roteador([["Rua%20X%2C%20100", CASA], ["Londrina%2C%20PR%2C%20Brasil", CIDADE]]);

    const r = await geo.geocodeAddressDetalhado("Rua X, 100", "Londrina", "PR", "86010-000");

    expect(r.coords).toEqual([-23.3111, -51.1633]);
    expect(r.precisao).toBe("endereco");
    expect(fetchMock.mock.calls.some(c => urlDe(c).includes("86010000"))).toBe(false);
    expect(fetchMock.mock.calls.some(c => urlDe(c).includes("viacep"))).toBe(false);
  });

  it("geocoder que só acha a CIDADE para uma rua não posiciona — cai para o CEP de logradouro", async () => {
    const geo = await carregar();
    roteador([
      ["Rua%20Inexistente", CIDADE],
      ["viacep.com.br/ws/86010000", VIACEP_DE_RUA],
      ["86010000%2C", CEP_DE_RUA],
      ["Londrina%2C%20PR%2C%20Brasil", CIDADE],
    ]);

    const r = await geo.geocodeAddressDetalhado("Rua Inexistente, 5", "Londrina", "PR", "86010-000");

    expect(r.coords).toEqual([-23.312, -51.164]);
    expect(r.precisao).toBe("cep");
  });

  it("CEP geral do município não posiciona ninguém", async () => {
    const geo = await carregar();
    roteador([
      ["Rua%20Sem%20Registro", CIDADE],
      ["viacep.com.br/ws/86200000", VIACEP_GERAL],
      ["Ibipor", CIDADE],
    ]);

    const r = await geo.geocodeAddressDetalhado("Rua Sem Registro, 9", "Ibiporã", "PR", "86200-000");

    expect(r.coords).toBeUndefined();
    expect(r.falha).toBe("nao_encontrado");
    // O CEP geral nunca foi perguntado ao geocoder.
    expect(fetchMock.mock.calls.some(c => urlDe(c).includes("86200000%2C"))).toBe(false);
  });

  it("rua homônima em outra cidade — resultado a 40 km — é descartado", async () => {
    const geo = await carregar();
    const LONGE = [{ lat: "-23.6700", lon: "-51.1628", class: "highway", type: "residential" }];
    roteador([["Rua%20Y", LONGE], ["Londrina%2C%20PR%2C%20Brasil", CIDADE]]);

    const r = await geo.geocodeAddressDetalhado("Rua Y, 10", "Londrina", "PR");

    expect(r.coords).toBeUndefined();
    expect(r.motivo).toMatch(/longe/);
  });

  it("sem número a rua ainda posiciona, com precisão de logradouro", async () => {
    const geo = await carregar();
    roteador([["Rua%20X%2C%20Londrina", RUA], ["Londrina%2C%20PR%2C%20Brasil", CIDADE]]);

    const r = await geo.geocodeAddressDetalhado("Rua X", "Londrina", "PR");

    expect(r.precisao).toBe("logradouro");
  });

  it("geocoder fora do ar não é confundido com endereço inexistente", async () => {
    const geo = await carregar();
    fetchMock.mockResolvedValue(new Response("", { status: 502 }));

    const r = await geo.geocodeAddressDetalhado("Rua X, 100", "Londrina", "PR", "86010-000");
    expect(r.falha).toBe("indisponivel");
  });

  it("Google que responde APPROXIMATE/locality para uma rua não vale como rua", async () => {
    const geo = await carregar("chave-de-teste-longa-o-suficiente");
    fetchMock.mockImplementation(async (...args: unknown[]) => {
      const u = urlDe(args);
      if (u.includes("googleapis") && u.includes("Rua%20Z")) {
        return respostaGoogle({ status: "OK", results: [{
          geometry: { location: { lat: -23.3045, lng: -51.1696 }, location_type: "APPROXIMATE" },
          types: ["locality", "political"],
        }] });
      }
      if (u.includes("googleapis")) {
        return respostaGoogle({ status: "OK", results: [{
          geometry: { location: { lat: -23.3045, lng: -51.1696 }, location_type: "APPROXIMATE" },
          types: ["locality", "political"],
        }] });
      }
      return respostaGoogle([]);
    });

    const r = await geo.geocodeAddressDetalhado("Rua Z, 1", "Londrina", "PR");

    expect(r.coords).toBeUndefined();
    expect(r.motivo).toMatch(/so achou cidade/);
  });
});

describe("precisão do resultado", () => {
  it("Google: pelos types, e pelo location_type na falta deles", async () => {
    const geo = await carregar();
    expect(geo.precisaoGoogle({ types: ["street_address"], geometry: { location_type: "ROOFTOP" } })).toBe("endereco");
    expect(geo.precisaoGoogle({ types: ["route"], geometry: { location_type: "GEOMETRIC_CENTER" } })).toBe("logradouro");
    expect(geo.precisaoGoogle({ types: ["postal_code"], geometry: { location_type: "APPROXIMATE" } })).toBe("cep");
    expect(geo.precisaoGoogle({ types: ["sublocality", "political"], geometry: { location_type: "APPROXIMATE" } })).toBe("bairro");
    expect(geo.precisaoGoogle({ types: ["locality", "political"], geometry: { location_type: "APPROXIMATE" } })).toBe("cidade");
    expect(geo.precisaoGoogle({ geometry: { location_type: "RANGE_INTERPOLATED" } })).toBe("endereco");
    expect(geo.precisaoGoogle({})).toBe("cidade");
  });

  it("Nominatim: casa, rua, CEP, bairro, cidade — e o desconhecido conta como cidade", async () => {
    const geo = await carregar();
    expect(geo.precisaoNominatim({ class: "place", type: "house" })).toBe("endereco");
    expect(geo.precisaoNominatim({ class: "building", type: "yes" })).toBe("endereco");
    expect(geo.precisaoNominatim({ class: "amenity", type: "pharmacy" })).toBe("endereco");
    expect(geo.precisaoNominatim({ class: "highway", type: "residential" })).toBe("logradouro");
    expect(geo.precisaoNominatim({ addresstype: "road" })).toBe("logradouro");
    expect(geo.precisaoNominatim({ class: "place", type: "postcode" })).toBe("cep");
    expect(geo.precisaoNominatim({ class: "place", type: "suburb" })).toBe("bairro");
    expect(geo.precisaoNominatim({ class: "boundary", type: "administrative" })).toBe("cidade");
    expect(geo.precisaoNominatim({ class: "place", type: "city" })).toBe("cidade");
    expect(geo.precisaoNominatim({})).toBe("cidade");
  });
});

describe("ritmo do Nominatim", () => {
  it("chamadas seguidas são espaçadas — o limite é do módulo, não de quem chama", async () => {
    const geo = await carregar(undefined, "300");
    fetchMock.mockResolvedValue(respostaGoogle(NOMINATIM_OK));

    const t0 = Date.now();
    await geo.geocodeCityDetalhado("Londrina", "PR");
    await geo.geocodeCityDetalhado("Maringá", "PR");
    await geo.geocodeCityDetalhado("Cambé", "PR");
    const decorrido = Date.now() - t0;

    // Três chamadas de rede: as duas últimas esperam a vez, ~300ms cada.
    expect(decorrido).toBeGreaterThanOrEqual(550);
  }, 10_000);

  it("resposta de cache não entra na fila de espera", async () => {
    const geo = await carregar(undefined, "300");
    fetchMock.mockResolvedValue(respostaGoogle(NOMINATIM_OK));
    await geo.geocodeCityDetalhado("Londrina", "PR");

    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await geo.geocodeCityDetalhado("Londrina", "PR");

    expect(Date.now() - t0).toBeLessThan(200);
  }, 10_000);
});

describe("compatibilidade com quem já chamava", () => {
  it("geocodeCity continua devolvendo coordenada ou null", async () => {
    const geo = await carregar();
    fetchMock.mockResolvedValue(respostaGoogle(NOMINATIM_OK));
    expect(await geo.geocodeCity("Londrina", "PR")).toEqual([-23.3103, -51.1628]);

    fetchMock.mockResolvedValue(respostaGoogle([]));
    expect(await geo.geocodeCity("Outra Cidade", "PR")).toBeNull();
  });
});
