import { describe, expect, it } from "vitest";
import { capacidadeDeEquipamento } from "./capacidade";

const CATALOGO = [
  { name: "ixc", label: "IXC Soft", supportsEquipment: true },
  { name: "sgp", label: "SGP", supportsEquipment: true },
  { name: "mk", label: "MK Solutions", supportsEquipment: false },
  { name: "hubsoft", label: "Hubsoft" },
  { name: "topsapp", label: "TopSApp", supportsEquipment: true, naoImplementado: true },
];

describe("de onde vêm os aparelhos", () => {
  it("sem ERP nenhum: a lista tem só o que for cadastrado aqui", () => {
    const r = capacidadeDeEquipamento([], CATALOGO);
    expect(r.origem).toBe("sem_erp");
    expect(r.aviso).toMatch(/Nenhum ERP integrado/);
  });

  it("ERP que traz comodato: o cadastro manual SOMA, não substitui", () => {
    const r = capacidadeDeEquipamento([{ erpSource: "ixc", isEnabled: true }], CATALOGO);
    expect(r.origem).toBe("erp_traz_equipamento");
    expect(r.comEquipamento).toEqual(["IXC Soft"]);
    expect(r.aviso).toMatch(/IXC Soft traz os aparelhos/);
    expect(r.aviso).toMatch(/soma/);
  });

  it("ERP sem comodato: explica a lista vazia em vez de deixar o operador achar que quebrou", () => {
    const r = capacidadeDeEquipamento([{ erpSource: "mk", isEnabled: true }], CATALOGO);
    expect(r.origem).toBe("erp_sem_equipamento");
    expect(r.aviso).toMatch(/MK Solutions não informa comodato/);
    expect(r.aviso).toMatch(/só o que for cadastrado aqui/);
  });

  it("conector sem a marca é tratado como sem comodato — ausência não é promessa", () => {
    const r = capacidadeDeEquipamento([{ erpSource: "hubsoft", isEnabled: true }], CATALOGO);
    expect(r.origem).toBe("erp_sem_equipamento");
    expect(r.semEquipamento).toEqual(["Hubsoft"]);
  });

  it("integração DESLIGADA não promete sincronização que não vai acontecer", () => {
    const r = capacidadeDeEquipamento([{ erpSource: "ixc", isEnabled: false }], CATALOGO);
    expect(r.origem).toBe("sem_erp");
  });

  it("integração sem credencial também não conta", () => {
    const r = capacidadeDeEquipamento([{ erpSource: "ixc", isEnabled: true, configurado: false }], CATALOGO);
    expect(r.origem).toBe("sem_erp");
  });

  it("`configurado` ausente conta como configurado — payload antigo não pode apagar o aviso", () => {
    const r = capacidadeDeEquipamento([{ erpSource: "ixc", isEnabled: true }], CATALOGO);
    expect(r.origem).toBe("erp_traz_equipamento");
  });

  it("conector casca (naoImplementado) não entra em nenhuma das listas", () => {
    // Ele se declara `supportsEquipment`, mas todo metodo devolve "ainda nao
    // implementado": prometer aparelho por causa dele seria mentir duas vezes.
    const r = capacidadeDeEquipamento([{ erpSource: "topsapp", isEnabled: true }], CATALOGO);
    expect(r.origem).toBe("sem_erp");
    expect(r.comEquipamento).toEqual([]);
    expect(r.semEquipamento).toEqual([]);
  });

  it("um ERP que traz e outro que não: quem traz manda na frase", () => {
    const r = capacidadeDeEquipamento(
      [{ erpSource: "mk", isEnabled: true }, { erpSource: "sgp", isEnabled: true }], CATALOGO);
    expect(r.origem).toBe("erp_traz_equipamento");
    expect(r.comEquipamento).toEqual(["SGP"]);
    expect(r.semEquipamento).toEqual(["MK Solutions"]);
  });

  it("dois ERPs com comodato concordam o verbo no plural", () => {
    const r = capacidadeDeEquipamento(
      [{ erpSource: "ixc", isEnabled: true }, { erpSource: "sgp", isEnabled: true }], CATALOGO);
    expect(r.aviso).toMatch(/IXC Soft e SGP trazem os aparelhos/);
  });

  it("ERP fora do catálogo aparece pelo próprio nome, não some do aviso", () => {
    const r = capacidadeDeEquipamento([{ erpSource: "caseiro", isEnabled: true }], CATALOGO);
    expect(r.origem).toBe("erp_sem_equipamento");
    expect(r.aviso).toMatch(/CASEIRO/);
  });
});
