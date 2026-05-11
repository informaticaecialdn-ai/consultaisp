# Contract: invokeJulia() — Compliance Gate

**Type:** TS function (internal). Direct API call to Anthropic.
**File:** `server/agents/julia.ts`

## Signature

```typescript
export async function invokeJulia(input: JuliaInput): Promise<JuliaDecision> {
  // 1. Determinístico (sub-100ms): horário, frequência, opt-in
  // 2. Anatel timeline check
  // 3. LLM Haiku 4.5 com prompt caching para análise semântica
  // 4. Vulnerabilidade check
  // Latência alvo <500ms p95
}

interface JuliaInput {
  tenantId: number;                          // SEMPRE — multi-tenant
  customerId: number;
  agentId: string;                            // qual agente pediu (agt_reativo_v1)
  actionType: 'send_message' | 'suspender_parcial' | 'suspender_total' | 'cancelar';
  channel?: 'whatsapp' | 'sms' | 'email';
  content?: string;                           // se send_message
  scheduledAt?: string;                       // ISO 8601 (default: now)
  actionPayload?: Record<string, unknown>;
  correlationId?: string;
}

interface JuliaDecision {
  decision: 'APPROVED' | 'APPROVED_WITH_ADJUSTMENT' | 'BLOCKED';
  fundamentacaoLegal: string[];               // citações artigos
  ajustesSugeridos: string[];
  blockingReasons?: string[];
  validUntil: string;                         // ISO 8601 (5 min)
  camadasValidadas: {
    deterministica: boolean;
    anatel: boolean;
    semantica: boolean;
    vulnerabilidade: boolean;
  };
  latencyMs: number;
  cacheHit: boolean;
}
```

## Behavior

### Camada 1 (Determinística, <100ms)
- Janela horário Anatel: dia útil 08:00-22:00, sábado 09:00-13:00, domingo/feriado BLOQUEADO
- Frequência: máx N/dia/canal por cliente (config tenant)
- Opt-in: lookup `whatsapp_optouts(providerId, phoneNumber)` → match = BLOCKED permanente

### Camada 2 (Anatel timeline)
- Se actionType=suspender_parcial: validar notificação prévia há >=15d com `readAt` em alguma communication
- Se suspender_total: notificação prévia após parcial >=15d
- Se cancelar: D+60+ com notificação D+58

### Camada 3 (LLM Haiku 4.5 + prompt cache)
- System prompt contém referências LGPD/CDC/Anatel (cached)
- User content = `{content}`
- Detectar: ameaça, constrangimento, exposição, urgência falsa
- Output JSON validation

### Camada 4 (Vulnerabilidade)
- Buscar `agent_memories.facts` por flags: idoso, doença, desemprego, BPC
- Se sim + ação agressiva (suspender/cobrar) → BLOCKED + handoff humano

## Audit

Após cada chamada: insert em `compliance_checks` + `audit_logs(action='compliance_check', actorType='AGENT', actorId='agt_compliance_v1')`.

## Multi-Tenant

`tenantId` é parâmetro obrigatório. Toda query interna filtra por ele.
