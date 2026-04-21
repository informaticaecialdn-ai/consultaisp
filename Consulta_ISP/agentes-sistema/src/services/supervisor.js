const claude = require('./claude');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');

class SupervisorService {
  constructor() {
    this.activeTasks = new Map(); // taskId -> { demanda, plano, resultados, status }
  }

  // Recebe demanda de alto nivel e gera plano de execucao
  async createDemand(demanda, contexto = {}) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    logger.info({ taskId, demanda }, '[SUPERVISOR] nova demanda');

    // Bia analisa a demanda e cria plano
    const plano = await claude.sendToAgent('bia', `
NOVA DEMANDA RECEBIDA:
"${demanda}"

CONTEXTO ADICIONAL:
${JSON.stringify(contexto, null, 2)}

DADOS DO SISTEMA:
- Leads ativos: ${this._getLeadCount()}
- Campanhas ativas: ${contexto.campanhas_ativas || 'nao informado'}

Analise esta demanda e crie o plano de execucao em JSON conforme seu formato padrao.
    `);

    // Parseia o plano
    let planoObj;
    try {
      const jsonMatch = plano.resposta.match(/\{[\s\S]*\}/);
      planoObj = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      logger.error({ err: e.message }, '[SUPERVISOR] erro ao parsear plano');
      planoObj = null;
    }

    if (!planoObj) {
      return {
        taskId,
        status: 'erro',
        mensagem: 'Bia nao conseguiu criar plano estruturado',
        resposta_raw: plano.resposta
      };
    }

    // Armazena a task
    this.activeTasks.set(taskId, {
      taskId,
      demanda,
      plano: planoObj,
      resultados: [],
      status: 'planejado',
      criado_em: new Date().toISOString()
    });

    // Registra atividade
    this._logActivity('bia', 'plano_criado', `Demanda: ${demanda} | Tarefas: ${planoObj.plano_execucao?.length || 0}`);

    return {
      taskId,
      status: 'planejado',
      plano: planoObj,
      tokens_usados: plano.tokens_usados
    };
  }

  // Executa o plano passo a passo
  async executePlan(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} nao encontrada`);

    task.status = 'executando';
    const plano = task.plano;
    const resultados = [];

    logger.info({ taskId, total: plano.plano_execucao.length }, '[SUPERVISOR] executando plano');

    // Agrupa por ordem para identificar tarefas paralelas vs sequenciais
    const tarefasPorOrdem = {};
    for (const tarefa of plano.plano_execucao) {
      const ordem = tarefa.ordem || 1;
      if (!tarefasPorOrdem[ordem]) tarefasPorOrdem[ordem] = [];
      tarefasPorOrdem[ordem].push(tarefa);
    }

    const ordensSequenciais = Object.keys(tarefasPorOrdem).sort((a, b) => a - b);

    for (const ordem of ordensSequenciais) {
      const tarefasNaOrdem = tarefasPorOrdem[ordem];

      logger.info({ ordem, tarefas: tarefasNaOrdem.length }, '[SUPERVISOR] executando ordem');

      // Verifica dependencias
      for (const tarefa of tarefasNaOrdem) {
        if (tarefa.depende_de) {
          const resultadoDependencia = resultados.find(r => r.ordem === tarefa.depende_de);
          if (resultadoDependencia) {
            tarefa.briefing += `\n\nRESULTADO DA TAREFA ANTERIOR (${resultadoDependencia.agente}):\n${resultadoDependencia.resultado}`;
          }
        }
      }

      // Executa tarefas da mesma ordem em paralelo
      const promises = tarefasNaOrdem.map(async (tarefa) => {
        try {
          logger.info({ agente: tarefa.agente, tarefa: String(tarefa.tarefa || '').slice(0, 80) }, '[SUPERVISOR] delegando');

          const resultado = await claude.sendToAgent(tarefa.agente, tarefa.briefing, {});

          this._logActivity(tarefa.agente, 'tarefa_executada', `Tarefa: ${tarefa.tarefa}`);

          return {
            ordem: tarefa.ordem,
            agente: tarefa.agente,
            tarefa: tarefa.tarefa,
            resultado: resultado.resposta,
            tokens: resultado.tokens_usados,
            status: 'concluido'
          };
        } catch (error) {
          logger.error({ agente: tarefa.agente, err: error.message }, '[SUPERVISOR] erro no agente');
          return {
            ordem: tarefa.ordem,
            agente: tarefa.agente,
            tarefa: tarefa.tarefa,
            resultado: null,
            erro: error.message,
            status: 'erro'
          };
        }
      });

      const resultadosOrdem = await Promise.all(promises);
      resultados.push(...resultadosOrdem);
    }

    task.resultados = resultados;

    // Bia consolida os resultados
    const consolidacao = await this._consolidateResults(task);

    task.status = 'concluido';
    task.consolidacao = consolidacao;
    task.concluido_em = new Date().toISOString();

    this._logActivity('bia', 'plano_concluido', `Task ${taskId}: ${resultados.filter(r => r.status === 'concluido').length}/${resultados.length} tarefas OK`);

    return {
      taskId,
      status: 'concluido',
      consolidacao,
      resultados_detalhados: resultados,
      tokens_total: resultados.reduce((sum, r) => sum + (r.tokens || 0), 0)
    };
  }

  // Bia consolida todos os resultados em um relatorio final
  async _consolidateResults(task) {
    const resumoResultados = task.resultados.map(r =>
      `[${r.agente.toUpperCase()}] ${r.tarefa}:\n${r.status === 'concluido' ? r.resultado : 'ERRO: ' + r.erro}`
    ).join('\n\n---\n\n');

    const response = await claude.sendToAgent('bia', `
CONSOLIDACAO DE RESULTADOS:

DEMANDA ORIGINAL: "${task.demanda}"

RESULTADOS DOS AGENTES:
${resumoResultados}

Consolide estes resultados no formato JSON padrao de consolidacao. Avalie a qualidade de cada entrega e defina proximos passos.
    `);

    try {
      const jsonMatch = response.resposta.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { resumo: response.resposta };
    } catch (e) {
      return { resumo: response.resposta };
    }
  }

  // Execucao rapida: cria plano e executa em um unico fluxo
  async executeFullDemand(demanda, contexto = {}) {
    const planResult = await this.createDemand(demanda, contexto);

    if (planResult.status === 'erro') return planResult;

    return this.executePlan(planResult.taskId);
  }

  // Pede para Bia analisar uma situacao e recomendar acoes
  async analyzeAndRecommend(situacao, dados = {}) {
    const response = await claude.sendToAgent('bia', `
ANALISE SOLICITADA:
${situacao}

DADOS DISPONÍVEIS:
${JSON.stringify(dados, null, 2)}

Analise esta situacao, identifique problemas e recomende acoes especificas.
Indique quais agentes devem ser acionados para cada acao.
Responda em JSON:
{
  "diagnostico": "analise da situacao",
  "problemas_identificados": ["lista de problemas"],
  "recomendacoes": [
    {
      "acao": "descricao da acao",
      "agente_responsavel": "nome",
      "prioridade": "alta|media|baixa",
      "impacto_esperado": "descricao"
    }
  ],
  "urgencia": "critica|alta|media|baixa"
}
    `);

    try {
      const jsonMatch = response.resposta.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { analise: response.resposta };
    } catch (e) {
      return { analise: response.resposta };
    }
  }

  // Pede para um agente especifico via Bia (com contexto gerencial)
  async delegateToAgent(agentKey, tarefa, contexto = {}) {
    logger.info({ agente: agentKey, tarefa: String(tarefa || '').slice(0, 80) }, '[SUPERVISOR] delegando (simples)');

    const resultado = await claude.sendToAgent(agentKey, tarefa, contexto);

    this._logActivity(agentKey, 'tarefa_delegada', `Tarefa delegada pela Bia: ${tarefa.substring(0, 100)}`);

    return resultado;
  }

  // Gera relatorio consolidado de todos os agentes
  async generateTeamReport(periodo = '7d') {
    const response = await claude.sendToAgent('bia', `
SOLICITACAO: Gere um relatorio consolidado da equipe.

PERIODO: ultimos ${periodo}

DADOS DISPONÍVEIS DO SISTEMA:
- Atividades recentes: ${JSON.stringify(this._getRecentActivities(periodo))}
- Tasks executadas: ${this.activeTasks.size}

Crie um relatorio executivo com:
1. Resumo de atividades por agente
2. Metricas chave (leads, campanhas, vendas)
3. Problemas identificados
4. Recomendacoes para proxima semana
    `);

    return {
      periodo,
      relatorio: response.resposta,
      tokens: response.tokens_usados
    };
  }

  // Retorna status de uma task ativa
  getTaskStatus(taskId) {
    return this.activeTasks.get(taskId) || null;
  }

  // Lista todas as tasks
  listTasks() {
    return Array.from(this.activeTasks.values()).map(t => ({
      taskId: t.taskId,
      demanda: t.demanda,
      status: t.status,
      tarefas_total: t.plano?.plano_execucao?.length || 0,
      tarefas_concluidas: t.resultados?.filter(r => r.status === 'concluido').length || 0,
      criado_em: t.criado_em,
      concluido_em: t.concluido_em
    }));
  }

  // Helpers
  _getLeadCount() {
    try {
      const db = getDb();
      const result = db.prepare('SELECT COUNT(*) as total FROM leads').get();
      return result?.total || 0;
    } catch (e) {
      return 0;
    }
  }

  _getRecentActivities(periodo) {
    try {
      const db = getDb();
      const dias = parseInt(periodo) || 7;
      const result = db.prepare(`
        SELECT agente, tipo, descricao, criado_em
        FROM atividades_agentes
        WHERE criado_em > datetime('now', ?)
        ORDER BY criado_em DESC
        LIMIT 50
      `).all(`-${dias} days`);
      return result || [];
    } catch (e) {
      return [];
    }
  }

  _logActivity(agente, tipo, descricao) {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO atividades_agentes (agente, tipo, descricao, criado_em)
        VALUES (?, ?, ?, datetime('now'))
      `).run(agente, tipo, descricao);
    } catch (e) {
      logger.error({ err: e.message }, '[SUPERVISOR] erro ao logar atividade');
    }
  }
}

module.exports = new SupervisorService();
