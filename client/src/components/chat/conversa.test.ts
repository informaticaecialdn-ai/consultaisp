/**
 * A lógica da conversa no porte do Provedor.ai, provada direto (sem DOM):
 * quem escreveu, corridas, transferência derivada, hora e dia, o markdown leve
 * do WhatsApp, o recibo, o atraso da fatura, o tempo de casa e o Enter.
 *
 * As datas são montadas por componente LOCAL (`new Date(2026, 8, 17, ...)`):
 * a hora e o dia do chat são os do navegador, e o teste não pode depender do
 * fuso da máquina que o roda.
 */
import { describe, expect, it } from "vitest";
import {
  EMOJIS_DO_COMPOSITOR,
  TEXTO_DA_ESPERA,
  GRUPO_JANELA_MS,
  ROTULO_DO_STATUS,
  autorDaMensagem,
  chipDoDia,
  dentroDaJanelaDeGrupo,
  esperaDoEnvio,
  filaDoEnvioSegue,
  horaDaMensagem,
  iniciaisDoLadrilho,
  mensagensRapidas,
  mesmaCorrida,
  reciboDoStatus,
  rotuloDoDia,
  rotuloDoStatus,
  situacaoDaFatura,
  teclaEnviaMensagem,
  tempoDeCliente,
  transferenciaAntesDe,
  trechosDoTexto,
  type MensagemDaCorrida,
} from "./conversa";

const local = (dia: number, hora: number, minuto = 0) => new Date(2026, 8, dia, hora, minuto);
const AGORA = local(17, 15, 0);
const iso = (d: Date) => d.toISOString();

const msg = (extra: Partial<MensagemDaCorrida>): MensagemDaCorrida => ({
  direcao: "OUTBOUND",
  canal: "whatsapp",
  quem: "Clara",
  ia: true,
  em: iso(local(17, 14, 0)),
  ...extra,
});

describe("quem escreveu", () => {
  it("entrada é o cliente; saída com o agente gravado é a funcionária; o resto é a equipe", () => {
    expect(autorDaMensagem({ direcao: "INBOUND" })).toBe("cliente");
    // O fixture antigo do SSR manda "in": qualquer coisa que não seja saída é o cliente.
    expect(autorDaMensagem({ direcao: "in" })).toBe("cliente");
    expect(autorDaMensagem({ direcao: "INBOUND", ia: true })).toBe("cliente");
    expect(autorDaMensagem({ direcao: "OUTBOUND", ia: true })).toBe("funcionaria");
    expect(autorDaMensagem({ direcao: "OUTBOUND", ia: false })).toBe("equipe");
    // Sem o campo (servidor antigo, SMS, e-mail): equipe — nunca IA por palpite.
    expect(autorDaMensagem({ direcao: "OUTBOUND" })).toBe("equipe");
  });
});

describe("corridas", () => {
  it("mesma voz, mesma direção, mesmo canal e menos de cinco minutos", () => {
    const a = msg({});
    expect(mesmaCorrida(a, msg({ em: iso(local(17, 14, 4)) }))).toBe(true);
    expect(GRUPO_JANELA_MS).toBe(5 * 60_000);
    expect(mesmaCorrida(a, msg({ em: iso(local(17, 14, 5)) }))).toBe(false);
    expect(mesmaCorrida(a, msg({ direcao: "INBOUND", quem: null, ia: false }))).toBe(false);
    expect(mesmaCorrida(a, msg({ canal: "sms" }))).toBe(false);
    // Mesmo nome, vozes diferentes: a Clara da equipe não é a Clara funcionária.
    expect(mesmaCorrida(a, msg({ ia: false }))).toBe(false);
    expect(mesmaCorrida(a, msg({ quem: "Leonora" }))).toBe(false);
  });

  it("data ilegível não quebra a corrida", () => {
    expect(dentroDaJanelaDeGrupo("sem data", iso(AGORA))).toBe(true);
    expect(mesmaCorrida(msg({ em: "x" }), msg({}))).toBe(true);
  });
});

describe("transferência derivada", () => {
  it("a troca de quem fala entre corridas de WhatsApp vira a pílula, pulando o cliente no meio", () => {
    const conversa = [
      msg({ quem: "Clara", ia: true, em: iso(local(17, 10)) }),
      msg({ direcao: "INBOUND", quem: null, ia: false, em: iso(local(17, 10, 30)) }),
      msg({ quem: "Equipe NsLink", ia: false, em: iso(local(17, 11)) }),
    ];
    expect(transferenciaAntesDe(conversa, 2)).toEqual({ de: "Clara", para: "Equipe NsLink" });
    expect(transferenciaAntesDe(conversa, 0)).toBeNull();
    expect(transferenciaAntesDe(conversa, 1)).toBeNull();
  });

  it("sem nome não afirma nada; mesma voz não é transferência; SMS e e-mail não contam", () => {
    const semNome = [msg({ quem: null, ia: false, em: iso(local(17, 10)) }), msg({ quem: "Clara", em: iso(local(17, 11)) })];
    expect(transferenciaAntesDe(semNome, 1)).toBeNull();
    const mesma = [msg({ em: iso(local(17, 10)) }), msg({ direcao: "INBOUND", quem: null, em: iso(local(17, 10, 1)) }), msg({ em: iso(local(17, 11)) })];
    expect(transferenciaAntesDe(mesma, 2)).toBeNull();
    const sms = [msg({ em: iso(local(17, 10)) }), msg({ canal: "sms", quem: "Equipe", ia: false, em: iso(local(17, 11)) })];
    expect(transferenciaAntesDe(sms, 1)).toBeNull();
    // Dentro da mesma corrida nunca há pílula.
    const corrida = [msg({ em: iso(local(17, 10)) }), msg({ em: iso(local(17, 10, 1)) })];
    expect(transferenciaAntesDe(corrida, 1)).toBeNull();
  });
});

describe("hora e dia", () => {
  it("hoje só a hora; outro dia, dd/mm e a hora; ilegível, null", () => {
    expect(horaDaMensagem(iso(local(17, 14, 2)), AGORA)).toBe("14:02");
    expect(horaDaMensagem(iso(local(12, 9, 5)), AGORA)).toBe("12/09 09:05");
    expect(horaDaMensagem("não é data", AGORA)).toBeNull();
  });

  it("o chip único do topo diz o dia e o canal da primeira mensagem", () => {
    expect(rotuloDoDia(iso(local(17, 8)), AGORA)).toBe("Hoje");
    expect(rotuloDoDia(iso(local(16, 23)), AGORA)).toBe("Ontem");
    expect(rotuloDoDia(iso(local(12, 8)), AGORA)).toBe("12/09/2026");
    expect(chipDoDia({ em: iso(local(17, 8)), canal: "whatsapp" }, AGORA)).toBe("Hoje · WhatsApp");
    expect(chipDoDia({ em: iso(local(16, 8)), canal: "sms" }, AGORA)).toBe("Ontem · SMS");
    expect(chipDoDia({ em: "x", canal: "email" }, AGORA)).toBeNull();
    expect(chipDoDia(undefined, AGORA)).toBeNull();
  });
});

describe("o texto do balão", () => {
  it("*negrito* e ```bloco``` viram trechos; o resto passa intacto", () => {
    expect(trechosDoTexto("Olá, *Maria*! Segue:\n```00020126```\nObrigada")).toEqual([
      { tipo: "texto", valor: "Olá, " },
      { tipo: "negrito", valor: "Maria" },
      { tipo: "texto", valor: "! Segue:\n" },
      { tipo: "bloco", valor: "00020126" },
      { tipo: "texto", valor: "\nObrigada" },
    ]);
    expect(trechosDoTexto("sem marcação")).toEqual([{ tipo: "texto", valor: "sem marcação" }]);
    // Asterisco solto ou atravessando linha não vira negrito.
    expect(trechosDoTexto("2 * 3\n* item")).toEqual([{ tipo: "texto", valor: "2 * 3\n* item" }]);
    expect(trechosDoTexto("")).toEqual([]);
  });

  it("nenhum trecho carrega HTML: o texto do cliente nunca vira marcação", () => {
    const trechos = trechosDoTexto("<img src=x onerror=alert(1)> *<b>oi</b>*");
    expect(trechos.every((t) => typeof t.valor === "string")).toBe(true);
    expect(trechos[1]).toEqual({ tipo: "negrito", valor: "<b>oi</b>" });
  });
});

describe("recibo de entrega", () => {
  it("o ícone sai do status real; status desconhecido não vira tique", () => {
    expect(reciboDoStatus("QUEUED")).toBe("enviando");
    expect(reciboDoStatus("PENDING")).toBe("enviando");
    expect(reciboDoStatus("SENT")).toBe("enviada");
    expect(reciboDoStatus("DELIVERED")).toBe("entregue");
    expect(reciboDoStatus("READ")).toBe("lida");
    expect(reciboDoStatus("FAILED")).toBe("falhou");
    expect(reciboDoStatus("RECEIVED")).toBeNull();
    expect(reciboDoStatus("QUALQUER")).toBeNull();
  });

  it("o rótulo por extenso é o que o servidor mandou, e o desconhecido sai cru", () => {
    for (const s of ["SENT", "DELIVERED", "READ", "QUEUED", "FAILED", "RECEIVED", "PENDING"])
      expect(ROTULO_DO_STATUS[s]).toBeTruthy();
    expect(rotuloDoStatus("READ")).toBe("lida");
    expect(rotuloDoStatus("DESCONHECIDO")).toBe("DESCONHECIDO");
  });
});

describe("a ficha do cliente", () => {
  it("atraso da fatura em dias de calendário; vence hoje ainda não é atraso; data ruim é null", () => {
    expect(situacaoDaFatura("2026-08-10", AGORA)).toEqual({ tipo: "atraso", dias: 38 });
    expect(situacaoDaFatura("2026-09-16", AGORA)).toEqual({ tipo: "atraso", dias: 1 });
    expect(situacaoDaFatura("2026-09-17", AGORA)).toEqual({ tipo: "a_vencer" });
    expect(situacaoDaFatura("2026-10-10", AGORA)).toEqual({ tipo: "a_vencer" });
    expect(situacaoDaFatura("10/08/2026", AGORA)).toBeNull();
    expect(situacaoDaFatura("", AGORA)).toBeNull();
  });

  it("tempo de casa em anos ou meses; sem data ou com menos de um mês, null", () => {
    expect(tempoDeCliente("2022-03-10", AGORA)).toBe("4 anos");
    expect(tempoDeCliente("2025-09-17", AGORA)).toBe("1 ano");
    expect(tempoDeCliente("2026-01-17", AGORA)).toBe("8 meses");
    expect(tempoDeCliente("2026-08-17", AGORA)).toBe("1 mês");
    expect(tempoDeCliente("2026-09-01", AGORA)).toBeNull();
    expect(tempoDeCliente(null, AGORA)).toBeNull();
    expect(tempoDeCliente("não é data", AGORA)).toBeNull();
  });

  it("o ladrilho ignora as partículas de até duas letras", () => {
    expect(iniciaisDoLadrilho("Maria da Silva")).toBe("MS");
    expect(iniciaisDoLadrilho("  ana de souza  ")).toBe("AS");
    expect(iniciaisDoLadrilho("Jo")).toBe("J");
    expect(iniciaisDoLadrilho("Cliente")).toBe("C");
  });
});

describe("o compositor", () => {
  it("Enter envia; Shift+Enter e a composição do IME, não", () => {
    expect(teclaEnviaMensagem({ key: "Enter", shiftKey: false })).toBe(true);
    expect(teclaEnviaMensagem({ key: "Enter", shiftKey: true })).toBe(false);
    expect(teclaEnviaMensagem({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(teclaEnviaMensagem({ key: "a", shiftKey: false })).toBe(false);
    // No toque não há Shift: o Enter quebra a linha e quem envia é o botão.
    expect(teclaEnviaMensagem({ key: "Enter", shiftKey: false, ponteiroFino: false })).toBe(false);
    expect(teclaEnviaMensagem({ key: "Enter", shiftKey: false, ponteiroFino: true })).toBe(true);
  });

  it("Enter durante um envio pendente vai à fila; durante assumir/encerrar, só o aviso — nunca em silêncio", () => {
    expect(esperaDoEnvio(null)).toBeNull();
    expect(esperaDoEnvio(undefined)).toBeNull();
    expect(esperaDoEnvio({ acao: "enviar" })).toBe("fila");
    expect(esperaDoEnvio({ acao: "assumir" })).toBe("aguarde");
    expect(esperaDoEnvio({ acao: "encerrar" })).toBe("aguarde");
    // Cada espera tem a frase que o rodapé anuncia.
    expect(TEXTO_DA_ESPERA.fila).toContain("envio anterior for confirmado");
    expect(TEXTO_DA_ESPERA.aguarde).toContain("Aguarde");
  });

  it("a fila só anda com o envio anterior ACEITO: na falha, o texto volta ao campo e o atendente decide", () => {
    expect(filaDoEnvioSegue("fila", "ok")).toBe(true);
    expect(filaDoEnvioSegue("fila", "falhou")).toBe(false);
    expect(filaDoEnvioSegue("fila", null)).toBe(false);
    expect(filaDoEnvioSegue("aguarde", "ok")).toBe(false);
    expect(filaDoEnvioSegue(null, "ok")).toBe(false);
  });

  it("a mensagem rápida é a continuidade que já existia, por tela", () => {
    expect(mensagensRapidas("cobranca")[0].texto).toContain("Vou conferir seu contrato");
    expect(mensagensRapidas("equipamentos")[0].texto).toContain("combinar a retirada");
  });

  it("a grade de emojis é a fixa da referência: 24, sem repetição", () => {
    expect(EMOJIS_DO_COMPOSITOR).toHaveLength(24);
    expect(new Set(EMOJIS_DO_COMPOSITOR).size).toBe(24);
  });
});
