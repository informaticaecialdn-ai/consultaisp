import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Serial E MAC na mesma linha de `equipment`.
 *
 * Medido em producao em 05/09/2026: 322 aparelhos da Amplinet, 322 series,
 * ZERO MAC — porque o conector escolhia `serial ?? mac` e o storage so casava
 * por serie. A fase 3 cruza o serial da ONU (OLT, via SNMP) com o MAC
 * autenticado (RADIUS), e isso exige os dois na mesma linha.
 *
 * O que estes testes travam, do lado do storage:
 *   · sem serie, o MAC basta para gravar e para casar;
 *   · um identificador ja gravado nunca e trocado nem apagado — so o vazio
 *     e preenchido;
 *   · as 322 linhas legadas (MAC no campo de serie) sao reconhecidas, e nao
 *     inseridas de novo na varredura seguinte.
 *
 * O banco e um fake que registra o que foi inserido e atualizado; o `where`
 * do update e compilado pelo dialeto Postgres para provar QUAL linha mudou.
 */
const dbFalso = vi.hoisted(() => {
  const estado = {
    linhas: [] as any[],
    inseridos: [] as any[],
    atualizacoes: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
  };
  const db = {
    select() { return { from() { return { where: async () => estado.linhas }; } }; },
    insert() { return { values: async (v: any) => { estado.inseridos.push(v); } }; },
    update() {
      return {
        set(s: Record<string, unknown>) {
          return { where: async (w: unknown) => { estado.atualizacoes.push({ set: s, where: w }); } };
        },
      };
    },
  };
  return { db, estado };
});
vi.mock("../db", () => ({ db: dbFalso.db, pool: {} }));

import { PgDialect } from "drizzle-orm/pg-core";
import { EquipmentStorage } from "./equipment.storage";

const { estado } = dbFalso;
const dialeto = new PgDialect();
const storage = new EquipmentStorage();

const PROVEDOR = 1;
const CLIENTE = 7;
const MAC = "AABBCCDDEE01";
const SERIE = "ZTEG1234ABCD";

const linha = (over: Record<string, unknown> = {}) => ({
  id: 10, providerId: PROVEDOR, customerId: CLIENTE,
  serialNumber: null, mac: null, status: "em_comodato", inRecoveryProcess: false, source: "erp",
  ...over,
});

const doErp = (over: Record<string, unknown> = {}) => ({
  type: "ONU", brand: "", model: "", serialNumber: "", value: "", inRecoveryProcess: false,
  ...over,
});

/** O id que o `where` do update aponta — a prova de qual linha foi tocada. */
const idAtualizado = (a: { where: unknown }) => dialeto.sqlToQuery(a.where as any).params[0];

const sincronizar = (detalhes: any[]) => storage.syncEquipmentFromErp(PROVEDOR, CLIENTE, detalhes);

beforeEach(() => {
  estado.linhas = [];
  estado.inseridos = [];
  estado.atualizacoes = [];
});

describe("syncEquipmentFromErp · gravar", () => {
  it("servico com serial e MAC entra com os dois, cada um na sua coluna", async () => {
    const r = await sincronizar([doErp({ serialNumber: SERIE, mac: MAC })]);

    expect(r).toEqual({ inseridos: 1, devolvidos: 0 });
    expect(estado.inseridos[0]).toMatchObject({ serialNumber: SERIE, mac: MAC, source: "erp" });
  });

  it("so MAC entra — nao e descartado como 'sem serie'", async () => {
    // Na Amplinet e 100% dos aparelhos: serial vazio, so o MAC.
    const r = await sincronizar([doErp({ mac: MAC })]);

    expect(r.inseridos).toBe(1);
    expect(estado.inseridos[0]).toMatchObject({ serialNumber: null, mac: MAC });
  });

  it("sem serial e sem MAC nada e gravado", async () => {
    const r = await sincronizar([doErp({ serialNumber: "  " })]);

    expect(r).toEqual({ inseridos: 0, devolvidos: 0 });
    expect(estado.inseridos).toHaveLength(0);
    expect(estado.atualizacoes).toHaveLength(0);
  });

  it("MAC fora dos 12 hexadecimais nao e chave: sem serie o aparelho nao entra, com serie entra sem MAC", async () => {
    expect((await sincronizar([doErp({ mac: "AA:BB:CC" })])).inseridos).toBe(0);

    await sincronizar([doErp({ serialNumber: SERIE, mac: "AA:BB:CC" })]);
    expect(estado.inseridos[0]).toMatchObject({ serialNumber: SERIE, mac: null });
  });
});

describe("syncEquipmentFromErp · casar a linha existente", () => {
  it("pela serie, como antes — espacos e caixa nao separam", async () => {
    estado.linhas = [linha({ serialNumber: " zteg1234abcd" })];

    await sincronizar([doErp({ serialNumber: SERIE })]);

    expect(estado.inseridos).toHaveLength(0);
    expect(estado.atualizacoes).toHaveLength(0);
  });

  it("sem serie, pelo MAC — em qualquer grafia que a linha tenha", async () => {
    estado.linhas = [linha({ mac: "aa:bb:cc:dd:ee:01", source: "manual" })];

    await sincronizar([doErp({ mac: MAC })]);

    expect(estado.inseridos).toHaveLength(0);
    expect(estado.atualizacoes).toHaveLength(0);
  });

  it("a serie manda: a linha achada pela serie nao tem o MAC trocado", async () => {
    // O ERP diz outro MAC para a mesma serie. Sobrescrever esconderia a
    // divergencia que o cruzamento OLT x RADIUS existe para achar.
    estado.linhas = [linha({ serialNumber: SERIE, mac: "111111111111" })];

    await sincronizar([doErp({ serialNumber: SERIE, mac: MAC })]);

    expect(estado.inseridos).toHaveLength(0);
    expect(estado.atualizacoes).toHaveLength(0);
  });

  it("linha aberta so com MAC ganha a serie quando o ERP a traz", async () => {
    // O RADIUS pode ter gravado o MAC antes de o ERP mandar a serie.
    estado.linhas = [linha({ mac: MAC, source: "manual" })];

    await sincronizar([doErp({ serialNumber: SERIE, mac: MAC })]);

    expect(estado.inseridos).toHaveLength(0);
    expect(estado.atualizacoes).toHaveLength(1);
    expect(idAtualizado(estado.atualizacoes[0])).toBe(10);
    expect(estado.atualizacoes[0].set).toMatchObject({ serialNumber: SERIE });
    expect(estado.atualizacoes[0].set).not.toHaveProperty("mac");
  });
});

describe("syncEquipmentFromErp · completar sem apagar", () => {
  it("linha so com serie ganha o MAC quando o ERP o traz", async () => {
    estado.linhas = [linha({ serialNumber: SERIE })];

    await sincronizar([doErp({ serialNumber: SERIE, mac: MAC })]);

    expect(estado.atualizacoes).toHaveLength(1);
    expect(idAtualizado(estado.atualizacoes[0])).toBe(10);
    expect(estado.atualizacoes[0].set).toMatchObject({ mac: MAC });
    expect(estado.atualizacoes[0].set).not.toHaveProperty("serialNumber");
    expect(estado.atualizacoes[0].set).not.toHaveProperty("status");
  });

  it("ERP manda so o serial depois: o MAC que ja estava gravado fica", async () => {
    estado.linhas = [linha({ serialNumber: SERIE, mac: MAC })];

    await sincronizar([doErp({ serialNumber: SERIE })]);

    expect(estado.inseridos).toHaveLength(0);
    expect(estado.atualizacoes).toHaveLength(0);
  });

  it("devolucao confirmada e MAC novo saem numa escrita so", async () => {
    estado.linhas = [linha({ serialNumber: SERIE })];

    const r = await sincronizar([doErp({ serialNumber: SERIE, mac: MAC, status: "devolvido" })]);

    expect(r.devolvidos).toBe(1);
    expect(estado.atualizacoes).toHaveLength(1);
    expect(estado.atualizacoes[0].set).toMatchObject({
      status: "recuperado_triagem", inRecoveryProcess: false, mac: MAC,
    });
    expect(estado.atualizacoes[0].set.updatedAt).toBeInstanceOf(Date);
  });
});

describe("syncEquipmentFromErp · legado: o MAC gravado no campo de serie", () => {
  it("reconhece a linha do sync antigo e move o MAC para a coluna certa, sem inserir de novo", async () => {
    // As 322 linhas da Amplinet: `serial_number` = "AA:BB:CC:DD:EE:01", `mac`
    // nulo, origem erp. A varredura seguinte manda so o MAC.
    estado.linhas = [linha({ serialNumber: "AA:BB:CC:DD:EE:01", source: "erp" })];

    const r = await sincronizar([doErp({ mac: MAC })]);

    expect(r.inseridos).toBe(0);
    expect(estado.inseridos).toHaveLength(0);
    expect(estado.atualizacoes).toHaveLength(1);
    expect(idAtualizado(estado.atualizacoes[0])).toBe(10);
    // Serie desconhecida e nula, nao o MAC repetido.
    expect(estado.atualizacoes[0].set).toMatchObject({ mac: MAC, serialNumber: null });
  });

  it("se o ERP passou a mandar a serie, ela toma o lugar do MAC que estava ali", async () => {
    estado.linhas = [linha({ serialNumber: "AA:BB:CC:DD:EE:01", source: "erp" })];

    await sincronizar([doErp({ serialNumber: SERIE, mac: MAC })]);

    expect(estado.inseridos).toHaveLength(0);
    expect(estado.atualizacoes[0].set).toMatchObject({ mac: MAC, serialNumber: SERIE });
  });

  it("em linha manual o MAC e preenchido e a serie do operador fica como esta", async () => {
    // Manual vence: a serie e o que o operador digitou, mesmo que pareca MAC.
    estado.linhas = [linha({ serialNumber: MAC, source: "manual" })];

    await sincronizar([doErp({ mac: MAC })]);

    expect(estado.inseridos).toHaveLength(0);
    expect(estado.atualizacoes).toHaveLength(1);
    expect(estado.atualizacoes[0].set).toMatchObject({ mac: MAC });
    expect(estado.atualizacoes[0].set).not.toHaveProperty("serialNumber");
  });

  it("serie que nao tem forma de MAC nao entra no caminho legado", async () => {
    // "ZTEG1234ABCD" tem 12 chars mas nao e hexadecimal: uma serie de verdade
    // nunca pode ser confundida com o MAC de outro aparelho.
    estado.linhas = [linha({ serialNumber: SERIE, source: "erp" })];

    const r = await sincronizar([doErp({ mac: "1234ABCD0000" })]);

    expect(r.inseridos).toBe(1);
    expect(estado.atualizacoes).toHaveLength(0);
  });
});
