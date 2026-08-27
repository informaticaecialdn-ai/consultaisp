import { describe, it, expect } from "vitest";
import { montarConsultaLocal, descreverIdade, IDADE_MAXIMA_HORAS } from "./consulta-local.service";

const AGORA = new Date("2026-08-27T15:00:00Z").getTime();
const h = (n: number) => new Date(AGORA - n * 3_600_000);

function cliente(over: Partial<any> = {}): any {
  return {
    id: 1,
    providerId: 7,
    cpfCnpj: "12345678901",
    name: "Fulano de Tal",
    address: "Rua A",
    city: "Londrina",
    state: "PR",
    cep: "86010000",
    status: "active",
    totalOverdueAmount: "250.50",
    maxDaysOverdue: 42,
    overdueInvoicesCount: 2,
    erpSource: "ixc",
    lastSyncAt: h(3),
    ...over,
  };
}

const NOMES = new Map([[7, { nome: "NsLink", erpSource: "ixc" }]]);

describe("montarConsultaLocal", () => {
  it("serve o dado local quando ele e recente", () => {
    const r = montarConsultaLocal([cliente()], NOMES, AGORA);
    expect(r.estaFresca).toBe(true);
    expect(r.resultados).toHaveLength(1);
    expect(r.resultados[0].providerName).toBe("NsLink");
    expect(r.resultados[0].customers[0].totalOverdueAmount).toBe(250.5);
    expect(r.resultados[0].customers[0].maxDaysOverdue).toBe(42);
  });

  it("nao serve quando nao ha registro — a consulta tem que ir ao vivo", () => {
    const r = montarConsultaLocal([], NOMES, AGORA);
    expect(r.estaFresca).toBe(false);
    expect(r.motivo).toBe("sem-registro");
    expect(r.resultados).toEqual([]);
  });

  /**
   * O caso que motivou o servico: a base restaurada do backup responderia na
   * hora, com dado de meses atras, e ninguem veria a diferenca.
   */
  it("nao serve dado vencido, mesmo tendo encontrado o CPF", () => {
    const r = montarConsultaLocal([cliente({ lastSyncAt: h(IDADE_MAXIMA_HORAS + 1) })], NOMES, AGORA);
    expect(r.estaFresca).toBe(false);
    expect(r.motivo).toBe("vencida");
    expect(r.resultados).toEqual([]);
    expect(r.sincronizadoEm).not.toBeNull();
  });

  it("nao serve linha sem carimbo de sync — import de CSV nao prova frescor", () => {
    const r = montarConsultaLocal([cliente({ lastSyncAt: null })], NOMES, AGORA);
    expect(r.estaFresca).toBe(false);
    expect(r.motivo).toBe("sem-carimbo");
  });

  it("na fronteira exata da janela ainda serve", () => {
    const r = montarConsultaLocal([cliente({ lastSyncAt: h(IDADE_MAXIMA_HORAS) })], NOMES, AGORA);
    expect(r.estaFresca).toBe(true);
  });

  it("agrupa por provedor, um resultado por ERP", () => {
    const nomes = new Map([
      [7, { nome: "NsLink", erpSource: "ixc" }],
      [9, { nome: "O L I", erpSource: "mk" }],
    ]);
    const r = montarConsultaLocal(
      [cliente(), cliente({ providerId: 9, erpSource: "mk" })],
      nomes, AGORA,
    );
    expect(r.resultados).toHaveLength(2);
    expect(r.resultados.map(x => x.erpSource).sort()).toEqual(["ixc", "mk"]);
  });

  it("a idade e a do carimbo MAIS RECENTE, nao a do mais velho", () => {
    const r = montarConsultaLocal(
      [cliente({ lastSyncAt: h(2) }), cliente({ providerId: 9, lastSyncAt: h(200) })],
      NOMES, AGORA,
    );
    expect(r.estaFresca).toBe(true);
    expect(Math.round(r.idadeHoras!)).toBe(2);
  });

  it("nao inventa provedor: cai para o erpSource da propria linha", () => {
    const r = montarConsultaLocal([cliente({ providerId: 99 })], NOMES, AGORA);
    expect(r.resultados[0].providerName).toBe("Provedor 99");
    expect(r.resultados[0].erpSource).toBe("ixc");
  });
});

describe("descreverIdade", () => {
  it("descreve hoje, ontem e dias atras", () => {
    expect(descreverIdade(h(0.5), AGORA)).toBe("sincronizado agora há pouco");
    expect(descreverIdade(h(5), AGORA)).toMatch(/^sincronizado hoje às /);
    expect(descreverIdade(h(30), AGORA)).toMatch(/^sincronizado ontem às /);
    expect(descreverIdade(h(24 * 5), AGORA)).toBe("sincronizado há 5 dias");
  });

  it("nao mente quando nao ha carimbo", () => {
    expect(descreverIdade(null, AGORA)).toBe("origem desconhecida");
  });
});
