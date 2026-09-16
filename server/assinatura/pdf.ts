/**
 * Documento renderizado → PDF. pdfkit com as fontes padrão (Helvetica,
 * WinAnsi cobre o português), corpo 12 pt no mínimo, cláusulas em destaque
 * em negrito (CDC art. 54, §§3º e 4º). `compress: false` de propósito: o
 * texto fica legível no fluxo (o teste confere) e o tamanho de um contrato de
 * poucas páginas é irrelevante.
 */
import PDFDocument from "pdfkit";
import type { BlocoDoDocumento, DocumentoRenderizado } from "@shared/cobranca/confissao-modelo";

export const CORPO_PT = 12;
export const LIMITE_DO_PDF_BYTES = 8 * 1024 * 1024;

const MARGEM = 56;

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
    const pdf = new PDFDocument({
      size: "A4",
      margins: { top: MARGEM, bottom: MARGEM, left: MARGEM, right: MARGEM },
      compress: false,
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
      for (const bloco of doc.blocos) escrever(pdf, bloco);
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
 * saía em 40 pt negrito (medido em 16/09/2026). `lineBreak: false` porque a
 * marca é uma linha só — quebrada em duas ela viraria dois textos por página.
 */
function marcarPagina(pdf: PDFKit.PDFDocument, texto: string): void {
  const { x, y } = pdf;
  const estado = pdf as unknown as { _font?: { name?: string }; _fontSize?: number };
  const fonteAntes = estado._font?.name;
  const tamanhoAntes = estado._fontSize;
  const largura = pdf.page.width;
  const altura = pdf.page.height;
  pdf.save();
  pdf.rotate(-30, { origin: [largura / 2, altura / 2] });
  pdf.font("Helvetica-Bold").fontSize(40).fillColor("#9a9a9a").opacity(0.28)
    .text(texto, 0, altura / 2 - 20, { width: largura, align: "center", lineBreak: false });
  pdf.restore();
  pdf.opacity(1).fillColor("#000000");
  if (fonteAntes) pdf.font(fonteAntes);
  if (tamanhoAntes) pdf.fontSize(tamanhoAntes);
  pdf.x = x;
  pdf.y = y;
}

function escrever(pdf: PDFKit.PDFDocument, bloco: BlocoDoDocumento): void {
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
      tabela(pdf, bloco.cabecalho, bloco.linhas);
      return;
    case "rodape":
      pdf.font("Helvetica").fontSize(9).fillColor("#444444").text(bloco.texto, { align: "center" }).fillColor("#000000").moveDown(0.3);
      return;
  }
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
