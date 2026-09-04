import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A cascata de fontes da plotagem, e o lugar do vizinho de rua nela.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Medido na Amplinet (provedor 6) em 04/09/2026,
 * já com a base de endereços do IBGE da região carregada e a coordenada do ERP
 * aplicada: 86 clientes seguiam fora do mapa, e em 72 deles (84%) a RUA NÃO
 * EXISTE no censo. O geocodificador de rede resolveu 1 de 40 numa amostra — 3%.
 * São vielas, estradas e chácaras de área peri-urbana.
 *
 * O que se prova aqui é o caso que motivou a mudança e o seu contrário, que é a
 * parte que importa mais: o cliente cuja rua o censo não conhece ENTRA no mapa
 * pelo vizinho já plotado da mesma rua, e o mesmo cliente numa rua DISPERSA
 * (uma estrada de chácara de 3,7 km, o máximo medido) NÃO entra — porque ali o
 * ponto do vizinho não é a casa de ninguém, e este produto prefere o cliente
 * contado no KPI a um marcador no lugar errado.
 *
 * O serviço do índice entra COMO O REAL: dublá-lo provaria só que a cascata
 * chama alguma coisa, e a guarda — o cerco por número e o teto do trecho — é
 * justamente o que precisa atravessar a cadeia inteira. O que é dublado é o
 * banco, a rede e o censo.
 */

const banco = vi.hoisted(() => ({
  /** Cada `.set()` que chegou ao UPDATE — o que a passada de fato gravou. */
  escritas: [] as Array<{ latitude: string; longitude: string; geoPrecisao: string | null }>,
  /** Providers cujo índice foi lido do banco, na ordem. */
  leituras: [] as number[],
  responderSelect: (_cond: unknown): any[] => [],
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: (cond: unknown) => Promise.resolve(banco.responderSelect(cond)) }) }),
    update: () => ({
      set: (valores: any) => ({
        where: async (_cond: unknown) => { banco.escritas.push(valores); },
      }),
    }),
  },
  pool: { query: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const rede = vi.hoisted(() => ({
  endereco: vi.fn(async (): Promise<any> => ({ coords: null, falha: "nao_encontrado" })),
  cep: vi.fn(async (): Promise<any> => ({ local: null, falha: "nao_encontrado" })),
}));
vi.mock("./geocoding", () => ({
  geocodeAddressDetalhado: rede.endereco,
  geocodeCepDetalhado: rede.cep,
  usandoNominatim: () => true,
}));

vi.mock("./coords-erp.service", () => ({
  puxarCoordenadasDoErp: vi.fn(async () => ({ atualizados: 0 })),
}));

import { PgDialect } from "drizzle-orm/pg-core";
import { aberturaDeIndices, plotarCliente } from "./geocode-backfill.service";
import type { AcertoLocal, GeocodificadorLocal } from "./geocode-local.service";
import {
  montarIndice, PRECISAO_VIZINHO, TETO_DISPERSAO_M, type LinhaPlotada,
} from "./vizinho-de-rua.service";

/** Embu-Guaçu/SP — a região onde os 86 clientes sem ponto foram medidos. */
const BASE: [number, number] = [-23.8300, -46.8110];
const M_POR_GRAU_LAT = 111_320;
const aoNorte = (metros: number): [number, number] => [BASE[0] + metros / M_POR_GRAU_LAT, BASE[1]];

let proximoId = 1;

/**
 * Um cliente já plotado pela coordenada do ERP, servindo de referência.
 *
 * O NÚMERO da casa não é enfeite: desde a conferência, a guarda só aceita o
 * ponto quando o cliente está CERCADO por número entre dois conhecidos — dois
 * vizinhos colados numa estrada longa não dizem onde ele mora.
 */
const plotado = (
  providerId: number, cidade: string, endereco: string, ponto: [number, number], numero?: string,
): LinhaPlotada => ({
  id: proximoId++,
  providerId,
  address: endereco,
  addressNumber: numero,
  city: cidade,
  state: 'SP',
  latitude: String(ponto[0]),
  longitude: String(ponto[1]),
});

/** Um cliente da fila de pendentes, no formato que `buscarPendentes` devolve. */
const pendente = (over: Partial<Record<string, any>> = {}) => ({
  id: 9001,
  providerId: 6,
  address: "RUA JOSE SECHI",
  addressNumber: "240",
  city: "Embu-Guaçu",
  state: "SP",
  cep: "06900-000",
  ...over,
}) as any;

/** Censo que devolve sempre o mesmo veredito — inclusive "não conheço". */
const censo = (acerto: AcertoLocal | null): GeocodificadorLocal => ({
  municipios: 1,
  cobre: () => true,
  resolver: () => acerto,
});

/** O censo não conhece a rua: é o estado de 84% dos clientes em questão. */
const CENSO_CEGO = censo(null);

/** Índice de carteira montado a partir das linhas dadas, sem passar pelo banco. */
const carteira = (providerId: number, ...linhas: LinhaPlotada[]) => montarIndice(providerId, linhas);
const indiceFixo = (indice: ReturnType<typeof carteira> | null) => async () => indice;

/**
 * A rua típica: o cliente (nº 240) cercado por dois conhecidos, 136 m entre
 * eles — a dispersão MEDIANA medida na carteira.
 */
const RUA_CURTA = () => carteira(
  6,
  plotado(6, "Embu-Guaçu", "RUA JOSE SECHI", aoNorte(0), "100"),
  plotado(6, "Embu-Guaçu", "RUA JOSE SECHI", aoNorte(136), "400"),
);

/** A estrada de chácara: o mesmo cerco, mas 3.766 m entre os cercadores. */
const ESTRADA_LONGA = () => carteira(
  6,
  plotado(6, "Embu-Guaçu", "RUA JOSE SECHI", aoNorte(0), "100"),
  plotado(6, "Embu-Guaçu", "RUA JOSE SECHI", aoNorte(3766), "400"),
);

const metrosAte = (lat: number, ponto: [number, number]) => Math.abs(lat - ponto[0]) * M_POR_GRAU_LAT;

beforeEach(() => {
  banco.escritas.length = 0;
  banco.leituras.length = 0;
  banco.responderSelect = () => [];
  rede.endereco.mockReset();
  rede.endereco.mockResolvedValue({ coords: null, falha: "nao_encontrado" });
  rede.cep.mockReset();
  rede.cep.mockResolvedValue({ local: null, falha: "nao_encontrado" });
});

describe("plotarCliente — o vizinho de rua na cascata", () => {
  it("a rua que o censo não conhece entra no mapa pelo vizinho já plotado", async () => {
    const r = await plotarCliente(pendente(), CENSO_CEGO, indiceFixo(RUA_CURTA()));

    expect(r).toEqual({ desfecho: "plotado", fonte: "vizinho" });
    expect(banco.escritas).toHaveLength(1);
    expect(banco.escritas[0].geoPrecisao).toBe(PRECISAO_VIZINHO);

    // No trecho conhecido da rua: a mediana fica a ≤150 m de qualquer ponto e o
    // ruído da gravação soma ~110 m — o orçamento que a guarda de 300 m assume.
    expect(metrosAte(Number(banco.escritas[0].latitude), aoNorte(68))).toBeLessThan(200);
    // E não pagou rede: a fonte é nossa.
    expect(rede.endereco).not.toHaveBeenCalled();
  });

  it("o MESMO cliente numa rua dispersa NÃO entra — 3.766 m não é a casa de ninguém", async () => {
    const r = await plotarCliente(pendente(), CENSO_CEGO, indiceFixo(ESTRADA_LONGA()));

    expect(r.desfecho).toBe("sem-endereco");
    expect(banco.escritas).toHaveLength(0);
    expect(TETO_DISPERSAO_M).toBe(300);
    // O motivo sobe até o laço para ser CONTADO: o que a guarda custa em
    // cobertura tem de ser medível numa passada, não discutido no escuro.
    expect(r.recusaDoVizinho).toBe("cerco-largo");
    // Recusar aqui é o comportamento, não uma falha: o cliente fica sem
    // coordenada, contado e visível no KPI, em vez de plotado no lugar errado.
  });

  /* O DEFEITO QUE A CONFERÊNCIA APONTOU, atravessando a cadeia inteira: dois
     vizinhos a 78 m numa estrada longa passavam na guarda de dispersão, e o
     cliente do 4500 — que nada no cadastro põe perto deles — era plotado sobre
     a mediana dos dois. Agora ele fica de fora, contado. */
  it("cliente fora do trecho conhecido não entra, por mais colados que estejam os vizinhos", async () => {
    const trechoDenso = carteira(
      6,
      plotado(6, "Embu-Guaçu", "ESTRADA DA BOA VISTA", aoNorte(0), "100"),
      plotado(6, "Embu-Guaçu", "ESTRADA DA BOA VISTA", aoNorte(78), "200"),
    );
    const c = pendente({ address: "ESTRADA DA BOA VISTA", addressNumber: "4500" });

    const r = await plotarCliente(c, CENSO_CEGO, indiceFixo(trechoDenso));

    expect(r.desfecho).toBe("sem-endereco");
    expect(r.recusaDoVizinho).toBe("fora-do-cerco");
    expect(banco.escritas).toHaveLength(0);
  });

  it("a rua do censo vem ANTES do vizinho — lá existe o número da casa", async () => {
    const abrir = vi.fn(async () => RUA_CURTA());
    const doCenso: AcertoLocal = { lat: aoNorte(500)[0], lon: BASE[1], precisao: "logradouro" };

    const r = await plotarCliente(pendente(), censo(doCenso), abrir);

    expect(r).toEqual({ desfecho: "plotado", fonte: "censo" });
    expect(banco.escritas[0].geoPrecisao).toBe("logradouro");
    // Nem chega a abrir o índice: a cascata devolveu antes.
    expect(abrir).not.toHaveBeenCalled();
  });

  it("o vizinho vem ANTES do bairro do censo — o bairro pode ter quilômetros", async () => {
    const doBairro: AcertoLocal = { lat: aoNorte(4000)[0], lon: BASE[1], precisao: "bairro" };

    const r = await plotarCliente(pendente(), censo(doBairro), indiceFixo(RUA_CURTA()));

    expect(r.fonte).toBe("vizinho");
    expect(banco.escritas[0].geoPrecisao).toBe(PRECISAO_VIZINHO);
  });

  it("sem vizinho, o bairro do censo continua valendo — nada foi tirado da cascata", async () => {
    const doBairro: AcertoLocal = { lat: aoNorte(4000)[0], lon: BASE[1], precisao: "bairro" };

    const r = await plotarCliente(pendente(), censo(doBairro), indiceFixo(ESTRADA_LONGA()));

    expect(r).toEqual({ desfecho: "plotado", fonte: "censo", recusaDoVizinho: "cerco-largo" });
    expect(banco.escritas[0].geoPrecisao).toBe("bairro");
    // O bairro é aproximação declarada e sai CRU, como sempre saiu.
    expect(Number(banco.escritas[0].latitude)).toBe(doBairro.lat);
  });

  it("o vizinho vem ANTES da rede, que nesta carteira resolve 3%", async () => {
    rede.endereco.mockResolvedValue({ coords: aoNorte(9000), precisao: "logradouro" });

    const r = await plotarCliente(pendente(), CENSO_CEGO, indiceFixo(RUA_CURTA()));

    expect(r.fonte).toBe("vizinho");
    expect(rede.endereco).not.toHaveBeenCalled();
  });

  it("sem vizinho e sem censo, a rede segue sendo a última fonte", async () => {
    rede.endereco.mockResolvedValue({ coords: aoNorte(9000), precisao: "endereco" });

    const r = await plotarCliente(pendente(), CENSO_CEGO, indiceFixo(null));

    expect(r).toEqual({ desfecho: "plotado", fonte: "rede" });
    expect(banco.escritas[0].geoPrecisao).toBe("endereco");
  });

  it("o ponto do vizinho sai com ruído: não é o telhado do vizinho nem uma pilha", async () => {
    // LGPD — o ponto plotado nunca é a porta exata; e a mediana aqui foi
    // calculada sobre instalações de CLIENTES REAIS, então gravá-la crua poria
    // um cliente no ponto derivado dos outros e todos no mesmo pixel.
    const indice = RUA_CURTA();
    for (const id of [9001, 9002, 9003]) {
      await plotarCliente(pendente({ id }), CENSO_CEGO, indiceFixo(indice));
    }

    const lats = banco.escritas.map(e => e.latitude);
    expect(new Set(lats).size).toBe(3);
    for (const e of banco.escritas) {
      // Ruído de ±0,001°/eixo: perto da mediana, e nunca exatamente sobre ela.
      expect(metrosAte(Number(e.latitude), aoNorte(68))).toBeLessThan(200);
      expect(Number(e.latitude)).not.toBe(aoNorte(68)[0]);
    }
  });

  it("índice indisponível não derruba a plotagem — o cliente segue para a rede", async () => {
    rede.endereco.mockResolvedValue({ coords: aoNorte(9000), precisao: "logradouro" });

    const r = await plotarCliente(pendente(), CENSO_CEGO, async () => null);

    expect(r).toEqual({ desfecho: "plotado", fonte: "rede" });
  });
});

describe("aberturaDeIndices", () => {
  /** O banco responde a carteira do provedor que o filtro do SQL pediu. */
  const carteirasNoBanco = (porProvedor: Record<number, LinhaPlotada[]>) => {
    banco.responderSelect = (cond) => {
      const providerId = Number(new PgDialect().sqlToQuery(cond as any).params[0]);
      banco.leituras.push(providerId);
      return porProvedor[providerId] ?? [];
    };
  };

  it("uma leitura por PROVEDOR, e não uma por cliente", async () => {
    // A varredura passa por 33 mil clientes: uma consulta por cliente seria
    // absurda, e a etapa geral intercala provedores por id — então "uma vez por
    // provedor" tem de ser memória, não um `if` no começo de um bloco.
    carteirasNoBanco({
      6: [plotado(6, "Embu-Guaçu", "RUA JOSE SECHI", aoNorte(0), "100"), plotado(6, "Embu-Guaçu", "RUA JOSE SECHI", aoNorte(90), "400")],
      7: [plotado(7, "Itapecerica da Serra", "RUA A", aoNorte(0))],
    });
    const abrir = aberturaDeIndices();

    for (const providerId of [6, 7, 6, 7, 6]) {
      await plotarCliente(pendente({ id: 9000 + providerId, providerId }), CENSO_CEGO, abrir);
    }

    expect(banco.leituras).toEqual([6, 7]);
  });

  it("a carteira de um provedor nunca resolve pela rua de outro", async () => {
    // Índice contaminado seria vazar a geolocalização de cliente alheio entre
    // tenants — o filtro está no SQL, e é o SQL que este teste exercita.
    carteirasNoBanco({
      6: [plotado(6, "Embu-Guaçu", "RUA JOSE SECHI", aoNorte(0), "100"), plotado(6, "Embu-Guaçu", "RUA JOSE SECHI", aoNorte(90), "400")],
      7: [],
    });
    const abrir = aberturaDeIndices();

    const meu = await plotarCliente(pendente({ providerId: 6 }), CENSO_CEGO, abrir);
    const alheio = await plotarCliente(pendente({ id: 9002, providerId: 7 }), CENSO_CEGO, abrir);

    expect(meu.fonte).toBe("vizinho");
    expect(alheio.desfecho).toBe("sem-endereco");
  });

  it("falha ao ler a carteira vira índice nulo, uma vez só, e a passada continua", async () => {
    banco.responderSelect = () => { banco.leituras.push(6); throw new Error("banco fora do ar"); };
    const abrir = aberturaDeIndices();

    expect(await abrir(6)).toBeNull();
    expect(await abrir(6)).toBeNull();
    expect(banco.leituras).toEqual([6]);
  });
});
