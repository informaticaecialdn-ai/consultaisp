import { describe, it, expect } from "vitest";
import { sanitizarResultadoGravado } from "./historico-consulta";

describe("sanitizarResultadoGravado", () => {
  const antigo = {
    score: 640,
    providerDetails: [
      { providerId: 1, providerName: "NsLink", isSameProvider: true, status: "Em dia" },
      { providerId: 2, providerName: "Provedor Parceiro ISP-#HPZFV", isSameProvider: false, status: "Inadimplente" },
    ],
    addressMatches: [
      { providerId: 2, providerName: "Provedor Parceiro ISP-#HPZFV", isSameProvider: false, address: "Rua X" },
    ],
    addressSearch: {
      cep: "86000000",
      totalCustomersFound: 3,
      addressGroups: [{ customers: [{ providerId: 2, providerName: "Provedor Parceiro ISP-#Q2K9P", isSameProvider: false }] }],
      risk: { score: 40 },
    },
    erpLatencies: [{ provider: "Provedor Parceiro ISP-#HPZFV", erp: "mk", ok: false, error: "URL do ERP invalida para o provedor 2: https://erp.vertical" }],
  };

  it("tira o id cru e o codigo antigo das entradas de parceiro; o proprio provedor fica como esta", () => {
    const r = sanitizarResultadoGravado(antigo);
    expect(r.providerDetails[0]).toEqual(antigo.providerDetails[0]);
    expect(r.providerDetails[1]).toEqual({ providerName: "Provedor parceiro", isSameProvider: false, status: "Inadimplente" });
    expect(r.addressMatches[0]).not.toHaveProperty("providerId");
    expect(r.addressMatches[0].providerName).toBe("Provedor parceiro");
  });

  it("addressGroups e erpLatencies saem inteiros; o resto do addressSearch fica", () => {
    const r = sanitizarResultadoGravado(antigo) as any;
    expect(r.addressSearch).toEqual({ cep: "86000000", totalCustomersFound: 3, risk: { score: 40 } });
    expect(r).not.toHaveProperty("erpLatencies");
    expect(r.score).toBe(640);
  });

  it("reconhece os tres formatos antigos — inclusive o id cru formatado e o hash do nome", () => {
    const r = sanitizarResultadoGravado({
      providerDetails: [
        { providerName: "Provedor Parceiro ISP-0042", isSameProvider: false },
        { providerName: "Provedor Parceiro #A3F9", isSameProvider: false },
        { providerName: "Provedor Parceiro ISP-#HPZFV", isSameProvider: false },
      ],
    });
    expect(r.providerDetails.map((d: any) => d.providerName)).toEqual(["Provedor parceiro", "Provedor parceiro", "Provedor parceiro"]);
  });

  it("o texto do migrador deixa de citar o provedor onde o contrato foi cancelado", () => {
    const r = sanitizarResultadoGravado({
      migratorAlert: { detected: true, message: "MIGRADOR SERIAL: CPF com contrato cancelado em Vertical Fibra, divida ativa de R$ 500 - R$ 1000, e 2 consultas recentes" },
    }) as any;
    expect(r.migratorAlert.message).toBe("MIGRADOR SERIAL: CPF com contrato cancelado em provedor da rede ISP, divida ativa de R$ 500 - R$ 1000, e 2 consultas recentes");
    expect(r.migratorAlert.detected).toBe(true);
    const ja = sanitizarResultadoGravado({ migratorAlert: { message: "CPF com contrato cancelado em provedor da rede ISP, x" } }) as any;
    expect(ja.migratorAlert.message).toBe("CPF com contrato cancelado em provedor da rede ISP, x");
  });

  it("codigo pareado novo passa intacto", () => {
    const novo = { providerDetails: [{ providerName: "Provedor Parceiro ISP-REP-CEV", isSameProvider: false }] };
    expect(sanitizarResultadoGravado(novo).providerDetails[0].providerName).toBe("Provedor Parceiro ISP-REP-CEV");
  });

  it("nao mexe no original nem quebra com formatos inesperados", () => {
    const copia = JSON.parse(JSON.stringify(antigo));
    sanitizarResultadoGravado(antigo);
    expect(antigo).toEqual(copia);
    expect(sanitizarResultadoGravado(null)).toBeNull();
    expect(sanitizarResultadoGravado({ anonimizado: true })).toEqual({ anonimizado: true });
    expect(sanitizarResultadoGravado({ providerDetails: "x", addressSearch: [1] })).toEqual({ providerDetails: "x", addressSearch: [1] });
  });
});
