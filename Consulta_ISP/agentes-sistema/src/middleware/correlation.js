// Correlation ID middleware (Sprint 3 / T1).
// Le x-correlation-id do header ou gera UUID v4. Expoe no req/res + logger child.

const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

function correlationMiddleware(req, res, next) {
  const incoming = req.get('x-correlation-id') || req.get('X-Correlation-Id');
  const id = (incoming && /^[\w-]{8,64}$/.test(incoming)) ? incoming : randomUUID();
  req.correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  req.logger = logger.withCorrelation(id);
  next();
}

module.exports = correlationMiddleware;
