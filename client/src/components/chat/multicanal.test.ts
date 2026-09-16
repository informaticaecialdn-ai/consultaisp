import { describe, expect, it } from "vitest";
import { unirHistorico } from "./multicanal";
import { janelaDaConversa } from "./tipos";

describe("histórico unificado de canais", () => {
  const whatsapp = [{ id: "1", direcao: "INBOUND", texto: "Olá", tipo: "TEXT", status: "RECEIVED", quem: null, em: "2026-09-10T10:00:00Z" }];
  it("ordena por instante real e mantém canal, direção, assunto e ids sem colisão", () => {
    const resultado = unirHistorico(whatsapp, [
      { id: "1", canal: "email", direcao: "saida", texto: "Proposta", assunto: "Acordo", status: "queued", criadoEm: "2026-09-10T08:30:00-03:00" },
      { id: "1", canal: "sms", direcao: "entrada", texto: "Recebi", status: "received", criadoEm: "2026-09-10T11:00:00Z" },
    ]);
    expect(resultado.map((m) => m.canal)).toEqual(["whatsapp", "sms", "email"]);
    expect(new Set(resultado.map((m) => m.id)).size).toBe(3);
    expect(resultado[1].direcao).toBe("INBOUND");
    expect(resultado[2]).toMatchObject({ assunto: "Acordo", direcao: "OUTBOUND", status: "queued" });
    expect(whatsapp).toHaveLength(1);
  });
  it("uma resposta nova em outro canal não reabre a janela de WhatsApp", () => {
    unirHistorico(whatsapp, [{ id: 2, canal: "email", direcao: "entrada", texto: "Resposta", status: "received", criadoEm: "2026-09-13T10:00:00Z" }]);
    expect(janelaDaConversa(whatsapp, new Date("2026-09-13T11:00:00Z"))?.aberta).toBe(false);
  });
});
