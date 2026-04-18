// Logger baseado em Pino com redact automatico (Sprint 2 / T5).
// API compativel com versao anterior: info/warn/error/fatal/debug.
// Em dev, usa pino-pretty. Em prod, JSON estruturado.

const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';

const redactPaths = [
  'phone',
  'telefone',
  'message',
  'mensagem',
  'text',
  '*.text',
  '*.message',
  '*.mensagem',
  'lead.telefone',
  'lead.nome',
  'lead.email',
  '*.applicationKey',
  '*.access_token',
  '*.refresh_token',
  '*.password',
  '*.api_key',
  '*.apiKey',
  'req.headers.authorization',
  'req.headers["x-z-api-token"]',
  'headers.authorization',
  'headers["x-z-api-token"]',
];

const transport = isProd
  ? undefined
  : {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    };

const baseLogger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  base: undefined,
  transport,
});

// Preserva a API antiga (withCorrelation) para quem ja usava o stub.
function withCorrelation(id) {
  const child = baseLogger.child({ corr: id });
  child.withCorrelation = withCorrelation;
  return child;
}
baseLogger.withCorrelation = withCorrelation;

module.exports = baseLogger;
