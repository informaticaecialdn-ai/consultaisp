/**
 * Shared types for Spec 008.6 — Managed Agents migration.
 *
 * Lives in `server/services/agents/` (not `server/agents/`) to make explicit
 * separation between:
 *   - server/agents/ → Direct API legacy implementations (julia.ts, bruno.ts, ...)
 *   - server/services/agents/ → Managed Agents runtime + adapters
 *
 * Adapters in `server/agents/{name}.ts` check `getAgentRuntime(name)` and
 * dispatch either to local Direct API logic OR to `platform-client.invokeAgent`.
 */

import type { ManagedAgentName, AgentRuntime } from "../../env";

export type { ManagedAgentName, AgentRuntime };

/**
 * Tool call observed during a managed session — used by adapters/loggers
 * to reconstruct what the agent did when streaming events from the platform.
 */
export interface AgentToolCall {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  source: "mcp" | "custom_http" | "builtin";
  startedAt: string;
  endedAt?: string;
}

/**
 * Output of `invokeAgent()`. The adapter for each agent (julia/bruno/etc.)
 * is responsible for translating `finalText` + tool calls into its own
 * domain shape (JuliaDecision, BrunoResult, ...).
 */
export interface ManagedAgentResult {
  /** sess_xxx returned by the platform */
  anthropicSessionId: string;
  /** agt_xxx (the agent invoked) */
  anthropicAgentId: string;
  /** Final text content from the assistant (last assistant message). */
  finalText: string;
  /** All tool calls observed in this session (in order). */
  toolCalls: AgentToolCall[];
  /** Number of assistant turns / tool-use loops. */
  turnsUsed: number;
  /** Latency wall-clock in ms (from create session to status_idled). */
  latencyMs: number;
  /** Token accounting reported by the platform. */
  tokensInput: number;
  tokensOutput: number;
  /** Status returned by stream loop: "idled" (success), "max_turns", "error". */
  status: "idled" | "max_turns" | "error";
  errorMessage?: string;
}

/**
 * Mirror of `agent_invocations` row — used by `invocation-log.ts` to record
 * each invocation (direct, managed, or shadow pair).
 */
export interface InvocationRecord {
  providerId: number;
  agentId: ManagedAgentName;
  runtime: AgentRuntime;
  anthropicSessionId?: string | null;
  anthropicAgentId?: string | null;
  inputHash?: string | null;
  outputJson?: unknown;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  latencyMs?: number | null;
  status: "ok" | "error" | "timeout" | "diff";
  errorMessage?: string | null;
  correlationId?: string | null;
  pairedInvocationId?: number | null;
  endedAt?: Date | null;
}

/**
 * Input contract for `platform-client.invokeAgent()`. Caller supplies what
 * makes the invocation tenant-scoped (providerId → vault lookup) and what
 * the agent should answer to (`userMessage`). The platform handles the
 * tool-use loop internally; the adapter receives the final result.
 */
export interface InvokeAgentInput {
  agent: ManagedAgentName;
  /**
   * Optional override: by default `getAgentId(agent)` from env is used.
   * Useful for tests or staging-specific agent versions.
   */
  agentIdOverride?: string;
  providerId: number;
  /** What the agent should process (free-text or JSON serialized payload). */
  userMessage: string;
  correlationId?: string;
  /**
   * Hard upper bound on tool-use turns inside the session. Default 8 (Helena).
   * Júlia/Bruno/Sofia normally finish in 1-2 turns.
   */
  maxTurns?: number;
  /**
   * Idle timeout in ms — if the platform doesn't reach `status_idled` within
   * this window, the invocation is aborted and `status: "error"` returned.
   * Default 60_000ms (60s).
   */
  timeoutMs?: number;
}

/**
 * Result of an adapter's `compare()` call in shadow mode. Used to flag
 * meaningful divergences (e.g., Júlia decided APPROVED in direct but
 * BLOCKED in managed) for human review.
 */
export interface ShadowComparison<TOutput> {
  agent: ManagedAgentName;
  direct: TOutput;
  managed: TOutput;
  identical: boolean;
  significantDiff: boolean;
  diffSummary?: string;
}
