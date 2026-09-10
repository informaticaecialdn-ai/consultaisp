import { describe, expect, it } from "vitest";
import {
  AUTH_MODES_DO_CLIENTE, AUTH_MODE_PADRAO, ORIGENS_DA_CONFISSAO, STATUS_DE_CONFISSAO, STATUS_VIVOS_DE_CONFISSAO,
  TRANSICOES_DE_CONFISSAO, confissaoAssinadaViva, confissaoViva, custoDaEmissao, transicaoDeConfissaoPermitida,
} from "./confissao";
import { ROTULO_TIPO_DE_EVENTO, TIPOS_DE_EVENTO } from "./estados";

describe("vocabulário da confissão", () => {
  it("as listas são as da spec §5.2 (pinadas)", () => {
    expect([...STATUS_DE_CONFISSAO]).toEqual(["rascunho", "enviada", "assinada", "cancelada", "expirada", "quitada", "substituida"]);
    expect([...STATUS_VIVOS_DE_CONFISSAO]).toEqual(["rascunho", "enviada"]);
    expect([...ORIGENS_DA_CONFISSAO]).toEqual(["acordo", "saldo_integral"]);
    expect(AUTH_MODE_PADRAO).toBe("assinaturaTela-tokenWhatsapp");
  });
  it("assinaturaTela puro não é auth_mode aceito: assina sem prova de quem assinou", () => {
    expect(AUTH_MODES_DO_CLIENTE).not.toContain("assinaturaTela");
    expect(AUTH_MODES_DO_CLIENTE).toContain("assinaturaTela-tokenWhatsapp");
  });
  it("a máquina de estados: rascunho→enviada→assinada; assinada só quita ou é substituída; encerradas não saem", () => {
    expect(transicaoDeConfissaoPermitida("rascunho", "enviada")).toBe(true);
    expect(transicaoDeConfissaoPermitida("rascunho", "assinada")).toBe(false);
    expect(transicaoDeConfissaoPermitida("enviada", "assinada")).toBe(true);
    expect(transicaoDeConfissaoPermitida("enviada", "expirada")).toBe(true);
    expect(transicaoDeConfissaoPermitida("assinada", "cancelada")).toBe(false);
    expect(transicaoDeConfissaoPermitida("assinada", "quitada")).toBe(true);
    expect(transicaoDeConfissaoPermitida("assinada", "substituida")).toBe(true);
    for (const s of ["cancelada", "expirada", "quitada", "substituida"] as const) expect(TRANSICOES_DE_CONFISSAO[s]).toEqual([]);
  });
  it("viva = rascunho ou enviada; assinada viva = assinada", () => {
    expect(confissaoViva({ status: "enviada" })).toBe(true);
    expect(confissaoViva({ status: "assinada" })).toBe(false);
    expect(confissaoAssinadaViva({ status: "assinada" })).toBe(true);
    expect(confissaoAssinadaViva({ status: "quitada" })).toBe(false);
  });
  it("custo: WhatsApp 5 créditos; envio automático R$ 0,50 só em produção; sandbox não custa", () => {
    const prod = custoDaEmissao({ authMode: "assinaturaTela-tokenWhatsapp", ambiente: "producao", enviarWhatsapp: true, exigirSelfie: false });
    expect(prod).toMatchObject({ creditos: 5, reais: 0.5 });
    expect(prod.texto).toContain("5 créditos");
    expect(prod.texto).toContain("R$ 0,50");
    const email = custoDaEmissao({ authMode: "assinaturaTela-tokenEmail", ambiente: "producao", enviarWhatsapp: false, exigirSelfie: false });
    expect(email).toMatchObject({ creditos: 0, reais: 0 });
    expect(custoDaEmissao({ authMode: "tokenSms", ambiente: "producao", enviarWhatsapp: false, exigirSelfie: false }).reais).toBe(0.1);
    expect(custoDaEmissao({ authMode: "tokenEmail", ambiente: "producao", enviarWhatsapp: false, exigirSelfie: true }).creditos).toBe(15);
    const sandbox = custoDaEmissao({ authMode: "assinaturaTela-tokenWhatsapp", ambiente: "sandbox", enviarWhatsapp: true, exigirSelfie: false });
    expect(sandbox.reais).toBe(0);
    expect(sandbox.texto).toContain("ambiente de testes");
  });
  it("o evento `confissao` existe e tem rótulo", () => {
    expect(TIPOS_DE_EVENTO).toContain("confissao");
    expect(ROTULO_TIPO_DE_EVENTO.confissao).toBe("Confissão de dívida");
  });
});
