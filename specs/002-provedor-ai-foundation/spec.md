# Feature Specification: Foundation Provedor.ai (Transição Evolutiva)

**Feature Branch**: `002-provedor-ai-foundation`
**Created**: 2026-05-11
**Status**: In Progress (parte do trabalho já executada nesta sessão)
**Input**: User description: "Evoluir o repositório Consulta ISP atual para Provedor.ai (Caminho B). Manter stack Drizzle + Express + Postgres direto. Adicionar estrutura para 10 funcionários digitais (hospedados na plataforma Anthropic), comunicações multi-canal, audit log imutável, prompts versionados. Consulta ISP vira módulo dentro do Provedor.ai."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Repositório Identificado Como Provedor.ai Sem Quebrar Consulta ISP (Priority: P1)

Um desenvolvedor (eu, Claude futuro, outro humano) abre o repo
`C:\ClaudeCode\` e em até 5 minutos entende que: (a) este é o Provedor.ai
agora, (b) Consulta ISP é um módulo interno, (c) o stack atual foi mantido
(Drizzle/Express/Postgres direto), (d) há estrutura preparada para
adicionar agentes, comunicações, audit log, prompts. Nenhuma feature
existente do Consulta ISP foi quebrada.

**Why this priority**: É a base de toda evolução. Sem essa transição
clara, qualquer trabalho futuro fica ambíguo (estou fazendo Consulta ISP
ou Provedor.ai?).

**Independent Test**: Clonar o repo do zero, rodar `npm install`,
`npm run check`, `npm run test`, `npm run dev`. Tudo passa. Ler
CLAUDE.md seção 1 — entendo que é Provedor.ai. Ler READMEs em `server/agents/`,
`server/communications/`, `server/audit/`, `server/prompts/`,
`server/modules/consulta-isp/` — entendo o que cada um vai conter.

**Acceptance Scenarios**:

1. **Given** repo em estado atual, **When** abrir `package.json`,
   **Then** o campo `name` é `"provedor-ai"` (não `"rest-express"` nem
   `"consulta-isp"`).
2. **Given** repo atual, **When** ler `CLAUDE.md` linhas 1-50, **Then**
   identidade do projeto é Provedor.ai com Consulta ISP como módulo
   interno; pivot 2026-05-11 mencionado explicitamente.
3. **Given** repo, **When** rodar `npm run check`, **Then** zero novos
   erros TypeScript (baseline preservado).
4. **Given** repo, **When** rodar `npm run dev`, **Then** servidor sobe
   normalmente; rotas atuais de Consulta ISP respondem.

---

### User Story 2 — Estrutura Pronta Para Receber Novos Módulos (Priority: P2)

Existem diretórios criados (`server/agents/`, `server/communications/`,
`server/audit/`, `server/prompts/`, `server/modules/consulta-isp/`) cada
um com README documentando seu propósito, convenções, e ponteiros para
o código que vai habitá-lo. Próxima spec já pode escrever código nesses
diretórios sem precisar criar estrutura.

**Why this priority**: Reduz fricção da próxima spec (WhatsApp + Júlia +
Helena). Sem diretórios + READMEs, a próxima spec gasta tempo em meta-
trabalho.

**Independent Test**: Listar `server/` — todas as pastas novas estão lá.
Abrir cada README — todos têm conteúdo claro (propósito + convenções +
referências aos docs do Ecossistema).

**Acceptance Scenarios**:

1. **Given** repo, **When** listar conteúdo de `server/agents/`,
   **Then** README.md existe descrevendo orquestrador stateless +
   integração Anthropic API + os 10 funcionários canônicos.
2. **Given** repo, **When** listar `server/audit/`, **Then** README.md
   existe descrevendo audit log imutável + schema mínimo + triggers
   Postgres requeridos.
3. **Given** repo, **When** listar `server/communications/`, **Then**
   subdiretórios `whatsapp/`, `sms/`, `email/` existem com README do
   pai explicando que toda outbound passa por Júlia antes.

---

### User Story 3 — Decisões Arquiteturais Documentadas Para Sessões Futuras (Priority: P3)

Memórias persistentes de Claude têm os contexts críticos: Caminho B
confirmado, agentes via Anthropic platform (não código TS de prompts em
runtime), stack atual mantido. Próxima sessão Claude (e qualquer dev
humano) entende as decisões sem precisar reler 150KB de docs.

**Why this priority**: Continuidade entre sessões. Sem isso, próxima vez
o Claude volta a propor Supabase/Prisma e re-discute decisões já tomadas.

**Independent Test**: Verificar `~/.claude/projects/C--ClaudeCode/memory/`
tem entradas para: pivot Provedor.ai, Caminho B confirmado, MCP follow-up,
default to my recommendation. Cada uma com contexto e why.

**Acceptance Scenarios**:

1. **Given** memória do projeto, **When** Claude busca contexto,
   **Then** encontra arquivo `project_caminho_b_evolucao.md` com a
   decisão e motivação.
2. **Given** memória, **When** Claude lê `MEMORY.md` (index), **Then**
   entrada do Caminho B está listada com one-liner descritivo.

---

### Edge Cases

- **Build quebra após renomear `package.json`** → improvável, mas se
  acontecer, qualquer referência ao nome antigo `rest-express` em
  scripts é caçada e atualizada.
- **READMEs ficam desatualizados depois** → cada spec futura que toca
  um diretório atualiza seu README na mesma PR.
- **Conflito com features em curso (heatmap-fix branch)** → escopo desta
  spec é só renomeação + estrutura + docs. Não toca código de feature.
  Branch atual `heatmap-fix` continua independente.
- **Novo dev confunde Provedor.ai com Consulta ISP** → CLAUDE.md seção 1
  diferencia explicitamente; READMEs reforçam.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `package.json` campo `name` MUST ser `"provedor-ai"`. Campo
  `description` MUST mencionar ecossistema + módulo Cobrança + Consulta ISP.
- **FR-002**: `CLAUDE.md` seção 1 (IDENTIDADE DO PROJETO) MUST identificar
  o projeto como Provedor.ai, com Consulta ISP como módulo interno, e
  registrar o pivot de 2026-05-11.
- **FR-003**: CLAUDE.md MUST listar os 10 funcionários digitais com nomes
  canônicos (Marcos, Júlia, Bruno, Helena, Rafael, Carla, Daniel, Lucas,
  Sofia, Pedro) e referência à plataforma Anthropic.
- **FR-004**: CLAUDE.md MUST listar pricing por tier (Essencial R$ 249,
  Profissional R$ 499, Plus R$ 899, Plus+ R$ 1.499, Enterprise R$ 3.500-7.500).
- **FR-005**: Diretório `server/agents/` MUST existir com README.md
  descrevendo orquestrador + integração Anthropic + tabela dos 10
  funcionários.
- **FR-006**: Diretório `server/communications/` MUST existir com
  subdiretórios `whatsapp/`, `sms/`, `email/` e README.md no pai
  explicando o gate da Júlia.
- **FR-007**: Diretório `server/audit/` MUST existir com README.md
  contendo schema mínimo da tabela `audit_log` e referência a triggers
  imutáveis.
- **FR-008**: Diretório `server/prompts/` MUST existir com README.md
  explicando convenção (1 arquivo por agente, frontmatter YAML,
  versionamento via git).
- **FR-009**: Diretório `server/modules/consulta-isp/` MUST existir com
  README.md documentando que features do Consulta ISP atual (heatmap,
  antifraude, importação, créditos) serão consolidadas aqui
  incrementalmente.
- **FR-010**: Nenhuma feature existente do Consulta ISP MUST ser
  quebrada — `npm run check` e `npm run test` passam após as mudanças.
- **FR-011**: Memória persistente de Claude (`~/.claude/projects/...`)
  MUST conter entrada `project_caminho_b_evolucao.md` documentando a
  decisão arquitetural.
- **FR-012**: Stack atual MUST ser preservado (Drizzle + Express +
  Postgres direto + connect-pg-simple). Nenhuma migração para
  Supabase/Prisma/Hono nesta spec.

### Key Entities

- **Repositório Provedor.ai**: o próprio `C:\ClaudeCode\`, agora
  renomeado conceitualmente. Estrutura: existente (server/, client/,
  shared/, etc.) + adições (server/agents, communications, audit,
  prompts, modules/consulta-isp).
- **Módulo Consulta ISP**: agrupamento lógico (não fisicamente
  consolidado ainda) das features herdadas. Migração para
  `server/modules/consulta-isp/` é incremental, fora do escopo desta
  spec.
- **Estrutura de Documentação**: CLAUDE.md raiz como super prompt
  do projeto; READMEs em cada novo diretório como guias locais;
  `C:\Provedor.ai\Ecossistema\` como spec canônica de produto.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um desenvolvedor novo (humano ou Claude) abre o repo e
  identifica corretamente o projeto como Provedor.ai em menos de 5
  minutos lendo CLAUDE.md.
- **SC-002**: `npm run check` passa sem erros novos comparado ao baseline
  antes desta spec (zero regressões TypeScript).
- **SC-003**: `npm run dev` sobe servidor com sucesso e rotas existentes
  do Consulta ISP respondem normalmente.
- **SC-004**: Próxima spec (sobre WhatsApp + Júlia + Helena) começa a
  escrever código em `server/agents/` e `server/communications/` sem
  precisar criar estrutura — apenas usar.
- **SC-005**: Memória do Claude permite que sessão futura recupere
  contexto do pivot em < 30s (verificável via leitura de MEMORY.md +
  arquivos linkados).
- **SC-006**: Zero alterações em `shared/schema.ts` — Princípio II da
  constituição respeitado (sem ALTER TABLE).

## Assumptions

- O usuário aprovou Caminho B explicitamente em 2026-05-11 (mensagem
  "sim B, lembrando que todos os agentes precisam ser criados na
  estrutura da anthropic").
- Os documentos em `C:\Provedor.ai\Ecossistema\` (CLAUDE.md,
  MODULES_ROADMAP.md, TEAM.md, provedor-ai-agentes.md, RESOURCES.md)
  permanecem como referência canônica de produto. Mudanças no produto
  primeiro são refletidas lá, depois propagam para este repo.
- TEAM.md é canônico para nomes dos 10 funcionários (Marcos, Júlia,
  Bruno, Helena, Rafael, Carla, Daniel, Lucas, Sofia, Pedro). Inconsistências
  em outros docs (MODULES_ROADMAP usa Helena=Análise Crédito, etc.)
  serão reconciliadas em spec futura.
- A pasta `C:\Provedor.ai\app\` (tentativa abortada de monorepo zero)
  foi removida. Não há resto.
- O Consulta ISP standalone como produto separado deixa de existir
  conceitualmente — mas o código e dados continuam, agora sob marca
  Provedor.ai.
- Features atuais (heatmap, antifraude, importação CSV, créditos,
  consultas ISP/SPC) continuam funcionando sem mudança nesta spec.

## Dependencies

- CLAUDE.md atualizado (super prompt da raiz).
- Memória persistente Claude em `C:\Users\pc\.claude\projects\C--ClaudeCode\memory\`.
- Acesso de leitura aos docs canônicos em `C:\Provedor.ai\Ecossistema\`.
- Stack atual continua funcionando: Node 20+, pnpm/npm, Drizzle, Express,
  Postgres em produção.
