---
description: "Task list — Paginação em fetchCustomers dos Conectores ERP"
---

# Tasks: Paginação em fetchCustomers dos Conectores ERP

**Input**: Design documents from `specs/001-fetchcustomers-pagination/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Incluídos. A Constitution (Princípio VII + seção "Testes") exige
cobertura quando se mexe em conectores ERP. Testes via vitest (já configurado).

**Organization**: Agrupados por user story para permitir entrega incremental.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependências)
- **[Story]**: US1, US2, US3 (mapeia para user stories da spec)
- Caminhos de arquivo absolutos quando crítico, relativos ao repo quando óbvio

## Path Conventions

- Backend: `server/`
- Frontend: `client/src/`
- Shared: `shared/`

---

## Phase 0: Pre-Setup (executar IMEDIATAMENTE — antes de qualquer outra task)

**Purpose**: Garantir que scripts auxiliares do speckit (`check-prerequisites.ps1`) reconhecem a branch. Sem isso, comandos como `/speckit-analyze` falham por branch fora de convenção.

- [ ] T001 Criar branch dedicada `001-fetchcustomers-pagination` a partir de `main` (separar do trabalho `heatmap-fix` em curso). Comando: `git checkout main && git pull && git checkout -b 001-fetchcustomers-pagination`. Após isso, `.specify/scripts/powershell/check-prerequisites.ps1 -Json` retorna OK.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verificação de pré-requisitos (sem novas dependências por
decisão do research — reuso de p-limit + bottleneck + vitest existentes).

- [ ] T002 [P] Verificar que `vitest.config.ts` cobre `server/**/*.test.ts` (deve já cobrir; ajustar se necessário)
- [ ] T003 [P] Rodar `npm run check` na branch nova para garantir baseline TypeScript limpo antes das mudanças

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tipos, helpers e storage que TODAS as user stories dependem.

**⚠️ CRITICAL**: Nenhuma user story começa antes desta fase concluir.

- [ ] T004 Estender `server/erp/types.ts` com os tipos novos: `ErpPaginationStrategy`, `ErpConnectorPaginationMetadata`, `ErpPage`, `ErpFetchOptions` (incluir campo opcional `rateGate?: <T>(fn: () => Promise<T>) => Promise<T>` para FR-004), `ErpResumeToken`, classes de erro `ErpPaginationLoopError` e `ErpSingleShotLimitExceededError`. Adicionar à interface `ErpConnector` os campos `pagination`, métodos `fetchCustomersPaged` e `fetchDelinquentsPaged`. Manter `fetchCustomers`/`fetchDelinquents` marcados `@deprecated`. Referência: `contracts/erp-connector-paginated.contract.md`.
- [ ] T005 Criar `server/erp/pagination.ts` com: `fnv1aHash(values: string[]): string`, `checkPaginationLoop(currentHash: string, history: string[]): boolean` (true se últimos 3 iguais), `legacyFetchAdapter<T>(generator): Promise<ErpFetchResult>` (consome iterator e acumula — usado pelos shims deprecated).
- [ ] T006 Criar `server/storage/erp-sync.storage.ts` com Zod schema `SyncProgressStateSchema` (per `contracts/sync-progress-state.contract.md`) e funções: `createOrResumeSyncLog(providerId, erpSource, syncType)`, `getSyncProgress(syncId)`, `updateSyncProgress(syncId, patch)`, `requestCancel(providerId, syncId)`, `finalizeSyncLog(syncId, status, errorMsg?)`, `getResumeToken(syncId)`, `listActiveSyncs(providerId, filter)`. TODAS as funções validam `providerId` (Princípio I).
- [ ] T007 [P] Auditar idempotência de upsert: localizar `storage.upsertCustomer*` em `server/storage/` e confirmar via leitura do schema que existe constraint UNIQUE em `(provider_id, cpf_cnpj)` ou equivalente. Documentar o achado em comentário no início de `erp-sync.storage.ts`. Se não houver constraint adequado, abrir issue (NÃO alterar schema — Princípio II).
- [ ] T008 [P] Adicionar testes em `server/erp/pagination.test.ts` para `fnv1aHash` (determinístico, mesmo input → mesmo hash) e `checkPaginationLoop` (true só após 3 hashes consecutivos iguais).
- [ ] T009 [P] Adicionar testes em `server/storage/erp-sync.storage.test.ts` para validação Zod do payload, isolamento por `providerId` (tentar acessar sync de outro provedor retorna null), e cancelamento idempotente.

**Checkpoint**: Tipos, helpers e storage prontos → user stories podem começar em paralelo.

---

## Phase 3: User Story 1 — Provedor Sincroniza Sem OOM (Priority: P1) 🎯 MVP

**Goal**: Provedor com >10k clientes consegue sincronizar sem timeout, sem
OOM, com memória estável durante a operação.

**Independent Test**: Mock de conector que devolve 50k registros em páginas;
sync completa; observar uso de memória do processo permanece < 500MB de
incremento; todos os registros chegam à base local.

### Tests for User Story 1

- [ ] T010 [P] [US1] Testes de contrato em `server/erp/connectors/_paginated-contract.test.ts` (genérico, parametrizado por conector): retorna páginas até `hasMore=false`; respeita `pageSize`; `loopGuardHash` determinístico; `AbortSignal.aborted` interrompe; `resumeFrom` retorna a sequência esperada.
- [ ] T011 [P] [US1] Teste de smoke em `server/services/erp-sync.service.test.ts`: dado um mock connector que entrega 50 páginas de 1000 registros, o service consome e persiste progresso a cada página, conclui com `status: completed`.

### Implementation for User Story 1 — Migração de Conectores (paralelos)

> **Para cada conector**, em TODAS as tasks T012-T021:
> 1. Implementar `pagination` metadata, `fetchCustomersPaged`, `fetchDelinquentsPaged`.
> 2. Manter shims legados via `legacyFetchAdapter`.
> 3. **Envolver cada requisição HTTP de página com `withResilience` de `server/erp/resilience.ts`** (retry + backoff exponencial — atende FR-011: falha de página não cancela sync inteira).
> 4. **Aceitar `options.rateGate` e, quando presente, gatear cada chamada HTTP via `await options.rateGate(() => fetchPage())`** (FR-004: rate limit entre páginas).
> 5. Seguir `quickstart.md` passo 3 para o esqueleto.

- [ ] T012 [P] [US1] Migrar `server/erp/connectors/ixc.ts` para o modelo paginado. Estratégia `native-page-rp`, defaultPageSize 200, maxPageSize 1000, supportsResume true. Adicionar `server/erp/connectors/ixc.test.ts` cobrindo o contrato.
- [ ] T013 [P] [US1] Migrar `server/erp/connectors/sgp.ts`. Estratégia `native-page-rp`, defaultPageSize 500. Test.
- [ ] T014 [P] [US1] Migrar `server/erp/connectors/voalle.ts`. Estratégia `native-offset-limit`, defaultPageSize 1000, maxPageSize 5000. Test.
- [ ] T015 [P] [US1] Migrar `server/erp/connectors/rbx.ts`. Estratégia `native-offset-limit`, defaultPageSize 500. Test.
- [ ] T016 [P] [US1] Migrar `server/erp/connectors/hubsoft.ts`. Estratégia `native-cursor`, defaultPageSize 1000. Test com mock de cursor opaco.
- [ ] T017 [P] [US1] Migrar `server/erp/connectors/mk.ts`. Estratégia `date-range` — quebrar o range de `cd_cliente_inicio/fim` em chunks de 5000 IDs e iterar. Adaptar lógica de dedup por `CodigoPessoa` para acontecer entre páginas (set persistido no generator scope). Test.
- [ ] T018 [P] [US1] Migrar `server/erp/connectors/topsapp.ts`. Pesquisar API ao implementar; classificar estratégia. Test.
- [ ] T019 [P] [US1] Migrar `server/erp/connectors/radiusnet.ts`. Pesquisar API ao implementar; classificar estratégia. Test.
- [ ] T020 [P] [US1] Migrar `server/erp/connectors/gere.ts`. Pesquisar API ao implementar; classificar estratégia. Test.
- [ ] T021 [P] [US1] Migrar `server/erp/connectors/receitanet.ts`. Pesquisar API ao implementar; classificar estratégia. Test.

### Implementation for User Story 1 — Consumo do Iterator

- [ ] T022 [US1] Refatorar `server/services/erp-sync.service.ts` para usar `connector.fetchCustomersPaged()`/`fetchDelinquentsPaged()` em `for await (...)`. **Injetar `rateGate` derivado de `getProviderLimiter(providerId).schedule.bind(getProviderLimiter(providerId))`** em `ErpFetchOptions` para cobrir FR-004. A cada página: upsert batch + `storage.updateSyncProgress` + verificar `cancelRequested`. Finalizar via `storage.finalizeSyncLog`. **Depende de T004, T005, T006 e pelo menos T012 (IXC)**.
- [ ] T023 [US1] Refatorar `server/services/heatmap-cache.ts` para consumir `fetchDelinquentsPaged()` via `for await`. Acumular geocodificação por página em vez de tudo-de-uma-vez. Manter contrato de saída do cache inalterado para o resto do sistema. **Depende de T022**.
- [ ] T024 [US1] Smoke test com IXC: configurar provedor de teste com base real (ou mock fiel) >5k registros; disparar sync manual via API; observar logs estruturados (`[ERP-SYNC]`) e tempo de conclusão. Documentar resultado em commit message.

**Checkpoint**: US1 funcional — provedores grandes podem sincronizar. MVP entregável.

---

## Phase 4: User Story 2 — Progresso Visível e Cancelamento (Priority: P2)

**Goal**: Operador acompanha sync longa pelo painel e pode cancelar.

**Independent Test**: Iniciar sync de 10+ páginas; abrir painel; verificar
contagem incrementando; clicar Cancelar; sync encerra após página atual.

### Tests for User Story 2

- [ ] T025 [P] [US2] Teste em `server/routes/erp.routes.test.ts`: `GET /api/provider/erp-sync/status` retorna apenas syncs do `providerId` da sessão; filtra por `source`; respeita `includeCompleted`. Resposta segue contract.
- [ ] T026 [P] [US2] Teste em `server/routes/erp.routes.test.ts`: `POST /api/provider/erp-sync/:syncId/cancel` retorna 404 quando sync pertence a outro provedor (não revelar 403); idempotente; flag `cancelRequested` persiste em payload.
- [ ] T027 [P] [US2] Teste de cancelamento end-to-end em `server/services/erp-sync.service.test.ts`: iniciar sync mock (páginas que demoram fake-timer 30s cada); após 2 páginas, setar `cancelRequested=true`; sync encerra com `status: cancelled`. **Assertar que `cancelledAt - cancelRequestedAt <= 120000ms` (SC-006: cancel ≤2min)**. Usar `vi.useFakeTimers()` para determinismo.

### Implementation for User Story 2

- [ ] T028 [US2] Adicionar `GET /api/provider/erp-sync/status` em `server/routes/erp.routes.ts`. Middleware `requireAuth`. Implementação chama `storage.listActiveSyncs(req.session.providerId, req.query)`. Validação Zod do query string.
- [ ] T029 [US2] Adicionar `POST /api/provider/erp-sync/:syncId/cancel` em `server/routes/erp.routes.ts`. Middleware `requireAuth`. Implementação chama `storage.requestCancel(req.session.providerId, syncId)` e retorna conforme contract.
- [ ] T030 [US2] Garantir que `erp-sync.service.ts` consulta `storage.getSyncProgress(syncId).cancelRequested` ANTES de cada requisição de página (entre páginas) e encerra cooperativamente quando true. **Depende de T022**.
- [ ] T031 [P] [US2] Criar `client/src/hooks/use-erp-sync-status.ts` — `useQuery` com `refetchInterval: 5000`. Tipos baseados no contract response.
- [ ] T032 [P] [US2] Criar `client/src/hooks/use-cancel-sync.ts` — `useMutation` que invalida query de status no success e mostra toast.
- [ ] T033 [P] [US2] Criar `client/src/components/erp/SyncProgressPanel.tsx` — recebe array de `SyncStatusItem`; renderiza por sync uma barra de progresso (Tailwind), contagem de registros, tempo decorrido, botão Cancelar (desabilita quando `cancelRequested=true`).
- [ ] T034 [US2] Integrar `SyncProgressPanel` em `client/src/pages/administracao.tsx` (ou na página apropriada de configuração ERP — confirmar localização). Aparece apenas quando há sync ativa ou recente.

**Checkpoint**: Operadores têm visibilidade total e controle sobre syncs.

---

## Phase 5: User Story 3 — Retomada de Sync Interrompida (Priority: P3)

**Goal**: Sync interrompida no meio retoma da última página confirmada.

**Independent Test**: Iniciar sync mock de 30 páginas; após página 15, matar
o serviço; reiniciar; próxima sync retoma da página 16 sem duplicar.

### Tests for User Story 3

- [ ] T035 [P] [US3] Teste em `server/storage/erp-sync.storage.test.ts`: `createOrResumeSyncLog` detecta sync `in_progress` recente (<4h) do mesmo `(providerId, erpSource)` e retorna o syncId existente em vez de criar novo. Sync abandonada (>4h) é marcada `failed` e nova é criada.
- [ ] T036 [P] [US3] Teste em `server/erp/connectors/ixc.test.ts`: chamar `fetchCustomersPaged` com `resumeFrom: { kind: 'page', pageNumber: 5 }` começa exatamente da página 5.
- [ ] T037 [P] [US3] Teste end-to-end de retomada em `server/services/erp-sync.service.test.ts`: simular interrupção entre páginas 15 e 16; segunda execução completa pages 16-30; total de upserts = 30 páginas × pageSize (sem duplicação confirmada via count distinct).

### Implementation for User Story 3

- [ ] T038 [US3] Implementar lógica de retomada em `storage.createOrResumeSyncLog` (`server/storage/erp-sync.storage.ts`): consultar sync mais recente por `(providerId, erpSource)`; se `status='in_progress' AND iniciadoEm > now() - interval '4 hours'`, retornar esse id; senão marcar antigos `in_progress` como `failed` (com `erroAtual: 'Sync abandonada (>4h)'`) e criar novo.
- [ ] T039 [US3] Implementar `storage.getResumeToken(syncId)` que lê `payload` e devolve `ErpResumeToken` apropriado para a estratégia do conector (page-number para IXC/SGP, cursor para Hubsoft, timestamp para MK).
- [ ] T040 [US3] Integrar `resumeFrom` em `server/services/erp-sync.service.ts`: passar `getResumeToken(syncId)` para `fetchCustomersPaged({ resumeFrom })`. **Depende de T022, T038, T039**.
- [ ] T041 [US3] Verificar suporte a `resumeFrom` por conector e levantar erro claro (`InvalidResumeTokenError`) se a estratégia não permitir o tipo de token recebido.

**Checkpoint**: Resiliência a interrupções — provedores grandes seguros.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentação, observabilidade e cleanup pós-implementação.

- [ ] T042 [P] Atualizar `CLAUDE.md` seção 7 ("INTEGRAÇÃO ERP") adicionando subseção "Paginação por Conector" com a tabela de estratégias da `data-model.md`.
- [ ] T043 [P] Atualizar `CLAUDE.md` seção 9 ("ROTAS API") adicionando `GET /api/provider/erp-sync/status` e `POST /api/provider/erp-sync/:syncId/cancel`.
- [ ] T044 [P] Adicionar logging estruturado JSON em pontos críticos do `erp-sync.service.ts`: início de sync (`[ERP-SYNC] start`), por página (`[ERP-SYNC] page`), final (`[ERP-SYNC] done`/`failed`/`cancelled`). Incluir `providerId`, `erpSource`, `syncId`, `pageNumber`, `recordsInPage`, `durationMs`.
- [ ] T045 Rodar `npm run check` (TypeScript) — zero novos erros aceitáveis.
- [ ] T046 Rodar `npx vitest run server/erp/ server/services/ server/storage/` — todos os testes verdes.
- [ ] T047 Executar a sequência completa do `quickstart.md` em ambiente local (configurar IXC mock, dispatchar sync, validar progresso, cancelar uma sync, validar retomada).
- [ ] T048 [P] (Opcional, release seguinte) Identificar callers internos dos métodos legados `fetchCustomers`/`fetchDelinquents` e abrir issue para migrá-los; após confirmação de zero usos internos, remover os shims em PR separado.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: nenhuma dependência
- **Phase 2 (Foundational)**: depende de Phase 1 — BLOQUEIA US1/US2/US3
- **Phase 3 (US1)**: depende de Phase 2; conectores [T012-T021] em paralelo; T022 depende de T012 + (T004-T006); T023 depende de T022
- **Phase 4 (US2)**: depende de Phase 2 + T022 (cancelamento precisa do service refatorado)
- **Phase 5 (US3)**: depende de Phase 2 + T022 + T038/T039
- **Phase 6 (Polish)**: depende de US1/US2/US3 conforme aplicável

### Within Each User Story

- Testes (quando incluídos) escritos primeiro e DEVEM falhar antes da
  implementação (TDD).
- Conectores migrados antes do service consumidor.
- Service refatorado antes da UI.

### Parallel Opportunities

- **Phase 2**: T007, T008, T009 podem rodar em paralelo após T004-T006
- **Phase 3**: T010, T011 em paralelo; T012-T021 (10 conectores) em paralelo após Foundational
- **Phase 4**: T025-T027 (testes) em paralelo; T031-T033 (frontend) em paralelo após T028-T029
- **Phase 5**: T035-T037 (testes) em paralelo
- **Phase 6**: T042-T044 em paralelo

---

## Parallel Example: Migrating Connectors (Phase 3, US1)

```text
# Após Foundational (T004-T009), os 10 conectores são migráveis em paralelo:
Task T012: IXC → server/erp/connectors/ixc.ts + ixc.test.ts
Task T013: SGP → server/erp/connectors/sgp.ts + sgp.test.ts
Task T014: Voalle → server/erp/connectors/voalle.ts + voalle.test.ts
Task T015: RBX → server/erp/connectors/rbx.ts + rbx.test.ts
Task T016: Hubsoft → server/erp/connectors/hubsoft.ts + hubsoft.test.ts
Task T017: MK → server/erp/connectors/mk.ts + mk.test.ts
Task T018: TopSApp → server/erp/connectors/topsapp.ts + topsapp.test.ts
Task T019: RadiusNet → server/erp/connectors/radiusnet.ts + radiusnet.test.ts
Task T020: Gere → server/erp/connectors/gere.ts + gere.test.ts
Task T021: ReceitaNet → server/erp/connectors/receitanet.ts + receitanet.test.ts
```

---

## Implementation Strategy

### MVP First (Minimum Viable)

1. Phase 1 (Setup) — T001-T003
2. Phase 2 (Foundational) — T004-T009
3. **Apenas conector IXC migrado** (T012) + T022 (service) + T023 (heatmap) + T024 (smoke)
4. **STOP e VALIDATE**: smoke test com provedor IXC real
5. Deploy/demo o MVP

### Incremental Delivery

1. **MVP**: Setup + Foundational + IXC + Service (T001-T012, T022-T024)
2. **Connectors em ondas** (per ordem do quickstart): SGP, Voalle, RBX, MK, Hubsoft, e depois TopSApp/RadiusNet/Gere/ReceitaNet
3. **US2 — Progress UI** (T025-T034) — entregar quando US1 estável
4. **US3 — Resume** (T035-T041) — última camada, opcional para volumes <20k
5. **Polish** (T042-T048) — paralelo com US3

### Parallel Team Strategy

Com 2-3 devs após Foundational concluir:
- Dev A: IXC + Hubsoft + service refactor (T012, T016, T022)
- Dev B: SGP + Voalle + RBX (T013, T014, T015)
- Dev C: MK + heatmap + frontend US2 (T017, T023, T031-T034)
- Dev D (se houver): TopSApp + RadiusNet + Gere + ReceitaNet (T018-T021)

---

## Notes

- [P] = arquivos diferentes, sem dependências entre si
- [Story] mapeia traceabilidade ao requirement da spec
- Cada user story é independentemente entregável e testável
- Verificar testes falhando antes de implementar (TDD onde aplicável)
- Commit após cada task ou grupo lógico (`speckit.git.commit` hook disponível)
- Evitar: tasks vagas, conflito de mesmo arquivo, dependências cross-story
  que quebrem a independência das stories

---

## Task Count Summary

| Phase | Tasks | Parallelizable |
|---|---|---|
| 1. Setup | 3 | 2 |
| 2. Foundational | 6 | 4 |
| 3. US1 (MVP) | 15 | 12 |
| 4. US2 | 10 | 7 |
| 5. US3 | 7 | 3 |
| 6. Polish | 7 | 4 |
| **Total** | **48** | **32** |

**MVP scope** (just T001-T012, T022-T024): ~15 tasks → entrega valor mais
crítico (provedores grandes sincronizam) em 1-2 semanas de trabalho.
