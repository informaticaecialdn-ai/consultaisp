import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rotina de cobertura vista de dentro: cadência, teto por passada e o que a
 * passada registra para a tela.
 *
 * O que a rota já prova (isolamento, permissão, duas cargas não se atropelam)
 * está em `server/routes/localizacao.routes.test.ts`. Aqui ficam as três coisas
 * que só o agendador conhece:
 *
 *   · o teto de cidades por passada — sem ele uma primeira carga poderia
 *     segurar o FTP do IBGE por horas, e a plotagem atrás dela;
 *   · a passada NUNCA lança: quem a chama é um `setInterval` e, no worker, a
 *     plotagem que vem logo depois;
 *   · o relógio é de 24h, e não os 6h da plotagem — a carga baixa dezenas de MB
 *     por município, e cidade nova na carteira é evento de dias.
 */

vi.mock("../db", () => ({ pool: {}, db: {} }));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const servico = vi.hoisted(() => ({
  carregarBasesFaltantes: vi.fn(async (_p?: number | null, _o: any = {}) => ({
    providerId: _p ?? null, faltavam: 0, tentadas: 0, carregadas: [], falhas: [],
  }) as any),
}));
vi.mock("./cobertura-geo.service", () => servico);

import {
  INTERVALO_DA_AGENDA_MS, LIMITE_POR_PASSADA, ESPERA_MAXIMA_DA_PRIMEIRA_PASSADA_MS,
  _reiniciarCoberturaParaTestes, estadoDaCobertura, iniciarAgendaDeCobertura,
  rodarCargaDeCobertura,
} from "./cobertura-geo-agenda.service";

const municipio = (nome: string, uf: string, ibge: string) => ({ nome, uf, ibge });

beforeEach(() => {
  vi.clearAllMocks();
  _reiniciarCoberturaParaTestes();
});

afterEach(() => {
  _reiniciarCoberturaParaTestes();
  vi.useRealTimers();
});

describe("uma passada", () => {
  it("mede a base inteira quando ninguém diz o alvo — é a passada do worker", async () => {
    await rodarCargaDeCobertura();

    expect(servico.carregarBasesFaltantes).toHaveBeenCalledWith(null, expect.objectContaining({
      limite: LIMITE_POR_PASSADA,
    }));
  });

  it("leva o teto de cidades por passada", async () => {
    // Um município grande passa de 40 MB e o download tem timeout de 15 min:
    // uma passada sem teto poderia ocupar o FTP do IBGE por horas, e a
    // plotagem espera por ela no boot do worker.
    expect(LIMITE_POR_PASSADA).toBe(12);
    await rodarCargaDeCobertura(6);
    expect(servico.carregarBasesFaltantes).toHaveBeenCalledWith(6, expect.objectContaining({ limite: 12 }));
  });

  it("conta o que carregou e guarda a cidade que falhou, com o motivo", async () => {
    servico.carregarBasesFaltantes.mockImplementationOnce(async (_p: any, o: any) => {
      o.aoTerminar({ municipio: municipio("Embu-Guaçu", "SP", "3515103"), ok: true, domicilios: 12_000, enderecos: 9_000 });
      o.aoTerminar({ municipio: municipio("Itapecerica da Serra", "SP", "3522208"), ok: false, erro: "HTTP 503 no índice de SP" });
      return { providerId: 6, faltavam: 2, tentadas: 2, carregadas: [], falhas: [] } as any;
    });

    const e = await rodarCargaDeCobertura(6);

    expect(e.carregadas).toBe(1);
    expect(e.falhas).toBe(1);
    expect(e.faltavam).toBe(2);
    expect(e.ultimasFalhas).toEqual([
      { cidade: "Itapecerica da Serra", uf: "SP", erro: "HTTP 503 no índice de SP" },
    ]);
    expect(e.emAndamento).toBe(false);
    expect(e.terminadoEm).not.toBeNull();
  });

  it("uma passada que explode não lança e não deixa o sinal preso", async () => {
    // Quem chama é um `setInterval` — uma exceção aqui viraria unhandled
    // rejection — e, no worker, a plotagem que vem depois.
    servico.carregarBasesFaltantes.mockRejectedValueOnce(new Error("banco fora do ar"));

    const e = await rodarCargaDeCobertura(6);

    expect(e.emAndamento).toBe(false);
    expect(estadoDaCobertura().emAndamento).toBe(false);
  });

  it("a segunda chamada sai na hora enquanto a primeira roda", async () => {
    let abrir!: () => void;
    servico.carregarBasesFaltantes.mockImplementationOnce(async () => {
      await new Promise<void>(r => { abrir = r; });
      return { providerId: null, faltavam: 0, tentadas: 0, carregadas: [], falhas: [] } as any;
    });

    const primeira = rodarCargaDeCobertura(null);
    const segunda = await rodarCargaDeCobertura(6);

    expect(segunda.emAndamento).toBe(true);
    expect(servico.carregarBasesFaltantes).toHaveBeenCalledTimes(1);
    // E a segunda não roubou o alvo da primeira: quem está medindo é o worker.
    expect(segunda.alvo).toBeNull();
    abrir();
    await primeira;
  });
});

describe("o relógio", () => {
  it("é de 24h — a plotagem é que roda de 6 em 6", () => {
    // A medição custa uma query agregada, mas a CARGA baixa dezenas de MB por
    // município, e ela só tem o que fazer quando aparece cidade nova na
    // carteira: um provedor que entra ou uma praça nova. Escala de dias.
    expect(INTERVALO_DA_AGENDA_MS).toBe(24 * 60 * 60 * 1000);
    expect(ESPERA_MAXIMA_DA_PRIMEIRA_PASSADA_MS).toBeLessThan(INTERVALO_DA_AGENDA_MS);
  });

  it("não roda nada ao ser ligado — a primeira passada é do worker, antes da plotagem", () => {
    vi.useFakeTimers();

    iniciarAgendaDeCobertura();

    // Se ligar já disparasse, a ordem "base antes da plotagem" passaria a
    // depender de quem chamou primeiro no boot.
    expect(servico.carregarBasesFaltantes).not.toHaveBeenCalled();
  });

  it("dispara a cada 24h, e ligar duas vezes não vira dois relógios", async () => {
    vi.useFakeTimers();

    iniciarAgendaDeCobertura();
    iniciarAgendaDeCobertura();
    // Assíncrono: entre o disparo do relógio e a chamada do serviço há a trava
    // do Postgres, que é um await.
    await vi.advanceTimersByTimeAsync(INTERVALO_DA_AGENDA_MS);

    expect(servico.carregarBasesFaltantes).toHaveBeenCalledTimes(1);
    expect(servico.carregarBasesFaltantes).toHaveBeenCalledWith(null, expect.anything());
  });
});
