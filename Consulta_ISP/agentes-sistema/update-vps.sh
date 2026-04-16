#!/bin/bash
# ============================================================
# ATUALIZAR AGENTES-SISTEMA NA VPS
#
# Rodar depois de push no GitHub:
#   ssh root@seu-ip "bash /opt/consulta-isp-agentes/update-vps.sh"
# ============================================================

set -e
cd /opt/consulta-isp-agentes

echo "=== Atualizando Agentes-Sistema ==="

echo "1/3 — Baixando atualizacoes..."
# Baixar repo temporario e copiar apenas agentes-sistema
git clone --depth 1 https://github.com/informaticaecialdn-ai/consultaisp.git /tmp/consulta-isp-update 2>/dev/null

# Preservar .env e data/
cp .env .env.bak 2>/dev/null || true

# Copiar arquivos novos (sem .env, sem data/)
rsync -a --exclude='.env' --exclude='data/' --exclude='node_modules/' \
  /tmp/consulta-isp-update/Consulta_ISP/agentes-sistema/ /opt/consulta-isp-agentes/

# Restaurar .env
cp .env.bak .env 2>/dev/null || true

rm -rf /tmp/consulta-isp-update

echo "2/3 — Rebuild Docker..."
docker compose build --no-cache 2>&1 | tail -3

echo "3/3 — Restart..."
docker compose up -d

sleep 10
HEALTH=$(docker exec consulta-isp-agentes wget -qO- http://localhost:3001/api/health 2>/dev/null || echo "aguardando...")
echo "Health: $HEALTH"

echo ""
echo "=== Update OK ==="
docker compose logs --tail=5 agentes
