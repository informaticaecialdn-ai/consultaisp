# RUNBOOK — agentes-sistema (deploy + operacao)

Documento operacional para quem estiver de planta. Cobre deploy limpo,
atualizacoes, backup/restore, desativar/reativar Litestream e resposta
a incidentes. Mantenha curto e atualizado.

Ambiente alvo: VPS Hostinger, Ubuntu 22.04+, Docker + Docker Compose v2,
Node nao instalado no host (tudo em container).

---

## 1. Pre-requisitos da VPS

Antes do primeiro deploy, garanta:

- Docker Engine 24+ e Docker Compose v2 (`docker --version`, `docker compose version`).
- Usuario nao-root no grupo `docker` (evita `sudo` em todo comando).
- Dominio apontando para o IP da VPS (`A record` + `AAAA` opcional).
- Porta 80/443 abertas no firewall (Caddy cuida dos certificados).
- sqlite3 CLI instalado no host para scripts de snapshot:
  `sudo apt-get install -y sqlite3`.
- Zona horaria configurada (`timedatectl set-timezone America/Sao_Paulo`).

Clonar o repo em `/srv/consulta-isp-agentes/` (caminho padrao assumido pelos scripts).

---

## 2. Configurar secrets (.env)

Copiar o modelo e preencher:

```bash
cd /srv/consulta-isp-agentes/Consulta_ISP/agentes-sistema
cp .env.modelo .env
chmod 600 .env
vim .env
```

### 2.1 Variaveis CRITICAS (sem elas o app nao sobe ou nao responde)

| Var | Origem | O que acontece se faltar |
|-----|--------|--------------------------|
| `ANTHROPIC_API_KEY` | console.anthropic.com | Agentes nao geram resposta |
| `AGENT_SOFIA_ID`, `AGENT_LEO_ID`, `AGENT_CARLOS_ID`, `AGENT_LUCAS_ID`, `AGENT_RAFAEL_ID`, `AGENT_MARCOS_ID`, `AGENT_DIANA_ID` | Anthropic Platform Agents | Mapeamento de agente nao funciona |
| `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN` | app.z-api.io | Mensagens nao enviadas/recebidas |
| `WEBHOOK_URL` | dominio publico | `setup-webhook` nao consegue configurar Z-API |

### 2.2 Variaveis de SEGURANCA (Sprint 2 + login Sprint 4)

| Var | Default sugerido | O que faz |
|-----|------------------|-----------|
| `API_AUTH_TOKEN` | `openssl rand -hex 32` | Token Bearer obrigatorio em `/api/*` (exceto `/api/health` e `/api/auth/*`) |
| `LOGIN_PASSWORD` | `<frase memorivel>` | Senha do formulario `/login.html`. Se ausente, login aceita o proprio API_AUTH_TOKEN |
| `ZAPI_WEBHOOK_TOKEN` | `openssl rand -hex 32` | Header HMAC enviado pela Z-API ao chamar `/webhook/zapi` |
| `ZAPI_WEBHOOK_ENFORCE` | `false` | `true` rejeita webhook sem header HMAC. **Use `false` ate validar nos logs que header esta chegando** |

**Fluxo de login:** Usuario acessa `/`, JS detecta ausencia de
`localStorage.api_token` e redireciona para `/login.html`. Form pede
senha (LOGIN_PASSWORD ou API_AUTH_TOKEN). POST `/api/auth/login`
valida e retorna o API_AUTH_TOKEN, que e gravado em localStorage.
Endpoint `/api/auth/check` valida token armazenado.

Rate limit do login: 10 tentativas / 15 min por IP (anti brute-force).
Resposta com delay constante de 400ms anti timing-attack.

### 2.3 Variaveis de OBSERVABILITY (Sprint 3 — adicionadas abr/2026)

| Var | Default | O que faz |
|-----|---------|-----------|
| `COST_ALERT_DAILY_USD` | `25` | Threshold de alerta diario do gasto Claude |
| `COST_ALERT_WEBHOOK` | (vazio) | URL Discord/Slack/generica que recebe POST quando passa do threshold |
| `ERROR_REPORT_WEBHOOK` | (vazio) | Mesma logica para erros capturados (`uncaughtException`/Express handler) |
| `LOG_LEVEL` | `info` em prod, `debug` em dev | Pino log level |
| `NODE_ENV` | `production` | Define formato de log (JSON vs pino-pretty) |

### 2.4 Variaveis de WORKERS / BROADCAST (Sprint 5 — defaults seguros)

| Var | Default | O que faz |
|-----|---------|-----------|
| `BROADCAST_WORKER_ENABLED` | `true` | Liga worker de broadcast. `false` = kill switch (worker idle em ate 10s) |
| `FOLLOWUP_WORKER_ENABLED` | `true` | Liga worker de followup |
| `RUN_WORKERS_IN_SERVER` | `false` | `true` apenas em dev — embarca workers no processo HTTP |
| `BROADCAST_RATE_PER_MIN` | `20` | Rate limit padrao por campanha (overridavel por campanha) |
| `BROADCAST_JITTER_MIN_SEC` / `BROADCAST_JITTER_MAX_SEC` | `3` / `8` | Jitter aleatorio entre envios |
| `BROADCAST_MAX_RETRIES` | `3` | Tentativas em erro transient antes de marcar `falhou` |
| `BROADCAST_RETRY_DELAYS_SEC` | `30,120,600` | Delays exponenciais (1a, 2a, 3a tentativa) |
| `BROADCAST_FAILURE_THRESHOLD_PCT` | `20` | Auto-pause se taxa de falha > N% (base >= 10 processados) |
| `BROADCAST_BATCH_SIZE` | `10` | Quantos envios o worker reivindica por iteracao |

### 2.5 Variaveis de LITESTREAM (continuam comentadas ate ser reativado)

`LITESTREAM_B2_BUCKET`, `LITESTREAM_B2_REGION`, `LITESTREAM_B2_ENDPOINT`,
`LITESTREAM_B2_KEY_ID`, `LITESTREAM_B2_APP_KEY`. Ver secao 10.

### 2.6 Boas praticas

- **Nunca comite `.env`** — `.gitignore` ja cobre `**/.env`
- **Nunca cole valores via `echo >>`** — gera duplicatas. Use `nano .env` ou
  o helper idempotente `scripts/deploy-sprint4.sh` (faz upsert sem duplicar)
- **Para gerar tokens fortes:** `openssl rand -hex 32`
- **Para validar tudo presente apos editar:**
  ```bash
  for v in ANTHROPIC_API_KEY API_AUTH_TOKEN ZAPI_INSTANCE_ID ZAPI_TOKEN \
           ZAPI_WEBHOOK_TOKEN WEBHOOK_URL; do
    grep -qE "^${v}=.+" .env && echo "${v}=<set>" || echo "${v}=MISSING"
  done
  ```

### 2.7 Reload apos editar `.env`

Vars sao lidas no boot do container. Apos editar:

```bash
docker compose restart agentes
docker compose restart worker  # se mudou BROADCAST_*
```

Worker tambem le `.env` a cada iteracao (BROADCAST_WORKER_ENABLED, kill switch).
Para mudancas de outras vars, restart e necessario.

---

## 3. Deploy inicial (primeira subida)

```bash
cd /srv/consulta-isp-agentes/Consulta_ISP/agentes-sistema
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f agentes   # acompanhe ate ver "Servidor rodando na porta 3001"
```

Validar healthcheck manual:

```bash
curl -sS https://seu-dominio.com/          # deve servir o dashboard estatico
curl -sS https://seu-dominio.com/api/health || true
```

Configurar webhook no Z-API (uma vez):

```bash
curl -X POST https://seu-dominio.com/api/setup-webhook
```

---

## 4. Atualizar deploy (hotfix / release)

Fluxo padrao, sem downtime relevante:

```bash
cd /srv/consulta-isp-agentes
git fetch origin
git pull --ff-only origin main
cd Consulta_ISP/agentes-sistema

# Snapshot defensivo antes de qualquer mudanca
./scripts/backup-snapshot.sh

docker compose build agentes
docker compose up -d agentes    # reinicia so o agentes, mantem caddy
docker compose logs -f agentes  # monitorar ~60s
```

Em caso de breaking change de schema (tocar `src/models/database.js`), **sempre**
rodar `./scripts/backup-snapshot.sh` antes. Neste Sprint 0 nenhum schema muda.

---

## 5. Backup e Snapshots

### Snapshot manual (point-in-time)

Gera um `.sqlite.gz` consistente em `./backups/snapshots/` e mantem os 14 mais
recentes localmente:

```bash
./scripts/backup-snapshot.sh
ls -lht backups/snapshots/ | head -5
```

Use antes de migrar schema, rodar import massivo ou debugar em producao.

### Copia para fora da VPS

Recomenda-se replicar pelo menos um snapshot/dia para storage externo
(B2/S3) mesmo com Litestream desativado. Exemplo cru com `rclone`:

```bash
rclone copy backups/snapshots/ b2:consulta-isp-backups/agentes-sistema/ \
  --include "*.sqlite.gz" --max-age 7d
```

Quando Litestream entrar no ar (Sprint 1), esse step manual vira redundancia.

---

## 6. Litestream — ativacao (Sprint 1) e operacao

> **Status atual (Sprint 0):** config pronta em `litestream.yml`, bloco comentado
> em `docker-compose.yml`, scripts prontos. **Nao ativar ainda** — valide
> backup/snapshot manual primeiro.

### Ativar

1. Preencher as variaveis `LITESTREAM_*` no `.env` (credenciais B2/S3).
2. Descomentar o servico `litestream` em `docker-compose.yml`.
3. Subir o container novo:
   ```bash
   docker compose up -d litestream
   docker compose logs -f litestream   # ver "initialized" + primeiro snapshot
   ```
4. Validar:
   ```bash
   docker compose exec litestream litestream snapshots /data/agentes.db
   ```

### Restore a partir do replica

Procedimento destrutivo — o `.env` precisa ter as mesmas credenciais usadas
para replicar.

```bash
./scripts/restore-litestream.sh                     # ultimo estado consistente
./scripts/restore-litestream.sh --timestamp 2026-04-15T03:00:00Z
```

O script para o container `agentes`, move o DB atual para `*.pre-restore-<ts>`,
restaura, roda `PRAGMA integrity_check` e reinicia o container. Se o
`integrity_check` falhar, o DB velho segue intacto no `.pre-restore-*`.

### Desativar Litestream (rollback)

```bash
docker compose stop litestream
# comentar o bloco litestream em docker-compose.yml (voltar ao estado do Sprint 0)
docker compose up -d --remove-orphans
```

---

## 7. Logs, observabilidade e rotacao

- Logs container-por-container: `docker compose logs --tail 200 agentes`.
- Rotacao ja esta configurada no compose (`max-size: 10m`, `max-file: 3`).
- Para acompanhar metricas Litestream (quando ativo), endpoint
  `http://127.0.0.1:9090/metrics` dentro da rede Docker (expor via Caddy se precisar).
- Status rapido do sistema:
  ```bash
  docker compose ps
  df -h /srv                     # espaco em disco
  du -sh Consulta_ISP/agentes-sistema/data/     # tamanho do DB + WAL
  ```

---

## 8. Troubleshooting rapido

| Sintoma | Primeira coisa a checar | Acao |
| --- | --- | --- |
| `agentes` reinicia em loop | `docker compose logs agentes` | normalmente `.env` faltando var obrigatoria |
| `sqlite3: database is locked` nos logs | WAL cheio | parar container, `backup-snapshot.sh`, subir de novo |
| Webhook Z-API nao dispara | IP publico / certificado Caddy | `curl -I https://<dominio>/webhook/zapi`; reconfigurar via `/api/setup-webhook` |
| Litestream nao replica | credenciais ou endpoint B2 | `docker compose logs litestream`; verificar `LITESTREAM_B2_*` no `.env` |
| `restore-litestream.sh` falha no integrity_check | replica corrompido | tentar `--timestamp` anterior; se persistir, restaurar snapshot local `.sqlite.gz` |
| Dashboard retorna 502 | Caddy nao alcanca `agentes:3001` | `docker compose restart agentes`; checar health |
| Dashboard 502 Bad Gateway | nginx do host nao alcanca container | Verificar `docker compose ps` mostra `127.0.0.1:3080->3001/tcp`. Se nao, reaplicar bloco `ports:` no docker-compose.yml e `docker compose up -d --force-recreate agentes` |
| /api/X retorna "Cannot GET" mas /api/health funciona | Imagem antiga rodando | `cd /opt/consulta-isp-fullrepo && git pull && cd /opt/consulta-isp-agentes && docker compose build --no-cache agentes && docker compose up -d --force-recreate agentes` |
| Litestream 403 AccessDenied / InvalidAccessKeyId | Key com namePrefix OU bug B2 | Recriar key SEM "File name prefix". Se persistir, ver secao 10 (Litestream divida tecnica) |
| `/api/leads` retorna 401 unauthorized (Sprint 2) | Bearer token ausente ou errado | Header `Authorization: Bearer $API_AUTH_TOKEN`. Dashboard pede o token na primeira carga |
| Z-API `setup-webhook` retorna 500 "Instance not found" | Credenciais Z-API erradas/expiradas | Conferir `ZAPI_INSTANCE_ID`/`TOKEN`/`CLIENT_TOKEN` no painel app.z-api.io. Atualizar `.env` + `docker compose restart agentes` |
| Webhook Z-API recebe 401 apos flipar `ZAPI_WEBHOOK_ENFORCE=true` | Z-API nao envia o header `X-Z-API-Token` | Verificar que `setup-webhook` foi chamado APOS setar `ZAPI_WEBHOOK_TOKEN` no `.env`. Header e configurado na Z-API via API setWebhook |
| `/api/health/deep` retorna `degraded: backup` | Heartbeat de backup ausente ha > 7h | Rodar `bash scripts/backup-snapshot.sh` (gera `data/.last-backup-at`). Configurar cron 6h se ainda nao tiver |
| `/api/health/deep` retorna 503 com `anthropic: down` | API key vencida ou Anthropic fora | Verificar `ANTHROPIC_API_KEY` em console.anthropic.com. Cache de check e 60s, espere 1min apos atualizar |
| `cost_alert` disparou e custo Claude alto inesperado | Loop infinito de retry, ou agente respondendo sem parar | Checar `/api/costs/today` para ver breakdown por agente. `/api/errors` para ver erros recentes. Considerar pausar broadcast |
| Logs sem `X-Correlation-Id` em request | Middleware correlation nao registrado (regressao Sprint 3/T1) | Conferir `app.use(correlationMiddleware)` em `src/server.js` ANTES dos routers |
| `errors_log` crescendo sem parar | Bug em codigo gerando uncaughtException continuo | `GET /api/errors` para ver tipo. `cleanupOldResolved()` apaga apenas resolvidos > 90 dias. Resolver e marcar via `POST /api/errors/:id/resolve` |

Em incidente alto-impacto:
1. Snapshot defensivo (`./scripts/backup-snapshot.sh`).
2. `docker compose logs --since 30m agentes > /tmp/agentes.log` para triagem.
3. Se for corrupcao de DB: restore do ultimo snapshot bom + `scripts/restore-litestream.sh`.
4. Documente a causa-raiz em `docs/historico/INCIDENTES.md` (criar se nao existir).

---

## 9. Licoes aprendidas no Sprint 1 (deploy real)

Documentadas em ordem de gravidade. Releia esta secao antes de qualquer
deploy ou troubleshooting.

### 9.1 nginx do host bloqueia portas 80/443 (impede Caddy do Docker)
**Sintoma**: Caddy do docker-compose sobe mas fica "Up 15h" sem PORTS
mapeados; dashboard inacessivel; navegador retorna 404 servido por
"nginx/1.24.0 (Ubuntu)".

**Causa**: Esta VPS roda o produto Consulta ISP em /etc/nginx/sites-enabled/
consultaisp, ocupando :80 e :443. Caddy nao consegue bind nessas portas.

**Solucao adotada**: Manter nginx do host. Comentar bloco caddy no
docker-compose.yml. Adicionar /etc/nginx/sites-available/agentes fazendo
proxy_pass para http://127.0.0.1:3080 (porta exposta pelo container
agentes via "127.0.0.1:3080:3001"). Symlink em sites-enabled, nginx -t,
systemctl reload nginx.

**Validacao preventiva (antes de qualquer deploy novo)**:
    systemctl is-active nginx
    ss -tlnp | grep -E ':80\s|:443\s'

Se nginx ativo na VPS, NUNCA tentar subir Caddy. Sempre proxy reverso.

### 9.2 git commit != git push (branches locais nao chegam no GitHub)
**Sintoma**: VPS faz git clone do GitHub, nao ve commits que existem na
maquina local. Build pega codigo antigo.

**Causa**: branches novas locais precisam de `git push -u origin <branch>`
no primeiro push para criar o remote tracking. `git push origin <branch>`
sem -u falha silenciosamente em algumas configuracoes.

**Solucao**: Apos commit local, sempre validar:
    git ls-remote origin <branch>
Se hash nao bater com o local, fazer `git push -u origin <branch>`.

### 9.3 Pasta da VPS era copia manual sem .git (divergencia cronica)
**Sintoma**: `git pull` na VPS retorna `fatal: not a git repository`.
Bugs corrigidos no GitHub continuam vivos em producao.

**Causa**: Deploys anteriores eram copias de arquivos via rsync/scp, nao
git clone. Nao ha rastreabilidade do que esta rodando.

**Solucao adotada**: Cutover para clone git real:
    1. Backup .env e data/ em /tmp
    2. mv consulta-isp-agentes consulta-isp-agentes.OLD-<ts>
    3. git clone https://github.com/informaticaecialdn-ai/consultaisp.git /opt/consulta-isp-fullrepo
    4. cd /opt/consulta-isp-fullrepo && git checkout heatmap-fix
    5. ln -s /opt/consulta-isp-fullrepo/Consulta_ISP/agentes-sistema /opt/consulta-isp-agentes
    6. Restaurar .env e data/ no symlink
    7. docker compose build --no-cache && docker compose up -d

**A partir de agora**: deploys futuros sao trivials:
    cd /opt/consulta-isp-fullrepo
    git pull origin heatmap-fix
    cd /opt/consulta-isp-agentes
    docker compose build agentes
    docker compose up -d --force-recreate agentes

### 9.4 docker compose up -d --force-recreate NAO rebuilda imagem
**Sintoma**: Apos atualizar codigo, novos endpoints retornam 404 (ex:
/api/diagnose). Build aparenta ter rodado mas codigo antigo persiste.

**Causa**: --force-recreate apenas recria o container; usa imagem
existente. Mudancas em arquivos COPY no Dockerfile nao sao incorporadas
sem build explicito.

**Solucao**: Sempre `docker compose build --no-cache <svc>` ANTES de
up -d --force-recreate quando houver mudanca de codigo.

### 9.5 YAML colado direto no shell quebra (services:: command not found)
**Sintoma**: `services:: command not found`, `agentes:: command not found`,
etc. ao tentar editar docker-compose.yml.

**Causa**: bash interpreta cada linha como comando ao colar texto YAML
diretamente no prompt.

**Solucao**: SEMPRE usar `cat > arquivo.yml << 'EOF' ... EOF` (heredoc)
ou `nano arquivo.yml` para editar arquivos. Nunca colar YAML/JSON
multiline diretamente no shell.

### 9.6 Backblaze B2 "namePrefix" da Application Key restringe operacoes
**Sintoma**: Litestream retorna `403 AccessDenied: not entitled` mesmo
com Read+Write e bucket correto.

**Causa**: O campo "File name prefix" do formulario de criacao da
Application Key, quando preenchido, restringe a key a so acessar arquivos
cujo path comeca com esse prefix. Litestream precisa de operacoes
bucket-level (listar generations) que essa restricao impede.

**Solucao**: Ao criar Application Key para Litestream/rclone/restic,
DEIXAR "File name prefix" ABSOLUTAMENTE VAZIO. A seguranca vem do
"Allow access to Bucket(s)" (escopo de bucket), nao do prefix.

**Nota adicional**: Em 4 tentativas de criar key correta (sem prefix,
Read+Write, escopo bucket), B2 continuou retornando InvalidAccessKeyId.
Causa raiz nao identificada. Litestream esta DESATIVADO. Ver secao 10.

---

## 10. Litestream: divida tecnica + alternativas

**Status atual (Sprint 1, abr/2026)**: NAO ativo. Container removido,
bloco comentado em docker-compose.yml.

### Compensacao em vigor
Snapshot local automatico via cron a cada 6h:
    crontab -l | grep backup
    # 0 */6 * * * cd /opt/consulta-isp-agentes && bash scripts/backup-snapshot.sh >> /var/log/agentes-backup.log 2>&1

Retencao: 14 snapshots mais recentes em backups/snapshots/ (script
backup-snapshot.sh ja faz cleanup automatico).

**Limitacao consciente**: snapshot local NAO protege contra:
- VPS pegar fogo (snapshots vao junto)
- Disco corrompido / RAID falho
- Ransomware criptografando o disco inteiro

Resolve apenas: rollback rapido apos erro humano (ex: query DELETE
acidental, schema migration que quebrou).

### Opcoes para reativar replicacao remota (escolher uma e testar)

| Opcao | Probabilidade de funcionar | Esforco | Custo/mes |
|---|---|---|---|
| Cloudflare R2 | Alta | 30 min | Free 10 GB + sem egress |
| AWS S3 | Alta | 30 min | Free 5 GB / 12 meses |
| Wasabi | Alta | 30 min | $7/mes minimo |
| rclone + cron pra B2 | Alta | 45 min | Free 10 GB B2 |
| Tentar B2 + Litestream do zero (conta nova) | Media | 20 min | Free 10 GB |

Recomendacao prioritaria: **Cloudflare R2** (zero egress, sem chance de
queimar o free tier mesmo em desastre).

### O que aconteceu com B2 + Litestream (registro forense)
- Bucket "agentes" criado em us-east-005, privado, encryption ativa
- 4 Application Keys criadas (v1, v2, v3, v4)
- v2: criada com "File name prefix" preenchido por engano -> 403 not entitled
- v3 e v4: criadas SEM prefix, com Read+Write, escopo bucket -> InvalidAccessKeyId persistente
- Vars LITESTREAM_B2_* validadas no .env (tamanhos corretos, sem espacos extras, sem inversao keyID/applicationKey)
- Causa raiz nao identificada. Possivel bug do Litestream com B2 us-east-005
- Nao foi tentado: trocar para region us-west, conta B2 nova, ou switch para AWS S3 (decidido pular para nao bloquear Sprint)

### Quando retomar
Adicionar ticket separado no proximo Sprint para escolher e implementar
uma das opcoes acima. Pre-requisito: ter ~30 min de paciencia para debug
caso a primeira opcao tambem falhe.

---

## 11. Visao estrategica e planejamento de sprints

Este runbook cobre exclusivamente a camada operacional (deploy, backup,
troubleshooting). Para entender **o que foi entregue em cada sprint**,
**quais dividas tecnicas estao ativas** e **o que esta no proximo ciclo**,
consulte:

- `ROADMAP.md` — visao estrategica (sprints 0-5 entregues, sprint 6 planejado)
- `docs/SMOKE-TEST-CAMPANHA.md` — procedimento de validacao antes de
  qualquer campanha real

Regra pratica: bugs e incidentes -> runbook. Prioridades e escopo -> roadmap.

---

**Donos do runbook:** time de infra do Consulta ISP. Atualize este arquivo
sempre que mudar stack, credenciais ou procedimentos.
