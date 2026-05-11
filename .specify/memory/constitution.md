<!--
SYNC IMPACT REPORT
==================
Version change: (none — initial ratification) → 1.0.0
Bump rationale: First ratification of project constitution. Establishes 7 core
principles, additional constraints, development workflow, and governance.
Modified principles: (none — initial)
Added sections:
  - Core Principles (I–VII)
  - Restrições Adicionais
  - Fluxo de Desenvolvimento
  - Governança
Removed sections: (none)
Templates requiring updates:
  - .specify/templates/plan-template.md         ⚠ pending Constitution Check alignment
  - .specify/templates/spec-template.md         ⚠ pending requirements alignment
  - .specify/templates/tasks-template.md        ⚠ pending task categorization review
  - CLAUDE.md                                   ⚠ pending GSD→SDD enforcement update
Follow-up TODOs:
  - Review `.specify/templates/*.md` to ensure Constitution Check sections reference
    Principles I–VII (multi-tenant, schema immutability, repository pattern, TanStack
    Query, LGPD, pt-BR, incremental delivery).
  - Update CLAUDE.md "GSD Workflow Enforcement" section to point to /speckit-* commands.
-->

# Consulta ISP Constitution

## Core Principles

### I. Isolamento Multi-Tenant (NÃO-NEGOCIÁVEL)

Toda tabela que armazena dados de provedor MUST ter coluna `provider_id` com
chave estrangeira para `providers.id`. Toda query de leitura ou escrita MUST
filtrar por `req.session.providerId` (ou equivalente no contexto). Não há
exceção a esta regra. Acesso superadmin opera com `providerId === null` e
ainda assim DEVE ser explícito no código.

**Rationale:** Vazamento cruzado entre tenants é falha crítica de segurança e
de conformidade LGPD. Esta é a única invariante do produto cujo descumprimento
justifica reversão imediata de qualquer mudança.

### II. Schema Imutável Sem Autorização Explícita

`shared/schema.ts` MUST NOT ser modificado sem autorização explícita do owner
do produto. Alterações de schema exigem (a) justificativa documentada,
(b) plano de migração compatível com produção, (c) aprovação prévia antes da
execução de `drizzle-kit push`.

**Rationale:** O schema é a fonte de verdade compartilhada entre frontend,
backend e banco. Mudanças não-coordenadas quebram tipagem, validação Zod e
migrações em produção. A imutabilidade força discussão antes do dano.

### III. Repository Pattern via Drizzle

Todas as queries de banco MUST passar pela interface `IStorage` em
`server/storage.ts`. SQL raw é proibido. O frontend NUNCA acessa o banco
diretamente — toda interação com dados passa pela API HTTP.

**Rationale:** O Repository Pattern centraliza isolamento multi-tenant,
auditoria e tipagem. SQL raw fora do `storage` é vetor para injeção, drift de
tipos e bypass do `providerId`. Frontend acessando banco quebra o contrato
de API e a separação cliente/servidor.

### IV. Estado Server-Side via TanStack Query

Componentes React MUST NOT chamar `fetch()` diretamente. Toda interação com
a API DEVE usar `useQuery` (leitura) ou `useMutation` (escrita). Invalidação
de cache DEVE ser explícita (`queryClient.invalidateQueries`) após mutações.

**Rationale:** TanStack Query padroniza cache, retry, deduplicação e loading
states. Fetches manuais geram bugs de stale data, race conditions e UX
inconsistente. Toda a base já segue este padrão — desvios criam dívida.

### V. LGPD por Default

Dados de inadimplência expostos entre provedores MUST ser mascarados:
nome parcial (primeiro nome + inicial), faixa de valor (não valor exato),
endereço sem número, sem email/telefone completos. Nenhum PII bruto cruza a
fronteira de tenant. Acesso a dados do próprio tenant é livre; entre tenants,
NUNCA.

**Rationale:** A LGPD (Art. 7, IX — legítimo interesse) permite o bureau
colaborativo, mas exige minimização. Mascaramento é a barreira técnica que
torna o produto compliance-by-design e protege a empresa de sanções.

### VI. Português Brasileiro no Domínio

Interface (UI), mensagens de erro ao usuário, e nomes de variáveis/funções
de domínio MUST usar português brasileiro quando já existe padrão na
codebase (ex: `equipamentos`, `notificacaoEnviada`, `inadimplentes`). Inglês
é aceitável apenas para terminologia técnica universal (HTTP, SQL, async,
JWT, etc.).

**Rationale:** O público-alvo são ISPs regionais brasileiros. UX em inglês
gera fricção. Manter consistência com o vocabulário existente da codebase
evita confusão (ex: `customer` vs `cliente` no mesmo módulo).

### VII. Desenvolvimento Incremental Verificável

Toda mudança DEVE ter critério de aceitação claro antes da implementação.
Uma feature por vez. Mudanças arquiteturais grandes (novo módulo, troca de
biblioteca, refactor cross-cutting) DEVEM ser discutidas e justificadas antes
da execução. Refactors especulativos ("vai ficar melhor") sem requisito
concreto SÃO PROIBIDOS.

**Rationale:** O projeto opera com qualidade > velocidade, sem deadline. O
gargalo é compreensão, não throughput. Incrementos pequenos e verificáveis
reduzem retrabalho, facilitam revisão e mantêm o sistema sempre deployável.

## Restrições Adicionais

**Stack tecnológica (mudanças exigem justificativa):**
- Frontend: React 18 + Vite 7 + Tailwind 3 + shadcn/ui + Wouter 3 + TanStack
  Query 5 + Zod 3
- Backend: Express 5 + TypeScript 5.6 + Passport (passport-local) + WebSocket (ws)
- Banco: PostgreSQL + Drizzle ORM 0.39
- Build: esbuild (backend CJS) + Vite (frontend); entry `npm run build`,
  produção `node dist/index.cjs`

**Segurança e compliance:**
- Sessões via `connect-pg-simple` (cookies httpOnly, 30 dias). Não usar
  `memorystore` em produção.
- Senhas: scrypt nativo. NUNCA bcrypt/MD5/SHA1 puros.
- LGPD: logs de consulta (`consultation_logs`) DEVEM registrar quem consultou
  qual CPF/CNPJ, quando e de qual provedor. Retenção mínima de 5 anos
  conforme norma de bureau de crédito.
- Webhooks recebidos (Asaas, ERPs) DEVEM validar assinatura/token antes de
  processar.

**Performance:**
- Mapa de calor: cache in-memory por provedor com TTL 24h. NÃO refazer
  geocodificação sob demanda em request síncrono.
- Consultas em lote: limite 500 CPFs/CSV. Lotes maiores DEVEM usar fila.
- Streaming SSE (OpenAI) DEVE ser usado para análise IA — nunca aguardar
  resposta completa.

**Integrações ERP:**
- Conector ERP MUST ser direto via API REST nativa. Proxies externos
  (ex: N8N) SÃO PROIBIDOS para o caminho crítico de produção.
- Cada provedor configura suas próprias credenciais ERP (apiUrl + apiToken).
- Logs de sync (`erp_sync_logs`) DEVEM ser persistidos com sucesso/erro,
  contagem e timestamp.

## Fluxo de Desenvolvimento

**Migração GSD → SDD:**
Este projeto migrou de GSD (Get Shit Done) para Spec-Kit (SDD) em 2026-05-10.
O diretório `.planning-archive/` preserva o histórico GSD como referência.
Trabalho novo DEVE usar o fluxo `/speckit-*` (constitution → specify → plan
→ tasks → implement).

**Branch strategy:**
- `main` é a branch protegida de produção.
- Branches de feature: `feat/<nome-curto>` ou `<nome-curto>` (ex: `heatmap-fix`).
- Antes de merge para `main`: rodar `npm run check` (TypeScript) e validar
  manualmente as flows críticas (auth, consulta ISP, mapa de calor).

**Deploy:**
- Deploy é manual via VPS (Hostinger). Não há CI/CD automatizado para
  produção. Workflow: corrigir local → push main → SSH na VPS → pull + build
  + restart.
- NUNCA testar em produção. NUNCA fazer hotfix direto na VPS sem commit
  correspondente.

**Code review:**
- PRs grandes (>500 linhas alteradas) DEVEM ser quebrados em commits
  atômicos revisáveis.
- Toda nova rota API DEVE ter middleware de auth adequado declarado
  (`requireAuth`, `requireAdmin`, `requireSuperAdmin`).

**Testes:**
- Testes ainda não são obrigatórios para todo código. Áreas críticas
  (auth, isolamento multi-tenant, score ISP, integrações ERP) DEVEM ter
  testes ao serem tocadas. Mocks de banco SÃO PROIBIDOS — usar
  PostgreSQL real.

## Governança

Esta Constitution supersede qualquer convenção informal anterior do projeto.

**Procedimento de emenda:**
1. Proposta documentada com justificativa.
2. Discussão e ajuste.
3. Atualização de `.specify/memory/constitution.md` com novo Sync Impact
   Report e versão SemVer bumpada.
4. Propagação às templates do Spec-Kit afetadas
   (`.specify/templates/*-template.md`).
5. Atualização do CLAUDE.md se houver mudança operacional.

**Política de versionamento (SemVer):**
- MAJOR: remoção ou redefinição backward-incompatible de princípio ou
  governança.
- MINOR: adição de princípio/seção ou expansão material de orientação.
- PATCH: clarificações, ajustes de redação, correções não-semânticas.

**Compliance:**
- Toda PR DEVE verificar conformidade com os princípios I–VII. Violações
  identificadas em review SÃO bloqueantes.
- Decisões que se desviem de um princípio DEVEM ser justificadas
  explicitamente no PR e referenciar o princípio relevante.

**Guidance file:** `CLAUDE.md` permanece como super prompt operacional do
projeto e é a fonte de verdade para detalhes implementacionais (schemas,
rotas, plans, créditos). A Constitution define princípios; CLAUDE.md
define operação.

**Version**: 1.0.0 | **Ratified**: 2026-05-10 | **Last Amended**: 2026-05-10
