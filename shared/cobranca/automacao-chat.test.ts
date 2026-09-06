import { describe, expect, it } from "vitest";
import { janelaDoChat, lerAutomacaoChat, feriadosDoChat } from "./automacao-chat";

describe("primeiros contatos automáticos", () => {
  it("vem desligado e recusa teto desproporcional", () => {
    expect(lerAutomacaoChat(null).ligada).toBe(false);
    expect(lerAutomacaoChat({ ligada: true, limiteDiario: 5000 }).ligada).toBe(false);
  });
  it("usa São Paulo: 10h UTC ainda é cedo, 11h UTC abre janela", () => {
    expect(janelaDoChat(new Date("2026-09-08T10:59:00Z"), null).permitida).toBe(false);
    expect(janelaDoChat(new Date("2026-09-08T11:00:00Z"), null).permitida).toBe(true);
  });
  it("não envia domingo, depois do limite de sábado, nem em dia pausado", () => {
    expect(janelaDoChat(new Date("2026-09-06T15:00:00Z"), null).permitida).toBe(false);
    expect(janelaDoChat(new Date("2026-09-05T17:00:00Z"), null).permitida).toBe(false);
    expect(janelaDoChat(new Date("2026-09-07T15:00:00Z"), null, ["2026-09-07"]).permitida).toBe(false);
  });
  it("pausa nos feriados nacionais e calcula a data móvel", () => {
    expect(feriadosDoChat(2026)).toContain("2026-04-03");
    expect(feriadosDoChat(2027)).toContain("2027-03-26");
    expect(janelaDoChat(new Date("2026-09-07T15:00:00Z"), null).permitida).toBe(false);
  });
});
