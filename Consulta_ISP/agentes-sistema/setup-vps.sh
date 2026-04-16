#!/bin/bash
# ============================================================
# SETUP AGENTES-SISTEMA NA VPS HOSTINGER
#
# Como usar:
#   1. SSH na VPS: ssh root@seu-ip
#   2. Cole este script inteiro no terminal
#   3. Ou salve como arquivo e rode: bash setup-vps.sh
# ============================================================

set -e
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Consulta ISP - Setup Agentes IA na VPS         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ============================================================
# PASSO 1: Instalar Docker (se nao tiver)
# ============================================================
if ! command -v docker &> /dev/null; then
  echo "[1/6] Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "  Docker instalado OK"
else
  echo "[1/6] Docker ja instalado: $(docker --version)"
fi

if ! command -v docker compose &> /dev/null; then
  # Docker Compose V2 ja vem com Docker moderno
  echo "  Docker Compose: $(docker compose version 2>/dev/null || echo 'nao encontrado')"
fi

# ============================================================
# PASSO 2: Criar pasta e clonar repo
# ============================================================
echo ""
echo "[2/6] Preparando pasta..."

AGENTES_DIR="/opt/consulta-isp-agentes"

if [ -d "$AGENTES_DIR" ]; then
  echo "  Pasta ja existe. Atualizando..."
  cd "$AGENTES_DIR"
  git pull origin main 2>/dev/null || true
else
  echo "  Clonando repositorio..."
  git clone https://github.com/informaticaecialdn-ai/consultaisp.git /tmp/consulta-isp-temp

  # Copiar apenas a pasta agentes-sistema
  mkdir -p "$AGENTES_DIR"
  cp -r /tmp/consulta-isp-temp/Consulta_ISP/agentes-sistema/* "$AGENTES_DIR/"
  cp -r /tmp/consulta-isp-temp/Consulta_ISP/agentes-sistema/.* "$AGENTES_DIR/" 2>/dev/null || true
  rm -rf /tmp/consulta-isp-temp

  cd "$AGENTES_DIR"
  echo "  Clonado em $AGENTES_DIR"
fi

# Criar pasta de dados
mkdir -p "$AGENTES_DIR/data"

# ============================================================
# PASSO 3: Criar .env com credenciais
# ============================================================
echo ""
echo "[3/6] Configurando .env..."

if [ -f "$AGENTES_DIR/.env" ]; then
  echo "  .env ja existe. Pulando..."
else
  cat > "$AGENTES_DIR/.env" << 'ENVEOF'
# ===== CLAUDE API =====
ANTHROPIC_API_KEY=COLE_SUA_CHAVE_AQUI

# ===== AGENT IDS (Claude Platform) =====
AGENT_SOFIA_ID=agent_011Ca5mPLbzjTfKFnLn3VAkM
AGENT_LEO_ID=agent_011Ca5mcHZYB3Ki3hRphRZVg
AGENT_CARLOS_ID=agent_011Ca5mnFkBMp7ktd2N5c3zN
AGENT_LUCAS_ID=agent_011Ca5n9NNsdPT8D5ttKpd6j
AGENT_RAFAEL_ID=agent_011Ca5nJJ6QSfbx1gLf2ku5N
AGENT_MARCOS_ID=agent_011Ca6D7HRpUqNJeZQFkdV4w
AGENT_DIANA_ID=agent_011Ca7UfoDbwQeSNXpCaoZtK

# ===== Z-API (WhatsApp) =====
ZAPI_INSTANCE_ID=COLE_SUA_INSTANCE
ZAPI_TOKEN=COLE_SEU_TOKEN
ZAPI_CLIENT_TOKEN=
ZAPI_BASE_URL=https://api.z-api.io

# ===== SERVER =====
PORT=3001
NODE_ENV=production
WEBHOOK_URL=https://agentes.consultaisp.com.br/webhook/zapi

# ===== META ADS (opcional) =====
META_APP_ID=
META_APP_SECRET=
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
META_PIXEL_ID=
META_PAGE_ID=
META_WEBHOOK_VERIFY_TOKEN=

# ===== GOOGLE ADS (opcional) =====
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=

# ===== EMAIL (opcional) =====
RESEND_API_KEY=
EMAIL_FROM=vendas@consultaisp.com.br
ENVEOF

  echo ""
  echo "  ⚠️  IMPORTANTE: Edite o .env com suas credenciais reais!"
  echo "  nano $AGENTES_DIR/.env"
  echo ""
  echo "  Pressione ENTER depois de editar o .env..."
  read -r
fi

# ============================================================
# PASSO 4: Configurar Caddyfile com dominio
# ============================================================
echo "[4/6] Configurando Caddyfile..."

# Verificar se porta 80 ja esta em uso (Consulta ISP principal pode estar usando)
PORTA_80_USADA=$(ss -tlnp | grep ':80 ' | head -1)

if [ -n "$PORTA_80_USADA" ]; then
  echo "  ⚠️  Porta 80 JA ESTA EM USO:"
  echo "  $PORTA_80_USADA"
  echo ""
  echo "  O Consulta ISP principal provavelmente ja usa as portas 80/443."
  echo "  Vou configurar o agentes-sistema na porta 3080 (HTTP direto, sem Caddy)."
  echo ""

  # Sem Caddy — expor porta direto
  cat > "$AGENTES_DIR/docker-compose.yml" << 'DCEOF'
version: '3.8'

services:
  agentes:
    build: .
    container_name: consulta-isp-agentes
    ports:
      - "3080:3001"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./skills-ref:/app/skills-ref:ro
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
DCEOF

  echo "  Configurado na porta 3080 (sem Caddy)."
  echo "  Acesse: http://SEU-IP:3080"
  echo ""
  echo "  Para HTTPS, adicione no proxy do Consulta ISP principal:"
  echo "  location /agentes/ { proxy_pass http://localhost:3080/; }"

  PORTA_FINAL="3080"
else
  # Porta 80 livre — usar Caddy
  cat > "$AGENTES_DIR/Caddyfile" << 'CADDYEOF'
agentes.consultaisp.com.br {
    reverse_proxy agentes:3001
}
CADDYEOF

  echo "  Caddy configurado para agentes.consultaisp.com.br"
  echo "  Certifique-se que o DNS aponta para o IP desta VPS."

  PORTA_FINAL="80/443 (Caddy)"
fi

# ============================================================
# PASSO 5: Build e Start
# ============================================================
echo ""
echo "[5/6] Build e Start..."

cd "$AGENTES_DIR"
docker compose build --no-cache 2>&1 | tail -5

echo "  Subindo containers..."
docker compose up -d

# ============================================================
# PASSO 6: Verificacao
# ============================================================
echo ""
echo "[6/6] Verificando..."

# Aguardar 15 segundos pra iniciar
echo "  Aguardando servidor iniciar..."
sleep 15

# Tentar healthcheck
if curl -sf http://localhost:${PORTA_FINAL%%/*}/api/health > /dev/null 2>&1; then
  HEALTH=$(curl -s http://localhost:${PORTA_FINAL%%/*}/api/health)
  echo "  ✅ Servidor respondendo: $HEALTH"
else
  # Tenta na porta do container
  HEALTH=$(docker exec consulta-isp-agentes wget -qO- http://localhost:3001/api/health 2>/dev/null || echo "aguardando...")
  echo "  Healthcheck: $HEALTH"
fi

echo ""
echo "  Containers:"
docker compose ps

echo ""
echo "  Ultimos logs:"
docker compose logs --tail=10 agentes 2>/dev/null

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Setup concluido!                                ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Pasta: $AGENTES_DIR"
echo "║  Porta: $PORTA_FINAL"
echo "║                                                  ║"
echo "║  Proximos passos:                                ║"
echo "║  1. Editar .env com credenciais reais            ║"
echo "║  2. Configurar webhook Z-API                     ║"
echo "║  3. Apontar DNS (se usando Caddy)                ║"
echo "║                                                  ║"
echo "║  Comandos uteis:                                 ║"
echo "║  cd $AGENTES_DIR"
echo "║  docker compose logs -f agentes     (logs)       ║"
echo "║  docker compose restart agentes     (restart)    ║"
echo "║  docker compose down                (parar)      ║"
echo "║  docker compose up -d --build       (rebuild)    ║"
echo "╚══════════════════════════════════════════════════╝"
