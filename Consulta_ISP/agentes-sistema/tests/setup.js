// Setup global para Vitest (Sprint 3 / T3).
// Injeta env vars de teste e mocks que devem valer para TODAS as suites.

// Env vars minimas antes de require-ar qualquer coisa
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-mock';
process.env.API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || 'test-bearer-token-sprint3';
process.env.ZAPI_WEBHOOK_TOKEN = process.env.ZAPI_WEBHOOK_TOKEN || 'test-zapi-webhook-token';
process.env.ZAPI_WEBHOOK_ENFORCE = process.env.ZAPI_WEBHOOK_ENFORCE || 'true';
process.env.DB_PATH = process.env.DB_PATH || ':memory:';
process.env.SKIP_DB_INIT = 'false';

// Alguns workers/listeners chamam setInterval — vitest executa em fork,
// mas garantimos que nenhum consome ENV de producao indevidamente.
process.env.RUN_WORKERS_IN_SERVER = 'false';
process.env.BROADCAST_WORKER_ENABLED = 'false';
