import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O CAMINHO INTEIRO de um cliente até virar ponto no mapa, sem banco.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Em 04/09/2026 a tela de Localização da Amplinet
 * (provedor 6) dizia "184 clientes esperam plotagem · carteira sem
 * geocodificação", e o dono leu isso como "o sistema não plota". Eram três
 * causas encadeadas, e cada uma tem hoje um teste próprio. O que faltava era
 * provar a EMENDA entre elas: cada peça pode passar sozinha e o cliente
 * continuar fora do mapa, porque o que liga uma à outra é a CHAVE de texto, e
 * uma chave que não bate não levanta erro nenhum — só silêncio.
 *
 * Foi exatamente assim que os 23 cadastros escritos "EMBUGUAÇU" ficaram fora do
 * mapa DEPOIS de a base de Embu-Guaçu ter sido carregada, com 20.651 pontos
 * dentro dela: "embuguacu" e "embu guacu" são chaves normalizadas diferentes.
 *
 * Os quatro elos, na ordem:
 *   1. o ERP manda "EMBUGUAÇU" e o produto grava o nome oficial do município;
 *   2. a medição de cobertura reconhece esse município e sabe se a base dele
 *      está carregada;
 *   3. o geocodificador local acha a base por essa mesma chave;
 *   4. as sete grafias da carteira colapsam numa — o que também apaga os sete
 *      chips que a barra de filtros mostrava para uma cidade só.
 *
 * O banco fica de fora: o que precisa de prova aqui é TEXTO — o valor gravado e
 * as chaves de casamento —, e essas são funções puras. O único ponto com banco é
 * o upsert, e dele interessa só o objeto que vai para o INSERT.
 */

const chamadas = vi.hoisted(() => ({ insert: [] as Record<string, any>[] }));

vi.mock("../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({
      values: (valores: Record<string, any>) => ({
        returning: async () => { chamadas.insert.push(valores); return [{ id: 1, ...valores }]; },
      }),
    }),
  },
  pool: {},
}));

import { canonizarCidadeDoCadastro } from "./cidade-canonica.service";
import { classificarCobertura, type LinhaDaCarteira } from "./cobertura-geo.service";
import { normalizarCidade } from "./area-atendida";
import { normalizarLocalidade } from "./localidade";
import { resolverMunicipio } from "./cnefe-download.service";
import { CustomersStorage } from "../storage/customers.storage";

/** Código IBGE de Embu-Guaçu/SP — é por ele que o CNEFE é baixado. */
const EMBU_GUACU = "3515103";

/** As sete grafias da MESMA cidade encontradas no cadastro do ERP da Amplinet. */
const GRAFIAS_DO_ERP = [
  "EMBU-GUAÇU", "EMBU GUACU", "EMBUGUAÇU", "embu-guacu",
  "EMBU  GUAÇU", "EMBU-GUACU,", "Embu Guaçu",
];

/**
 * A chave que o geocodificador local usa para ligar o cliente à base.
 *
 * Os dois lados dela estão em `geocode-local.service.ts`:
 * `abrirGeocodificadorLocal` indexa por `normalizarCidade(cidade_norm)`, e
 * `cidade_norm` é gravada por `carregarCnefeDoConteudo` como
 * `normalizarLocalidade(nome oficial do município)`. Do outro lado, `resolver()`
 * procura por `normalizarCidade(cliente.city)`. Se as duas divergirem, o cliente
 * some do mapa sem nenhum erro em lugar nenhum — que é a falha original.
 */
const chaveDaBaseCarregada = (nomeOficial: string) =>
  normalizarCidade(normalizarLocalidade(nomeOficial));

let storage: CustomersStorage;

const doErp = (city: string, state: string) => ({
  providerId: 6,
  cpfCnpj: "12328395074",
  name: "Cliente da Carteira",
  address: "Rua das Palmeiras",
  addressNumber: "120",
  city,
  state,
  totalOverdueAmount: 0,
  maxDaysOverdue: 0,
  overdueInvoicesCount: 0,
  erpSource: "mk",
});

beforeEach(() => {
  chamadas.insert.length = 0;
  storage = new CustomersStorage();
});

describe("de “EMBUGUAÇU” no ERP a ponto no mapa", () => {
  it("elo 1 — o sync grava o nome oficial, e não a grafia do ERP", async () => {
    await storage.upsertFromErp(doErp("EMBUGUAÇU", "sp"));

    expect(chamadas.insert).toHaveLength(1);
    expect(chamadas.insert[0].city).toBe("Embu-Guaçu");
    expect(chamadas.insert[0].state).toBe("SP");
  });

  it("elo 2 — a medição reconhece o município e o dá por coberto", async () => {
    await storage.upsertFromErp(doErp("EMBUGUAÇU", "SP"));
    const gravada = chamadas.insert[0].city as string;

    // A base de Embu-Guaçu carregada: é o estado depois de o botão da tela (ou
    // a passada do worker) ter baixado o CNEFE do município.
    const linhas: LinhaDaCarteira[] = [
      { providerId: 6, cidade: gravada, uf: "SP", clientes: 96, semCoordenada: 62 },
    ];
    const cobertura = classificarCobertura(linhas, new Set([EMBU_GUACU]), 6);

    expect(cobertura.semBase).toHaveLength(0);
    expect(cobertura.comBase.map(c => c.municipio.ibge)).toEqual([EMBU_GUACU]);
    // E o código pelo qual o CNEFE foi baixado é o mesmo — as duas pontas
    // resolvem a cidade contra a mesma lista oficial de municípios.
    expect(resolverMunicipio(gravada)?.ibge).toBe(EMBU_GUACU);
  });

  it("elo 3 — a chave do cliente alcança a base; a grafia crua não alcançava", async () => {
    await storage.upsertFromErp(doErp("EMBUGUAÇU", "SP"));
    const gravada = chamadas.insert[0].city as string;

    expect(normalizarCidade(gravada)).toBe(chaveDaBaseCarregada("Embu-Guaçu"));
    // A prova de que o conserto valeu, e a medida exata do defeito: com a base
    // carregada e 20.651 pontos dentro dela, a grafia do ERP não chegava lá.
    expect(normalizarCidade("EMBUGUAÇU")).not.toBe(chaveDaBaseCarregada("Embu-Guaçu"));
  });

  it("elo 4 — as sete grafias viram uma; os sete chips do filtro viram um", async () => {
    const gravadas: string[] = [];
    for (const grafia of GRAFIAS_DO_ERP) {
      chamadas.insert.length = 0;
      await storage.upsertFromErp(doErp(grafia, "SP"));
      gravadas.push(chamadas.insert[0].city as string);
    }

    // A barra de filtros da Localização agrupa por `normalizarCidade`: antes
    // eram várias chaves para a mesma cidade, cada uma um chip.
    expect(new Set(GRAFIAS_DO_ERP.map(normalizarCidade)).size).toBeGreaterThan(1);
    expect(new Set(gravadas)).toEqual(new Set(["Embu-Guaçu"]));
    expect(new Set(gravadas.map(normalizarCidade)).size).toBe(1);
  });

  it("o elo que NÃO se fecha por adivinhação: cadastro que não é cidade", async () => {
    /*
     * A terceira causa medida — "EMBU GAUCU", "SÃO PAUYLO", "ITAP DA SERRA",
     * "PARQUE JANDAIA" (bairro no campo de cidade). Nenhuma vira município, e é
     * de propósito: plantar o cliente na cidade errada é pior do que deixá-lo
     * fora do mapa, e a medição de cobertura lista essas grafias para o provedor
     * corrigir no ERP. O que se prova aqui é que o produto DIZ isso em vez de
     * chutar — a linha vai ao banco como veio.
     */
    for (const lixo of ["EMBU GAUCU", "SÃO PAUYLO", "ITAP DA SERRA", "PARQUE JANDAIA"]) {
      chamadas.insert.length = 0;
      await storage.upsertFromErp(doErp(lixo, "SP"));
      expect(chamadas.insert[0].city, lixo).toBe(lixo);
      expect(canonizarCidadeDoCadastro(lixo, "SP").motivo, lixo).toBe("nao_encontrada");
    }

    const cobertura = classificarCobertura(
      [{ providerId: 6, cidade: "EMBU GAUCU", uf: "SP", clientes: 9, semCoordenada: 9 }],
      new Set([EMBU_GUACU]),
      6,
    );
    expect(cobertura.comBase).toHaveLength(0);
    expect(cobertura.semMunicipio.map(g => g.motivo)).toEqual(["nao_encontrada"]);
  });

  it("a cidade sem base aparece como o que falta baixar, com quem ela segura", async () => {
    // O outro lado do elo 2: enquanto o CNEFE do município não entrou, é ISTO
    // que a tela mostra — e é a frase que faltava quando o dono leu "carteira
    // sem geocodificação" e concluiu que o produto não plota.
    const cobertura = classificarCobertura(
      [
        { providerId: 6, cidade: "Embu-Guaçu", uf: "SP", clientes: 96, semCoordenada: 62 },
        { providerId: 6, cidade: "Itapecerica da Serra", uf: "SP", clientes: 30, semCoordenada: 18 },
      ],
      new Set(),
      6,
    );

    expect(cobertura.semBase.map(c => c.municipio.nome))
      .toEqual(["Embu-Guaçu", "Itapecerica da Serra"]);
    expect(cobertura.semBase.reduce((s, c) => s + c.semCoordenada, 0)).toBe(80);
  });
});
