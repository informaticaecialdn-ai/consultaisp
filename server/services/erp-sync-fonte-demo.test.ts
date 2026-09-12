/**
 * A fonte "demo" nunca ESCREVE pela varredura — só a consulta ao vivo a
 * alcança. Achado na revisão da Tarefa 4 (11/09/2026): a credencial de
 * fachada que a Tarefa 3 passou a gravar (rodada de correção) satisfaz os
 * QUATRO lugares que exigem apiUrl/apiToken — os dois de LEITURA
 * (`realtime-query.service.ts`, `snapshot-ao-vivo.service.ts`, que é para
 * onde a correção mira) e os dois de ESCRITA (`syncAllProviders` aqui e a
 * rota manual `POST /api/admin/providers/:id/sync/:source`). Sem este teste,
 * a próxima pessoa vê os quatro guards abertos e conclui que está tudo certo
 * — quando a escrita, se rodasse, DUPLICARIA o mundo semeado: `upsertFromErp`/
 * `upsertFaturasDoErp` conciliam por `erp_ref`, e as linhas que
 * `server/demo/mundo-base.ts` semeia não têm `erp_ref` nenhum.
 *
 * `syncProviderToDb` é o único choke-point das duas portas de escrita (o
 * laço de `syncAllProviders` e a rota manual chamam esta mesma função) — o
 * teste chama ela diretamente, e mocka o resto do arquivo como
 * `erp-sync-faturas.test.ts` (arquivo-irmão) já faz, para o import não
 * tropeçar em rede, banco real ou geocodificação.
 */
import { describe, it, expect, vi } from "vitest";

const registrarResultadoSync = vi.fn(async () => {});
const contarFalhasConsecutivas = vi.fn(async () => 0);
const pausarPorFalhas = vi.fn(async () => {});

vi.mock("../storage", () => ({
  storage: {
    upsertFromErp: vi.fn(),
    upsertFaturasDoErp: vi.fn(),
    upsertFaturasDoErpPorDocumento: vi.fn(),
    baixarFaturasSumidas: vi.fn(),
    baixarDividaQuitada: vi.fn(),
    registrarResultadoSync: (...args: unknown[]) => registrarResultadoSync(...(args as [])),
    contarFalhasConsecutivas: (...args: unknown[]) => contarFalhasConsecutivas(...(args as [])),
    pausarPorFalhas: (...args: unknown[]) => pausarPorFalhas(...(args as [])),
    getErpIntegracoesResumo: async () => [],
    getProvider: async () => ({ id: 1, name: "Rede Norte Conecta", addressCity: "Londrina", addressState: "PR" }),
    getUsersByProvider: async () => [],
    ultimoPagamentoLido: async () => null,
    upsertFaturasPagasDoErp: async () => ({ gravadas: 0, semCliente: 0 }),
    getCustomersByProvider: async () => [],
  },
}));

// Trava por advisory lock: se o guard da fonte demo NAO disparar, o codigo
// chegaria aqui e `pool.connect()` (indefinido neste mock minimo) lancaria —
// o que faria o teste falhar alto, em vez de silenciosamente passar por um
// caminho que nao deveria ter sido percorrido.
vi.mock("../db", () => ({ pool: {}, db: {} }));

vi.mock("./geocoding", () => ({ geocodeCep: async () => null, resolveIbgeCode: async () => null }));
vi.mock("./coords-erp.service", () => ({ coordenadaDoErpCoerente: async () => null }));
vi.mock("./cidade-canonica.service", () => ({ canonizarCidadeDoCadastro: () => ({ municipio: null }) }));

const conector = vi.hoisted(() => ({ chamadas: 0 }));
vi.mock("../erp", async (original) => {
  const real = await original<typeof import("../erp")>();
  return {
    ...real,
    getConnector: (s: string) => {
      conector.chamadas++;
      return real.getConnector(s);
    },
  };
});

import { syncProviderToDb } from "./erp-sync.service";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";

const INTEGRACAO_DE_FACHADA = { apiUrl: "demo://mundo-base", apiToken: "qualquer-coisa-decifrada" };

describe("varredura pula a fonte demo", () => {
  it("nao tenta nada, mesmo com apiUrl/apiToken presentes", async () => {
    const resultado = await syncProviderToDb(1, "Rede Norte Conecta", FONTE_ERP_DEMO, INTEGRACAO_DE_FACHADA, "auto");
    expect(resultado).toEqual({ upserted: 0, errors: 0, pulado: true });
  });

  it("nao grava resultado de sync nem conta falha — pular nao e falhar", async () => {
    await syncProviderToDb(1, "Rede Norte Conecta", FONTE_ERP_DEMO, INTEGRACAO_DE_FACHADA, "auto");
    expect(registrarResultadoSync).not.toHaveBeenCalled();
    expect(contarFalhasConsecutivas).not.toHaveBeenCalled();
    expect(pausarPorFalhas).not.toHaveBeenCalled();
  });

  it("nunca chega a pedir o conector ao registry", async () => {
    conector.chamadas = 0;
    await syncProviderToDb(1, "Rede Norte Conecta", FONTE_ERP_DEMO, INTEGRACAO_DE_FACHADA, "manual");
    expect(conector.chamadas).toBe(0);
  });

  it("pula tambem no tipo manual (a mesma funcao atende as duas portas de escrita)", async () => {
    const resultado = await syncProviderToDb(1, "Rede Norte Conecta", FONTE_ERP_DEMO, INTEGRACAO_DE_FACHADA, "manual");
    expect(resultado.pulado).toBe(true);
  });
});
