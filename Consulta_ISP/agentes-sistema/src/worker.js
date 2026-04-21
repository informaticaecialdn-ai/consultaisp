require('dotenv').config();

const http = require('http');
const logger = require('./utils/logger');
const db = require('./models/database');
const broadcastWorker = require('./workers/broadcast');
const followupWorker = require('./workers/followup-worker');
const prospectorWorker = require('./workers/prospector');
const outboundWorker = require('./workers/outbound');
const supervisorWorker = require('./workers/supervisor');
const marcosWorker = require('./workers/marcos');
const sofiaWorker = require('./workers/sofia');
const emailSeqWorker = require('./workers/email-sequences-worker');
const autoHealer = require('./services/auto-healer');

const WORKER_HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT) || 9091;

async function main() {
  db.initialize();
  logger.info('worker process iniciado');

  if (process.env.BROADCAST_WORKER_ENABLED !== 'false') {
    broadcastWorker.start();
  } else {
    logger.warn('BROADCAST_WORKER_ENABLED=false, broadcast em stand-by');
  }

  if (process.env.FOLLOWUP_WORKER_ENABLED !== 'false') {
    followupWorker.start();
  } else {
    logger.warn('FOLLOWUP_WORKER_ENABLED=false, followup em stand-by');
  }

  // Milestone 1 / C3: prospector autonomo (scraping + validation via Apify).
  if (process.env.PROSPECTOR_WORKER_ENABLED === 'true') {
    prospectorWorker.start();
  } else {
    logger.info('PROSPECTOR_WORKER_ENABLED!=true, prospector em stand-by');
  }

  // Milestone 2 / D1: Carla SDR autonomo (cold outbound a cada 2h BR).
  if (process.env.OUTBOUND_WORKER_ENABLED === 'true') {
    outboundWorker.start();
  } else {
    logger.info('OUTBOUND_WORKER_ENABLED!=true, outbound em stand-by');
  }

  // Milestone 3 / F1: Iani supervisora (cron 1h em 1h via platform-agent-client).
  if (process.env.SUPERVISOR_WORKER_ENABLED === 'true') {
    supervisorWorker.start();
  } else {
    logger.info('SUPERVISOR_WORKER_ENABLED!=true, supervisor em stand-by');
  }

  // Marcos midia paga autonomo (cron 1 tick diario 8h BR).
  if (process.env.MARCOS_WORKER_ENABLED === 'true') {
    marcosWorker.start();
  } else {
    logger.info('MARCOS_WORKER_ENABLED!=true, marcos em stand-by');
  }

  // Sofia estrategia semanal (domingo 20h BR).
  if (process.env.SOFIA_WORKER_ENABLED === 'true') {
    sofiaWorker.start();
  } else {
    logger.info('SOFIA_WORKER_ENABLED!=true, sofia em stand-by');
  }

  // Email sequences worker (processa envios 15min em 15min).
  if (process.env.EMAIL_SEQUENCES_WORKER_ENABLED !== 'false') {
    emailSeqWorker.start();
  }

  // Milestone 3 / G: auto-healer (kill switches automaticos por custo/erro/zapi).
  autoHealer.start();

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const health = {
        status: 'ok',
        uptime_sec: Math.round(process.uptime()),
        pid: process.pid,
        broadcast: broadcastWorker.status(),
        followup: followupWorker.status(),
        prospector: prospectorWorker.status(),
        outbound: outboundWorker.status(),
        supervisor: supervisorWorker.status(),
        marcos: marcosWorker.status(),
        sofia: sofiaWorker.status(),
        email_sequences: emailSeqWorker.status(),
        env: process.env.NODE_ENV || 'development'
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(health));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(WORKER_HEALTH_PORT, '0.0.0.0', () => {
    logger.info(`worker health em :${WORKER_HEALTH_PORT}`);
  });
}

async function gracefulShutdown(signal) {
  logger.info(`worker recebeu ${signal}, desligando...`);
  try {
    await broadcastWorker.stop();
    await followupWorker.stop();
    await prospectorWorker.stop();
    await outboundWorker.stop();
    await supervisorWorker.stop();
    await marcosWorker.stop();
    await sofiaWorker.stop();
    await emailSeqWorker.stop();
    autoHealer.stop();
  } catch (err) {
    logger.error({ err: err.message }, 'erro no shutdown');
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'uncaughtException no worker');
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason: String(reason) }, 'unhandledRejection no worker');
});

main().catch(err => {
  logger.fatal({ err: err.message, stack: err.stack }, 'worker falhou em iniciar');
  process.exit(1);
});
