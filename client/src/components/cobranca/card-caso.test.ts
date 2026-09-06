/**
 * O card de cobrança conta a história do caso (pedido do dono, 05/09/2026):
 * quem, quanto e desde quando, o acordo e as parcelas, o que fazer agora e
 * com quem falar. As funções puras rodam de verdade; o JSX é travado pelo
 * fonte.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resumoDoAcordo, vencimentoMaisAntigo } from "./CardCaso";

const fonte = readFileSync(new URL("./CardCaso.tsx", import.meta.url), "utf8");
const semNbsp = (s: string) => s.replace(/ /g, " ");

describe("vencimentoMaisAntigo", () => {
  it("é hoje menos os dias de atraso; sem atraso não há vencimento", () => {
    const hoje = new Date(2026, 8, 5);
    expect(vencimentoMaisAntigo(46, hoje)?.toISOString().slice(0, 10)).toBe("2026-07-21");
    expect(vencimentoMaisAntigo(0, hoje)).toBeNull();
  });
});

describe("resumoDoAcordo", () => {
  it("parcelamento: parcelas × valor, entrada, pagas/total e a próxima (com aviso de atraso)", () => {
    expect(semNbsp(resumoDoAcordo({ id: 1, tipo: "parcelamento", status: "ativa", valorNegociado: 300, entrada: 50, parcelas: 3, valorParcela: 100, parcelasPagas: 1, proximaParcela: { numero: 2, vencimento: "2026-09-10", valor: 100, atrasada: false }, aceitaEm: null })))
      .toBe("3x de R$ 100,00 · entrada R$ 50,00 · 1/3 pagas · próxima 10/09/2026");
    expect(semNbsp(resumoDoAcordo({ id: 1, tipo: "parcelamento", status: "ativa", valorNegociado: 300, entrada: 0, parcelas: 3, valorParcela: 100, parcelasPagas: 2, proximaParcela: { numero: 3, vencimento: "2026-08-10", valor: 100, atrasada: true }, aceitaEm: null })))
      .toBe("3x de R$ 100,00 · 2/3 pagas · próxima 10/08/2026 (atrasada)");
  });
  it("à vista: o valor negociado", () => {
    expect(semNbsp(resumoDoAcordo({ id: 2, tipo: "a_vista", status: "proposta", valorNegociado: 250, entrada: 0, parcelas: 1, valorParcela: null, parcelasPagas: 0, proximaParcela: null, aceitaEm: null }))).toBe("à vista R$ 250,00");
  });
});

describe("o card, pelo fonte", () => {
  it("QUEM: nome inteiro (duas linhas, sem cortar), cidade e bairro, documento, situação do contrato", () => {
    expect(fonte).toContain("[-webkit-line-clamp:2]");
    expect(fonte).toContain("card-nome-${item.id}");
    expect(fonte).toContain("[cliente.bairro, cliente.cidade].filter(Boolean)");
    expect(fonte).toContain("situacaoDoErp(cliente.statusErp)");
  });
  it("QUANTO E DESDE QUANDO: a dívida em destaque, faturas vencidas, a mais antiga, o valor na abertura", () => {
    expect(fonte).toContain("card-divida-${item.id}");
    expect(fonte).toContain("fatura${faturas === 1 ? \"\" : \"s\"} vencida");
    expect(fonte).toContain("a mais antiga venceu ${dataBr(maisAntiga.toISOString())}");
    expect(fonte).toContain("na abertura do caso: {brl(item.valorAbertura)}");
  });
  it("O ACORDO: tipo, status e o andamento das parcelas quando há negociação viva", () => {
    expect(fonte).toContain("card-acordo-${item.id}");
    expect(fonte).toContain("resumoDoAcordo(acordo)");
  });
  it("O QUE FAZER AGORA: a etapa da régua com a AÇÃO escrita, e o tom do DNA", () => {
    expect(fonte).toContain("card-etapa-${item.id}");
    expect(fonte).toContain("card-acao-${item.id}");
    expect(fonte).toContain("{etapa.acao}");
    expect(fonte).toContain("<SeloTom tom={tom} />");
  });
  it("FOLLOW-UP: as quatro coisas claras (próxima ação, dono, quando, status) e o caso PARADO em vermelho", () => {
    expect(fonte).toContain("card-followup-${item.id}");
    expect(fonte).toContain("card-proxima-acao-${item.id}");
    expect(fonte).toContain("sem próxima ação — defina no próximo contato");
    expect(fonte).toContain("item.proximoContatoEm === null && !fechado");
    expect(fonte).toContain("ROTULO_STATUS_DE_CASO[item.status as StatusDeCaso]");
    // a régua só SUGERE (≈); a próxima ação escrita pelo operador vence
    expect(fonte).toContain("item.proximaAcao ? (");
    expect(fonte).toContain("≈ ${etapa.acao}");
  });
  it("COM QUEM: responsável, próximo e último contato, telefone com WhatsApp, chat", () => {
    expect(fonte).toContain("próximo contato ${contato.texto}");
    expect(fonte).toContain("último {dataBr(item.ultimoContatoEm)}");
    expect(fonte).toContain("nenhum contato ainda");
    expect(fonte).toContain("<LinkWhatsapp");
    expect(fonte).toContain("card-chat-${item.id}");
  });
  it("as ações e os testids que o quadro e a fila esperam continuam", () => {
    for (const id of ["card-caso-", "card-contato-", "card-pegar-", "card-enviar-chat-", "card-360-"]) expect(fonte).toContain(`${id}\${item.id}`);
    expect(fonte).toContain("item.responsavelUserId === null && acoes.onPegar !== undefined");
    expect(fonte).toContain("acoes.onEnviarParaChat && !item.chat");
  });
});
