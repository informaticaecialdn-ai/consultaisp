/**
 * `diasDesdeVencimento` — a distincao entre "vence depois", "vence hoje" e
 * "nao sei quando vence".
 *
 * `calculateDaysOverdue` devolve 0 para as tres. Quem le esse 0 como "sem
 * atraso" acerta; quem le como "tem fatura, entao ao menos 1 dia" — que era o
 * que o connector do MK fazia — inventa inadimplencia. Medido na NsLink em
 * 28/08/2026: 153 dos 440 inadimplentes tinham exatamente 1 dia de atraso, e
 * as faturas correspondentes ainda nem tinham vencido.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { diasDesdeVencimento, calculateDaysOverdue } from "./normalize";

const HOJE = new Date(2026, 7, 28, 15, 30); // 28/08/2026, meio da tarde

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOJE); });
afterEach(() => { vi.useRealTimers(); });

describe("diasDesdeVencimento", () => {
  it("fatura a vencer devolve numero NEGATIVO, nao zero", () => {
    // O caso da planilha do provedor: mensalidade com vencimento em 10 dias.
    expect(diasDesdeVencimento("07/09/2026")).toBe(-10);
    expect(diasDesdeVencimento("29/08/2026")).toBe(-1);
  });

  it("vence hoje e zero — nao esta em atraso", () => {
    // Comparacao por dia: as 15:30 a fatura de hoje ainda esta no prazo.
    expect(diasDesdeVencimento("28/08/2026")).toBe(0);
  });

  it("fatura vencida devolve os dias corridos", () => {
    expect(diasDesdeVencimento("27/08/2026")).toBe(1);
    expect(diasDesdeVencimento("28/07/2026")).toBe(31);
  });

  it("data ausente ou ilegivel devolve null — nao zero", () => {
    // Este e o motivo de a funcao existir: `null` obriga quem chama a decidir
    // o que fazer com o desconhecido, em vez de silenciosamente trata-lo como
    // "em dia" ou como "atrasado".
    expect(diasDesdeVencimento(null)).toBeNull();
    expect(diasDesdeVencimento(undefined)).toBeNull();
    expect(diasDesdeVencimento("")).toBeNull();
    expect(diasDesdeVencimento("sem data")).toBeNull();
    expect(diasDesdeVencimento("32/13/2026")).toBeNull();
  });

  it("aceita ISO e Date, nao so o DD/MM/AAAA do MK", () => {
    expect(diasDesdeVencimento("2026-08-27")).toBe(1);
    expect(diasDesdeVencimento(new Date(2026, 7, 27))).toBe(1);
  });
});

describe("calculateDaysOverdue continua com o contrato antigo", () => {
  it("piso em zero para futuro, invalido e nulo", () => {
    expect(calculateDaysOverdue("07/09/2026")).toBe(0);
    expect(calculateDaysOverdue("sem data")).toBe(0);
    expect(calculateDaysOverdue(null)).toBe(0);
  });

  it("mesmo valor da funcao nova quando ha atraso", () => {
    expect(calculateDaysOverdue("28/07/2026")).toBe(31);
  });
});

/**
 * O caso do IXC, e a razão de `diasDesdeVencimento` ter virado o predicado de
 * "está vencida?" em todos os conectores.
 *
 * `new Date("2026-08-28") < new Date()` parece a comparação óbvia e está
 * errada: o V8 lê a forma AAAA-MM-DD como meia-noite UTC, que em Brasília é
 * 21h do dia ANTERIOR. Medido na VPS (America/Sao_Paulo) em 28/08/2026: a
 * fatura que vence hoje respondia `true`. É o mesmo defeito que punha 641
 * clientes do MK com um dia de atraso que não existia.
 */
describe("fatura que vence hoje nao esta vencida", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOJE); });
  afterEach(() => { vi.useRealTimers(); });

  it("a comparacao ingenua erra — e por isso ela nao e usada", () => {
    expect(new Date("2026-08-28") < new Date()).toBe(true); // o defeito
    expect((diasDesdeVencimento("2026-08-28") ?? -1) > 0).toBe(false); // a regra
  });

  it("ontem esta vencida, hoje e amanha nao", () => {
    const vencida = (d: string) => (diasDesdeVencimento(d) ?? -1) > 0;
    expect(vencida("2026-08-27")).toBe(true);
    expect(vencida("2026-08-28")).toBe(false);
    expect(vencida("2026-08-29")).toBe(false);
  });

  it("data ilegivel nao conta como vencida", () => {
    // `?? -1` faz o desconhecido cair para fora, e nao para dentro: um bureau
    // nao inventa inadimplencia a partir de dado que nao conseguiu ler.
    expect((diasDesdeVencimento(null) ?? -1) > 0).toBe(false);
    expect((diasDesdeVencimento("sem data") ?? -1) > 0).toBe(false);
  });

  it("data com hora e lida nos dois formatos", () => {
    // O ramo BR exigia ano de 4 digitos no ultimo pedaco, entao
    // "20/08/2026 14:30" virava Invalid Date. Antes isso virava "1 dia"; depois
    // da regra nova viraria fatura DESCARTADA — o inadimplente sumia da conta.
    expect(diasDesdeVencimento("20/08/2026 14:30")).toBe(8);
    expect(diasDesdeVencimento("2026-08-20T14:30:00Z")).toBe(8);
    expect(diasDesdeVencimento("2026-08-20 14:30:00")).toBe(8);
  });
});
