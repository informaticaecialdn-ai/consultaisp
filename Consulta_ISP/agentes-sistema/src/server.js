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

  // Feature 1: Scheduler de follow-ups (a cada 5 minutos)
  const followup = require('./services/followup');
  setInterval(() => {
    followup.processFollowups().catch(e => console.error('[FOLLOWUP] Erro scheduler:', e.message));
  }, 5 * 60 * 1000);
  console.log('  [SCHEDULER] Follow-up checker ativo (5 min)');
});
