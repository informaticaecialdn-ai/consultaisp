# Spec 015 — Voice Agent (Helena no Telefone)

**Status:** Proposta — validação técnica FEITA + custo precisa confirmação prática
**Esforço:** 4-5 semanas (20-25 dias úteis)
**Risco execução:** Alto (latência, qualidade PT-BR, custo)
**Dependências:** Validar % real clientes 50+ Vertical Fibra + Prompts v2 Helena via CoWork

---

## 1. Contexto

**Disrupção operacional:** 30-40% dos clientes ISP têm 50+ anos. Esses clientes:
- Recebem WhatsApp mas demoram horas para abrir
- Não confiam em links de pagamento
- Preferem voz humana
- São ignorados pela maioria dos sistemas IA atuais

**Pivô:** Voice Agent — Helena liga ao cliente, conversa naturalmente em PT-BR, resolve cobrança/dúvida/agendamento.

**Diferencial vs URA tradicional:**
- Conversação natural, não menus
- Memória persistente (lembra última conversa)
- Latência <2s (similar humano)
- Integração com mesmas tools que Helena WhatsApp já tem

**Disponibilidade 24/7** — voice agent funciona à noite quando call center humano não.

---

## 2. Validação técnica (FEITA 2026-05-12)

### Veredito: NÃO existe API Realtime nativa Anthropic — usar stitching

**FATO confirmado:**

1. **Anthropic NÃO tem voice-to-voice API** equivalente ao OpenAI Realtime. Documentação oficial não menciona endpoint `/v1/audio/stream` ou similar
2. **Claude Voice** existe mas é "emerging" — sem SDK estável, sem API pública, sem pricing
3. **Recomendação Anthropic (parceria oficial):** Hume AI (Empathic Voice Interface) — STT + emoção + texto via Claude API → Hume vocaliza
4. **Padrão da indústria:** stitching com Twilio ConversationRelay

### Arquitetura escolhida — Stitching

```
Cliente liga / sistema disca via Twilio
        ↓
Twilio ConversationRelay (WebSocket bidirectional audio)
        ↓
Servidor Provedor.AI orquestra:
  Audio → Deepgram STT (streaming, PT-BR)
        ↓
  Texto transcrito → Claude Sonnet 4.6 (tool-use loop, mesmo prompt v2 Helena adaptado)
        ↓
  Resposta texto → ElevenLabs TTS (voz natural PT-BR)
        ↓
  Audio gerado → De volta ao Twilio → Cliente ouve
```

**Latência alvo:** <2s end-to-end (300-400ms STT + 600-1000ms Claude + 200-400ms TTS + ~200ms network)

### Custo estimado (Vertical Fibra, 60 chamadas/dia × 5 min)

| Componente | Custo /min | Custo /dia (300min) | Custo /mês |
|---|---|---|---|
| Twilio Voice (Brasil) | $0.013 | $3.90 | $117 |
| Deepgram STT | $0.0042 | $1.26 | $38 |
| Claude Sonnet 4.6 (8k tokens/call avg) | ~$0.045/call | $2.70 | $81 |
| ElevenLabs TTS (~10k chars/call) | ~$0.10/call | $6.00 | $180 |
| **TOTAL** | ~$0.05/min | ~$14/dia | **~R$ 2.100/mês** |

*Cotações em USD convertidas BRL @ 5.0. **Estimativas, validar em uso real.***

**Comparação com operador humano:**
- Operador R$ 25/h = R$ 0,42/min → voice agent ~R$ 0,17/min (40% do custo)
- Mas operador humano tem ociosidade (não está em call 100% do tempo)
- Custo real efetivo operador: ~R$ 1,00/min em call
- Voice agent: 17% do custo humano efetivo

**ROI defensável** se >100 minutos/dia de call (Vertical Fibra com 2000+ clientes provavelmente atinge).

---

## 3. Validações OBRIGATÓRIAS antes de implementar

1. **% real clientes 50+ Vertical Fibra**: define ROI. Se <20%, escopo questionável.
2. **Teste prático de qualidade PT-BR**: 5 chamadas em sandbox com Deepgram + ElevenLabs. Validar pronúncia, naturalidade, compreensão de sotaque caboclo/regional.
3. **Custo real** vs estimado em primeiro mês de uso (track fino).
4. **Aceitação cultural**: 50+ aceita robô falando? Pode haver rejeição cultural. Teste com 10 clientes piloto primeiro.

---

## 4. User stories

**US-1 — Helena liga para cliente 65+ que não respondeu WhatsApp**
Cliente João (68 anos, A3) tem fatura em atraso D+3 e não respondeu Bruno via WhatsApp. Marcos detecta padrão (cliente 50+ + não responde digital) → dispara Helena Voice.

Helena liga: "Olá Seu João, aqui é Helena do [provedor]. Como o senhor está? Estou ligando porque sua fatura de R$ 89,90 venceu na segunda. Posso te ajudar a resolver agora?"

João responde por voz. Helena conduz: confirma valor, oferece Pix, gera link via SMS, despede cordialmente.

**US-2 — Cliente liga sem agendamento, voice agent atende 24/7**
Cliente liga 22h querendo 2ª via. Voice agent (sem humano disponível) responde, identifica via cpf, gera 2ª via, envia link SMS, registra interação.

**US-3 — Voice agent escala humano quando complexo**
Cliente irritado, sentiment <-0.5, ou pede explicitamente "quero falar com humano". Voice agent transfere para fila humana com summary do contexto.

---

## 5. Schema impact (AUTORIZAR)

### Tabela nova: `voice_calls`

```typescript
export const voiceCalls = pgTable("voice_calls", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").references(() => customers.id),

  // Twilio
  twilioCallSid: text("twilio_call_sid").notNull().unique(),
  direction: text("direction").notNull(),  // 'inbound' | 'outbound'
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),

  // Estado
  status: text("status").notNull(),
  // 'queued' | 'ringing' | 'in_progress' | 'completed' | 'failed' | 'no_answer' | 'busy' | 'cancelled'

  startedAt: timestamp("started_at"),
  answeredAt: timestamp("answered_at"),
  endedAt: timestamp("ended_at"),
  durationSeconds: integer("duration_seconds"),

  // Custos
  twilioCostCents: integer("twilio_cost_cents"),
  sttCostCents: integer("stt_cost_cents"),
  llmCostCents: integer("llm_cost_cents"),
  ttsCostCents: integer("tts_cost_cents"),
  totalCostCents: integer("total_cost_cents"),

  // Conversa
  transcriptFullText: text("transcript_full_text"),  // texto bruto transcrito
  transcriptStructured: jsonb("transcript_structured"),  // [{ speaker, text, timestamp }]
  finalSentimentScore: decimal("final_sentiment_score", { precision: 3, scale: 2 }),

  // Outcome
  intentDetected: text("intent_detected"),
  outcomeOutcome: text("outcome_outcome"),  // 'resolved' | 'escalated_human' | 'transferred' | 'no_resolution'
  toolsCalled: jsonb("tools_called"),
  outboundCommunicationId: integer("outbound_communication_id"),

  // Compliance
  recordingUrl: text("recording_url"),  // armazenamento S3 cifrado
  recordingConsent: boolean("recording_consent"),  // cliente consentiu gravação
  juliaComplianceCheckIds: jsonb("julia_compliance_check_ids"),  // array de IDs

  agentId: text("agent_id"),  // 'helena_voice_v1'

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  providerIdx: index("vc_provider_idx").on(t.providerId),
  customerIdx: index("vc_customer_idx").on(t.customerId),
  statusIdx: index("vc_status_idx").on(t.status),
}));
```

### Modificações em existentes

- `communications`: adicionar `voiceCallId` opcional para vincular WhatsApp/SMS gerados a partir de voice call
- `audit_logs`: voice calls geram entries com `actorType='voice_agent'`

---

## 6. Arquitetura técnica detalhada

### Componentes

```
server/services/voice-agent/
├── twilio-relay.ts        ← orquestrador principal
├── deepgram-stt.ts        ← STT streaming
├── elevenlabs-tts.ts      ← TTS streaming
├── voice-orchestrator.ts  ← gerencia conversation state
├── compliance-gate.ts     ← Júlia checa cada output antes de TTS
└── escalation.ts          ← transferência para humano
```

### Fluxo de uma chamada

1. **Inbound call** chega no Twilio number do tenant
2. Twilio webhook → `POST /api/voice/twilio-incoming` → backend responde com TwiML `<Connect><ConversationRelay>`
3. ConversationRelay abre WebSocket bidirectional para o backend
4. **Audio frames** chegam → `deepgram-stt.ts` transcreve streaming
5. Quando frase completa: `voice-orchestrator.ts` envia texto para Claude com prompt Helena Voice + memory + tools
6. Claude responde texto (potencialmente com tool_use loop interno)
7. **Antes de TTS:** Júlia compliance gate valida conteúdo (síncrono, <500ms)
8. Se aprovado: `elevenlabs-tts.ts` gera audio streaming
9. Audio frames volta via WebSocket → Twilio → cliente ouve
10. Loop 4-9 até cliente desligar ou voice agent transferir

### Memory e contexto

- Voice agent usa MESMA memória persistente (`agent_memories`) que Helena WhatsApp
- Cliente que conversou com Helena via WhatsApp ontem, ao ligar hoje, Helena Voice "lembra"
- Tools idênticas (consultar fatura, gerar Pix, etc.) — interface compartilhada

### Limites

- Max 8 turnos (entrada cliente) por sessão antes de escalar humano
- Max 10 minutos duração total
- Se sentiment <-0.5 em 3 turnos consecutivos: escala humano
- Se cliente pede "humano" explicitamente: transfere imediato

---

## 7. Prompt Helena Voice (v2 adaptado do CoWork)

Mesma persona Helena, adaptações específicas para voz:

```
Você é Helena, atendente do [provedor]. ATENDE POR VOZ — telefone.

DIFERENÇAS vs WhatsApp:
- Respostas mais curtas (cliente ouve, não lê — 2-3 frases max)
- Tom mais cálido, menos formal
- Confirme entendimento ("certo?", "tá bom?")
- Não fale em ✓, 📞, 📲 — você está falando, não escrevendo
- Lembre que cliente pode ter dificuldade auditiva — fale claro
- Cliente 50+ é maioria — evite jargão técnico, vocabulário simples

ESCALAÇÃO HUMANA IMEDIATA SE:
- Cliente pede explicitamente
- Cliente irritado (3+ frases hostis seguidas)
- Cliente alega Procon ou ameaça processo
- Conversa passa de 10 minutos sem resolução

TOOLS disponíveis (mesmas do Helena WhatsApp):
- consultar_fatura, gerar_pix, gerar_segunda_via
- consultar_pagamento, registrar_promessa
- enviar_link_sms (após chamada, envia link para Pix)
- handoff_humano

COMPLIANCE (Júlia revisa cada resposta):
- Sem ameaça, sem constrangimento
- Sem revelação de dívida a terceiros (ex: filho atende telefone do pai)
- Verificar identidade ANTES de discutir valores (cliente confirma CPF antes)
```

---

## 8. Plano de execução — 5 batches

### Batch 1 — Setup Twilio + WebSocket relay (4-5 dias)
- Provisionar número Twilio Brasil (validar custo + verificação de identidade exigida pela Anatel)
- Implementar `POST /api/voice/twilio-incoming` com TwiML
- WebSocket handler para ConversationRelay
- Tests: chamada inbound chega no servidor

### Batch 2 — STT + TTS streaming (4-5 dias)
- Integração Deepgram (account + API key + PT-BR model selection)
- Integração ElevenLabs (voz PT-BR escolhida + voice clone se quiser)
- Streaming bidirectional audio
- Tests: chamada → fala detectada → fala sintetizada de volta

### Batch 3 — Orquestrador + Claude integration (5-6 dias)
- voice-orchestrator.ts gerencia state da conversa
- Integração com sistema de tools existente (mesmas tools Helena WhatsApp)
- Memory persistente (`agent_memories`)
- Limite 8 turnos + escalação

### Batch 4 — Júlia compliance gate síncrono (2-3 dias)
- Validation de cada output antes de TTS
- Latência target <500ms (não pode segurar a chamada)
- Audit log de cada gate (approved/blocked)

### Batch 5 — UI + outcome tracking (3-4 dias)
- Página /voice-calls com histórico
- Player de audio (gravação se consentida)
- Transcript visualizado
- Dashboard custos + outcomes

---

## 9. KPIs após 30 dias produção (pré-rollout)

**Métrica primária — resolution rate:**
- % de chamadas que resolveram sem escalar humano
- Alvo: ≥60% (vs benchmark URA tradicional ~30%)

**Métrica secundária — qualidade conversacional:**
- CSAT pós-chamada (SMS 1 dia depois): "De 1 a 5, como foi sua experiência?"
- Alvo: ≥4.0 (média)

**Métrica de saúde:**
- Taxa de "cliente desligou irritado nos primeiros 30 segundos": <5%
- Taxa de reclamação Procon por "atendimento robô": 0

**Métrica de custo:**
- Custo médio por chamada vs estimativa
- Alvo: ≤R$ 2.50/chamada (mantém ROI vs humano)

**Métrica de cobertura:**
- % de clientes 50+ que aceitaram receber ligação voice (vs preferência WhatsApp)
- Alvo: ≥40%

---

## 10. Out of scope MVP

- Multi-idioma (apenas PT-BR)
- Voice biometry (autenticação por voz)
- Análise emocional avançada via tom de voz (Hume AI — futuro)
- Outbound em massa (call campaign) — só calls disparados por Marcos contextualmente
- Integração com PABX existente do tenant (só Twilio cloud no MVP)

---

## 11. Riscos críticos

| Risco | Mitigação |
|---|---|
| Cliente 50+ rejeita robô falando | Piloto com 10 clientes voluntários ANTES de rollout. Se rejeição >50%, voltar para parking lot |
| Latência percebida >3s causa awkward silence | Adicionar "uhms"/"deixa eu ver" gerados localmente enquanto Claude processa |
| ElevenLabs PT-BR ruim em sotaque regional | Testar com 3 vozes diferentes em chamadas piloto. Considerar Azure TTS como alternativa |
| Anatel exige consentimento para gravação | Mensagem de abertura: "Esta chamada será gravada para qualidade. Se não concorda, posso transferir para atendente humano." |
| Custo real explode (ElevenLabs cobra por caractere, pode subir) | Hard limit por tenant + monitoring + alerta em 80% budget |
| Compliance gate Júlia adiciona latência crítica | Pre-compute templates de respostas comuns + cache de gate decisions para mesmas frases |
| Cliente alega "fui enganado, achei ser humano" | Política: voice agent SEMPRE se identifica como assistente digital na primeira fala da chamada |

---

## 12. Decisões éticas e legais

**Transparência obrigatória:**
- Voice agent SEMPRE se identifica como assistente digital na abertura
- Cliente pode pedir transferência para humano a qualquer momento
- Gravação só com consentimento explícito (avisa, espera "sim")

**Anatel:**
- Outbound em horário comercial 08-22h (Júlia gate)
- Sem cobrança via voz fora horário
- Identificação clara do provedor

**LGPD:**
- Gravações cifradas + retention 90 dias default
- Cliente pode pedir cópia ou deleção via direito de acesso
- Audit log de quem ouviu cada gravação (operadores autorizados)

---

## 13. Próximos passos

1. **Validar % real clientes 50+ Vertical Fibra** com owner (bloqueante)
2. **Teste prático qualidade PT-BR**: 1 dia setup mini-POC (Twilio + Deepgram + ElevenLabs) e gravar 5 conversas de teste
3. **Confirmar custo real** vs estimativa em mini-POC
4. **Decisão Go/No-Go** baseado em validações 1-3
5. Se Go: iniciar Batch 1
