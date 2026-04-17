#!/usr/bin/env bash
# ============================================================
# backup-snapshot.sh
# ------------------------------------------------------------
# Faz um snapshot consistente do SQLite (data/agentes.db) usando
# o comando `sqlite3 .backup`, que e seguro enquanto o DB esta
# em uso (usa lock compartilhado + copia do WAL).
#
# O snapshot e gravado em ./backups/snapshots/ com timestamp e
# comprimido (gzip). Util como guarda-costas antes de operacoes
# destrutivas (migracoes, restore, debugging).
#
# NAO substitui Litestream — e um snapshot manual point-in-time.
#
# Uso:
#   ./scripts/backup-snapshot.sh              # usa ./data/agentes.db
#   DB_PATH=/tmp/x.db ./scripts/backup-snapshot.sh
# ============================================================

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

DB_PATH="${DB_PATH:-${ROOT_DIR}/data/agentes.db}"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/backups/snapshots}"
TS="$(date -u +'%Y%m%dT%H%M%SZ')"
OUT_FILE="${OUT_DIR}/agentes.db.${TS}.sqlite"

if [[ ! -f "${DB_PATH}" ]]; then
  echo "[backup] ERRO: DB nao encontrado em ${DB_PATH}" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "[backup] ERRO: sqlite3 CLI nao instalado. Instale com: apt-get install -y sqlite3" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

echo "[backup] origem: ${DB_PATH}"
echo "[backup] destino: ${OUT_FILE}.gz"

# .backup usa lock compartilhado, seguro com o app rodando
sqlite3 "${DB_PATH}" ".backup '${OUT_FILE}'"

# Integrity check antes de comprimir
if ! sqlite3 "${OUT_FILE}" 'PRAGMA integrity_check;' | grep -qx 'ok'; then
  echo "[backup] ERRO: integrity_check falhou para ${OUT_FILE}" >&2
  rm -f "${OUT_FILE}"
  exit 2
fi

gzip -9 "${OUT_FILE}"
SIZE="$(du -h "${OUT_FILE}.gz" | cut -f1)"

echo "[backup] OK (${SIZE}) -> ${OUT_FILE}.gz"

# Retencao local: manter apenas os 14 mais recentes
cd "${OUT_DIR}"
ls -1t agentes.db.*.sqlite.gz 2>/dev/null | tail -n +15 | xargs -r rm -f --
echo "[backup] retencao local aplicada (14 ultimos snapshots)"
