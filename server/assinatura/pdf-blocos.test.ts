/**
 * Os blocos do relatório (faixa, secao, grade, registro…) e a paginação com
 * cabeçalho/rodapé — o que o PDF da consulta SPC usa por cima do gerador da
 * confissão. Mesma técnica do pdf.test.ts: sem compressão, cada linha de texto
 * sai como <hex> WinAnsi num TJ, e cada página é um `stream … endstream`
 * próprio (fontes padrão não têm stream). Os textos dos documentos evitam os
 * caracteres em que WinAnsi e latin1 divergem (— – …): a decodificação é latin1.
 * Nenhum dado real de pessoa: CPF e nomes inventados.
 */
import { describe, expect, it } from "vitest";
import type { BlocoDoDocumento, DocumentoRenderizado } from "@shared/cobranca/confissao-modelo";
import { ESPACO_DEPOIS, gerarPdfDoDocumento, medirBloco } from "./pdf";

const hexParaTexto = (trecho: string) => Array.from(trecho.matchAll(/<([0-9a-fA-F]+)>/g)).map(m => Buffer.from(m[1], "hex").toString("latin1")).join("");
const semEspacos = (s: string) => s.replace(/\s+/g, "");
/** O texto do PDF inteiro, sem espaços (uma quebra de linha no meio da frase deixa de importar). O trailer (/ID derivado da data) fica de fora. */
function textoDoPdf(pdf: Buffer): string {
  const conteudo = pdf.toString("latin1");
  return semEspacos(hexParaTexto(conteudo.slice(0, conteudo.lastIndexOf("trailer"))));
}
/** O conteúdo cru de cada página, na ordem. */
const streamsDoPdf = (pdf: Buffer) => Array.from(pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)).map(m => m[1]);
const textoPorPagina = (pdf: Buffer) => streamsDoPdf(pdf).map(s => semEspacos(hexParaTexto(s)));
const paginasDe = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\n/g) ?? []).length;
const vezes = (texto: string, trecho: string) => texto.split(trecho).length - 1;
/** Os operadores de posição (Tm) e fonte (Tf) de um stream, na ordem em que o texto foi escrito. */
const operadoresDeTexto = (stream: string) => Array.from(stream.matchAll(/^(1 0 0 1 [-\d.]+ [-\d.]+ Tm|\/F\d+ [\d.]+ Tf)$/gm)).map(m => m[1]);
const posicoesX = (stream: string) => Array.from(stream.matchAll(/^1 0 0 1 ([-\d.]+) [-\d.]+ Tm$/gm)).map(m => Number(m[1]));
/** Uma cor de preenchimento como o pdfkit a escreve: componentes 0–1 na precisão do JS, operador `scn`. */
const preenchimento = (hex: string) => `${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).join(" ")} scn`;
/** Cada linha de texto de um stream com a posição (o `Tm` anterior), o tamanho (o `Tf` anterior) e o texto do `TJ`, na ordem de desenho. */
function linhasDeTexto(stream: string): Array<{ x: number; y: number; tamanho: number; texto: string }> {
  const linhas: Array<{ x: number; y: number; tamanho: number; texto: string }> = [];
  let x = 0, y = 0, tamanho = 0;
  for (const linha of stream.split("\n")) {
    let m: RegExpExecArray | null;
    if ((m = /^1 0 0 1 ([-\d.]+) ([-\d.]+) Tm$/.exec(linha))) { x = Number(m[1]); y = Number(m[2]); }
    else if ((m = /^\/F\d+ ([\d.]+) Tf$/.exec(linha))) tamanho = Number(m[1]);
    else if (/\] TJ$/.test(linha)) linhas.push({ x, y, tamanho, texto: hexParaTexto(linha) });
  }
  return linhas;
}
/** Os retângulos (`re`) de um stream: x, y (de cima para baixo, como o pdfkit os escreve), largura, altura. */
const retangulos = (stream: string) => Array.from(stream.matchAll(/^([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re$/gm)).map(m => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
/** O topo (de cima para baixo) de uma linha de texto: o pdfkit põe a base em `altura − y − ascendente·tamanho` (Helvetica, 718/1000). */
const topoDoTexto = (linha: { y: number; tamanho: number }) => ALTURA_A4 - linha.y - 0.718 * linha.tamanho;

const CPF_INVENTADO = "123.456.789-09";
const CODIGO = "CI-2609-TESTE1";
const MARGEM = 40;
const ALTURA_A4 = 841.89;
const LARGURA_UTIL = 515.28;
const PAGINA_UTIL = ALTURA_A4 - 2 * MARGEM;
const DIREITA = 595.28 - MARGEM;
const PAGINA: NonNullable<DocumentoRenderizado["pagina"]> = {
  cabecalho: `Relatório SPC · CPF ${CPF_INVENTADO} · ${CODIGO}`,
  rodapeEsquerda: `Consulta ISP · relatório da consulta SPC ${CODIGO} · gerado em 16/09/2026 às 13:40`,
  rodapeCentro: "Dados pessoais de uso restrito à análise de crédito do provedor que consultou.",
  numerar: true,
};
const documento = (blocos: BlocoDoDocumento[], pagina?: DocumentoRenderizado["pagina"]): DocumentoRenderizado => ({ titulo: "t", avisos: [], blocos, ...(pagina ? { pagina } : {}) });

/** Um cartão de restrição com seis detalhes (duas linhas de grade); o título e o último campo levam o número. */
function registro(i: number): BlocoDoDocumento {
  const n = String(i).padStart(2, "0");
  return {
    tipo: "registro", etiqueta: "SPC", tomEtiqueta: "perigo", titulo: `Credor ${n}`, subtitulo: "Registro de inadimplência",
    direita: { valor: "R$ 210,00", data: "03/07/2025", chip: "Alta" },
    campos: [
      { rotulo: "Credor (associado)", valor: `Comércio ${n} Ltda` }, { rotulo: "Entidade", valor: "CDL Exemplo" }, { rotulo: "Cidade", valor: "Londrina" },
      { rotulo: "Contrato", valor: `CT-${n}` }, { rotulo: "Vencimento", valor: "10/06/2025" }, { rotulo: "Fim", valor: `FIM-${n}` },
    ],
  };
}
/** Um cartão como os da fixture do SPC: onze detalhes (quatro linhas de grade), valores compridos. Tudo inventado. */
function registroCompleto(i: number): BlocoDoDocumento {
  const n = String(i).padStart(2, "0");
  return {
    tipo: "registro", etiqueta: "SPC", tomEtiqueta: "perigo", titulo: `SUPERMERCADO EXEMPLO ${n} DE ALIMENTOS LTDA`, subtitulo: "Registro de inadimplência · instituição financeira",
    direita: { valor: "R$ 442,61", data: "15/06/2024", chip: "Alta" },
    campos: [
      { rotulo: "Credor (associado)", valor: `SUPERMERCADO EXEMPLO ${n} DE ALIMENTOS LTDA` }, { rotulo: "Entidade", valor: "CDL EXEMPLO - LONDRINA / PR" }, { rotulo: "Cidade", valor: "LONDRINA / PR" },
      { rotulo: "Telefone do credor", valor: "(43) 33330000" }, { rotulo: "Contrato", valor: "90020186/2460" }, { rotulo: "Valor", valor: "R$ 442,61" },
      { rotulo: "Vencimento", valor: "27/05/2023" }, { rotulo: "Inclusão no SPC", valor: "15/06/2024" }, { rotulo: "Papel do consultado", valor: "COMPRADOR" },
      { rotulo: "Instituição financeira", valor: "não" }, { rotulo: "Código da entidade", valor: `FIM-${n}` },
    ],
  };
}
function painel(i: number): BlocoDoDocumento {
  const n = String(i).padStart(2, "0");
  return {
    tipo: "painel", colunas: [
      { titulo: `Painel ${n}`, blocos: [{ tipo: "indicador", valor: "745", sufixo: "/1000", selo: { texto: "Risco baixo", tom: "ok" }, linhas: ["índice SPC: B", "renda presumida: R$ 3.500,00"] }] },
      { titulo: "Análise", blocos: [{ tipo: "destaque", texto: "Aprovar com cautela", tom: "alerta" }, { tipo: "metricas", itens: [{ rotulo: "Restrições", valor: "5" }, { rotulo: "Total", valor: "R$ 1.234,56", tom: "perigo" }] }, { tipo: "paragrafo", texto: `FIM-P${n}` }] },
    ],
  };
}
const ROTULOS_DA_CONSULTA: BlocoDoDocumento = { tipo: "rotulos", itens: [{ rotulo: "Identificação", valor: CODIGO, mono: true }, { rotulo: "Protocolo em SPC Brasil", valor: "SPC-2026-000123", mono: true }, { rotulo: "Consultado por", valor: "Provedor Exemplo" }, { rotulo: "Créditos cobrados", valor: "3" }, { rotulo: "Documento gerado em", valor: "16/09/2026 às 13:40" }] };
const TABELA_DE_PENDENCIAS: BlocoDoDocumento = {
  tipo: "tabela", cabecalho: ["Origem", "Título", "Contrato", "Data", "Valor", "Cidade", "Avalista"], estilo: "grade", alinhar: ["esq", "esq", "esq", "esq", "dir", "esq", "esq"],
  // Os pesos por nº de caracteres que partiam "FINANCIAMENT" e a data ao meio na amostra (16/09/2026).
  larguras: [24, 12, 16, 10, 9, 24, 8],
  linhas: [
    ["FINANCEIRA DE TESTE S/A CRÉDITO, FINANCIAMENTO E INVESTIMENTO", "FINANCIAMENT", "0030100725689639", "27/01/2024", "R$ 442,61", "SAO JOSE DOS CAMPOS / SP", "não"],
    ["BANCO EXEMPLO S/A", "OUTRAS OPER", "90020186/2460", "27/10/2023", "R$ 39,90", "CURITIBA / PR", "sim"],
  ],
};

/** O relatório de uma consulta com N restrições, como `spc-pdf.ts` o monta (os mesmos blocos, na mesma ordem), com dados inventados. */
function relatorioDaConsulta(restricoes: number): BlocoDoDocumento[] {
  return [
    { tipo: "faixa", titulo: `Relatório SPC · CPF: ${CPF_INVENTADO}`, subtitulo: "SPC Brasil · 16/09/2026 às 10:49", selos: [{ texto: "Com restrições", tom: "perigo" }] },
    ROTULOS_DA_CONSULTA,
    { tipo: "secao", titulo: "Dados Cadastrais" },
    { tipo: "grade", colunas: 3, campos: [{ rotulo: "Nome", valor: "FULANA DE TAL EXEMPLO", destaque: true }, { rotulo: "CPF", valor: CPF_INVENTADO }, { rotulo: "Nascimento", valor: "12/03/1988" }, { rotulo: "Nome da Mãe", valor: "SICRANA DE TAL EXEMPLO" }, { rotulo: "Situação RF", valor: "Regular", tom: "ok" }, { rotulo: "Endereço", valor: "RUA EXEMPLO, 100, CENTRO · CEP 86000000 — LONDRINA/PR" }, { rotulo: "Telefone", valor: "(43) 33330000" }] },
    { tipo: "painel", colunas: [
      { titulo: "Score de Crédito", blocos: [{ tipo: "indicador", valor: "0", sufixo: "/1000", selo: { texto: "Risco muito alto", tom: "perigo" }, linhas: ["índice SPC: ALTO", "renda presumida: R$ 3.478,00", "limite de crédito sugerido: R$ 125,00"] }] },
      { titulo: "Análise do Consulta ISP", blocos: [{ tipo: "destaque", texto: "Recusar" }, { tipo: "metricas", itens: [{ rotulo: "Restrições", valor: String(restricoes) }, { rotulo: "Total Dívidas", valor: "R$ 2.655,66" }] }] },
    ] },
    { tipo: "secao", titulo: `Restrições Encontradas: ${restricoes}`, tom: "perigo" },
    ...Array.from({ length: restricoes }, (_, i) => registroCompleto(i + 1)),
    { tipo: "total", rotulo: "Total em Restrições:", valor: "R$ 2.655,66", tom: "perigo" },
    { tipo: "secao", titulo: "Pendências financeiras, outras fontes (2)" },
    TABELA_DE_PENDENCIAS,
    { tipo: "secao", titulo: "Quem consultou este documento (últimos 90 dias): 2" },
    { tipo: "lista", linhas: [{ principal: "PROVEDOR EXEMPLO TELECOM LTDA", secundario: "Associação Comercial de Londrina · LONDRINA / PR", direita: "01/08/2026" }, { principal: "BANCO EXEMPLO S/A", secundario: "CDL Exemplo · CAMBÉ / PR", direita: "03/08/2026" }] },
    { tipo: "secao", titulo: "Alertas Especiais", tom: "alerta" },
    { tipo: "aviso", texto: "[gravidade crítica] Há registro de óbito para este documento", tom: "perigo" },
    { tipo: "aviso", texto: "Bases inoperantes no momento da consulta (a ausência de registro delas não significa ausência de ocorrência): CHEQUE ONLINE SRS.", tom: "neutro" },
  ];
}

/** Um de cada bloco novo, na ordem da tela — mais um `rodape` antigo no fim, como o documento simulado. */
const TODOS_OS_BLOCOS: BlocoDoDocumento[] = [
  { tipo: "faixa", titulo: `Relatório SPC · CPF: ${CPF_INVENTADO}`, subtitulo: "SPC Brasil · 16/09/2026, 10:49", selos: [{ texto: "Com restrições", tom: "perigo" }, { texto: "SIMULADO · DADOS FICTÍCIOS", tom: "alerta" }] },
  ROTULOS_DA_CONSULTA,
  { tipo: "secao", titulo: "Dados Cadastrais" },
  { tipo: "grade", campos: [{ rotulo: "Nome", valor: "Fulana de Tal Exemplo", destaque: true }, { rotulo: "CPF", valor: CPF_INVENTADO }, { rotulo: "Nascimento", valor: "12/03/1988" }, { rotulo: "Situação RF", valor: "Regular", tom: "ok" }, { rotulo: "Óbito", valor: "Registrado", tom: "perigo" }, { rotulo: "Endereço", valor: "Rua Exemplo, 100, Londrina/PR" }] },
  painel(1),
  { tipo: "secao", titulo: "Restrições Encontradas: 1", tom: "perigo" },
  { tipo: "registro", etiqueta: "CHEQUE LOJISTA", tomEtiqueta: "alerta", titulo: "Loja Exemplo Ltda", subtitulo: "Registro de inadimplência · instituição financeira", direita: { valor: "R$ 210,00", data: "03/07/2025", chip: "Média" }, campos: [{ rotulo: "Credor (associado)", valor: "Loja Exemplo Ltda" }, { rotulo: "Cidade", valor: "Londrina" }, { rotulo: "Contrato", valor: "C-77" }, { rotulo: "Inclusão no SPC", valor: "03/07/2025" }] },
  { tipo: "total", rotulo: "Total em Restrições:", valor: "R$ 1.234,56", tom: "perigo" },
  { tipo: "secao", titulo: "Pendências financeiras, outras fontes (1)" },
  { tipo: "tabela", cabecalho: ["Origem", "Título", "Contrato", "Data", "Valor", "Cidade", "Avalista"], linhas: [["Banco Exemplo", "Empréstimo", "CT-1", "01/02/2026", "R$ 1.200,00", "Cambé", "não"]], larguras: [2, 2, 1.4, 1.2, 1.4, 1.6, 1], alinhar: ["esq", "esq", "esq", "esq", "dir", "esq", "esq"], estilo: "grade" },
  { tipo: "secao", titulo: "Quem consultou este documento (últimos 90 dias): 2" },
  { tipo: "lista", linhas: [{ principal: "Provedor Y", secundario: "Cambé/PR", direita: "01/08/2026" }, { principal: "Provedor Z", direita: "03/08/2026" }] },
  { tipo: "aviso", titulo: "Alertas especiais", texto: "[gravidade alta] Verificar documento", tom: "alerta" },
  { tipo: "aviso", texto: "Bases inoperantes no momento da consulta: Cheque lojista.", tom: "neutro" },
  { tipo: "espaco", altura: 20 },
  { tipo: "rodape", texto: "DEMONSTRAÇÃO: dados fictícios gerados para o teste." },
];

describe("blocos do relatório", () => {
  it("(a) cada bloco novo sai com o seu texto, só nas fontes padrão e com a paleta da tela", async () => {
    const pdf = await gerarPdfDoDocumento(documento(TODOS_OS_BLOCOS, PAGINA));
    const texto = textoDoPdf(pdf);
    for (const esperado of [
      `Relatório SPC · CPF: ${CPF_INVENTADO}`, "SPC Brasil · 16/09/2026, 10:49", "Com restrições", "SIMULADO · DADOS FICTÍCIOS",
      "IDENTIFICAÇÃO", CODIGO, "PROTOCOLO EM SPC BRASIL", "SPC-2026-000123", "CONSULTADO POR", "Provedor Exemplo", "16/09/2026 às 13:40",
      "Dados Cadastrais", "Nome", "Fulana de Tal Exemplo", "Situação RF", "Regular", "Registrado", "Rua Exemplo, 100, Londrina/PR",
      "Painel 01", "745", "/1000", "Risco baixo", "índice SPC: B", "renda presumida: R$ 3.500,00", "Análise", "Aprovar com cautela", "Restrições", "5", "Total", "R$ 1.234,56", "FIM-P01",
      "Restrições Encontradas: 1", "CHEQUE LOJISTA", "Loja Exemplo Ltda", "Registro de inadimplência · instituição financeira", "R$ 210,00", "03/07/2025", "Média",
      "Detalhes do registro", "Credor (associado)", "Cidade", "Londrina", "Contrato", "C-77", "Inclusão no SPC",
      "Total em Restrições:", "Pendências financeiras, outras fontes (1)", "Origem", "Título", "Avalista", "Banco Exemplo", "Empréstimo", "R$ 1.200,00", "Cambé", "não",
      "Quem consultou este documento (últimos 90 dias): 2", "Provedor Y", "Cambé/PR", "01/08/2026", "Provedor Z", "03/08/2026",
      "Alertas especiais", "[gravidade alta] Verificar documento", "Bases inoperantes no momento da consulta: Cheque lojista.",
      "DEMONSTRAÇÃO: dados fictícios gerados para o teste.",
    ]) expect(texto, esperado).toContain(semEspacos(esperado));
    const bruto = pdf.toString("latin1");
    expect(bruto).toContain("/BaseFont /Helvetica-Bold");
    expect(bruto).toContain("/BaseFont /Courier");
    expect(bruto).not.toMatch(/\/BaseFont \/(?!Helvetica|Courier)/);
    // A paleta da tela: faixa azul-escura, filete amarelo, cabeçalho de tabela suave, fundos de perigo/alerta, zebra.
    for (const cor of ["#102b78", "#ffdb35", "#edf3ff", "#fdf2f2", "#fef9e7", "#f6f7f9"]) expect(bruto, cor).toContain(preenchimento(cor));
    // 40 pt é só da marca d'água (um teste conta " 40 Tf" = páginas).
    expect(bruto).not.toContain(" 40 Tf");
  });

  it("(b) com pagina.numerar, 'página n de N' sai uma vez por página, o rodapé em todas e o cabeçalho a partir da segunda", async () => {
    const pdf = await gerarPdfDoDocumento(documento([{ tipo: "secao", titulo: "Restrições Encontradas: 30", tom: "perigo" }, ...Array.from({ length: 30 }, (_, i) => registro(i + 1))], PAGINA));
    const n = paginasDe(pdf);
    expect(n).toBeGreaterThan(2);
    const paginas = textoPorPagina(pdf);
    expect(paginas).toHaveLength(n);
    const texto = textoDoPdf(pdf);
    for (let i = 1; i <= n; i++) expect(vezes(texto, `página${i}de${n}`), `página ${i} de ${n}`).toBe(1);
    expect(vezes(texto, semEspacos(PAGINA.cabecalho!))).toBe(n - 1);
    expect(vezes(texto, semEspacos(PAGINA.rodapeEsquerda!))).toBe(n);
    expect(vezes(texto, semEspacos(PAGINA.rodapeCentro!))).toBe(n);
    paginas.forEach((p, i) => {
      expect(p.includes(semEspacos(PAGINA.cabecalho!)), `cabeçalho na página ${i + 1}`).toBe(i > 0);
      expect(p, `numeração na página ${i + 1}`).toContain(`página${i + 1}de${n}`);
      expect(p, `rodapé na página ${i + 1}`).toContain(semEspacos(PAGINA.rodapeCentro!));
    });
  });

  it("(c) um cartão que não cabe no fim da página vai INTEIRO para a seguinte: título e último campo no mesmo stream", async () => {
    // 30 cartões de altura fixa que não divide a página: sem a medição prévia, algum ficaria partido.
    const pdf = await gerarPdfDoDocumento(documento(Array.from({ length: 30 }, (_, i) => registro(i + 1)), PAGINA));
    const paginas = textoPorPagina(pdf);
    expect(paginas.length).toBeGreaterThan(1);
    for (let i = 1; i <= 30; i++) {
      const n = String(i).padStart(2, "0");
      const doTitulo = paginas.filter(p => p.includes(`Credor${n}`));
      expect(doTitulo, `título ${n} numa só página`).toHaveLength(1);
      expect(doTitulo[0], `último campo ${n} junto do título`).toContain(`FIM-${n}`);
      expect(paginas.filter(p => p.includes(`FIM-${n}`)), `último campo ${n} numa só página`).toHaveLength(1);
    }
    // Cartão de ~110 pt mais 8 de espaço: seis por página, cinco páginas. Espaço em dobro entre blocos (o `text()` do
    // pdfkit avança `pdf.y` sozinho, e a altura medida era somada por cima) dava o dobro de páginas — visto na amostra.
    expect(paginas.length).toBeLessThanOrEqual(6);
    // O painel (duas colunas) é atômico do mesmo jeito.
    const paineis = textoPorPagina(await gerarPdfDoDocumento(documento(Array.from({ length: 14 }, (_, i) => painel(i + 1)), PAGINA)));
    expect(paineis.length).toBeGreaterThan(1);
    for (let i = 1; i <= 14; i++) {
      const n = String(i).padStart(2, "0");
      const doTitulo = paineis.filter(p => p.includes(`Painel${n}`));
      expect(doTitulo, `painel ${n} numa só página`).toHaveLength(1);
      expect(doTitulo[0], `fim do painel ${n} junto do título`).toContain(`FIM-P${n}`);
    }
  });

  it("os blocos encostam: entre dois títulos de seção vai a altura de um mais o espaço, não o dobro", async () => {
    const pdf = await gerarPdfDoDocumento(documento([{ tipo: "secao", titulo: "Primeira" }, { tipo: "secao", titulo: "Segunda" }], PAGINA));
    const [yPrimeira, ySegunda] = Array.from(streamsDoPdf(pdf)[0].matchAll(/^1 0 0 1 [-\d.]+ ([-\d.]+) Tm$/gm)).map(m => Number(m[1]));
    // Título de 11,5 pt (13,3 de linha) + 7 da seção + 6 de espaço ≈ 26 pt; o y do PDF cresce para cima.
    expect(yPrimeira - ySegunda).toBeGreaterThan(20);
    expect(yPrimeira - ySegunda).toBeLessThan(32);
  });

  it("texto medido 'justo' não quebra por causa do kerning: principal da lista e valor de rótulo saem numa linha só", async () => {
    // `widthOfString("Provedor Y Telecom")` é menor que a soma das palavras (kerning em volta do Y); o quebrador do pdfkit
    // mede palavra a palavra, e uma caixa do tamanho do texto inteiro partia a linha (visto na amostra em 16/09/2026).
    const pdf = await gerarPdfDoDocumento(documento([
      { tipo: "rotulos", itens: [{ rotulo: "Consultado por", valor: "Provedor Y Telecom" }] },
      { tipo: "lista", linhas: [{ principal: "Provedor Y Telecom", secundario: "Cambé/PR", direita: "01/08/2026" }] },
      { tipo: "faixa", titulo: "Faixa", selos: [{ texto: "Provedor Y Telecom", tom: "ok" }] },
    ], PAGINA));
    // Cada linha escrita é um array `[…] TJ` (com kerning, vários <hex> dentro do mesmo array).
    const linhas = Array.from(streamsDoPdf(pdf)[0].matchAll(/\[([^\]]*)\] TJ/g)).map(m => hexParaTexto(m[1]));
    expect(linhas.filter(t => t === "Provedor Y Telecom")).toHaveLength(3);
  });

  it("(d) tabela estilo grade longa repete o cabeçalho em cada página; larguras proporcionais e coluna alinhada à direita", async () => {
    const pdf = await gerarPdfDoDocumento(documento([{
      tipo: "tabela", cabecalho: ["COLUNA-A", "COLUNA-B", "COLUNA-C"], larguras: [1, 3, 1], alinhar: ["esq", "esq", "dir"], estilo: "grade",
      linhas: Array.from({ length: 150 }, (_, i) => [`L${i}`, `Descrição da linha ${i}`, `R$ ${i},00`]),
    }], PAGINA));
    const paginas = textoPorPagina(pdf);
    expect(paginas.length).toBeGreaterThan(2);
    paginas.forEach((p, i) => expect(p, `cabeçalho na página ${i + 1}`).toContain("COLUNA-ACOLUNA-BCOLUNA-C"));
    expect(textoDoPdf(pdf)).toContain("Descriçãodalinha149");
    // Pesos 1:3:1 da largura útil 515,28: colunas em 40 e 143,06 (+4 de recheio); a da direita acaba em 555,28.
    const [xA, xB, xC] = posicoesX(streamsDoPdf(pdf)[0]);
    expect(xA).toBeCloseTo(MARGEM + 4, 1);
    expect(xB).toBeCloseTo(MARGEM + 515.28 / 5 + 4, 1);
    expect(xC).toBeGreaterThan(MARGEM + (515.28 / 5) * 4 + 4);
    expect(xC).toBeLessThan(DIREITA - 4);
  });

  it("(e) documento SEM `pagina` não ganha rodapé, cabeçalho nem numeração — e a tabela sem opções é a de hoje, posição por posição", async () => {
    const pdf = await gerarPdfDoDocumento(documento(TODOS_OS_BLOCOS));
    const texto = textoDoPdf(pdf);
    expect(texto).toContain("FulanadeTalExemplo");
    expect(texto).not.toContain("página");
    expect(texto).not.toContain(semEspacos(PAGINA.rodapeCentro!));
    // Medido em 16/09/2026 ANTES desta fatia: margem 56, três colunas iguais, cabeçalho em negrito (F2), 10 pt.
    const simples = await gerarPdfDoDocumento(documento([{ tipo: "tabela", cabecalho: ["a", "b", "c"], linhas: [["1", "2", "3"], ["x", "y", "z"]] }]));
    expect(paginasDe(simples)).toBe(1);
    expect(operadoresDeTexto(streamsDoPdf(simples)[0])).toEqual([
      "1 0 0 1 56 778.71 Tm", "/F2 10 Tf", "1 0 0 1 217.093333 778.71 Tm", "/F2 10 Tf", "1 0 0 1 378.186667 778.71 Tm", "/F2 10 Tf",
      "1 0 0 1 56 762.81 Tm", "/F1 10 Tf", "1 0 0 1 217.093333 762.81 Tm", "/F1 10 Tf", "1 0 0 1 378.186667 762.81 Tm", "/F1 10 Tf",
      "1 0 0 1 56 747.25 Tm", "/F1 10 Tf", "1 0 0 1 217.093333 747.25 Tm", "/F1 10 Tf", "1 0 0 1 378.186667 747.25 Tm", "/F1 10 Tf",
    ]);
  });

  it("(f) com marca d'água: ' 40 Tf' uma vez por página, por baixo do conteúdo, e paginação e numeração iguais às sem marca", async () => {
    const doc = documento(Array.from({ length: 30 }, (_, i) => registro(i + 1)), PAGINA);
    const [com, sem] = await Promise.all([gerarPdfDoDocumento(doc, { marcaDagua: "MARCA-XYZ" }), gerarPdfDoDocumento(doc)]);
    const n = paginasDe(sem);
    expect(n).toBeGreaterThan(1);
    expect(paginasDe(com)).toBe(n);
    expect(vezes(com.toString("latin1"), " 40 Tf")).toBe(n);
    expect(vezes(textoDoPdf(com), "MARCA-XYZ")).toBe(n);
    expect(textoDoPdf(sem)).not.toContain("MARCA-XYZ");
    for (let i = 1; i <= n; i++) expect(vezes(textoDoPdf(com), `página${i}de${n}`), `página ${i}`).toBe(1);
    // Por baixo: em cada página o primeiro texto escrito é a marca.
    for (const s of streamsDoPdf(com)) expect(/\/F\d+ ([\d.]+) Tf/.exec(s)?.[1]).toBe("40");
    // E o corpo é o mesmo: tirando a marca, o texto das duas versões coincide.
    expect(textoDoPdf(com).replaceAll("MARCA-XYZ", "")).toBe(textoDoPdf(sem));
    // A marca real é mais larga que a página (627 pt a 40 pt): mesmo assim sai numa linha só, um texto de 40 pt por página — com
    // `width` o pdfkit a quebrava em duas ("SIMULADO — DADOS " / "FICTÍCIOS"), dois " 40 Tf" por página (visto em 16/09/2026).
    const marcaComprida = "SIMULADO · DADOS FICTÍCIOS · TESTE DE MARCA";
    const comprida = await gerarPdfDoDocumento(doc, { marcaDagua: marcaComprida });
    expect(paginasDe(comprida)).toBe(n);
    expect(vezes(comprida.toString("latin1"), " 40 Tf")).toBe(n);
    for (const s of streamsDoPdf(comprida)) {
      const [primeira] = linhasDeTexto(s);
      expect(primeira).toMatchObject({ tamanho: 40, texto: marcaComprida });
    }
  });

  it("(h)(i) o relatório de uma consulta com 6 restrições sai em no máximo 3 páginas, e em nenhuma página há mais de 40 pt sem texto entre dois textos", async () => {
    const pdf = await gerarPdfDoDocumento(documento(relatorioDaConsulta(6), PAGINA));
    const paginas = streamsDoPdf(pdf);
    expect(paginas.length).toBeLessThanOrEqual(3);
    expect(textoDoPdf(pdf)).toContain("FIM-06");
    // A folga é medida entre textos vizinhos NA VERTICAL (ordenados por y), da base do de cima ao topo do de baixo — o que o olho vê
    // como branco; na ordem de desenho a coluna direita de um painel "salta" para o bloco seguinte e inflaria a medida. O rodapé e o
    // cabeçalho de página (fora da área útil) e a sobra no pé da página (um cartão inteiro foi para a seguinte) ficam de fora.
    for (const [i, s] of paginas.entries()) {
      const conteudo = linhasDeTexto(s).filter(l => l.y > MARGEM - 2 && l.y < ALTURA_A4 - MARGEM + 2).sort((a, b) => b.y - a.y);
      expect(conteudo.length).toBeGreaterThan(5);
      for (let k = 1; k < conteudo.length; k++) {
        const folga = (conteudo[k - 1].y - 0.22 * conteudo[k - 1].tamanho) - (conteudo[k].y + 0.72 * conteudo[k].tamanho);
        expect(folga, `página ${i + 1}: de "${conteudo[k - 1].texto}" para "${conteudo[k].texto}"`).toBeLessThanOrEqual(40);
      }
    }
  });

  it("(j) a altura medida é a desenhada: o bloco seguinte começa em y0 + medirBloco + o espaço do bloco, e a caixa desenhada tem a altura medida", async () => {
    const atomicos: BlocoDoDocumento[] = [
      TODOS_OS_BLOCOS[0], ROTULOS_DA_CONSULTA, painel(1), registro(1), registroCompleto(1),
      { tipo: "indicador", valor: "745", sufixo: "/1000", selo: { texto: "Risco baixo", tom: "ok" }, linhas: ["índice SPC: B"] },
      { tipo: "destaque", texto: "Aprovar com cautela", tom: "alerta" },
      { tipo: "metricas", itens: [{ rotulo: "Restrições", valor: "5" }, { rotulo: "Total", valor: "R$ 1.234,56", tom: "perigo" }] },
      { tipo: "total", rotulo: "Total em Restrições:", valor: "R$ 1.234,56", tom: "perigo" },
      { tipo: "aviso", titulo: "Alertas especiais", texto: "[gravidade alta] Verificar documento. ".repeat(6), tom: "alerta" },
    ];
    for (const bloco of atomicos) {
      const medida = medirBloco(bloco, LARGURA_UTIL);
      expect(medida, bloco.tipo).toBeGreaterThan(10);
      const pdf = await gerarPdfDoDocumento(documento([bloco, { tipo: "secao", titulo: "MARCA-SEGUINTE" }], PAGINA));
      const [stream] = streamsDoPdf(pdf);
      const seguinte = linhasDeTexto(stream).find(l => l.texto === "MARCA-SEGUINTE")!;
      const espaco = ESPACO_DEPOIS[bloco.tipo as keyof typeof ESPACO_DEPOIS];
      expect(espaco, `espaço depois de ${bloco.tipo}`).toBeGreaterThan(0);
      expect(Math.abs(topoDoTexto(seguinte) - (MARGEM + medida + espaco)), `cursor depois de ${bloco.tipo}`).toBeLessThanOrEqual(0.5);
      // Faixa e registro desenham um retângulo da largura útil: a altura dele é a medida.
      if (bloco.tipo === "faixa" || bloco.tipo === "registro") {
        const caixa = retangulos(stream).find(r => Math.abs(r.w - LARGURA_UTIL) < 0.01 && Math.abs(r.x - MARGEM) < 0.01)!;
        expect(caixa, `caixa de ${bloco.tipo}`).toBeDefined();
        expect(caixa.y).toBeCloseTo(MARGEM, 1);
        expect(caixa.h).toBeCloseTo(medida, 1);
      }
    }
  });

  it("um título de seção nunca fica sozinho no pé da página: vai junto do cartão que o segue, e só quebra quando precisa", async () => {
    const cartao = registroCompleto(1);
    const alturaDoCartao = medirBloco(cartao, LARGURA_UTIL);
    expect(alturaDoCartao).toBeGreaterThan(150);
    // Sobra entre a altura mínima (70) e a do cartão: com keep-with-next só do título, "Restrições Encontradas" ficava na p1 e o cartão ia para a p2.
    for (const sobra of [61, 70, 100, 150, alturaDoCartao - 1, alturaDoCartao + 20]) {
      const pdf = await gerarPdfDoDocumento(documento([{ tipo: "espaco", altura: PAGINA_UTIL - sobra }, { tipo: "secao", titulo: "Restrições Encontradas: 1", tom: "perigo" }, cartao], PAGINA));
      const paginas = textoPorPagina(pdf);
      const daSecao = paginas.findIndex(p => p.includes("RestriçõesEncontradas:1"));
      const doCartao = paginas.findIndex(p => p.includes("SUPERMERCADOEXEMPLO01"));
      expect(doCartao, `sobra de ${sobra} pt`).toBe(daSecao);
      expect(daSecao, `sobra de ${sobra} pt`).toBe(sobra > alturaDoCartao + 30 ? 0 : 1);
    }
    // Sem bloco seguinte, ou com um que pagina linha a linha, o título ainda pede 70 pt.
    const soTitulo = await gerarPdfDoDocumento(documento([{ tipo: "espaco", altura: PAGINA_UTIL - 60 }, { tipo: "secao", titulo: "Alertas Especiais" }], PAGINA));
    expect(textoPorPagina(soTitulo).findIndex(p => p.includes("AlertasEspeciais"))).toBe(1);
    const comLista = await gerarPdfDoDocumento(documento([{ tipo: "espaco", altura: PAGINA_UTIL - 60 }, { tipo: "secao", titulo: "Quem consultou" }, { tipo: "lista", linhas: [{ principal: "Provedor Y", direita: "01/08/2026" }] }], PAGINA));
    expect(textoPorPagina(comLista).findIndex(p => p.includes("Quemconsultou"))).toBe(1);
  });

  it("tabela em grade: nenhuma célula parte uma palavra nem um número ao meio — a coluna sobe até a sua palavra mais larga e as outras cedem", async () => {
    const pdf = await gerarPdfDoDocumento(documento([TABELA_DE_PENDENCIAS], PAGINA));
    const celulas = linhasDeTexto(streamsDoPdf(pdf)[0]).filter(l => l.tamanho === 9 || l.tamanho === 8.5);
    const textos = celulas.map(l => l.texto);
    for (const inteiro of ["Avalista", "FINANCIAMENT", "0030100725689639", "27/01/2024", "R$ 442,61", "OUTRAS OPER", "90020186/2460", "27/10/2023", "R$ 39,90"]) expect(textos, inteiro).toContain(inteiro);
    // As colunas continuam a somar a largura útil: a primeira começa na margem (+4 de recheio), a última acaba dentro dela.
    const xs = celulas.map(l => l.x);
    expect(Math.min(...xs)).toBeCloseTo(MARGEM + 4, 1);
    expect(Math.max(...xs)).toBeLessThan(DIREITA - 4);
    // Sem coluna abaixo do piso, os pesos valem tal e qual (o teste (d) confere as posições 1:3:1).
  });

  it("cartão maior que a página quebra entre linhas da grade, cada pedaço com a sua borda, e rótulo e valor ficam na mesma página", async () => {
    const gigante: BlocoDoDocumento = { ...(registro(1) as Extract<BlocoDoDocumento, { tipo: "registro" }>), campos: Array.from({ length: 300 }, (_, i) => ({ rotulo: `Detalhe ${i + 1}`, valor: `valor ${i + 1}` })) };
    const altura = medirBloco(gigante, LARGURA_UTIL);
    expect(altura).toBeGreaterThan(PAGINA_UTIL * 2);
    const pdf = await gerarPdfDoDocumento(documento([{ tipo: "secao", titulo: "Restrições Encontradas: 1", tom: "perigo" }, gigante, { tipo: "total", rotulo: "Total em Restrições:", valor: "R$ 1,00", tom: "perigo" }], PAGINA));
    const streams = streamsDoPdf(pdf);
    // Sem a quebra por partes cada célula abaixo do pé abria uma página: 300 detalhes viravam 455 páginas (medido em 16/09/2026).
    expect(streams.length).toBeLessThanOrEqual(Math.ceil(altura / PAGINA_UTIL) + 1);
    const paginas = streams.map(s => semEspacos(hexParaTexto(s)));
    for (let i = 1; i <= 300; i++) {
      const doRotulo = paginas.findIndex(p => p.includes(`Detalhe${i}v`) || p.includes(`Detalhe${i}Detalhe`) || p.endsWith(`Detalhe${i}`) || new RegExp(`Detalhe${i}(?!\\d)`).test(p));
      const doValor = paginas.findIndex(p => new RegExp(`valor${i}(?!\\d)`).test(p));
      expect(doValor, `detalhe ${i}`).toBe(doRotulo);
    }
    expect(vezes(textoDoPdf(pdf), "TotalemRestrições:")).toBe(1);
    // Cada página do cartão tem a borda do seu pedaço: um retângulo da largura útil na margem.
    streams.forEach((s, i) => { if (paginas[i].includes("Detalhe")) expect(retangulos(s).some(r => Math.abs(r.w - LARGURA_UTIL) < 0.01 && Math.abs(r.x - MARGEM) < 0.01), `borda na página ${i + 1}`).toBe(true); });
    // Um cartão de mais de meia página que não cabe no que resta também quebra (ACHADOS 2), em vez de deixar meia página em branco.
    const grande: BlocoDoDocumento = { ...(registro(1) as Extract<BlocoDoDocumento, { tipo: "registro" }>), campos: Array.from({ length: 60 }, (_, i) => ({ rotulo: `Detalhe ${i + 1}`, valor: `valor ${i + 1}` })) };
    const alturaGrande = medirBloco(grande, LARGURA_UTIL);
    expect(alturaGrande).toBeGreaterThan(PAGINA_UTIL / 2);
    expect(alturaGrande).toBeLessThan(PAGINA_UTIL);
    const partido = textoPorPagina(await gerarPdfDoDocumento(documento([{ tipo: "espaco", altura: PAGINA_UTIL - 300 }, grande], PAGINA)));
    expect(partido).toHaveLength(2);
    expect(partido[0]).toContain("Credor01");
    expect(partido[0]).toContain("Detalhe1valor1");
    expect(partido[1]).toContain("Detalhe60valor60");
  });

  it("lista: o secundário sai ao lado do principal, na mesma base, em toda linha — comprido, quebra na coluna dele, não cai para baixo", async () => {
    const pdf = await gerarPdfDoDocumento(documento([{ tipo: "lista", linhas: [
      { principal: "ASSOCIADO DE TESTE 9 LTDA", secundario: "Associação Comercial - NOVA ESPERANCA / PR · CAMBE / PR", direita: "01/02/2024" },
      { principal: "ASSOCIADO DE TESTE 30 LTDA", secundario: "Associação Comercial - NOVA ESPERANCA / PR · NOVA ESPERANCA / PR", direita: "02/02/2024" },
      { principal: "ASSOCIADO DE TESTE 31 LTDA COMÉRCIO DE MATERIAIS ELÉTRICOS E HIDRÁULICOS", secundario: "Associação Comercial - NOVA ESPERANCA / PR · MARINGA / PR", direita: "03/02/2024" },
    ] }], PAGINA));
    const linhas = linhasDeTexto(streamsDoPdf(pdf)[0]);
    for (const n of ["9", "30", "31"]) {
      const principal = linhas.find(l => l.tamanho === 9.5 && l.texto.startsWith(`ASSOCIADO DE TESTE ${n} LTDA`))!;
      const secundario = linhas.find(l => l.tamanho === 8.5 && l.texto.startsWith("Associação Comercial") && Math.abs(l.y - principal.y) < 0.05)!;
      expect(secundario, `secundário da linha ${n} na base do principal`).toBeDefined();
      expect(secundario.x).toBeGreaterThan(principal.x + 50);
    }
  });

  it("os cinco pares de identificação da consulta cabem numa linha de rótulos", async () => {
    const pdf = await gerarPdfDoDocumento(documento([ROTULOS_DA_CONSULTA], PAGINA));
    const rotulos = linhasDeTexto(streamsDoPdf(pdf)[0]).filter(l => l.tamanho === 7.5);
    expect(rotulos.map(l => l.texto)).toEqual(["IDENTIFICAÇÃO", "PROTOCOLO EM SPC BRASIL", "CONSULTADO POR", "CRÉDITOS COBRADOS", "DOCUMENTO GERADO EM"]);
    expect(new Set(rotulos.map(l => l.y)).size).toBe(1);
  });

  it("(g) nenhum texto nem caixa sai da largura útil: todo Tm, `re`, `m` e `l` ficam entre as margens (Tm é o início de cada linha; a largura vem da caixa)", async () => {
    const docs = [
      documento(TODOS_OS_BLOCOS, PAGINA),
      documento(Array.from({ length: 12 }, (_, i) => registro(i + 1)), PAGINA),
      documento([{ tipo: "tabela", cabecalho: ["A", "B"], linhas: [["x", "y"]], larguras: [1, 4], alinhar: ["dir", "dir"], estilo: "grade" }], PAGINA),
    ];
    for (const d of docs) {
      const pdf = await gerarPdfDoDocumento(d);
      for (const s of streamsDoPdf(pdf)) {
        const xs = posicoesX(s);
        expect(xs.length).toBeGreaterThan(0);
        for (const x of xs) {
          expect(x).toBeGreaterThanOrEqual(MARGEM);
          expect(x).toBeLessThanOrEqual(DIREITA);
        }
        for (const m of s.matchAll(/^([-\d.]+) [-\d.]+ ([-\d.]+) [-\d.]+ re$/gm)) {
          expect(Number(m[1])).toBeGreaterThanOrEqual(MARGEM - 0.01);
          expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(DIREITA + 0.01);
        }
        for (const m of s.matchAll(/^([-\d.]+) [-\d.]+ [ml]$/gm)) {
          expect(Number(m[1])).toBeGreaterThanOrEqual(MARGEM - 0.01);
          expect(Number(m[1])).toBeLessThanOrEqual(DIREITA + 0.01);
        }
      }
    }
  });
});
