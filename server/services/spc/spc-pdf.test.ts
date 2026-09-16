/**
 * O PDF da consulta SPC é o mesmo relatório que a tela mostra, montado a
 * partir da LINHA gravada (o provedor pagou por ela) — nunca de uma consulta
 * nova ao SPC. Aqui se prova a montagem do documento, que é pura: as seções
 * saem na ORDEM da tela, cada restrição vira um cartão com TODOS os detalhes
 * que o parser devolveu, e nada que a tela não mostra entra. O PDF em si é o
 * gerador genérico de `server/assinatura/pdf.ts`, testado lá.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SpcConsultation } from "@shared/schema";
import type { BlocoDoDocumento, DocumentoRenderizado } from "@shared/cobranca/confissao-modelo";
import { parseRespostaConsulta } from "./spc-parser";
import { documentoDaConsultaSpc, nomeDoArquivoDoPdfSpc, MARCA_DAGUA_SIMULADO } from "./spc-pdf";

function consulta(extra: Partial<Omit<SpcConsultation, "result">> & { result?: Record<string, unknown> } = {}): SpcConsultation {
  const { result: resultExtra, ...linha } = extra;
  return {
    id: 91, providerId: 42, userId: 7, cpfCnpj: "00752477714", score: 745, consultaId: "CI-2609-K7F3M2",
    createdAt: new Date("2026-09-16T14:05:00.000Z"),
    result: {
      cpfCnpj: "00752477714", protocolo: "SPC-2026-000123", consultadoEm: "2026-09-16T14:04:58.000Z", restricao: true,
      cadastralData: {
        nome: "Maria da Silva", cpfCnpj: "00752477714", dataNascimento: "1988-03-12", nomeMae: "Ana da Silva",
        situacaoRf: "REGULAR", obitoRegistrado: false, tipo: "PF", cidade: "Londrina", uf: "PR",
      },
      score: 745, scoreFonte: "spc-score-12-meses", scoreDetalhe: { indiceRisco: "B" },
      riskLevel: "low", riskLabel: "Risco baixo", recommendation: "Aprovar com cautela",
      status: "restricted",
      restrictions: [{
        type: "spc", description: "Registro SPC", severity: "high", creditor: "Loja Exemplo", value: "350.90",
        date: "2026-05-10", origin: "SPC", contrato: "C-77", vencimento: "2026-04-10",
        detalhes: [{ rotulo: "Cidade", valor: "Londrina" }, { rotulo: "Contrato", valor: "C-77" }],
      }],
      totalRestrictions: 350.9,
      resumo: {},
      pendenciasFinanceiras: [{ origem: "Banco X", titulo: "Empréstimo", data: "2026-02-01", valor: 1200, avalista: false }],
      previousConsultations: {
        total: 2, last90Days: 2, diasConsiderados: 90, bySegment: {},
        lista: [{ associado: "Provedor Y", cidade: "Cambé", uf: "PR", data: "2026-08-01" }],
      },
      alerts: [{ type: "documento", message: "Verificar documento", severity: "medium" }],
      rendaPresumida: 3500, limiteCreditoSugerido: 900, basesInoperantes: ["Cheque lojista"],
      rawXml: "<xml>SEGREDO-DO-XML</xml>",
      creditosCobrados: 3,
      ...resultExtra,
    },
    ...linha,
  } as SpcConsultation;
}

/** A linha "limpa": sem restrição, sem score, sem pendência, sem alerta, ninguém consultou. */
const limpa = (extra: Record<string, unknown> = {}) => consulta({
  score: null,
  result: {
    status: "clean", restricao: false, restrictions: [], totalRestrictions: 0, score: null, scoreDetalhe: undefined,
    riskLevel: "very_low", riskLabel: "Nada consta", recommendation: "Aprovar",
    rendaPresumida: null, limiteCreditoSugerido: null,
    pendenciasFinanceiras: [], alerts: [], basesInoperantes: [],
    previousConsultations: { total: 0, last90Days: 0, diasConsiderados: 90, bySegment: {}, lista: [] },
    ...extra,
  },
});

const GERADO_EM = new Date("2026-09-16T15:00:00.000Z");
const montar = (c: SpcConsultation = consulta()) => documentoDaConsultaSpc({ consulta: c, provedor: { name: "NsLink Provedor" }, geradoEm: GERADO_EM });
const textoDe = (doc: DocumentoRenderizado) => JSON.stringify(doc.blocos);
type Bloco<T extends BlocoDoDocumento["tipo"]> = Extract<BlocoDoDocumento, { tipo: T }>;
const dos = <T extends BlocoDoDocumento["tipo"]>(doc: DocumentoRenderizado, tipo: T) => doc.blocos.filter((b): b is Bloco<T> => b.tipo === tipo);
const primeiro = <T extends BlocoDoDocumento["tipo"]>(doc: DocumentoRenderizado, tipo: T) => {
  const b = dos(doc, tipo)[0];
  expect(b, tipo).toBeDefined();
  return b;
};
const painelDe = (doc: DocumentoRenderizado, titulo: string) => {
  const coluna = primeiro(doc, "painel").colunas.find(c => c.titulo === titulo);
  expect(coluna, titulo).toBeDefined();
  return coluna!.blocos;
};

describe("documentoDaConsultaSpc", () => {
  it("leva tudo o que a tela mostra: identificação, cadastro, análise, restrições com detalhes, pendências, quem consultou, alertas e bases inoperantes", () => {
    const doc = montar();
    const t = textoDe(doc);
    expect(doc.titulo).toContain("SPC");
    for (const esperado of [
      "CI-2609-K7F3M2", "SPC-2026-000123", "NsLink Provedor",
      "Maria da Silva", "007.524.777-14", "12/03/1988", "Ana da Silva", "Regular", "Londrina",
      "745", "Risco baixo", "Aprovar com cautela", "3.500,00", "900,00",
      "Loja Exemplo", "350,90", "10/05/2026", "C-77",
      "Banco X", "1.200,00", "Provedor Y", "Cambé", "01/08/2026",
      "Verificar documento", "Cheque lojista",
    ]) {
      expect(t, esperado).toContain(esperado);
    }
  });

  it("o XML cru e o que a tela não mostra nunca entram — nem nos blocos, nem no cabeçalho/rodapé de página", () => {
    const t = JSON.stringify(montar());
    expect(t).not.toContain("SEGREDO-DO-XML");
    expect(t).not.toContain("rawXml");
  });

  it("as seções saem na ordem da tela: faixa, identificação, cadastro, score | análise, restrições, total, pendências, quem consultou, alertas, bases inoperantes", () => {
    const doc = montar();
    expect(doc.blocos.map(b => b.tipo)).toEqual([
      "faixa", "rotulos",
      "secao", "grade",
      "painel",
      "secao", "registro", "total",
      "secao", "tabela",
      "secao", "lista",
      "secao", "aviso",
      "aviso",
    ]);
    expect(dos(doc, "secao").map(s => s.titulo)).toEqual([
      "Dados Cadastrais",
      "Restrições Encontradas: 1",
      "Pendências financeiras — outras fontes (1)",
      "Quem consultou este documento (últimos 90 dias): 2",
      "Alertas Especiais",
    ]);
    // O aviso LGPD e a linha "gerado em" viraram rodapé de PÁGINA: não há bloco de rodapé fora da demonstração.
    expect(dos(doc, "rodape")).toHaveLength(0);
  });

  it("a faixa: título com o documento, subtítulo com a hora da consulta em Brasília, selo vermelho 'Com restrições'", () => {
    const faixa = primeiro(montar(), "faixa");
    expect(faixa.titulo).toBe("Relatório SPC · CPF: 007.524.777-14");
    expect(faixa.subtitulo).toBe("SPC Brasil · 16/09/2026 às 11:04");
    expect(faixa.selos).toEqual([{ texto: "Com restrições", tom: "perigo" }]);
  });

  it("sem restrições: selo verde na faixa e o cartão verde 'Nenhuma restrição…' no lugar dos registros", () => {
    const doc = montar(limpa());
    expect(primeiro(doc, "faixa").selos).toEqual([{ texto: "Sem restrições", tom: "ok" }]);
    expect(dos(doc, "registro")).toHaveLength(0);
    expect(dos(doc, "total")).toHaveLength(0);
    const cartao = dos(doc, "aviso").find(a => /Nenhuma restrição/.test(a.texto));
    expect(cartao).toMatchObject({ titulo: "Sem restrições", tom: "ok" });
    const t = textoDe(doc);
    expect(t).toContain("Nenhuma restrição");
    expect(t).not.toContain("Loja Exemplo");
    expect(t).not.toContain("null");
  });

  it("SPC sinalizou restrição mas não devolveu registro: o selo diz 'Com restrições' e o cartão não pode ser verde", () => {
    const doc = montar(limpa({ status: "restricted", restricao: true }));
    expect(primeiro(doc, "faixa").selos).toEqual([{ texto: "Com restrições", tom: "perigo" }]);
    const cartao = dos(doc, "aviso").find(a => /Nenhuma restrição/.test(a.texto));
    expect(cartao?.tom).toBe("alerta");
    expect(cartao?.titulo).toBeUndefined();
  });

  it("identificação: rótulos em caixa alta, código e protocolo em mono, e os pares que só o PDF tem", () => {
    expect(primeiro(montar(), "rotulos").itens).toEqual([
      { rotulo: "IDENTIFICAÇÃO", valor: "CI-2609-K7F3M2", mono: true },
      { rotulo: "PROTOCOLO EM SPC BRASIL", valor: "SPC-2026-000123", mono: true },
      { rotulo: "CONSULTADO POR", valor: "NsLink Provedor" },
      { rotulo: "CRÉDITOS COBRADOS", valor: "3" },
      { rotulo: "DOCUMENTO GERADO EM", valor: "16/09/2026 às 12:00" },
    ]);
  });

  it("dados cadastrais: grade de 3 colunas, nome em destaque, Situação RF 'Regular' em verde e o resto só quando existe", () => {
    const grade = primeiro(montar(), "grade");
    expect(grade.colunas).toBe(3);
    expect(grade.campos).toEqual([
      { rotulo: "Nome", valor: "Maria da Silva", destaque: true },
      { rotulo: "CPF", valor: "007.524.777-14" },
      { rotulo: "Nascimento", valor: "12/03/1988" },
      { rotulo: "Nome da Mãe", valor: "Ana da Silva" },
      { rotulo: "Situação RF", valor: "Regular", tom: "ok" },
      { rotulo: "Endereço", valor: "Londrina/PR" },
    ]);
  });

  it("situação que não é regular sai em vermelho com o texto do SPC; óbito registrado idem", () => {
    const campos = primeiro(montar(consulta({
      result: { cadastralData: { nome: "Maria da Silva", cpfCnpj: "00752477714", situacaoRf: "SUSPENSA", obitoRegistrado: true, tipo: "PF" } },
    })), "grade").campos;
    expect(campos).toContainEqual({ rotulo: "Situação RF", valor: "SUSPENSA", tom: "perigo" });
    expect(campos).toContainEqual({ rotulo: "Óbito", valor: "Registrado", tom: "perigo", destaque: true });
    expect(campos.map(c => c.rotulo)).not.toContain("Nome da Mãe");
  });

  it("pessoa jurídica: CNPJ, Fundação, 'ATIVA' vale Regular, natureza jurídica e atividade principal", () => {
    const doc = montar(consulta({
      cpfCnpj: "02178451000149",
      result: {
        cadastralData: {
          nome: "Empresa Teste Ltda", cpfCnpj: "02178451000149", dataFundacao: "2018-01-02", situacaoRf: "ATIVA", obitoRegistrado: false, tipo: "PJ",
          endereco: "Rua Tocantins, 125, Alphaville · CEP 06455020", cidade: "Barueri", uf: "SP", telefone: "(11) 40000000",
          naturezaJuridica: "Sociedade empresária limitada", atividadePrincipal: "Provedores de acesso às redes de comunicações",
        },
      },
    }));
    expect(primeiro(doc, "faixa").titulo).toBe("Relatório SPC · CNPJ: 02.178.451/0001-49");
    expect(primeiro(doc, "grade").campos).toEqual([
      { rotulo: "Nome", valor: "Empresa Teste Ltda", destaque: true },
      { rotulo: "CNPJ", valor: "02.178.451/0001-49" },
      { rotulo: "Fundação", valor: "02/01/2018" },
      { rotulo: "Situação RF", valor: "Regular", tom: "ok" },
      { rotulo: "Endereço", valor: "Rua Tocantins, 125, Alphaville · CEP 06455020 — Barueri/SP" },
      { rotulo: "Telefone", valor: "(11) 40000000" },
      { rotulo: "Natureza jurídica", valor: "Sociedade empresária limitada" },
      { rotulo: "Atividade principal", valor: "Provedores de acesso às redes de comunicações" },
    ]);
    expect(doc.pagina?.cabecalho).toBe("Relatório SPC · CNPJ 02.178.451/0001-49 · CI-2609-K7F3M2");
  });

  it("painel: 'Score de Crédito' com o número, /1000, o selo da faixa e as linhas menores; 'Análise do Consulta ISP' com a recomendação e as duas métricas", () => {
    const doc = montar();
    expect(primeiro(doc, "painel").colunas.map(c => c.titulo)).toEqual(["Score de Crédito", "Análise do Consulta ISP"]);
    expect(painelDe(doc, "Score de Crédito")).toEqual([{
      tipo: "indicador", valor: "745", sufixo: "/1000", selo: { texto: "Risco baixo", tom: "ok" },
      linhas: ["índice SPC: B", "renda presumida: R$ 3.500,00", "limite de crédito sugerido: R$ 900,00"],
    }]);
    expect(painelDe(doc, "Análise do Consulta ISP")).toEqual([
      { tipo: "destaque", texto: "Aprovar com cautela" },
      { tipo: "metricas", itens: [{ rotulo: "Restrições", valor: "1" }, { rotulo: "Total Dívidas", valor: "R$ 350,90" }] },
    ]);
  });

  it("sem score diz que o produto não devolve, e a faixa de risco fica numa grade em vez do número", () => {
    const doc = montar(limpa({ riskLevel: "very_high", riskLabel: "Risco muito alto", recommendation: "Recusar", rendaPresumida: 3478 }));
    const t = textoDe(doc);
    expect(t.toLowerCase()).toContain("não devolve score");
    expect(dos(doc, "indicador")).toHaveLength(0);
    const [aviso, grade] = painelDe(doc, "Score de Crédito");
    expect(aviso).toMatchObject({ tipo: "aviso", tom: "info" });
    expect(grade).toEqual({ tipo: "grade", colunas: 2, campos: [
      { rotulo: "Faixa de risco", valor: "Risco muito alto", tom: "perigo", destaque: true },
      { rotulo: "Renda presumida", valor: "R$ 3.478,00" },
    ] });
    expect(painelDe(doc, "Análise do Consulta ISP")[0]).toEqual({ tipo: "destaque", texto: "Recusar" });
  });

  it("a faixa de risco colore o selo: baixo verde, médio dourado, alto e muito alto vermelho", () => {
    const selo = (riskLevel: string) => (painelDe(montar(consulta({ result: { riskLevel } })), "Score de Crédito")[0] as Bloco<"indicador">).selo?.tom;
    expect(selo("very_low")).toBe("ok");
    expect(selo("low")).toBe("ok");
    expect(selo("medium")).toBe("alerta");
    expect(selo("high")).toBe("perigo");
    expect(selo("very_high")).toBe("perigo");
  });

  it("um registro por restrição: etiqueta do tipo, credor, descrição, valor/data/gravidade à direita, borda vermelha e TODOS os detalhes na grade", () => {
    const doc = montar(consulta({ result: { restrictions: [
      {
        type: "SPC", description: "Registro de inadimplência como avalista · instituição financeira", severity: "high", creditor: "Banco Exemplo", value: "442.61",
        date: "2023-11-30", origin: "Osasco / SP", contrato: "0030100725689639", vencimento: "2023-10-27",
        detalhes: [
          { rotulo: "Credor (associado)", valor: "Banco Exemplo" }, { rotulo: "Entidade", valor: "SAO PAULO / SP" }, { rotulo: "Cidade", valor: "Osasco / SP" },
          { rotulo: "Contrato", valor: "0030100725689639" }, { rotulo: "Valor", valor: "R$ 442,61" }, { rotulo: "Vencimento", valor: "27/10/2023" },
          { rotulo: "Inclusão no SPC", valor: "30/11/2023" }, { rotulo: "Papel do consultado", valor: "AVALISTA" }, { rotulo: "Instituição financeira", valor: "sim" },
        ],
      },
      { type: "CHEQUE_LOJISTA", description: "Cheque devolvido", severity: "medium", creditor: "Supermercado Exemplo", value: "89.00", date: "2023-07-12", origin: "", detalhes: [{ rotulo: "Cheque", valor: "55-8" }] },
      { type: "CCF", description: "3 cheques sem fundo", severity: "critical", creditor: "Banco Central do Brasil", value: "0.00", date: "2023-07-24", origin: "", detalhes: [{ rotulo: "Quantidade de cheques", valor: "3" }] },
    ], totalRestrictions: 531.61 } }));
    const registros = dos(doc, "registro");
    expect(registros).toHaveLength(3);
    expect(registros[0]).toEqual({
      tipo: "registro", etiqueta: "SPC", tomEtiqueta: "perigo", titulo: "Banco Exemplo",
      subtitulo: "Registro de inadimplência como avalista · instituição financeira",
      direita: { valor: "R$ 442,61", data: "30/11/2023", chip: "Alta" },
      campos: [
        { rotulo: "Credor (associado)", valor: "Banco Exemplo" }, { rotulo: "Entidade", valor: "SAO PAULO / SP" }, { rotulo: "Cidade", valor: "Osasco / SP" },
        { rotulo: "Contrato", valor: "0030100725689639" }, { rotulo: "Valor", valor: "R$ 442,61" }, { rotulo: "Vencimento", valor: "27/10/2023" },
        { rotulo: "Inclusão no SPC", valor: "30/11/2023" }, { rotulo: "Papel do consultado", valor: "AVALISTA" }, { rotulo: "Instituição financeira", valor: "sim" },
      ],
      tomBorda: "perigo",
    });
    expect(registros[1]).toMatchObject({ etiqueta: "CHEQUE LOJISTA", tomEtiqueta: "alerta", direita: { valor: "R$ 89,00", data: "12/07/2023", chip: "Média" } });
    expect(registros[2]).toMatchObject({ etiqueta: "CCF", tomEtiqueta: "perigo", direita: { valor: "R$ 0,00", chip: "Crítica" } });
    expect(primeiro(doc, "secao").titulo).toBe("Dados Cadastrais");
    expect(dos(doc, "secao")[1]).toEqual({ tipo: "secao", titulo: "Restrições Encontradas: 3", tom: "perigo" });
    expect(primeiro(doc, "total")).toEqual({ tipo: "total", rotulo: "Total em Restrições:", valor: "R$ 531,61", tom: "perigo" });
  });

  it("restrição gravada antes do parser trazer `detalhes` cai para contrato, vencimento e origem", () => {
    const doc = montar(consulta({ result: { restrictions: [{ type: "spc", description: "Registro SPC", severity: "high", creditor: "Loja Exemplo", value: "350.90", date: "2026-05-10", origin: "SPC", contrato: "C-77", vencimento: "2026-04-10" }] } }));
    expect(primeiro(doc, "registro").campos).toEqual([
      { rotulo: "Contrato", valor: "C-77" }, { rotulo: "Vencimento", valor: "10/04/2026" }, { rotulo: "Origem", valor: "SPC" },
    ]);
  });

  it("a tela e o PDF mostram os mesmos rótulos de detalhe: o que o parser REAL devolve passa intacto para a grade do registro", () => {
    const xml = readFileSync(join(__dirname, "__fixtures__", "pf-com-restricoes.xml"), "utf8");
    const result = parseRespostaConsulta(xml, "00752477714");
    expect(result.restrictions.length).toBeGreaterThan(2);
    const doc = documentoDaConsultaSpc({ consulta: { ...consulta(), result } as SpcConsultation, provedor: { name: "NsLink Provedor" }, geradoEm: GERADO_EM });
    const registros = dos(doc, "registro");
    expect(registros).toHaveLength(result.restrictions.length);
    result.restrictions.forEach((x, i) => {
      expect(registros[i].campos, x.type).toEqual(x.detalhes);
      expect(registros[i].titulo).toBe(x.creditor);
      expect(registros[i].subtitulo).toBe(x.description);
      expect(registros[i].etiqueta).toBe(x.type.replace(/_/g, " "));
    });
    expect(primeiro(doc, "faixa").selos).toEqual([{ texto: "Com restrições", tom: "perigo" }]);
    expect(JSON.stringify(doc)).not.toContain("undefined");
  });

  it("pendências: tabela em grade com o cabeçalho da tela, os pesos de coluna da tela e o valor à direita", () => {
    const tabela = primeiro(montar(), "tabela");
    expect(tabela.estilo).toBe("grade");
    expect(tabela.cabecalho).toEqual(["Origem", "Título", "Contrato", "Data", "Valor", "Cidade", "Avalista"]);
    expect(tabela.linhas).toEqual([["Banco X", "Empréstimo", "—", "01/02/2026", "R$ 1.200,00", "—", "não"]]);
    expect(tabela.alinhar).toEqual(["esq", "esq", "esq", "esq", "dir", "esq", "esq"]);
    // Pesos fixos (os por nº de caracteres partiam "FINANCIAMENT" e a data ao meio); o renderizador impõe o piso de cada coluna.
    expect(tabela.larguras).toEqual([22, 20, 16, 11, 11, 13, 7]);
    expect(dos(montar(limpa()), "tabela")).toHaveLength(0);
  });

  it("quem consultou: linhas com associado em negrito, entidade/cidade ao lado e a data à direita; sem consultas, o aviso", () => {
    expect(primeiro(montar(), "lista").linhas).toEqual([{ principal: "Provedor Y", secundario: "Cambé / PR", direita: "01/08/2026" }]);
    const doc = montar(limpa());
    expect(dos(doc, "lista")).toHaveLength(0);
    expect(dos(doc, "aviso").find(a => /Nenhuma consulta/.test(a.texto))).toMatchObject({ texto: "Nenhuma consulta de outro associado no período.", tom: "neutro" });
  });

  it("alertas como caixas de aviso com a gravidade no texto (crítica em vermelho); bases inoperantes em caixa cinza", () => {
    const doc = montar(consulta({ result: { alerts: [
      { type: "documento", message: "Verificar documento", severity: "medium" },
      { type: "OBITO", message: "Há registro de óbito para este documento", severity: "critical" },
    ] } }));
    const avisos = dos(doc, "aviso");
    expect(avisos).toContainEqual({ tipo: "aviso", texto: "[gravidade média] Verificar documento", tom: "alerta" });
    expect(avisos).toContainEqual({ tipo: "aviso", texto: "[gravidade crítica] Há registro de óbito para este documento", tom: "perigo" });
    expect(avisos.at(-1)).toEqual({ tipo: "aviso", texto: "Bases inoperantes no momento da consulta (a ausência de registro delas não significa ausência de ocorrência): Cheque lojista.", tom: "neutro" });
    expect(dos(montar(limpa()), "secao").map(s => s.titulo)).not.toContain("Alertas Especiais");
  });

  it("a página: cabeçalho com documento e código, rodapé com a referência, a hora de geração e o protocolo, a frase LGPD no centro, numerada", () => {
    expect(montar().pagina).toEqual({
      cabecalho: "Relatório SPC · CPF 007.524.777-14 · CI-2609-K7F3M2",
      rodapeEsquerda: "Consulta ISP · relatório da consulta SPC CI-2609-K7F3M2 · gerado em 16/09/2026 às 12:00 (protocolo SPC-2026-000123)",
      rodapeCentro: "Dados pessoais de uso restrito à análise de crédito do provedor que consultou. Guarde este arquivo com o mesmo cuidado que o sistema.",
      numerar: true,
    });
  });

  it("na demonstração o título, a faixa e o rodapé avisam que é simulado; fora dela nada disso aparece", () => {
    const simulado = montar(consulta({ result: { simulado: true } }));
    expect(simulado.titulo).toContain("SIMULADO");
    // O título da faixa fica numa linha ("SIMULADO" nele a quebrava em duas); o aviso vai no selo e na marca d'água.
    expect(primeiro(simulado, "faixa").titulo).toBe("Relatório SPC · CPF: 007.524.777-14");
    expect(primeiro(simulado, "faixa").selos).toEqual([{ texto: "Com restrições", tom: "perigo" }, { texto: "SIMULADO · DADOS FICTÍCIOS", tom: "alerta" }]);
    expect(simulado.blocos.some(b => b.tipo === "rodape" && /fict[ií]cios/i.test(b.texto))).toBe(true);
    expect(simulado.avisos).toHaveLength(1);
    const real = montar();
    expect(real.titulo).not.toContain("SIMULADO");
    expect(JSON.stringify(real)).not.toMatch(/fict[ií]cios|SIMULADO/i);
    expect(MARCA_DAGUA_SIMULADO).toContain("SIMULADO");
  });

  it("consulta gravada antes do código: nada de código inventado — nem nos blocos, nem na página — e o arquivo leva o id", () => {
    const antiga = consulta({ consultaId: null });
    const doc = montar(antiga);
    expect(JSON.stringify(doc)).not.toContain("CI-");
    // Como na tela: rótulo sem valor não sai com um traço ao lado, para o operador não achar que o sistema perdeu o número.
    expect(primeiro(doc, "rotulos").itens.map(i => i.rotulo)).not.toContain("IDENTIFICAÇÃO");
    expect(doc.pagina?.cabecalho).toBe("Relatório SPC · CPF 007.524.777-14");
    expect(doc.pagina?.rodapeEsquerda).toContain("relatório da consulta SPC nº 91 ·");
    expect(nomeDoArquivoDoPdfSpc(antiga)).toBe("consulta-spc-91.pdf");
  });

  it("linha antiga com `result` parcial ou nulo não quebra e nunca imprime null/undefined", () => {
    for (const result of [null, {}, { restrictions: [{ type: "SPC" }], previousConsultations: {}, cadastralData: { tipo: "PF" } }]) {
      const doc = documentoDaConsultaSpc({ consulta: { ...consulta(), result } as SpcConsultation, provedor: { name: "" }, geradoEm: GERADO_EM });
      const t = JSON.stringify(doc);
      expect(t, JSON.stringify(result)).not.toMatch(/null|undefined/);
      expect(primeiro(doc, "faixa").titulo).toBe("Relatório SPC · CPF: 007.524.777-14");
      expect(dos(doc, "secao")[0].titulo).toBe("Dados Cadastrais");
    }
    const parcial = documentoDaConsultaSpc({ consulta: { ...consulta(), result: { restrictions: [{ type: "SPC" }] } } as SpcConsultation, provedor: { name: "" }, geradoEm: GERADO_EM });
    expect(primeiro(parcial, "registro")).toMatchObject({ etiqueta: "SPC", titulo: "—", tomEtiqueta: "neutro", direita: { valor: "R$ 0,00", data: "—", chip: "—" }, campos: [] });
    // Sem protocolo, sem créditos e sem nome do provedor: só os pares que existem, como na tela.
    expect(primeiro(parcial, "rotulos").itens.map(i => i.rotulo)).toEqual(["IDENTIFICAÇÃO", "DOCUMENTO GERADO EM"]);
  });

  it("o nome do arquivo usa o código da consulta, nunca o documento — arquivo circula", () => {
    expect(nomeDoArquivoDoPdfSpc(consulta())).toBe("consulta-spc-CI-2609-K7F3M2.pdf");
    expect(nomeDoArquivoDoPdfSpc(consulta())).not.toContain("00752477714");
  });

  it("a hora de geração e a do provedor consulente ficam no documento", () => {
    const t = textoDe(montar());
    expect(t).toContain("16/09/2026");
    expect(t).toContain("NsLink Provedor");
  });
});
