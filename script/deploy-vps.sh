#!/bin/bash
set -e

echo "======================================"
echo " Deploy Consulta ISP → VPS Hostinger"
echo "======================================"

APP_DIR="/var/www/consulta-isp"

# 1. Clone or pull
if [ -d "$APP_DIR/.git" ]; then
  echo "→ Atualizando codigo..."
  cd "$APP_DIR"
  git pull origin main
else
  echo "→ Clonando repositorio..."
  mkdir -p /var/www
  git clone https://github.com/informaticaecialdn-ai/consultaisp.git "$APP_DIR"
  cd "$APP_DIR"
fi

# 2. Install dependencies
echo "→ Instalando dependencias..."
npm install

# 3. Setup .env if not exists
if [ ! -f .env ]; then
  echo "→ Criando .env a partir do .env.example..."
  cp .env.example .env
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  IMPORTANTE: Configure o .env antes de continuar!       ║"
  echo "║                                                         ║"
  echo "║  nano /var/www/consulta-isp/.env                        ║"
  echo "║                                                         ║"
  echo "║  Preencha:                                              ║"
  echo "║  - DATABASE_URL (Supabase PostgreSQL)                   ║"
  echo "║  - SESSION_SECRET                                       ║"
  echo "║  - NETWORK_CPF_SALT (use o valor abaixo)                ║"
  echo "║                                                         ║"
  echo "║  NETWORK_CPF_SALT sugerido:                             ║"
  echo "║  e074aa5746ea6d8f619d153605a03ddd7e3f80dad84bf98b33f3524d4d39f938"
  echo "║                                                         ║"
  echo "║  Depois rode novamente: ./script/deploy-vps.sh          ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  exit 0
fi

# 4. Push schema to database
echo "→ Atualizando schema do banco..."
npx drizzle-kit push --force

# 5. Build
echo "→ Build de producao..."
npm run build

# 6. Start/restart with PM2
echo "→ Iniciando com PM2..."
if pm2 describe consulta-isp > /dev/null 2>&1; then
  pm2 restart consulta-isp
else
  pm2 start dist/index.cjs --name consulta-isp --env production
  pm2 save
  pm2 startup | tail -1 | bash 2>/dev/null || true
fi

# 7. Health check
echo "→ Verificando saude..."
sleep 3
HEALTH=$(curl -s http://localhost:5000/api/health 2>/dev/null || echo '{"status":"erro"}')
echo "   Health: $HEALTH"

echo ""
echo "======================================"
echo " Deploy concluido!"
echo " App rodando em http://localhost:5000"
echo "======================================"
echo ""
echo "Proximos passos:"
echo "  1. Configurar Nginx: /etc/nginx/sites-available/consultaisp"
echo "  2. Configurar SSL: certbot --nginx -d seudominio.com.br"
echo "  3. Liberar IP da VPS no IXC de cada provedor"
echo ""
