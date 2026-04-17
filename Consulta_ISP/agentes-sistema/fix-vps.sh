#!/bin/bash
# ============================================================
# FIX-VPS.SH - Deploy limpo/forcado para consertar frontend
#
# Use quando:
#   - Menus nao funcionam no dashboard
#   - Comentarios HTML aparecem como texto na tela
#   - Algo quebrou apos update parcial
#
# Como rodar (na VPS):
#   ssh root@187.127.7.168
#   bash /opt/consulta-isp-agentes/fix-vps.sh
#
# O que faz:
#   1. Para os containers
#   2. Remove qualquer arquivo modificado localmente
#   3. Clone fresco do GitHub (sem rsync - evita arquivos corrompidos persistentes)
#   4. Preserva .env e data/
#   5. Rebuild SEM cache
#   6. Sobe e valida /api/diagnose
# ============================================================

set -e

AGENTES_DIR="/opt/consulta-isp-agentes"
REPO="https://github.com/informaticaecialdn-ai/consultaisp.git"
PORTA_HOST="3080"

echo ""
echo "=========================================="
echo "  FIX-VPS: Deploy Limpo (forcado)"
echo "=========================================="
echo ""

cd "$AGENTES_DIR" || { echo "ERRO: pasta $AGENTES_DIR nao existe. Rode setup-vps.sh primeiro."; exit 1; }

# ----- Backup .env e data/
echo "[1/7] Backup de .env e data/..."
mkdir -p /tmp/agentes-backup
cp .env /tmp/agentes-backup/.env 2>/dev/null && echo "  .env salvo" || echo "  .env nao encontrado (ok se primeira vez)"
if [ -d data ]; then
  cp -r data /tmp/agentes-backup/data && echo "  data/ salvo ($(du -sh data | cut -f1))"
fi

# ----- Para containers
echo ""
echo "[2/7] Parando containers..."
docker compose down 2>/dev/null || true

# ----- Clone fresco em /tmp
echo ""
echo "[3/7] Clonando repo fresco do GitHub..."
rm -rf /tmp/consulta-fresh
git clone --depth 1 "$REPO" /tmp/consulta-fresh

if [ ! -d /tmp/consulta-fresh/Consulta_ISP/agentes-sistema ]; then
  echo "ERRO: pasta agentes-sistema nao encontrada no repo clonado"
  exit 1
fi

# ----- Limpa pasta atual (preserva .env, data/, node_modules cache se quiser)
echo ""
echo "[4/7] Limpando pasta atual (preserva .env e data/)..."
find "$AGENTES_DIR" -mindepth 1 -maxdepth 1 \
  ! -name '.env' \
  ! -name 'data' \
  ! -name 'node_modules' \
  -exec rm -rf {} + 2>/dev/null || true

# ----- Copia arquivos frescos
echo ""
echo "[5/7] Copiando arquivos frescos..."
cp -r /tmp/consulta-fresh/Consulta_ISP/agentes-sistema/* "$AGENTES_DIR/"
cp -r /tmp/consulta-fresh/Consulta_ISP/agentes-sistema/.[!.]* "$AGENTES_DIR/" 2>/dev/null || true

# Restaura .env se tinha backup
if [ -f /tmp/agentes-backup/.env ]; then
  cp /tmp/agentes-backup/.env "$AGENTES_DIR/.env"
  echo "  .env restaurado"
fi

rm -rf /tmp/consulta-fresh

# ----- Valida integridade do index.html (nao deve ter <\!-- escapado)
echo ""
echo "[6/7] Validando integridade do index.html..."
INDEX_FILE="$AGENTES_DIR/public/index.html"
if [ ! -f "$INDEX_FILE" ]; then
  echo "  ERRO: index.html nao existe!"
  exit 1
fi
ESCAPADAS=$(grep -c '<\\!--' "$INDEX_FILE" 2>/dev/null || echo 0)
COMENTARIOS=$(grep -c '<!--' "$INDEX_FILE" 2>/dev/null || echo 0)
SIZE=$(wc -c < "$INDEX_FILE")
echo "  Tamanho: $SIZE bytes"
echo "  Comentarios HTML normais: $COMENTARIOS"
echo "  Comentarios ESCAPADOS (erro): $ESCAPADAS"
if [ "$ESCAPADAS" -gt 0 ]; then
  echo "  AVISO: encontrados $ESCAPADAS comentarios escapados. Tentando auto-corrigir..."
  sed -i 's/<\\!--/<!--/g' "$INDEX_FILE"
  echo "  Corrigido."
fi

# ----- Rebuild sem cache + start
echo ""
echo "[7/7] Rebuild sem cache e restart..."
cd "$AGENTES_DIR"
docker compose build --no-cache 2>&1 | tail -10
docker compose up -d

# ----- Valida
sleep 12
echo ""
echo "=========================================="
echo "  VALIDACAO"
echo "=========================================="

# Health
HEALTH=$(curl -sf "http://localhost:${PORTA_HOST}/api/health" 2>/dev/null || echo "FALHOU")
echo "Health: $HEALTH"

# Diagnose
echo ""
echo "Diagnose (sumario):"
curl -s "http://localhost:${PORTA_HOST}/api/diagnose" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('summary',{}),indent=2)); print('---\\nindex_html:', json.dumps(d['checks'].get('index_html',{}),indent=2))" 2>/dev/null || echo "FALHOU (endpoint /api/diagnose pode nao existir ainda - rode novo update)"

# Index HTML direto
echo ""
echo "Primeiros 200 bytes de /:"
curl -s "http://localhost:${PORTA_HOST}/" | head -c 200
echo ""

echo ""
echo "=========================================="
echo "  PRONTO"
echo "=========================================="
echo "Teste no browser:"
echo "  http://187.127.7.168:${PORTA_HOST}/status.html   (diagnostico)"
echo "  http://187.127.7.168:${PORTA_HOST}/              (dashboard)"
echo ""
echo "Logs ao vivo: docker compose logs -f agentes"
