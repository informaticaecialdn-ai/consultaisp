#!/usr/bin/env bash
# ============================================================
# deploy-vps-hostinger.sh — Executa o deploy remoto na Hostinger
# ------------------------------------------------------------
# Roda da sua maquina (Windows/Linux/Mac). Faz SSH na VPS e
# dispara scripts/deploy-sprint4.sh la. Pensa nisso como um
# "atalho de 1 comando" para rodar o deploy completo.
#
# Uso:
#   bash deploy-vps-hostinger.sh                 # deploy completo
#   bash deploy-vps-hostinger.sh --smoke         # so valida (nao rebuild)
#   bash deploy-vps-hostinger.sh --skip-build    # skip rebuild
#   bash deploy-vps-hostinger.sh --branch=main   # deploy de outra branch
#   bash deploy-vps-hostinger.sh --logs          # so tail dos logs do container
# ============================================================

set -Eeuo pipefail

VPS_HOST="${VPS_HOST:-root@187.127.7.168}"
REPO_DIR="${REPO_DIR:-/opt/consulta-isp-fullrepo}"
SCRIPT_PATH="${REPO_DIR}/Consulta_ISP/agentes-sistema/scripts/deploy-sprint4.sh"
SMOKE_PATH="${REPO_DIR}/Consulta_ISP/agentes-sistema/scripts/smoke-test-deploy.sh"

MODE="deploy"
EXTRA_ARGS=""

for arg in "$@"; do
  case "$arg" in
    --smoke)       MODE="smoke" ;;
    --logs)        MODE="logs" ;;
    --skip-build)  EXTRA_ARGS="${EXTRA_ARGS} --skip-build" ;;
    --skip-pull)   EXTRA_ARGS="${EXTRA_ARGS} --skip-pull" ;;
    --branch=*)    EXTRA_ARGS="${EXTRA_ARGS} ${arg}" ;;
    -h|--help)
      sed -n '2,/^# =====/p' "$0" | sed 's/^# \?//'
      exit 0 ;;
  esac
done

echo ">>> conectando em ${VPS_HOST}..."

case "$MODE" in
  deploy)
    echo ">>> rodando deploy-sprint4.sh${EXTRA_ARGS}"
    ssh -t "${VPS_HOST}" "bash ${SCRIPT_PATH}${EXTRA_ARGS}"
    ;;
  smoke)
    echo ">>> rodando smoke-test-deploy.sh"
    ssh -t "${VPS_HOST}" "bash ${SMOKE_PATH}"
    ;;
  logs)
    echo ">>> tail logs (ctrl+c sai)"
    ssh -t "${VPS_HOST}" "cd /opt/consulta-isp-agentes && docker compose logs -f --tail=50 agentes"
    ;;
esac
