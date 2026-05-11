# Contract: ErpConnector Paginated Interface

**Type**: TypeScript interface contract (internal API between conectores e services)
**File**: `server/erp/types.ts`

---

## TypeScript Definitions

```typescript
// ============================================================
// NOVO — entregue por esta feature
// ============================================================

/** Estratégia de paginação suportada pelo conector */
export type ErpPaginationStrategy =
  | "native-page-rp"        // page + rp (IXC, SGP)
  | "native-offset-limit"   // offset + limit (Voalle, RBX)
  | "native-cursor"         // cursor opaco (Hubsoft)
  | "date-range"            // filtro por timestamp (MK)
  | "single-shot";          // ERP devolve tudo de uma vez

/** Metadata estendida do conector — adicionada ao ErpConnector */
export interface ErpConnectorPaginationMetadata {
  readonly paginationStrategy: ErpPaginationStrategy;
  readonly defaultPageSize: number;
  readonly maxPageSize: number;
  readonly supportsResume: boolean;
  /** Para single-shot: limite acima do qual o conector aborta com erro */
  readonly singleShotSafeLimit?: number;
}

/** Uma página entregue pelo conector */
export interface ErpPage {
  pageNumber: number;
  records: NormalizedErpCustomer[];
  hasMore: boolean;
  totalEstimate?: number;
  cursor?: string;
  /** FNV-1a dos primeiros 10 cpfCnpj — para loop detection no caller */
  loopGuardHash: string;
}

/** Opções aceitas pela iteração paginada */
export interface ErpFetchOptions {
  pageSize?: number;            // default: defaultPageSize do conector
  resumeFrom?: ErpResumeToken;  // retomar de uma página/cursor específico
  signal?: AbortSignal;         // cancelamento in-process (separado da flag persistida)
  /**
   * Gate de rate limiting injetado pelo caller (FR-004). Quando presente,
   * o conector MUST envolver cada requisição HTTP de página como:
   *   await rateGate(() => fetchPage(...))
   * Padrão recomendado: `getProviderLimiter(providerId).schedule.bind(...)`
   */
  rateGate?: <T>(fn: () => Promise<T>) => Promise<T>;
}

/** Token de retomada (formato depende da estratégia) */
export type ErpResumeToken =
  | { kind: "page"; pageNumber: number }
  | { kind: "cursor"; cursor: string }
  | { kind: "since"; isoTimestamp: string };

/** Erros tipados */
export class ErpPaginationLoopError extends Error {
  constructor(public readonly pageNumber: number, public readonly hash: string) {
    super(`Loop de paginação detectado na página ${pageNumber} (hash ${hash})`);
  }
}

export class ErpSingleShotLimitExceededError extends Error {
  constructor(public readonly count: number, public readonly limit: number) {
    super(`Volume (${count}) excede limite single-shot (${limit}) para este ERP`);
  }
}

// ============================================================
// EXTENSÃO da interface ErpConnector existente
// ============================================================

export interface ErpConnector {
  readonly name: string;
  readonly label: string;
  readonly configFields: ErpConfigField[];

  /** ★ NOVO — metadata de paginação */
  readonly pagination: ErpConnectorPaginationMetadata;

  testConnection(config: ErpConnectionConfig): Promise<ErpTestResult>;

  /** ★ NOVO — entrega páginas via async generator */
  fetchCustomersPaged(
    config: ErpConnectionConfig,
    options?: ErpFetchOptions
  ): AsyncIterableIterator<ErpPage>;

  /** ★ NOVO — equivalente paginado para delinquents */
  fetchDelinquentsPaged(
    config: ErpConnectionConfig,
    lastDays?: number,
    options?: ErpFetchOptions
  ): AsyncIterableIterator<ErpPage>;

  // ----- Métodos legados (deprecated, mantidos por compat) -----

  /**
   * @deprecated Use fetchCustomersPaged. Mantido como shim que consome
   * o async iterator e acumula em memória. Será removido em release futura.
   */
  fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult>;

  /**
   * @deprecated Use fetchDelinquentsPaged.
   */
  fetchDelinquents(config: ErpConnectionConfig, lastDays?: number): Promise<ErpFetchResult>;

  // ----- Single-record (sem mudança) -----

  fetchCustomerByCpf?(config: ErpConnectionConfig, cpfCnpj: string): Promise<ErpFetchResult>;
  fetchCustomersByCep?(config: ErpConnectionConfig, cep: string): Promise<ErpFetchResult>;
}
```

---

## Behavior Contracts

### MUST

1. **Iteração até `hasMore=false`**: o consumer pode consumir o iterator
   até o fim ou parar com `break`. Conector NÃO pode lançar exceção ao
   ser abortado prematuramente.

2. **`loopGuardHash` determinístico**: para o mesmo conjunto de primeiros
   10 cpfCnpj na mesma ordem, o hash MUST ser idêntico entre execuções.

3. **Idempotência das páginas**: chamar com `resumeFrom = { page: N }`
   MUST retornar a mesma página N (ou equivalente) que a iteração
   normal teria retornado. Não pode pular registros.

4. **`pageSize` respeitado quando possível**: se o ERP suporta o tamanho
   solicitado (≤ `maxPageSize`), conector MUST usar; caso contrário,
   usa `maxPageSize` e ajusta `loopGuardHash` consistentemente.

5. **Cancelamento via AbortSignal**: se `options.signal.aborted` for `true`
   antes da próxima requisição HTTP, conector MUST encerrar a iteração
   (lançando `AbortError` é aceitável).

### MUST NOT

1. **Conector NÃO pode acumular todas as páginas em memória interna** —
   exceto na estratégia `single-shot` onde o ERP não permite alternativa.

2. **Conector NÃO pode silenciosamente trocar de `pageSize`** sem
   atualizar `loopGuardHash` proporcionalmente.

3. **Conector NÃO pode emitir uma página com `hasMore=true` mas
   `records.length=0`** (exceto se for explicitamente o último que
   indica fim — nesse caso `hasMore=false`).

4. **Conector NÃO pode aceitar `resumeFrom` de tipo incompatível com sua
   estratégia** — DEVE lançar erro claro (`InvalidResumeTokenError`).

### MAY

1. Conector pode optar por hold open uma conexão HTTP (keep-alive) entre
   páginas para reduzir latência.

2. Conector pode emitir uma página final vazia (`records: []`, `hasMore:
   false`) como sinal de "fim limpo" se isso simplificar o controle de
   fluxo.

---

## Test Contract

Cada conector DEVE ter testes em `server/erp/connectors/<name>.test.ts`
cobrindo:

1. **`fetchCustomersPaged` retorna páginas válidas** (mocking HTTP).
2. **Última página tem `hasMore: false`**.
3. **`loopGuardHash` é consistente** para mesmo input.
4. **`resumeFrom` correto retorna mesma sequência**.
5. **`AbortSignal` aborta corretamente entre páginas**.
6. **Shim legado `fetchCustomers` continua funcionando** (consome iterator
   e acumula).
