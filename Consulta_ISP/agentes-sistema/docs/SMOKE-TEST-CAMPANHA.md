# Smoke Test — Broadcast Engine (Sprint 5)

Este procedimento valida fim-a-fim o Broadcast Engine antes de qualquer campanha real.

## Pre-requisitos

- Sistema deployado com Sprint 5 aplicado (migrations `009`, `010`, `011` aplicadas)
- Container `consulta-isp-worker` up e healthy (`docker compose ps`)
- Z-API instance conectada (`GET /api/health` retorna 200)
- 5 a 10 telefones DE TESTE internos (equipe, socio, linha backup)
- Variaveis de ambiente no `.env`:
  ```
  BROADCAST_WORKER_ENABLED=true
  BROADCAST_RATE_PER_MIN=20
  BROADCAST_JITTER_MIN_SEC=3
  BROADCAST_JITTER_MAX_SEC=8
  BROADCAST_MAX_RETRIES=3
  BROADCAST_RETRY_DELAYS_SEC=30,120,600
  BROADCAST_FAILURE_THRESHOLD_PCT=20
  BROADCAST_BATCH_SIZE=10
  ```

## Procedimento

### 1. Setup automatico via endpoint smoke-test

```bash
curl -X POST http://<HOST>/api/campanhas/smoke-test \
  -H "Content-Type: application/json" \
  -d '{
    "telefones": ["5511999990001","5511999990002","5511999990003","5511999990004","5511999990005"],
    "agente_remetente": "carlos"
  }'
```

Retorna `{ campanha_id, audiencia_id, template_id, lead_ids }`. Campanha fica em **rascunho**.

### 2. Dispara a campanha

Via UI:
- Abra `/` no browser → **Campanhas** no menu lateral
- Encontre "Smoke Test ..." → clique **🚀 Disparar**

Via curl:
```bash
curl -X POST http://<HOST>/api/campanhas/<ID>/start
```

### 3. Cronometrar primeira mensagem

- **Alvo**: primeira mensagem em menos de 60s
- **Intervalo entre mensagens**: 6-11s (rate 5/min + jitter 3-5s)
- Observar no WhatsApp do telefone 1 → chega "Ola Smoke Test 1! Teste interno..."

### 4. Validar metricas no dashboard

A pagina Campanhas faz polling a cada 5s. Ao final:
- `Enviados`: 5
- `Entregues`: 5 (apos Z-API callback)
- `Lidos`: depende se abriu
- `Falhas`: 0

### 5. Testar kill switch

Durante uma nova execucao de smoke test:
1. Iniciar campanha
2. Apos 1 envio confirmado, clicar ⛔ **Kill Switch** no topo da pagina Campanhas
3. Digitar `CONFIRMAR` e ativar
4. Cronometrar: worker deve parar em ≤ 30s
5. Validar: nenhuma mensagem extra chega
6. Retomar via botao ▶ Retomar broadcast + `docker compose restart worker`

### 6. Testar webhook de delivery

- Aguardar 30s apos envio
- Checar `GET /api/campanhas/<ID>/stats`
- `entregues` deve ser >= `enviados`
- Se lead abrir a mensagem, `lidos` incrementa

### 7. Testar opt-out mid-flight

1. Iniciar campanha com 10 leads
2. De um dos telefones, responder **STOP** imediatamente
3. Confirmar em `GET /api/campanhas/<ID>/envios?status=bloqueado_optout` que o envio foi bloqueado
4. `GET /api/consent/<telefone>` retorna `{ allowed: false, reason: ... }`

### 8. Testar auto-pause

Para simular sem bans reais:
1. Configurar `BROADCAST_RETRY_DELAYS_SEC=` (vazio) para falhas permanentes irem direto
2. Apontar `ZAPI_TOKEN` para valor invalido por 1min
3. Disparar campanha de 15 leads
4. Apos >10 tentativas processadas, se taxa_falha > 20%, campanha muda para `pausada` automaticamente
5. Webhook `ERROR_REPORT_WEBHOOK` recebe notificacao (se configurado)
6. Restaurar token e retomar via UI

## Criterios de aprovacao

- [ ] 100% das 5 mensagens chegam nos telefones
- [ ] Metricas no dashboard refletem realidade exata
- [ ] Kill switch para worker em ≤ 30s
- [ ] Opt-out mid-flight bloqueia envio correto
- [ ] Delivery webhook atualiza `entregue_em`/`lido_em`
- [ ] Auto-pause dispara em cenario controlado

## Proximo passo apos aprovacao

Marcar ✅ no `ROADMAP.md`:

> Sistema pronto para campanha real (Sprint 6).

## Debug rapido

```bash
# Status do worker
curl http://<HOST>:9091/health   # de dentro da rede docker
curl http://<HOST>/api/admin/broadcast-status

# Health deep
curl http://<HOST>/api/health/deep

# Envios pendentes
curl http://<HOST>/api/campanhas/<ID>/envios?status=pendente

# Force pause all
curl -X PUT http://<HOST>/api/campanhas/pause-all

# Kill switch (emergencia)
curl -X POST -H "X-Admin-Confirm: yes" http://<HOST>/api/admin/kill-broadcast
docker compose restart worker
```

## Rollback

```bash
# Desativar feature inteira
echo "BROADCAST_WORKER_ENABLED=false" >> .env
docker compose restart worker

# Remover worker completamente (emergencia maior)
docker compose stop worker
docker compose rm -f worker
```
