const claude = require('./claude');
const zapi = require('./zapi');
const { getDb } = require('../models/database');
const training = require('./training');
const followup = require('./followup');
const abTesting = require('./ab-testing');
const instagram = require('./instagram');
const emailSender = require('./email-sender');

class Orchestrator {

  async processIncoming(phone, message, messageData = {}) {
    const db = getDb();
    const startTime = Date.now();

    let lead = db.prepare('SELECT * FROM leads WHERE telefone = ?').get(phone);

    if (!lead) {
      db.prepare(`INSERT INTO leads (telefone, agente_atual, etapa_funil, origem) VALUES (?, 'carlos', 'novo', 'whatsapp')`).run(phone);
      lead = db.prepare('SELECT * FROM leads WHERE telefone = ?').get(phone);
      this._logActivity('carlos', 'lead_criado', `Novo lead via WhatsApp: ${phone}`, lead.id);
      this._updateDailyMetric(lead.agente_atual, 'leads_novos', 1);
    }

    db.prepare(`INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal) VALUES (?, ?, 'recebida', ?, ?, 'whatsapp')`).run(lead.id, lead.agente_atual, message, messageData.type || 'texto');
    this._updateDailyMetric(lead.agente_atual, 'mensagens_recebidas', 1);

    // Feature 1: Cancelar followups quando lead responde
    followup.cancelFollowups(lead.id);

    // Tarefa 1: Trackear resposta do A/B test (se ultima msg enviada tinha A/B)
    try {
      const lastSent = db.prepare("SELECT metadata FROM conversas WHERE lead_id = ? AND direcao = 'enviada' ORDER BY criado_em DESC LIMIT 1").get(lead.id);
      if (lastSent?.metadata) {
        const meta = JSON.parse(lastSent.metadata);
        if (meta.ab_test_id && meta.ab_variante) {
          abTesting.recordResponse(meta.ab_test_id, meta.ab_variante);
        }
      }
    } catch { /* metadata pode nao ter A/B */ }

    const historico = this._getHistorico(lead.id, 10);
    const scoreBefore = lead.score_total;

    const canal = messageData.canal || lead.canal_preferido || 'whatsapp';
    const analise = await claude.analyzeAndDecide(lead.agente_atual, message, { ...lead, historico, lastMessage: message, canal });
    const elapsed = Date.now() - startTime;

    this._updateLeadData(lead.id, analise.dados_extraidos);
    if (analise.score_update) this._updateScore(lead.id, analise.score_update);

    const leadAfter = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id);

    // 11B-1: Handoff automatico por score — track se houve handoff pra evitar duplicata
    let scoreHandoffDone = false;
    if (leadAfter.agente_atual === 'carlos' && leadAfter.score_total >= 61) {
      await this.transferLead(lead.id, 'carlos', 'lucas', 'Score automatico >= 61');
      scoreHandoffDone = true;
    } else if (leadAfter.agente_atual === 'lucas' && leadAfter.score_total >= 81) {
      await this.transferLead(lead.id, 'lucas', 'rafael', 'Score automatico >= 81');
      scoreHandoffDone = true;
    } else if (leadAfter.agente_atual === 'carlos' && leadAfter.score_total < 31 && leadAfter.score_total > 0) {
      await this.transferLead(lead.id, 'carlos', 'sofia', 'Score baixo < 31, devolver marketing');
      scoreHandoffDone = true;
    }

    db.prepare(`INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal, tempo_resposta_ms, metadata) VALUES (?, ?, 'enviada', ?, 'texto', 'whatsapp', ?, ?)`).run(lead.id, lead.agente_atual, analise.resposta_whatsapp, elapsed, JSON.stringify({ acao: analise.acao, notas: analise.notas_internas }));

    this._logActivity(lead.agente_atual, 'resposta_enviada', `Respondeu lead ${lead.nome || phone}: "${analise.resposta_whatsapp.substring(0, 80)}..."`, lead.id, analise.acao, scoreBefore, leadAfter.score_total, 0, elapsed);
    this._updateDailyMetric(lead.agente_atual, 'mensagens_enviadas', 1);

    // Tarefa 2: Enviar pelo canal correto (whatsapp/instagram/email)
    await this._sendByChannel(leadAfter, analise.resposta_whatsapp);

    // 11B-4: Rate limiting — avaliar a cada 3 mensagens, nao toda
    const msgCount = db.prepare('SELECT COUNT(*) as c FROM conversas WHERE lead_id = ? AND direcao = ?').get(lead.id, 'enviada').c;
    if (msgCount % 3 === 0) {
      training.evaluateResponse(
        lead.agente_atual, lead.id, null,
        analise.resposta_whatsapp, message, lead, claude.client
      ).catch(e => console.error('[TRAINING] Erro avaliacao async:', e.message));
    }

    // 11B-1: Pular _processAction se score ja triggou o mesmo handoff
    if (!scoreHandoffDone || !['transferir_vendas', 'transferir_closer', 'devolver_marketing'].includes(analise.acao)) {
      await this._processAction(lead.id, analise.acao, analise);
    }

    // Fire-and-forget: extrair aprendizados quando houve avanco
    if (['transferir_vendas', 'transferir_closer', 'agendar_demo', 'enviar_proposta'].includes(analise.acao)) {
      const conversaTexto = historico.map(m => `${m.role}: ${m.content}`).join('\n');
      training.analyzeConversation(lead.agente_atual, conversaTexto, analise.acao, claude.client)
        .catch(e => console.error('[TRAINING] Erro async:', e.message));
    }

    // Feature 1: Agendar followup se acao nao e terminal
    if (!['encerrar', 'devolver_marketing'].includes(analise.acao)) {
      followup.scheduleFollowup(lead.id, lead.agente_atual);
    }

    return { lead_id: lead.id, agente: lead.agente_atual, resposta: analise.resposta_whatsapp, acao: analise.acao, tempo_ms: elapsed };
  }

  // 11B-5: Delay configuravel na prospeccao
  async sendOutbound(phone, agentKey, message, delayMs = 0) {
    const db = getDb();

    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    let lead = db.prepare('SELECT * FROM leads WHERE telefone = ?').get(phone);
    if (!lead) {
      db.prepare(`INSERT INTO leads (telefone, agente_atual, etapa_funil, origem) VALUES (?, ?, 'prospeccao', 'outbound')`).run(phone, agentKey);
      lead = db.prepare('SELECT * FROM leads WHERE telefone = ?').get(phone);
      this._logActivity(agentKey, 'prospeccao', `Prospeccao outbound: ${phone}`, lead.id);
      this._updateDailyMetric(agentKey, 'leads_novos', 1);
    }

    // Tarefa 1: Verificar A/B test ativo pra prospeccao
    const abVariant = abTesting.getVariant(agentKey, 'prospeccao');
    let resposta;

    if (abVariant) {
      // Usar variante do A/B test em vez de gerar via Claude
      resposta = abVariant.mensagem;
      abTesting.recordSend(abVariant.testId, abVariant.variante);
      // Guardar metadata pra trackear resposta depois
      db.prepare(`INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal, metadata) VALUES (?, ?, 'enviada', ?, 'texto', 'whatsapp', ?)`).run(
        lead.id, agentKey, resposta, JSON.stringify({ ab_test_id: abVariant.testId, ab_variante: abVariant.variante })
      );
    } else {
      const result = await claude.sendToAgent(agentKey, message, { leadData: lead });
      resposta = result.resposta;
      db.prepare(`INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal) VALUES (?, ?, 'enviada', ?, 'texto', 'whatsapp')`).run(lead.id, agentKey, resposta);
    }

    await zapi.sendText(phone, resposta);
    this._updateDailyMetric(agentKey, 'mensagens_enviadas', 1);

    return { resposta, agente: agentKey };
  }

  async transferLead(leadId, fromAgent, toAgent, motivo) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);

    db.prepare('UPDATE leads SET agente_atual = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?').run(toAgent, leadId);

    db.prepare('INSERT INTO handoffs (lead_id, de_agente, para_agente, motivo, score_no_momento) VALUES (?,?,?,?,?)').run(leadId, fromAgent, toAgent, motivo, lead?.score_total || 0);

    db.prepare(`INSERT INTO tarefas (lead_id, agente, tipo, descricao, status) VALUES (?, ?, 'handoff', ?, 'concluida')`).run(leadId, toAgent, `Recebido de ${fromAgent}: ${motivo}`);

    const etapas = { sofia: 'nurturing', carlos: 'qualificacao', lucas: 'negociacao', rafael: 'fechamento' };
    if (etapas[toAgent]) db.prepare('UPDATE leads SET etapa_funil = ? WHERE id = ?').run(etapas[toAgent], leadId);

    this._logActivity(fromAgent, 'handoff_enviado', `Lead transferido para ${toAgent}: ${motivo}`, leadId);
    this._logActivity(toAgent, 'handoff_recebido', `Lead recebido de ${fromAgent}: ${motivo}`, leadId);

    if (toAgent === 'lucas') this._updateDailyMetric('carlos', 'leads_qualificados', 1);
    if (toAgent === 'rafael') this._updateDailyMetric('lucas', 'leads_qualificados', 1);
  }

  async _processAction(leadId, acao, analise) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);

    switch (acao) {
      case 'transferir_vendas':
        await this.transferLead(leadId, lead.agente_atual, 'lucas', analise.notas_internas);
        break;
      case 'transferir_closer':
        await this.transferLead(leadId, lead.agente_atual, 'rafael', analise.notas_internas);
        break;
      case 'devolver_marketing':
        await this.transferLead(leadId, lead.agente_atual, 'sofia', 'Lead frio - nurturing');
        db.prepare("UPDATE leads SET classificacao = 'frio' WHERE id = ?").run(leadId);
        break;
      case 'agendar_demo':
        db.prepare(`INSERT INTO tarefas (lead_id, agente, tipo, descricao, status, prioridade) VALUES (?, 'lucas', 'demo', ?, 'pendente', 'alta')`).run(leadId, `Demo: ${analise.notas_internas}`);
        db.prepare("UPDATE leads SET etapa_funil = 'demo_agendada' WHERE id = ?").run(leadId);
        this._logActivity(lead.agente_atual, 'demo_agendada', `Demo agendada para lead`, leadId);
        this._updateDailyMetric(lead.agente_atual, 'demos_agendadas', 1);
        break;
      case 'enviar_proposta':
        db.prepare(`INSERT INTO tarefas (lead_id, agente, tipo, descricao, status, prioridade) VALUES (?, ?, 'proposta', ?, 'pendente', 'alta')`).run(leadId, lead.agente_atual, `Proposta: ${analise.notas_internas}`);
        db.prepare("UPDATE leads SET etapa_funil = 'proposta_enviada' WHERE id = ?").run(leadId);
        this._logActivity(lead.agente_atual, 'proposta_enviada', `Proposta enviada`, leadId);
        this._updateDailyMetric(lead.agente_atual, 'propostas_enviadas', 1);
        break;
      case 'encerrar':
        db.prepare("UPDATE leads SET etapa_funil = 'perdido' WHERE id = ?").run(leadId);
        this._logActivity(lead.agente_atual, 'lead_perdido', `Lead perdido: ${analise.notas_internas}`, leadId);
        this._updateDailyMetric(lead.agente_atual, 'leads_perdidos', 1);
        break;
    }
  }

  // Tarefa 2: Enviar resposta pelo canal correto
  async _sendByChannel(lead, message) {
    const canal = lead.canal_preferido || 'whatsapp';
    try {
      if (canal === 'instagram' && instagram.isConfigured()) {
        // telefone do lead Instagram e ig_USERID
        const igId = lead.telefone.replace('ig_', '');
        await instagram.sendDM(igId, message);
      } else if (canal === 'email' && emailSender.isConfigured() && lead.email) {
        await emailSender.sendEmail(lead.email, 'Consulta ISP', message);
      } else {
        // Default: WhatsApp
        await zapi.sendText(lead.telefone, message);
      }
    } catch (e) {
      console.error(`[CANAL] Erro ${canal}:`, e.message);
      // Fallback pra WhatsApp se outro canal falhar
      if (canal !== 'whatsapp') {
        await zapi.sendText(lead.telefone, message);
      }
    }
  }

  _logActivity(agente, tipo, descricao, leadId = null, decisao = null, scoreBefore = null, scoreAfter = null, tokens = 0, tempo = 0) {
    const db = getDb();
    db.prepare(`INSERT INTO atividades_agentes (agente, tipo, descricao, lead_id, decisao, score_antes, score_depois, tokens_usados, tempo_ms) VALUES (?,?,?,?,?,?,?,?,?)`).run(agente, tipo, descricao, leadId, decisao, scoreBefore, scoreAfter, tokens, tempo);
  }

  _updateDailyMetric(agente, campo, valor) {
    const db = getDb();
    const hoje = new Date().toISOString().split('T')[0];
    const exists = db.prepare('SELECT id FROM metricas_diarias WHERE data = ? AND agente = ?').get(hoje, agente);
    if (!exists) {
      db.prepare('INSERT INTO metricas_diarias (data, agente) VALUES (?, ?)').run(hoje, agente);
    }
    db.prepare(`UPDATE metricas_diarias SET ${campo} = ${campo} + ? WHERE data = ? AND agente = ?`).run(valor, hoje, agente);
  }

  _updateLeadData(leadId, dados) {
    if (!dados) return;
    const db = getDb();
    const fields = []; const values = [];
    for (const [key, val] of Object.entries(dados)) {
      if (val && val !== null && val !== 'null') { fields.push(`${key} = ?`); values.push(val); }
    }
    if (fields.length > 0) {
      fields.push('atualizado_em = CURRENT_TIMESTAMP');
      values.push(leadId);
      db.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  _updateScore(leadId, scoreUpdate) {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    const novoPerfil = Math.min(50, (lead.score_perfil || 0) + (scoreUpdate.perfil || 0));
    const novoComportamento = Math.min(50, (lead.score_comportamento || 0) + (scoreUpdate.comportamento || 0));
    const total = novoPerfil + novoComportamento;
    let classificacao = 'frio';
    if (total >= 81) classificacao = 'ultra_quente';
    else if (total >= 61) classificacao = 'quente';
    else if (total >= 31) classificacao = 'morno';
    db.prepare(`UPDATE leads SET score_perfil=?, score_comportamento=?, score_total=?, classificacao=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`).run(novoPerfil, novoComportamento, total, classificacao, leadId);
  }

  _getHistorico(leadId, limit = 10) {
    const db = getDb();
    return db.prepare('SELECT direcao, mensagem FROM conversas WHERE lead_id = ? ORDER BY criado_em DESC LIMIT ?').all(leadId, limit).reverse().map(m => ({ role: m.direcao === 'recebida' ? 'user' : 'assistant', content: m.mensagem }));
  }

  getStats() {
    const db = getDb();
    return {
      total_leads: db.prepare('SELECT COUNT(*) as c FROM leads').get().c,
      por_classificacao: db.prepare('SELECT classificacao, COUNT(*) as c FROM leads GROUP BY classificacao').all(),
      por_agente: db.prepare('SELECT agente_atual, COUNT(*) as c FROM leads GROUP BY agente_atual').all(),
      por_etapa: db.prepare('SELECT etapa_funil, COUNT(*) as c FROM leads GROUP BY etapa_funil').all(),
      mensagens_hoje: db.prepare("SELECT COUNT(*) as c FROM conversas WHERE DATE(criado_em) = DATE('now')").get().c,
      tarefas_pendentes: db.prepare("SELECT COUNT(*) as c FROM tarefas WHERE status = 'pendente'").get().c
    };
  }
}

module.exports = new Orchestrator();
