#!/usr/bin/env bash
# ============================================================
# restore-litestream.sh
# ------------------------------------------------------------
# Restaura data/agentes.db a partir do replica remoto Litestream
# (Backblaze B2 ou AWS S3, conforme definido em litestream.yml).
#
# Comportamento:
#   - Para o container `agentes` (docker compose) antes do restore
#     para evitar corromper o DB em uso
#   - Move o DB atual para data/agentes.db.pre-restore-TIMESTAMP
#   - Chama `litestream restore` com a config do projeto
#   - Valida integrity_check no DB restaurado
#   - Reinicia o container
#
# Uso:
#   ./scripts/restore-litestream.sh                   # latest
#   ./scripts/restore-litestream.sh --timestamp 2026-04-15T03:00:00Z
#
# Requer:
#   - litestream CLI (>= 0.3) OU imagem Docker litestream/litestream
#   - .env preenchido com LITESTREAM_* vars
# ============================================================

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

DB_PATH="${DB_PATH:-${ROOT_DIR}/data/agentes.db}"
CONFIG_PATH="${CONFIG_PATH:-${ROOT_DIR}/litestream.yml}"
TS="$(date -u +'%Y%m%dT%H%M%SZ')"

TIMESTAMP_ARG=""
if [[ "${1:-}" == "--timestamp" && -n "${2:-}" ]]; then
  TIMESTAMP_ARG="-timestamp ${2}"
  echo "[restore] alvo: point-in-time ${2}"
fi

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "[restore] ERRO: config nao encontrada em ${CONFIG_PATH}" >&2
  exit 1
fi

# Carrega .env para expor LITESTREAM_* vars ao CLI
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

# 1) Para container agentes (silencioso se nao estiver rodando)
if command -v docker >/dev/null 2>&1 && [[ -f "${ROOT_DIR}/docker-compose.yml" ]]; then
  echo "[restore] parando container agentes..."
  (cd "${ROOT_DIR}" && docker compose stop agentes) || true
fi

# 2) Move DB existente
if [[ -f "${DB_PATH}" ]]; then
  mv "${DB_PATH}" "${DB_PATH}.pre-restore-${TS}"
  rm -f "${DB_PATH}-shm" "${DB_PATH}-wal" 2>/dev/null || true
  echo "[restore] DB atual movido para ${DB_PATH}.pre-restore-${TS}"
fi

# 3) Executa restore (prioriza CLI local; fallback para Docker)
mkdir -p "$(dirname "${DB_PATH}")"
if command -v litestream >/dev/null 2>&1; then
  echo "[restore] usando litestream CLI local"
  # shellcheck disable=SC2086
  litestream restore -config "${CONFIG_PATH}" ${TIMESTAMP_ARG} "${DB_PATH}"
else
  echo "[restore] litestream CLI nao encontrado, usando Docker"
  # shellcheck disable=SC2086
  docker run --rm \
    --env-file "${ROOT_DIR}/.env" \
    -v "${ROOT_DIR}/litestream.yml:/etc/litestream.yml:ro" \
    -v "$(dirname "${DB_PATH}"):/data" \
    litestream/litestream:0.3 \
    restore -config /etc/litestream.yml ${TIMESTAMP_ARG} "/data/$(basename "${DB_PATH}")"
fi

# 4) Validacao de integridade
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "[restore] WARN: sqlite3 CLI indisponivel, pulando integrity_check"
else
  if ! sqlite3 "${DB_PATH}" 'PRAGMA integrity_check;' | grep -qx 'ok'; then
    echo "[restore] ERRO: integrity_check falhou no DB restaurado" >&2
    exit 2
  fi
  echo "[restore] integrity_check OK"
fi

# 5) Sobe container
if command -v docker >/dev/null 2>&1 && [[ -f "${ROOT_DIR}/docker-compose.yml" ]]; then
  echo "[restore] subindo container agentes..."
  (cd "${ROOT_DIR}" && docker compose start agentes) || true
fi

echo "[restore] OK -> ${DB_PATH}"
echo "[restore] backup pre-restore preservado em ${DB_PATH}.pre-restore-${TS}"
