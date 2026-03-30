/**
 * ERP Connector Engine — Resilience Module
 *
 * Provides retry (via p-retry) and circuit breaker patterns for ERP API calls.
 * Prevents cascading failures when an ERP API is down or degraded.
 */

import pRetry, { AbortError } from "p-retry";

type CircuitState = "closed" | "open" | "half-open";

/** Error thrown when the circuit breaker is open and rejecting calls */
export class CircuitOpenError extends Error {
  constructor(message = "Circuit breaker is open — requests are being rejected") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

/**
 * Circuit Breaker implementation.
 *
 * States:
 * - CLOSED: normal operation, tracking consecutive failures
 * - OPEN: rejecting all calls until resetTimeMs elapses
 * - HALF_OPEN: allowing one probe call — success resets, failure re-opens
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly maxFailures: number;
  private readonly resetTimeMs: number;

  constructor(options?: { maxFailures?: number; resetTimeMs?: number }) {
    this.maxFailures = options?.maxFailures ?? 5;
    this.resetTimeMs = options?.resetTimeMs ?? 30_000;
  }

  getState(): CircuitState {
    // Check if open circuit should transition to half-open
    if (this.state === "open" && Date.now() - this.lastFailureTime >= this.resetTimeMs) {
      this.state = "half-open";
    }
    return this.state;
  }

  /** Manual reset — forces circuit back to closed state */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  /** Execute a function through the circuit breaker */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "open") {
      throw new CircuitOpenError();
    }

    try {
      const result = await fn();

      // Success — reset to closed
      if (currentState === "half-open") {
        this.reset();
      } else {
        this.failureCount = 0;
      }

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (currentState === "half-open") {
        // Probe failed — re-open
        this.state = "open";
      } else if (this.failureCount >= this.maxFailures) {
        // Too many consecutive failures — open the circuit
        this.state = "open";
      }

      throw error;
    }
  }
}

export interface ResilienceOptions {
  /** Number of retries (default: 3) */
  retries?: number;
  /** Minimum timeout between retries in ms (default: 1000) */
  minTimeout?: number;
  /** Circuit breaker instance (optional) */
  circuit?: CircuitBreaker;
}

/**
 * Wrap an async function with retry logic and optional circuit breaker.
 *
 * - Retries with exponential backoff (factor 2) using p-retry
 * - Non-retryable errors (HTTP 4xx) abort immediately
 * - If a circuit breaker is provided, the retried function runs inside it
 */
export async function withResilience<T>(
  fn: () => Promise<T>,
  options?: ResilienceOptions,
): Promise<T> {
  const { retries = 3, minTimeout = 1000, circuit } = options ?? {};

  const retriedFn = () =>
    pRetry(
      async () => {
        try {
          return await fn();
        } catch (error: unknown) {
          // Abort retry on client errors (4xx) — these won't resolve with retries
          if (isHttpClientError(error)) {
            throw new AbortError(
              error instanceof Error ? error.message : "HTTP client error (4xx)",
            );
          }
          throw error;
        }
      },
      {
        retries,
        minTimeout,
        factor: 2,
      },
    );

  if (circuit) {
    return circuit.execute(retriedFn);
  }

  return retriedFn();
}

/** Check if an error represents an HTTP 4xx client error */
function isHttpClientError(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status;
    return status >= 400 && status < 500;
  }
  if (error && typeof error === "object" && "statusCode" in error) {
    const statusCode = (error as { statusCode: number }).statusCode;
    return statusCode >= 400 && statusCode < 500;
  }
  return false;
}
