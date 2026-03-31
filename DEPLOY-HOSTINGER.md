# Deploy Consulta ISP na Hostinger VPS

Guia passo a passo completo para deploy em producao.

---

## 1. Contratar VPS na Hostinger

1. Acesse: https://www.hostinger.com/br/vps
2. Escolha o plano **KVM 1** (4GB RAM, 2 vCPU) — suficiente para beta
3. Na configuracao:
   - **Sistema operacional:** Ubuntu 22.04 ou 24.04
   - **Localizacao:** Sao Paulo (mais proximo dos ISPs brasileiros)
   - **Defina a senha root** (anote!)
4. Apos a compra, anote o **IP da VPS** (ex: `123.45.67.89`)

---

## 2. Acessar a VPS via SSH

Abra o terminal (PowerShell no Windows) e conecte:

```bash
ssh root@SEU_IP_VPS
```

Digite a senha root quando solicitado.

**Dica Windows:** Se nao tiver SSH, use o terminal web da propria Hostinger (painel > VPS > Terminal).

---

## 3. Instalar dependencias na VPS

Execute estes comandos **na VPS** (um por vez):

```bash
# Atualizar sistema
apt update && apt upgrade -y

# Instalar Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Instalar PM2 (gerenciador de processos - mantem o app rodando)
npm install -g pm2

# Instalar Nginx (reverse proxy + SSL)
apt install -y nginx certbot python3-certbot-nginx

# Instalar Git
apt install -y git

# Verificar instalacoes
node -v    # deve mostrar v20.x
npm -v     # deve mostrar 10.x
pm2 -v     # deve mostrar 5.x
nginx -v   # deve mostrar nginx/1.x
```

---

## 4. Clonar o projeto

```bash
# Criar diretorio do app
mkdir -p /var/www
cd /var/www

# Clonar o repositorio (substitua pela URL do seu repo)
git clone https://github.com/SEU_USUARIO/Consulta-ISP.git consulta-isp
cd consulta-isp

# Instalar dependencias
npm install
```

**Se nao tiver repo no GitHub**, envie os arquivos via SCP do seu PC:

```bash
# No seu PC (PowerShell), NÃO na VPS:
scp -r C:\ClaudeCode\Consulta_ISP root@SEU_IP_VPS:/var/www/consulta-isp
```

---

## 5. Configurar variaveis de ambiente

```bash
# Na VPS, dentro de /var/www/consulta-isp
nano .env
```

Cole este conteudo (substitua os valores):

```env
# Supabase PostgreSQL (ja configurado)
DATABASE_URL=postgresql://postgres.qqcvtzxzznghhlqfxebo:SUA_SENHA@aws-1-sa-east-1.pooler.supabase.com:6543/postgres

# Sessao (gere uma string aleatoria)
SESSION_SECRET=gere-uma-string-aleatoria-longa-aqui-123456

# Servidor
PORT=5000
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info

# Servicos externos (preencha quando tiver as chaves)
RESEND_API_KEY=
ASAAS_API_KEY=
AI_INTEGRATIONS_OPENAI_API_KEY=
AI_INTEGRATIONS_OPENAI_BASE_URL=
GOOGLE_MAPS_API_KEY=
```

Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

**Gerar SESSION_SECRET aleatorio:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 6. Build do projeto

```bash
cd /var/www/consulta-isp

# Sync o schema no Supabase (cria tabelas se nao existirem)
npx drizzle-kit push --force

# Build de producao (esbuild backend + vite frontend)
npm run build
```

Se der erro no build, verifique:
```bash
npm run check  # verifica TypeScript
```

---

## 7. Iniciar com PM2

```bash
cd /var/www/consulta-isp

# Iniciar em producao
pm2 start dist/index.cjs --name consulta-isp --env production

# Verificar se esta rodando
pm2 status
pm2 logs consulta-isp

# Configurar para iniciar automaticamente no boot
pm2 save
pm2 startup
# PM2 vai mostrar um comando — COPIE E EXECUTE esse comando
```

**Testar localmente na VPS:**
```bash
curl http://localhost:5000/api/health
# Deve retornar: {"status":"ok","uptime":...}
```

---

## 8. Configurar Nginx (reverse proxy)

```bash
nano /etc/nginx/sites-available/consultaisp
```

Cole este conteudo (substitua `SEU_DOMINIO` pelo seu dominio real):

```nginx
server {
    listen 80;
    server_name SEU_DOMINIO.com.br www.SEU_DOMINIO.com.br;

    # Redirect HTTP to HTTPS (apos configurar SSL)
    # return 301 https://$server_name$request_uri;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeout para consultas ERP que podem demorar
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # WebSocket support (chat de suporte)
    location /ws {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Ativar o site:
```bash
# Ativar configuracao
ln -s /etc/nginx/sites-available/consultaisp /etc/nginx/sites-enabled/

# Remover site padrao
rm -f /etc/nginx/sites-enabled/default

# Testar configuracao
nginx -t

# Reiniciar Nginx
systemctl restart nginx
systemctl enable nginx
```

**Testar pelo IP:**
Acesse `http://SEU_IP_VPS` no browser — deve abrir o Consulta ISP.

---

## 9. Configurar dominio (DNS)

No painel da Hostinger (ou onde registrou o dominio):

1. Va em **DNS / Zones**
2. Adicione um registro **A**:
   - **Nome:** `@` (ou vazio)
   - **Valor:** `SEU_IP_VPS`
   - **TTL:** 3600
3. Adicione outro registro **A** para www:
   - **Nome:** `www`
   - **Valor:** `SEU_IP_VPS`
4. Se quiser subdominios por provedor (nslink.consultaisp.com.br):
   - **Nome:** `*` (wildcard)
   - **Valor:** `SEU_IP_VPS`

Aguarde propagacao (5-30 minutos).

---

## 10. Configurar SSL (HTTPS gratuito)

```bash
# Certificado Let's Encrypt automatico
certbot --nginx -d SEU_DOMINIO.com.br -d www.SEU_DOMINIO.com.br

# Seguir as instrucoes:
# - Email para notificacoes
# - Aceitar termos
# - Redirecionar HTTP para HTTPS (opcao 2)

# Renovacao automatica (ja configurada pelo certbot)
certbot renew --dry-run
```

Para subdominios wildcard (*.consultaisp.com.br):
```bash
certbot certonly --manual --preferred-challenges dns -d "*.consultaisp.com.br" -d "consultaisp.com.br"
# Vai pedir para adicionar um registro TXT no DNS — siga as instrucoes
```

---

## 11. Firewall (seguranca)

```bash
# Permitir apenas SSH, HTTP e HTTPS
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable

# Verificar
ufw status
```

A porta 5000 **nao precisa** ser aberta — Nginx faz proxy interno.

---

## 12. Comandos uteis de manutencao

```bash
# Ver logs do app
pm2 logs consulta-isp

# Reiniciar app
pm2 restart consulta-isp

# Atualizar codigo (apos git push)
cd /var/www/consulta-isp
git pull
npm install
npm run build
pm2 restart consulta-isp

# Ver status
pm2 status

# Monitorar recursos
pm2 monit

# Ver logs do Nginx
tail -f /var/log/nginx/error.log

# Backup do .env
cp .env .env.backup
```

---

## 13. Script de deploy automatico (opcional)

Crie em `/var/www/consulta-isp/deploy.sh`:

```bash
#!/bin/bash
echo "=== Deploy Consulta ISP ==="
cd /var/www/consulta-isp

echo "1. Pulling latest code..."
git pull origin main

echo "2. Installing dependencies..."
npm install

echo "3. Building..."
npm run build

echo "4. Pushing schema..."
npx drizzle-kit push --force

echo "5. Restarting app..."
pm2 restart consulta-isp

echo "6. Health check..."
sleep 3
curl -s http://localhost:5000/api/health

echo ""
echo "=== Deploy concluido! ==="
```

```bash
chmod +x deploy.sh
# Para usar: ./deploy.sh
```

---

## Resumo da arquitetura em producao

```
Internet
   |
   v
[Nginx :80/:443] ──SSL──> [Node.js :5000 via PM2]
                                    |
                                    v
                           [Supabase PostgreSQL]
                           (aws-1-sa-east-1)
```

- **Nginx:** Reverse proxy + SSL + WebSocket
- **PM2:** Mantem Node.js rodando 24/7 com restart automatico
- **Supabase:** Banco PostgreSQL gerenciado em Sao Paulo
- **Custo total:** ~R$30/mes (VPS) + R$0 (Supabase free) = **R$30/mes**

---

## Checklist final

- [ ] VPS contratada com Ubuntu
- [ ] SSH funcionando
- [ ] Node.js 20 instalado
- [ ] Projeto clonado/enviado
- [ ] .env configurado com Supabase URL
- [ ] `npm run build` sem erros
- [ ] PM2 rodando (`pm2 status` mostra "online")
- [ ] Nginx configurado como reverse proxy
- [ ] Dominio apontando para IP da VPS
- [ ] SSL ativo (https:// funcionando)
- [ ] Firewall configurado (ufw)
- [ ] `curl https://SEU_DOMINIO/api/health` retorna OK
