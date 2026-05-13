# Cliente 360° — Spec consolidada Provedor.AI

> Visão única e completa do cliente final do ISP. Todo agente recebe um subset
> deste payload conforme suas permissões. Origem dos dados, frequência de
> atualização, e quem consome cada bloco estão documentados.

---

## Sumário

1. [Princípios de design](#1-princípios-de-design)
2. [Estrutura consolidada (JSON)](#2-estrutura-consolidada-json)
3. [Schema Prisma sugerido](#3-schema-prisma-sugerido)
4. [Blocos do cliente 360°](#4-blocos-do-cliente-360°)
5. [Quem consome cada bloco](#5-quem-consome-cada-bloco)
6. [Fontes de dados e atualização](#6-fontes-de-dados-e-atualização)
7. [Restrições de privacidade (LGPD)](#7-restrições-de-privacidade-lgpd)

---

## 1. Princípios de design

1. **Single source of truth por agente.** Cada agente recebe seu próprio payload curado pelo Score & Decisão (Marcos). Sem consultas N+1 ao ERP em tempo real.
2. **PII mascarado por default.** CPF aparece como `123.***.**-12`. Telefone como `+5511*****1234`. Apenas Júlia + Score & Decisão veem PII completo no contexto interno (nunca em log).
3. **Imutabilidade do audit log.** Todo registro em `audit_logs` é append-only, criptografado, retenção 6 anos. Defesa em Procon/Justiça/Anatel.
4. **Sincronização eventual.** Dados do ERP são replicados via webhook ou cron 15min. UI mostra `last_sync_at`. Discrepância > 30min = badge "stale".
5. **Régua DNA é cacheada.** Perfil recalculado diariamente (00:30). Mudança de perfil é evento (dispara alerta se A3→B3).
6. **Predições ML têm validade.** `predicted_payment_probability` tem TTL 24h. Após isso, expira e marca para recálculo.
7. **Flags são persistentes mas reversíveis.** `flag_vulneravel`, `flag_binding`, `flag_prescrita` ficam até humano explicitamente remover. Audit log de quem flaggou e quem removeu.
8. **Multi-tenant strict.** Todo registro tem `tenant_id`. RLS PostgreSQL impede cross-tenant queries.

---

## 2. Estrutura consolidada (JSON)

Esta é a forma como Marcos (Score & Decisão) monta o payload e entrega aos demais agentes:

```json
{
  "cliente_id": "uuid",
  "tenant_id": "uuid",
  "external_id_erp": "string",
  "last_sync_at": "ISO 8601",

  "identificacao": {
    "nome": "Maria Silva Souza",
    "cpf_cnpj_masked": "123.***.***-12",
    "cpf_cnpj_hash": "SHA256...",
    "data_nascimento": "1980-05-12",
    "idade_anos": 45,
    "genero": "feminino|masculino|nao_informado",
    "estado_civil": "string|null",
    "is_pessoa_juridica": false,
    "razao_social": null,
    "porte_empresa": null
  },

  "contato": {
    "telefones_e164": ["+5511999991234", "+5511988887777"],
    "telefones_validados": {"+5511999991234": "validado_2026-04-20"},
    "telefone_preferencial": "+5511999991234",
    "email": "maria@exemplo.com",
    "email_validado": true,
    "whatsapp_opted_in": true,
    "opt_outs": [
      { "canal": "voz", "registrado_em": "2026-03-15", "motivo": "cliente_pediu" }
    ]
  },

  "endereco": {
    "logradouro": "Rua das Flores",
    "numero": "123",
    "complemento": "Apto 45",
    "bairro": "Centro",
    "cidade": "Cambé",
    "uf": "PR",
    "cep": "86180-000",
    "lat": -23.27,
    "lng": -51.28,
    "pop_tecnico": "POP-3",
    "cto_tecnico": "CTO-12-A",
    "geocluster_ativo": false
  },

  "contrato": {
    "contrato_id": "uuid",
    "external_id_erp": "string",
    "status": "ativo|suspenso_parcial|suspenso_total|cancelado|negociacao|em_acordo",
    "data_cadastro": "2023-08-15",
    "data_ativacao": "2023-08-20",
    "data_cancelamento": null,
    "tempo_relacao_meses": 32,
    "dia_vencimento_mensal": 10,
    "forma_pagamento_preferida": "pix",
    "plano_atual": {
      "id": "plano_200mb",
      "nome": "Fibra 200Mbps",
      "velocidade_down_mbps": 200,
      "velocidade_up_mbps": 100,
      "preco_mensal_centavos": 9990,
      "ativado_em": "2024-06-01"
    },
    "historico_planos": [
      { "plano_id": "plano_100mb", "de": "2023-08", "ate": "2024-05" }
    ]
  },

  "equipamentos_comodato": [
    {
      "equipamento_id": "uuid",
      "tipo": "ONU",
      "marca": "ZTE",
      "modelo": "F660",
      "serial": "ZTE-XYZ-123",
      "mac_address": "AA:BB:CC:DD:EE:FF",
      "data_instalacao": "2023-08-20",
      "valor_aquisicao_centavos": 25000,
      "valor_reposicao_atual_centavos": 17500,
      "termo_comodato_assinado": true,
      "termo_id": "uuid",
      "status_pos_cancelamento": null
    }
  ],

  "financeiro": {
    "saldo_devedor_centavos": 17980,
    "faturas_em_aberto_count": 2,
    "fatura_mais_antiga_em_aberto": {
      "fatura_id": "uuid",
      "data_vencimento": "2026-04-10",
      "dias_atraso": 32,
      "valor_principal": 8990,
      "valor_atualizado_com_encargos": 9305
    },
    "ultimo_pagamento": {
      "data": "2026-03-08",
      "valor_centavos": 8990,
      "forma": "pix",
      "fatura_id": "uuid"
    },
    "historico_12m": {
      "pagamentos_em_dia": 9,
      "pagamentos_atrasados": 3,
      "media_dias_atraso": 4.2,
      "taxa_atraso": 0.25,
      "valor_total_pago_centavos": 107880
    },
    "acordos_ativos": [],
    "acordos_quebrados_count": 1,
    "preferencia_canal_pagamento": "pix"
  },

  "regua_dna": {
    "perfil_atual": "B3",
    "perfil_30d_atras": "A3",
    "alerta_queda_fiel": true,
    "policy_aplicada": {
      "tone": "extra_gentle",
      "max_discount_principal_pct": 25,
      "max_installments_default": 12,
      "retention_offer_enabled": true,
      "retention_offer_params": {
        "type": "downgrade_temp",
        "novo_plano": "plano_100mb",
        "preco_centavos": 6990,
        "duracao_meses": 3,
        "reverter_automatico": true
      },
      "primary_channel": "whatsapp",
      "fallback_channel": "voz",
      "human_intervention_required": true
    },
    "calculado_em": "2026-05-12T00:30:00Z",
    "factors": {
      "months_active": 32,
      "late_rate": 0.25,
      "avg_late_days": 4.2,
      "internal_score": 680,
      "isp_score": 720
    }
  },

  "predicoes_ml": {
    "predicted_payment_probability_proxima_fatura": 0.62,
    "predicted_churn_60d": 0.45,
    "predicted_procon_30d": 0.05,
    "predicted_ltv_proximos_24m_centavos": 215760,
    "predicted_devolucao_equipamento_se_cancelar": 0.30,
    "modelo_versao": "v1.2.3",
    "calculado_em": "2026-05-12T06:00:00Z",
    "valido_ate": "2026-05-13T06:00:00Z"
  },

  "scores_externos": {
    "consulta_isp_score": 720,
    "consulta_isp_eventos_negativos": 0,
    "consulta_isp_outros_provedores_inadimplencia": 0,
    "spc_status": "limpo|negativado|baixa_em_curso",
    "serasa_status": "limpo|negativado",
    "ultima_consulta_externa": "2026-04-30"
  },

  "comunicacao": {
    "memoria_persistente": {
      "facts": ["preferência horário noturno", "trabalha em home office"],
      "promises": [
        { "data": "2026-05-15", "valor_centavos": 8990, "registrado_em": "2026-05-10" }
      ],
      "topics_recentes": ["fatura abril", "lentidão noturna"],
      "sentiment_history_30d": [0.2, 0.1, -0.1, -0.3, 0.0],
      "sentiment_recente": -0.1,
      "recent_interactions_summary": "Cliente reclamou de lentidão no horário noturno duas vezes em abril. Reconheceu pagamento em atraso, prometeu pagar dia 15/05.",
      "total_interactions_ciclo_atual": 4,
      "last_interaction_at": "2026-05-10T19:30:00Z"
    },
    "ultima_interacao_por_canal": {
      "whatsapp": { "at": "2026-05-10T19:30:00Z", "direction": "inbound" },
      "sms": { "at": "2026-04-12T10:00:00Z", "direction": "outbound" },
      "email": null,
      "voz": null
    },
    "janela_24h_meta_status": {
      "ativa": true,
      "expira_em": "2026-05-11T19:30:00Z"
    },
    "categoria_meta_disponivel": ["UTILITY", "AUTHENTICATION", "SERVICE"]
  },

  "status_tecnico": {
    "link_ativo": true,
    "last_seen_at": "2026-05-12T08:30:00Z",
    "uptime_horas_30d": 718,
    "indisponibilidade_total_min_30d": 120,
    "sla_pago": 99.5,
    "sla_realizado": 99.8,
    "ultimo_incidente": {
      "tipo": "pop_downtime",
      "pop_id": "POP-3",
      "occurred_at": "2026-05-08T14:20:00Z",
      "duration_min": 90,
      "affected_customers": 87
    },
    "sinal_qualidade_onu": "good",
    "ultimo_ping_ms": 12,
    "chamados_tecnicos_abertos": []
  },

  "flags_compliance": {
    "flag_vulneravel": false,
    "flag_vulneravel_sinal": null,
    "flag_vulneravel_data": null,
    "flag_binding_procon": false,
    "flag_binding_data": null,
    "flag_super_endividado": false,
    "flag_menor_de_idade": false,
    "flag_prescrita_cc206": false,
    "flag_servico_essencial": false,
    "flag_servico_essencial_motivo": null,
    "flag_falecido": false,
    "alegou_pagamento_em": null,
    "pausa_sumula_548_ate": null
  },

  "regulatorio": {
    "anuencia_previa_negativacao": {
      "enviada_em": "2026-04-15",
      "data_minima_inclusao": "2026-04-29",
      "comprovacao": {
        "whatsapp_msg_id": "wamid.XXX",
        "lida_em": "2026-04-15T15:30:00Z",
        "email_id": "...",
        "sms_id": "..."
      }
    },
    "notificacoes_anatel_enviadas": [
      { "tipo": "pre_suspensao", "enviada_em": "2026-04-22", "comprovacao": {...} }
    ],
    "negativacoes_ativas": [
      {
        "bureau": "spc",
        "data_inclusao": "2026-04-30",
        "valor_centavos": 9305,
        "data_prevista_baixa": "2031-04-30",
        "protocolo": "SPC-XYZ-123"
      }
    ],
    "suspensoes_historico": [],
    "religamentos_historico": []
  },

  "auditoria": {
    "audit_log_entries_count": 47,
    "ultimas_5_decisoes_julia": [
      {
        "data": "2026-05-10T19:30:00Z",
        "acao_avaliada": "send_template_d12_anatel",
        "decisao": "BLOQUEADO",
        "motivo": "cliente respondeu 'já paguei' há 2 dias úteis, Súmula 548",
        "fonte_legal": ["Súmula 548 STJ"]
      }
    ]
  },

  "carteira_atribuicao": {
    "portfolio_id": "uuid",
    "portfolio_nome": "Cambé centro",
    "operador_responsavel_id": "uuid",
    "operador_responsavel_nome": "Carlos Operador",
    "atribuido_em": "2024-01-15",
    "atribuido_por": "system",
    "razao": "geo:Cambé + plano>R$ 80"
  },

  "crm_humano": {
    "notes": [
      {
        "id": "uuid",
        "autor": "Carlos Operador",
        "criado_em": "2026-04-20",
        "pinned": true,
        "conteudo": "Cliente disse que mudou de emprego em março, possível dificuldade temporária."
      }
    ],
    "tasks_abertas": [
      {
        "id": "uuid",
        "titulo": "Ligar pessoalmente",
        "assignee": "Carlos Operador",
        "prioridade": "HIGH",
        "due_date": "2026-05-14"
      }
    ]
  },

  "contexto_social": {
    "geocluster_ativo": false,
    "indicacao": {
      "indicado_por_cliente_id": null,
      "indicou_clientes": ["cliente_id_1", "cliente_id_2"]
    },
    "programa_fidelidade": {
      "categoria": "bronze|prata|ouro|platina|null",
      "meses_consecutivos_em_dia": 0,
      "premios_resgatados": []
    }
  },

  "metadados": {
    "criado_em": "2023-08-15T10:00:00Z",
    "criado_por": "migracao_inicial",
    "ultima_atualizacao": "2026-05-12T08:31:00Z",
    "ultima_recalculo_perfil": "2026-05-12T00:30:00Z",
    "ultima_recalculo_predicoes": "2026-05-12T06:00:00Z",
    "schema_version": "1.0"
  }
}
```

---

## 3. Schema Prisma sugerido

Reusa o schema do `CLAUDE.md` original + extensões necessárias para suportar tudo acima.

```prisma
model Customer {
  id                    String   @id @default(uuid()) @db.Uuid
  tenantId              String   @db.Uuid

  // Sync com ERP
  externalIdErp         String
  lastSyncAt            DateTime

  // Identificação
  nome                  String
  cpfCnpjEncrypted      String   // pgcrypto AES-256
  cpfCnpjHash           String   // SHA-256 para Consulta ISP
  dataNascimento        DateTime?
  genero                String?
  estadoCivil           String?
  isPessoaJuridica      Boolean  @default(false)
  razaoSocial           String?
  porteEmpresa          String?

  // Contato
  telefonesE164         String[] // E.164
  telefonesValidados    Json?    // {numero: data_validacao}
  telefonePreferencial  String?
  email                 String?
  emailValidado         Boolean  @default(false)
  whatsappOptedIn       Boolean  @default(false)

  // Endereço + geolocalização
  enderecoJsonb         Json     // {logradouro, numero, complemento, bairro, cidade, uf, cep}
  lat                   Float?
  lng                   Float?
  popTecnico            String?
  ctoTecnico            String?

  // Régua DNA (cache, recalculado diariamente)
  perfilCalculado       String?  // A1..C3
  perfilAnterior30d     String?  // para alerta A3→B3
  perfilCalculadoAt     DateTime?
  perfilFactors         Json?    // explicabilidade

  // Flags persistentes
  flagVulneravel        Boolean  @default(false)
  flagVulneravelSinal   String?
  flagVulneravelData    DateTime?
  flagBindingProcon     Boolean  @default(false)
  flagSuperEndividado   Boolean  @default(false)
  flagMenorDeIdade      Boolean  @default(false)
  flagPrescritaCc206    Boolean  @default(false)
  flagServicoEssencial  Boolean  @default(false)
  flagFalecido          Boolean  @default(false)

  // Status técnico (cache, atualizado por webhook NMS)
  technicalStatus       Json?    // {linkActive, lastIncident, signalQuality, lastPing, slaRealizado}

  // Score Consulta ISP (cache, refresh diário)
  consultaIspScore      Int?
  consultaIspEventos    Json?

  // Predições ML (cache, refresh 24h)
  predictionsJsonb      Json?    // {payment_prob, churn_60d, procon_30d, ltv, devol_equip, modelo_versao, valido_ate}

  // Memória persistente do Reativo (Helena)
  agentMemoryId         String?  @db.Uuid

  // Programa fidelidade (Anatel Shield consumer-side)
  categoriaFidelidade   String?  // bronze|prata|ouro|platina
  mesesConsecutivosOk   Int      @default(0)

  // Audit
  criadoEm              DateTime @default(now())
  criadoPor             String   @default("system")
  atualizadoEm          DateTime @updatedAt

  // Relations
  tenant                Tenant   @relation(fields: [tenantId], references: [id])
  contracts             Contract[]
  invoices              Invoice[]
  communications        Communication[]
  agentMemory           AgentMemory? @relation(fields: [agentMemoryId], references: [id])
  optOuts               OptOut[]
  negativacoes          Negativacao[]
  notes                 CustomerNote[]
  tasks                 CustomerTask[]
  portfolioAssignment   CustomerPortfolioAssignment?
  equipamentos          EquipamentoComodato[]

  @@unique([tenantId, externalIdErp])
  @@index([tenantId, perfilCalculado])
  @@index([tenantId, flagVulneravel])
  @@index([tenantId, flagBindingProcon])
  @@index([cpfCnpjHash])
}

model Contract {
  id                    String   @id @default(uuid()) @db.Uuid
  tenantId              String   @db.Uuid
  customerId            String   @db.Uuid
  externalIdErp         String

  status                ContractStatus
  dataCadastro          DateTime
  dataAtivacao          DateTime
  dataCancelamento      DateTime?
  motivoCancelamento    String?

  diaVencimentoMensal   Int
  formaPagamentoPref    String?

  // Plano atual
  planoId               String
  planoNome             String
  velocidadeDownMbps    Int
  velocidadeUpMbps      Int
  precoMensalCentavos   Int
  planoAtivadoEm        DateTime

  historicoPlanos       Json?    // [{id, de, ate}]

  customer              Customer @relation(fields: [customerId], references: [id])
  invoices              Invoice[]

  @@unique([tenantId, externalIdErp])
}

enum ContractStatus {
  ATIVO
  SUSPENSO_PARCIAL
  SUSPENSO_TOTAL
  CANCELADO
  EM_NEGOCIACAO
  EM_ACORDO
}

model EquipamentoComodato {
  id                          String   @id @default(uuid()) @db.Uuid
  tenantId                    String   @db.Uuid
  customerId                  String   @db.Uuid

  tipo                        String   // ONU|ONT|roteador|mesh|decoder
  marca                       String?
  modelo                      String?
  serial                      String?  @unique
  macAddress                  String?  @unique

  dataInstalacao              DateTime
  valorAquisicaoCentavos      Int
  valorReposicaoAtualCentavos Int?

  termoComodatoAssinado       Boolean  @default(false)
  termoId                     String?  @db.Uuid

  status                      EquipamentoStatus @default(EM_USO)
  statusPosCancelamento       String?  // aguardando_devolucao|agendada_coleta|devolvido|comprado|em_cobranca|perdido

  customer                    Customer @relation(fields: [customerId], references: [id])
}

enum EquipamentoStatus {
  EM_USO
  AGUARDANDO_DEVOLUCAO
  AGENDADA_COLETA
  DEVOLVIDO
  COMPRADO_PELO_CLIENTE
  EM_COBRANCA
  PERDIDO
}

model AgentMemory {
  id                          String   @id @default(uuid()) @db.Uuid
  tenantId                    String   @db.Uuid
  customerId                  String   @unique @db.Uuid

  facts                       Json     @default("[]")
  promises                    Json     @default("[]")
  topicsRecentes              Json     @default("[]")
  sentimentHistory30d         Json     @default("[]")
  sentimentRecente            Float?
  recentInteractionsSummary   String?  @db.Text

  totalInteractionsCicloAtual Int      @default(0)
  lastInteractionAt           DateTime?
  janela24hExpiraAt           DateTime?
}

model OptOut {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @db.Uuid
  customerId    String   @db.Uuid
  canal         String   // whatsapp|sms|email|voz|all
  registradoEm  DateTime @default(now())
  motivo        String?
  ipOrigemHash  String?
}

model Negativacao {
  id                    String   @id @default(uuid()) @db.Uuid
  tenantId              String   @db.Uuid
  customerId            String   @db.Uuid
  faturaId              String   @db.Uuid
  bureau                String   // spc|serasa|boavista
  dataInclusao          DateTime
  dataPrevisaBaixa      DateTime
  protocolo             String
  dataEnvioAnuencia     DateTime
  dataBaixa             DateTime?
  motivoBaixa           String?
  juliaValidationId     String   @db.Uuid
}
```

---

## 4. Blocos do cliente 360°

### Bloco A — Identificação

| Campo | Origem | Atualização | Vê | Restrição PII |
|---|---|---|---|---|
| nome | ERP | sync 15min | todos | nome completo permitido |
| cpf_cnpj_masked | ERP | sync 15min | todos | sempre mascarado em logs |
| cpf_cnpj_hash | ERP | sync 15min | Júlia (Consulta ISP) | apenas hash em logs |
| data_nascimento | ERP | sync 15min | Marcos+Júlia | calcular idade, mostrar idade |
| idade_anos | calculado | tempo real | todos | derivado de nascimento |
| razao_social (PJ) | ERP | sync 15min | todos | público |

### Bloco B — Contato

| Campo | Origem | Atualização | Vê |
|---|---|---|---|
| telefones_e164 | ERP + validação Meta | sync 15min + webhook Meta | Helena, Bruno, Carla, Daniel |
| email | ERP | sync 15min | Carla (email formal), Daniel (PDF) |
| whatsapp_opted_in | webhook Meta + opt-out registro | tempo real | todos |
| opt_outs | tabela própria | imediato no STOP | todos (gate) |

### Bloco C — Endereço + Geo

| Campo | Origem | Atualização | Vê |
|---|---|---|---|
| endereco_jsonb | ERP | sync 15min | Marcos, Lucas (logística) |
| lat/lng | geocoder (Mapbox/Nominatim) | quando endereço muda | Marcos (geocluster), Lucas |
| pop_tecnico | NMS / consulta-isp MCP | sync 1h | Marcos, Helena (técnico) |
| geocluster_ativo | DBSCAN diário | cron diário | Marcos (alerta) |

### Bloco D — Contrato + Plano

| Campo | Origem | Atualização |
|---|---|---|
| status | ERP + Carla (suspensão) + Daniel (cancelamento) | tempo real via webhook |
| plano_atual | ERP | sync 15min |
| historico_planos | ERP | sync 15min |
| tempo_relacao_meses | calculado from data_ativacao | tempo real |

### Bloco E — Equipamentos Comodato

| Campo | Origem | Atualização | Vê |
|---|---|---|---|
| equipamentos_comodato[] | ERP + Lucas (estoque) | sync 15min + após coleta | Lucas, Marcos |
| termo_comodato_assinado | ERP + upload manual | manual | Lucas (gate cobrança) |
| valor_aquisicao | ERP | once | Lucas (cálculo reposição) |
| status_pos_cancelamento | Lucas | manual + workflow | Lucas |

### Bloco F — Financeiro

| Campo | Origem | Atualização |
|---|---|---|
| saldo_devedor_centavos | calculado from faturas | tempo real |
| faturas | ERP + Asaas | webhook tempo real |
| ultimo_pagamento | Asaas webhook | tempo real |
| historico_12m | calculado from faturas | recálculo diário 02h |
| acordos_ativos | tabela própria | quando Rafael fecha |

### Bloco G — Régua DNA

| Campo | Origem | Atualização |
|---|---|---|
| perfil_atual | cron `recalcularPerfis` | diário 00:30 |
| perfil_30d_atras | snapshot | diário 00:30 |
| alerta_queda_fiel | comparação | imediato quando A3→B3 |
| policy_aplicada | ReguaPolicy table | quando admin muda + recálculo |

### Bloco H — Predições ML

| Campo | Origem | Atualização | TTL |
|---|---|---|---|
| predicted_payment_probability | Score & Decisão ML | cron 06h | 24h |
| predicted_churn_60d | survival analysis | cron semanal | 7 dias |
| predicted_procon_30d | classificação textual | cron diário | 24h |
| predicted_ltv | regressão | cron semanal | 7 dias |
| predicted_devolucao_equipamento | classificação | cron semanal | 7 dias |

### Bloco I — Scores Externos

| Campo | Origem | Atualização |
|---|---|---|
| consulta_isp_score | Consulta ISP MCP | sync diário |
| spc_status | Bureaus MCP | sync diário |
| serasa_status | Bureaus MCP | sync diário |

### Bloco J — Comunicação + Memória

| Campo | Origem | Atualização |
|---|---|---|
| memoria_persistente | Helena (Reativo) | a cada interação |
| ultima_interacao_por_canal | mensageria | tempo real |
| janela_24h_meta_status | calculado from last_inbound | tempo real |
| sentiment_recente | Helena (análise) | a cada interação |

### Bloco K — Status Técnico

| Campo | Origem | Atualização |
|---|---|---|
| link_ativo | NMS (Zabbix/SmartOLT) | webhook tempo real |
| last_seen_at | ONU TR-069 | sync 5min |
| ultimo_incidente | NMS event | tempo real |
| sla_realizado | calculado | recálculo mensal |
| chamados_tecnicos | ERP tickets | sync 15min |

### Bloco L — Flags Compliance

| Campo | Origem | Atualização |
|---|---|---|
| flag_vulneravel | Helena (NLP) → Júlia | imediato após detecção |
| flag_binding_procon | Helena (NLP) → Júlia | imediato após detecção |
| flag_super_endividado | Daniel (rede ConsultaISP) | quando detectado |
| flag_menor_de_idade | Helena → Júlia | imediato |
| flag_prescrita_cc206 | cron calendar | diário (>5 anos) |
| flag_servico_essencial | declaração manual | upload + manual |
| flag_falecido | declaração + comprovação | manual via humano |
| alegou_pagamento_em | Helena | imediato |
| pausa_sumula_548_ate | Júlia | calculado from alegou+5 úteis |

### Bloco M — Regulatório / Auditoria

| Campo | Origem | Atualização |
|---|---|---|
| anuencia_previa | Daniel (D+30) | quando enviada |
| notificacoes_anatel | Carla (D+12 a D+14) | quando enviada |
| negativacoes_ativas | Daniel | quando incluída |
| suspensoes_historico | Carla | append a cada suspensão |
| religamentos_historico | Carla | append a cada religamento |
| audit_log_entries | todos agentes | append-only |

### Bloco N — Carteira Atribuição (CRM)

| Campo | Origem | Atualização |
|---|---|---|
| portfolio_id | cron `reatribuirClientes` | diário |
| operador_responsavel | Portfolio.owner | quando admin muda |
| notes (humanas) | CRM UI | manual |
| tasks_abertas | CRM UI | manual + auto |

### Bloco O — Contexto Social

| Campo | Origem | Atualização |
|---|---|---|
| geocluster_ativo | DBSCAN diário | cron diário |
| indicado_por | programa indicação | quando assina |
| categoria_fidelidade | cálculo programa | mensal |

---

## 5. Quem consome cada bloco

| Agente | Blocos consumidos (read) | Blocos modificados (write) |
|---|---|---|
| **Marcos** (Score&Decisão) | TODOS | predicoes_ml, regua_dna.alerta, decisões agente |
| **Júlia** (Compliance) | TODOS (validação binding) | flags_compliance, audit log |
| **Helena** (Reativo) | identificação, contato, contrato, financeiro, regua_dna, comunicação, status_tecnico, flags | memoria_persistente, sentiment, promises, topics, flags (sinal) |
| **Bruno** (Preventivo) | identificação, contato, financeiro (fatura próxima), regua_dna, predicoes_ml, status_tecnico, flags | última_interacao_canal |
| **Rafael** (Negociador) | identificação, financeiro completo, regua_dna, predicoes_ml, scores externos, flags | acordos_ativos |
| **Carla** (Suspensão) | identificação, contato, contrato, financeiro, regua_dna, flags, status_tecnico | regulatorio.notificacoes_anatel, regulatorio.suspensoes, contrato.status |
| **Sofia** (Agradecimento) | identificação, regua_dna, financeiro (último pagamento), sentiment, flags | última_interacao_canal |
| **Daniel** (Recuperação Financeira D+60+) | identificação, contato, financeiro, regua_dna, scores_externos, flags | regulatorio.anuencia, regulatorio.negativacoes |
| **Lucas** (Equipamentos) | identificação, contato, endereço, equipamentos_comodato, regua_dna, flags | equipamentos_comodato.status_pos_cancelamento |
| **Pedro** (Pesquisa) | identificação, regua_dna, sentiment, flags, contrato (timing) | feedback agregado |

---

## 6. Fontes de dados e atualização

```
ERP (IXC/MK/SGP/Hubsoft/Voalle/RBX)
   ├── identificação básica
   ├── contato
   ├── endereço
   ├── contrato
   ├── plano
   ├── faturas (status, valores, datas)
   ├── histórico pagamentos
   ├── equipamentos comodato
   └── chamados técnicos
   → Sync: webhook tempo real OU cron 15min se ERP não tem webhook

Asaas (Pagamentos)
   ├── faturas geradas
   ├── pagamentos confirmados
   ├── conciliação
   └── webhooks
   → Sync: webhook tempo real (PAYMENT_RECEIVED, PAYMENT_REFUNDED, etc)

Meta WhatsApp Cloud API
   ├── status de delivery
   ├── status de leitura
   ├── opt-outs (STOP)
   └── inbound
   → Sync: webhook tempo real

NMS (Zabbix/SmartOLT/LibreNMS)
   ├── link ativo
   ├── sinal qualidade ONU
   ├── eventos de queda no POP
   └── incidentes
   → Sync: webhook OU polling 5min

Consulta ISP (rede colaborativa)
   ├── score (0-1000)
   ├── histórico em outros provedores
   └── eventos de inadimplência
   → Sync: API on-demand + cache 24h

Bureaus (SPC/Serasa/Boa Vista)
   ├── status negativação
   ├── score
   └── restrições
   → Sync: API on-demand + cache 24h

Bureau de geocoding (Nominatim/Mapbox)
   ├── lat/lng a partir do endereço
   ├── POP/CTO (cruzamento)
   └── cluster geo (DBSCAN diário)
   → Sync: quando endereço muda

Crons (jobs programados)
   ├── 00:30 — recalcularPerfis (Régua DNA)
   ├── 02:00 — recálculo histórico 12m
   ├── 06:00 — predições ML (payment prob, churn, procon)
   ├── 07:00 — detectar geo-clusters DBSCAN
   ├── 08:00 — Marcos briefing matinal
   ├── Diário — sync ConsultaISP + Bureaus
   └── Mensal — cálculo Provedor Index + categoria fidelidade

Inputs humanos (UI CRM)
   ├── notes
   ├── tasks
   ├── flag_servico_essencial declaração
   ├── flag_falecido declaração
   ├── upload termo comodato
   └── override de policy do tenant
```

---

## 7. Restrições de privacidade (LGPD)

### Mascaramento por contexto

| Onde | CPF | Telefone | Email | Endereço |
|---|---|---|---|---|
| UI admin (operador autorizado) | completo | completo | completo | completo |
| UI admin (operador outra carteira) | bloqueado RLS | bloqueado | bloqueado | bloqueado |
| Logs aplicação | `123.***.**-12` | `+55****1234` | mascarado | bloqueado |
| Logs audit | hash SHA-256 | mascarado | mascarado | mascarado |
| Webhook outbound (terceiros) | hash | mascarado | mascarado | bloqueado |
| Resposta API pública | bloqueado | bloqueado | bloqueado | bloqueado |
| Mensagem cliente final | nome completo, dados gerais ok | n/a | n/a | n/a |

### Retenção

| Dado | Retenção máxima | Base legal |
|---|---|---|
| Cliente ativo (todos blocos) | enquanto contrato ativo + 5 anos pós-cancelamento | CDC + CC 206 (prescrição) |
| Comunicações (mensagens) | 12 meses | LGPD minimização |
| Audit log | 6 anos | Prescrição trabalhista geral + defesa em juízo |
| Opt-outs | permanente (até cliente reverter via canal) | LGPD art. 18 V |
| Negativações | até baixa + 5 anos | CC 206 / Lei 12.039 |
| Dados de menor (LGPD 14) | apenas com consentimento responsável + 12 meses pós-uso | LGPD 14 |
| Logs IP/MAC (técnico) | 1 ano | Marco Civil 13 |

### Base legal por finalidade

| Finalidade | Base legal LGPD |
|---|---|
| Execução contrato | art. 7 V (contrato) |
| Cobrança ativa | art. 7 II (legítimo interesse) + termo |
| Análise comportamental (Régua DNA) | art. 7 IX (legítimo interesse) |
| Comunicação preventiva (Bruno) | art. 7 V (contrato) |
| Marketing/upsell | art. 7 I (consentimento) — separado |
| Compartilhamento Consulta ISP | art. 7 IX + termo do tenant |
| Bureaus (SPC/Serasa) | art. 7 II + CDC 43 §2 |
| Logs técnicos (Marco Civil) | art. 7 II (obrigação legal) |

### Direitos do titular (LGPD art. 18)

Sistema deve suportar:
- **Acesso** (`GET /api/customers/me`): cliente pega seu próprio JSON 360°
- **Correção**: cliente solicita correção via UI/WhatsApp
- **Anonimização**: pós-cancelamento + 5 anos → cron anonimiza
- **Eliminação**: solicitação explícita → workflow humano (impacta ERP)
- **Portabilidade**: JSON estruturado download
- **Revogação consentimento**: opt-out registrado + parada agentes
- **Informação sobre uso**: política privacidade pública

---

## 8. Diagrama de fluxo de dados

```
                                  ┌─────────────────────────┐
                                  │   CRONS DIÁRIOS         │
                                  │   00:30 perfis          │
                                  │   06:00 predições ML    │
                                  │   07:00 geo-cluster     │
                                  │   08:00 briefing Marcos │
                                  └────────────┬────────────┘
                                               │
       ERP ───────►  webhook ────►          ┌──┴──────────────┐
       Asaas ─────►  webhook ────►          │  CLIENT 360°    │ ◄─── Helena (memória)
       Meta ──────►  webhook ────►          │  consolidator   │ ◄─── Júlia (flags)
       NMS ───────►  polling 5m ──►         │  (Score&Decisão)│ ◄─── Lucas (equip)
       Consulta ISP ► API on-demand ────►   └──┬──────────────┘     Daniel (negativ)
       Bureaus ───►  API on-demand ──────►     │
                                               │
                          ┌────────────────────┼────────────────────┐
                          │                    │                    │
                          ▼                    ▼                    ▼
                      Helena              Bruno/Rafael/         Pedro/Sofia
                      (Reativo)           Carla/Daniel          (Relacionamento)
                                          (Cobrança)

   Output: cada agente recebe SEU subset do Client 360° + executa ação
   Auditoria: tudo passa por Júlia (Compliance) antes de outbound real
```

---

## 9. Próximos passos de implementação

### Sprint backend (estimativa)

1. **Schema Prisma completo** (2 dias) — toda struct acima
2. **Adapter ERP IXC** real (5 dias) — sync de todos blocos
3. **Webhook receivers** (3 dias) — Asaas, Meta, NMS
4. **Score & Decisão consolidator** (4 dias) — função que monta o 360° por cliente
5. **Cron Régua DNA** (2 dias)
6. **Cron predições ML** (5 dias) — começa com regressão logística simples
7. **Geo-cluster DBSCAN** (2 dias)
8. **RLS PostgreSQL** (2 dias) — multi-tenant strict + operador-carteira
9. **Audit log** append-only criptografado (2 dias)
10. **Endpoints REST** (3 dias) — `/api/customers/:id/360`

Total: ~30 dias-pessoa para MVP completo do Client 360°.

### Frontend / UI consumir o 360°

Ver `DESIGN.md` seção 6 — telas que consomem este payload:
- `/customers/[id]/page.tsx` — visão geral
- `/customers/[id]/conversations` — bloco J
- `/customers/[id]/memory` — bloco J (memória persistente)
- `/customers/[id]/invoices` — bloco F
- `/customers/[id]/equipments` — bloco E
- `/customers/[id]/legal-actions` — bloco M
- `/customers/[id]/next-action` — output do Marcos

---

*Documento de spec v1.0 — Maio/2026. Atualizar conforme blocos forem implementados.*
