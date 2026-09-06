import { describe, expect, it } from "vitest";
import { orientarContato, textoDePrimeiroContato } from "./contato";

describe("régua decide quando, DNA decide tom", () => {
  it("trocar o DNA não muda a etapa nem o agente", () => {
    const a = orientarContato({ diasAtraso: 45, quadrante: "A1", tom: "boas_vindas" });
    const b = orientarContato({ diasAtraso: 45, quadrante: "C3", tom: "negociar_reter" });
    expect(a.etapa).toEqual(b.etapa);
    expect(a.agente).toBe(b.agente);
    expect(a.diretiva).not.toBe(b.diretiva);
  });
  it("vulnerabilidade prevalece sobre quadrante e propensão", () => {
    const r = orientarContato({ diasAtraso: 360, quadrante: "C1", tom: "humanizado_vulneravel", propensao: 99 });
    expect(r.agente).toBe("Acolhimento humano");
    expect(r.automatizavel).toBe(false);
  });
  it("ex-cliente não recebe etapa de suspensão", () => {
    expect(orientarContato({ diasAtraso: 20, carteira: "ex_cliente" }).etapa?.id).not.toBe("aviso_suspensao");
  });
  it("ausência de modelo não vira propensão inventada", () => {
    expect(orientarContato({ diasAtraso: 10 }).propensao).toBeNull();
    expect(orientarContato({ diasAtraso: 10, propensao: NaN }).propensao).toBeNull();
  });
  it("não libera novo contato automático para caso pago ou dívida fora da régua", () => {
    expect(orientarContato({ diasAtraso: 20, status: "pago" }).automatizavel).toBe(false);
    expect(orientarContato({ diasAtraso: 2000 }).automatizavel).toBe(false);
    expect(orientarContato({ diasAtraso: 2000, propensao: 10 }).automatizavel).toBe(false);
  });
  it("primeiro contato identifica o assistente e pede confirmação antes dos valores", () => {
    const texto = textoDePrimeiroContato({ nome: "Maria Exemplo", provedor: "ISP Exemplo", origem: "cobranca", tom: "cuidado" });
    expect(texto).toContain("assistente virtual");
    expect(texto).toContain("Confirma");
    expect(texto).not.toContain("R$");
  });
});
