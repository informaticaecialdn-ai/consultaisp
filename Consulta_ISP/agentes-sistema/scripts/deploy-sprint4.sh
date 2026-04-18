#!/usr/bin/env bash
# ============================================================
# deploy-sprint4.sh — Deploy dos Sprints 2/3/4 na VPS Hostinger
# ------------------------------------------------------------
# Fluxo idempotente:
#   1. Pull do git (heatmap-fix)
#   2. Sync .env (upsert de vars novas, sem duplicar)
#   3. Rebuild docker com --no-cache
#   4. Up + aguarda health
#   5. Validacoes: health, auth Bearer, nginx proxy, health/deep, migrations
#   6. Heartbeat de backup inicial
#
# Uso (na VPS, depois de ssh root@187.127.7.168):
#   bash /opt/consulta-isp-fullrepo/Consulta_ISP/agentes-sistema/scripts/deploy-sprint4.sh
#
# Layout esperado:
#   /opt/consulta-isp-fullrepo   -> git clone do repo (source of truth)
#   /opt/consulta-isp-agentes    -> runtime (.env + docker-compose.yml + data/)
#
# Flags:
#   --skip-build       pula rebuild (so valida)
#   --skip-pull        pula git pull
#   --no-color         desliga ansi
#   --branch=<nome>    pull de branch especifico (default: heatmap-fix)
# ============================================================

set -Eeuo pipefail

# --------------------- config ---------------------
REPO_DIR="${REPO_DIR:-/opt/consulta-isp-fullrepo}"
RUNTIME_DIR="${RUNTIME_DIR:-/opt/consulta-isp-agentes}"
AGENTES_SRC="${REPO_DIR}/Consulta_ISP/agentes-sistema"
BRANCH="heatmap-fix"
PORT="${PORT:-3080}"
HEALTH_TIMEOUT=90

SKIP_BUILD=0
SKIP_PULL=0

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --skip-pull)  SKIP_PULL=1 ;;
    --no-color)   NO_COLOR=1 ;;
    --branch=*)   BRANCH="${arg#--branch=}" ;;
    -h|--help)
      sed -n '2,/^# =====/p' "$0" | sed 's/^# \?//'
      exit 0 ;;
  esac
done

# --------------------- cores ---------------------
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi

ok()    { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fail()  { echo -e "${RED}[FAIL]${RESET}  $*"; }
info()  { echo -e "${BLUE}[..]${RESET}    $*"; }
step()  { echo -e "\n${BOLD}=== $* ===${RESET}"; }

# Erro nao tratado = mensagem amigavel
trap 'fail "deploy abortado na linha $LINENO (exit $?)"' ERR

# Impede execucao fora de root (alguns comandos docker/chmod precisam)
if [[ $EUID -ne 0 ]]; then
  warn "nao estou como root — alguns comandos docker podem exigir sudo"
fi

# Exit code acumulado para nao abortar em checks nao criticos
DEPLOY_EXIT=0
soft_fail() { fail "$*"; DEPLOY_EXIT=1; }

# --------------------- 1. git pull ---------------------
step "1/7 git pull (${BRANCH})"
if [[ $SKIP_PULL -eq 1 ]]; then
  warn "pull pulado via --skip-pull"
else
  if [[ ! -d "${REPO_DIR}/.git" ]]; then
    fail "REPO_DIR nao e git repo: ${REPO_DIR}"
    exit 2
  fi
  cd "${REPO_DIR}"
  info "branch atual: $(git rev-parse --abbrev-ref HEAD)"
  info "fetch origin ${BRANCH}..."
  git fetch --quiet origin "${BRANCH}"
  git checkout --quiet "${BRANCH}"
  BEFORE=$(git rev-parse HEAD)
  git pull --quiet --ff-only origin "${BRANCH}"
  AFTER=$(git rev-parse HEAD)
  if [[ "${BEFORE}" == "${AFTER}" ]]; then
    ok "ja em ${AFTER:0:7} (nada novo)"
  else
    ok "${BEFORE:0:7} -> ${AFTER:0:7}"
    echo
    git log --oneline "${BEFORE}..${AFTER}"
    echo
  fi
fi

# --------------------- 2. sync .env ---------------------
step "2/7 sync .env (upsert idempotente)"
ENV_FILE="${RUNTIME_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  fail ".env nao encontrado em ${ENV_FILE}"
  fail "copie de ${AGENTES_SRC}/.env.example e preencha as credenciais"
  exit 3
fi

# upsert_env CHAVE VALOR (so adiciona se ausente; nao sobrescreve existente)
upsert_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "${ENV_FILE}"; then
    return 0  # ja existe, deixa como esta
  fi
  echo "${key}=${val}" >> "${ENV_FILE}"
  ok "adicionado ${key}=${val}"
}

# Defaults seguros dos Sprints 2/3/4 (nao sobrescrevem se ja setado)
upsert_env "ZAPI_WEBHOOK_ENFORCE" "false"
upsert_env "COST_ALERT_DAILY_USD" "25"
upsert_env "BROADCAST_WORKER_ENABLED" "true"
upsert_env "BROADCAST_RATE_PER_MIN" "20"
upsert_env "BROADCAST_JITTER_MIN_SEC" "3"
upsert_env "BROADCAST_JITTER_MAX_SEC" "8"
upsert_env "BROADCAST_MAX_RETRIES" "3"
upsert_env "BROADCAST_RETRY_DELAYS_SEC" "30,120,600"
upsert_env "BROADCAST_FAILURE_THRESHOLD_PCT" "20"
upsert_env "BROADCAST_BATCH_SIZE" "10"
upsert_env "FOLLOWUP_WORKER_ENABLED" "true"
upsert_env "RUN_WORKERS_IN_SERVER" "false"

# Checagem de vars CRITICAS (sem valor = abort)
MISSING=()
for v in API_AUTH_TOKEN ZAPI_WEBHOOK_TOKEN ANTHROPIC_API_KEY \
         ZAPI_INSTANCE_ID ZAPI_TOKEN WEBHOOK_URL; do
  if ! grep -qE "^${v}=.+" "${ENV_FILE}"; then
    MISSING+=("${v}")
  fi
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  fail "vars criticas ausentes ou vazias no .env: ${MISSING[*]}"
  fail "edite ${ENV_FILE} antes de rodar de novo"
  exit 4
fi
ok "vars criticas presentes"

# --------------------- 3. sincronizar fonte com runtime ---------------------
step "3/7 sync arquivos (repo -> runtime)"
if [[ ! -d "${AGENTES_SRC}" ]]; then
  fail "source dir nao existe: ${AGENTES_SRC}"
  exit 5
fi

# rsync preserva .env, data/, node_modules/ e logs/
info "rsync ${AGENTES_SRC}/ -> ${RUNTIME_DIR}/"
rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='backups/' \
  --exclude='node_modules/' \
  --exclude='logs/' \
  --exclude='.git/' \
  "${AGENTES_SRC}/" "${RUNTIME_DIR}/"
ok "fontes sincronizadas"

# --------------------- 4. docker build + up ---------------------
step "4/7 docker compose build + up"
cd "${RUNTIME_DIR}"

if [[ $SKIP_BUILD -eq 1 ]]; then
  warn "build pulado via --skip-build"
else
  info "docker compose build --no-cache (pode demorar 2-5min)..."
  if ! docker compose build --no-cache 2>&1 | tail -6; then
    fail "docker build falhou"
    exit 6
  fi
  ok "build concluido"
fi

info "docker compose up -d"
docker compose up -d
ok "containers subindo"

# --------------------- 5. aguarda health ---------------------
step "5/7 health check (timeout ${HEALTH_TIMEOUT}s)"
HEALTHY=0
for i in $(seq 1 ${HEALTH_TIMEOUT}); do
  if curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    HEALTHY=1
    ok "/api/health respondeu (${i}s)"
    break
  fi
  printf "."
  sleep 1
done
echo

if [[ $HEALTHY -eq 0 ]]; then
  fail "health nao respondeu em ${HEALTH_TIMEOUT}s"
  echo
  docker compose logs --tail=30 agentes || true
  exit 7
fi

# --------------------- 6. validacoes ---------------------
step "6/7 validacoes"

# Extrai TOKEN (tolerante a = no valor)
TOKEN=$(grep "^API_AUTH_TOKEN=" "${ENV_FILE}" | cut -d= -f2- | tr -d '[:space:]')
if [[ -z "$TOKEN" ]]; then
  soft_fail "API_AUTH_TOKEN vazio em .env"
else
  ok "token extraido (${#TOKEN} chars)"
fi

# 6.1 auth Bearer — 401 sem token
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/leads" || true)
if [[ "$HTTP" == "401" ]]; then
  ok "/api/leads sem token -> 401"
else
  soft_fail "/api/leads sem token devolveu ${HTTP} (esperado 401)"
fi

# 6.2 auth Bearer — 200 com token
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${TOKEN}" "http://localhost:${PORT}/api/leads" || true)
if [[ "$HTTP" == "200" ]]; then
  ok "/api/leads com token -> 200"
else
  soft_fail "/api/leads com token devolveu ${HTTP} (esperado 200)"
fi

# 6.3 nginx proxy (porta 80)
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/health" || true)
case "$HTTP" in
  200) ok "nginx /api/health -> 200" ;;
  000) warn "nginx nao responde na porta 80 (Caddy/nginx down?)" ;;
  *)   soft_fail "nginx /api/health devolveu ${HTTP}" ;;
esac

# 6.4 health/deep com token
DEEP=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "http://localhost:${PORT}/api/health/deep" || true)
if echo "$DEEP" | grep -q '"status":"ok"'; then
  ok "/api/health/deep -> ok"
elif echo "$DEEP" | grep -q '"status":"degraded"'; then
  warn "/api/health/deep -> degraded"
  echo "$DEEP" | python3 -m json.tool 2>/dev/null | grep -E '"status"|"reason"|"error"' | head -12
elif echo "$DEEP" | grep -q '"status":"down"'; then
  soft_fail "/api/health/deep -> down"
  echo "$DEEP" | python3 -m json.tool 2>/dev/null | head -40
else
  soft_fail "/api/health/deep resposta inesperada: ${DEEP:0:120}"
fi

# 6.5 correlation id
CORR=$(curl -s -D - -o /dev/null -H "Authorization: Bearer ${TOKEN}" \
  "http://localhost:${PORT}/api/health" | grep -i '^x-correlation-id' || true)
if [[ -n "$CORR" ]]; then
  ok "correlation middleware ativo (${CORR%$'\r'})"
else
  soft_fail "X-Correlation-Id header ausente (correlation middleware off?)"
fi

# 6.6 migrations aplicadas (012, 013, 014)
MIGS=$(docker compose exec -T agentes sqlite3 /app/data/agentes.db \
  "SELECT name FROM schema_migrations ORDER BY name;" 2>/dev/null || true)
for m in "012-claude-usage.sql" "013-errors-log.sql" "014-sprint4-fields.sql"; do
  if echo "$MIGS" | grep -q "$m"; then
    ok "migration aplicada: $m"
  else
    soft_fail "migration FALTANDO: $m"
  fi
done

# 6.7 cost-monitor iniciou (log attendu no boot)
if docker compose logs --tail=50 agentes 2>/dev/null | grep -q 'COST-MONITOR.*iniciado'; then
  ok "cost-monitor iniciado"
else
  warn "log do cost-monitor nao encontrado (ainda OK, checa boot completo)"
fi

# --------------------- 7. heartbeat de backup inicial ---------------------
step "7/7 heartbeat de backup"
BACKUP_MARKER="${RUNTIME_DIR}/data/.last-backup-at"
if [[ ! -f "$BACKUP_MARKER" ]]; then
  info "gerando marker inicial (impede /api/health/deep ficar degraded eternamente)"
  mkdir -p "${RUNTIME_DIR}/data"
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "${BACKUP_MARKER}"
  ok "marker criado em ${BACKUP_MARKER}"
  warn "configure cron diario chamando scripts/backup-snapshot.sh"
else
  ok "marker ja existe: $(cat "$BACKUP_MARKER")"
fi

# --------------------- resumo ---------------------
echo
step "RESUMO"
docker compose ps --format "table {{.Service}}\t{{.State}}\t{{.Status}}" || docker compose ps

echo
echo "Commits no HEAD:"
cd "${REPO_DIR}"
git log --oneline -7 "${BRANCH}"

echo
if [[ $DEPLOY_EXIT -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}DEPLOY OK${RESET}"
  echo
  echo "Proximos passos manuais (sem --skip-manual):"
  echo "  1. Dashboard: http://187.127.7.168/"
  echo "     -> abrir no navegador, colar API_AUTH_TOKEN quando pedir"
  echo "  2. Configurar webhook Z-API (so depois de validar dashboard):"
  echo "     curl -X POST -H \"Authorization: Bearer \$TOKEN\" http://localhost:${PORT}/api/setup-webhook"
  echo "  3. Verificar logs de callback Z-API por 5min:"
  echo "     docker compose logs -f agentes | grep WEBHOOK"
  echo "  4. Quando ver header X-Z-API-Token chegando, flipar enforce:"
  echo "     sed -i 's/^ZAPI_WEBHOOK_ENFORCE=false/ZAPI_WEBHOOK_ENFORCE=true/' ${ENV_FILE}"
  echo "     docker compose restart agentes"
  echo "  5. Smoke test UI: Audiencias -> Templates -> Campanhas -> disparar 5 envios"
  echo
else
  echo -e "${RED}${BOLD}DEPLOY COM WARNINGS${RESET} (exit ${DEPLOY_EXIT})"
  echo "Containers subiram, mas nem todas as validacoes passaram."
  echo "Revise os [FAIL] acima. Logs: docker compose logs --tail=50 agentes"
fi
exit ${DEPLOY_EXIT}
