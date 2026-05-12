# Spec 012.0 — Estender ErpConnector com Status Técnico

**Status:** Proposta — pré-requisito de Specs 012 (Recup Proativa) e 013 (Detector Saída Silenciosa)
**Esforço:** 2-3 semanas (10-15 dias úteis)
**Risco execução:** Médio (depende de doc não-pública de alguns ERPs)
**Dependências:** Nenhuma (independente do Customer Health 360º)

---

## 1. Contexto

**FATO descoberto em 2026-05-12:** A interface `ErpConnector` atual em [server/erp/types.ts:141](server/erp/types.ts#L141) tem apenas 5 métodos read-only de cliente/fatura. **Não expõe:**
- Status RADIUS / ONU online/offline em tempo real
- Sinal óptico (Rx/Tx em dBm)
- Consumo de banda (download/upload)
- Última atividade na rede

Specs 012 (Recuperação Proativa Equipamento) e 013 (Detector Saída Silenciosa) **dependem fundamentalmente** desses sinais. Sem essa extensão, ambas operam cegas.

Esta spec estende a interface + implementa em IXC + MK (60% market share ISP). Demais ERPs (SGP, Hubsoft, Voalle, RBX) implementam sob demanda.

---

## 2. Validações técnicas (FEITAS 2026-05-12)

### IXC Soft — VIÁVEL

- ✅ `radusuarios.online` (S/N) — proxy confiável para ONU ativa em PPPoE
- ✅ `radusuarios.ultima_conexao_final` — campo `lastSeen`
- ✅ `radusuarios.download_atual` + `upload_atual` — bytes consumidos
- ⚠️ Sinal óptico Rx/Tx: tabela `cliente_fibra_onu` (nome inferido — pode ser `fibra_onu` ou `monitora_potencia_onu`). Best-effort com discovery em runtime
- ✅ Auth idêntica à atual (Basic Auth + header `ixcsoft: listar`)
- ✅ Sem rate limit oficial (paginação `page` + `rp` já implementada)

**Cobertura esperada:** 100% das instâncias IXC com PPPoE. Sinal óptico depende de "Monitoramento de Potência de ONUs" estar habilitado no tenant.

### MK Solutions — LIMITADO

- ⚠️ Nenhum endpoint REST oficial para sessão RADIUS, sinal óptico ou banda consumida
- ⚠️ Proxy degradado disponível via `WSMKConexoesPorCliente.Bloqueada` (apenas binário: bloqueado financeiramente sim/não)
- ❌ Banda real e accounting RADIUS vivem em tabela `radacct` do Postgres do MK-Auth — exige SSH/DB direto, foge do contrato `ErpConnector`
- ❌ Sinal óptico ONU coletado via SNMP direto na OLT, não via API MK

**Cobertura esperada:** MK só consegue oferecer `online` heurístico (não-bloqueado) + null para outros campos. Para sinal/banda reais, tenant MK precisa adicional não-MK (Zabbix, HelpFiber, etc.) — out of scope.

### SGP, Hubsoft, Voalle, RBX — NÃO INVESTIGADOS

Validar caso a caso quando demanda surgir. MVP cobre apenas IXC + MK.

---

## 3. User stories

**US-1 — Marcos consulta status técnico antes de cobrar**
Marcos, ao avaliar enviar Bruno D+1, consulta `getOnuStatus(customerId)`. Se cliente offline > 5 dias E `lastBandwidthMbAvg < 10`, dispara Lucas (Spec 012) ao invés de Bruno (suspeita de cliente "sumindo").

**US-2 — Detector saída silenciosa lê banda em tempo real**
Spec 013 lê `getCustomerActivity(customerId, sinceDays=14)`. Se `bandwidthMbAvg` caiu >40% vs baseline 90d, adiciona sinal ao score de risco de churn.

**US-3 — Operador vê painel técnico do cliente**
Em `/clientes/[id]`, tab "Técnico" mostra: online sim/não, último online em X dias, sinal Rx atual (se disponível), consumo médio 30d.

**US-4 — Cron de health refresh consulta tecnical status**
Spec 010A Fase B+ consulta dados técnicos para enriquecer healthScore com sinais comportamentais.

---

## 4. Interface estendida

### `server/erp/types.ts` — adicionar 2 métodos opcionais

```typescript
export interface OnuStatus {
  online: boolean;
  lastSeen?: Date;
  signalRxDbm?: number;
  signalTxDbm?: number;
  source: 'radius' | 'olt' | 'inferred_bloqueado' | 'unavailable';
}

export interface CustomerActivity {
  bandwidthMbAvg?: number;       // média diária em MB no período
  bandwidthDownloadMbTotal?: number;
  bandwidthUploadMbTotal?: number;
  lastActivityAt?: Date;
  source: 'radius' | 'olt' | 'unavailable';
}

export interface ErpConnector {
  // ... métodos existentes ...

  /** Status atual da ONU/conexão. Opcional — nem todo ERP expõe. */
  getOnuStatus?(config: ErpConnectionConfig, customerErpId: string): Promise<OnuStatus>;

  /** Atividade do cliente nos últimos N dias. Opcional. */
  getCustomerActivity?(
    config: ErpConnectionConfig,
    customerErpId: string,
    sinceDays: number
  ): Promise<CustomerActivity>;

  /** Indica se o connector suporta essas extensões. */
  readonly capabilities: {
    onuStatus: 'full' | 'degraded' | 'unavailable';
    customerActivity: 'full' | 'degraded' | 'unavailable';
  };
}
```

### Impacto em código existente

Métodos são **opcionais**. Adapters atuais continuam funcionando sem mudança. Adapters que implementarem expõem `capabilities` para que o orquestrador (Marcos) saiba o que esperar.

---

## 5. Implementação IXC (FULL capability)

### Arquivo: [server/erp/connectors/ixc.ts](server/erp/connectors/ixc.ts) — estender

```typescript
async getOnuStatus(config: ErpConnectionConfig, customerErpId: string): Promise<OnuStatus> {
  // 1. Buscar RADIUS user
  const radius = await this.listAll(config, "radusuarios", {
    qtype: "radusuarios.id_cliente",
    query: customerErpId,
    oper: "=",
  }, 10, 1);

  const r = radius[0];
  const online = r?.online === "S";
  const lastSeen = r?.ultima_conexao_final
    ? this.parseIxcDate(r.ultima_conexao_final)
    : undefined;

  // 2. Tentar sinal óptico — best-effort
  let signalRxDbm: number | undefined;
  let signalTxDbm: number | undefined;
  let opticalSource: OnuStatus["source"] = "radius";

  for (const table of ["cliente_fibra_onu", "fibra_onu", "monitora_potencia_onu"]) {
    try {
      const onuRows = await this.listAll(config, table, {
        qtype: `${table}.id_cliente`,
        query: customerErpId,
        oper: "=",
      }, 5, 1);
      const o = onuRows[0];
      if (!o) continue;

      const rx = parseFloat(o.sinal_rx ?? o.potencia_rx ?? o.rx_power ?? "");
      const tx = parseFloat(o.sinal_tx ?? o.potencia_tx ?? o.tx_power ?? "");
      if (Number.isFinite(rx)) signalRxDbm = rx;
      if (Number.isFinite(tx)) signalTxDbm = tx;
      opticalSource = "olt";
      break;
    } catch { /* tabela pode não existir nessa instância */ }
  }

  return {
    online,
    lastSeen,
    signalRxDbm,
    signalTxDbm,
    source: signalRxDbm !== undefined ? opticalSource : "radius",
  };
}

async getCustomerActivity(
  config: ErpConnectionConfig,
  customerErpId: string,
  sinceDays: number
): Promise<CustomerActivity> {
  const radius = await this.listAll(config, "radusuarios", {
    qtype: "radusuarios.id_cliente",
    query: customerErpId,
    oper: "=",
  }, 10, 1);

  const r = radius[0];
  if (!r) return { source: "unavailable" };

  const downBytes = parseFloat(r.download_atual ?? "0");
  const upBytes = parseFloat(r.upload_atual ?? "0");
  const totalMb = (downBytes + upBytes) / 1_000_000;

  return {
    bandwidthMbAvg: totalMb / Math.max(1, sinceDays),
    bandwidthDownloadMbTotal: downBytes / 1_000_000,
    bandwidthUploadMbTotal: upBytes / 1_000_000,
    lastActivityAt: r.ultima_conexao_final
      ? this.parseIxcDate(r.ultima_conexao_final)
      : undefined,
    source: "radius",
  };
}

readonly capabilities = {
  onuStatus: 'full' as const,
  customerActivity: 'full' as const,
};
```

### Discovery de field names em runtime

Padrão já estabelecido no connector IXC (linhas 808-842 com `comodatos/patrimonio/fibra_onu`). Loga `Object.keys(rows[0])` na primeira chamada por instância para confirmar nomes reais. Cache em memória do tenant.

---

## 6. Implementação MK (DEGRADED capability)

### Arquivo: [server/erp/connectors/mk.ts](server/erp/connectors/mk.ts) — estender

```typescript
async getOnuStatus(config: ErpConnectionConfig, customerErpId: string): Promise<OnuStatus> {
  // MK não expõe RADIUS via API REST. Proxy via WSMKConexoesPorCliente.Bloqueada
  const conexoes = await this.callMkApi(config, "/mk/WSMKConexoesPorCliente.rule", {
    cd_cliente: customerErpId,
  });

  const c = conexoes?.Conexoes?.[0];
  const bloqueada = c?.Bloqueada === "S";

  return {
    online: !bloqueada,  // heurística degradada
    lastSeen: undefined,
    signalRxDbm: undefined,
    signalTxDbm: undefined,
    source: "inferred_bloqueado",
  };
}

async getCustomerActivity(
  _config: ErpConnectionConfig,
  _customerErpId: string,
  _sinceDays: number
): Promise<CustomerActivity> {
  // MK não expõe banda via API REST oficial
  return { source: "unavailable" };
}

readonly capabilities = {
  onuStatus: 'degraded' as const,
  customerActivity: 'unavailable' as const,
};
```

### Implicação operacional

Spec 013 (Detector Saída Silenciosa) tem força reduzida para tenants MK — usa apenas sinais não-técnicos (UTM tracking, tickets, sentiment). Documentar isso no roadmap.

---

## 7. Plano de execução — 3 batches

### Batch 1 — Interface + tipos + IXC (5-7 dias)
- [ ] Estender `server/erp/types.ts` com `OnuStatus`, `CustomerActivity`, capabilities
- [ ] Implementar IXC `getOnuStatus` + `getCustomerActivity`
- [ ] Discovery em runtime para field names
- [ ] Cache em memória de schema descoberto (TTL 24h)
- [ ] Tests integração contra instância IXC mock

### Batch 2 — MK + outros connectors (2-3 dias)
- [ ] Implementar MK `getOnuStatus` (degraded) + `getCustomerActivity` (unavailable)
- [ ] Tests integração contra instância MK mock
- [ ] Demais conectores (SGP/Hubsoft/Voalle/RBX): stub com `capabilities.onuStatus='unavailable'`

### Batch 3 — Consumers + UI (3-5 dias)
- [ ] Spec 010A enriquecida com sinais técnicos (se capabilities='full')
- [ ] Tab "Técnico" em `/clientes/[id]` (somente para ERPs full/degraded)
- [ ] Card no dashboard "Clientes com sinal crítico" (Rx < -28 dBm)
- [ ] Cron interno opcional: snapshots de status técnico (não bloqueante)

---

## 8. Validações de aceitação

1. Adapter IXC retorna `OnuStatus` válido para cliente PPPoE ativo em instância de teste
2. Adapter IXC tenta 3 tabelas para sinal óptico, retorna `signalRxDbm` se disponível, `undefined` se não
3. Adapter MK retorna `online: !bloqueada` corretamente (proxy degradado)
4. Adapter MK retorna `{ source: "unavailable" }` para `getCustomerActivity`
5. Demais adapters (SGP/Hubsoft/etc.) retornam `capabilities.onuStatus='unavailable'` (sem erro)
6. Tab "Técnico" no UI renderiza diferentemente baseado em `capabilities`
7. Spec 010A consome esses dados graciosamente: se unavailable, healthScore não é prejudicado

---

## 9. KPIs

**Cobertura:**
- 100% dos clientes IXC com snapshot técnico válido
- 100% dos clientes MK com `online` heurístico (não-bloqueado)
- 0% dos demais ERPs (esperado neste MVP)

**Acurácia (validação manual em 50 clientes Vertical Fibra):**
- `online=true` vs realidade (operador confirma): ≥90%
- `lastSeen` dentro de tolerância de 1h: ≥95%
- `signalRxDbm` faixa plausível (-30 a -10 dBm): 100% (quando retornado)

**Performance:**
- `getOnuStatus` p95 <500ms
- `getCustomerActivity` p95 <500ms
- Sem impacto em rate limit ERP (validar headers IXC)

---

## 10. Out of scope

- SQL direto em `radacct` do Postgres MK (foge contrato `ErpConnector`)
- SNMP polling em OLTs (out of scope, depende de infra de cada tenant)
- Push real-time via webhooks dos ERPs (nenhum suporta atualmente)
- Histórico de sinal óptico (apenas valor atual)
- Suporte SGP/Hubsoft/Voalle/RBX no MVP (sob demanda)

---

## 11. Próximos passos

1. **Confirmar prioridade vs Spec 010A** — paralelizável, mas se houver crunch de recursos, 010A vem primeiro (depende de menos)
2. **Iniciar Batch 1** — extensão da interface + IXC implementation
3. Coordenar com Spec 010A para consumir esses dados na Fase B

Tempo estimado: 2-3 semanas após autorização.
