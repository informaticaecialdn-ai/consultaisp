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

Variaveis **obrigatorias** (sem elas o app nao sobe ou nao responde):
`ANTHROPIC_API_KEY`, `AGENT_*_ID`, `ZAPI_*`, `WEBHOOK_URL`.

Variaveis **Litestream** (continuam comentadas ate o Sprint 1):
`LITESTREAM_B2_BUCKET`, `LITESTREAM_B2_REGION`, `LITESTREAM_B2_ENDPOINT`,
`LITESTREAM_B2_KEY_ID`, `LITESTREAM_B2_APP_KEY`.

Nunca comite `.env`. `.gitignore` ja cobre o padrao `**/.env`.

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

Em incidente alto-impacto:
1. Snapshot defensivo (`./scripts/backup-snapshot.sh`).
2. `docker compose logs --since 30m agentes > /tmp/agentes.log` para triagem.
3. Se for corrupcao de DB: restore do ultimo snapshot bom + `scripts/restore-litestream.sh`.
4. Documente a causa-raiz em `docs/historico/INCIDENTES.md` (criar se nao existir).

---

**Donos do runbook:** time de infra do Consulta ISP. Atualize este arquivo
sempre que mudar stack, credenciais ou procedimentos.
