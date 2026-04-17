# Topologia e Fluxo - Sistema de Agentes de Vendas (Consulta ISP)

**Versão:** 1.1
**Data:** 2026-04-16
**Escopo:** Sistema de agentes de vendas AI (`agentes-sistema/`)
**Stack:** Node.js + Express + SQLite + Claude AI + Z-API + Docker + Caddy

---

## Contexto de negócio (IMPORTANTE antes de ler a topologia)

Dois sistemas convivem sob o nome "Consulta ISP" e **não devem ser confundidos**:

| Sistema                          | O que é                                                                                       | Papel no ecossistema           |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------ |
| **Consulta ISP** (produto)       | Plataforma SaaS de **análise de crédito para provedores de internet (ISPs)**. É o que se vende. | Produto comercializado         |
| **Sistema de Agentes AI** (este) | Ferramenta interna com 7 agentes de IA que **prospectam, qualificam e fecham vendas** do Consulta ISP. | Motor comercial / growth       |

**Todos os diagramas e descrições abaixo se referem ao Sistema de Agentes AI.** Os "leads" são ISPs brasileiros (donos, diretores comerciais, gestores financeiros de provedores) que são prospects do produto Consulta ISP. Quando um campo como `leads.provedor` aparece, significa o nome do ISP prospect (ex: "NetConnect Fibra"); `num_clientes` é quantos assinantes esse ISP tem; `erp` é o ERP operacional do ISP (SGP, IXC Soft, MK-AUTH, etc.).

**ICP (Ideal Customer Profile) do Consulta ISP:**

- ISPs com 300+ assinantes ativos
- Possuem ERP integrado (SGP, IXC Soft, MK-AUTH, Radius Manager, Voalle)
- Têm inadimplência ≥ 5% da receita mensal
- Decisor: sócio, CEO, diretor comercial ou financeiro

**Proposta de valor do Consulta ISP (o que os agentes argumentam):**

- Consulta automatizada de CPF/CNPJ via integrações com birôs de crédito
- Score de risco pré-venda → reduz inadimplência
- Monitoramento contínuo da base de assinantes
- Integração nativa com os principais ERPs de ISP do mercado brasileiro

---

## Índice

1. [Topologia de Infraestrutura (Deploy)](#1-topologia-de-infraestrutura-deploy)
2. [Visão Geral - Arquitetura Lógica](#2-visão-geral---arquitetura-lógica)
3. [Fluxo de Entrada de Mensagens (Webhooks)](#3-fluxo-de-entrada-de-mensagens-webhooks)
4. [Pipeline do Orchestrator](#4-pipeline-do-orchestrator-core-decision-flow)
5. [Arquitetura dos 7 Agentes AI](#5-arquitetura-dos-7-agentes-ai--handoff)
6. [Modelo de Dados (ER Diagram)](#6-modelo-de-dados-er-diagram)
7. [Fluxo de Saída Multi-Canal](#7-fluxo-de-saída-multi-canal)
8. [Scheduler de Follow-ups](#8-scheduler-de-follow-ups)
9. [Integrações Externas (Ads)](#9-integrações-externas-meta--google-ads)
10. [Dashboard e API de Gestão](#10-dashboard-e-api-de-gestão)
11. [Fluxo Fim-a-Fim (Sequence Diagram)](#11-fluxo-fim-a-fim-sequence-diagram)
12. [Pontos Críticos de Atenção](#12-pontos-críticos-de-atenção-para-o-fluxo)

---

## 1. Topologia de Infraestrutura (Deploy)

```mermaid
graph TB
    subgraph Internet["Internet"]
        USER[Usuário / Browser]
        WA[WhatsApp Business]
        IG[Instagram]
        META[Meta Ads API]
        GOOGLE[Google Ads API]
        ANTHROPIC[Anthropic API]
        ZAPI[Z-API Cloud]
    end

    subgraph VPS["VPS 187.127.7.168 - srv1547310 - Ubuntu 24.04"]
        UFW[UFW Firewall<br/>22 / 80 / 443]

        subgraph NGINX["⚠️ nginx/1.24 do sistema - em conflito"]
            NG80[nginx :80<br/>default 404]
        end

        subgraph Docker["Docker Engine"]
            CADDY[caddy-proxy<br/>:80 - :443<br/>reverse_proxy]
            APP[consulta-isp-agentes<br/>Node.js - expose :3001]
            NET[(Network:<br/>consulta-isp-agentes_default)]
            VOL1[(volume: ./data<br/>SQLite + WAL)]
            VOL2[(volume: ./skills-ref<br/>read-only)]
        end
    end

    USER -->|HTTP/HTTPS| UFW
    WA -->|webhook POST| UFW
    IG -->|webhook POST| UFW
    UFW --> NG80
    NG80 -.retirar do caminho.-> CADDY
    UFW ==>|desejado| CADDY
    CADDY --> NET
    NET --> APP
    APP --> VOL1
    APP --> VOL2
    APP -->|HTTPS outbound| ZAPI
    APP -->|HTTPS outbound| ANTHROPIC
    APP -->|HTTPS outbound| META
    APP -->|HTTPS outbound| GOOGLE
    ZAPI --> WA
```

**Estado atual (16/04/2026):**

| Componente          | Status                            | Observação                                            |
| ------------------- | --------------------------------- | ----------------------------------------------------- |
| VPS 187.127.7.168   | ✅ Online                         | Ubuntu 24.04, Docker ativo                            |
| Container `agentes` | ✅ Up (healthy)                   | Node :3001 interno, startup OK                        |
| Container `caddy`   | ⚠️ Up mas shadowed                | Ouvindo :80/:443 no container, porém nginx host ocupa |
| nginx do sistema    | 🔴 Conflito                       | Bind em 0.0.0.0:80 respondendo 404 antes do Caddy     |
| UFW                 | ⚠️ Sem 3080                       | Permite 22/80/443 somente                             |
| Volume `./data`     | ✅ Persistente                    | SQLite WAL                                            |
| GitHub repo         | ⚠️ Divergência                    | fix-vps.sh / status.html / AUDITORIA só local         |

---

## 2. Visão Geral - Arquitetura Lógica

```mermaid
graph LR
    subgraph Canais["Canais de Entrada"]
        CH1[WhatsApp via Z-API]
        CH2[Instagram DM via Meta]
        CH3[Dashboard Web]
    end

    subgraph Ingestao["Camada de Ingestão"]
        W1[/webhook/zapi/]
        W2[/webhook/instagram/]
        W3[/api/send - manual/]
    end

    subgraph Core["Core - Orchestrator"]
        ORCH[Orchestrator<br/>processIncoming]
        CLAUDE[Claude Service<br/>analyzeAndDecide]
        ROUTER{Score Router<br/>31 / 61 / 81}
    end

    subgraph Agentes["7 Agentes AI"]
        SOFIA[Sofia<br/>Marketing]
        LEO[Leo<br/>Captação]
        CARLOS[Carlos<br/>SDR inbound]
        LUCAS[Lucas<br/>AE qualificado]
        RAFAEL[Rafael<br/>Closer]
        MARCOS[Marcos<br/>CS pós-venda]
        DIANA[Diana<br/>Supervisora]
    end

    subgraph Dados["Camada de Dados"]
        DB[(SQLite<br/>12 tabelas)]
        SKILLS[Skills KB<br/>read-only]
    end

    subgraph Saida["Camada de Saída"]
        ZAPI_OUT[Z-API send-text]
        IG_OUT[Instagram Graph API]
        EMAIL[Email Sender]
        PDF[PDF Report]
    end

    subgraph Scheduler["Schedulers"]
        FOLLOWUP[Follow-up Checker<br/>a cada 5 min]
        ADS_OPT[Ads Optimizer<br/>sob demanda]
    end

    CH1 --> W1
    CH2 --> W2
    CH3 --> W3
    W1 --> ORCH
    W2 --> ORCH
    W3 --> ORCH
    ORCH --> CLAUDE
    ORCH --> DB
    CLAUDE --> SKILLS
    ORCH --> ROUTER
    ROUTER --> SOFIA
    ROUTER --> CARLOS
    ROUTER --> LUCAS
    ROUTER --> RAFAEL
    SOFIA -.supervisão.-> DIANA
    CARLOS -.supervisão.-> DIANA
    LUCAS -.supervisão.-> DIANA
    RAFAEL -.supervisão.-> DIANA
    LEO --> CARLOS
    RAFAEL --> MARCOS
    ORCH --> ZAPI_OUT
    ORCH --> IG_OUT
    ORCH --> EMAIL
    MARCOS --> PDF
    FOLLOWUP --> ORCH
    ADS_OPT --> DB
```

**Responsabilidades por camada:**

- **Ingestão** — recebe eventos externos (webhooks) e normaliza pro Orchestrator.
- **Core** — decide o quê fazer, quem deve responder, qual score atribuir.
- **Agentes** — personas com prompts especializados; cada um tem um estágio do funil.
- **Dados** — persistência de leads, conversas, métricas, follow-ups, A/B, handoffs.
- **Saída** — envia a resposta pelo canal correto (WhatsApp, Instagram, email).
- **Schedulers** — processos que rodam em background (follow-up, otimização de ads).

---

## 3. Fluxo de Entrada de Mensagens (Webhooks)

```mermaid
flowchart TD
    START[Mensagem chega ao canal externo] --> DECIDE{Qual canal?}

    DECIDE -->|WhatsApp| ZAPI_HOOK[POST /webhook/zapi]
    DECIDE -->|Instagram| IG_HOOK[POST /webhook/instagram]
    DECIDE -->|Status delivery| ZAPI_STATUS[POST /webhook/zapi/status]

    ZAPI_HOOK --> VAL1{phone + text.message?}
    VAL1 -->|não| IGNORE1[200 ignored]
    VAL1 -->|sim + fromMe| IGNORE2[200 own_message]
    VAL1 -->|sim + externo| EXTRACT1[Extrai phone, message, messageData]

    IG_HOOK --> VERIFY{GET challenge?}
    VERIFY -->|sim| CHALLENGE[Retorna challenge]
    VERIFY -->|não POST| PARSE_IG[Parse entry.messaging]
    PARSE_IG --> EXTRACT2[Extrai senderId, text - prefixa ig_]

    ZAPI_STATUS --> MAP[Mapeia DELIVERY_ACK → entregue<br/>READ → lido]
    MAP --> UPDATE_MSG[UPDATE conversas SET status_entrega]

    EXTRACT1 --> ORCH_CALL[orchestrator.processIncoming]
    EXTRACT2 --> ORCH_CALL

    ORCH_CALL --> RESPONSE[Retorna lead_id, agente, acao]
    RESPONSE --> END[200 processed]

    IGNORE1 --> END
    IGNORE2 --> END
    CHALLENGE --> END
    UPDATE_MSG --> END
```

**Endpoints de entrada mapeados:**

| Endpoint                    | Método  | Fonte      | Autenticação            | Status atual |
| --------------------------- | ------- | ---------- | ----------------------- | ------------ |
| `/webhook/zapi`             | POST    | Z-API      | 🔴 NENHUMA              | Público      |
| `/webhook/zapi/status`      | POST    | Z-API      | 🔴 NENHUMA              | Público      |
| `/webhook/instagram`        | GET     | Meta       | verify_token (fraco)    | Público      |
| `/webhook/instagram`        | POST    | Meta       | 🔴 Sem HMAC X-Hub-Sig   | Público      |
| `/api/send`                 | POST    | Dashboard  | 🔴 NENHUMA              | Crítico      |
| `/api/leads`                | GET     | Dashboard  | 🔴 NENHUMA              | Vazamento    |
| `/api/prospectar`           | POST    | Dashboard  | 🔴 NENHUMA              | Crítico      |

> ⚠️ **Bloqueador de Onda 1:** Toda superfície de entrada está pública. Referência: AUDITORIA-COMPLETA §1.4 (SEC-01, SEC-03).

---

## 4. Pipeline do Orchestrator (Core Decision Flow)

```mermaid
flowchart TD
    IN[processIncoming phone, message, messageData]

    IN --> Q1{Lead existe?<br/>SELECT FROM leads WHERE telefone=?}
    Q1 -->|não| CREATE[INSERT lead<br/>agente_atual=carlos<br/>etapa=novo]
    Q1 -->|sim| LOAD[Carrega lead do DB]
    CREATE --> LOG1[log_activity: lead_criado]
    LOG1 --> LOAD

    LOAD --> INSERT_MSG[INSERT conversas<br/>direcao=recebida]
    INSERT_MSG --> METRIC1[updateDailyMetric<br/>mensagens_recebidas+1]

    METRIC1 --> CANCEL_FU[followup.cancelFollowups lead.id]
    CANCEL_FU --> AB_TRACK{Última msg enviada<br/>tinha A/B test?}
    AB_TRACK -->|sim| AB_RECORD[abTesting.recordResponse]
    AB_TRACK -->|não| HIST
    AB_RECORD --> HIST

    HIST[_getHistorico lead.id, 10] --> CLAUDE_CALL[claude.analyzeAndDecide<br/>agente_atual + historico + lead]

    CLAUDE_CALL --> OUT[analise:<br/>- resposta_whatsapp<br/>- dados_extraidos<br/>- score_update<br/>- acao<br/>- notas_internas]

    OUT --> UPD_DATA[_updateLeadData<br/>merge dados_extraidos]
    UPD_DATA --> UPD_SCORE[_updateScore<br/>score_perfil + score_comportamento]

    UPD_SCORE --> RELOAD[Recarrega lead atualizado]
    RELOAD --> HANDOFF{Score + agente<br/>dispara handoff?}

    HANDOFF -->|Carlos + score&gt;=61| H1[transferLead<br/>carlos → lucas]
    HANDOFF -->|Lucas + score&gt;=81| H2[transferLead<br/>lucas → rafael]
    HANDOFF -->|Carlos + 0&lt;score&lt;31| H3[transferLead<br/>carlos → sofia]
    HANDOFF -->|não| SEND

    H1 --> SEND
    H2 --> SEND
    H3 --> SEND

    SEND[INSERT conversas<br/>direcao=enviada<br/>metadata: acao + notas]
    SEND --> DISPATCH[_sendByChannel<br/>whatsapp / instagram / email]
    DISPATCH --> LOG2[log_activity: resposta_enviada]
    LOG2 --> METRIC2[updateDailyMetric<br/>mensagens_enviadas+1]

    METRIC2 --> MOD3{msgCount % 3 == 0?}
    MOD3 -->|sim| TRAIN[training.evaluateResponse<br/>async sem await]
    MOD3 -->|não| DONE
    TRAIN --> DONE[RETURN lead_id, agente, acao]
```

**Entradas e saídas do pipeline:**

| Input                      | Fonte                 |
| -------------------------- | --------------------- |
| `phone`                    | Webhook payload       |
| `message`                  | Webhook payload       |
| `messageData.type`         | Z-API ou Instagram    |
| `messageData.canal`        | Inferido pelo webhook |
| Histórico (últimas 10 msg) | SQLite                |
| Prompt do agente           | `training` service    |
| Skills KB (se conectado)   | `skills-knowledge`    |

| Output                  | Destino            |
| ----------------------- | ------------------ |
| Resposta WhatsApp       | Z-API send-text    |
| Atualização de lead     | Tabela `leads`     |
| Atualização de score    | Campos `score_*`   |
| Registro de conversa    | Tabela `conversas` |
| Handoff (se disparou)   | Tabela `handoffs`  |
| Métrica diária          | Tabela `metricas`  |
| Log de atividade        | Tabela `logs`      |
| Cancelamento follow-up  | Tabela `followups` |

---

## 5. Arquitetura dos 7 Agentes AI + Handoff

```mermaid
stateDiagram-v2
    [*] --> Sofia: Lead vindo de<br/>Marketing inbound

    Sofia: Sofia (Marketing)<br/>etapa: novo<br/>Qualificação inicial
    Leo: Leo (Captação)<br/>etapa: prospeccao<br/>Outbound ativo
    Carlos: Carlos (SDR)<br/>etapa: qualificacao<br/>Inbound + perfil
    Lucas: Lucas (AE)<br/>etapa: apresentacao<br/>Demo + dor
    Rafael: Rafael (Closer)<br/>etapa: fechamento<br/>Proposta + negociação
    Marcos: Marcos (CS)<br/>etapa: pos_venda<br/>Onboarding + retenção
    Diana: Diana (Supervisora)<br/>cross-cutting<br/>Auditoria e treino

    [*] --> Leo: Lead prospeccao<br/>outbound
    [*] --> Carlos: Lead captado<br/>direto por ad
    Leo --> Carlos: Lead aceitou<br/>conversa inicial
    Sofia --> Carlos: Lead engajou<br/>move pra qualificação

    Sofia --> Sofia: score baixo (0&lt;s&lt;31)<br/>manter nurturing
    Carlos --> Sofia: score regrediu<br/>devolve marketing
    Carlos --> Lucas: score &gt;= 61<br/>qualificado
    Lucas --> Rafael: score &gt;= 81<br/>pronto fechar

    Rafael --> Marcos: fechou_ganho<br/>novo cliente
    Rafael --> Sofia: fechou_perdido<br/>re-engajar no futuro

    Diana --> Sofia: audita + ajusta prompt
    Diana --> Carlos: audita + ajusta prompt
    Diana --> Lucas: audita + ajusta prompt
    Diana --> Rafael: audita + ajusta prompt

    Marcos --> [*]: churn / upsell / renovação
```

**Mapa de responsabilidades (todos vendendo o produto Consulta ISP para ISPs):**

| Agente  | Função                | Etapa do funil   | Gatilho de entrada                           | Saída possível                          | Conversação típica                                                                   |
| ------- | --------------------- | ---------------- | -------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| Sofia   | Marketing / nurturing | `novo`           | Lead inbound frio, score < 31                | Carlos (engajou) ou manter              | Educa sobre inadimplência em ISPs, envia material, cadência leve                     |
| Leo     | Captação outbound     | `prospeccao`     | Lista importada, ICP match                   | Carlos (aceitou conversa)               | "Sou Leo, ajudo ISPs a reduzir inadimplência. Vocês tem X clientes, posso mostrar?"  |
| Carlos  | SDR inbound           | `qualificacao`   | Default de novos leads                       | Lucas (score ≥61) ou Sofia (score <31)  | Descobre porte do ISP, ERP usado, % de inadimplência atual, decisor                  |
| Lucas   | Account Executive     | `apresentacao`   | Handoff do Carlos, score ≥61                 | Rafael (score ≥81)                      | Demonstra Consulta ISP, integração com ERP, casos de redução de inadimplência        |
| Rafael  | Closer                | `fechamento`     | Handoff do Lucas, score ≥81                  | Marcos (ganho) ou Sofia (perdido)       | Envia proposta, negocia preço/setup, agenda implantação                              |
| Marcos  | Customer Success      | `pos_venda`      | Fechamento ganho                             | Upsell, renovação, churn                | Onboarding da integração ERP, acompanha uso, identifica upsell                       |
| Diana   | Supervisora           | (cross-cutting)  | Sob demanda (auditoria)                      | Retroalimenta training de todos         | Analisa conversas dos outros 6, ajusta prompts, detecta erros de qualificação        |

**Regras de handoff (confirmado no código, `orchestrator.js:56-65`):**

```
if (agente = carlos) and (score >= 61):    carlos → lucas
if (agente = lucas)  and (score >= 81):    lucas  → rafael
if (agente = carlos) and (0 < score < 31): carlos → sofia
```

> ⚠️ **Gap identificado:** Não há regra automática pra lucas → sofia quando score cai. E não há handoff automático pra marcos após `etapa_funil = fechado_ganho` — depende de chamada manual.

---

## 6. Modelo de Dados (ER Diagram)

```mermaid
erDiagram
    leads ||--o{ conversas : "1:N"
    leads ||--o{ handoffs : "1:N"
    leads ||--o{ followups : "1:N"
    leads ||--o{ logs : "1:N"
    leads ||--o{ propostas : "1:N"

    conversas }o--|| leads : "lead_id"

    ab_tests ||--o{ ab_resultados : "1:N"

    metricas_diarias }o--|| agentes_config : "agente"
    prompts_versao }o--|| agentes_config : "agente"

    leads {
        int id PK "ISP prospect"
        string telefone UK "WA do decisor"
        string nome "Nome do decisor"
        string provedor "Nome do ISP"
        string cidade
        string estado
        string porte "pequeno/medio/grande"
        int num_clientes "Assinantes do ISP"
        string erp "SGP/IXC/MK-AUTH/etc"
        string decisor "cargo do decisor"
        int score_perfil "0-50"
        int score_comportamento "0-50"
        int score_total "0-100"
        string classificacao "frio/morno/quente"
        string etapa_funil
        string agente_atual
        string origem
        real valor_estimado "TPV esperado"
        datetime criado_em
    }

    conversas {
        int id PK
        int lead_id FK
        string agente
        string direcao "recebida|enviada"
        text mensagem
        string tipo
        string canal "whatsapp|instagram|email"
        string status_entrega "entregue|lido"
        int tokens_usados
        int tempo_resposta_ms
        json metadata
        datetime criado_em
    }

    handoffs {
        int id PK
        int lead_id FK
        string de_agente
        string para_agente
        string motivo
        int score_momento
        datetime criado_em
    }

    followups {
        int id PK
        int lead_id FK
        string tipo
        text mensagem_agendada
        datetime executar_em
        string status "pendente|enviado|cancelado"
        datetime criado_em
    }

    logs {
        int id PK
        string agente
        int lead_id FK
        string acao
        text descricao
        int score_antes
        int score_depois
        int tokens_usados
        int tempo_resposta_ms
        datetime criado_em
    }

    metricas_diarias {
        int id PK
        date data
        string agente
        int leads_novos
        int mensagens_recebidas
        int mensagens_enviadas
        int handoffs_feitos
        int vendas_fechadas
        real receita_gerada
    }

    ab_tests {
        int id PK
        string nome
        string agente
        string contexto
        text variante_a
        text variante_b
        datetime iniciado_em
        string status
    }

    ab_resultados {
        int id PK
        int ab_test_id FK
        string variante "A|B"
        int envios
        int respostas
        real taxa_resposta
    }

    agentes_config {
        string agente PK
        string nome_exibicao
        text prompt_sistema
        string modelo_claude
        real temperature
        boolean ativo
    }

    prompts_versao {
        int id PK
        string agente
        int versao
        text prompt
        boolean ativo
        datetime criado_em
    }

    propostas {
        int id PK
        int lead_id FK
        real valor
        text conteudo
        string status "enviada|aceita|rejeitada"
        string pdf_path
        datetime criado_em
    }

    treinamento_feedback {
        int id PK
        string agente
        int lead_id FK
        text mensagem_original
        text resposta_dada
        real score_qualidade
        text feedback_claude
        datetime criado_em
    }
```

**Índices críticos que faltam (`AUDITORIA §1.3 Tech Debt`):**

- `conversas(lead_id, criado_em DESC)` — usado em `_getHistorico`
- `conversas(direcao, lead_id, criado_em DESC)` — usado em A/B tracking
- `leads(agente_atual, etapa_funil)` — usado no dashboard
- `followups(status, executar_em)` — usado no scheduler a cada 5 min
- `metricas_diarias(data DESC, agente)` — usado em `/stats`

---

## 7. Fluxo de Saída Multi-Canal

```mermaid
flowchart LR
    RESP[analise.resposta_whatsapp<br/>retornada pelo Claude]

    RESP --> SEND_CH[_sendByChannel lead, resposta]
    SEND_CH --> DECIDE{lead.canal_preferido?}

    DECIDE -->|whatsapp default| WA_PATH
    DECIDE -->|instagram| IG_PATH
    DECIDE -->|email| EMAIL_PATH

    subgraph WA_PATH["WhatsApp via Z-API"]
        W1[zapi.sendText phone, msg]
        W2[axios.post ZAPI_URL/token/TOKEN/send-text]
        W3[zapi response: messageId]
        W1 --> W2 --> W3
    end

    subgraph IG_PATH["Instagram Graph API"]
        I1[instagram.sendDM senderId, msg]
        I2[Meta Graph /me/messages]
        I3[usa PAGE_ACCESS_TOKEN]
        I1 --> I2 --> I3
    end

    subgraph EMAIL_PATH["Email - Nodemailer"]
        E1[emailSender.send to, subject, body]
        E2[SMTP configurado em .env]
        E1 --> E2
    end

    W3 --> METRICS[atualiza status_entrega<br/>quando /webhook/zapi/status chega]
    I3 --> LOG_IG[log activity]
    E2 --> LOG_EM[log activity]
```

**Decisão do canal** (baseada em `messageData.canal` no webhook + `lead.canal_preferido` na DB):

| Origem                               | Canal usado na resposta |
| ------------------------------------ | ----------------------- |
| `/webhook/zapi` (phone `55XXXX`)     | whatsapp (padrão)       |
| `/webhook/instagram` (`ig_senderId`) | instagram               |
| Lead com `canal_preferido = email`   | email                   |

> ⚠️ **Débito:** Não há fallback caso o canal primário falhe. Se Z-API retornar 5xx, mensagem é perdida (tem log mas não fila de retry). Ver AUDITORIA §2.1 R7.

---

## 8. Scheduler de Follow-ups

```mermaid
sequenceDiagram
    participant SRV as server.js
    participant INT as setInterval 5min
    participant FU as followup.processFollowups
    participant DB as SQLite
    participant ORCH as Orchestrator
    participant ZAPI as Z-API

    SRV->>INT: registra interval 5 * 60 * 1000
    loop A cada 5 minutos
        INT->>FU: processFollowups
        FU->>DB: SELECT FROM followups<br/>WHERE status=pendente<br/>AND executar_em <= NOW
        DB-->>FU: [follow-ups pendentes]
        loop para cada follow-up
            FU->>DB: SELECT lead
            FU->>ORCH: sendOutbound lead, mensagem
            ORCH->>ZAPI: sendText
            ZAPI-->>ORCH: OK
            ORCH->>DB: INSERT conversa direcao=enviada
            FU->>DB: UPDATE followups SET status=enviado
        end
    end

    Note over FU: Cancelamento acontece em<br/>orchestrator.processIncoming:29<br/>quando lead responde
```

**Quando um follow-up é criado:**

- Agente decide em `analise.acao = "agendar_followup"` com `analise.dados_extraidos.followup_em`
- Ou manualmente via `/api/followups` (se exposto)

**Quando é cancelado:**

- Lead responde qualquer mensagem → `followup.cancelFollowups(lead_id)` zera todos os pendentes.

> ⚠️ **Débito Onda 2:** Scheduler é in-process `setInterval`. Se o container reiniciar no meio de um processamento, follow-ups podem ser executados em dobro ou perdidos. Ver AUDITORIA §1.3 TD-A5.

---

## 9. Integrações Externas (Meta + Google Ads)

```mermaid
graph TB
    subgraph Interno["Sistema Interno"]
        ADS_ROUTE[/api/ads/*/]
        ADS_OPT[ads-optimizer service]
        DB_LEADS[(leads.origem<br/>leads.valor_estimado)]
    end

    subgraph MetaIntegracao["Meta Ads API"]
        META_SDK[facebook-nodejs-business-sdk]
        META_CAMP[Campanhas Facebook/IG]
        META_INS[Insights: CPA, CTR, reach]
        META_LEAD[Lead Ads forms]
    end

    subgraph GoogleIntegracao["Google Ads API"]
        GOOGLE_SDK[google-ads-api]
        GOOGLE_CAMP[Campanhas Search/Display]
        GOOGLE_INS[Insights: conversões, impressões]
    end

    ADS_ROUTE --> META_SDK
    ADS_ROUTE --> GOOGLE_SDK
    META_SDK --> META_CAMP
    META_SDK --> META_INS
    META_SDK --> META_LEAD
    GOOGLE_SDK --> GOOGLE_CAMP
    GOOGLE_SDK --> GOOGLE_INS

    META_LEAD -.webhook ou polling.-> ADS_ROUTE
    ADS_ROUTE --> DB_LEADS

    ADS_OPT --> DB_LEADS
    ADS_OPT --> META_INS
    ADS_OPT --> GOOGLE_INS
    ADS_OPT -.sugere.-> META_CAMP
    ADS_OPT -.sugere.-> GOOGLE_CAMP
```

**Fluxo típico:**

1. Anúncio Meta/Google capta interesse → gera lead form submission.
2. Sistema (via polling ou webhook) importa o lead → INSERT em `leads` com `origem = 'meta_ads'` ou `'google_ads'`.
3. Carlos/Sofia assumem a conversa no WhatsApp (se capturou telefone) ou Instagram DM.
4. `ads-optimizer` cruza conversões fechadas × gasto de ads → sugere ajustes (pausa criativo, sobe budget, etc.)

> ⚠️ **Débito:** Não está claro se o webhook Lead Ads está configurado e protegido. Ver AUDITORIA §2.3 LGPD-03 (consentimento importado) e §1.4 SEC-12 (autenticação da ingestão).

---

## 10. Dashboard e API de Gestão

```mermaid
graph LR
    subgraph Browser["Browser do usuário"]
        HTML[public/index.html<br/>dashboard único]
        JS[JS inline<br/>event delegation]
    end

    subgraph Routes["Rotas Express"]
        DASH[GET /<br/>dashboard.js]
        API_STATS[GET /api/stats]
        API_LEADS[GET /api/leads]
        API_SEND[POST /api/send]
        API_TRANSFER[POST /api/transferir]
        API_PROSPECTAR[POST /api/prospectar]
        API_SUP[/api/supervisor/*/]
        API_ADS[/api/ads/*/]
        API_METRIC[GET /api/metricas/*]
        API_DIAG[GET /api/diagnose]
    end

    subgraph Servicos["Services"]
        SUP_SVC[supervisor.js]
        ADS_SVC[ads-optimizer.js]
        EMAIL_SVC[email-sender.js]
    end

    HTML -->|fetch| API_STATS
    HTML -->|fetch| API_LEADS
    HTML -->|fetch| API_METRIC
    HTML -->|POST| API_SEND
    HTML -->|POST| API_TRANSFER
    HTML -->|POST| API_PROSPECTAR
    HTML -->|fetch| API_SUP
    HTML -->|fetch| API_ADS
    JS -->|onclick delegate| API_DIAG

    API_STATS --> DB[(SQLite)]
    API_LEADS --> DB
    API_SEND --> ORCH[Orchestrator]
    API_TRANSFER --> ORCH
    API_PROSPECTAR --> ORCH
    API_SUP --> SUP_SVC
    API_ADS --> ADS_SVC
    API_METRIC --> DB
    API_DIAG --> DB
```

**Endpoints do dashboard agrupados:**

| Grupo           | Endpoints                                                                         | Uso                                   |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------- |
| Estatísticas    | `/api/stats`, `/api/metricas/*`, `/api/metricas/agentes`, `/api/metricas/historico` | KPIs, gráficos                        |
| Leads           | `/api/leads`, `/api/leads/:id`, `/api/leads/:id/conversas`                        | Lista, filtro, histórico              |
| Ação manual     | `/api/send`, `/api/transferir`, `/api/prospectar`                                 | Supervisor interfere no funil         |
| Supervisor IA   | `/api/supervisor/auditar`, `/api/supervisor/treinar`, `/api/supervisor/prompts`   | Diana audita, ajusta prompts          |
| Ads             | `/api/ads/meta`, `/api/ads/google`, `/api/ads/otimizar`                           | Integração Meta/Google                |
| Diagnóstico     | `/api/diagnose` (novo, só local)                                                   | Status da integração                  |

> 🔴 **Crítico:** Todos esses endpoints estão públicos. Ver AUDITORIA §1.4 SEC-03.

---

## 11. Fluxo Fim-a-Fim (Sequence Diagram)

Exemplo: Dono de ISP vê anúncio do Consulta ISP, manda mensagem no WhatsApp. Carlos (SDR) qualifica (pergunta porte, ERP, inadimplência atual), sobe score e faz handoff pro Lucas (AE) que vai marcar demo do produto.

```mermaid
sequenceDiagram
    autonumber
    actor LEAD as Lead (WhatsApp)
    participant ZAPI
    participant HOOK as /webhook/zapi
    participant ORCH as Orchestrator
    participant DB as SQLite
    participant CLAUDE as Claude API
    participant FU as Follow-up
    participant AB as A/B Testing

    LEAD->>ZAPI: "Oi, vi o anúncio do Consulta ISP, como funciona?"
    ZAPI->>HOOK: POST phone, text, messageId
    HOOK->>HOOK: Valida payload
    HOOK->>ORCH: processIncoming(phone, message)

    ORCH->>DB: SELECT leads WHERE telefone=?
    DB-->>ORCH: (nenhum)
    ORCH->>DB: INSERT leads (novo, agente=carlos)
    ORCH->>DB: INSERT log (lead_criado)

    ORCH->>DB: INSERT conversas (direcao=recebida)
    ORCH->>FU: cancelFollowups(lead.id)
    ORCH->>AB: check last sent (nenhum ainda)

    ORCH->>DB: SELECT last 10 conversas
    DB-->>ORCH: []
    ORCH->>CLAUDE: analyzeAndDecide(carlos, msg, lead)

    CLAUDE->>CLAUDE: aplica prompt carlos + histórico
    CLAUDE-->>ORCH: resposta="Oi! Que bom que chamou.<br/>Qual seu ISP e quantos clientes vocês têm?",<br/>score_update +30,<br/>dados_extraidos: {nome_decisor, interesse},<br/>acao=qualificar

    ORCH->>DB: UPDATE leads (dados_extraidos, score 30)
    ORCH->>DB: SELECT lead (reload)
    Note over ORCH: score 30 < 61, sem handoff

    ORCH->>DB: INSERT conversas (direcao=enviada)
    ORCH->>DB: INSERT log (resposta_enviada)
    ORCH->>ZAPI: sendText(phone, resposta)
    ZAPI-->>ORCH: 200 messageId
    ORCH-->>HOOK: (lead_id, agente=carlos, acao=qualificar)
    HOOK-->>ZAPI: 200 processed

    Note over LEAD,ZAPI: ⏱ alguns minutos depois

    LEAD->>ZAPI: "Meu ISP chama NetConnect Fibra, 800 assinantes, usamos SGP, tô com uns 9% de inadimplência"
    ZAPI->>HOOK: POST
    HOOK->>ORCH: processIncoming

    ORCH->>DB: SELECT lead (já existe)
    ORCH->>DB: INSERT conversas (recebida)
    ORCH->>FU: cancelFollowups
    ORCH->>CLAUDE: analyzeAndDecide com histórico de 2 msgs

    CLAUDE-->>ORCH: resposta="Perfeito, SGP tem integração nativa<br/>com o Consulta ISP. Com 800 clientes e 9%<br/>de inadimplência, dá pra reduzir ~40%.<br/>Posso agendar uma demo com o Lucas?",<br/>score_update +40,<br/>dados_extraidos: {provedor: NetConnect Fibra, num_clientes: 800, erp: SGP, inadimplencia_pct: 9}

    ORCH->>DB: UPDATE leads (score total=70)
    ORCH->>DB: SELECT lead
    Note over ORCH: score 70 >= 61 → HANDOFF

    ORCH->>ORCH: transferLead(carlos → lucas)
    ORCH->>DB: INSERT handoffs
    ORCH->>DB: UPDATE leads SET agente_atual=lucas, etapa=apresentacao
    ORCH->>DB: INSERT log (handoff)

    ORCH->>DB: INSERT conversas (direcao=enviada, agente=carlos)
    ORCH->>ZAPI: sendText(phone, resposta do Carlos)
    ZAPI-->>ORCH: 200

    Note over ORCH,CLAUDE: Próxima msg do lead já será processada pelo Lucas
```

**Pontos de extensão/configuração durante o fluxo:**

- **Passo 8 (Claude)** — prompt do agente é carregado de `agentes_config.prompt_sistema`, mais override de `prompts_versao` se ativo.
- **Passo 18 (Z-API)** — se A/B test estiver rodando pra esse contexto, `abTesting.getVariant` escolhe variante A ou B e grava em `metadata`.
- **Passo 24 (Handoff)** — `transferLead` também resetaria follow-ups pendentes e pode mandar notificação interna.

---

## 12. Pontos Críticos de Atenção para o Fluxo

| # | Risco / Débito                             | Impacto no fluxo                                                          | Referência                    |
| - | ------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------- |
| 1 | Webhook sem HMAC/Auth                      | Qualquer um injeta leads falsos ou executa envio manual                   | AUDITORIA §1.4 SEC-01         |
| 2 | API sem auth                               | Dashboard exposta sem login; dados de PII vazam em `/api/leads`           | AUDITORIA §1.4 SEC-03         |
| 3 | Token Z-API na URL                         | Aparece em logs nginx/Caddy/Morgan                                        | AUDITORIA §1.4 SEC-05         |
| 4 | Race condition no INSERT leads             | Mesmo telefone em duas webhooks simultâneas pode duplicar                 | AUDITORIA §1.1 C7             |
| 5 | Sem rate limit outbound                    | Risco de WhatsApp banir número se disparar em massa                       | AUDITORIA §2.1 R1             |
| 6 | Sem opt-out (STOP)                         | LGPD + Meta Business Policy violados                                       | AUDITORIA §2.3 LGPD-07, WA-02 |
| 7 | Scheduler in-process                       | Restart do container perde/duplica follow-ups                             | AUDITORIA §1.3 TD-A5          |
| 8 | Nginx + Caddy conflito na :80 (deploy)     | Dashboard inacessível externamente hoje                                   | RECUPERACAO-DASHBOARD §Etapa A|
| 9 | Sem backup automatizado do SQLite          | Perda total se VPS tiver falha de disco                                   | AUDITORIA §2.1 R2             |
| 10| A/B test contabiliza envio antes do ack    | Métricas infladas se envio falhar                                         | AUDITORIA §1.1 F3             |

---

## Legenda de cores

- 🟢 / ✅ = Implementado e funcional
- 🟡 / ⚠️ = Implementado mas com débito conhecido
- 🔴 = Bloqueador crítico — tratar em Onda 0 ou Onda 1
- ⬛ = Não implementado, planejado

---

## Próximos passos relacionados à topologia

1. **Onda 0 (esta semana)** — resolver conflito nginx×Caddy, dashboard online, deploy files no GitHub (ver PROMPT-CLAUDE-CODE.md).
2. **Onda 1 (2 semanas)** — HMAC webhook, auth API, rate limit, opt-out, LGPD notice (ver AUDITORIA-COMPLETA §Plano de Ação).
3. **Onda 2 (1 mês)** — observabilidade estruturada, APM, tracing de request → CLAUDE → resposta.
4. **Onda 3 (2 meses)** — migrar scheduler pra BullMQ + Redis (persistente, distribuído).
5. **Onda 4 (3 meses)** — filas de mensageria pra outbound (resiliente, dispara em batch controlado).

---

**FIM da Topologia.** Para detalhes de cada risco/débito citado, consultar `AUDITORIA-COMPLETA.md`. Para instruções de execução do Claude Code, consultar `PROMPT-CLAUDE-CODE-ONDA0.md`.
