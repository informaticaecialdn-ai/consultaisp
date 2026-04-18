require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');
const adsRoutes = require('./routes/ads');
const supervisorRoutes = require('./routes/supervisor');
const dashboardRoutes = require('./routes/dashboard');
const db = require('./models/database');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Seguranca (Sprint 2 / T1)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS + logs + body parsers
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Rate limits (Sprint 2 / T1)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
const prospectarLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Bypass paths (webhook, health, estaticos) sao servidos ANTES do auth
app.use('/webhook', webhookRoutes);

// /api/health e publico (bypass explicito antes do requireAuth no router)
// Rate limit aplica em tudo sob /api; auth aplica em /api exceto health
app.use('/api', apiLimiter);
app.use('/api/prospectar', prospectarLimiter);
app.use('/api', (req, res, next) => {
  // bypass /api/health
  if (req.path === '/health' || req.path === '/health/deep') return next();
  return requireAuth(req, res, next);
});

// Rotas protegidas
app.use('/api', apiRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/supervisor', supervisorRoutes);

// Estaticos (/, /status.html, /js/*, /favicon.ico, /index.html) - publicos
app.use(express.static(path.join(__dirname, '../public')));
app.use('/', dashboardRoutes);

// Initialize database
db.initialize();

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║  Consulta ISP - Sistema de Agentes de Vendas ║
  ║  Servidor rodando na porta ${PORT}              ║
  ║  Dashboard: http://localhost:${PORT}            ║
  ╚══════════════════════════════════════════════╝
  `);

  // Sprint 5: setInterval de followup foi movido para src/worker.js.
  // O processo HTTP nao executa mais trabalho em background — isso vive
  // no container `consulta-isp-worker` (veja docker-compose.yml).
  if (process.env.RUN_WORKERS_IN_SERVER === 'true') {
    const followupWorker = require('./workers/followup-worker');
    const broadcastWorker = require('./workers/broadcast');
    followupWorker.start();
    if (process.env.BROADCAST_WORKER_ENABLED !== 'false') broadcastWorker.start();
    console.log('  [SCHEDULER] Workers embarcados no HTTP (dev only)');
  } else {
    console.log('  [SCHEDULER] Workers rodam em processo separado (src/worker.js)');
  }
});
