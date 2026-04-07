#!/bin/bash
set -e
cd /var/www/consulta-isp

echo "[DEPLOY] $(date) - Iniciando deploy..."

# Pull latest
git fetch origin main
git reset --hard origin/main

# Install dependencies
npm ci --production=false 2>&1 | tail -3

# Build
npm run build 2>&1 | tail -5

# Restart
pm2 restart consulta-isp --update-env

echo "[DEPLOY] $(date) - Deploy concluido!"
pm2 list
