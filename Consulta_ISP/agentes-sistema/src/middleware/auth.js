// Middleware de autenticacao Bearer simples (Sprint 2 / T1).
// Le API_AUTH_TOKEN do .env e compara com header Authorization: Bearer <token>.

function requireAuth(req, res, next) {
  const expected = process.env.API_AUTH_TOKEN;

  // Se nao ha token configurado, fail-closed em producao, permissivo em dev
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'unauthorized', reason: 'server_missing_token' });
    }
    return next();
  }

  const header = req.get('authorization') || req.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const token = match[1].trim();
  if (token !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

module.exports = { requireAuth };
