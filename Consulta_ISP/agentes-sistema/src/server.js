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
const correlationMiddleware = require('./middleware/correlation');

const app = express();
const PORT = process.env.PORT || 3001;

// Seguranca (Sprint 2 / T1)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS + logs + body parsers
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Correlation ID (Sprint 3 / T1) - gera/propaga X-Correlation-Id em todas requests
app.use(correlationMiddleware);

// Rate limits (Sprint 2 / T1) — pula health, config publicos e
// chamadas autenticadas legitimas (Bearer valido).
const PUBLIC_BYPASS_PATHS = new Set([
  '/health', '/health/deep', '/diagnose',
  '/config/maps-key', '/config/public',
]);
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (PUBLIC_BYPASS_PATHS.has(req.path)) return true;
    // Tambem pula se ja vem com Bearer correto (operadores autenticados
    // nao devem competir com loops de SWs anonimos por slot de rate limit)
    const authz = req.get('authorization') || '';
    if (authz.startsWith('Bearer ') && process.env.API_AUTH_TOKEN &&
        authz.slice(7).trim() === process.env.API_AUTH_TOKEN) {
      return true;
    }
    return false;
  },
});
const prospectarLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Bypass paths (webhook, health, estaticos) sao servidos ANTES do auth
app.use('/webhook', webhookRoutes);

// Sprint 4 hotfix: stubs publicos ANTES do auth + rate limit
// para nao serem bloqueados por loops de SWs/extensoes da aplicacao
// principal Consulta ISP que vivem no mesmo dominio.
app.get('/api/config/maps-key', (req, res) => {
  res.json({ key: process.env.GOOGLE_MAPS_API_KEY || null, source: 'agentes-sistema' });
});
app.get('/api/config/public', (req, res) => {
  res.json({ app: 'agentes-sistema', version: '1.0', auth_required: true });
});

// /api/health e publico (bypass explicito antes do requireAuth no router)
// Rate limit aplica em tudo sob /api (com skip configurado acima)
// auth aplica em /api exceto health
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

// Sprint 3 / T5: error handler Express (ultimo middleware antes de listen)
const errorTracker = require('./services/error-tracker');
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  errorTracker.trackError(err, {
    tipo: 'express',
    correlation_id: req.correlationId,
    method: req.method,
    path: req.path,
  });
  if (res.headersSent) return;
  res.status(err.status || 500).json({
    error: 'internal_error',
    correlation_id: req.correlationId,
  });
});

// Initialize database
db.initialize();

// Sprint 3 / T2: inicia monitor de custo Claude (alerta diario)
const costMonitor = require('./services/cost-monitor');
costMonitor.start();

// Sprint 3 / T5: cleanup diario de errors_log resolvidos > 90 dias
errorTracker.startCleanup();

// Sprint 3 / T5: captura uncaughtException + unhandledRejection
process.on('uncaughtException', (err) => {
  errorTracker.trackError(err, { tipo: 'uncaughtException' });
  // Exit delay para permitir webhook/flush, mas garante restart do processo
  setTimeout(() => process.exit(1), 1000);
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  errorTracker.trackError(err, { tipo: 'unhandledRejection' });
});

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
