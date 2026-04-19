// Auth routes (Sprint 4 hotfix - login page).
// Aceita LOGIN_PASSWORD (memorivel) OU API_AUTH_TOKEN (longo) como senha.
// Retorna o API_AUTH_TOKEN para uso em /api/* via Bearer.

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const logger = require('../utils/logger');
const { maskMessage } = require('../utils/pii');

const loginSchema = z.object({
  password: z.string().min(1).max(256),
});

// Rate limit estrito anti brute-force: 10 tentativas / 15 min por IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts', retry_after_seconds: 900 },
});

router.post('/login', loginLimiter, async (req, res) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const expectedPassword = process.env.LOGIN_PASSWORD;
  const apiToken = process.env.API_AUTH_TOKEN;

  if (!apiToken) {
    logger.error('[AUTH] API_AUTH_TOKEN nao configurado no .env — bloqueando login');
    return res.status(503).json({ error: 'server_misconfigured' });
  }

  const provided = result.data.password;
  const validPassword =
    (expectedPassword && provided === expectedPassword) ||
    provided === apiToken;

  // Delay constante anti timing-attack + slow brute-force
  await new Promise(r => setTimeout(r, 400));

  if (!validPassword) {
    logger.warn({ ip: req.ip, ua: maskMessage(req.get('user-agent') || '', 50) }, '[AUTH] login falhou');
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  logger.info({ ip: req.ip }, '[AUTH] login OK');
  return res.json({
    token: apiToken,
    expires_at: null, // token nao expira (single-tenant, single-token)
    server_time: new Date().toISOString(),
  });
});

// Verifica se o Bearer enviado eh valido. Util para o frontend
// validar token em localStorage antes de tentar carregar dashboard.
router.get('/check', (req, res) => {
  const authz = req.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (token && process.env.API_AUTH_TOKEN && token === process.env.API_AUTH_TOKEN) {
    return res.json({ authenticated: true });
  }
  res.status(401).json({ authenticated: false });
});

module.exports = router;
