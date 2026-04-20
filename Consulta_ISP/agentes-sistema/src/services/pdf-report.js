const { getDb } = require('../models/database');
const claude = require('./claude');

class PdfReportService {

  async generatePerformanceReport(periodo = 'mensal', agente = 'todos') {
    const db = getDb();
    const dias = periodo === 'semanal' ? 7 : periodo === 'mensal' ? 30 : 90;
    const dataMin = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const totalLeads = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
    const leadsNovos = db.prepare("SELECT COUNT(*) as c FROM leads WHERE criado_em >= ?").get(dataMin).c;
    const conversoes = db.prepare("SELECT COUNT(*) as c FROM leads WHERE etapa_funil = 'convertido' AND criado_em >= ?").get(dataMin).c;
    const perdidos = db.prepare("SELECT COUNT(*) as c FROM leads WHERE etapa_funil = 'perdido' AND criado_em >= ?").get(dataMin).c;
    const pipeline = db.prepare("SELECT COALESCE(SUM(valor_estimado), 0) as v FROM leads WHERE etapa_funil NOT IN ('perdido','convertido')").get().v;

    const etapas = ['novo','prospeccao','qualificacao','demo_agendada','proposta_enviada','negociacao','fechamento','convertido','nurturing','perdido'];
    const funil = etapas.map(e => ({
      etapa: e,
      count: db.prepare('SELECT COUNT(*) as c FROM leads WHERE etapa_funil = ?').get(e).c
    }));

    const agentes = ['carla','lucas','rafael','sofia','leo','marcos','iani'];
    const perfAgentes = agentes.map(a => {
      const leads = db.prepare('SELECT COUNT(*) as c FROM leads WHERE agente_atual = ?').get(a).c;
      const msgs = db.prepare("SELECT COUNT(*) as c FROM conversas WHERE agente = ? AND criado_em >= ?").get(a, dataMin).c;
      const handoffs = db.prepare("SELECT COUNT(*) as c FROM handoffs WHERE de_agente = ? AND criado_em >= ?").get(a, dataMin).c;
      let notaMedia = null;
      try {
        const avg = db.prepare('SELECT AVG(nota) as m FROM avaliacoes WHERE agente = ? AND criado_em >= ?').get(a, dataMin);
        notaMedia = avg?.m ? Number(avg.m.toFixed(1)) : null;
      } catch { /* tabela pode nao existir */ }
      return { agente: a, leads, msgs, handoffs, notaMedia };
    });

    const topLeads = db.prepare(
      'SELECT nome, provedor, score_total, classificacao, etapa_funil, valor_estimado FROM leads WHERE score_total > 0 ORDER BY score_total DESC LIMIT 10'
    ).all();

    let entrega = {};
    try {
      const total = db.prepare("SELECT COUNT(*) as c FROM conversas WHERE direcao = 'enviada' AND criado_em >= ?").get(dataMin).c;
      const lidos = db.prepare("SELECT COUNT(*) as c FROM conversas WHERE direcao = 'enviada' AND status_entrega = 'lido' AND criado_em >= ?").get(dataMin).c;
      entrega = { total, lidos, taxaLeitura: total > 0 ? (lidos / total * 100).toFixed(1) + '%' : '0%' };
    } catch { /* campo pode nao existir */ }

    let analiseNarrativa = '';
    try {
      const result = await claude.sendToAgent('iani',
        `Gere um resumo executivo de ${periodo} do time de vendas. Dados: ${leadsNovos} leads novos, ${conversoes} conversoes, ${perdidos} perdidos, Pipeline R$ ${pipeline}. Seja conciso (max 5 frases). Tom executivo.`
      );
      analiseNarrativa = result.resposta;
    } catch { analiseNarrativa = 'Analise nao disponivel.'; }

    return {
      periodo, dataMin, geradoEm: new Date().toISOString(),
      kpis: { totalLeads, leadsNovos, conversoes, perdidos, pipeline },
      funil, agentes: perfAgentes, topLeads, entrega, analiseNarrativa
    };
  }

  /**
   * Gera PDF real usando pdfkit
   */
  async generatePDF(periodo = 'mensal') {
    const PDFDocument = require('pdfkit');
    const data = await this.generatePerformanceReport(periodo);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).font('Helvetica-Bold').text('Consulta ISP - Relatorio de Performance', { align: 'center' });
      doc.fontSize(10).font('Helvetica').text(`Periodo: ${data.periodo} | Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, { align: 'center' });
      doc.moveDown(2);

      // KPIs
      doc.fontSize(14).font('Helvetica-Bold').text('KPIs');
      doc.fontSize(10).font('Helvetica');
      doc.text(`Total de Leads: ${data.kpis.totalLeads}`);
      doc.text(`Leads Novos (periodo): ${data.kpis.leadsNovos}`);
      doc.text(`Conversoes: ${data.kpis.conversoes}`);
      doc.text(`Perdidos: ${data.kpis.perdidos}`);
      doc.text(`Pipeline: R$ ${Number(data.kpis.pipeline).toLocaleString('pt-BR')}`);
      if (data.entrega.taxaLeitura) doc.text(`Taxa de Leitura WhatsApp: ${data.entrega.taxaLeitura}`);
      doc.moveDown();

      // Funil
      doc.fontSize(14).font('Helvetica-Bold').text('Funil de Vendas');
      doc.fontSize(10).font('Helvetica');
      for (const f of data.funil) {
        if (f.count > 0) doc.text(`  ${f.etapa}: ${f.count} leads`);
      }
      doc.moveDown();

      // Agentes
      doc.fontSize(14).font('Helvetica-Bold').text('Performance por Agente');
      doc.fontSize(10).font('Helvetica');
      for (const a of data.agentes) {
        const nota = a.notaMedia ? ` | Nota: ${a.notaMedia}/5` : '';
        doc.text(`  ${a.agente}: ${a.leads} leads, ${a.msgs} msgs, ${a.handoffs} handoffs${nota}`);
      }
      doc.moveDown();

      // Top Leads
      if (data.topLeads.length > 0) {
        doc.fontSize(14).font('Helvetica-Bold').text('Top 10 Leads');
        doc.fontSize(10).font('Helvetica');
        for (const l of data.topLeads) {
          doc.text(`  ${l.nome || 'N/A'} (${l.provedor || '?'}) - Score: ${l.score_total}, ${l.classificacao}, ${l.etapa_funil}`);
        }
        doc.moveDown();
      }

      // Analise Iani
      if (data.analiseNarrativa) {
        doc.fontSize(14).font('Helvetica-Bold').text('Analise Executiva (Iani)');
        doc.fontSize(10).font('Helvetica').text(data.analiseNarrativa);
      }

      doc.end();
    });
  }
}

module.exports = new PdfReportService();
