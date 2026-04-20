// Query builder para audiencias dinamicas (Sprint 4 / T1).
// Usa WHITELIST estrita — filtros nao permitidos sao IGNORADOS silenciosamente.
// NUNCA interpola strings no SQL: tudo via prepared params.

const ETAPAS_VALIDAS = new Set([
  'novo', 'prospeccao', 'qualificacao', 'demo_agendada',
  'proposta_enviada', 'negociacao', 'fechamento',
  'convertido', 'nurturing', 'perdido',
]);

const CLASSIFICACOES_VALIDAS = new Set([
  'frio', 'morno', 'quente', 'ultra_quente',
]);

const AGENTES_VALIDOS = new Set([
  'carlos', 'lucas', 'rafael', 'sofia', 'marcos', 'leo', 'iani',
]);

// Retorna { where, params } com clausulas preparadas.
// `filtros` pode vir como objeto JS ou string JSON.
function build(filtros) {
  let f = {};
  if (typeof filtros === 'string') {
    try { f = JSON.parse(filtros); } catch { f = {}; }
  } else if (filtros && typeof filtros === 'object') {
    f = filtros;
  }

  const where = [];
  const params = [];

  if (f.classificacao && CLASSIFICACOES_VALIDAS.has(f.classificacao)) {
    where.push('classificacao = ?');
    params.push(f.classificacao);
  }

  if (f.etapa_funil && ETAPAS_VALIDAS.has(f.etapa_funil)) {
    where.push('etapa_funil = ?');
    params.push(f.etapa_funil);
  }

  if (Array.isArray(f.exclui_etapas) && f.exclui_etapas.length) {
    const etapas = f.exclui_etapas.filter(e => ETAPAS_VALIDAS.has(e));
    if (etapas.length) {
      const placeholders = etapas.map(() => '?').join(',');
      where.push(`etapa_funil NOT IN (${placeholders})`);
      params.push(...etapas);
    }
  }

  if (f.regiao && typeof f.regiao === 'string' && f.regiao.length <= 100) {
    where.push('(regiao = ? OR estado = ?)');
    params.push(f.regiao, f.regiao);
  }

  if (f.agente_atual && AGENTES_VALIDOS.has(f.agente_atual)) {
    where.push('agente_atual = ?');
    params.push(f.agente_atual);
  }

  if (Number.isFinite(f.score_min)) {
    where.push('score_total >= ?');
    params.push(Math.max(0, Math.min(100, Number(f.score_min))));
  }
  if (Number.isFinite(f.score_max)) {
    where.push('score_total <= ?');
    params.push(Math.max(0, Math.min(100, Number(f.score_max))));
  }

  if (f.tem_optin === true) {
    where.push(
      `telefone IN (SELECT telefone FROM lead_opt_out WHERE status = 'ativo')`
    );
  } else if (f.tem_optin === false) {
    where.push(
      `telefone NOT IN (SELECT telefone FROM lead_opt_out WHERE status = 'optout')`
    );
  }

  if (Number.isFinite(f.ultima_atividade_dias_max)) {
    const dias = Math.max(0, Math.min(365, Number(f.ultima_atividade_dias_max)));
    // Lead com alguma conversa nos ultimos N dias
    where.push(
      `id IN (SELECT DISTINCT lead_id FROM conversas WHERE criado_em >= DATETIME('now', ?))`
    );
    params.push(`-${dias} days`);
  }

  return {
    where: where.length ? where.join(' AND ') : '1=1',
    params,
  };
}

module.exports = {
  build,
  ETAPAS_VALIDAS,
  CLASSIFICACOES_VALIDAS,
  AGENTES_VALIDOS,
};
