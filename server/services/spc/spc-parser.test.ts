import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseRespostaConsulta, parseProdutos, classificarFault, SpcError } from "./spc-parser";
import { montarFiltroConsulta } from "./spc.service";

/**
 * As fixtures sao copias reduzidas e anonimizadas dos exemplos oficiais da
 * documentacao v4.3 (produtos 632, 634, 325 e 679): mesma hierarquia, mesmos
 * nomes de atributo, nomes de pessoas e associados trocados, CPFs da lista de
 * homologacao do SPC.
 */
const fixture = (nome: string) => readFileSync(join(__dirname, "__fixtures__", nome), "utf8");

describe("consulta PF com restrições (produto com SPC, cheque, CCF, pendência e score)", () => {
  const r = parseRespostaConsulta(fixture("pf-com-restricoes.xml"), "007.524.777-14");

  it("lê protocolo, data e a flag de restrição do próprio SPC", () => {
    expect(r.protocolo).toBe("14558422729-10");
    expect(r.consultadoEm).toBe("2024-03-13T10:54:08.080-03:00");
    expect(r.restricao).toBe(true);
    expect(r.status).toBe("restricted");
  });

  it("lê o consumidor pessoa física", () => {
    expect(r.cadastralData).toMatchObject({
      tipo: "PF",
      nome: "MARIA TESTE DA SILVA",
      cpfCnpj: "00752477714",
      dataNascimento: "1973-11-11",
      nomeMae: "ANA TESTE",
      idade: 50,
      situacaoRf: "REGULAR",
      obitoRegistrado: false,
      cidade: "NOVA ESPERANCA",
      uf: "PR",
      telefone: "(44) 998380000",
    });
    expect(r.cadastralData.endereco).toContain("RUA DAS FLORES, 772, CENTRO");
    expect(r.cadastralData.endereco).toContain("CEP 87600000");
  });

  it("unifica SPC, cheque lojista e CCF em restrições, da mais recente para a mais antiga", () => {
    expect(r.restrictions.map(x => x.type)).toEqual(["SPC", "SPC", "CCF", "CHEQUE_LOJISTA"]);
    const spc = r.restrictions[0];
    expect(spc).toMatchObject({
      creditor: "REDE BRASIL CREDIARIO", value: "39.90", date: "2024-03-12", origin: "CURITIBA / PR",
      contrato: "90020186/2462", vencimento: "2024-01-27", papel: "COMPRADOR", severity: "medium",
    });
    const avalista = r.restrictions[1];
    expect(avalista.description).toContain("como avalista");
    expect(avalista.description).toContain("instituição financeira");
    expect(avalista.severity).toBe("high");
    const ccf = r.restrictions[2];
    expect(ccf.description).toBe("2 cheques sem fundo · MOTIVO 12 · BANCO COOPERATIVO DO BRASIL S/A");
    expect(ccf.creditor).toBe("BANCO CENTRAL DO BRASIL");
    const cheque = r.restrictions[3];
    expect(cheque).toMatchObject({ creditor: "SUPERMERCADO EXEMPLO", value: "613.85", date: "2023-07-12", origin: "NOVA ESPERANCA / PR" });
    expect(cheque.description).toContain("MOTIVO 12");
  });

  it("o total soma SPC + cheque, pelo resumo oficial, e NÃO conta a pendência financeira duas vezes", () => {
    expect(r.resumo.spc).toEqual({ quantidade: 2, valor: 482.51, ultimaOcorrencia: "2024-03-12" });
    expect(r.resumo.chequeLojista.valor).toBe(613.85);
    expect(r.resumo.ccf.quantidade).toBe(2);
    expect(r.totalRestrictions).toBe(1096.36);
    expect(r.pendenciasFinanceiras).toHaveLength(2);
    expect(r.pendenciasFinanceiras[1]).toMatchObject({ origem: "BANCO EXEMPLO S/A", titulo: "FINANCIAMENT", valor: 442.61, avalista: true, cidade: "OSASCO / SP" });
  });

  it("score do cadastro positivo: 0 com índice ALTO, e o veredito sai dele", () => {
    expect(r.score).toBe(0);
    expect(r.scoreFonte).toBe("score-cadastro-positivo");
    expect(r.scoreDetalhe?.indiceRisco).toBe("ALTO");
    expect(r.riskLevel).toBe("very_high");
    expect(r.recommendation).toBe("Recusar");
  });

  it("lista quem consultou o documento nos últimos 90 dias", () => {
    expect(r.previousConsultations.total).toBe(2);
    expect(r.previousConsultations.diasConsiderados).toBe(90);
    expect(r.previousConsultations.lista[1]).toEqual({
      associado: "PROVEDOR EXEMPLO TELECOM", entidade: "Associação Comercial - NOVA ESPERANCA / PR",
      cidade: "NOVA ESPERANCA", uf: "PR", data: "2024-01-17",
    });
  });

  it("alerta de documento roubado vira alerta crítico", () => {
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].severity).toBe("critical");
    expect(r.alerts[0].message).toBe("Alerta de documento (RG) — Roubo/Furto: Roubados (10/04/2017)");
  });

  it("renda presumida e limite sugerido chegam em reais", () => {
    expect(r.rendaPresumida).toBe(3478);
    expect(r.limiteCreditoSugerido).toBe(125);
  });

  it("não guarda o XML cru a menos que se peça", () => {
    expect(r.rawXml).toBeUndefined();
    expect(parseRespostaConsulta(fixture("pf-limpo-com-score.xml"), "02358474703", { guardarXml: true }).rawXml).toContain("<S:Envelope");
  });
});

describe("consulta PF limpa com score", () => {
  const r = parseRespostaConsulta(fixture("pf-limpo-com-score.xml"), "02358474703");

  it("sem restrição, blocos com quantidade zero não viram restrição", () => {
    expect(r.restricao).toBe(false);
    expect(r.status).toBe("clean");
    expect(r.restrictions).toEqual([]);
    expect(r.totalRestrictions).toBe(0);
    expect(r.pendenciasFinanceiras).toEqual([]);
    expect(r.previousConsultations.total).toBe(0);
    expect(r.alerts).toEqual([]);
  });

  it("score 610 MÉDIO -> risco médio, aprovar com ressalvas", () => {
    expect(r.score).toBe(610);
    expect(r.scoreDetalhe?.indiceRisco).toBe("MEDIO");
    expect(r.riskLevel).toBe("medium");
    expect(r.recommendation).toBe("Aprovar com ressalvas");
  });

  it("sem renda presumida nem limite no produto -> null, não zero", () => {
    expect(r.rendaPresumida).toBeNull();
    expect(r.limiteCreditoSugerido).toBeNull();
  });
});

describe("consulta PJ com protesto e ação, sem score", () => {
  const r = parseRespostaConsulta(fixture("pj-com-protesto.xml"), "02.178.451/0001-49");

  it("lê o consumidor pessoa jurídica", () => {
    expect(r.cadastralData).toMatchObject({
      tipo: "PJ", nome: "EMPRESA TESTE LTDA", cpfCnpj: "02178451000149", dataFundacao: "2018-01-02",
      situacaoRf: "ATIVA", naturezaJuridica: "SOCIEDADE EMPRESARIA LIMITADA",
      atividadePrincipal: "PROVEDORES DE ACESSO AS REDES DE COMUNICACOES", cidade: "BARUERI", uf: "SP",
    });
    expect(r.cadastralData.dataNascimento).toBeUndefined();
  });

  it("protesto e ação judicial entram como restrição com severidade alta no mínimo", () => {
    expect(r.restrictions.map(x => x.type)).toEqual(["ACAO_JUDICIAL", "PROTESTO", "PROTESTO"]);
    expect(r.restrictions[0]).toMatchObject({ description: "Execução Fiscal Federal", value: "9715.46", date: "2023-09-29", origin: "CONTAGEM / MG", severity: "critical" });
    expect(r.restrictions[1]).toMatchObject({ creditor: "Cartório 0001", value: "1470.07", origin: "CLAUDIO / MG", severity: "critical" });
    expect(r.restrictions[2]).toMatchObject({ value: "66.02", origin: "RIO DE JANEIRO / RJ", severity: "high" });
    expect(r.totalRestrictions).toBe(11251.55);
  });

  it("sem insumo de score o score é null e o veredito sai das restrições — nunca um número inventado", () => {
    expect(r.score).toBeNull();
    expect(r.scoreFonte).toBeUndefined();
    expect(r.riskLevel).toBe("very_high");
    expect(r.recommendation).toBe("Recusar");
  });

  it("base inoperante vira alerta: o resultado pode estar incompleto", () => {
    expect(r.basesInoperantes).toEqual(["CHEQUE ONLINE SRS"]);
    expect(r.alerts.some(a => a.type === "BASE_INOPERANTE" && a.message.includes("CHEQUE ONLINE SRS"))).toBe(true);
  });
});

describe("erros", () => {
  it("SOAP Fault de produto vira SpcError classificado", () => {
    expect(() => parseRespostaConsulta(fixture("fault-produto.xml"), "00752477714")).toThrowError(SpcError);
    try {
      parseRespostaConsulta(fixture("fault-produto.xml"), "00752477714");
    } catch (e) {
      const err = e as SpcError;
      expect(err.categoria).toBe("produto");
      expect(err.codigo).toBe("CN_INT005.E4");
      expect(err.message).toContain("Operador nao possui acesso ao produto");
    }
  });

  it("classifica pelo código e pelo texto do fault", () => {
    expect(classificarFault("CN_INT005.E2.3 - Operador e Senha invalidos").categoria).toBe("credencial");
    expect(classificarFault("CN_INT005.E3 - Operador nao possui acesso ao sistema ou nao existe").categoria).toBe("credencial");
    expect(classificarFault("CN_INT005.E8.2 - CPF/CNPJ invalido").categoria).toBe("documento");
    expect(classificarFault("CN_INT005.E8.3 - Para o produto informado utilizar somente CPF").categoria).toBe("documento");
    expect(classificarFault("CN_GER001.E0 - Erro interno.").categoria).toBe("indisponivel");
    expect(classificarFault("qualquer outra coisa").categoria).toBe("resposta");
  });

  it("XML inválido e envelope sem resultado são erros de resposta", () => {
    expect(() => parseRespostaConsulta("isto nao e xml <", "00752477714")).toThrowError(/XML/);
    expect(() => parseRespostaConsulta("<S:Envelope xmlns:S=\"x\"><S:Body/></S:Envelope>", "00752477714")).toThrowError(/resultado/);
  });
});

describe("listarProdutos / detalharProduto", () => {
  it("lê os produtos com parâmetros e insumos", () => {
    const produtos = parseProdutos(fixture("produtos.xml"));
    expect(produtos.map(p => [p.codigo, p.nome])).toEqual([[257, "SPC MIX TOP +"], [634, "SPC SÓ SCORE POSITIVO"]]);
    const mix = produtos[0];
    expect(mix.parametros.find(p => p.nome === "documento-consumidor")?.obrigatorio).toBe(true);
    expect(mix.insumosRetorno.map(i => i.nome)).toContain("spc");
    expect(mix.insumosRetorno.find(i => i.nome === "protesto")?.opcional).toBe(true);
    expect(mix.insumosOpcionais).toEqual([{ nome: "protesto", codigo: 17 }]);
  });
});

describe("envelope da consulta", () => {
  it("CPF vira tipo F, CNPJ vira tipo J, só dígitos, com insumos opcionais", () => {
    const pf = montarFiltroConsulta(257, "007.524.777-14");
    expect(pf).toContain("<codigo-produto>257</codigo-produto>");
    expect(pf).toContain("<tipo-consumidor>F</tipo-consumidor>");
    expect(pf).toContain("<documento-consumidor>00752477714</documento-consumidor>");
    expect(pf).not.toContain("codigo-insumo-opcional");
    const pj = montarFiltroConsulta(257, "02.178.451/0001-49", [17]);
    expect(pj).toContain("<tipo-consumidor>J</tipo-consumidor>");
    expect(pj).toContain("<codigo-insumo-opcional>17</codigo-insumo-opcional>");
    expect(pj).toContain('xmlns:web="http://webservice.consulta.spcjava.spcbrasil.org/"');
  });
});
