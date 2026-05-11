/**
 * Anthropic SDK client wrapper for the Júlia + Helena agents (Spec 003).
 *
 * - Reads `ANTHROPIC_API_KEY` from env at first use (lazy init for tests).
 * - `createMessage()` supports prompt caching via `cache_control` markers on system blocks.
 * - Retries up to 3x with exponential backoff (250ms, 500ms, 1000ms) on 429/5xx.
 * - Returns the raw Anthropic Message so callers can inspect `stop_reason`,
 *   `tool_use` blocks, and the cache usage counters on `usage`.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  TextBlockParam,
  Tool,
  ToolChoice,
} from "@anthropic-ai/sdk/resources/messages";
import { logger } from "../logger";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — required for Júlia/Helena agents (Spec 003).",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * System prompt blocks. A plain string is the simplest form; the array form
 * lets the caller mark blocks for prompt caching via `cache_control`.
 *
 * Example with caching:
 *   system: [
 *     { type: "text", text: BIG_STATIC_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
 *     { type: "text", text: dynamicContextSnippet },
 *   ]
 */
export type SystemPrompt = string | TextBlockParam[];

export interface CreateMessageOptions {
  model: string;
  /** Plain string OR array of text blocks (with optional cache_control). */
  system: SystemPrompt;
  messages: MessageParam[];
  tools?: Tool[];
  tool_choice?: ToolChoice;
  /** Defaults to 1024. */
  max_tokens?: number;
  /** Defaults to 0 (deterministic) for compliance + tool-use loops. */
  temperature?: number;
  /**
   * If true (default), caller is opting in to prompt caching. The system
   * block(s) must include `cache_control` markers themselves — this flag is
   * only a convenience for logging cache hits.
   */
  cache?: boolean;
  /** Optional correlation identifier for structured logs. */
  correlationId?: string;
  /** Hard upper bound on retries. Defaults to 3. */
  maxRetries?: number;
}

export interface CreateMessageResult {
  message: Message;
  latencyMs: number;
  /** True when Anthropic served at least 1 token from the prompt cache. */
  cacheHit: boolean;
  /** Total input tokens billed (cache reads count separately). */
  tokensInput: number;
  /** Output tokens generated. */
  tokensOutput: number;
  attempts: number;
}

const DEFAULT_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  // The Anthropic SDK exposes APIError with `.status`. We retry on 408/409/429/5xx
  // and on network-level failures (no status, e.g. ECONNRESET).
  const anyErr = err as { status?: number; name?: string } | undefined;
  if (!anyErr) return false;
  const status = anyErr.status;
  if (status === undefined) return true; // network error
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function createMessage(opts: CreateMessageOptions): Promise<CreateMessageResult> {
  const client = getClient();
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const started = Date.now();

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const message = await client.messages.create({
        model: opts.model,
        max_tokens: opts.max_tokens ?? 1024,
        temperature: opts.temperature ?? 0,
        system: opts.system,
        messages: opts.messages,
        ...(opts.tools ? { tools: opts.tools } : {}),
        ...(opts.tool_choice ? { tool_choice: opts.tool_choice } : {}),
      });

      const latencyMs = Date.now() - started;
      const usage = message.usage ?? ({} as Message["usage"]);
      // Cache-aware tokens: cache_read_input_tokens means we got a cache hit.
      const cacheReadTokens =
        (usage as unknown as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
      const cacheCreationTokens =
        (usage as unknown as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;
      const cacheHit = cacheReadTokens > 0;
      const tokensInput = (usage.input_tokens ?? 0) + cacheReadTokens + cacheCreationTokens;
      const tokensOutput = usage.output_tokens ?? 0;

      logger.debug(
        {
          action: "anthropic_create_message",
          model: opts.model,
          attempts: attempt,
          latencyMs,
          cacheHit,
          tokensInput,
          tokensOutput,
          stopReason: message.stop_reason,
          correlationId: opts.correlationId,
        },
        "anthropic message created",
      );

      return { message, latencyMs, cacheHit, tokensInput, tokensOutput, attempts: attempt };
    } catch (err) {
      lastError = err;
      const retryable = isRetryable(err) && attempt < maxRetries;
      const backoffMs = 250 * Math.pow(2, attempt - 1); // 250, 500, 1000
      logger.warn(
        {
          action: "anthropic_create_message_error",
          model: opts.model,
          attempt,
          willRetry: retryable,
          backoffMs: retryable ? backoffMs : 0,
          err: (err as Error)?.message,
          correlationId: opts.correlationId,
        },
        "anthropic create message failed",
      );
      if (!retryable) break;
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Anthropic createMessage failed: ${String(lastError)}`);
}

export { getClient as getAnthropicClient };
