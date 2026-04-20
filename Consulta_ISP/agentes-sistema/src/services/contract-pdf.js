// Gerador de PDF de contrato (Rafael).
// Template estatico, dados injetados (lead + plano + assinatura digital simples).

const fs = require('fs');
const path = require('path');

const COLORS = {
  text: '#141413',
  muted: '#5e5d59',
  terracotta: '#c96442'
};

const CONTRACTS_DIR = path.join(__dirname, '../../data/contracts');

function ensureDir() {
  if (!fs.existsSync(CONTRACTS_DIR)) fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
}

function generateContractPdf({
  leadId,
  lead,
  plano,
  valorMensal,
  dataInicio,
  numero,
  formaPagamento = 'PIX'
}) {
  ensureDir();
  const PDFDocument = require('pdfkit');
  const filename = `${numero}.pdf`;
  const fullPath = path.join(CONTRACTS_DIR, filename);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const stream = fs.createWriteStream(fullPath);
      doc.pipe(stream);

      // Header
      doc.fontSize(20).font('Helvetica-Bold').fillColor(COLORS.text)
        .text('Contrato de Prestacao de Servicos', { align: 'center' });
      doc.fontSize(11).font('Helvetica').fillColor(COLORS.muted)
        .text(`No ${numero}`, { align: 'center' });
      doc.moveTo(50, 110).lineTo(545, 110).strokeColor(COLORS.terracotta).lineWidth(1).stroke();
      doc.moveDown(2);

      // Partes
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text)
        .text('CONTRATANTE:');
      doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted);
      doc.text(`${lead.razao_social || lead.nome || lead.provedor}`);
      if (lead.cnpj) doc.text(`CNPJ: ${lead.cnpj}`);
      if (lead.cidade) doc.text(`${lead.cidade}/${lead.estado || ''}`);
      doc.moveDown(1);

      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text)
        .text('CONTRATADA:');
      doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted);
      doc.text('Consulta ISP — Plataforma de Credito Colaborativa');
      doc.text('CNPJ: [a preencher]');
      doc.text('https://consultaisp.com.br');
      doc.moveDown(2);

      // Clausulas
      doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.text)
        .text('CLAUSULA 1 — OBJETO');
      doc.fontSize(10).font('Helvetica').fillColor(COLORS.text)
        .text(
          `A CONTRATADA prestara servicos de plataforma SaaS de analise de credito ` +
          `colaborativa para provedores de internet (ISPs), incluindo consulta ISP ` +
          `colaborativa, anti-fraude, controle de equipamentos e integracoes ERP, ` +
          `conforme plano contratado: ${String(plano).toUpperCase()}.`,
          { lineGap: 3 }
        );
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold')
        .text('CLAUSULA 2 — VALOR E PAGAMENTO');
      doc.fontSize(10).font('Helvetica');
      doc.text(`Valor mensal: R$ ${Number(valorMensal).toFixed(2).replace('.', ',')}`);
      doc.text(`Forma de pagamento: ${formaPagamento}`);
      doc.text(`Vencimento: dia 10 de cada mes (primeira fatura: ${dataInicio})`);
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold')
        .text('CLAUSULA 3 — VIGENCIA');
      doc.fontSize(10).font('Helvetica');
      doc.text(
        `Inicio: ${dataInicio}. Vigencia indeterminada. Cancelamento por qualquer parte ` +
        `mediante aviso previo de 30 dias.`,
        { lineGap: 3 }
      );
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold')
        .text('CLAUSULA 4 — LGPD');
      doc.fontSize(10).font('Helvetica');
      doc.text(
        `O CONTRATANTE autoriza o compartilhamento mascarado (nome parcial, faixa de ` +
        `valor, endereco sem numero) de dados de inadimplencia de seus clientes na base ` +
        `colaborativa, sob fundamento legitimo interesse (art. 7, IX, Lei 13.709/2018). ` +
        `Nenhum dado pessoal completo e exposto entre provedores.`,
        { lineGap: 3 }
      );
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold')
        .text('CLAUSULA 5 — DISPOSICOES GERAIS');
      doc.fontSize(10).font('Helvetica');
      doc.text(
        `Este contrato e regido pelas leis brasileiras. Foro: comarca da sede da CONTRATADA. ` +
        `Acordo digital — confirmacao via WhatsApp/email constitui aceite valido (Lei ` +
        `14.063/2020, art. 4o, II).`,
        { lineGap: 3 }
      );
      doc.moveDown(2);

      // Assinaturas
      const dataAtual = new Date().toLocaleDateString('pt-BR');
      doc.fontSize(10).text(`Data: ${dataAtual}`, { align: 'right' });
      doc.moveDown(1);

      const yAssinatura = doc.y;
      doc.moveTo(60, yAssinatura + 30).lineTo(260, yAssinatura + 30).stroke();
      doc.text('CONTRATANTE', 60, yAssinatura + 35, { width: 200, align: 'center' });
      doc.text(`(${lead.razao_social || lead.nome || ''})`, 60, yAssinatura + 50, { width: 200, align: 'center' });

      doc.moveTo(310, yAssinatura + 30).lineTo(510, yAssinatura + 30).stroke();
      doc.text('CONTRATADA', 310, yAssinatura + 35, { width: 200, align: 'center' });
      doc.text('(Consulta ISP)', 310, yAssinatura + 50, { width: 200, align: 'center' });

      // Footer
      doc.fontSize(8).fillColor(COLORS.muted).font('Helvetica')
        .text(`Contrato ${numero} — gerado automaticamente`, 50, 800, { align: 'center', width: 495 });

      doc.end();
      stream.on('finish', () => resolve({ path: fullPath, filename, numero }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function generateContractNumber(leadId) {
  return `CT-${new Date().getFullYear()}-${String(leadId).padStart(6, '0')}`;
}

module.exports = { generateContractPdf, generateContractNumber };
