const express = require('express');
const router = express.Router();
const supervisor = require('../services/supervisor');

// POST /api/supervisor/demand - Cria uma nova demanda (Iani planeja)
router.post('/demand', async (req, res) => {
  try {
    const { demanda, contexto } = req.body;
    if (!demanda) return res.status(400).json({ erro: 'Campo "demanda" obrigatorio' });

    const resultado = await supervisor.createDemand(demanda, contexto || {});
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

// POST /api/supervisor/execute/:taskId - Executa plano de uma task ja planejada
router.post('/execute/:taskId', async (req, res) => {
  try {
    const resultado = await supervisor.executePlan(req.params.taskId);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

// POST /api/supervisor/run - Cria demanda E executa tudo de uma vez
router.post('/run', async (req, res) => {
  try {
    const { demanda, contexto } = req.body;
    if (!demanda) return res.status(400).json({ erro: 'Campo "demanda" obrigatorio' });

    const resultado = await supervisor.executeFullDemand(demanda, contexto || {});
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

// POST /api/supervisor/analyze - Iani analisa situacao e recomenda acoes
router.post('/analyze', async (req, res) => {
  try {
    const { situacao, dados } = req.body;
    if (!situacao) return res.status(400).json({ erro: 'Campo "situacao" obrigatorio' });

    const resultado = await supervisor.analyzeAndRecommend(situacao, dados || {});
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

// POST /api/supervisor/delegate - Delega tarefa especifica para um agente
router.post('/delegate', async (req, res) => {
  try {
    const { agente, tarefa, contexto } = req.body;
    if (!agente || !tarefa) return res.status(400).json({ erro: 'Campos "agente" e "tarefa" obrigatorios' });

    const resultado = await supervisor.delegateToAgent(agente, tarefa, contexto || {});
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

// GET /api/supervisor/report - Relatorio consolidado da equipe
router.get('/report', async (req, res) => {
  try {
    const periodo = req.query.periodo || '7d';
    const resultado = await supervisor.generateTeamReport(periodo);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

// GET /api/supervisor/tasks - Lista todas as tasks
router.get('/tasks', (req, res) => {
  try {
    const tasks = supervisor.listTasks();
    res.json({ tasks });
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

// GET /api/supervisor/tasks/:taskId - Status de uma task especifica
router.get('/tasks/:taskId', (req, res) => {
  try {
    const task = supervisor.getTaskStatus(req.params.taskId);
    if (!task) return res.status(404).json({ erro: 'Task nao encontrada' });
    res.json(task);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

module.exports = router;
