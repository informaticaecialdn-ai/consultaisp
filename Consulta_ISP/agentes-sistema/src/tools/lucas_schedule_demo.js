// Tool: lucas_schedule_demo
// Lucas envia link de Calendly pro lead agendar demo. Registra em tarefas
// como 'demo' pendente. Opcionalmente aceita data/hora pre-combinada
// (sem link, apenas confirmacao).
//
// Pra MVP uso Calendly Scheduling Link (nao precisa OAuth, so URL publica).
// Config: CALENDLY_DEMO_URL="https://calendly.com/seu-user/demo-isp"

const { getDb } = require('../models/database');
const zapi = require('../services/zapi');
const logger = require('../utils/logger');

module.exports = {
  name: 'lucas_schedule_demo',
  description:
    'Agenda demo com o lead. Modo padrao envia link Calendly via WhatsApp (lead escolhe horario). Se o lead ja combinou horario especifico, use modo "confirm" com data_hora. Registra tarefa tipo=demo + atualiza etapa_funil=demo_agendada.',
  input_schema: {
    type: 'object',
    properties: {
      lead_id: { type: 'integer' },
      modo: {
        type: 'string',
        enum: ['link', 'confirm'],
        description: '"link" envia Calendly (lead escolhe). "confirm" apenas registra horario pre-combinado.',
        default: 'link'
      },
      data_hora: {
        type: 'string',
        description: 'Modo confirm: data/hora combinada (YYYY-MM-DD HH:MM). Nao usado em modo link.'
      },
      mensagem_custom: {
        type: 'string',
        description: 'Opcional. Override da mensagem padrao enviada via WhatsApp.'
      },
      duracao_min: {
        type: 'integer',
        description: 'Duracao da demo em minutos. Default 30.',
        default: 30
      }
    },
    required: ['lead_id']
  },
  async handler(input, ctx = {}) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(input.lead_id);
    if (!lead) return { ok: false, error: 'lead_not_found' };

    const modo = input.modo || 'link';
    const duracaoMin = Number(input.duracao_min) || 30;

    try {
      let mensagem;
      let dadosTarefa = {};

      if (modo === 'link') {
        const calendlyUrl = process.env.CALENDLY_DEMO_URL;
        if (!calendlyUrl) {
          return {
            ok: false,
            error: 'calendly_nao_configurado',
            note: 'Setar CALENDLY_DEMO_URL no .env com o link publico do seu Calendly (ex: https://calendly.com/user/demo-isp)'
          };
        }

        mensagem = input.mensagem_custom ||
          `Show! Vamos marcar uma demo de ${duracaoMin}min. ` +
          `Escolhe o horario que te funciona melhor aqui: ${calendlyUrl}\n\n` +
          `Depois que marcar, te mando o link do Google Meet.`;

        dadosTarefa = { modo: 'link', calendly_url: calendlyUrl, duracao_min: duracaoMin };
      } else if (modo === 'confirm') {
        if (!input.data_hora) {
          return { ok: false, error: 'data_hora_required_em_modo_confirm' };
        }
        const dataHora = new Date(input.data_hora.replace(' ', 'T') + (input.data_hora.includes('Z') ? '' : '-03:00'));
        if (Number.isNaN(dataHora.getTime())) {
          return { ok: false, error: 'data_hora_invalida', hint: 'formato YYYY-MM-DD HH:MM' };
        }

        const dataBr = dataHora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
        const horaBr = dataHora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        mensagem = input.mensagem_custom ||
          `Confirmado! Demo marcada pra ${dataBr} as ${horaBr} (horario de Brasilia). ` +
          `Vou te mandar o link do Google Meet 15min antes. Qualquer coisa me avise.`;

        dadosTarefa = {
          modo: 'confirm',
          data_hora_iso: dataHora.toISOString(),
          duracao_min: duracaoMin
        };
      }

      // Envia via WhatsApp
      let sent = false;
      let sendError = null;
      try {
        await zapi.sendText(lead.telefone, mensagem);
        sent = true;
      } catch (err) {
        sendError = err.message;
      }

      // Registra tarefa
      const tarefaResult = db.prepare(
        `INSERT INTO tarefas (lead_id, agente, tipo, descricao, status, prioridade, data_limite, dados)
         VALUES (?, ?, 'demo', ?, ?, 'alta', ?, ?)`
      ).run(
        lead.id,
        ctx.agente || 'lucas',
        `Demo agendada via ${modo}${dadosTarefa.data_hora_iso ? ' — ' + dadosTarefa.data_hora_iso : ''}`,
        sent ? 'concluida' : 'pendente',
        dadosTarefa.data_hora_iso || null,
        JSON.stringify(dadosTarefa)
      );

      // Atualiza lead
      db.prepare(
        `UPDATE leads SET
           etapa_funil = 'demo_agendada',
           observacoes = COALESCE(observacoes || char(10), '') || ?,
           atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        `DEMO AGENDADA (${modo})${dadosTarefa.data_hora_iso ? ' pra ' + dadosTarefa.data_hora_iso : ''}${sent ? ' [enviado]' : ' [pendente envio]'}`,
        lead.id
      );

      // Registra conversa
      if (sent) {
        db.prepare(
          `INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal, metadata)
           VALUES (?, ?, 'enviada', ?, 'texto', 'whatsapp', ?)`
        ).run(
          lead.id,
          ctx.agente || 'lucas',
          mensagem,
          JSON.stringify({ tipo_acao: 'schedule_demo', ...dadosTarefa })
        );
      }

      // Incrementa metrica diaria
      const hoje = new Date().toISOString().split('T')[0];
      const ag = ctx.agente || 'lucas';
      db.prepare('INSERT OR IGNORE INTO metricas_diarias (data, agente) VALUES (?, ?)').run(hoje, ag);
      db.prepare('UPDATE metricas_diarias SET demos_agendadas = demos_agendadas + 1 WHERE data = ? AND agente = ?').run(hoje, ag);

      logger.info(
        { lead_id: lead.id, modo, sent, tarefa_id: tarefaResult.lastInsertRowid },
        '[TOOL lucas_schedule_demo]'
      );

      return {
        ok: true,
        tarefa_id: tarefaResult.lastInsertRowid,
        modo,
        sent,
        send_error: sendError,
        mensagem_enviada: mensagem,
        ...dadosTarefa
      };
    } catch (err) {
      logger.error({ lead_id: lead.id, err: err.message }, '[TOOL lucas_schedule_demo] falha');
      return { ok: false, error: err.message };
    }
  }
};
