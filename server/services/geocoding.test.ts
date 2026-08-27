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

describe("endereço com CEP — o caminho que o backfill usa primeiro", () => {
  it("resolve pelo CEP e nem chega a consultar por rua", async () => {
    const geo = await carregar();
    fetchMock.mockResolvedValue(respostaGoogle(NOMINATIM_OK));

    const r = await geo.geocodeAddressDetalhado("Rua X, 100", "Londrina", "PR", "86010-000");

    expect(r.coords).toEqual([-23.3103, -51.1628]);
    // A primeira consulta é a do CEP; sem ela resolvida haveria uma segunda por rua.
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(urlDe(fetchMock.mock.calls[0])).toContain("86010000");
  });

  it("CEP que não resolve cai para a busca por rua em vez de desistir", async () => {
    const geo = await carregar();
    fetchMock.mockImplementation(async (...args: unknown[]) =>
      urlDe(args).includes("86010000") ? respostaGoogle([]) : respostaGoogle(NOMINATIM_OK));

    const r = await geo.geocodeAddressDetalhado("Rua X, 100", "Londrina", "PR", "86010-000");
    expect(r.coords).toEqual([-23.3103, -51.1628]);
  });

  it("geocoder fora do ar no CEP não é confundido com endereço inexistente", async () => {
    const geo = await carregar();
    fetchMock.mockResolvedValue(new Response("", { status: 502 }));

    const r = await geo.geocodeAddressDetalhado("Rua X, 100", "Londrina", "PR", "86010-000");
    expect(r.falha).toBe("indisponivel");
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
