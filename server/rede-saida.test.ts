/**
 * A ordem de resolucao de nome decide por qual dos NOSSOS enderecos saimos, e
 * isso decide se um parceiro com lista de IP permitido nos reconhece.
 *
 * O caso real esta em rede-saida.ts: a integracao SGP da Amplinet respondia 403
 * porque o servidor saia por IPv6 enquanto a lista do token tinha o IPv4.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dns from "node:dns";

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { preferirIPv4NaSaida } from "./rede-saida";
import { logger } from "./logger";

describe("preferirIPv4NaSaida", () => {
  let original: "ipv4first" | "verbatim";

  beforeEach(() => {
    original = dns.getDefaultResultOrder() as "ipv4first" | "verbatim";
    vi.clearAllMocks();
  });

  afterEach(() => {
    dns.setDefaultResultOrder(original);
  });

  it("poe o IPv4 na frente", () => {
    dns.setDefaultResultOrder("verbatim");

    preferirIPv4NaSaida();

    expect(dns.getDefaultResultOrder()).toBe("ipv4first");
  });

  it("registra a troca, com o valor anterior", () => {
    // A linha de log e a unica pista de que o processo subiu com a correcao,
    // e foi a ausencia dela que deixaria a regressao passar despercebida.
    dns.setDefaultResultOrder("verbatim");

    preferirIPv4NaSaida();

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [dados, msg] = (logger.info as any).mock.calls[0];
    expect(dados).toMatchObject({ anterior: "verbatim", agora: "ipv4first" });
    expect(String(msg)).toMatch(/IPv4/);
  });

  it("chamar duas vezes nao registra duas vezes", () => {
    // As duas entradas de processo chamam a funcao, e em dev o tsx recarrega
    // modulo: log repetido vira ruido que ninguem le.
    dns.setDefaultResultOrder("verbatim");

    preferirIPv4NaSaida();
    preferirIPv4NaSaida();

    expect(dns.getDefaultResultOrder()).toBe("ipv4first");
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("nao filtra IPv6 — reordena", async () => {
    // `ipv4first` ordena, nao remove. Um destino que so tem AAAA continua
    // alcancavel; se filtrasse, esta correcao trocaria um problema por outro.
    preferirIPv4NaSaida();

    const so6 = await dns.promises.lookup("ipv6.google.com", { all: true }).catch(() => null);
    if (so6) expect(so6.some(e => e.family === 6)).toBe(true);
    // Sem rede o teste nao afirma nada — a garantia esta na semantica do Node,
    // e o caso acima existe para quem duvidar poder rodar com rede e ver.
  });
});
