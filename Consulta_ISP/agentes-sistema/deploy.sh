#!/bin/bash
set -e

echo "=== Consulta ISP Agentes - Deploy ==="

# Verifica .env
if [ ! -f .env ]; then
  echo "ERRO: Arquivo .env nao encontrado!"
  echo "Copie .env.example para .env e preencha as credenciais."
  exit 1
fi

# Verifica credenciais obrigatorias
source .env
if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx" ]; then
  echo "ERRO: ANTHROPIC_API_KEY nao configurada no .env"
  exit 1
fi

if [ -z "$ZAPI_INSTANCE_ID" ] || [ "$ZAPI_INSTANCE_ID" = "sua-instance-id" ]; then
  echo "ERRO: ZAPI_INSTANCE_ID nao configurada no .env"
  exit 1
fi

echo "1/4 — Credenciais OK"

# Build e start
echo "2/4 — Build da imagem Docker..."
docker compose build --no-cache

echo "3/4 — Subindo containers..."
docker compose up -d

# Aguarda healthcheck
echo "4/4 — Aguardando servidor iniciar..."
for i in $(seq 1 30); do
  if docker exec consulta-isp-agentes wget --spider -q http://localhost:3001/api/health 2>/dev/null; then
    echo ""
    echo "=== Deploy OK! ==="
    echo "Servidor rodando na porta 3001"
    echo ""
    echo "Proximos passos:"
    echo "  1. Configure seu dominio no Caddyfile"
    echo "  2. Configure o webhook no painel Z-API: ${WEBHOOK_URL}"
    echo "  3. Escaneie o QR Code no painel Z-API com seu WhatsApp"
    echo ""
    docker compose logs --tail=5 agentes
    exit 0
  fi
  printf "."
  sleep 2
done

echo ""
echo "AVISO: Servidor nao respondeu em 60s. Verifique os logs:"
echo "  docker compose logs agentes"
