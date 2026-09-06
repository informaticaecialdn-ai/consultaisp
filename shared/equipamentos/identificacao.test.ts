import { describe, expect, it } from "vitest";
import { cruzarIdentificadores, normalizarMac, autenticacoesDoSgp } from "./identificacao";

describe("identificação de equipamento por evidência", () => {
  it("normaliza grafias do mesmo MAC, rejeita lixo e endereço vazio", () => {
    expect(normalizarMac("aa:bb:cc:dd:ee:01")).toBe("AABBCCDDEE01");
    expect(normalizarMac("aabb.ccdd.ee01")).toBe("AABBCCDDEE01");
    expect(normalizarMac("zz:aa:bb:cc:dd:ee:01")).toBeNull();
    expect(normalizarMac("00:00:00:00:00:00")).toBeNull();
  });
  it("MAC único encontra candidato, não confirma posse ou retirada", () => {
    expect(cruzarIdentificadores({ mac: "aa:bb:cc:dd:ee:01" }, [{ id: 1, mac: "AABBCCDDEE01" }])).toMatchObject({ status: "coincidencia", ids: [1], por: "mac" });
  });
  it("MAC duplicado nunca escolhe arbitrariamente um aparelho", () => {
    expect(cruzarIdentificadores({ mac: "aabbccddee01" }, [{ id: 1, mac: "aabbccddee01" }, { id: 2, mac: "aabbccddee01" }]).status).toBe("ambiguo");
  });
  it("serial e MAC apontando para aparelhos diferentes é conflito", () => {
    expect(cruzarIdentificadores({ serial: "ZTE001", mac: "aabbccddee01" }, [{ id: 1, serial: "ZTE001" }, { id: 2, mac: "aabbccddee01" }]).status).toBe("conflito");
  });
  it("não inventa equipamento quando o ERP apagou o MAC", () => {
    expect(cruzarIdentificadores({}, [{ id: 1, mac: "aabbccddee01" }]).status).toBe("sem_identificador");
  });
  it("extrai autenticação sem trazer senha e preserva múltiplos contratos", () => {
    const a = autenticacoesDoSgp([{ contrato: 1, servicos: [{ login: "cliente.pppoe", senha: "segredo", mac: "aa:bb:cc:dd:ee:01", ip: "10.0.0.2" }] }, { contrato: 2, servicos: [{ login: "segundo" }] }]);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ login: "cliente.pppoe", mac: "AABBCCDDEE01", contrato: "1" });
    expect(JSON.stringify(a)).not.toContain("segredo");
    expect(a[1].mac).toBeNull();
  });
});
