// Bearer token helper (Sprint 3 / T3).

function authHeader() {
  return { Authorization: `Bearer ${process.env.API_AUTH_TOKEN}` };
}

function zapiHeader() {
  return { 'x-z-api-token': process.env.ZAPI_WEBHOOK_TOKEN };
}

module.exports = { authHeader, zapiHeader };
