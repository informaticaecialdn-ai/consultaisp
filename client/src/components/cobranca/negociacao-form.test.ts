import { describe, it, expect } from "vitest";
import { ofertasDaPolitica, POLITICA_PADRAO, PoliticaSchema } from "@shared/cobranca";
import {
  avisoDoRegistro, corpoDaNegociacao, excecaoPrevista, formDaOferta, formInicial, lerDinheiro, pedidoDoForm,
  previaDaNegociacao, registroDaResposta, violacoesDoErro,
} from "./negociacao-form";

describe("lerDinheiro", () => {
  it("aceita o jeito brasileiro e o jeito do teclado numérico", () => {
    expect(lerDinheiro("1.234,56")).toBe(1234.56);
    expect(lerDinheiro("1234,5")).toBe(1234.5);
    expect(lerDinheiro("1234.56")).toBe(1234.56);
    expect(lerDinheiro("1,234.56")).toBe(1234.56);
  });
  it("vazio e lixo são null, não zero — zero seria 'negociar por nada'", () => {
    expect(lerDinheiro("")).toBeNull();
    expect(lerDinheiro("abc")).toBeNull();
  });
});

describe("pedidoDoForm", () => {
  const base = formInicial(500, "2026-10-05");
  it("quitação não leva parcelas nem entrada", () => {
    const r = pedidoDoForm({ ...base, valorNegociado: "400,00" }, 500);
    expect(r).toEqual({ ok: true, pedido: { tipo: "quitacao_desconto", valorOriginal: 500, valorNegociado: 400 } });
  });
  it("parcelamento exige parcelas e vencimento", () => {
    const r = pedidoDoForm({ ...base, tipo: "parcelamento", parcelas: "0" }, 500);
    expect(r).toEqual({ ok: false, erro: "Informe o número de parcelas." });
    const s = pedidoDoForm({ ...base, tipo: "parcelamento", parcelas: "3", primeiroVencimento: "" }, 500);
    expect(s.ok).toBe(false);
  });
  it("entrada vazia é zero; entrada com lixo é erro", () => {
    const ok = pedidoDoForm({ ...base, tipo: "parcelamento", parcelas: "2", entrada: "" }, 500);
    expect(ok.ok && ok.pedido.entrada).toBe(0);
    const erro = pedidoDoForm({ ...base, tipo: "parcelamento", parcelas: "2", entrada: "x" }, 500);
    expect(erro.ok).toBe(false);
  });
});

describe("previaDaNegociacao", () => {
  const base = formInicial(500, "2026-10-31");
  it("calcula o desconto e as parcelas com a política que a tela leu", () => {
    const p = previaDaNegociacao({ ...base, tipo: "parcelamento", valorNegociado: "450", entrada: "90", parcelas: "3" }, 500, POLITICA_PADRAO);
    expect(p.erro).toBeNull();
    expect(p.descontoPct).toBe(10);
    expect(p.violacoes).toEqual([]);
    expect(p.parcelas?.map(x => x.valor)).toEqual([120, 120, 120]);
    // 31/10 → 30/11: o mês sem o dia cai no último dia.
    expect(p.parcelas?.map(x => x.vencimento)).toEqual(["2026-10-31", "2026-11-30", "2026-12-31"]);
  });
  it("mostra a violação da política antes do envio", () => {
    const p = previaDaNegociacao({ ...base, valorNegociado: "300" }, 500, POLITICA_PADRAO);
    expect(p.violacoes.some(v => v.includes("40%"))).toBe(true);
  });
  it("sem política não julga — julgar contra o padrão diria 'ok' ao que o provedor recusa", () => {
    const p = previaDaNegociacao({ ...base, valorNegociado: "300" }, 500, null);
    expect(p.violacoes).toEqual([]);
    expect(p.descontoPct).toBe(40);
  });
  it("campo faltando trava a prévia", () => {
    expect(previaDaNegociacao({ ...base, valorNegociado: "" }, 500, POLITICA_PADRAO).erro).toBe("Informe o valor negociado.");
  });
});

describe("corpoDaNegociacao", () => {
  const base = formInicial(500, "2026-10-05");
  it("quitação vai enxuta; parcelamento vai com entrada, parcelas e vencimento", () => {
    expect(corpoDaNegociacao({ ...base, valorNegociado: "400", aceita: true }, 500))
      .toEqual({ tipo: "quitacao_desconto", valorOriginal: 500, valorNegociado: 400, aceita: true });
    expect(corpoDaNegociacao({ ...base, tipo: "parcelamento", valorNegociado: "450", entrada: "90", parcelas: "3" }, 500))
      .toEqual({ tipo: "parcelamento", valorOriginal: 500, valorNegociado: 450, entrada: 90, parcelas: 3, primeiroVencimento: "2026-10-05", aceita: false });
  });
  it("formulário inválido não vira corpo", () => {
    expect(corpoDaNegociacao({ ...base, valorNegociado: "" }, 500)).toBeNull();
  });
});

describe("violacoesDoErro", () => {
  it("lê o 422 nas duas formas em que o erro chega", () => {
    expect(violacoesDoErro({ status: 422, violacoes: ["a", "b"] })).toEqual(["a", "b"]);
    expect(violacoesDoErro({ status: 422, message: JSON.stringify({ violacoes: ["c"] }) })).toEqual(["c"]);
  });
  it("no 422 sem lista, a mensagem (a primeira violação, que apiRequest guarda) é a lista", () => {
    expect(violacoesDoErro({ status: 422, message: "Desconto de 40% excede o teto de 20% da política." }))
      .toEqual(["Desconto de 40% excede o teto de 20% da política."]);
  });
  it("erro comum não tem violações — vai para o toast, não para a lista", () => {
    expect(violacoesDoErro(new Error("Sessão expirada"))).toEqual([]);
    expect(violacoesDoErro({ status: 409, message: "A dívida mudou" })).toEqual([]);
    expect(violacoesDoErro(null)).toEqual([]);
  });
});

/**
 * A OFERTA da política de acordo (0029) preenchendo o formulário: o operador
 * clica no que a política já autoriza em vez de digitar. O que sai daqui tem
 * de passar em `previaDaNegociacao` sem violação — senão a tela ofereceria um
 * botão que ela mesma recusa.
 */
describe("formDaOferta", () => {
  const politica = PoliticaSchema.parse({});
  const configurada = { ...politica, acordo: { ...politica.acordo, ex_cliente: { ...politica.acordo.ex_cliente, origemDaCobranca: "asaas" as const } } };
  const base = formInicial(1000, "2026-10-05");
  const ofertas = ofertasDaPolitica({ saldo: 1000, diasAtraso: 200, carteira: "ex_cliente", hoje: "2026-09-06" }, configurada).ofertas;

  it("a oferta à vista vira quitação com o valor e a data dela", () => {
    const form = formDaOferta(ofertas[0], base);
    expect(form).toMatchObject({ tipo: "quitacao_desconto", valorNegociado: "800,00", entrada: "", primeiroVencimento: "2026-09-06" });
  });

  it("a oferta parcelada vira parcelamento com entrada, parcelas e 1º vencimento", () => {
    const form = formDaOferta(ofertas[1], base);
    expect(form).toMatchObject({ tipo: "parcelamento", valorNegociado: "800,00", entrada: "160,00", parcelas: "6", primeiroVencimento: "2026-09-06" });
  });

  it("não mexe no 'o cliente já aceitou': isso é do operador, não da política", () => {
    expect(formDaOferta(ofertas[0], { ...base, aceita: true }).aceita).toBe(true);
    expect(formDaOferta(ofertas[0], { ...base, aceita: false }).aceita).toBe(false);
  });

  it("toda oferta preenchida passa na prévia, sem violação", () => {
    for (const oferta of ofertas) {
      const previa = previaDaNegociacao(formDaOferta(oferta, base), 1000, configurada);
      expect(previa.erro, oferta.tipo).toBeNull();
      expect(previa.violacoes, oferta.tipo).toEqual([]);
    }
  });
});

/**
 * O 201 é quem sabe o que aconteceu. A rota rebaixa a proposta que passou da
 * faixa da política de acordo (`aceita && excecao === null`) e devolve
 * `exigeAprovacao` — antes disso a tela escolhia a frase pelo checkbox do
 * formulário e anunciava "Acordo registrado" para uma proposta pendente.
 */
describe("registroDaResposta", () => {
  it("lê a marca e os motivos que a rota devolveu", () => {
    expect(registroDaResposta({ id: 5, exigeAprovacao: true, motivosDaExcecao: ["Desconto de 15% acima dos 5%."] }))
      .toEqual({ exigeAprovacao: true, motivos: ["Desconto de 15% acima dos 5%."] });
  });
  it("proposta comum não é exceção", () => {
    expect(registroDaResposta({ id: 5, exigeAprovacao: false, motivosDaExcecao: [] }))
      .toEqual({ exigeAprovacao: false, motivos: [] });
  });
  it("motivo sem a marca ainda é exceção — nunca 'acordo registrado' por descuido", () => {
    expect(registroDaResposta({ motivosDaExcecao: ["passou da faixa"] }).exigeAprovacao).toBe(true);
  });
  it("corpo estranho não inventa pendência nem quebra a tela", () => {
    for (const corpo of [null, undefined, "ok", 7, {}]) {
      expect(registroDaResposta(corpo)).toEqual({ exigeAprovacao: false, motivos: [] });
    }
  });
});

describe("avisoDoRegistro", () => {
  const semExcecao = { exigeAprovacao: false, motivos: [] };
  it("sem exceção, a frase é a do que o operador pediu", () => {
    expect(avisoDoRegistro(semExcecao, true, "Quitação · Ana")).toEqual({ titulo: "Acordo registrado", descricao: "Quitação · Ana" });
    expect(avisoDoRegistro(semExcecao, false, "Quitação · Ana").titulo).toBe("Proposta registrada");
  });
  it("com exceção, NÃO diz acordo — nem quando o operador marcou 'o cliente já aceitou'", () => {
    const aviso = avisoDoRegistro({ exigeAprovacao: true, motivos: ["Desconto de 15% acima dos 5% da faixa."] }, true, "Quitação · Ana");
    expect(aviso.titulo).toBe("Proposta pendente de aprovação");
    expect(aviso.titulo).not.toMatch(/Acordo/);
    expect(aviso.descricao).toMatch(/Desconto de 15%/);
    expect(aviso.descricao).toMatch(/administrador/);
  });
  it("exceção sem motivo ainda explica por que ficou pendente", () => {
    expect(avisoDoRegistro({ exigeAprovacao: true, motivos: [] }, false, "x").descricao).toMatch(/faixa da política/);
  });
});

/**
 * A prévia da exceção usa a MESMA função do servidor sobre a política que a
 * tela leu: o operador vê antes de apertar que a proposta vai depender de
 * aprovação.
 */
describe("excecaoPrevista", () => {
  const politica = PoliticaSchema.parse({});
  const base = formInicial(400, "2026-10-05");
  // Ativo com 45 dias de atraso: a faixa de 31 a 60 dias dá 5% de desconto.
  const alvo = { carteira: "ativo" as const, diasAtraso: 45 };

  it("dentro da faixa não prevê nada", () => {
    expect(excecaoPrevista({ ...base, valorNegociado: "380" }, 400, politica, alvo)).toEqual([]);
  });
  it("acima da faixa e dentro do teto de exceção: os motivos, nas frases da política", () => {
    const motivos = excecaoPrevista({ ...base, valorNegociado: "340" }, 400, politica, alvo);
    expect(motivos).toHaveLength(1);
    expect(motivos[0]).toMatch(/acima dos 5% da faixa de 31 a 60 dias/);
  });
  it("sem carteira, sem atraso ou sem política não há régua — não prevê pela errada", () => {
    expect(excecaoPrevista({ ...base, valorNegociado: "340" }, 400, politica, { diasAtraso: 45 })).toEqual([]);
    expect(excecaoPrevista({ ...base, valorNegociado: "340" }, 400, politica, { carteira: "ativo" })).toEqual([]);
    expect(excecaoPrevista({ ...base, valorNegociado: "340" }, 400, null, alvo)).toEqual([]);
    expect(excecaoPrevista({ ...base, valorNegociado: "340" }, 400, politica, null)).toEqual([]);
  });
  it("formulário pela metade não prevê nada", () => {
    expect(excecaoPrevista({ ...base, valorNegociado: "" }, 400, politica, alvo)).toEqual([]);
  });
});
