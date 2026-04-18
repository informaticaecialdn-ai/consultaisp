const { getDb } = require('../models/database');
const training = require('./training');
const logger = require('../utils/logger');

class ABTestingService {

  /**
   * Criar teste A/B (Leo gera variantes externamente, passadas aqui)
   */
  createTest(agente, tipoMensagem, varianteA, varianteB, minEnvios = 20) {
    const db = getDb();
    const result = db.prepare(
      'INSERT INTO ab_tests (agente, tipo_mensagem, variante_a, variante_b, min_envios) VALUES (?,?,?,?,?)'
    ).run(agente, tipoMensagem, varianteA, varianteB, minEnvios);
    logger.info({ agente, tipoMensagem, id: result.lastInsertRowid }, '[A/B] teste criado');
    return result.lastInsertRowid;
  }

  /**
   * Pegar variante pra enviar (round-robin baseado em envios)
   * Retorna { testId, variante: 'a'|'b', mensagem } ou null se nao tem teste ativo
   */
  getVariant(agente, tipoMensagem) {
    const db = getDb();
    const test = db.prepare(
      "SELECT * FROM ab_tests WHERE agente = ? AND tipo_mensagem = ? AND status = 'ativo'"
    ).get(agente, tipoMensagem);

    if (!test) return null;

    // Round-robin: envia pra variante com menos envios
    const variante = test.envios_a <= test.envios_b ? 'a' : 'b';
    const mensagem = variante === 'a' ? test.variante_a : test.variante_b;

    return { testId: test.id, variante, mensagem };
  }

  /**
   * Registrar envio de uma variante
   */
  recordSend(testId, variante) {
    const db = getDb();
    const campo = variante === 'a' ? 'envios_a' : 'envios_b';
    db.prepare(`UPDATE ab_tests SET ${campo} = ${campo} + 1 WHERE id = ?`).run(testId);
  }

  /**
   * Registrar resposta a uma variante
   */
  recordResponse(testId, variante) {
    const db = getDb();
    const campo = variante === 'a' ? 'respostas_a' : 'respostas_b';
    db.prepare(`UPDATE ab_tests SET ${campo} = ${campo} + 1 WHERE id = ?`).run(testId);

    // Verificar se chegou no minimo pra declarar vencedor
    this.checkWinner(testId);
  }

  /**
   * Verificar se teste pode ser concluido
   */
  checkWinner(testId) {
    const db = getDb();
    const test = db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(testId);
    if (!test || test.status !== 'ativo') return null;

    if (test.envios_a >= test.min_envios && test.envios_b >= test.min_envios) {
      const taxaA = test.envios_a > 0 ? test.respostas_a / test.envios_a : 0;
      const taxaB = test.envios_b > 0 ? test.respostas_b / test.envios_b : 0;

      const vencedor = taxaA >= taxaB ? 'a' : 'b';
      const msgVencedora = vencedor === 'a' ? test.variante_a : test.variante_b;
      const taxaVencedora = vencedor === 'a' ? taxaA : taxaB;

      db.prepare(
        "UPDATE ab_tests SET vencedor = ?, status = 'concluido' WHERE id = ?"
      ).run(vencedor, testId);

      // Ensinar pro training que essa frase converte melhor
      training.learn(
        test.agente,
        'frase_converte',
        `[A/B vencedor ${test.tipo_mensagem}] ${msgVencedora.substring(0, 150)}`,
        `Taxa ${(taxaVencedora * 100).toFixed(0)}% vs ${((vencedor === 'a' ? taxaB : taxaA) * 100).toFixed(0)}%`
      );

      logger.info({ testId, vencedor, taxa_pct: (taxaVencedora * 100).toFixed(0) }, '[A/B] teste concluido');
      return vencedor;
    }

    return null;
  }

  /**
   * Listar testes
   */
  list(status = null) {
    const db = getDb();
    if (status) {
      return db.prepare('SELECT * FROM ab_tests WHERE status = ? ORDER BY criado_em DESC').all(status);
    }
    return db.prepare('SELECT * FROM ab_tests ORDER BY criado_em DESC').all();
  }

  /**
   * Detalhe com taxas calculadas
   */
  getDetail(testId) {
    const db = getDb();
    const test = db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(testId);
    if (!test) return null;

    return {
      ...test,
      taxa_a: test.envios_a > 0 ? (test.respostas_a / test.envios_a * 100).toFixed(1) + '%' : '0%',
      taxa_b: test.envios_b > 0 ? (test.respostas_b / test.envios_b * 100).toFixed(1) + '%' : '0%',
    };
  }

  /**
   * Forcar conclusao de um teste
   */
  conclude(testId) {
    const db = getDb();
    const test = db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(testId);
    if (!test || test.status !== 'ativo') return null;

    const taxaA = test.envios_a > 0 ? test.respostas_a / test.envios_a : 0;
    const taxaB = test.envios_b > 0 ? test.respostas_b / test.envios_b : 0;
    const vencedor = taxaA >= taxaB ? 'a' : 'b';

    db.prepare("UPDATE ab_tests SET vencedor = ?, status = 'concluido' WHERE id = ?").run(vencedor, testId);
    return vencedor;
  }
}

module.exports = new ABTestingService();
