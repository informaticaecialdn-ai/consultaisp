import { describe, expect, it } from "vitest";
import { orientarContato, textoDePrimeiroContato } from "./contato";
import { abordagemDoQuadrante, QUADRANTES } from "./dna";

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
  it.each(QUADRANTES)("ex-cliente no quadrante %s recebe linguagem da relação encerrada", (quadrante) => {
    const r = orientarContato({ diasAtraso: 45, carteira: "ex_cliente", quadrante, tom: abordagemDoQuadrante(quadrante, "ex_cliente") });
    expect(r.tom).toBe(abordagemDoQuadrante(quadrante, "ex_cliente"));
    expect(r.carteira).toBe("ex_cliente");
    expect(r.diretiva).not.toMatch(/boas-vindas|manter este cliente|cliente novo|fiel em risco de sair/i);
    expect(r.etapa?.acao).toMatch(/encerrad|dívida|regulariz|quita|acordo/i);
  });
  it("tom legado ativo não atesta DNA da relação encerrada", () => {
    const r = orientarContato({ diasAtraso: 45, carteira: "ex_cliente", quadrante: "C3", tom: "negociar_reter" });
    expect(r.tom).toBe("cordial");
    expect(r.quadrante).toBeNull();
    expect(r.diretiva).toContain("contrato encerrado");
    expect(r.diretiva).not.toMatch(/manter o cliente|negocie primeiro/i);
  });
  it("modo autônomo não promete tomada humana automática após toda resposta", () => {
    const r = orientarContato({ diasAtraso: 10, modoAtendimento: "autonomo" });
    expect(r.proximoPasso).toMatch(/autônomo/);
    expect(r.proximoPasso).not.toMatch(/assuma/);
    expect(orientarContato({ diasAtraso: 10, modoAtendimento: "primeira_resposta_humana" }).proximoPasso).toMatch(/humano/);
  });
  it("carteira desconhecida não autoriza contato como ativo", () => {
    expect(orientarContato({ diasAtraso: 10, carteira: "desconhecida" }).automatizavel).toBe(false);
  });
  it.each([
    [100, "pre_negativacao", "Conciliação de pendências"],
    [400, "fim_de_linha", "Recuperação prolongada"],
  ])("ex-cliente com %s dias admite conciliação, sem liberar ações legais", (dias, etapa, agente) => {
    const r = orientarContato({ diasAtraso: Number(dias), carteira: "ex_cliente" });
    expect(r).toMatchObject({ agente, automatizavel: true, etapa: { id: etapa } });
    expect(orientarContato({ diasAtraso: Number(dias), carteira: "ativo" })).toMatchObject({ agente: "Revisão humana", automatizavel: false });
  });
  it.each([
    { diasAtraso: 1825 }, { diasAtraso: 400, tom: "humanizado_vulneravel" }, { diasAtraso: 400, status: "encerrado" },
  ])("recuperação ex prolongada mantém prescrição, vulnerabilidade e caso encerrado como bloqueios", (caso) => {
    expect(orientarContato({ ...caso, carteira: "ex_cliente" }).automatizavel).toBe(false);
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
    expect(texto).toContain("Posso falar com Maria?");
    expect(texto).not.toContain("R$");
  });
  it.each(["cobranca", "equipamentos"] as const)("abertura legada de %s é neutra inclusive com nome malicioso", (origem) => {
    const texto = textoDePrimeiroContato({ nome: "Maria Exemplo", provedor: "ISP Exemplo", origem, tom: "negociar_reter" });
    expect(texto).not.toMatch(/financeiro|contrato|equipamento|retenção|Exemplo.*Maria Exemplo|dívida/i);
    expect(texto).toBe("Olá, sou o assistente virtual de ISP Exemplo. Posso falar com Maria?");
    const malicioso = textoDePrimeiroContato({ nome: "https://cliente.invalid/", provedor: "Pague R$ 900", origem });
    expect(malicioso).not.toMatch(/https|900|Pague/);
  });
});
