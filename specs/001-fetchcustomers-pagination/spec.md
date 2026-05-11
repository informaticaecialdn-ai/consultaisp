# Feature Specification: Paginação em fetchCustomers dos Conectores ERP

**Feature Branch**: `001-fetchcustomers-pagination`
**Created**: 2026-05-10
**Status**: Draft (sem clarificações em aberto)
**Input**: User description: "Adicionar paginação ao método fetchCustomers (e fetchDelinquents quando aplicável) em todos os conectores ERP, para permitir sincronização confiável de provedores com grande volume de clientes (>10k) sem timeout, OOM ou bloqueio do event loop."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Provedor Grande Sincroniza Sua Base Completa Sem Falhar (Priority: P1)

Um provedor com mais de 10.000 clientes ativos no ERP dispara a sincronização
de clientes pela primeira vez (ou depois de muito tempo). O sistema busca os
dados em páginas, respeita limites de taxa do ERP, mantém uso de memória
estável e conclui a sync com todos os registros carregados — sem o servidor
travar, sem o ERP recusar requisições por excesso, sem timeout no painel.

**Why this priority**: Sem isto, provedores grandes (o público que mais paga)
não conseguem usar a integração completa. É o gargalo que bloqueia o produto
em escala.

**Independent Test**: Configurar um provedor com base ERP de >10.000 clientes
(real ou simulado por mock que devolve dados pageados), disparar sync de
clientes, verificar que todos os registros chegam à base local, que o uso
de memória do servidor permanece estável durante a operação, e que a sync
não excede o tempo limite do painel.

**Acceptance Scenarios**:

1. **Given** provedor com 50.000 clientes no ERP, **When** dispara sync
   manual de clientes, **Then** o sistema busca em páginas e conclui sem
   exceder limite de memória, com todos os registros disponíveis ao
   final.
2. **Given** ERP impõe limite de 1.000 registros por requisição, **When**
   sistema sincroniza base de 25.000, **Then** faz 25 requisições paginadas
   (ou equivalente para o esquema do ERP), respeitando rate limit entre
   chamadas.
3. **Given** sync grande está em andamento, **When** outro provedor dispara
   sync simultânea, **Then** ambas progridem independentemente sem
   degradação cruzada (isolamento por provedor mantido).

---

### User Story 2 — Operador Vê Progresso de Sync Longa (Priority: P2)

Um operador inicia uma sync manual de um provedor grande pelo painel. Em vez
de ver apenas "carregando…" por minutos sem feedback, vê indicação de
progresso (ex: "Página 12 de 25 — 12.000/25.000 registros") atualizada em
tempo real, com tempo estimado e botão para cancelar se quiser.

**Why this priority**: UX. Operadores não devem ficar com dúvida se a sync
travou ou está progredindo. Sem isso, viram cancelando syncs válidas ou
deixam abas abertas por horas.

**Independent Test**: Disparar sync em provedor grande pelo painel, observar
que o componente de progresso mostra páginas concluídas e contagem de
registros incrementando em tempo real, e que o operador consegue cancelar
no meio.

**Acceptance Scenarios**:

1. **Given** sync em andamento com 10 páginas, **When** o operador olha o
   painel, **Then** vê "X de 10 páginas concluídas — Y registros
   carregados" atualizado a cada conclusão de página.
2. **Given** ERP não fornece contagem total, **When** sync está rodando,
   **Then** o painel mostra "Página N concluída — Y registros carregados
   até agora" sem total estimado, mas indicando progresso ativo.
3. **Given** operador clica em "Cancelar sync", **When** sync está no meio,
   **Then** o sistema para após a página atual completar, registra
   "Cancelado pelo usuário" no log de sync, e mantém os registros já
   importados.

---

### User Story 3 — Sync Interrompida Retoma do Ponto de Falha (Priority: P3)

Uma sync de grande volume é interrompida no meio (servidor reiniciado, ERP
caiu temporariamente, rede oscilou). Em vez de recomeçar do zero, o sistema
retoma da última página confirmada e completa o trabalho restante.

**Why this priority**: Resiliência. Importante para syncs realmente grandes
(50k+) onde recomeçar do zero pode dobrar o tempo total. É P3 porque em
escala média (10-25k) recomeçar ainda é viável.

**Independent Test**: Iniciar sync grande, matar o servidor no meio, subir
de novo, verificar que próxima sync continua da página interrompida e não
duplica registros já importados.

**Acceptance Scenarios**:

1. **Given** sync foi interrompida na página 15 de 30, **When** sistema
   reinicia, **Then** próxima sync detecta estado intermediário e retoma
   da página 16.
2. **Given** ERP devolve registro já importado em página retomada,
   **When** sistema processa, **Then** faz upsert idempotente (não duplica
   nem perde dado mais recente).
3. **Given** sync interrompida há mais de N horas (configurável), **When**
   reinicia, **Then** descarta estado parcial e recomeça do zero (dados
   provavelmente desatualizados).

---

### Edge Cases

- **ERP retorna página vazia antes do total esperado** → sistema trata
  como fim do dataset e finaliza sync com sucesso.
- **ERP retorna a mesma página repetidamente (loop infinito)** → sistema
  detecta página duplicada (mesmos primeiros N registros), aborta com
  erro de "loop de paginação detectado".
- **ERP não suporta paginação nativa** → conector busca tudo em uma
  requisição e faz "paginação client-side" se o volume couber; se exceder
  threshold de segurança, retorna erro acionável.
- **ERP tem limite máximo de página menor do que esperado** → conector
  adapta dinamicamente ao limite informado.
- **Página individual demora mais que timeout** → sistema retorna erro de
  timeout para aquela página, registra no log, e (se em modo auto-sync)
  tenta novamente em backoff.
- **Provedor exclui integração ERP durante sync** → sync atual termina
  na página corrente e registra "integração removida durante sync".
- **Registros mudam de status durante a sync** → aceitável; cada página
  é um snapshot momentâneo. Próxima sync corrige inconsistências.
- **Total de registros varia entre primeira e última página** (ERP em
  atividade) → sistema completa todas as páginas mesmo que total muden;
  registra o delta nos logs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Todos os conectores ERP MUST suportar busca paginada de
  clientes via `fetchCustomers` — nenhum conector pode retornar dataset
  completo em chamada única quando o volume excede limite configurável
  (padrão 1.000 registros).
- **FR-002**: O contrato da interface `ErpConnector` MUST acomodar tanto
  ERPs com paginação nativa (page+rp, offset+limit, cursor) quanto ERPs
  sem paginação (fallback adequado).
- **FR-003**: O sistema MUST limitar o uso de memória durante sync —
  registros DEVEM ser processados em batches e persistidos ou repassados
  antes de buscar próxima página.
- **FR-004**: O sistema MUST respeitar limites de taxa (rate limit) do
  ERP entre páginas, usando concorrência controlada por provedor.
- **FR-005**: O sistema MUST persistir progresso por sync (página atual,
  registros já processados, timestamp da última página) para permitir
  observabilidade e retomada.
- **FR-006**: O sistema MUST expor progresso de sync em tempo real para
  o painel (via API ou stream), permitindo ao operador acompanhar
  páginas concluídas e contagem de registros.
- **FR-007**: O operador MUST poder cancelar uma sync em andamento pelo
  painel; cancelamento DEVE encerrar após a página corrente completar,
  preservando registros já importados.
- **FR-008**: Sync interrompida (servidor caído, erro de rede, timeout)
  MUST ser retomável a partir da última página confirmada, dentro de
  janela de tempo configurável (padrão 4 horas); após essa janela,
  recomeçar do zero.
- **FR-009**: Upsert de registros MUST ser idempotente — receber o mesmo
  registro em página retomada NÃO PODE duplicar nem regredir dados.
- **FR-010**: O método `fetchDelinquents` MUST seguir a mesma estratégia
  de paginação quando aplicável; consultas pontuais (`fetchCustomerByCpf`,
  `fetchCustomersByCep`) são naturalmente limitadas e NÃO precisam
  mudar.
- **FR-011**: Falhas em uma página individual MUST ser registradas no log
  de sync com detalhes (número da página, erro, payload da requisição
  sem credenciais) sem cancelar a sync inteira se a página seguinte for
  alcançável após retry com backoff.
- **FR-012**: O sistema MUST detectar e abortar em loops de paginação
  (mesma página retornada repetidamente) com erro claro.
- **FR-013**: O isolamento multi-tenant (Princípio I) MUST ser preservado:
  syncs paralelas de provedores diferentes NÃO PODEM interferir entre si.

### Key Entities

- **Sync em Progresso**: Estado intermediário de uma sincronização ativa
  — provedor, fonte ERP, página atual, total de páginas (se conhecido),
  registros processados, timestamp de início, timestamp da última página,
  status (em-andamento / pausada / cancelada / falha).
- **Página de Resultados**: Lote de registros normalizados retornado por
  uma chamada paginada — contém os registros, indicador de "há mais
  páginas", e (opcional) cursor/offset para próxima página.
- **Estratégia de Paginação por Conector**: Definição interna de como
  cada ERP pagina (page+rp para IXC, offset+limit para MK, cursor para
  Hubsoft, etc.) — encapsulada dentro do conector, transparente para o
  caller.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sync completa de um provedor com 50.000 clientes em ERP
  responsivo conclui em menos de 10 minutos.
- **SC-002**: Uso de memória do processo durante sync de qualquer
  tamanho permanece abaixo de 500 MB para o contexto da sync (excluindo
  baseline da aplicação).
- **SC-003**: Provedor de 10.000 clientes consegue sincronizar com 100%
  de sucesso em ERPs cujo limite de página é 1.000 registros — sem
  timeout, sem erro de rate limit.
- **SC-004**: Sync interrompida com 50% concluído retoma e completa em
  até 110% do tempo restante esperado (overhead aceitável para detectar
  estado e retomar).
- **SC-005**: Operador acompanhando o painel durante sync de 10+ páginas
  recebe atualização de progresso ao menos a cada 30 segundos.
- **SC-006**: Cancelamento de sync pelo operador é efetivado em até 2
  minutos a partir do clique (tempo máximo de uma página corrente
  terminar).
- **SC-007**: Zero registros duplicados na base local após sync
  retomada — verificável por contagem de PKs únicos.
- **SC-008**: Loop de paginação infinita é detectado e abortado em até 3
  páginas consecutivas idênticas, com erro registrado.

## Assumptions

- A interface `ErpConnector` atual em `server/erp/types.ts` é o ponto de
  modificação aceitável (o método `fetchCustomers` será estendido com
  semântica de paginação, mantendo compatibilidade ou via método novo).
  Princípio II (schema imutável) NÃO se aplica aqui — é mudança de
  contrato de código, não de banco.
- Os 10 conectores existentes (IXC, MK, SGP, Hubsoft, Voalle, RBX,
  TopSApp, RadiusNet, Gere, ReceitaNet) DEVEM ser todos adaptados ou
  classificados explicitamente como "single-page only" no metadata
  do conector.
- Estado intermediário de sync pode ser persistido em tabela existente
  `erp_sync_logs` (com colunas adicionais via migração autorizada se
  necessário) ou em cache in-memory descartável após N horas — decisão
  fica para a fase de planejamento (`/speckit-plan`).
- Limite padrão de página é 1.000 registros, mas cada conector pode
  ajustar baseado em limites conhecidos do seu ERP (ex: alguns suportam
  até 5.000).
- Rate limit entre páginas usa `bottleneck` ou `p-limit` já presentes no
  projeto — não introduz nova dependência.
- A UI de progresso pode ser implementada via polling do endpoint de
  status ou Server-Sent Events — escolha fica na fase de planejamento.

## Dependencies

- Conectores ERP existentes em `server/erp/connectors/*.ts`.
- Tabela `erp_sync_logs` (per CLAUDE.md schema).
- Padrão de rate limiting já presente em `server/services/heatmap-cache.ts`
  (`getProviderLimiter`).
- Painel de configuração ERP (frontend) para exibir progresso e botão de
  cancelamento.
