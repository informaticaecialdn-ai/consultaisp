import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { pool } from "../db";
import {
  decodificarBin, pontosDoTerritorio, municipioDaCidade, limparCacheTerritorio, ehCamadaTerritorio,
} from "./territorio-pontos.service";

const query = vi.mocked(pool.query) as unknown as ReturnType<typeof vi.fn>;

/** Diretório vazio por teste: o serviço decide pelo que encontra lá. */
function dirTemporario(): string {
  return mkdtempSync(path.join(tmpdir(), "territorio-"));
}

function gravarBin(dir: string, nome: string, valores: number[]): void {
  const f = new Float32Array(valores);
  writeFileSync(path.join(dir, nome), Buffer.from(f.buffer, f.byteOffset, f.byteLength));
}

const LONDRINA = [-23.3103, -51.1628, -23.3369, -51.1352];

beforeEach(() => {
  limparCacheTerritorio();
  query.mockReset();
});

describe("decodificarBin", () => {
  it("lê o Float32Array intercalado exatamente como foi gravado", () => {
    const f = new Float32Array(LONDRINA);
    const out = decodificarBin(Buffer.from(f.buffer, f.byteOffset, f.byteLength));
    expect(Array.from(out)).toEqual(Array.from(f));
  });

  it("ignora bytes sobrando no fim — meio ponto não vira ponto", () => {
    const f = new Float32Array([...LONDRINA, -23.0]); // uma lat sem lon
    const out = decodificarBin(Buffer.from(f.buffer, f.byteOffset, f.byteLength));
    expect(out.length).toBe(4);
  });

  it("buffer desalinhado é copiado, não estoura", () => {
    const f = new Float32Array(LONDRINA);
    // Um byte na frente para desalinhar o offset dentro do ArrayBuffer.
    const bruto = Buffer.concat([Buffer.from([0]), Buffer.from(f.buffer, f.byteOffset, f.byteLength)]);
    const desalinhado = bruto.subarray(1);
    expect(desalinhado.byteOffset % 4).not.toBe(0);
    expect(Array.from(decodificarBin(desalinhado))).toEqual(Array.from(f));
  });
});

describe("pontosDoTerritorio", () => {
  it("com o .bin no disco, lê o arquivo e não toca no banco", async () => {
    const dir = dirTemporario();
    gravarBin(dir, "cnefe-4113700.bin", LONDRINA);

    const r = await pontosDoTerritorio("cnefe", "4113700", { dir });
    expect(r).not.toBeNull();
    expect(r!.origem).toBe("bin");
    expect(r!.pontos.length / 2).toBe(2);
    expect(r!.pontos[0]).toBeCloseTo(-23.3103, 4);
    expect(r!.etag).toMatch(/^"[0-9a-f]{40}"$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("os .bin do repositório abrem no formato esperado", async () => {
    const r = await pontosDoTerritorio("cnefe", "4109807");
    expect(r).not.toBeNull();
    expect(r!.pontos.length / 2).toBe(23227);
    // Ibiporã: lat ≈ -23,27, lon ≈ -51,05.
    expect(r!.pontos[0]).toBeCloseTo(-23.27, 1);
    expect(r!.pontos[1]).toBeCloseTo(-51.05, 1);
  });

  it("CNEFE sem .bin sai de geo_endereco, com cache em memória", async () => {
    const dir = dirTemporario();
    query.mockResolvedValueOnce({
      rows: [
        { latitude: "-23.3103000", longitude: "-51.1628000" },
        { latitude: "lixo", longitude: "-51.0" }, // linha inválida cai fora
        { latitude: "-23.3369000", longitude: "-51.1352000" },
      ],
    });

    const r = await pontosDoTerritorio("cnefe", "4113700", { dir });
    expect(r!.origem).toBe("banco");
    expect(r!.pontos.length / 2).toBe(2);
    expect(r!.pontos[3]).toBeCloseTo(-51.1352, 4);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(["4113700"]);

    const de_novo = await pontosDoTerritorio("cnefe", "4113700", { dir });
    expect(de_novo).toBe(r);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("ANEEL sem .bin é null e não consulta nada — a BDGD não tem ponto por UC", async () => {
    const dir = dirTemporario();
    expect(await pontosDoTerritorio("aneel", "4113700", { dir })).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("geo_endereco vazia ou inexistente é null", async () => {
    const dir = dirTemporario();
    query.mockResolvedValueOnce({ rows: [] });
    expect(await pontosDoTerritorio("cnefe", "9999999", { dir })).toBeNull();

    query.mockRejectedValueOnce(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    limparCacheTerritorio();
    expect(await pontosDoTerritorio("cnefe", "9999999", { dir })).toBeNull();
  });

  it("negativo recente responde da memória sem repetir a consulta", async () => {
    const dir = dirTemporario();
    query.mockResolvedValueOnce({ rows: [] });
    await pontosDoTerritorio("cnefe", "9999999", { dir });
    await pontosDoTerritorio("cnefe", "9999999", { dir });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("negativo expira: passado o TTL, volta ao banco e a base recém-carregada aparece", async () => {
    vi.useFakeTimers();
    try {
      const dir = dirTemporario();
      const inicio = Date.now();
      query.mockResolvedValueOnce({ rows: [] });
      expect(await pontosDoTerritorio("cnefe", "9999999", { dir })).toBeNull();

      // Um instante antes de vencer, ainda é da memória.
      vi.setSystemTime(inicio + 10 * 60 * 1000 - 1);
      expect(await pontosDoTerritorio("cnefe", "9999999", { dir })).toBeNull();
      expect(query).toHaveBeenCalledTimes(1);

      // Vencido: consulta de novo, e o CNEFE carregado nesse meio-tempo entra.
      vi.setSystemTime(inicio + 10 * 60 * 1000 + 1);
      query.mockResolvedValueOnce({ rows: [{ latitude: "-23.3", longitude: "-51.1" }] });
      const r = await pontosDoTerritorio("cnefe", "9999999", { dir });
      expect(query).toHaveBeenCalledTimes(2);
      expect(r!.origem).toBe("banco");
      expect(r!.pontos.length / 2).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("erro de banco não fica em cache", async () => {
    const dir = dirTemporario();
    query.mockRejectedValueOnce(new Error("connection refused"));
    await expect(pontosDoTerritorio("cnefe", "4113700", { dir })).rejects.toThrow("connection refused");

    query.mockResolvedValueOnce({ rows: [{ latitude: "-23.3", longitude: "-51.1" }] });
    expect((await pontosDoTerritorio("cnefe", "4113700", { dir }))!.pontos.length).toBe(2);
  });
});

describe("municipioDaCidade", () => {
  it("normaliza o nome como vem do ERP e devolve o código do vínculo", async () => {
    query.mockResolvedValueOnce({ rows: [{ municipio_ibge: "4113700" }] });
    expect(await municipioDaCidade("Londrina - PR")).toBe("4113700");
    expect(query.mock.calls[0][1]).toEqual(["londrina", "LONDRINA"]);
  });

  it("cidade sem base é null; nome vazio nem consulta", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await municipioDaCidade("Xanadu")).toBeNull();
    expect(await municipioDaCidade("  ")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("com UF, filtra por ela e não confunde o cache com a consulta sem UF", async () => {
    query.mockResolvedValueOnce({ rows: [{ municipio_ibge: "4302808" }] });
    expect(await municipioDaCidade("Bom Jesus", "rs")).toBe("4302808");
    expect(query.mock.calls[0][0]).toMatch(/upper\(uf\) = \$3/);
    expect(query.mock.calls[0][1]).toEqual(["bom jesus", "BOM JESUS", "RS"]);

    query.mockResolvedValueOnce({ rows: [{ municipio_ibge: "2201903" }] });
    expect(await municipioDaCidade("Bom Jesus", "PI")).toBe("2201903");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("homônimas sem UF: mais de um município é null, não o primeiro que o banco devolver", async () => {
    query.mockResolvedValueOnce({ rows: [{ municipio_ibge: "2201903" }, { municipio_ibge: "4302808" }] });
    expect(await municipioDaCidade("Bom Jesus")).toBeNull();
    expect(query.mock.calls[0][0]).not.toMatch(/upper\(uf\)/);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY municipio_ibge/);
  });
});

describe("ehCamadaTerritorio", () => {
  it("só aceita as duas camadas conhecidas", () => {
    expect(ehCamadaTerritorio("cnefe")).toBe(true);
    expect(ehCamadaTerritorio("aneel")).toBe(true);
    expect(ehCamadaTerritorio("clientes")).toBe(false);
  });
});
