// Gerador de PDF de proposta comercial (Lucas).
// Usa pdfkit (ja instalado via pdf-report.js).

const fs = require('fs');
const path = require('path');

const PLANOS = {
  gratuito: { nome: 'Gratuito', valor: 0, desc: '30 consultas ISP/mes, sem cartao' },
  basico: { nome: 'Basico', valor: 149, desc: '200 consultas ISP + 50 SPC/mes, 1 ERP, 3 usuarios' },
  profissional: { nome: 'Profissional', valor: 349, desc: '500 ISP + 150 SPC/mes, todos ERPs, lote 500 CPFs' },
  enterprise: { nome: 'Enterprise', valor: 690, desc: '1500 ISP + 500 SPC/mes, ilimitado, suporte dedicado' }
};

const COLORS = {
  text: '#141413',
  muted: '#5e5d59',
  terracotta: '#c96442',
  green: '#5b7c5e',
  bg: '#f5f4ed'
};

const PROPOSALS_DIR = path.join(__dirname, '../../data/proposals');

function ensureDir() {
  if (!fs.existsSync(PROPOSALS_DIR)) fs.mkdirSync(PROPOSALS_DIR, { recursive: true });
}

function generateProposalPdf({ leadId, lead, plano, valorCustomizado, roiResumo, validadeDias = 7 }) {
  ensureDir();
  const PDFDocument = require('pdfkit');
  const planoConfig = PLANOS[plano] || PLANOS.basico;
  const valorFinal = Number(valorCustomizado) || planoConfig.valor;
  const validadeAte = new Date(Date.now() + validadeDias * 86400_000);
  const numeroProposta = `PR-${new Date().getFullYear()}-${String(leadId).padStart(6, '0')}`;
  const filename = `${numeroProposta}.pdf`;
  const fullPath = path.join(PROPOSALS_DIR, filename);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];
      const stream = fs.createWriteStream(fullPath);
      doc.pipe(stream);
      doc.on('data', (c) => chunks.push(c));

      // Header
      doc.fontSize(22).font('Helvetica-Bold').fillColor(COLORS.text)
        .text('Consulta ISP', 50, 50);
      doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted)
        .text('Proposta Comercial — ' + numeroProposta, 50, 78);
      doc.fontSize(9).text(new Date().toLocaleDateString('pt-BR'), { align: 'right' });
      doc.moveTo(50, 100).lineTo(545, 100).strokeColor(COLORS.terracotta).lineWidth(2).stroke();

      // Lead info
      doc.moveDown(2);
      doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.text).text('Para:');
      doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted);
      doc.text(`${lead.razao_social || lead.nome || lead.provedor || 'Provedor'}`);
      if (lead.cnpj) doc.text(`CNPJ: ${lead.cnpj}`);
      if (lead.cidade) doc.text(`${lead.cidade}/${lead.estado || ''}`);
      doc.moveDown(1);

      // Plano destacado
      doc.fontSize(14).font('Helvetica-Bold').fillColor(COLORS.terracotta)
        .text(`Plano ${planoConfig.nome}`);
      doc.fontSize(20).font('Helvetica-Bold').fillColor(COLORS.text)
        .text(`R$ ${valorFinal.toFixed(2).replace('.', ',')}`, { continued: true })
        .fontSize(10).font('Helvetica').fillColor(COLORS.muted).text(' /mes', { continued: false });
      if (valorCustomizado && valorCustomizado < planoConfig.valor) {
        doc.fontSize(9).fillColor(COLORS.green)
          .text(`Desconto aplicado: R$${(planoConfig.valor - valorCustomizado).toFixed(2)} OFF`);
      }
      doc.fontSize(10).fillColor(COLORS.muted).font('Helvetica').text(planoConfig.desc);
      doc.moveDown(1);

      // ROI
      if (roiResumo) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.text).text('Por que vale a pena:');
        doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted).text(roiResumo, { lineGap: 4 });
        doc.moveDown(1);
      }

      // Beneficios
      doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.text).text('O que esta incluido:');
      const beneficios = [
        'Score colaborativo regional de inadimplencia (atualizacao em tempo real)',
        'Anti-fraude: alerta WhatsApp <5s quando CPF e consultado por outro provedor',
        'Controle de equipamentos (ONT, router, modem) com rastreamento',
        'Consulta SPC integrada (negativacao formal)',
        'Integracao nativa: IXC, MK, SGP, Hubsoft, Voalle, RBX (+ CSV)',
        'Consulta em lote ate 500 CPFs via CSV',
        'Suporte tecnico dedicado'
      ];
      doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted);
      for (const b of beneficios) {
        doc.text(`• ${b}`, { lineGap: 3 });
      }
      doc.moveDown(1);

      // Validade
      doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.terracotta)
        .text(`Validade desta proposta: ${validadeAte.toLocaleDateString('pt-BR')}`);

      // Footer
      doc.moveDown(2);
      doc.fontSize(8).fillColor(COLORS.muted).font('Helvetica')
        .text('Consulta ISP — SaaS de analise de credito colaborativa para provedores regionais', { align: 'center' });
      doc.text('https://consultaisp.com.br', { align: 'center' });

      doc.end();
      stream.on('finish', () => resolve({ path: fullPath, filename, numero: numeroProposta, valorFinal }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateProposalPdf, PLANOS };
