/**
 * Quem e avaliado para o alerta de fuga.
 *
 * O aviso nao pode depender de o ERP do dono estar de pe no segundo da
 * consulta: a base sincronizada entra como reserva para o provedor cujo ERP
 * nao respondeu. E `customers.status` so vira status de contrato nos valores
 * que o sync escreve — o default da coluna nao abre o portao.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../storage", () => ({ storage: {} }));
vi.mock("./email", () => ({ sendProactiveAlertEmail: vi.fn() }));
vi.mock("./marca.service", () => ({ resolverMarcaPorProviderId: vi.fn(), urlDeEntrada: () => "" }));
vi.mock("./crm/zapi", () => ({ isZapiConfigured: () => false, sendText: vi.fn() }));

import { escolherDonos, statusDaBase, textoDoAlerta } from "./proactive-alert.service";

const CONSULENTE = 9;

describe("statusDaBase", () => {
  it("so reconhece o que o sync escreve", () => {
    expect(statusDaBase("active")).toBe("active");
    expect(statusDaBase("suspended")).toBe("suspended");
    expect(statusDaBase("cancelled")).toBe("cancelled");
    expect(statusDaBase("inactive")).toBe("cancelled");
  });
  it("qualquer outra coisa e desconhecido — nunca 'ativo' por padrao", () => {
    expect(statusDaBase("")).toBeUndefined();
    expect(statusDaBase(null)).toBeUndefined();
    expect(statusDaBase("pendente")).toBeUndefined();
  });
});

describe("escolherDonos", () => {
  const aoVivo = [
    { providerId: 1, providerName: "A", name: "Fulano", contractStatus: "active" as const, totalOverdueAmount: 300, maxDaysOverdue: 20 },
    { providerId: CONSULENTE, providerName: "Eu", name: "Fulano", contractStatus: "active" as const, totalOverdueAmount: 0, maxDaysOverdue: 0 },
  ];
  const daBase = [
    { id: 11, providerId: 1, name: "Fulano da base", status: "cancelled", totalOverdueAmount: "0", maxDaysOverdue: 0 },
    { id: 22, providerId: 2, name: "Fulano em B", status: "suspended", totalOverdueAmount: "450.50", maxDaysOverdue: 40 },
    { id: 33, providerId: 3, name: "Fulano em C", status: "active", totalOverdueAmount: "80", maxDaysOverdue: 3 },
    { id: 99, providerId: CONSULENTE, name: "Fulano", status: "active", totalOverdueAmount: "0", maxDaysOverdue: 0 },
  ];

  it("o consulente nunca e dono; o registro ao vivo vence a base e ganha o id do cadastro", () => {
    const donos = escolherDonos(CONSULENTE, aoVivo, new Set([1, CONSULENTE]), daBase);
    const a = donos.find(d => d.providerId === 1)!;
    expect(a.origem).toBe("erp");
    expect(a.contractStatus).toBe("active");      // o ERP disse ativo; a base dizia cancelado
    expect(a.customerId).toBe(11);
    expect(donos.some(d => d.providerId === CONSULENTE)).toBe(false);
  });

  it("provedor cujo ERP nao respondeu entra pela base, com o status traduzido", () => {
    const donos = escolherDonos(CONSULENTE, aoVivo, new Set([1, CONSULENTE]), daBase);
    const b = donos.find(d => d.providerId === 2)!;
    expect(b).toMatchObject({ origem: "base", customerId: 22, contractStatus: "suspended", totalOverdueAmount: 450.5, maxDaysOverdue: 40 });
  });

  it("provedor cujo ERP RESPONDEU e nao tem o cliente fica de fora — o ERP e mais fresco que a base", () => {
    const donos = escolherDonos(CONSULENTE, aoVivo, new Set([1, 3, CONSULENTE]), daBase);
    expect(donos.some(d => d.providerId === 3)).toBe(false);
  });

  it("sem lista de quem respondeu, vale quem trouxe registro ao vivo", () => {
    const donos = escolherDonos(CONSULENTE, aoVivo, new Set(aoVivo.map(c => c.providerId)), daBase);
    expect(donos.map(d => d.providerId).sort()).toEqual([1, 2, 3]);
  });
});
describe("textoDoAlerta", () => {
  const semDivida = { contractStatus: "active" as const, totalOverdueAmount: 0, maxDaysOverdue: 0 };

  it("diz o motivo principal com os numeros do momento", () => {
    expect(textoDoAlerta(["divida_ativa"], { contractStatus: "suspended", totalOverdueAmount: 561, maxDaysOverdue: 84 }, 1))
      .toBe("Seu cliente suspenso com R$ 561,00 vencidos há 84 dias foi consultado por outro provedor da rede");
    expect(textoDoAlerta(["consultas_repetidas", "cliente_ativo"], semDivida, 3))
      .toBe("Seu cliente ativo foi consultado por 3 provedores diferentes nos últimos 30 dias");
    expect(textoDoAlerta(["contrato_novo"], semDivida, 1, 13))
      .toBe("Seu cliente novo, com 13 dias de contrato, foi consultado por outro provedor da rede");
    expect(textoDoAlerta(["cliente_ativo"], semDivida, 1))
      .toBe("Seu cliente ativo foi consultado por outro provedor da rede");
  });
});
