require('dotenv').config();

const http = require('http');
const logger = require('./utils/logger');
const db = require('./models/database');
const broadcastWorker = require('./workers/broadcast');
const followupWorker = require('./workers/followup-worker');

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

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const health = {
        status: 'ok',
        uptime_sec: Math.round(process.uptime()),
        pid: process.pid,
        broadcast: broadcastWorker.status(),
        followup: followupWorker.status(),
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
