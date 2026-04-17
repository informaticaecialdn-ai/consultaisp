require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');
const adsRoutes = require('./routes/ads');
const supervisorRoutes = require('./routes/supervisor');
const dashboardRoutes = require('./routes/dashboard');
const db = require('./models/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/supervisor', supervisorRoutes);
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
