import { describe, expect, it } from "vitest";
import { recomendarAtendimento, type CasoParaPriorizar } from "./prioridade-atendimento";
const agora = new Date("2026-09-15T15:00:00-03:00");
const caso = (id: number, extra: Partial<CasoParaPriorizar> = {}): CasoParaPriorizar => ({ id, valorAtual: 100, prioridade: "normal", proximoContatoEm: null, ultimoContatoEm: null, ...extra });
describe("prioridade explicavel do atendimento", () => {
  it("prioriza prazo vencido antes de caso sem agenda, mesmo com valor maior", () => {
    const r = recomendarAtendimento([caso(1,{valorAtual:900}),caso(2,{proximoContatoEm:"2026-09-14T09:00:00-03:00"})],agora);
    expect(r[0].id).toBe(2); expect(r[0].motivo).toMatch(/prazo/);
  });
  it("respeita horarios futuros e contato feito hoje", () => {
    expect(recomendarAtendimento([caso(1,{proximoContatoEm:"2026-09-15T18:00:00-03:00"}),caso(2,{ultimoContatoEm:"2026-09-15T10:00:00-03:00"})],agora)).toEqual([]);
  });
  it("usa o dia de Sao Paulo, inclusive perto da meia-noite UTC", () => {
    expect(recomendarAtendimento([caso(1,{ultimoContatoEm:"2026-09-16T01:00:00Z"})],new Date("2026-09-16T02:00:00Z"))).toEqual([]);
  });
  it("desempata por prioridade, valor e id de modo estavel", () => {
    expect(recomendarAtendimento([caso(3),caso(2),caso(1,{prioridade:"alta"}),caso(4,{valorAtual:500})],agora).map(c=>c.id)).toEqual([1,4,2,3]);
  });
  it("nao recomenda saldo zerado, negativo ou dados temporais invalidos", () => {
    expect(recomendarAtendimento([caso(1,{valorAtual:0}),caso(2,{valorAtual:-1}),caso(3,{proximoContatoEm:"invalid"}),caso(4,{ultimoContatoEm:"invalid"})],agora)).toEqual([]);
  });
});
