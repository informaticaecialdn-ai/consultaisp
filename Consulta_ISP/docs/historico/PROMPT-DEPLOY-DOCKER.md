# PROMPT PARA CLAUDE CODE: Validar e Corrigir Docker Setup para Deploy

> Cole este prompt inteiro no Claude Code. Ele contem o estado atual do Docker setup, os problemas encontrados, e as tarefas exatas para deixar tudo pronto para deploy.

---

## CONTEXTO

**Projeto:** `C:\ClaudeCode\Consulta_ISP\agentes-sistema\`
**Stack:** Node.js 20 + Express + better-sqlite3 + pdfkit (JavaScript puro)
**Deploy:** Docker Compose (app + Caddy reverse proxy com HTTPS automatico)
**Servidor porta:** 3001

O sistema de agentes IA esta 100% implementado em codigo. Agora precisa validar e corrigir o setup de Docker para deploy em producao.

---

## ESTADO ATUAL DOS ARQUIVOS DE DEPLOY

### Dockerfile (EXISTE — precisa melhorias)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p data
EXPOSE 3001
CMD ["node", "src/server.js"]
```

**Problemas:**
1. NAO tem `.dockerignore` — copia node_modules, .env, data/*.db, .git para dentro da imagem (imagem pesada, vaza credenciais)
2. NAO faz build em multi-stage (menor impacto, mas e boa pratica)
3. better-sqlite3 precisa de build tools no Alpine — pode falhar sem `python3 make g++`

### docker-compose.yml (EXISTE — precisa ajuste)
```yaml
version: '3.8'
services:
  agentes:
    build: .
    container_name: consulta-isp-agentes
    ports:
      - "3001:3001"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
    restart: unless-stopped
  caddy:
    image: caddy:2-alpine
    container_name: caddy-proxy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    restart: unless-stopped
volumes:
  caddy_data:
  caddy_config:
```

**Problemas:**
1. Porta 3001 exposta publicamente — com Caddy na frente, so precisa expor internamente (remove `ports` ou usa `expose`)
2. Caddy depende de `agentes` mas nao tem `depends_on`
3. Sem `healthcheck` — se o Node demora pra iniciar, Caddy pode tentar proxy antes de estar pronto
4. Sem `logging` config — em producao logs podem crescer sem limite

### Caddyfile (EXISTE — precisa dominio real)
```
agentes.consultaisp.com.br {
    reverse_proxy agentes:3001
}
```

**Problema:** Dominio `agentes.consultaisp.com.br` e placeholder. O usuario precisa configurar o dominio real, ou usar modo localhost para teste.

### .env (EXISTE — credenciais reais preenchidas)
- ANTHROPIC_API_KEY: preenchida
- ZAPI_INSTANCE_ID: preenchida
- ZAPI_TOKEN: preenchida
- ZAPI_CLIENT_TOKEN: vazio (nao necessario, token de seguranca inativo)
- WEBHOOK_URL: ainda tem placeholder `https://seu-dominio.com/webhook/zapi`

### package.json (OK)
- pdfkit ja instalado
- better-sqlite3 ^11.0.0
- Sem script de healthcheck

---

## TAREFAS DE IMPLEMENTACAO

### TAREFA 1: Criar .dockerignore

Criar `C:\ClaudeCode\Consulta_ISP\agentes-sistema\.dockerignore`:
```
node_modules
npm-debug.log
.env
.env.*
data/*.db
.git
.gitignore
tests/
*.md
Caddyfile
docker-compose.yml
```

Isso evita copiar credenciais, banco de dados, e arquivos desnecessarios para a imagem.

### TAREFA 2: Corrigir Dockerfile

O better-sqlite3 precisa de ferramentas de compilacao no Alpine. Corrigir:

```dockerfile
FROM node:20-alpine

# better-sqlite3 precisa de build tools para compilar
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Remove build tools apos install (reduz imagem)
RUN apk del python3 make g++

COPY . .

RUN mkdir -p data

# Healthcheck endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

EXPOSE 3001

CMD ["node", "src/server.js"]
```

### TAREFA 3: Adicionar endpoint /api/health

Criar um endpoint simples de healthcheck em `src/routes/api.js`:

```javascript
// No inicio das rotas em api.js:
router.get('/health', (req, res) => {
  try {
    const db = require('../models/database').getDb();
    // Testa se o banco esta acessivel
    db.prepare('SELECT 1').get();
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      error: error.message 
    });
  }
});
```

### TAREFA 4: Corrigir docker-compose.yml

```yaml
version: '3.8'

services:
  agentes:
    build: .
    container_name: consulta-isp-agentes
    # NAO expor porta publicamente — Caddy faz o proxy
    expose:
      - "3001"
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

  caddy:
    image: caddy:2-alpine
    container_name: caddy-proxy
    depends_on:
      - agentes
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  caddy_data:
  caddy_config:
```

**Mudancas:**
- `ports` → `expose` (porta so visivel na rede Docker, nao no host)
- Adicionado `depends_on: agentes` no Caddy
- Adicionado `logging` com rotacao (max 10MB x 3 arquivos)
- Montagem de `skills-ref` como read-only (os 6 markdowns de skills)

### TAREFA 5: Caddyfile com opcao localhost

Atualizar o Caddyfile para funcionar em teste local e producao:

```
# === PRODUCAO ===
# Descomente e substitua pelo seu dominio real:
# agentes.consultaisp.com.br {
#     reverse_proxy agentes:3001
# }

# === TESTE LOCAL ===
# Para testar sem dominio (HTTP na porta 80):
:80 {
    reverse_proxy agentes:3001
}
```

Quando o usuario tiver dominio, ele descomenta o bloco de producao e comenta o de teste.

### TAREFA 6: Atualizar WEBHOOK_URL no .env

Apos o Caddy estar configurado com dominio real, o .env precisa do WEBHOOK_URL correto.

Adicionar um comentario explicativo no .env:
```env
# Webhook — Z-API envia mensagens recebidas para esta URL
# Para teste local com ngrok: https://abc123.ngrok.io/webhook/zapi  
# Para producao: https://agentes.consultaisp.com.br/webhook/zapi
WEBHOOK_URL=https://seu-dominio.com/webhook/zapi
```

### TAREFA 7: Script de primeiro deploy

Criar `C:\ClaudeCode\Consulta_ISP\agentes-sistema\deploy.sh`:

```bash
#!/bin/bash
set -e

echo "=== Consulta ISP Agentes - Deploy ==="

# Verifica .env
if [ ! -f .env ]; then
  echo "ERRO: Arquivo .env nao encontrado!"
  echo "Copie .env.modelo para .env e preencha as credenciais."
  exit 1
fi

# Verifica credenciais obrigatorias
source .env
if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "sk-ant-COLE-SUA-CHAVE-AQUI" ]; then
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
    echo "  2. Configure o webhook no painel Z-API: \${WEBHOOK_URL}"
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
```

### TAREFA 8: Verificacao final

Apos implementar tudo, rodar estes checks:

```bash
# 1. Verificar que .dockerignore funciona (nao copia .env nem node_modules)
docker compose build 2>&1 | tail -5

# 2. Verificar que o container sobe
docker compose up -d
docker compose ps

# 3. Verificar healthcheck
docker exec consulta-isp-agentes wget -qO- http://localhost:3001/api/health

# 4. Verificar logs
docker compose logs --tail=20 agentes

# 5. Verificar que skills-ref esta montado
docker exec consulta-isp-agentes ls /app/skills-ref/
```

---

## RESUMO EXECUTIVO

| # | Tarefa | Prioridade | Impacto |
|---|--------|-----------|---------|
| 1 | .dockerignore | ALTA | Evita vazar .env e banco na imagem |
| 2 | Fix Dockerfile (build tools) | ALTA | Sem isso better-sqlite3 nao compila |
| 3 | Endpoint /api/health | MEDIA | Healthcheck do Docker |
| 4 | Fix docker-compose.yml | MEDIA | Seguranca (porta) + dependencias + logs |
| 5 | Caddyfile localhost | BAIXA | Facilita teste local |
| 6 | Comentarios WEBHOOK_URL | BAIXA | Documentacao |
| 7 | Script deploy.sh | BAIXA | Facilita primeiro deploy |
| 8 | Verificacao | — | Rodar apos tudo |

## INSTRUCOES CRITICAS

1. **NAO altere nenhum arquivo de servico** (orchestrator, claude, training, etc.) — o codigo esta 100% pronto
2. **So altere arquivos de infra:** Dockerfile, docker-compose.yml, Caddyfile, .dockerignore, deploy.sh, e o endpoint /api/health
3. **Teste o build localmente** com `docker compose build` antes de confirmar
4. **O .env ja tem credenciais reais** — NUNCA commite esse arquivo
