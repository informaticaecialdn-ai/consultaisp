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
    // Todos os dados do registro, com rotulo, na ordem da tela — e o que o
    // operador precisa para cobrar ou conferir com o cliente.
    expect(spc.detalhes).toEqual([
      { rotulo: "Credor (associado)", valor: "REDE BRASIL CREDIARIO" },
      { rotulo: "Entidade", valor: "SAO PAULO / SP" },
      { rotulo: "Cidade", valor: "CURITIBA / PR" },
      { rotulo: "Telefone do credor", valor: "(41) 30145922" },
      { rotulo: "Contrato", valor: "90020186/2462" },
      { rotulo: "Valor", valor: "R$ 39,90" },
      { rotulo: "Vencimento", valor: "27/01/2024" },
      { rotulo: "Inclusão no SPC", valor: "12/03/2024" },
      { rotulo: "Papel do consultado", valor: "COMPRADOR" },
      { rotulo: "Instituição financeira", valor: "não" },
    ]);
    const avalista = r.restrictions[1];
    expect(avalista.description).toContain("como avalista");
    expect(avalista.description).toContain("instituição financeira");
    expect(avalista.severity).toBe("high");
    expect(avalista.detalhes.find(d => d.rotulo === "Instituição financeira")?.valor).toBe("sim");
    expect(avalista.detalhes.some(d => d.rotulo === "Telefone do credor")).toBe(false);
    const ccf = r.restrictions[2];
    expect(ccf.description).toBe("2 cheques sem fundo · MOTIVO 12 · BANCO COOPERATIVO DO BRASIL S/A");
    expect(ccf.creditor).toBe("BANCO CENTRAL DO BRASIL");
    expect(ccf.detalhes).toEqual([
      { rotulo: "Origem", valor: "BANCO CENTRAL DO BRASIL" },
      { rotulo: "Quantidade de cheques", valor: "2" },
      { rotulo: "Motivo", valor: "12 · MOTIVO 12" },
      { rotulo: "Último cheque", valor: "24/07/2023" },
      { rotulo: "Banco", valor: "756 · BANCO COOPERATIVO DO BRASIL S/A" },
      { rotulo: "Agência", valor: "4340" },
    ]);
    const cheque = r.restrictions[3];
    expect(cheque).toMatchObject({ creditor: "SUPERMERCADO EXEMPLO", value: "613.85", date: "2023-07-12", origin: "NOVA ESPERANCA / PR" });
    expect(cheque.description).toContain("MOTIVO 12");
    expect(cheque.detalhes).toEqual([
      { rotulo: "Credor (associado)", valor: "SUPERMERCADO EXEMPLO" },
      { rotulo: "Entidade", valor: "Associação Comercial - NOVA ESPERANCA / PR" },
      { rotulo: "Cidade", valor: "NOVA ESPERANCA / PR" },
      { rotulo: "Alínea", valor: "12 · MOTIVO 12" },
      { rotulo: "Cheque", valor: "55-8" },
      { rotulo: "Banco", valor: "756 · BANCO COOPERATIVO DO BRASIL S/A" },
      { rotulo: "Agência", valor: "4340" },
      { rotulo: "Emissão", valor: "02/05/2023" },
      { rotulo: "Valor", valor: "R$ 613,85" },
      { rotulo: "Inclusão", valor: "12/07/2023" },
    ]);
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
    expect(r.restrictions[0].detalhes).toEqual([
      { rotulo: "Tipo de ação", valor: "Execução Fiscal Federal" },
      { rotulo: "Vara", valor: "0006" },
      { rotulo: "Comarca", valor: "CONTAGEM / MG" },
      { rotulo: "Data", valor: "29/09/2023" },
      { rotulo: "Valor", valor: "R$ 9.715,46" },
    ]);
    expect(r.restrictions[1].detalhes).toEqual([
      { rotulo: "Cartório", valor: "0001" },
      { rotulo: "Cidade", valor: "CLAUDIO / MG" },
      { rotulo: "Data do protesto", valor: "02/08/2022" },
      { rotulo: "Valor", valor: "R$ 1.470,07" },
    ]);
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

describe("insumos do retorno padrão do 257 que não tinham exemplo: cheque sustado, Poder Judiciário, cheque sem fundo no varejo (pelo XSD)", () => {
  const blocos = `
         <contra-ordem>
            <resumo quantidade-total="1"/>
            <detalhe-contra-ordem origem="SAO PAULO / SP" data-ocorrencia="2024-05-10T00:00:00-03:00" informante="BANCO SANTANDER BRASIL S/A">
               <motivo codigo="25" descricao="CANCELADO"/>
               <cheque-inicial numero="54" digito="1">
                  <dados-bancarios numero-agencia="2383" numero-conta-corrente="3901013724">
                     <banco codigo="33" nome="BANCO SANTANDER BRASIL S/A"/>
                  </dados-bancarios>
               </cheque-inicial>
               <cheque-final numero="60"/>
            </detalhe-contra-ordem>
         </contra-ordem>
         <contumacia>
            <resumo quantidade-total="1"/>
            <detalhe-contumacia origem="CURITIBA / PR" data-ocorrencia="2024-06-01T00:00:00-03:00">
               <motivo codigo="28" descricao="CONTRA-ORDEM POR CONTUMACIA"/>
               <cheque-inicial numero="100">
                  <dados-bancarios numero-agencia="1"><banco codigo="1" nome="BANCO DO BRASIL S/A"/></dados-bancarios>
               </cheque-inicial>
               <cheque-final numero="100"/>
            </detalhe-contumacia>
         </contumacia>
         <informacao-poder-judiciario>
            <resumo quantidade-total="1" data-ultima-ocorrencia="2021-11-03T00:00:00-03:00" valor-total="11107.63"/>
            <detalhe-informacao-poder-judiciario data-documento="2021-11-03T00:00:00-03:00" data-inclusao="2021-11-10T00:00:00-03:00" entidade-origem="VITORIA / ES" numero-processo="0005966-53.2016.8.08.0011" valor="11107.63">
               <vara nome="4ª VARA CÍVEL"><comarca nome="CACHOEIRO DE ITAPEMIRIM"><estado sigla-uf="ES"/></comarca></vara>
            </detalhe-informacao-poder-judiciario>
         </informacao-poder-judiciario>
         <cheque-sem-fundo-varejo>
            <resumo quantidade-total="1"/>
            <detalhe-cheque-sem-fundo-varejo data-ocorrencia-mais-recente="2023-02-14T00:00:00-03:00" numero-loja="12" origem-ocorrencia-mais-recente="LOJAS TESTE LTDA" quantidade-cheques="3">
               <dados-bancarios numero-agencia="4321"><banco codigo="237" nome="BANCO BRADESCO S/A"/></dados-bancarios>
               <cidade-ocorrencia nome="LONDRINA"><estado sigla-uf="PR"/></cidade-ocorrencia>
            </detalhe-cheque-sem-fundo-varejo>
         </cheque-sem-fundo-varejo>
         <score-cadastro-positivo>
            <resumo quantidade-total="0"/>
         </score-cadastro-positivo>
         <mensagem-base-externa origem-base-externa="RECEITA_FEDERAL" mensagem-base-externa="Base externa inoperante no momento; tente novamente"/>`;
  const xml = fixture("pf-limpo-com-score.xml")
    .replace(/<score-cadastro-positivo>[\s\S]*?<\/score-cadastro-positivo>/, blocos)
    .replace('restricao="false"', 'restricao="true"');
  const r = parseRespostaConsulta(xml, "00752477714");

  it("lê contra-ordem e contumácia como cheque sustado, com todos os dados do registro", () => {
    const sustados = r.restrictions.filter(x => x.type === "CHEQUE_SUSTADO");
    expect(sustados).toHaveLength(2);
    const contumacia = sustados.find(x => x.description.includes("contumácia"))!;
    expect(contumacia).toMatchObject({ severity: "high", date: "2024-06-01", origin: "CURITIBA / PR", creditor: "BANCO DO BRASIL S/A" });
    const contraOrdem = sustados.find(x => x.description.includes("contra-ordem"))!;
    expect(contraOrdem).toMatchObject({ severity: "medium", date: "2024-05-10", origin: "SAO PAULO / SP", creditor: "BANCO SANTANDER BRASIL S/A" });
    expect(contraOrdem.detalhes).toEqual(expect.arrayContaining([
      { rotulo: "Motivo", valor: "25 · CANCELADO" },
      { rotulo: "Cheque", valor: "54-1 a 60" },
      { rotulo: "Banco", valor: "33 · BANCO SANTANDER BRASIL S/A" },
      { rotulo: "Agência", valor: "2383" },
      { rotulo: "Conta", valor: "3901013724" },
      { rotulo: "Informante", valor: "BANCO SANTANDER BRASIL S/A" },
    ]));
  });

  it("lê a informação do Poder Judiciário com valor, processo, vara e comarca", () => {
    const pj = r.restrictions.find(x => x.type === "PODER_JUDICIARIO")!;
    expect(pj).toMatchObject({
      value: "11107.63", severity: "critical", date: "2021-11-03",
      creditor: "VITORIA / ES", origin: "CACHOEIRO DE ITAPEMIRIM / ES",
    });
    expect(pj.description).toContain("0005966-53.2016.8.08.0011");
    expect(pj.detalhes).toEqual(expect.arrayContaining([
      { rotulo: "Número do processo", valor: "0005966-53.2016.8.08.0011" },
      { rotulo: "Vara", valor: "4ª VARA CÍVEL" },
      { rotulo: "Valor", valor: "R$ 11.107,63" },
      { rotulo: "Data do documento", valor: "03/11/2021" },
      { rotulo: "Inclusão", valor: "10/11/2021" },
    ]));
    expect(r.resumo.poderJudiciario).toEqual({ quantidade: 1, valor: 11107.63, ultimaOcorrencia: "2021-11-03" });
    expect(r.totalRestrictions).toBe(11107.63);
  });

  it("lê cheque sem fundo no varejo pelos atributos do XSD (quantidade, ocorrência, origem, banco, cidade)", () => {
    const csf = r.restrictions.find(x => x.type === "CHEQUE_SEM_FUNDO")!;
    expect(csf).toMatchObject({
      description: "3 cheques sem fundo no varejo · BANCO BRADESCO S/A",
      severity: "critical", creditor: "LOJAS TESTE LTDA", date: "2023-02-14", origin: "LONDRINA / PR", value: "0.00",
    });
    expect(csf.detalhes).toEqual(expect.arrayContaining([
      { rotulo: "Quantidade de cheques", valor: "3" },
      { rotulo: "Ocorrência mais recente", valor: "14/02/2023" },
      { rotulo: "Loja", valor: "12" },
    ]));
  });

  it("score-cadastro-positivo com resumo 0 e sem <detalhe> é 'sem informação', não score zero", () => {
    expect(r.score).toBeNull();
    expect(r.scoreFonte).toBeUndefined();
    // Veredito pelas restrições: 4 registros e mais de R$ 500.
    expect(r.riskLevel).toBe("very_high");
    expect(r.recommendation).toBe("Recusar");
  });

  it("mensagem-base-externa vira alerta com a origem", () => {
    expect(r.alerts).toContainEqual({
      type: "BASE_EXTERNA",
      message: "RECEITA_FEDERAL: Base externa inoperante no momento; tente novamente",
      severity: "medium",
    });
  });
});

describe("respostas que não são consulta", () => {
  const env = (body: string) =>
    `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>${body}</S:Body></S:Envelope>`;

  it("<resultado xsi:nil=\"true\"/> não é consulta limpa: é erro de resposta", () => {
    const xml = env(`<ns2:resultado xmlns:ns2="http://webservice.consulta.spcjava.spcbrasil.org/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/>`);
    const err = (() => { try { parseRespostaConsulta(xml, "00752477714"); } catch (e) { return e as SpcError; } })();
    expect(err).toBeInstanceOf(SpcError);
    expect(err?.codigo).toBe("SEM_RESULTADO");
  });

  it("faultstring com atributo (xml:lang) ainda é classificado, sem '[object Object]'", () => {
    const xml = env(`<S:Fault><faultcode>S:Server</faultcode><faultstring xml:lang="pt">CN_INT005.E4 - Operador não possui acesso ao produto</faultstring></S:Fault>`);
    const err = (() => { try { parseRespostaConsulta(xml, "00752477714"); } catch (e) { return e as SpcError; } })();
    expect(err).toBeInstanceOf(SpcError);
    expect(err?.categoria).toBe("produto");
    expect(err?.message).not.toContain("[object Object]");
  });
});
