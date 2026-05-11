# Deploy Spec 004 — VPS Hostinger (T064)

**Pré-requisitos:**
- Branch `004-cobranca-pix-bruno-sofia` mergeada em `main` OU push direto da branch
- VPS Hostinger acessível via SSH
- Backup do banco antes de aplicar migrations (recomendado)
- PM2 rodando (`pm2 list` deve mostrar processos ativos)
- Redis disponível na VPS (`redis-cli ping` → PONG)

---

## Ordem de deploy

### Passo 1 — Push do branch para main

**Local:**

```bash
git checkout main
git merge 004-cobranca-pix-bruno-sofia
git push origin main
```

OU push direto da branch:

```bash
git push origin 004-cobranca-pix-bruno-sofia:main
```

### Passo 2 — Backup do banco (precaução)

**VPS:**

```bash
ssh user@vps-hostinger

# Backup snapshot do banco (timestamped)
pg_dump $DATABASE_URL > /backup/consulta-isp-pre-spec004-$(date +%Y%m%d-%H%M%S).sql

# Verificar tamanho
ls -lah /backup/consulta-isp-pre-spec004-*.sql
```

### Passo 3 — Pull + build na VPS

```bash
cd /var/www/consulta-isp  # ou caminho real

git pull origin main

# Install deps (pdfkit nova)
npm ci

# Build
npm run build
```

### Passo 4 — Aplicar migrations Spec 004

```bash
npm run db:migrate
```

**Esperado em stdout:**
```
Applying migrations/0005_spec004_create_tables.sql ... OK
Applying migrations/0006_spec004_outbound_unique_index.sql ... OK
Applying migrations/0007_spec004_backfill_agent_toggles.sql ... OK
All migrations applied and schema verified.
```

Se algum erro: as migrations são idempotentes (`IF NOT EXISTS` + `ON CONFLICT DO NOTHING`), pode rodar de novo sem efeito colateral.

### Passo 5 — Validar variáveis de ambiente

```bash
# Garantir que REDIS_URL está setado (Bruno/Sofia precisam)
grep "^REDIS_URL=" .env || echo "FALTA REDIS_URL"

# Garantir que ANTHROPIC_API_KEY está válido
grep "^ANTHROPIC_API_KEY=" .env

# Outros já existem da Spec 003
grep -E "^(ENCRYPTION_MASTER_KEY|DATABASE_URL|META_VERIFY_TOKEN)=" .env
```

Se REDIS_URL estiver ausente, Bruno/Sofia/retry workers ficam **desligados** (degrada limpo — webhook Asaas e UI continuam funcionando).

### Passo 6 — Restart processes (PM2)

```bash
# Restart graceful
pm2 restart all

# Verificar status
pm2 list

# Logs recentes — confirmar boot OK
pm2 logs --lines 30 --nostream
```

**Esperado nos logs do worker process:**
```
[Worker] ERP sync worker starting
[Worker] ERP sync scheduler started
[Worker] LGPD retention scheduler started
[Worker] LGPD titular processor started
[Worker] Bruno + Sofia + outbound retry started (Spec 004)
[Worker] Ready — background jobs running
```

Se faltar a linha "Bruno + Sofia + outbound retry started" → verificar REDIS_URL.

### Passo 7 — Smoke test rápido

```bash
# Testar endpoint público
curl -X POST https://vertical.provedor.ai/webhooks/asaas \
  -H "Content-Type: application/json" \
  -H "asaas-access-token: WRONG" \
  -d '{"event":"PAYMENT_RECEIVED","payment":{"id":"pay_test"}}'

# Esperado: 401 (auth_failed) com asaas-access-token errado, ou 400 se externalReference vazio
```

```bash
# Testar GET admin (requer cookie de sessão admin, mas resposta de erro confirma rota existe)
curl -i https://vertical.provedor.ai/api/asaas/account
# Esperado: 401 Autenticacao necessaria
```

### Passo 8 — Validação regressiva Spec 003

**Verificar que Helena + Júlia continuam funcionando:**

1. Enviar 1 mensagem WhatsApp inbound para o número do Vertical Fibra
2. Aguardar resposta (deveria chegar em <30s)
3. Validar logs `helena_done` no worker
4. Sem regressão = OK

```bash
# Logs filtrados Helena (últimas 10min)
pm2 logs worker --lines 200 --nostream | grep -E "helena_|julia_decision" | tail -20
```

### Passo 9 — Smoke test completo Spec 004

Seguir `specs/004-cobranca-pix-bruno-sofia/SMOKE-TEST-RESULT.md` etapa por etapa. Marcar resultados.

---

## Comando único (atalho)

Quando confiante, deploy em 1 linha (após push para main):

```bash
ssh user@vps "cd /var/www/consulta-isp && git pull origin main && npm ci && npm run build && npm run db:migrate && pm2 restart all && pm2 logs --lines 30 --nostream"
```

---

## Rollback

Se algo quebrar:

```bash
# Voltar para commit anterior
ssh user@vps
cd /var/www/consulta-isp
git log --oneline | head -5  # identificar SHA anterior
git checkout <sha_anterior>
npm ci
npm run build
pm2 restart all
```

**Migrations rollback:** as 3 migrations da Spec 004 só fazem CREATE. Para reverter:

```sql
-- Em ordem reversa
DROP TABLE IF EXISTS outbound_attempts;
DROP TABLE IF EXISTS agent_toggles;
DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS pix_charges;
DROP TABLE IF EXISTS asaas_accounts;
```

Mas: **fazer rollback de schema com dados em produção é destrutivo**. Prefira corrigir forward (criar nova migration de correção) em vez de DROP.

---

## Validação pós-deploy (checklist)

- [ ] `pm2 list` mostra todos processos em `online`
- [ ] Worker loga "Bruno + Sofia + outbound retry started"
- [ ] `POST /webhooks/asaas` responde (não 502)
- [ ] `GET /api/regua/pre-vencimento` autenticado retorna 200 com items vazio
- [ ] `GET /api/asaas/account` autenticado retorna `{ connected: false }` (sem chave configurada)
- [ ] Painel `/configuracoes/asaas` carrega no browser
- [ ] Painel `/configuracoes/agentes` carrega
- [ ] Painel `/regua-pre-vencimento` carrega
- [ ] Sidebar mostra novo grupo "Cobrança" com 3 itens
- [ ] Helena inbound WhatsApp responde normal
- [ ] Júlia compliance check funciona normal
- [ ] ERP sync continua rodando (logs `erp_sync` aparecem)

---

## Monitoramento pós-deploy (primeira semana)

```bash
# 1. Erros novos nos workers
pm2 logs worker --lines 1000 --nostream | grep -E '"level":"error"' | tail -20

# 2. Latência Bruno (deve estar p95 < 4s — alvo contract)
psql $DATABASE_URL -c "
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY (payload->>'latencyMs')::int) as p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'latencyMs')::int) as p95,
  COUNT(*) as total
FROM audit_logs
WHERE action = 'bruno_send_message'
  AND occurred_at > NOW() - INTERVAL '7 days';
"

# 3. Taxa de veto Júlia (saúde do compliance)
psql $DATABASE_URL -c "
SELECT decision, COUNT(*)
FROM compliance_checks
WHERE created_at > NOW() - INTERVAL '7 days'
  AND agent_id IN ('agt_preventivo_v1', 'agt_relacionamento_v1')
GROUP BY decision;
"

# 4. Falhas Bruno (não deve crescer)
psql $DATABASE_URL -c "
SELECT failure_reason, COUNT(*)
FROM outbound_attempts
WHERE status = 'failed'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY failure_reason;
"

# 5. Duplicatas Sofia (SC-005)
psql $DATABASE_URL -c "
SELECT provider_id, asaas_payment_id, event_type, COUNT(*) as dups
FROM payment_events
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1;
"
# Esperado: 0 rows
```

---

## Pontos de atenção

1. **Cliente teste apenas inicial**: Bruno/Sofia ativos só para Vertical Fibra (provider do owner) na primeira semana. Outros providers ficam com toggle OFF por default da Spec 003 backfill.

2. **Templates HSM Meta**: sem templates aprovados (`templateBrunoNome=null`), Bruno usa nome default `lembrete_prevencimento_v1` que pode não existir no Meta → `sendTemplate` falha → outbound retry pega → após 2 falhas → `needs_human_review`. Estado controlado, sem prejuízo, mas mensagens não saem. Por isso T062 (submissão HSM) é pré-requisito real de produção.

3. **Asaas sandbox vs produção**: sandbox para o smoke test, produção depois. Mudar a chave no painel `/configuracoes/asaas` faz upsert e o sistema detecta automaticamente pelo prefixo (`$aact_test_` vs `$aact_`).

4. **Backup audit_logs**: tabela imutável (triggers Postgres bloqueiam UPDATE/DELETE). Mas o backup completo do banco inclui audit_logs — garantir que `pg_dump` está agendado.
