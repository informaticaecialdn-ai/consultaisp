// Monta um app Express minimal para supertest, sem listen() nem workers.
// Evita efeitos colaterais do src/server.js (listen, intervals, banner).

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { requireAuth } = require('../../src/middleware/auth');
const correlationMiddleware = require('../../src/middleware/correlation');

function buildApp() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(correlationMiddleware);

  // Rate limits mais permissivos no teste para nao falsear 429.
  const apiLimiter = rateLimit({ windowMs: 60_000, max: 1000, standardHeaders: true, legacyHeaders: false });
  app.use('/api', apiLimiter);
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/health/deep') return next();
    return requireAuth(req, res, next);
  });

  // Routers lazy para garantir que DB_PATH do setup ja este aplicado.
  app.use('/webhook', require('../../src/routes/webhook'));
  app.use('/api', require('../../src/routes/api'));

  return app;
}

module.exports = { buildApp };
