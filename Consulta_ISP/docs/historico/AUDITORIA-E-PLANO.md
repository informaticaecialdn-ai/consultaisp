# Auditoria do Sistema Consulta ISP + Plano de Reorganização + Arquitetura WhatsApp Marketing

Data da auditoria: 16/04/2026
Auditor: Claude (Cowork)
Alvo: `C:\ClaudeCode\Consulta_ISP` + deploy em `187.127.7.168:3080`

---

## 1. SUMÁRIO EXECUTIVO

O Consulta ISP tem um sistema de agentes IA razoavelmente maduro (backend Node.js/Express + SQLite, 7 agentes, integração Z-API, Meta Ads, Google Ads, dashboard), mas apresenta **três problemas estruturais** que estão causando a sensação de desorganização:

1. **Pasta raiz poluída com artefatos de desenvolvimento** — 7 arquivos `PROMPT-*.md` de 9k a 60k linhas cada, 3 JSONs de agentes soltos, 2 HTMLs de documentação, skills duplicadas em raiz e em `agentes-sistema/skills-ref/`. Isso confunde qual é a fonte-da-verdade.
2. **Divergência entre código local e deploy** — o screenshot do dashboard em produção mostra comentários HTML renderizando como texto (`<\!-- TOPBAR -->`), mas o arquivo local não tem esse bug. Significa que o que está no VPS (`187.127.7.168:3080`) é uma versão antiga ou com corrupção de build. Não há CI/CD nem versionamento claro do que está em produção.
3. **Não existe um sistema de WhatsApp Marketing propriamente dito** — a tabela `campanhas` existe mas só tem CRUD básico. Disparo em massa, sequências de nurturing, segmentação de audiência, opt-out/consentimento, templates HSM, janela de 24h do WhatsApp — nada disso está implementado. O que existe hoje é apenas prospecção 1:1 via `/api/prospectar`.

A boa notícia: a **fundação é sólida**. O orquestrador de conversas, o lead scoring automático, os handoffs entre agentes, o A/B testing e o sistema de treinamento reflexivo estão bem desenhados. Dá para construir o WhatsApp Marketing em cima do que já existe sem refazer nada.

---

## 2. INVENTÁRIO DO QUE EXISTE HOJE

### 2.1 Estrutura de diretórios

```
C:\ClaudeCode\Consulta_ISP\
├── [RAIZ — 14 arquivos soltos, maior parte deveria estar em /docs ou /archive]
│   ├── 7× PROMPT-*.md            ← docs de iterações de desenvolvimento, 200k+ linhas
│   ├── agentes-config.json       ← definição dos 5 agentes de vendas (Sofia, Leo, Carlos, Lucas, Rafael)
│   ├── agente-diana-supervisora.json
│   ├── agente-marcos-midia-paga.json
│   ├── FLUXO-SISTEMA-COMPLETO.html (55k)
│   ├── ecossistema-vendas.html (13k)
│   ├── skills-conhecimento-marcos-leo.md    ← DUPLICATA de agentes-sistema/skills-ref/
│   ├── skills-conhecimento-vendas-sofia.md  ← DUPLICATA
│   ├── .env                       ← credenciais Supabase/Google Maps (plataforma ISP)
│   └── marketingskills-ref/       ← pasta vazia, só tem .git/
│
├── dist/                          ← build antigo do frontend-ISP (favicon, erp-logos)
├── node_modules/                  ← node_modules na raiz sem package.json → ÓRFÃO
│
└── agentes-sistema/               ← AQUI está o código real e ativo
    ├── .env                       ← credenciais Anthropic, Z-API, Meta, Google Ads (DIFERENTE da raiz)
    ├── Dockerfile + docker-compose.yml + Caddyfile
    ├── package.json (consulta-isp-agentes v1.0.0)
    ├── data/                      ← SQLite (banco operacional)
    ├── public/
    │   ├── index.html (753 linhas, dashboard single-page)
    │   ├── css/ + js/
    ├── skills-ref/                ← 6 arquivos de skills (versão oficial)
    ├── src/
    │   ├── server.js (49 linhas — porta 3001)
    │   ├── models/database.js (240 linhas — 12 tabelas SQLite)
    │   ├── routes/
    │   │   ├── api.js (532 linhas — 40+ endpoints)
    │   │   ├── ads.js (275 — Meta + Google Ads)
    │   │   ├── webhook.js (136 — Z-API + Instagram)
    │   │   ├── supervisor.js (99 — Diana/orquestração)
    │   │   └── dashboard.js (9)
    │   ├── services/ (14 arquivos, 3.200+ linhas)
    │   │   ├── claude.js (322 — integração Anthropic)
    │   │   ├── orchestrator.js (282 — lógica principal)
    │   │   ├── zapi.js (131 — WhatsApp)
    │   │   ├── meta-ads.js (369), google-ads.js (453), ads-optimizer.js (430)
    │   │   ├── supervisor.js (321 — Diana)
    │   │   ├── training.js (261 — aprendizado reflexivo)
    │   │   ├── followup.js (116), ab-testing.js (136)
    │   │   ├── skills-knowledge.js (168), pdf-report.js (130)
    │   │   ├── instagram.js (55), email-sender.js (51)
    │   └── tests/ (2 arquivos — e2e + integração)
```

### 2.2 Os 7 agentes IA

| Agente | Função | Modelo | Status |
|---|---|---|---|
| **Sofia** | Marketing estratégico, campanhas, Instagram | claude-sonnet-4-6 | Config OK |
| **Leo** | Copywriter (WhatsApp, email, landing, anúncios) | claude-opus-4-6 | Config OK |
| **Carlos** | Pré-vendas SDR/BDR/LDR, qualificação + lead scoring | claude-sonnet-4-6 | Config OK |
| **Lucas** | Vendas consultivas, demos, propostas | claude-opus-4-6 | Config OK |
| **Rafael** | Closer, fechamento de contratos, onboarding | claude-opus-4-6 | Config OK |
| **Marcos** | Mídia Paga (Meta + Google Ads) | claude-opus-4-6 | Config OK |
| **Diana** | Supervisora/orquestradora dos outros agentes | claude-opus-4-6 | Config OK |

Fluxo de funil implementado: Sofia → Leo (conteúdo) → Carlos (SDR) → Lucas (vendas) → Rafael (closer). Fluxo reverso: score baixo volta para Sofia (nurturing). Handoffs automáticos por score (≥61 → Lucas, ≥81 → Rafael, <31 → Sofia).

### 2.3 Banco de dados (SQLite — 12 tabelas)

`leads` · `conversas` · `atividades_agentes` · `sessoes_agentes` · `tarefas` · `metricas_diarias` · `handoffs` · `campanhas` · `treinamento_agentes` · `avaliacoes` · `followups` · `ab_tests`

Schema bem desenhado, com índices nos campos mais consultados, migração segura via `ALTER TABLE ... catch`. Pronto para escalar.

### 2.4 Capacidades já implementadas

- **Z-API**: sendText, sendImage, sendDocument, sendButtons, checkNumber, setWebhook, formatPhone (55-prefix Brasil)
- **Webhook**: recebe mensagens + status de entrega (delivered/read) + Instagram DM
- **Orquestrador**: ingestão, roteamento por agente, handoff automático por score, tracking de A/B, multi-canal (WhatsApp/Instagram/Email com fallback)
- **Follow-up scheduler**: roda a cada 5 min, cancela se lead responde
- **A/B testing**: com registro de envios/respostas e decisão de vencedor
- **Treinamento reflexivo**: avalia qualidade das respostas dos agentes, extrai aprendizados de conversas bem-sucedidas
- **Ads**: Meta + Google Ads com otimizações automáticas (pausar low performers, escalar winners)
- **PDF reports**: relatório de performance em PDF
- **Dashboard**: single-page com 10+ páginas (Dashboard, Pipeline, Leads, Conversas, Monitor, Prospectar, Conteúdo, Tarefas, Relatórios, Funil, páginas por agente)

### 2.5 O que NÃO existe (gap principal para WhatsApp Marketing)

- ❌ Disparo em massa com controle de fila e rate-limit
- ❌ Sequências/jornadas de nurturing (timers, branching por resposta, exit conditions)
- ❌ Segmentação de audiência / listas dinâmicas
- ❌ Templates HSM aprovados (necessários para iniciar fora da janela 24h)
- ❌ Opt-in/opt-out e controle de consentimento (LGPD)
- ❌ Respeito à janela de 24h do WhatsApp
- ❌ Personalização de mensagem com variáveis (`{{nome}}`, `{{cidade}}`, etc.)
- ❌ Agendamento de campanhas (hora, dia, fuso)
- ❌ Métricas específicas de broadcast (taxa de entrega, bloqueios, deslistados)

---

## 3. PROBLEMAS IDENTIFICADOS (AUDIT FINDINGS)

### 3.1 Problemas críticos (🔴 P0)

**P0.1 — Versão deployada (VPS) diverge do código local.**
O dashboard em `187.127.7.168:3080` mostra comentários HTML vazando como texto. O arquivo local não tem esse bug. Causa provável: build/deploy antigo no servidor, ou arquivo corrompido durante transferência. Sem pipeline de CI/CD você não tem garantia do que está em produção.

**P0.2 — Dois arquivos `.env` com credenciais diferentes.**
`/Consulta_ISP/.env` (Supabase + Google Maps — plataforma ISP principal) e `/Consulta_ISP/agentes-sistema/.env` (Anthropic + Z-API + Meta/Google Ads — sistema de agentes). Não há documentação dizendo qual serve o quê. Risco de rotar uma chave errada ou commitar no git por acidente.

**P0.3 — Sem compliance LGPD/WhatsApp.**
Nenhum sistema de opt-out. Nenhum log de consentimento. Para fazer WhatsApp Marketing em escala isso é risco legal e também risco de ban da instância Z-API.

### 3.2 Problemas sérios (🟠 P1)

**P1.1 — Raiz poluída com 14 arquivos de documentação/iteração.**
7× `PROMPT-*.md` (200k+ linhas de histórico de prompts para build iterativo). Esses arquivos são lixo de desenvolvimento que deveriam estar em `/archive/prompts/`.

**P1.2 — Arquivos duplicados.**
`skills-conhecimento-marcos-leo.md` e `skills-conhecimento-vendas-sofia.md` existem idênticos em raiz E em `agentes-sistema/skills-ref/`. Qual é o canônico? O código lê de `skills-ref/` (via Dockerfile volume), então o da raiz é lixo.

**P1.3 — `node_modules/` órfão na raiz.**
Sem `package.json` correspondente. Resíduo de tentativa anterior de build. 300+ MB descartável.

**P1.4 — Pasta `marketingskills-ref/` vazia.**
Só tem `.git/`. Branch abandonado ou merge incompleto.

**P1.5 — Pasta `dist/`.**
Contém `favicon.png`, `erp-logos/` e um `index.html` minúsculo (1k). Parece ser build de outro projeto (a plataforma Consulta ISP principal, que é ERP de provedor). Confunde porque o nome do sistema atual é igual.

**P1.6 — `agentes-config.json` vs `agente-diana-*.json` vs `agente-marcos-*.json`.**
Os 5 agentes de vendas estão em um arquivo, mas Diana e Marcos em arquivos separados. Inconsistência. Deveriam ser um só, ou um por agente, mas não misto.

### 3.3 Problemas médios (🟡 P2)

**P2.1 — System prompts duplicados em 3 lugares.**
Os prompts dos agentes estão em `agentes-config.json` + em `skills-ref/*.md` + codificados via `claude.js._getSystemPrompt()`. Quando muda um, é fácil esquecer de atualizar os outros.

**P2.2 — Dashboard é 1 arquivo HTML de 753 linhas.**
CSS, HTML e JS tudo junto. Difícil manter. Sem build step, sem modularização, sem tipagem.

**P2.3 — Testes existem mas são 2 arquivos isolados.**
Sem test runner, sem coverage, sem CI. Rodar é manual (`node tests/test-e2e-mocked.js`).

**P2.4 — Scheduler roda no processo Node principal.**
`setInterval` dentro do `server.js`. Se o servidor cair, os follow-ups param. Para escalar, precisa fila externa (BullMQ + Redis, ou similar).

**P2.5 — Sem logging estruturado.**
`console.log` por todo lado. Não tem níveis, não tem correlation ID, não tem rotação (só o Docker cuida disso).

**P2.6 — Sem monitoramento de custo de tokens.**
Os agentes rodam em Claude Opus (caro). Não tem alerta se o consumo disparar.

### 3.4 Observações construtivas

- O design dos agentes (system prompts, lead scoring, fluxo de handoff) está **muito bem feito** para um sistema desse porte.
- A tabela `treinamento_agentes` e o `training.js` implementam aprendizado reflexivo — isso é raro ver em sistemas em produção.
- A escolha de SQLite com WAL é adequada para esse volume.
- O uso de better-sqlite3 (síncrono) é correto para Node.js single-threaded neste caso.

---

## 4. PLANO DE REORGANIZAÇÃO (antes de qualquer build novo)

### 4.1 Limpeza da raiz (30 min)

Estrutura alvo:

```
C:\ClaudeCode\Consulta_ISP\
├── README.md                              ← NOVO: visão geral + como rodar
├── .gitignore
├── agentes-sistema/                       ← o código fica aqui (só mudança: ficará único)
├── docs/                                  ← NOVO
│   ├── prompts-historicos/                ← mover os 7 PROMPT-*.md pra cá
│   ├── fluxo-sistema-completo.html
│   ├── ecossistema-vendas.html
│   └── agentes/                           ← JSONs de agentes (se quiser manter como referência)
│       ├── agentes-config.json
│       ├── agente-diana.json
│       └── agente-marcos.json
└── archive/                               ← NOVO (ou deletar)
    ├── dist-antigo/                       ← mover dist/ pra cá
    └── marketingskills-ref/               ← mover pra cá ou deletar
```

Ações:
1. Criar `docs/` e mover todos os `PROMPT-*.md`, `*.html` e JSONs de agentes.
2. Deletar `node_modules/` da raiz (é órfão).
3. Deletar ou arquivar `dist/` e `marketingskills-ref/`.
4. Deletar `skills-conhecimento-marcos-leo.md` e `skills-conhecimento-vendas-sofia.md` da raiz (o canônico está em `agentes-sistema/skills-ref/`).
5. Criar `README.md` explicando: o que é o sistema, qual é a pasta ativa (`agentes-sistema/`), como rodar, como deployar.
6. Consolidar os 2 `.env` com comentários claros sobre quem usa qual.

### 4.2 Higiene de agentes (1h)

- Consolidar os 7 agentes em um único `agentes-sistema/config/agents.json` (ou um arquivo por agente em `agentes-sistema/config/agents/`).
- Garantir que o `claude.js` leia desse arquivo único (hoje está codificado em JavaScript).
- Remover duplicação de system prompt entre `agentes-config.json`, `skills-ref/*.md` e `claude.js`.

### 4.3 Correção do deploy (1-2h)

- SSH no VPS `187.127.7.168` e verificar qual `index.html` está sendo servido.
- Rebuildar a imagem Docker com o código atualizado (`docker compose up -d --build`).
- Definir uma regra: **nunca edite em produção**. Commit → push → pull no VPS → rebuild.
- Idealmente, adicionar GitHub Actions para deploy automático (nice to have, não crítico agora).

### 4.4 Compliance mínima (2h)

- Adicionar tabela `consentimento` no SQLite (telefone, canal, origem_opt_in, data_opt_in, data_opt_out, status).
- Adicionar endpoint `/api/optout/:telefone` e handler que detecta palavras-chave ("SAIR", "PARAR", "CANCELAR") no webhook.
- Nenhum broadcast pode ser enviado sem consentimento ativo registrado.

### 4.5 Validação após limpeza

Antes de começar o WhatsApp Marketing:
- [ ] Rodar `npm start` localmente e confirmar que o dashboard abre sem o bug dos comentários.
- [ ] Enviar 1 mensagem de teste via Z-API pelo endpoint `/api/send`.
- [ ] Confirmar que o webhook Z-API está conectado (`/api/setup-webhook`).
- [ ] Validar que os 7 agentes respondem (endpoint `/api/supervisor/run`).

---

## 5. ARQUITETURA PROPOSTA: WhatsApp Marketing

### 5.1 Requisitos (do que você respondeu)

1. Integração com CRM existente (tabelas `leads`, `conversas` do Consulta ISP Agentes)
2. Nurturing / sequências automatizadas
3. Agentes IA conversacionais (já existem — reaproveitar)
4. Disparos em massa
5. Provedor: Z-API (já integrado)

### 5.2 Princípios de design

- **Não refaça, estenda.** O orquestrador e os agentes já funcionam. O novo módulo só adiciona: fila de envio em massa, motor de jornadas, segmentação, compliance.
- **Fila desacoplada.** Disparos em massa vão para uma fila SQLite (simples) ou Redis/BullMQ (escalável). Nunca disparar em loop no processo principal.
- **Janela 24h do WhatsApp.** Antes de enviar, verificar se o lead respondeu nas últimas 24h. Se sim: mensagem livre. Se não: só HSM template (requer aprovação Meta).
- **Consentimento é gate.** Nenhum envio em massa sem consentimento ativo.
- **Rate limit defensivo.** Z-API permite ~60 msg/min por instância, mas para evitar ban do WhatsApp, mantenha ≤ 20/min com jitter aleatório 3-8s entre envios.

### 5.3 Componentes novos (o que construir)

```
agentes-sistema/src/
├── services/
│   ├── whatsapp-marketing/        ← NOVO módulo
│   │   ├── broadcast.js           ← motor de disparo em massa
│   │   ├── journey-engine.js      ← motor de sequências (nurturing)
│   │   ├── segmentation.js        ← filtros dinâmicos de leads
│   │   ├── template-engine.js     ← renderização de variáveis ({{nome}}, {{cidade}})
│   │   ├── consent-manager.js     ← opt-in/opt-out, LGPD
│   │   ├── rate-limiter.js        ← fila com rate-limit
│   │   └── window-checker.js      ← janela 24h WhatsApp
│   └── zapi.js                    ← ESTENDER: sendTemplate (HSM), sendList, sendPoll
├── routes/
│   └── marketing.js               ← NOVO: /api/marketing/*
└── jobs/                          ← NOVO diretório
    ├── broadcast-worker.js        ← worker de disparo (consome fila)
    └── journey-tick.js            ← avança leads em jornadas (a cada 1 min)
```

### 5.4 Novas tabelas no banco

```sql
-- Listas/segmentos de leads
CREATE TABLE audiencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT,
  tipo TEXT, -- 'estatica' | 'dinamica'
  filtro_json TEXT, -- para dinamica: { "regiao": "Sul", "score_min": 60 }
  total_leads INTEGER DEFAULT 0,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audiencia_leads (
  audiencia_id INTEGER,
  lead_id INTEGER,
  PRIMARY KEY (audiencia_id, lead_id)
);

-- Templates de mensagem (WhatsApp HSM + livre)
CREATE TABLE templates_mensagem (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT, -- 'marketing' | 'utility' | 'authentication'
  idioma TEXT DEFAULT 'pt_BR',
  corpo TEXT NOT NULL, -- com variáveis {{nome}} etc.
  tipo TEXT DEFAULT 'texto', -- 'texto' | 'imagem' | 'documento' | 'botoes'
  midia_url TEXT,
  botoes_json TEXT,
  aprovado_hsm INTEGER DEFAULT 0, -- 1 se aprovado no Meta
  hsm_name TEXT, -- nome registrado no Meta
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Campanhas de broadcast (expandir tabela existente)
ALTER TABLE campanhas ADD COLUMN audiencia_id INTEGER;
ALTER TABLE campanhas ADD COLUMN template_id INTEGER;
ALTER TABLE campanhas ADD COLUMN agendado_para DATETIME;
ALTER TABLE campanhas ADD COLUMN rate_limit_min INTEGER DEFAULT 20;
ALTER TABLE campanhas ADD COLUMN janela_respeitar INTEGER DEFAULT 1;
ALTER TABLE campanhas ADD COLUMN consentimento_obrigatorio INTEGER DEFAULT 1;

-- Fila de envios (uma linha por lead por campanha)
CREATE TABLE campanha_envios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campanha_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  telefone TEXT NOT NULL,
  mensagem_renderizada TEXT,
  status TEXT DEFAULT 'pendente', -- pendente|enviando|enviado|falhou|respondido|bloqueado|optout
  tentativas INTEGER DEFAULT 0,
  agendado_para DATETIME,
  enviado_em DATETIME,
  entregue_em DATETIME,
  lido_em DATETIME,
  respondido_em DATETIME,
  erro TEXT,
  metadata_json TEXT
);

CREATE INDEX idx_envios_status ON campanha_envios(status, agendado_para);
CREATE INDEX idx_envios_campanha ON campanha_envios(campanha_id);

-- Jornadas (sequências de nurturing)
CREATE TABLE jornadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT,
  trigger_tipo TEXT, -- 'manual' | 'score_range' | 'etapa_funil' | 'tag' | 'sem_resposta_dias'
  trigger_config TEXT, -- JSON
  ativa INTEGER DEFAULT 1,
  total_leads INTEGER DEFAULT 0,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE jornada_passos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jornada_id INTEGER NOT NULL,
  ordem INTEGER NOT NULL,
  nome TEXT,
  tipo TEXT, -- 'enviar_msg' | 'esperar' | 'condicao' | 'handoff_agente' | 'atualizar_lead' | 'sair'
  config_json TEXT, -- { template_id, delay_horas, condicao, agente_destino, etc. }
  proximo_passo_sim INTEGER, -- id do próximo passo se condição = verdade
  proximo_passo_nao INTEGER  -- id do próximo passo se condição = falso
);

CREATE TABLE jornada_execucoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jornada_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  passo_atual INTEGER,
  status TEXT DEFAULT 'ativa', -- ativa|pausada|concluida|saiu|erro
  dados_contexto TEXT, -- JSON, estado do lead ao entrar
  proxima_execucao DATETIME,
  iniciado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  concluido_em DATETIME
);

CREATE INDEX idx_execucoes_proxima ON jornada_execucoes(status, proxima_execucao);

-- Consentimento (LGPD + WhatsApp)
CREATE TABLE consentimento (
  telefone TEXT PRIMARY KEY,
  status TEXT DEFAULT 'ativo', -- ativo|optout|bloqueado
  origem_opt_in TEXT, -- 'formulario_site' | 'webinar' | 'indicacao' | 'outbound_bdr' etc.
  data_opt_in DATETIME DEFAULT CURRENT_TIMESTAMP,
  data_opt_out DATETIME,
  motivo_opt_out TEXT,
  observacao TEXT
);
```

### 5.5 Fluxo: Disparo em Massa

```
1. USER cria campanha via dashboard:
   - Seleciona audiência (ex: "ISPs da regiao Sul com score 30-60")
   - Seleciona template ("Convite para webinar inadimplência")
   - Agenda para quinta-feira 14h
   - Configura rate-limit: 20 msg/min

2. Sistema RESOLVE a audiência (query dinâmica nos leads)
   → cria N linhas em campanha_envios (status=pendente, agendado_para=agora+jitter)

3. USER aprova o preview (primeiras 5 mensagens renderizadas)

4. Na hora agendada, broadcast-worker começa:
   LOOP (a cada 3-8s aleatório):
     - Pega próximo envio pendente da campanha ativa
     - VERIFICA consentimento (tabela consentimento.status = 'ativo')
     - VERIFICA janela 24h (última msg recebida do lead < 24h OU template é HSM)
     - Renderiza template com variáveis do lead
     - Chama zapi.sendText() ou zapi.sendTemplate()
     - Atualiza status=enviado
   FIM

5. Webhook atualiza status quando:
   - entregue (status-update do Z-API)
   - lido (read receipt)
   - respondido (webhook normal de mensagem recebida)
   → respostas ATIVAM o orquestrador existente (Carlos assume a conversa)

6. Se lead responder "SAIR":
   - consent-manager registra optout
   - cancela todos os envios pendentes para esse telefone em qualquer campanha
```

### 5.6 Fluxo: Jornada de Nurturing

Exemplo: "Nurturing de lead frio (score < 30)"

```
Passo 1 [esperar] 0h         → imediato
Passo 2 [enviar_msg]         → template "Obrigado pelo interesse"
Passo 3 [esperar] 48h
Passo 4 [enviar_msg]         → template "Case de sucesso ISP SC"
Passo 5 [esperar] 5 dias
Passo 6 [condicao]           → lead.score >= 30?
         SIM → Passo 7       → handoff para Carlos (SDR)
         NAO → Passo 8       → enviar convite webinar
Passo 8 [esperar] 7 dias
Passo 9 [condicao]           → lead respondeu alguma msg?
         SIM → sair, devolver ao orquestrador
         NAO → Passo 10
Passo 10 [atualizar_lead]    → classificacao = "frio_dormente"
Passo 11 [sair]
```

O `journey-tick.js` roda a cada 1 min, busca `jornada_execucoes.proxima_execucao <= NOW() AND status='ativa'`, executa o passo, calcula o próximo.

### 5.7 Segurança / anti-ban do WhatsApp

- **Aquecimento da instância**: nos primeiros 30 dias de uma nova instância Z-API, limite a 50 msg/dia. Subir gradualmente.
- **Nunca** disparar mesma mensagem >100 vezes/dia sem variação (Z-API avisa, WhatsApp banota).
- **Sempre** rotacionar 3-5 variações de copy (o Leo pode gerar).
- **Horários**: só dispare 8h-20h no fuso do destinatário. Nunca madrugada.
- **Hygiene**: Z-API tem endpoint `/phone-exists` — verificar se número é WhatsApp antes de enfileirar.
- **Observar signals de ban**: taxa de entregues < 80% em 24h = parar instância e investigar.

### 5.8 Dashboard: novas telas

- `/marketing/audiencias` — CRUD de audiências + preview de tamanho
- `/marketing/templates` — CRUD de templates + variáveis suportadas + status HSM
- `/marketing/campanhas` — lista + criar wizard (audiência → template → agendar → preview → lançar)
- `/marketing/campanhas/:id` — métricas ao vivo (enviados/entregues/lidos/respondidos/optout + gráfico de funil)
- `/marketing/jornadas` — editor visual (mesmo que simples: lista de passos)
- `/marketing/consentimento` — ver opt-outs, reativar manualmente se necessário

---

## 6. ROADMAP DE IMPLEMENTAÇÃO (fases)

### Fase 0 — Reorganização (estimativa: 4-6h)
- Limpeza da raiz, consolidar configs, corrigir deploy, criar README.
- **Não é opcional** — sem isso, você vai seguir apagando incêndio.

### Fase 1 — Compliance + Foundation (8-12h)
- Tabela `consentimento`, endpoint opt-out, palavras-chave no webhook.
- Estender `zapi.js` com `sendTemplate`/HSM e `checkWindow`.
- Criar `window-checker.js` e `consent-manager.js`.

### Fase 2 — Audiências + Templates (12-16h)
- Tabelas `audiencias`, `audiencia_leads`, `templates_mensagem`.
- Endpoints CRUD + preview de segmentação.
- Template engine com variáveis (`{{nome}}`, `{{cidade}}`, `{{provedor}}`).
- UI no dashboard (telas Audiências + Templates).

### Fase 3 — Broadcast Engine (16-20h)
- Tabela `campanha_envios`.
- `broadcast-worker.js` (worker Node separado ou cluster).
- Rate limiter com jitter.
- Endpoints de criar/lançar/pausar/retomar campanha.
- UI de wizard de campanha + tela de métricas ao vivo.

### Fase 4 — Journey Engine (20-30h)
- Tabelas `jornadas`, `jornada_passos`, `jornada_execucoes`.
- `journey-tick.js` + runner de cada tipo de passo.
- Editor de jornadas (mesmo que básico: lista com drag-drop).
- 3 jornadas pré-cadastradas (onboarding, nurturing frio, reativação 30 dias).

### Fase 5 — Integrações profundas + observabilidade (10-15h)
- Dashboard de custo de tokens Claude (hoje não tem).
- Logging estruturado (pino ou winston).
- Alertas: CPL > meta, campanha com entrega < 80%, saldo Z-API baixo.
- Backup automático do SQLite (cron + upload S3/GCS).

**Total estimado**: 70-100h de trabalho técnico. Pode ser reduzido para 40-50h se Fase 4 (jornadas) for mantida simples (linear, sem branches).

---

## 7. DECISÕES QUE VOCÊ PRECISA TOMAR ANTES DE COMEÇAR

1. **Onde roda tudo?** O VPS atual (`187.127.7.168`) é suficiente ou você quer migrar para um setup mais robusto (2 VPS, banco em managed DB, Redis para fila)?
2. **Banco: SQLite fica ou vai pra Postgres?** Para 10k leads, SQLite aguenta. Para 100k+, recomendo migrar. Sua plataforma principal já usa Supabase (.env da raiz), então existe Postgres rodando — faz sentido consolidar.
3. **Múltiplas instâncias Z-API?** Uma única instância aguenta ~3000-5000 msg/dia com segurança. Se planeja disparar mais, precisa de pool de instâncias com rotação.
4. **Templates HSM?** Disparos fora da janela 24h exigem templates aprovados pelo Meta. Você já tem conta Meta Business? Se sim, vamos aprovar 5-10 templates antes de começar.
5. **Integrações visuais?** Para o editor de jornadas: suficiente lista linear, ou quer grafo visual tipo ManyChat/ActiveCampaign?
6. **Quem opera?** O sistema vai ser usado só pelo Marketing/SDR ou pretende abrir para clientes (ISPs clientes usarem a plataforma para seus próprios marketings)? Muda tudo.

---

## 8. PRÓXIMOS PASSOS SUGERIDOS

Recomendo fortemente esta ordem:

1. **Agora**: você lê essa auditoria e me diz onde discorda, o que priorizar.
2. **Hoje ou amanhã**: executo a Fase 0 (limpeza + correção de deploy) — isso já destrava o desenvolvimento.
3. **Esta semana**: Fase 1 e 2 (compliance + templates/audiências).
4. **Próximas 2 semanas**: Fase 3 (broadcast engine funcionando).
5. **Mês 2**: Fase 4 (jornadas).

Antes de iniciar, preciso das suas respostas nas 6 decisões do item 7.
