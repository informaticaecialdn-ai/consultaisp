#!/usr/bin/env bash
# ============================================================
# install-backup-cron.sh — Instala cron de backup-snapshot.sh
# ------------------------------------------------------------
# Roda 1x a cada 6h, persiste log em /var/log/agentes-backup.log,
# atualiza data/.last-backup-at (heartbeat usado pelo health-checker).
#
# Idempotente: nao duplica se ja existir entrada similar no crontab.
#
# Uso (na VPS):
#   bash /opt/consulta-isp-fullrepo/Consulta_ISP/agentes-sistema/scripts/install-backup-cron.sh
# ============================================================

set -Eeuo pipefail

RUNTIME_DIR="${RUNTIME_DIR:-/opt/consulta-isp-agentes}"
LOG_FILE="${LOG_FILE:-/var/log/agentes-backup.log}"
SCHEDULE="${SCHEDULE:-0 */6 * * *}"  # a cada 6h
SCRIPT="${RUNTIME_DIR}/scripts/backup-snapshot.sh"
CRON_TAG="# AGENTES-BACKUP-AUTO"

if [[ -t 1 ]]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; RESET='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; RESET=''
fi

if [[ ! -f "${SCRIPT}" ]]; then
  echo -e "${RED}[FAIL]${RESET} script nao encontrado: ${SCRIPT}"
  exit 1
fi

# Garante log file
touch "${LOG_FILE}" 2>/dev/null || sudo touch "${LOG_FILE}"

# Linha do crontab
CRON_LINE="${SCHEDULE} cd ${RUNTIME_DIR} && bash ${SCRIPT} >> ${LOG_FILE} 2>&1 ${CRON_TAG}"

# Idempotencia: remove linhas com o tag, depois adiciona a versao nova
TMP_CRON=$(mktemp)
crontab -l 2>/dev/null | grep -v "${CRON_TAG}" > "${TMP_CRON}" || true
echo "${CRON_LINE}" >> "${TMP_CRON}"
crontab "${TMP_CRON}"
rm -f "${TMP_CRON}"

echo -e "${GREEN}[OK]${RESET} cron instalado:"
echo "  ${CRON_LINE}"
echo
echo "Validar:"
echo "  crontab -l | grep AGENTES-BACKUP"
echo "  tail -f ${LOG_FILE}"
echo
echo "Forcar primeira execucao agora (recomendado):"
echo "  cd ${RUNTIME_DIR} && bash ${SCRIPT}"
