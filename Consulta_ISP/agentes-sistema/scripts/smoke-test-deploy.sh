#!/usr/bin/env bash
# ============================================================
# smoke-test-deploy.sh — Valida deploy sem reconstruir nada
# ------------------------------------------------------------
# Roda os checks nao destrutivos do deploy-sprint4.sh contra
# o sistema que ja esta up. Util para:
#   - Conferir deploy depois de fato
#   - Integrar em healthcheck externo (cron / monitoramento)
#   - Verificar /health/deep, migrations, auth sem interromper
#
# Uso:
#   bash /opt/consulta-isp-fullrepo/Consulta_ISP/agentes-sistema/scripts/smoke-test-deploy.sh
#
# Exit 0 = tudo OK, Exit 1 = pelo menos um check falhou
# ============================================================

set -Eeuo pipefail

RUNTIME_DIR="${RUNTIME_DIR:-/opt/consulta-isp-agentes}"
PORT="${PORT:-3080}"
ENV_FILE="${RUNTIME_DIR}/.env"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; RESET='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; RESET=''
fi
ok()   { echo -e "${GREEN}[OK]${RESET}   $*"; }
warn() { echo -e "${YELLOW}[WARN]${RESET} $*"; }
fail() { echo -e "${RED}[FAIL]${RESET} $*"; EXIT=1; }

EXIT=0

if [[ ! -f "$ENV_FILE" ]]; then
  fail ".env nao encontrado em ${ENV_FILE}"
  exit 1
fi
TOKEN=$(grep "^API_AUTH_TOKEN=" "${ENV_FILE}" | cut -d= -f2- | tr -d '[:space:]')
[[ -z "$TOKEN" ]] && { fail "API_AUTH_TOKEN vazio"; exit 1; }

# 1. Container up
if docker compose -f "${RUNTIME_DIR}/docker-compose.yml" ps --status=running | grep -q agentes; then
  ok "container agentes running"
else
  fail "container agentes nao esta running"
fi

# 2. Health basico
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/health" || echo "000")
[[ "$HTTP" == "200" ]] && ok "/api/health -> 200" || fail "/api/health -> ${HTTP}"

# 3. Auth 401 sem token
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/leads" || echo "000")
[[ "$HTTP" == "401" ]] && ok "/api/leads sem token -> 401" || fail "/api/leads sem token -> ${HTTP}"

# 4. Auth 200 com token
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${TOKEN}" "http://localhost:${PORT}/api/leads" || echo "000")
[[ "$HTTP" == "200" ]] && ok "/api/leads com token -> 200" || fail "/api/leads com token -> ${HTTP}"

# 5. Health deep
DEEP=$(curl -s -H "Authorization: Bearer ${TOKEN}" "http://localhost:${PORT}/api/health/deep" || true)
case "$DEEP" in
  *'"status":"ok"'*)       ok "/api/health/deep -> ok" ;;
  *'"status":"degraded"'*) warn "/api/health/deep -> degraded" ;;
  *'"status":"down"'*)     fail "/api/health/deep -> down" ;;
  *)                       fail "/api/health/deep resposta invalida" ;;
esac

# 6. Nginx
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/health" || echo "000")
case "$HTTP" in
  200) ok "nginx /api/health -> 200" ;;
  000) warn "nginx nao responde na porta 80" ;;
  *)   fail "nginx /api/health -> ${HTTP}" ;;
esac

# 7. Correlation id
if curl -s -D - -o /dev/null -H "Authorization: Bearer ${TOKEN}" \
  "http://localhost:${PORT}/api/health" | grep -qi '^x-correlation-id'; then
  ok "X-Correlation-Id header presente"
else
  fail "X-Correlation-Id header ausente"
fi

# 8. Migrations — via Node (sqlite3 CLI nao esta no container)
MIGS=$(docker compose -f "${RUNTIME_DIR}/docker-compose.yml" exec -T agentes node -e "
try {
  const db = require('better-sqlite3')('/app/data/agentes.db');
  const rows = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all();
  rows.forEach(r => console.log(r.name));
} catch (e) { process.stderr.write(e.message); }
" 2>/dev/null || true)
for m in "012-claude-usage.sql" "013-errors-log.sql" "014-sprint4-fields.sql"; do
  if echo "$MIGS" | grep -q "$m"; then
    ok "migration aplicada: $m"
  else
    fail "migration faltando: $m"
  fi
done

echo
if [[ $EXIT -eq 0 ]]; then
  echo -e "${GREEN}SMOKE TEST: TODOS OS CHECKS PASSARAM${RESET}"
else
  echo -e "${RED}SMOKE TEST: FALHOU${RESET}"
fi
exit $EXIT
