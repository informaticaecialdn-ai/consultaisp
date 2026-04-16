const { getDb } = require('../models/database');

class TrainingService {

  learn(agentKey, tipo, regra, contexto = null) {
    const db = getDb();

    // Enriquecer contexto com taskType inferido
    const taskType = this._inferRuleTaskType(regra);
    const enrichedContexto = contexto
      ? `${contexto} [taskType: ${taskType}]`
      : `[taskType: ${taskType}]`;

    const existing = db.prepare(
      'SELECT * FROM treinamento_agentes WHERE agente = ? AND tipo = ? AND regra = ?'
    ).get(agentKey, tipo, regra);

    if (existing) {
      db.prepare(
        'UPDATE treinamento_agentes SET vezes_aplicada = vezes_aplicada + 1, confianca = MIN(1.0, confianca + 0.05), atualizado_em = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(existing.id);
      return existing.id;
    }

    const result = db.prepare(
      'INSERT INTO treinamento_agentes (agente, tipo, regra, contexto, fonte) VALUES (?, ?, ?, ?, ?)'
    ).run(agentKey, tipo, regra, enrichedContexto, 'automatico');

    console.log(`[TRAINING] ${agentKey} aprendeu: [${tipo}] ${regra.substring(0, 80)}...`);
    return result.lastInsertRowid;
  }

  recordSuccess(ruleId) {
    const db = getDb();
    db.prepare(
      'UPDATE treinamento_agentes SET vezes_sucesso = vezes_sucesso + 1, confianca = MIN(1.0, confianca + 0.1), atualizado_em = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(ruleId);
  }

  recordFailure(ruleId) {
    const db = getDb();
    db.prepare(
      'UPDATE treinamento_agentes SET confianca = MAX(0, confianca - 0.1), atualizado_em = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(ruleId);
  }

  getRulesForAgent(agentKey, limit = 15) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM treinamento_agentes WHERE agente = ? AND ativo = 1 AND confianca >= 0.3 ORDER BY confianca DESC, vezes_sucesso DESC LIMIT ?'
    ).all(agentKey, limit);
  }

  getTrainingContext(agentKey) {
    const rules = this.getRulesForAgent(agentKey);
    if (rules.length === 0) return '';

    const grouped = {};
    for (const rule of rules) {
      if (!grouped[rule.tipo]) grouped[rule.tipo] = [];
      grouped[rule.tipo].push(rule.regra);
    }

    let context = '\n\nAPRENDIZADOS DAS CONVERSAS ANTERIORES:\n';
    for (const [tipo, regras] of Object.entries(grouped)) {
      const label = {
        'objecao_superada': 'Objecoes que funcionaram',
        'abordagem_eficaz': 'Abordagens eficazes',
        'regiao_insight': 'Insights regionais',
        'persona_insight': 'Insights de persona',
        'frase_converte': 'Frases que convertem',
        'erro_evitar': 'Erros a evitar',
        'timing_ideal': 'Timing ideal'
      }[tipo] || tipo;

      context += `\n${label}:\n`;
      for (const regra of regras) {
        context += `- ${regra}\n`;
      }
    }
    return context;
  }

  async analyzeConversation(agentKey, conversation, outcome, claudeClient) {
    try {
      const response = await claudeClient.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: 'Voce analisa conversas de vendas e extrai aprendizados acionaveis. Responda APENAS em JSON.',
        messages: [{
          role: 'user',
          content: `Analise esta conversa de vendas do agente ${agentKey} com resultado "${outcome}" e extraia aprendizados.

CONVERSA:
${conversation}

Responda em JSON:
{
  "aprendizados": [
    {
      "tipo": "objecao_superada|abordagem_eficaz|regiao_insight|persona_insight|frase_converte|erro_evitar|timing_ideal",
      "regra": "descricao concisa do aprendizado (max 150 chars)",
      "contexto": "quando aplicar (opcional)"
    }
  ]
}`
        }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        for (const item of (result.aprendizados || [])) {
          this.learn(agentKey, item.tipo, item.regra, item.contexto);
        }
        return result.aprendizados;
      }
    } catch (e) {
      console.error(`[TRAINING] Erro na analise:`, e.message);
    }
    return [];
  }

  async evaluateResponse(agentKey, leadId, conversaId, agentResponse, leadMessage, leadData, claudeClient) {
    try {
      const response = await claudeClient.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: 'Voce e um supervisor de vendas. Avalie a resposta do agente. Responda APENAS em JSON.',
        messages: [{
          role: 'user',
          content: `Agente: ${agentKey}
Lead: ${leadData.nome || 'desconhecido'} (${leadData.provedor || '?'}, ${leadData.porte || '?'})
Etapa: ${leadData.etapa_funil}

Lead disse: "${leadMessage}"
Agente respondeu: "${agentResponse}"

Avalie em JSON:
{
  "nota": 1,
  "sentimento_lead": "positivo|neutro|negativo",
  "problemas": ["lista de problemas se houver"],
  "sugestao": "melhoria sugerida",
  "tags": ["regiao", "porte", "erp"]
}`
        }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const avaliacao = JSON.parse(jsonMatch[0]);
        const db = getDb();

        db.prepare(
          'INSERT INTO avaliacoes (lead_id, agente, conversa_id, nota, sentimento, problemas, sugestao, tags) VALUES (?,?,?,?,?,?,?,?)'
        ).run(
          leadId, agentKey, conversaId,
          avaliacao.nota,
          avaliacao.sentimento_lead,
          JSON.stringify(avaliacao.problemas || []),
          avaliacao.sugestao,
          JSON.stringify(avaliacao.tags || [])
        );

        if (avaliacao.nota >= 4) {
          this.learn(agentKey, 'frase_converte',
            `Lead: "${leadMessage.substring(0, 80)}" -> Agente: "${agentResponse.substring(0, 80)}"`,
            `nota ${avaliacao.nota}, ${avaliacao.sentimento_lead}`
          );
        }

        if (avaliacao.nota <= 2 && avaliacao.problemas?.length > 0) {
          this.learn(agentKey, 'erro_evitar',
            avaliacao.problemas[0],
            avaliacao.sugestao
          );
        }

        const count = db.prepare('SELECT COUNT(*) as c FROM avaliacoes WHERE agente = ?').get(agentKey).c;
        if (count % 10 === 0 && count > 0) {
          this._analyzePatterns(agentKey, claudeClient).catch(e =>
            console.error('[TRAINING] Erro patterns:', e.message)
          );
        }

        return avaliacao;
      }
    } catch (e) {
      console.error(`[TRAINING] Erro avaliacao:`, e.message);
    }
    return null;
  }

  async _analyzePatterns(agentKey, claudeClient) {
    const db = getDb();
    const recent = db.prepare(
      'SELECT * FROM avaliacoes WHERE agente = ? ORDER BY criado_em DESC LIMIT 10'
    ).all(agentKey);

    const avgNota = recent.reduce((s, a) => s + a.nota, 0) / recent.length;
    const problemas = recent.flatMap(a => {
      try { return JSON.parse(a.problemas || '[]'); } catch { return []; }
    });

    const response = await claudeClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: 'Analise padroes de avaliacao e sugira regras de melhoria. Responda em JSON.',
      messages: [{
        role: 'user',
        content: `Ultimas 10 avaliacoes do agente ${agentKey}:
Nota media: ${avgNota.toFixed(1)}
Problemas frequentes: ${[...new Set(problemas)].join(', ')}
Sugestoes: ${recent.map(a => a.sugestao).filter(Boolean).join('; ')}

Sugira ate 3 regras em JSON:
{ "regras": [{ "tipo": "...", "regra": "...", "contexto": "..." }] }`
      }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      for (const r of (result.regras || [])) {
        this.learn(agentKey, r.tipo, r.regra, r.contexto);
      }
      console.log(`[TRAINING] ${agentKey}: ${result.regras?.length || 0} regras sugeridas`);
    }
  }

  _inferRuleTaskType(regra) {
    const r = (regra || '').toUpperCase();
    if (r.includes('PRECO') || r.includes('CARO') || r.includes('DESCONTO')) return 'pricing';
    if (r.includes('EMAIL') || r.includes('MENSAGEM')) return 'cold-email';
    if (r.includes('DEMO') || r.includes('APRESENTA')) return 'sales';
    if (r.includes('FECHA') || r.includes('CONTRATO')) return 'closing';
    if (r.includes('REGIAO') || r.includes('CIDADE')) return 'lead-research';
    return 'general';
  }

  disable(ruleId) {
    const db = getDb();
    db.prepare('UPDATE treinamento_agentes SET ativo = 0 WHERE id = ?').run(ruleId);
  }

  getStats() {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) as c FROM treinamento_agentes WHERE ativo = 1').get().c,
      por_agente: db.prepare('SELECT agente, COUNT(*) as c FROM treinamento_agentes WHERE ativo = 1 GROUP BY agente').all(),
      por_tipo: db.prepare('SELECT tipo, COUNT(*) as c FROM treinamento_agentes WHERE ativo = 1 GROUP BY tipo').all(),
      top_regras: db.prepare('SELECT * FROM treinamento_agentes WHERE ativo = 1 ORDER BY confianca DESC LIMIT 10').all()
    };
  }
}

module.exports = new TrainingService();
