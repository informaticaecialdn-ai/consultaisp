// Template engine + runner pras sequencias de email do Sofia.
// Templates hardcoded por enquanto (pode virar tabela editavel depois).

const { getDb } = require('../models/database');
const emailSender = require('./email-sender');
const logger = require('../utils/logger');

// Sequencias pre-definidas. Cada step = { delayDaysFromPrev, subject, body(lead) }
const SEQUENCES = {
  // Nurturing: lead frio que pediu "retorno depois" — 5 emails ao longo de 45d
  nurturing: [
    {
      delayDaysFromPrev: 0, // primeiro envio imediato ao ativar
      subject: (lead) => `${lead.nome ? lead.nome.split(' ')[0] : 'Ola'}, valeu pela conversa — ficou pra depois`,
      body: (lead) => `Oi ${lead.nome?.split(' ')[0] || ''}!

Valeu pelo papo sobre a ${lead.provedor || 'sua operacao'}. Entendi que agora nao e o momento.

Deixa eu te dar um panorama em 1 paragrafo pra voce saber que existe quando precisar:

A gente e uma base colaborativa de inadimplencia entre provedores regionais — provedor A nos conta quem deu calote nele, o provedor B (voce) consulta e evita contratar. Ja temos ${lead.mesorregiao_nome ? 'provedores na regiao ' + lead.mesorregiao_nome : 'varios provedores regionais'} rodando.

Te mando 1 email por mes com um case real. Sem pressao. Se quiser sair dessa lista, e so responder "sair".

Abraco,
Sofia — Consulta ISP`
    },
    {
      delayDaysFromPrev: 7,
      subject: (lead) => `[Case] Provedor que cortou 40% do calote em 60 dias`,
      body: (lead) => `Oi ${lead.nome?.split(' ')[0] || ''}!

Quero te mostrar um case real (com permissao — nome alterado):

A FiberTech (nome ficticio), 1200 clientes em ${lead.mesorregiao_nome || 'regiao interior'}, tinha 4% de inadimplencia mensal. Depois de 60 dias rodando o Consulta ISP:

- Bloquearam 23 novos contratos que eram clientes caloteiros de outros provedores
- Identificaram 8 migradores seriais na regiao
- Reduziram a inadimplencia pra 2.4%

Conta batida: R$12k/mes a menos em calote. O plano Profissional (R$349/mes) pagou 35x no primeiro trimestre.

Se isso faz sentido pra sua realidade, me avisa. Posso ate te mandar o link direto.

Sofia`
    },
    {
      delayDaysFromPrev: 14,
      subject: () => `O que voce faz quando o cliente cancela e leva a ONU?`,
      body: (lead) => `Oi ${lead.nome?.split(' ')[0] || ''},

Pergunta direta: quantos equipamentos voce ja perdeu em cancelamentos?

Se a resposta e >3 no ultimo ano, vale conversar. A gente rastreia equipamento por CPF — quando o cliente tenta contratar em OUTRO provedor da regiao, o sistema avisa que ele ta com sua ONU.

Isso dobra a chance de recuperacao do hardware.

Quer ver como funciona? Respondo em <1h.

Sofia`
    },
    {
      delayDaysFromPrev: 14,
      subject: () => `A rede colaborativa esta crescendo — estamos em ${lead_placeholder_mesorregiao}?`,
      body: (lead) => `Oi ${lead.nome?.split(' ')[0] || ''},

Rapido: nos ultimos 30 dias, entraram mais 12 provedores na base regional. A rede cresce = cada novo cliente detectado beneficia TODOS.

Na sua regiao (${lead.mesorregiao_nome || 'interior'}), estamos mapeando provedores ativos. Se voce quiser ser dos primeiros (vantagem competitiva real: ve todos os calotes da regiao mas concorrentes nao veem os SEUS), e hora de entrar.

Plano ${lead.porte === 'grande' || lead.porte === 'enterprise' ? 'Enterprise' : 'Profissional'} cobre voce. Primeiro mes sem fidelidade — testa e cancela se nao gostar.

Posso agendar 15min?

Sofia`
    },
    {
      delayDaysFromPrev: 10,
      subject: () => `Ultimo email nessa sequencia — me diz se sigo ou paro`,
      body: (lead) => `Oi ${lead.nome?.split(' ')[0] || ''},

Esse e o ultimo email automatico da sequencia. Se voce nao respondeu ate aqui, assumo que nao e o momento e vou te deixar em paz.

Mas caso mude de ideia:
- Link pra agendar 15min: https://consultaisp.com.br/demo
- Meu whats: (resposta aqui mesmo responde pra mim)

Se quiser continuar recebendo updates mensais, responde "continuar". Senao, tudo certo, parei.

Obrigada pelo tempo,
Sofia`
    }
  ],

  // Reengagement: lead morno que virou frio — 3 emails em 21 dias
  reengagement: [
    {
      delayDaysFromPrev: 0,
      subject: () => `Faz um tempo que nao falamos — novidade aqui`,
      body: (lead) => `Oi ${lead.nome?.split(' ')[0] || ''},

Faz tempo que nao conversamos sobre a ${lead.provedor || 'base colaborativa'}.

Atualizacao rapida: desde a nossa ultima conversa, duplicamos a cobertura regional e adicionamos deteccao de fraude por migracao serial (cliente sai de um provedor e tenta outro na mesma semana).

Se voltou a fazer sentido ai, respondo em <1h.

Sofia`
    },
    {
      delayDaysFromPrev: 10,
      subject: () => `Cotacao especial: 1 mes gratis pra voce testar`,
      body: (lead) => `Oi ${lead.nome?.split(' ')[0] || ''},

Pra caso o preco tenha sido o empecilho: tenho autorizacao pra liberar 1 mes gratis de teste, sem cartao. Se voce topar, crio seu acesso hoje e a gente ve juntos em 30 dias se faz sentido.

Oferta valida ate o fim desse mes. Topa?

Sofia`
    },
    {
      delayDaysFromPrev: 11,
      subject: () => `Ok, paro de te mandar email`,
      body: (lead) => `Oi ${lead.nome?.split(' ')[0] || ''},

Entendi que nao e agora. Removi voce da lista de emails automaticos.

Se precisar de algo no futuro, e so me chamar. Vou estar aqui.

Sucesso com a operacao!
Sofia`
    }
  ]
};

// Inicia uma sequencia pra um lead
function startSequence({ leadId, type = 'nurturing' }) {
  const db = getDb();
  const sequence = SEQUENCES[type];
  if (!sequence) throw new Error(`sequencia ${type} nao existe`);

  // Verifica se ja ha ativa pra esse lead (nao duplica)
  const existing = db.prepare(
    `SELECT id FROM email_sequences WHERE lead_id = ? AND status = 'ativa'`
  ).get(leadId);
  if (existing) {
    return { already_active: true, sequence_id: existing.id };
  }

  // Primeiro envio imediato (delay 0)
  const proximoEnvio = new Date(Date.now() + sequence[0].delayDaysFromPrev * 86400_000).toISOString();

  const result = db.prepare(
    `INSERT INTO email_sequences (lead_id, sequence_type, step_atual, total_steps, status, proximo_envio_em)
     VALUES (?, ?, 0, ?, 'ativa', ?)`
  ).run(leadId, type, sequence.length, proximoEnvio);

  return { sequence_id: result.lastInsertRowid, steps: sequence.length };
}

// Processa filas: envia emails com proximo_envio_em vencido
async function processDueSequences({ limit = 50 } = {}) {
  if (!emailSender.isConfigured()) {
    return { skipped: true, reason: 'resend_not_configured' };
  }

  const db = getDb();
  const due = db.prepare(
    `SELECT s.*, l.email, l.nome, l.provedor, l.mesorregiao_nome, l.porte, l.telefone
     FROM email_sequences s
     JOIN leads l ON l.id = s.lead_id
     WHERE s.status = 'ativa'
       AND s.proximo_envio_em <= CURRENT_TIMESTAMP
       AND l.email IS NOT NULL AND l.email != ''
     LIMIT ?`
  ).all(Number(limit) || 50);

  const results = { processed: 0, sent: 0, errors: 0, completed: 0 };

  for (const seq of due) {
    results.processed++;
    const template = SEQUENCES[seq.sequence_type];
    if (!template || !template[seq.step_atual]) {
      // Step alem do limite → completa sequencia
      db.prepare(
        `UPDATE email_sequences SET status = 'completada', atualizada_em = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(seq.id);
      results.completed++;
      continue;
    }

    const step = template[seq.step_atual];
    const lead = {
      nome: seq.nome,
      provedor: seq.provedor,
      mesorregiao_nome: seq.mesorregiao_nome,
      porte: seq.porte,
      email: seq.email
    };

    try {
      const subject = typeof step.subject === 'function' ? step.subject(lead) : step.subject;
      const body = typeof step.body === 'function' ? step.body(lead) : step.body;

      const sendResult = await emailSender.sendEmail(seq.email, subject, body);

      db.prepare(
        `INSERT INTO email_sequence_sends
           (sequence_id, lead_id, step, subject, body_preview, resend_id, status, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        seq.id, seq.lead_id, seq.step_atual,
        subject.slice(0, 200),
        body.slice(0, 200),
        sendResult?.id || null,
        sendResult?.success ? 'sent' : 'failed',
        sendResult?.success ? null : (sendResult?.error || 'unknown')
      );

      // Avanca step + calcula proximo envio
      const nextStep = seq.step_atual + 1;
      const isLast = nextStep >= template.length;
      let proximoEnvio = null;
      if (!isLast) {
        const delayDays = template[nextStep].delayDaysFromPrev;
        proximoEnvio = new Date(Date.now() + delayDays * 86400_000).toISOString();
      }

      db.prepare(
        `UPDATE email_sequences SET
           step_atual = ?,
           status = CASE WHEN ? THEN 'completada' ELSE 'ativa' END,
           ultimo_enviado_em = CURRENT_TIMESTAMP,
           proximo_envio_em = ?,
           atualizada_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(nextStep, isLast ? 1 : 0, proximoEnvio, seq.id);

      if (sendResult?.success) results.sent++;
      else results.errors++;
      if (isLast) results.completed++;
    } catch (err) {
      logger.error({ sequence_id: seq.id, err: err.message }, '[EMAIL_SEQ] erro no envio');
      results.errors++;
    }
  }

  return results;
}

function pauseSequence(sequenceId) {
  const db = getDb();
  db.prepare(`UPDATE email_sequences SET status = 'pausada', atualizada_em = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(sequenceId);
  return { ok: true };
}

function stats() {
  const db = getDb();
  try {
    const porStatus = db.prepare(
      `SELECT status, COUNT(*) AS c FROM email_sequences GROUP BY status`
    ).all();
    const enviados7d = db.prepare(
      "SELECT COUNT(*) AS c FROM email_sequence_sends WHERE sent_at > DATETIME('now','-7 days') AND status = 'sent'"
    ).get().c;
    return { by_status: porStatus, enviados_7d: enviados7d };
  } catch {
    return { by_status: [], enviados_7d: 0, _migration_pending: true };
  }
}

module.exports = { SEQUENCES, startSequence, processDueSequences, pauseSequence, stats };
