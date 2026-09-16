/**
 * Documento renderizado → PDF. pdfkit com as fontes padrão (Helvetica,
 * WinAnsi cobre o português), corpo 12 pt no mínimo, cláusulas em destaque
 * em negrito (CDC art. 54, §§3º e 4º). `compress: false` de propósito: o
 * texto fica legível no fluxo (o teste confere) e o tamanho de um contrato de
 * poucas páginas é irrelevante.
 *
 * Os blocos do relatório da consulta SPC (faixa, secao, grade, registro…)
 * reproduzem a tela `consulta-spc.tsx` com a paleta dela. Cada um é uma
 * função PURA de (caixa, y): com `desenhar` falso só mede, com verdadeiro
 * desenha a mesma coisa — é assim que um cartão inteiro vai para a página
 * seguinte quando não cabe no fim desta, e que um painel de colunas sabe a
 * altura antes de traçar as bordas. Os cinco blocos da confissão (titulo,
 * subtitulo, paragrafo, tabela, rodape) continuam no fluxo do pdfkit como
 * sempre: a confissão não muda.
 */
import PDFDocument from "pdfkit";
import type { BlocoDoDocumento, CampoDaGrade, DocumentoRenderizado, TomDoBloco } from "@shared/cobranca/confissao-modelo";

export const CORPO_PT = 12;
export const LIMITE_DO_PDF_BYTES = 8 * 1024 * 1024;

const MARGEM = 56;
/** O relatório (documento com `pagina`) é mais denso que o contrato: margem 40, largura útil 515,28. */
const MARGEM_DO_RELATORIO = 40;

export interface OpcoesDoPdf {
  /**
   * Texto repetido em CADA página, inclinado e em cinza claro, por baixo do
   * conteúdo — a demonstração marca o relatório da consulta SPC simulada.
   */
  marcaDagua?: string;
}

/**
 * O gerador é um só para todo documento em blocos (confissão de dívida,
 * relatório da consulta SPC): quem monta o documento não sabe de pdfkit.
 */
export function gerarPdfDoDocumento(doc: DocumentoRenderizado, opcoes: OpcoesDoPdf = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const margem = doc.pagina ? MARGEM_DO_RELATORIO : MARGEM;
    const pdf = new PDFDocument({
      size: "A4",
      margins: { top: margem, bottom: margem, left: margem, right: margem },
      compress: false,
      // Só o relatório volta às páginas no fim (cabeçalho, rodapé, "n de N"); a confissão sai como sempre.
      bufferPages: doc.pagina !== undefined,
      info: { Title: doc.titulo, Producer: "Consulta ISP", Creator: "Consulta ISP" },
    });
    const partes: Buffer[] = [];
    pdf.on("data", (c: Buffer) => partes.push(c));
    pdf.on("end", () => resolve(Buffer.concat(partes)));
    pdf.on("error", reject);
    try {
      const marca = opcoes.marcaDagua;
      if (marca) {
        marcarPagina(pdf, marca);
        pdf.on("pageAdded", () => marcarPagina(pdf, marca));
      }
      // O bloco seguinte vai junto: um título de seção precisa saber com quem tem de ficar na página.
      for (let i = 0; i < doc.blocos.length; i++) escrever(pdf, doc.blocos[i], doc.blocos[i + 1]);
      if (doc.pagina) cabecalhoERodape(pdf, doc.pagina);
      pdf.end();
    } catch (e) {
      reject(e);
    }
  });
}

export function gerarPdfDaConfissao(doc: DocumentoRenderizado): Promise<Buffer> {
  return gerarPdfDoDocumento(doc);
}

/**
 * A marca vai ANTES do conteúdo da página (fica por baixo) e devolve TUDO ao
 * lugar. `restore()` recupera cor e opacidade no fluxo do PDF, mas não a
 * posição nem a fonte e o tamanho que o pdfkit guarda em JavaScript — e é com
 * esses que ele desenha o texto seguinte. Quando a marca entra por
 * `pageAdded` no meio de um `text()` (parágrafo que quebra de página) ou
 * antes da primeira linha de tabela da página nova, sem devolvê-los o corpo
 * saía em 40 pt negrito (medido em 16/09/2026). A marca é uma linha só, sem
 * `width`: com largura o pdfkit passa pelo quebrador e ignora `lineBreak:
 * false` — "SIMULADO — DADOS FICTÍCIOS" (627 pt a 40 pt, mais que a página)
 * saía em duas linhas por página, dois textos de 40 pt (visto em 16/09/2026).
 * Centrada na mão; inclinada a 30° ela cabe no papel. A cor de preenchimento
 * também volta à que estava: o pdfkit a reaplica ao abrir página no meio de
 * um texto, e um cinza preto no lugar do `#111827` do corpo passaria batido.
 */
function marcarPagina(pdf: PDFKit.PDFDocument, texto: string): void {
  const { x, y } = pdf;
  const estado = pdf as unknown as { _font?: { name?: string }; _fontSize?: number; _fillColor?: [string, number | undefined] };
  const fonteAntes = estado._font?.name;
  const tamanhoAntes = estado._fontSize;
  const corAntes = estado._fillColor;
  const largura = pdf.page.width;
  const altura = pdf.page.height;
  pdf.save();
  pdf.rotate(-30, { origin: [largura / 2, altura / 2] });
  pdf.font("Helvetica-Bold").fontSize(40).fillColor("#9a9a9a").opacity(0.28);
  pdf.text(texto, (largura - pdf.widthOfString(texto)) / 2, altura / 2 - 20, { lineBreak: false });
  pdf.restore();
  pdf.opacity(1);
  if (corAntes) pdf.fillColor(corAntes[0], corAntes[1]);
  else pdf.fillColor("#000000");
  if (fonteAntes) pdf.font(fonteAntes);
  if (tamanhoAntes) pdf.fontSize(tamanhoAntes);
  pdf.x = x;
  pdf.y = y;
}

function escrever(pdf: PDFKit.PDFDocument, bloco: BlocoDoDocumento, seguinte?: BlocoDoDocumento): void {
  switch (bloco.tipo) {
    case "titulo":
      pdf.font("Helvetica-Bold").fontSize(16).text(bloco.texto, { align: "center" }).moveDown(1);
      return;
    case "subtitulo":
      pdf.font("Helvetica-Bold").fontSize(CORPO_PT).text(bloco.texto).moveDown(0.5);
      return;
    case "paragrafo":
      pdf.font(bloco.destaque ? "Helvetica-Bold" : "Helvetica").fontSize(CORPO_PT).text(bloco.texto, { align: "justify" }).moveDown(0.8);
      return;
    case "tabela":
      // Sem larguras/alinhamento/estilo é a tabela da confissão, tal e qual.
      if (bloco.larguras || bloco.alinhar || bloco.estilo) break;
      tabela(pdf, bloco.cabecalho, bloco.linhas);
      return;
    case "rodape":
      pdf.font("Helvetica").fontSize(9).fillColor("#444444").text(bloco.texto, { align: "center" }).fillColor("#000000").moveDown(0.3);
      return;
  }
  escreverBlocoDoRelatorio(pdf, bloco, seguinte);
}

function tabela(pdf: PDFKit.PDFDocument, cabecalho: string[], linhas: string[][]): void {
  const larguraUtil = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const larguraColuna = larguraUtil / cabecalho.length;
  const fundo = pdf.page.height - pdf.page.margins.bottom;
  const linha = (celulas: string[], negrito: boolean) => {
    pdf.font(negrito ? "Helvetica-Bold" : "Helvetica").fontSize(10);
    const altura = Math.max(...celulas.map(c => pdf.heightOfString(c || " ", { width: larguraColuna - 4 })));
    if (pdf.y + altura + 4 > fundo) pdf.addPage();
    const y = pdf.y;
    celulas.forEach((c, i) => {
      pdf.text(c || " ", pdf.page.margins.left + i * larguraColuna, y, { width: larguraColuna - 4, lineBreak: true });
    });
    pdf.x = pdf.page.margins.left;
    pdf.y = y + altura + 4;
  };
  linha(cabecalho, true);
  for (const l of linhas) linha(l, false);
  pdf.moveDown(0.8);
}

/* ── Os blocos do relatório ──────────────────────────────────────────── */

type Bloco<T extends BlocoDoDocumento["tipo"]> = Extract<BlocoDoDocumento, { tipo: T }>;
type Caixa = { x: number; largura: number };
type Estilo = { fonte: string; tamanho: number; cor: string; alinhar?: "left" | "right" | "center" };
type Cores = { fundo: string; texto: string; borda?: string };

const FONTE = { normal: "Helvetica", negrito: "Helvetica-Bold", mono: "Courier", monoNegrito: "Courier-Bold" } as const;
/** A paleta da tela (`consulta-spc.css`). */
const COR = { azulEscuro: "#102b78", azul: "#123bb6", suave: "#edf3ff", amarelo: "#ffdb35", rotulo: "#6b7280", texto: "#111827", borda: "#e5e7eb", zebra: "#f6f7f9", branco: "#ffffff", subtituloDaFaixa: "#d5e1ff" } as const;
/** Texto / fundo / borda de cada tom — os pares da tela. */
const TOM: Record<TomDoBloco, Required<Cores>> = {
  neutro: { texto: COR.rotulo, fundo: COR.zebra, borda: COR.borda },
  ok: { texto: "#15803d", fundo: "#ecfdf5", borda: "#15803d" },
  alerta: { texto: "#a16207", fundo: "#fef9e7", borda: "#a16207" },
  perigo: { texto: "#b42318", fundo: "#fdf2f2", borda: "#d96e6e" },
  info: { texto: COR.azul, fundo: COR.suave, borda: COR.azul },
};
/** A escala. Nunca 40: é o tamanho da marca d'água, e um teste conta " 40 Tf" = páginas. */
const PT = { faixaTitulo: 17, faixaSubtitulo: 9.5, secao: 11.5, rotulo: 8, kicker: 7.5, valor: 9.5, corpo: 9.5, rodape: 8, recomendacao: 15, score: 26, sufixo: 11, selo: 8, tabelaCabecalho: 8.5, tabelaLinha: 9 } as const;
/** Dentro do cartão. */
const RECHEIO = 8;
const ENTRE_SECOES = 14;
/** Quanto fica depois de cada bloco atômico (o teste (j) confere o avanço do cursor por aqui); os de fluxo (secao, grade, lista, tabela) têm o seu. */
export const ESPACO_DEPOIS = { faixa: ENTRE_SECOES, rotulos: ENTRE_SECOES, painel: ENTRE_SECOES, total: ENTRE_SECOES, indicador: 6, destaque: 6, metricas: RECHEIO, registro: RECHEIO, aviso: RECHEIO } as const;
/** Um título de seção nunca fica sozinho no pé da página: pede ao menos isto depois de si (ADENDO 1 da SPEC). */
const MINIMO_DEPOIS_DA_SECAO = 70;
/** Ascendente/tamanho da Helvetica (AFM 718/1000): alinha a base de textos de tamanhos diferentes. */
const ASCENDENTE = 0.718;

const caixaDaPagina = (pdf: PDFKit.PDFDocument): Caixa => ({ x: pdf.page.margins.left, largura: pdf.page.width - pdf.page.margins.left - pdf.page.margins.right });
const fundoDaPagina = (pdf: PDFKit.PDFDocument) => pdf.page.height - pdf.page.margins.bottom;

/**
 * Escreve um texto numa caixa — ou só o mede, quando `desenhar` é falso — e
 * devolve a altura ocupada. Toda escrita do relatório passa por aqui: largura
 * sempre explícita (o texto nunca sai das margens), fonte e cor sempre
 * explícitas (nada herda o que a marca d'água ou o bloco anterior deixou).
 */
function escreverTexto(pdf: PDFKit.PDFDocument, desenhar: boolean, texto: string, x: number, y: number, largura: number, estilo: Estilo): number {
  const conteudo = texto || " ";
  const caixa = Math.max(largura, 1);
  pdf.font(estilo.fonte).fontSize(estilo.tamanho);
  const altura = pdf.heightOfString(conteudo, { width: caixa });
  if (desenhar) pdf.fillColor(estilo.cor).text(conteudo, x, y, { width: caixa, align: estilo.alinhar ?? "left" });
  return altura;
}

/**
 * Largura de um texto numa linha só, como o quebrador do pdfkit a vê: a soma
 * das palavras (cada uma com o espaço que a segue). `widthOfString` do texto
 * inteiro aplica o kerning entre palavras e sai MENOR — uma caixa "justa" por
 * ele quebrava "Provedor Y Telecom" em duas linhas (medido em 16/09/2026).
 */
function larguraDoTexto(pdf: PDFKit.PDFDocument, texto: string, fonte: string, tamanho: number): number {
  pdf.font(fonte).fontSize(tamanho);
  return texto.split(/(?<= )/).reduce((soma, palavra) => soma + pdf.widthOfString(palavra), 0);
}

function alturaDaLinha(pdf: PDFKit.PDFDocument, fonte: string, tamanho: number): number {
  return pdf.font(fonte).fontSize(tamanho).currentLineHeight(true);
}

/** Pílula (selo, etiqueta, chip): texto pequeno em caixa arredondada. */
function medirPilula(pdf: PDFKit.PDFDocument, texto: string, fonte: string = FONTE.negrito): { largura: number; altura: number } {
  const largura = larguraDoTexto(pdf, texto, fonte, PT.selo) + 10;
  return { largura, altura: pdf.currentLineHeight(true) + 5 };
}

function pilula(pdf: PDFKit.PDFDocument, texto: string, x: number, y: number, cores: Cores, fonte: string = FONTE.negrito): void {
  const { largura, altura } = medirPilula(pdf, texto, fonte);
  pdf.roundedRect(x, y, largura, altura, 3);
  if (cores.borda) pdf.lineWidth(0.5).fillAndStroke(cores.fundo, cores.borda);
  else pdf.fill(cores.fundo);
  escreverTexto(pdf, true, texto, x + 5, y + 2.5, largura - 8, { fonte, tamanho: PT.selo, cor: cores.texto });
}

function faixa(pdf: PDFKit.PDFDocument, b: Bloco<"faixa">, caixa: Caixa, y: number, desenhar: boolean): number {
  const recheio = 14;
  const selos = b.selos ?? [];
  const medidas = selos.map(s => medirPilula(pdf, s.texto));
  const larguraSelos = medidas.length ? Math.max(...medidas.map(m => m.largura)) : 0;
  const larguraTexto = caixa.largura - recheio * 2 - (larguraSelos ? larguraSelos + 12 : 0);
  const titulo: Estilo = { fonte: FONTE.negrito, tamanho: PT.faixaTitulo, cor: COR.branco };
  const subtitulo: Estilo = { fonte: FONTE.normal, tamanho: PT.faixaSubtitulo, cor: COR.subtituloDaFaixa };
  const alturaTitulo = escreverTexto(pdf, false, b.titulo, 0, 0, larguraTexto, titulo);
  const alturaSubtitulo = b.subtitulo ? 3 + escreverTexto(pdf, false, b.subtitulo, 0, 0, larguraTexto, subtitulo) : 0;
  const alturaSelos = medidas.reduce((soma, m) => soma + m.altura + 4, -4);
  const altura = recheio * 2 + Math.max(alturaTitulo + alturaSubtitulo, alturaSelos);
  if (desenhar) {
    pdf.rect(caixa.x, y, caixa.largura, altura).fill(COR.azulEscuro);
    // O filete amarelo do canto inferior esquerdo da tela (54×4).
    pdf.rect(caixa.x + recheio, y + altura - 4, 54, 4).fill(COR.amarelo);
    escreverTexto(pdf, true, b.titulo, caixa.x + recheio, y + recheio, larguraTexto, titulo);
    if (b.subtitulo) escreverTexto(pdf, true, b.subtitulo, caixa.x + recheio, y + recheio + alturaTitulo + 3, larguraTexto, subtitulo);
    let ySelo = y + recheio;
    selos.forEach((s, i) => {
      // Sobre o fundo escuro o selo é sólido: a cor forte do tom com texto branco.
      pilula(pdf, s.texto, caixa.x + caixa.largura - recheio - medidas[i].largura, ySelo, { fundo: TOM[s.tom].texto, texto: COR.branco });
      ySelo += medidas[i].altura + 4;
    });
  }
  return altura;
}

function rotulos(pdf: PDFKit.PDFDocument, b: Bloco<"rotulos">, caixa: Caixa, y: number, desenhar: boolean): number {
  // Vão de 16 e meio ponto de folga por item: os cinco pares da consulta cabem numa linha (com 22 e +1 sobrava um para a segunda; com os 18 do ADENDO só por 1 pt).
  const calha = 16;
  let xCursor = caixa.x;
  let yLinha = y;
  let alturaLinha = 0;
  for (const item of b.itens) {
    const rotulo = item.rotulo.toUpperCase();
    const fonteValor = item.mono ? FONTE.mono : FONTE.normal;
    const largura = Math.min(caixa.largura, Math.max(larguraDoTexto(pdf, rotulo, FONTE.negrito, PT.kicker), larguraDoTexto(pdf, item.valor, fonteValor, PT.valor)) + 0.5);
    if (xCursor > caixa.x && xCursor + largura > caixa.x + caixa.largura) {
      xCursor = caixa.x;
      yLinha += alturaLinha + 8;
      alturaLinha = 0;
    }
    const alturaRotulo = escreverTexto(pdf, desenhar, rotulo, xCursor, yLinha, largura, { fonte: FONTE.negrito, tamanho: PT.kicker, cor: COR.rotulo });
    const alturaValor = escreverTexto(pdf, desenhar, item.valor, xCursor, yLinha + alturaRotulo + 1, largura, { fonte: fonteValor, tamanho: PT.valor, cor: COR.texto });
    alturaLinha = Math.max(alturaLinha, alturaRotulo + 1 + alturaValor);
    xCursor += largura + calha;
  }
  return yLinha + alturaLinha - y;
}

function secao(pdf: PDFKit.PDFDocument, b: Bloco<"secao">, caixa: Caixa, y: number, desenhar: boolean): number {
  const alturaTitulo = escreverTexto(pdf, desenhar, b.titulo, caixa.x + 9, y, caixa.largura - 9, { fonte: FONTE.negrito, tamanho: PT.secao, cor: COR.azulEscuro });
  const altura = alturaTitulo + 6;
  if (desenhar) {
    pdf.rect(caixa.x, y + 1.5, 3, alturaTitulo - 3).fill(TOM[b.tom ?? "info"].texto);
    pdf.lineWidth(0.5).strokeColor(COR.borda).moveTo(caixa.x, y + altura).lineTo(caixa.x + caixa.largura, y + altura).stroke();
  }
  return altura + 1;
}

/** Uma ou mais linhas de rótulo/valor em N colunas; quem chama decide se paginam linha a linha (fluxo) ou não (dentro de um cartão). */
function grade(pdf: PDFKit.PDFDocument, campos: CampoDaGrade[], colunas: number, caixa: Caixa, y: number, desenhar: boolean): number {
  const calha = 10;
  const larguraColuna = (caixa.largura - calha * (colunas - 1)) / colunas;
  let yLinha = y;
  for (let i = 0; i < campos.length; i += colunas) {
    let alturaLinha = 0;
    campos.slice(i, i + colunas).forEach((campo, j) => {
      const x = caixa.x + j * (larguraColuna + calha);
      const alturaRotulo = escreverTexto(pdf, desenhar, campo.rotulo, x, yLinha, larguraColuna, { fonte: FONTE.normal, tamanho: PT.rotulo, cor: COR.rotulo });
      const fonte = campo.mono ? (campo.destaque ? FONTE.monoNegrito : FONTE.mono) : campo.destaque ? FONTE.negrito : FONTE.normal;
      const alturaValor = escreverTexto(pdf, desenhar, campo.valor, x, yLinha + alturaRotulo + 1, larguraColuna, { fonte, tamanho: PT.valor, cor: campo.tom ? TOM[campo.tom].texto : COR.texto });
      alturaLinha = Math.max(alturaLinha, alturaRotulo + 1 + alturaValor);
    });
    yLinha += alturaLinha + 6;
  }
  return campos.length ? yLinha - 6 - y : 0;
}

function painel(pdf: PDFKit.PDFDocument, b: Bloco<"painel">, caixa: Caixa, y: number, desenhar: boolean): number {
  if (!b.colunas.length) return 0;
  const calha = 10;
  const larguraColuna = (caixa.largura - calha * (b.colunas.length - 1)) / b.colunas.length;
  const coluna = (i: number, pintar: boolean): number => {
    const interna: Caixa = { x: caixa.x + i * (larguraColuna + calha) + RECHEIO, largura: larguraColuna - RECHEIO * 2 };
    let yCursor = y + RECHEIO;
    yCursor += secao(pdf, { tipo: "secao", titulo: b.colunas[i].titulo }, interna, yCursor, pintar) + 6;
    for (const sub of b.colunas[i].blocos) yCursor += blocoNaCaixa(pdf, sub, interna, yCursor, pintar) + RECHEIO;
    return yCursor - y;
  };
  // Mede as colunas primeiro: as bordas têm todas a altura da mais alta.
  const altura = Math.max(...b.colunas.map((_, i) => coluna(i, false)));
  if (desenhar) {
    b.colunas.forEach((_, i) => {
      pdf.lineWidth(0.5).strokeColor(COR.borda).roundedRect(caixa.x + i * (larguraColuna + calha), y, larguraColuna, altura, 4).stroke();
      coluna(i, true);
    });
  }
  return altura;
}

function indicador(pdf: PDFKit.PDFDocument, b: Bloco<"indicador">, caixa: Caixa, y: number, desenhar: boolean): number {
  const larguraValor = Math.min(larguraDoTexto(pdf, b.valor, FONTE.negrito, PT.score) + 2, caixa.largura);
  let yCursor = y + escreverTexto(pdf, desenhar, b.valor, caixa.x, y, larguraValor, { fonte: FONTE.negrito, tamanho: PT.score, cor: COR.texto });
  if (b.sufixo && larguraValor + 4 < caixa.largura) {
    // A base do sufixo na base do número: desce a diferença das ascendentes.
    escreverTexto(pdf, desenhar, b.sufixo, caixa.x + larguraValor + 2, y + ASCENDENTE * (PT.score - PT.sufixo), caixa.largura - larguraValor - 2, { fonte: FONTE.normal, tamanho: PT.sufixo, cor: COR.rotulo });
  }
  yCursor += 4;
  if (b.selo) {
    const { altura } = medirPilula(pdf, b.selo.texto);
    if (desenhar) pilula(pdf, b.selo.texto, caixa.x, yCursor, { fundo: TOM[b.selo.tom].fundo, texto: TOM[b.selo.tom].texto });
    yCursor += altura + 4;
  }
  for (const linha of b.linhas ?? []) yCursor += escreverTexto(pdf, desenhar, linha, caixa.x, yCursor, caixa.largura, { fonte: FONTE.normal, tamanho: 8.5, cor: COR.rotulo }) + 1;
  return yCursor - y;
}

function destaque(pdf: PDFKit.PDFDocument, b: Bloco<"destaque">, caixa: Caixa, y: number, desenhar: boolean): number {
  const cor = b.tom && b.tom !== "neutro" ? TOM[b.tom].texto : COR.texto;
  return escreverTexto(pdf, desenhar, b.texto, caixa.x, y, caixa.largura, { fonte: FONTE.negrito, tamanho: PT.recomendacao, cor });
}

function metricas(pdf: PDFKit.PDFDocument, b: Bloco<"metricas">, caixa: Caixa, y: number, desenhar: boolean): number {
  if (!b.itens.length) return 0;
  const calha = 8;
  const recheio = 6;
  const larguraItem = (caixa.largura - calha * (b.itens.length - 1)) / b.itens.length;
  const conteudo = (i: number, pintar: boolean): number => {
    const item = b.itens[i];
    const x = caixa.x + i * (larguraItem + calha) + recheio;
    const largura = larguraItem - recheio * 2;
    const alturaRotulo = escreverTexto(pdf, pintar, item.rotulo, x, y + recheio, largura, { fonte: FONTE.normal, tamanho: PT.rotulo, cor: COR.rotulo });
    const cor = item.tom && item.tom !== "neutro" ? TOM[item.tom].texto : COR.texto;
    const alturaValor = escreverTexto(pdf, pintar, item.valor, x, y + recheio + alturaRotulo + 2, largura, { fonte: FONTE.negrito, tamanho: PT.sufixo, cor });
    return recheio * 2 + alturaRotulo + 2 + alturaValor;
  };
  const altura = Math.max(...b.itens.map((_, i) => conteudo(i, false)));
  if (desenhar) {
    b.itens.forEach((_, i) => {
      pdf.roundedRect(caixa.x + i * (larguraItem + calha), y, larguraItem, altura, 4).fill(COR.zebra);
      conteudo(i, true);
    });
  }
  return altura;
}

/** O alto do cartão de registro, na caixa interna: etiqueta e título na mesma linha, subtítulo em cinza; à direita valor, data e chip; e o rótulo "Detalhes do registro" (com o vão para a grade) quando há campos. */
function cabecalhoDoRegistro(pdf: PDFKit.PDFDocument, b: Bloco<"registro">, caixa: Caixa, y: number, desenhar: boolean): number {
  const larguraDireita = b.direita ? 110 : 0;
  const larguraEsquerda = caixa.largura - (larguraDireita ? larguraDireita + RECHEIO : 0);
  const etiqueta = medirPilula(pdf, b.etiqueta);
  const yTitulo = y + Math.max(0, (etiqueta.altura - alturaDaLinha(pdf, FONTE.negrito, 10)) / 2);
  const alturaTitulo = escreverTexto(pdf, desenhar, b.titulo, caixa.x + etiqueta.largura + 6, yTitulo, larguraEsquerda - etiqueta.largura - 6, { fonte: FONTE.negrito, tamanho: 10, cor: COR.texto });
  if (desenhar) pilula(pdf, b.etiqueta, caixa.x, y, { fundo: TOM[b.tomEtiqueta].fundo, texto: TOM[b.tomEtiqueta].texto });
  let yEsquerda = Math.max(y + etiqueta.altura, yTitulo + alturaTitulo) + 2;
  if (b.subtitulo) yEsquerda += escreverTexto(pdf, desenhar, b.subtitulo, caixa.x, yEsquerda, larguraEsquerda, { fonte: FONTE.normal, tamanho: 8.5, cor: COR.rotulo });
  // Direita, alinhada à direita: valor em negrito, data em cinza, chip de gravidade em mono.
  let yDireita = y;
  if (b.direita) {
    const xDireita = caixa.x + caixa.largura - larguraDireita;
    if (b.direita.valor) yDireita += escreverTexto(pdf, desenhar, b.direita.valor, xDireita, yDireita, larguraDireita, { fonte: FONTE.negrito, tamanho: 10, cor: COR.texto, alinhar: "right" }) + 1;
    if (b.direita.data) yDireita += escreverTexto(pdf, desenhar, b.direita.data, xDireita, yDireita, larguraDireita, { fonte: FONTE.normal, tamanho: 8.5, cor: COR.rotulo, alinhar: "right" }) + 3;
    if (b.direita.chip) {
      const chip = medirPilula(pdf, b.direita.chip, FONTE.mono);
      if (desenhar) pilula(pdf, b.direita.chip, xDireita + larguraDireita - chip.largura, yDireita, { fundo: COR.zebra, texto: COR.texto, borda: COR.borda }, FONTE.mono);
      yDireita += chip.altura;
    }
  }
  let yFim = Math.max(yEsquerda, yDireita);
  if (b.campos.length) {
    yFim += 6;
    yFim += escreverTexto(pdf, desenhar, "Detalhes do registro", caixa.x, yFim, caixa.largura, { fonte: FONTE.negrito, tamanho: PT.rotulo, cor: COR.azul }) + 4;
  }
  return yFim - y;
}

/**
 * As partes do cartão, de cima para baixo: o cabeçalho e cada linha da grade
 * de detalhes (3 colunas), cada uma medindo ou desenhando em (y). Inteiro,
 * o cartão é a soma delas; maior que a página, ele quebra ENTRE elas — nunca
 * no meio de uma linha. O vão entre linhas da grade é o da própria grade (6).
 */
function partesDoRegistro(pdf: PDFKit.PDFDocument, b: Bloco<"registro">, caixa: Caixa): Array<(y: number, desenhar: boolean) => number> {
  const interna: Caixa = { x: caixa.x + 3 + RECHEIO, largura: caixa.largura - 3 - RECHEIO * 2 };
  const partes = [(y: number, desenhar: boolean) => cabecalhoDoRegistro(pdf, b, interna, y, desenhar)];
  for (let i = 0; i < b.campos.length; i += 3) {
    const linha = b.campos.slice(i, i + 3);
    partes.push((y, desenhar) => grade(pdf, linha, 3, interna, y, desenhar));
  }
  return partes;
}
const vaoAntesDaParte = (i: number) => (i >= 2 ? 6 : 0);

/** Borda fina cinza em volta e a esquerda colorida (3 pt), de `y` até `y + altura`. */
function bordaDoRegistro(pdf: PDFKit.PDFDocument, b: Bloco<"registro">, caixa: Caixa, y: number, altura: number): void {
  pdf.lineWidth(0.5).strokeColor(COR.borda).rect(caixa.x, y, caixa.largura, altura).stroke();
  pdf.rect(caixa.x, y, 3, altura).fill(TOM[b.tomBorda ?? "perigo"].borda);
}

function registro(pdf: PDFKit.PDFDocument, b: Bloco<"registro">, caixa: Caixa, y: number, desenhar: boolean): number {
  let yFim = y + RECHEIO;
  partesDoRegistro(pdf, b, caixa).forEach((parte, i) => { yFim += vaoAntesDaParte(i) + parte(yFim, desenhar); });
  const altura = yFim + RECHEIO - y;
  if (desenhar) bordaDoRegistro(pdf, b, caixa, y, altura);
  return altura;
}

/**
 * O cartão que não cabe no que resta da página e é grande demais para ir
 * inteiro à seguinte (mais de meia página, ou mais que uma): sai por partes,
 * cada pedaço com a sua borda, quebrando só entre linhas da grade. O
 * cabeçalho nunca fica sozinho: só entra com a primeira linha atrás dele.
 */
function registroPorPartes(pdf: PDFKit.PDFDocument, b: Bloco<"registro">, caixa: Caixa): void {
  const partes = partesDoRegistro(pdf, b, caixa);
  const fundo = fundoDaPagina(pdf);
  let yTopo = pdf.y;
  let yFim = yTopo + RECHEIO;
  partes.forEach((parte, i) => {
    const vao = vaoAntesDaParte(i);
    const precisa = vao + parte(0, false) + (i === 0 && partes.length > 1 ? partes[1](0, false) : 0) + RECHEIO;
    // Não cabe: fecha o pedaço (se há algo nele) e segue na página seguinte — a menos que a página esteja vazia, aí desenha assim mesmo.
    if (yFim + precisa > fundo - 0.01 && yFim > pdf.page.margins.top + RECHEIO) {
      if (yFim > yTopo + RECHEIO) bordaDoRegistro(pdf, b, caixa, yTopo, yFim + RECHEIO - yTopo);
      pdf.addPage();
      yTopo = pdf.y;
      yFim = yTopo + RECHEIO;
    } else yFim += vao;
    yFim += parte(yFim, true);
  });
  bordaDoRegistro(pdf, b, caixa, yTopo, yFim + RECHEIO - yTopo);
  pdf.y = yFim + RECHEIO + ESPACO_DEPOIS.registro;
}

function total(pdf: PDFKit.PDFDocument, b: Bloco<"total">, caixa: Caixa, y: number, desenhar: boolean): number {
  const recheio = 10;
  const estilo: Estilo = { fonte: FONTE.negrito, tamanho: 10.5, cor: TOM[b.tom].texto };
  const altura = alturaDaLinha(pdf, estilo.fonte, estilo.tamanho) + recheio * 2;
  if (desenhar) {
    pdf.roundedRect(caixa.x, y, caixa.largura, altura, 4).fill(TOM[b.tom].fundo);
    const larguraValor = Math.min(caixa.largura / 2, larguraDoTexto(pdf, b.valor, estilo.fonte, estilo.tamanho) + 4);
    escreverTexto(pdf, true, b.rotulo, caixa.x + recheio, y + recheio, caixa.largura - recheio * 2 - larguraValor, estilo);
    escreverTexto(pdf, true, b.valor, caixa.x + caixa.largura - recheio - larguraValor, y + recheio, larguraValor, { ...estilo, alinhar: "right" });
  }
  return altura;
}

function linhaDaLista(pdf: PDFKit.PDFDocument, linha: Bloco<"lista">["linhas"][number], zebra: boolean, caixa: Caixa, y: number, desenhar: boolean): number {
  const recheio = 5;
  // A coluna da direita (a data) é do tamanho do texto: o resto da linha fica para o associado e a entidade.
  const larguraDireita = linha.direita ? Math.min(caixa.largura / 3, larguraDoTexto(pdf, linha.direita, FONTE.normal, 9) + 4) : 0;
  const larguraTexto = caixa.largura - recheio * 2 - (larguraDireita ? larguraDireita + 6 : 0);
  // O secundário vai SEMPRE ao lado do principal, na mesma base, como na tela — quebrando na sua coluna se for comprido; o principal fica com até 60% para a coluna dele nunca sumir.
  const larguraPrincipal = Math.min(linha.secundario ? larguraTexto * 0.6 : larguraTexto, larguraDoTexto(pdf, linha.principal, FONTE.negrito, PT.valor) + 2);
  const conteudo = (pintar: boolean): number => {
    const x = caixa.x + recheio;
    const yTexto = y + recheio;
    const alturaPrincipal = escreverTexto(pdf, pintar, linha.principal, x, yTexto, larguraPrincipal, { fonte: FONTE.negrito, tamanho: PT.valor, cor: COR.texto });
    let alturaEsquerda = alturaPrincipal;
    if (linha.secundario) {
      const alturaSecundario = escreverTexto(pdf, pintar, linha.secundario, x + larguraPrincipal + 8, yTexto + ASCENDENTE * (PT.valor - 8.5), larguraTexto - larguraPrincipal - 8, { fonte: FONTE.normal, tamanho: 8.5, cor: COR.rotulo });
      alturaEsquerda = Math.max(alturaPrincipal, ASCENDENTE * (PT.valor - 8.5) + alturaSecundario);
    }
    const alturaDireita = linha.direita ? escreverTexto(pdf, pintar, linha.direita, caixa.x + caixa.largura - recheio - larguraDireita, yTexto, larguraDireita, { fonte: FONTE.normal, tamanho: 9, cor: COR.rotulo, alinhar: "right" }) : 0;
    return Math.max(alturaEsquerda, alturaDireita) + recheio * 2;
  };
  const altura = conteudo(false);
  if (desenhar) {
    if (zebra) pdf.rect(caixa.x, y, caixa.largura, altura).fill(COR.zebra);
    conteudo(true);
  }
  return altura;
}

function aviso(pdf: PDFKit.PDFDocument, b: Bloco<"aviso">, caixa: Caixa, y: number, desenhar: boolean): number {
  const interna: Caixa = { x: caixa.x + RECHEIO, largura: caixa.largura - RECHEIO * 2 };
  const conteudo = (pintar: boolean): number => {
    let altura = 0;
    if (b.titulo) altura += escreverTexto(pdf, pintar, b.titulo, interna.x, y + RECHEIO, interna.largura, { fonte: FONTE.negrito, tamanho: 9, cor: TOM[b.tom].texto }) + 2;
    altura += escreverTexto(pdf, pintar, b.texto, interna.x, y + RECHEIO + altura, interna.largura, { fonte: FONTE.normal, tamanho: 9, cor: COR.texto });
    return altura + RECHEIO * 2;
  };
  const altura = conteudo(false);
  if (desenhar) {
    pdf.lineWidth(0.5).roundedRect(caixa.x, y, caixa.largura, altura, 4).fillAndStroke(TOM[b.tom].fundo, TOM[b.tom].borda);
    conteudo(true);
  }
  return altura;
}

/* ── Tabela com larguras, alinhamento e estilo "grade" ───────────────── */

/** A palavra mais larga de um texto (cada uma com o espaço que a segue, como o quebrador do pdfkit a mede). */
function larguraDaMaiorPalavra(pdf: PDFKit.PDFDocument, texto: string, fonte: string, tamanho: number): number {
  pdf.font(fonte).fontSize(tamanho);
  return Math.max(0, ...texto.split(/(?<= )/).map(palavra => pdf.widthOfString(palavra)));
}

/**
 * O piso de cada coluna: a unidade mais larga que ela tem de mostrar inteira,
 * mais o recheio. Com `celulaInteira`, uma célula curta (até 1/4 da caixa:
 * data, valor, contrato, título) conta inteira — "R$ 442,61" não vira
 * "R$"/"442,61"; sem, conta só a palavra mais larga (cabeçalho em negrito,
 * células no corpo), o mínimo para não partir palavra nem número ao meio.
 */
function pisosDasColunas(pdf: PDFKit.PDFDocument, b: Bloco<"tabela">, largura: number, celulaInteira: boolean): number[] {
  const emGrade = b.estilo === "grade";
  const recheio = (emGrade ? 4 : 0) + 4 + 0.5;
  const unidade = (texto: string, fonte: string, tamanho: number) => {
    const inteira = larguraDoTexto(pdf, texto, fonte, tamanho);
    return celulaInteira && inteira <= largura / 4 ? inteira : larguraDaMaiorPalavra(pdf, texto, fonte, tamanho);
  };
  return b.cabecalho.map((h, i) => Math.max(unidade(h, FONTE.negrito, emGrade ? PT.tabelaCabecalho : 10), ...b.linhas.map(l => unidade(l[i] ?? "", FONTE.normal, emGrade ? PT.tabelaLinha : 10))) + recheio);
}

/**
 * Larguras absolutas das colunas: pesos relativos normalizados à caixa
 * (iguais quando não há pesos). A coluna que ficaria mais estreita que o seu
 * piso sobe até ele, e a diferença sai das outras na proporção da folga de
 * cada uma — "FINANCIAME/NT", "27/01/202/4" e "R$"/"442,61" vistos na
 * amostra em 16/09/2026. O piso de todas é o das palavras (se nem ele cabe
 * na caixa, fica o proporcional e quebra); da coluna mais estreita para a
 * mais larga, cada uma sobe para a célula inteira enquanto isso couber com
 * as demais — data, valor e contrato antes de uma cidade comprida.
 */
function largurasDasColunas(pdf: PDFKit.PDFDocument, b: Bloco<"tabela">, largura: number): number[] {
  const pesos = b.cabecalho.map((_, i) => b.larguras?.[i] ?? 1);
  const soma = pesos.reduce((s, p) => s + p, 0) || 1;
  const proporcionais = pesos.map(p => (p / soma) * largura);
  const pisos = pisosDasColunas(pdf, b, largura, false);
  let sobra = largura - pisos.reduce((s, p) => s + p, 0);
  if (sobra < 0) return proporcionais;
  const inteiras = pisosDasColunas(pdf, b, largura, true);
  for (const i of b.cabecalho.map((_, i) => i).sort((a, c) => inteiras[a] - inteiras[c])) {
    const extra = inteiras[i] - pisos[i];
    if (extra <= sobra) { pisos[i] = inteiras[i]; sobra -= extra; }
  }
  const falta = proporcionais.reduce((s, w, i) => s + Math.max(0, pisos[i] - w), 0);
  if (falta === 0) return proporcionais;
  const folga = proporcionais.reduce((s, w, i) => s + Math.max(0, w - pisos[i]), 0);
  return proporcionais.map((w, i) => (w < pisos[i] ? pisos[i] : w - (falta * (w - pisos[i])) / folga));
}

function linhaDaTabela(pdf: PDFKit.PDFDocument, b: Bloco<"tabela">, celulas: string[], cabecalho: boolean, zebra: boolean, colunas: number[], caixa: Caixa, y: number, desenhar: boolean): number {
  const emGrade = b.estilo === "grade";
  const recheioX = emGrade ? 4 : 0;
  const recheioY = emGrade ? 3 : 0;
  const estilo: Estilo = {
    fonte: cabecalho ? FONTE.negrito : FONTE.normal,
    tamanho: emGrade ? (cabecalho ? PT.tabelaCabecalho : PT.tabelaLinha) : 10,
    cor: emGrade && cabecalho ? COR.azulEscuro : COR.texto,
  };
  const conteudo = (pintar: boolean): number => {
    let x = caixa.x;
    let alturaMaxima = 0;
    colunas.forEach((larguraColuna, i) => {
      const alinhar = b.alinhar?.[i] === "dir" ? "right" : "left";
      alturaMaxima = Math.max(alturaMaxima, escreverTexto(pdf, pintar, celulas[i] ?? "", x + recheioX, y + recheioY, larguraColuna - recheioX - 4, { ...estilo, alinhar }));
      x += larguraColuna;
    });
    return alturaMaxima + recheioY * 2 + (emGrade ? 0 : 4);
  };
  const altura = conteudo(false);
  if (desenhar) {
    if (emGrade && (cabecalho || zebra)) pdf.rect(caixa.x, y, caixa.largura, altura).fill(cabecalho ? COR.suave : COR.zebra);
    conteudo(true);
    if (emGrade) pdf.lineWidth(0.5).strokeColor(COR.borda).moveTo(caixa.x, y + altura).lineTo(caixa.x + caixa.largura, y + altura).stroke();
  }
  return altura;
}

/** No fluxo da página: linha a linha, e o cabeçalho volta no topo de cada página nova. */
function tabelaEstilizada(pdf: PDFKit.PDFDocument, b: Bloco<"tabela">): void {
  const caixa = caixaDaPagina(pdf);
  const colunas = largurasDasColunas(pdf, b, caixa.largura);
  const linha = (celulas: string[], cabecalho: boolean, zebra: boolean): void => {
    const altura = linhaDaTabela(pdf, b, celulas, cabecalho, zebra, colunas, caixa, pdf.y, false);
    if (pdf.y + altura > fundoDaPagina(pdf)) {
      pdf.addPage();
      if (!cabecalho) linha(b.cabecalho, true, false);
    }
    const y = pdf.y;
    linhaDaTabela(pdf, b, celulas, cabecalho, zebra, colunas, caixa, y, true);
    pdf.y = y + altura;
  };
  linha(b.cabecalho, true, false);
  b.linhas.forEach((l, i) => linha(l, false, i % 2 === 1));
}

/** Dentro de um cartão (coluna de painel): inteira, sem paginar. */
function tabelaNaCaixa(pdf: PDFKit.PDFDocument, b: Bloco<"tabela">, caixa: Caixa, y: number, desenhar: boolean): number {
  const colunas = largurasDasColunas(pdf, b, caixa.largura);
  let yCursor = y + linhaDaTabela(pdf, b, b.cabecalho, true, false, colunas, caixa, y, desenhar);
  b.linhas.forEach((l, i) => { yCursor += linhaDaTabela(pdf, b, l, false, i % 2 === 1, colunas, caixa, yCursor, desenhar); });
  return yCursor - y;
}

/* ── Fluxo ───────────────────────────────────────────────────────────── */

/** Qualquer bloco numa caixa, sem paginar: mede (ou desenha) e devolve a altura. É o que uma coluna de painel usa. */
function blocoNaCaixa(pdf: PDFKit.PDFDocument, bloco: BlocoDoDocumento, caixa: Caixa, y: number, desenhar: boolean): number {
  switch (bloco.tipo) {
    case "faixa": return faixa(pdf, bloco, caixa, y, desenhar);
    case "rotulos": return rotulos(pdf, bloco, caixa, y, desenhar);
    case "secao": return secao(pdf, bloco, caixa, y, desenhar);
    case "grade": return grade(pdf, bloco.campos, bloco.colunas ?? 3, caixa, y, desenhar);
    case "painel": return painel(pdf, bloco, caixa, y, desenhar);
    case "indicador": return indicador(pdf, bloco, caixa, y, desenhar);
    case "destaque": return destaque(pdf, bloco, caixa, y, desenhar);
    case "metricas": return metricas(pdf, bloco, caixa, y, desenhar);
    case "registro": return registro(pdf, bloco, caixa, y, desenhar);
    case "total": return total(pdf, bloco, caixa, y, desenhar);
    case "lista": {
      let yCursor = y;
      bloco.linhas.forEach((l, i) => { yCursor += linhaDaLista(pdf, l, i % 2 === 0, caixa, yCursor, desenhar); });
      return yCursor - y;
    }
    case "aviso": return aviso(pdf, bloco, caixa, y, desenhar);
    case "espaco": return bloco.altura;
    case "tabela": return tabelaNaCaixa(pdf, bloco, caixa, y, desenhar);
    // Os blocos da confissão dentro de uma coluna de painel saem na escala do relatório.
    case "titulo": return escreverTexto(pdf, desenhar, bloco.texto, caixa.x, y, caixa.largura, { fonte: FONTE.negrito, tamanho: PT.secao, cor: COR.azulEscuro });
    case "subtitulo": return escreverTexto(pdf, desenhar, bloco.texto, caixa.x, y, caixa.largura, { fonte: FONTE.negrito, tamanho: PT.corpo, cor: COR.texto });
    case "paragrafo": return escreverTexto(pdf, desenhar, bloco.texto, caixa.x, y, caixa.largura, { fonte: bloco.destaque ? FONTE.negrito : FONTE.normal, tamanho: PT.corpo, cor: COR.texto });
    case "rodape": return escreverTexto(pdf, desenhar, bloco.texto, caixa.x, y, caixa.largura, { fonte: FONTE.normal, tamanho: PT.rodape, cor: COR.rotulo });
  }
}

let medidor: PDFKit.PDFDocument | undefined;

/**
 * A altura de um bloco numa caixa da largura dada: a MESMA rotina que o
 * desenha, em modo "só medir" — é com ela que o fluxo decide se o bloco cabe
 * e quanto avança o cursor (o teste (j) confere as duas coisas). Sem um
 * documento, mede num pdfkit próprio (só pelas métricas das fontes).
 */
export function medirBloco(bloco: BlocoDoDocumento, largura: number, pdf: PDFKit.PDFDocument = (medidor ??= new PDFDocument({ size: "A4", compress: false }))): number {
  return blocoNaCaixa(pdf, bloco, { x: 0, largura }, 0, false);
}

/** Abre página quando o bloco não cabe no que resta desta — mas cabe numa inteira; maior que a página útil, desenha onde está e quebra. */
function garantirEspaco(pdf: PDFKit.PDFDocument, altura: number): void {
  const fundo = fundoDaPagina(pdf);
  if (pdf.y + altura > fundo - 0.01 && altura <= fundo - pdf.page.margins.top) pdf.addPage();
}

const alturaUtil = (pdf: PDFKit.PDFDocument) => fundoDaPagina(pdf) - pdf.page.margins.top;
/** O cartão vai inteiro para a página seguinte quando não cabe nesta; maior que meia página, quebra entre linhas (ACHADOS 2). */
const registroVaiInteiro = (pdf: PDFKit.PDFDocument, altura: number) => altura <= alturaUtil(pdf) / 2;

/** Quanto do bloco seguinte tem de caber junto de um título de seção: o bloco inteiro se é atômico, o começo se pagina por partes. */
function alturaDoComeco(pdf: PDFKit.PDFDocument, bloco: BlocoDoDocumento, caixa: Caixa): number {
  switch (bloco.tipo) {
    case "grade": return grade(pdf, bloco.campos.slice(0, bloco.colunas ?? 3), bloco.colunas ?? 3, caixa, 0, false);
    case "lista": return bloco.linhas.length ? linhaDaLista(pdf, bloco.linhas[0], true, caixa, 0, false) : 0;
    case "tabela": {
      const colunas = largurasDasColunas(pdf, bloco, caixa.largura);
      return linhaDaTabela(pdf, bloco, bloco.cabecalho, true, false, colunas, caixa, 0, false) + (bloco.linhas.length ? linhaDaTabela(pdf, bloco, bloco.linhas[0], false, false, colunas, caixa, 0, false) : 0);
    }
    case "registro": {
      const altura = registro(pdf, bloco, caixa, 0, false);
      if (registroVaiInteiro(pdf, altura)) return altura;
      const partes = partesDoRegistro(pdf, bloco, caixa);
      return RECHEIO * 2 + partes[0](0, false) + (partes[1]?.(0, false) ?? 0);
    }
    // Os blocos da confissão correm no fluxo do pdfkit: fica o mínimo.
    case "titulo": case "subtitulo": case "paragrafo": case "rodape": return 0;
    default: return medirBloco(bloco, caixa.largura, pdf);
  }
}

/**
 * Os blocos do relatório no fluxo da página. Os atômicos medem antes e vão
 * inteiros para a página seguinte quando não cabem; secao fica com o que vem
 * depois; grade e lista paginam linha a linha. No fim, o estado do pdfkit
 * volta ao corpo: margem esquerda, fonte, tamanho e cor.
 */
function escreverBlocoDoRelatorio(pdf: PDFKit.PDFDocument, bloco: BlocoDoDocumento, seguinte?: BlocoDoDocumento): void {
  const caixa = caixaDaPagina(pdf);
  switch (bloco.tipo) {
    case "espaco":
      pdf.y += bloco.altura;
      break;
    case "tabela":
      tabelaEstilizada(pdf, bloco);
      pdf.y += ENTRE_SECOES;
      break;
    // `text()` avança `pdf.y` sozinho: o fim de cada bloco é o topo em que ele
    // foi desenhado mais a altura medida — nunca o que o último texto deixou.
    case "secao": {
      const altura = secao(pdf, bloco, caixa, pdf.y, false);
      // Keep-with-next: o título pede espaço para si e para o começo do bloco seguinte (inteiro, se atômico), nunca menos de 70 — senão vai junto para a página seguinte.
      const junto = Math.max(MINIMO_DEPOIS_DA_SECAO, seguinte ? alturaDoComeco(pdf, seguinte, caixa) : 0);
      garantirEspaco(pdf, altura + 6 + Math.min(junto, alturaUtil(pdf) - altura - 6));
      const y = pdf.y;
      secao(pdf, bloco, caixa, y, true);
      pdf.y = y + altura + 6;
      break;
    }
    case "registro": {
      const altura = registro(pdf, bloco, caixa, pdf.y, false);
      if (pdf.y + altura > fundoDaPagina(pdf) - 0.01 && !registroVaiInteiro(pdf, altura)) {
        registroPorPartes(pdf, bloco, caixa);
        break;
      }
      garantirEspaco(pdf, altura);
      const y = pdf.y;
      registro(pdf, bloco, caixa, y, true);
      pdf.y = y + altura + ESPACO_DEPOIS.registro;
      break;
    }
    case "grade": {
      const colunas = bloco.colunas ?? 3;
      for (let i = 0; i < bloco.campos.length; i += colunas) {
        const linha = bloco.campos.slice(i, i + colunas);
        const altura = grade(pdf, linha, colunas, caixa, pdf.y, false);
        garantirEspaco(pdf, altura);
        const y = pdf.y;
        grade(pdf, linha, colunas, caixa, y, true);
        pdf.y = y + altura + 6;
      }
      pdf.y += ENTRE_SECOES - 6;
      break;
    }
    case "lista": {
      bloco.linhas.forEach((l, i) => {
        const altura = linhaDaLista(pdf, l, i % 2 === 0, caixa, pdf.y, false);
        garantirEspaco(pdf, altura);
        const y = pdf.y;
        linhaDaLista(pdf, l, i % 2 === 0, caixa, y, true);
        pdf.y = y + altura;
      });
      pdf.y += ENTRE_SECOES;
      break;
    }
    default: {
      const altura = medirBloco(bloco, caixa.largura, pdf);
      const espaco = ESPACO_DEPOIS[bloco.tipo as keyof typeof ESPACO_DEPOIS] ?? RECHEIO;
      // Painel maior que a página (o do SPC tem meia): as colunas saem empilhadas no fluxo, cada uma com o seu título, sem borda.
      if (bloco.tipo === "painel" && altura > alturaUtil(pdf)) {
        for (const coluna of bloco.colunas) {
          const blocos: BlocoDoDocumento[] = [{ tipo: "secao", titulo: coluna.titulo }, ...coluna.blocos];
          for (let i = 0; i < blocos.length; i++) escreverBlocoDoRelatorio(pdf, blocos[i], blocos[i + 1]);
        }
        break;
      }
      garantirEspaco(pdf, altura);
      const y = pdf.y;
      blocoNaCaixa(pdf, bloco, caixa, y, true);
      // Maior que a página (só um texto corrido consegue, um aviso enorme): o pdfkit abriu página no meio dele; segue de onde parou.
      pdf.y = altura > alturaUtil(pdf) ? pdf.y + espaco : y + altura + espaco;
    }
  }
  pdf.x = pdf.page.margins.left;
  pdf.font(FONTE.normal).fontSize(PT.corpo).fillColor(COR.texto);
}

/* ── Cabeçalho, rodapé e "página n de N" ─────────────────────────────── */

/** Até `maximo` linhas, sem jamais paginar: com `height` o pdfkit para em vez de abrir página, e o que não cabe vira "…". Devolve a altura usada. */
function linhasNaMargem(pdf: PDFKit.PDFDocument, texto: string, x: number, y: number, largura: number, align: "left" | "right" | "center", maximo: number): number {
  const alturaLinha = pdf.currentLineHeight(true);
  const altura = Math.min(pdf.heightOfString(texto, { width: largura }), alturaLinha * maximo);
  pdf.text(texto, x, y, { width: largura, height: alturaLinha * maximo + 1, ellipsis: true, align });
  return altura;
}

/**
 * Com `bufferPages` as páginas ainda estão abertas no fim: volta a cada uma
 * e escreve, nas margens, o cabeçalho (da segunda em diante), o rodapé e a
 * numeração. A marca d'água já está em cada página, por baixo. Devolve o
 * estado (página, posição, fonte, cor) como o encontrou.
 */
function cabecalhoERodape(pdf: PDFKit.PDFDocument, pagina: NonNullable<DocumentoRenderizado["pagina"]>): void {
  const { x, y } = pdf;
  const estado = pdf as unknown as { _font?: { name?: string }; _fontSize?: number };
  const fonteAntes = estado._font?.name;
  const tamanhoAntes = estado._fontSize;
  const { start, count } = pdf.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    pdf.switchToPage(i);
    const caixa = caixaDaPagina(pdf);
    // 3 pt abaixo do conteúdo: as duas linhas acabam a ~17 pt (6 mm) da borda do papel, fora da zona que a impressora não imprime.
    const yRodape = fundoDaPagina(pdf) + 3;
    pdf.font(FONTE.normal).fontSize(PT.rodape).fillColor(COR.rotulo);
    const alturaLinha = pdf.currentLineHeight(true);
    const larguraNumero = pagina.numerar ? larguraDoTexto(pdf, `página ${count} de ${count}`, FONTE.normal, PT.rodape) + 8 : 0;
    if (i > start && pagina.cabecalho) linhasNaMargem(pdf, pagina.cabecalho, caixa.x, pdf.page.margins.top - 24, caixa.largura, "left", 1);
    // A linha da esquerda pode tomar duas (o protocolo a alonga); a frase central desce junto. Três linhas de 8 pt cabem nos 37 pt que restam da margem.
    const alturaEsquerda = pagina.rodapeEsquerda ? linhasNaMargem(pdf, pagina.rodapeEsquerda, caixa.x, yRodape, caixa.largura - larguraNumero, "left", 2) : 0;
    if (pagina.numerar) linhasNaMargem(pdf, `página ${i - start + 1} de ${count}`, caixa.x + caixa.largura - larguraNumero, yRodape, larguraNumero, "right", 1);
    if (pagina.rodapeCentro) linhasNaMargem(pdf, pagina.rodapeCentro, caixa.x, yRodape + Math.max(alturaEsquerda, alturaLinha) + 1, caixa.largura, "center", 1);
  }
  pdf.switchToPage(start + count - 1);
  pdf.fillColor(COR.texto);
  if (fonteAntes) pdf.font(fonteAntes);
  if (tamanhoAntes) pdf.fontSize(tamanhoAntes);
  pdf.x = x;
  pdf.y = y;
}
