# Anti-Fraude por Endereco + Benchmark Regional — Design Spec

**Data:** 2026-04-09
**Status:** Aprovado

---

## 1. Anti-Fraude por Endereco

### Problema
Cliente cancela com divida, familiar/vizinho contrata no mesmo endereco com outro CPF. Provedor nao percebe porque o CPF e diferente.

### Solucao
Durante a Consulta ISP, cruzar o endereco do CPF consultado com a base de cancelados de TODA a rede (todos os provedores). Se houver match, alertar o provedor.

### Fluxo Tecnico

1. Consulta ISP chega com CPF (`POST /api/isp-consultations`)
2. Busca endereco do CPF no ERP (real-time, ja existe)
3. Com CEP + numero, busca na tabela `customers` de TODOS os provedores (`storage.getCustomersByCepPrefix()` + filtro por numero)
4. Filtra: apenas clientes com `paymentStatus = "overdue"` e CPF diferente do consultado
5. Se achar matches → inclui alerta de risco no resultado da consulta
6. Dados do outro provedor mascarados (LGPD)

### Dados do Alerta

```typescript
{
  type: "address_risk",
  message: "Este endereco tem X registros de inadimplencia na rede ISP",
  matches: [
    {
      cpfMasked: "***456-**",        // LGPD: so digitos do meio
      overdueRange: "R$ 500-1000",   // faixa, nao valor exato
      maxDaysOverdue: 120,
      status: "inativo",              // contrato cancelado
      providerAnonymized: "Provedor da regiao"  // sem identificar
    }
  ]
}
```

### Regras LGPD
- CPF mascarado: mostrar apenas 3 digitos do meio (`***456-**`)
- Valor em faixa: R$ 0-200, R$ 200-500, R$ 500-1000, R$ 1000-2000, R$ 2000+
- Provedor anonimizado: "Provedor da regiao" (nunca revelar nome)
- Nome do inadimplente: NUNCA mostrar

### Integracao no Frontend
- Novo card/secao no resultado da Consulta ISP
- Icone de alerta laranja/vermelho
- Titulo: "Alerta de Endereco"
- Aparece automaticamente quando tem match, sem custo de credito adicional

### Fonte de Dados
- Tabela `customers` local (populada pelo sync ERP diario as 03:00)
- Cruzamento por: CEP (5 primeiros digitos) + numero do endereco
- Busca cross-provider (todos os provedores da rede)

### Custo
- Zero creditos adicionais — usa dados ja sincronizados no banco local

---

## 2. Benchmark Regional

### Problema
Provedor nao sabe quais bairros/regioes tem mais inadimplencia, se a situacao ta melhorando ou piorando, e como se compara com outros provedores.

### 3 Secoes da Pagina

#### 2.1 Ranking de CEPs por Risco

**Componente:** Tabela ordenavel
**Fonte:** tabela `customers` agrupada por CEP (5 digitos)

| Coluna | Descricao |
|--------|-----------|
| CEP | 5 primeiros digitos (ex: 86040) |
| Bairro/Cidade | Nome via ViaCEP (cache) |
| Inadimplentes | Contagem de clientes com divida |
| Valor Total | Soma do totalOverdueAmount |
| Score Medio | Media do riskTier numerico |
| Nivel de Risco | Badge: Critico/Alto/Medio/Baixo |

**Filtros:** Por cidade, por nivel de risco
**Ordenacao:** Qualquer coluna (default: inadimplentes desc)
**Dados:** Todos os provedores da rede (anonimizado)

#### 2.2 Tendencia Regional

**Componente:** Grafico de linha (Recharts)
**Periodo:** Ultimos 6 meses
**Linhas:**
- Quantidade de inadimplentes na rede (eixo Y esquerdo)
- Valor total em aberto (eixo Y direito)
**Eixo X:** Meses (jan, fev, mar...)
**Fonte:** tabela `customers` agrupada por mes de `lastSyncAt` ou `createdAt`
**Indicador:** Seta verde (descendo) ou vermelha (subindo) com % de variacao

#### 2.3 Mapa de Risco por Bairro

**Componente:** MapLibre GL JS (ja instalado)
**Tiles:** Proxy OSM (`/api/tiles/`)
**Visualizacao:** Pontos/circulos coloridos por CEP
- Verde: baixo risco (0-2 inadimplentes)
- Amarelo: medio risco (3-5)
- Laranja: alto risco (6-10)
- Vermelho: critico (11+)
**Tamanho do circulo:** Proporcional ao numero de inadimplentes
**Tooltip ao clicar:** CEP, bairro, cidade, inadimplentes, valor total
**Fonte:** tabela `customers` agrupada por CEP com lat/lng medio

### Endpoints Necessarios

```
GET /api/benchmark/cep-ranking
  → { cep, city, neighborhood, count, totalOverdue, avgRisk }[]

GET /api/benchmark/trend
  → { month, count, totalOverdue }[]  (ultimos 6 meses)

GET /api/benchmark/map-points
  → { lat, lng, cep, city, count, totalOverdue, riskLevel }[]
```

### Fonte de Dados
- Tudo da tabela `customers` local
- Zero consultas ERP adicionais
- Dados de todos os provedores (anonimizado — sem identificar provedor)

---

## 3. Arquivos a Modificar

### Backend
- `server/routes/consultas.routes.ts` — adicionar cruzamento de endereco no POST /api/isp-consultations
- `server/storage/customers.storage.ts` — novo metodo `getCustomersByAddress(cep5, numero, excludeCpf)`
- `server/routes/benchmark.routes.ts` — NOVO: 3 endpoints de benchmark
- `server/routes/index.ts` — registrar novas rotas

### Frontend
- `client/src/pages/consulta/consulta-isp.tsx` — mostrar alerta de endereco no resultado
- `client/src/pages/provedor/benchmark-regional.tsx` — reescrever com 3 secoes
- `client/src/components/consulta/AddressRiskAlert.tsx` — NOVO: componente de alerta

### Sem Alterar
- `shared/schema.ts` — usa tabela `customers` existente
- `server/erp/connectors/ixc.ts` — sem mudancas
- `server/services/erp-sync.service.ts` — sem mudancas

---

## 4. Fora de Escopo

- SPC (aguardando token)
- Score composto ISP+SPC
- Deteccao de fraude por IA/ML
- Validacao facial/documental
- Workflow de retencao CRM
- Mapa de calor (removido do sistema)
