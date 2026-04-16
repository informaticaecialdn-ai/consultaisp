const { getDb } = require('../models/database');
const claude = require('./claude');
const zapi = require('./zapi');

// Intervalos de follow-up em horas
const FOLLOWUP_HOURS = [24, 48, 72];
const MAX_TENTATIVAS = 3;

class FollowupService {

  /**
   * Agenda follow-up para um lead (chamado apos agente responder e nao haver followup ativo)
   */
  scheduleFollowup(leadId, agente) {
    const db = getDb();

    // Nao agendar se ja tem followup pendente
    const existing = db.prepare(
      'SELECT id FROM followups WHERE lead_id = ? AND status = ?'
    ).get(leadId, 'pendente');
    if (existing) return;

    // Pegar ultima mensagem enviada
    const lastMsg = db.prepare(
      "SELECT mensagem FROM conversas WHERE lead_id = ? AND direcao = 'enviada' ORDER BY criado_em DESC LIMIT 1"
    ).get(leadId);

    const horasAte = FOLLOWUP_HOURS[0]; // 24h
    const proximoEnvio = new Date(Date.now() + horasAte * 60 * 60 * 1000).toISOString();

    db.prepare(
      'INSERT INTO followups (lead_id, agente, mensagem_original, tentativa, proximo_envio) VALUES (?,?,?,?,?)'
    ).run(leadId, agente, lastMsg?.mensagem || '', 1, proximoEnvio);

    console.log(`[FOLLOWUP] Agendado para lead ${leadId} em ${horasAte}h`);
  }

  /**
   * Cancela todos os followups pendentes de um lead (chamado quando lead responde)
   */
  cancelFollowups(leadId) {
    const db = getDb();
    const result = db.prepare(
      "UPDATE followups SET status = 'cancelado' WHERE lead_id = ? AND status = 'pendente'"
    ).run(leadId);
    if (result.changes > 0) {
      console.log(`[FOLLOWUP] Cancelados ${result.changes} followups para lead ${leadId}`);
    }
  }

  /**
   * Processa followups pendentes (rodar a cada 5 min via setInterval)
   */
  async processFollowups() {
    const db = getDb();
    const now = new Date().toISOString();

    const pendentes = db.prepare(
      "SELECT f.*, l.telefone, l.nome, l.provedor, l.agente_atual FROM followups f JOIN leads l ON f.lead_id = l.id WHERE f.status = 'pendente' AND f.proximo_envio <= ?"
    ).all(now);

    if (pendentes.length === 0) return;

    console.log(`[FOLLOWUP] Processando ${pendentes.length} followups`);

    for (const f of pendentes) {
      try {
        // Gerar mensagem de follow-up via Claude
        const result = await claude.sendToAgent(f.agente,
          `Gere um follow-up curto (max 2 frases) para o lead ${f.nome || 'desconhecido'} do provedor ${f.provedor || '?'}. Esta e a tentativa ${f.tentativa} de ${MAX_TENTATIVAS}. Ultima mensagem: "${(f.mensagem_original || '').substring(0, 200)}". Tom: amigavel, sem pressao, mostre que lembrou dele. SEM markdown.`,
          { leadData: { nome: f.nome, provedor: f.provedor } }
        );

        // Enviar via Z-API
        await zapi.sendText(f.telefone, result.resposta);

        // Registrar conversa
        db.prepare(
          "INSERT INTO conversas (lead_id, agente, direcao, mensagem, tipo, canal) VALUES (?, ?, 'enviada', ?, 'followup', 'whatsapp')"
        ).run(f.lead_id, f.agente, result.resposta);

        // Marcar como enviado
        db.prepare("UPDATE followups SET status = 'enviado' WHERE id = ?").run(f.id);

        // Agendar proximo followup se nao atingiu max
        if (f.tentativa < MAX_TENTATIVAS) {
          const proxHoras = FOLLOWUP_HOURS[f.tentativa] || 72;
          const proximoEnvio = new Date(Date.now() + proxHoras * 60 * 60 * 1000).toISOString();
          db.prepare(
            'INSERT INTO followups (lead_id, agente, mensagem_original, tentativa, proximo_envio) VALUES (?,?,?,?,?)'
          ).run(f.lead_id, f.agente, result.resposta, f.tentativa + 1, proximoEnvio);
        }

        console.log(`[FOLLOWUP] Enviado tentativa ${f.tentativa} para ${f.telefone}`);

        // Delay entre envios
        await new Promise(r => setTimeout(r, 3000));

      } catch (err) {
        console.error(`[FOLLOWUP] Erro lead ${f.lead_id}:`, err.message);
      }
    }
  }

  /**
   * Listar followups pendentes
   */
  getPending() {
    const db = getDb();
    return db.prepare(
      "SELECT f.*, l.nome, l.telefone, l.provedor FROM followups f JOIN leads l ON f.lead_id = l.id WHERE f.status = 'pendente' ORDER BY f.proximo_envio ASC"
    ).all();
  }
}

module.exports = new FollowupService();
