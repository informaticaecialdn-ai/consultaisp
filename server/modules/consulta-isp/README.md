# server/modules/consulta-isp/

**Módulo Consulta ISP — Rede Colaborativa de Risco.**

Sub-módulo dentro do Provedor.ai que agrupa as features herdadas do Consulta
ISP original: rede colaborativa de eventos de inadimplência, anti-fraude
pré-instalação, mapa de calor, importação CSV, créditos.

## Status

⚠️ **Em transição.** As features atuais ainda estão espalhadas em
`server/routes/`, `server/services/`, etc. (estrutura herdada). A
migração para esta pasta acontece de forma incremental — não bloqueia o
trabalho de novos módulos.

## Features que serão consolidadas aqui (roadmap)

- `score-network.ts` — score externo cross-tenant (CPF hashado, anonimizado)
- `event-registry.ts` — registrar eventos `inadimplencia_confirmada`,
  `nao_devolveu_equipamento`, `pagou_apos_negativacao`, `cliente_recuperado`
- `anti-fraud.ts` — pré-instalação: detecta calote-de-instalação via
  histórico de provedores
- `heatmap-cache.ts` — atual em `server/services/heatmap-cache.ts`,
  move para cá quando refatorar
- `csv-import.ts` — importação de clientes/faturas/equipamentos via CSV
  (mantida como fallback para provedores sem ERP integrável)
- `credits.ts` — compra de créditos ISP/SPC (atual em `server/routes/`)

## Como módulos novos do Provedor.ai consomem

Os agentes (Marcos, Helena, Daniel) consultam este módulo internamente:
- `consultaIsp.consultarScore(documentHash)` — score 0-999
- `consultaIsp.consultarHistoricoProvedores(documentHash)` — número de
  provedores anteriores, eventos
- `consultaIsp.registrarEvento(documentHash, tipo, payload)` — Daniel/Lucas
  alimentam a rede com eventos de cobrança

**Sem chamada HTTP externa.** É código local dentro do mesmo monorepo,
consultando o mesmo banco. RLS/multi-tenant: tabelas próprias do módulo
NÃO têm `provider_id` (são dados cross-tenant anonimizados via hash).
