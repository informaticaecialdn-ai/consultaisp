/**
 * Spec 008.6 — Managed Agents platform client.
 *
 * Wraps the Anthropic Managed Agents SDK (client.beta.agents/sessions) into
 * a high-level `invokeAgent()` call that adapters (server/agents/julia.ts etc.)
 * use to talk to the platform.
 *
 * Lifecycle of one invocation:
 *   1. Resolve agentId from env (AGENT_ID_{NAME})
 *   2. Resolve vaultId for tenant (providerId → ANTHROPIC_VAULT_ID_DEFAULT for MVP)
 *   3. Create session with agent + environment + vault
 *   4. Send user.message event with the userMessage payload
 *   5. Stream events, accumulating:
 *        - agent.message.content[].text → finalText
 *        - agent.tool_use / agent.custom_tool_use / agent.mcp_tool_use → toolCalls[]
 *        - agent.tool_result / agent.custom_tool_result / agent.mcp_tool_result → match by tool_use_id
 *   6. Stop on:
 *        - session.status_idle (with stop_reason: end_turn) → status="idled"
 *        - session.status_terminated → status="error"
 *        - timeout exceeded → status="error"
 *        - maxTurns exceeded → status="max_turns"
 *
 * Vault per tenant is a TODO — for MVP we use a single shared vault env var.
 * Once multi-tenant vault provisioning is wired (Spec 008.6 Batch 1.6+),
 * `resolveVaultId(providerId)` becomes a DB lookup.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../logger";
import {
  getAnthropicApiKey,
  type ManagedAgentName,
} from "../../env";
import type {
  AgentToolCall,
  InvokeAgentInput,
  ManagedAgentResult,
} from "./types";

const BETA_HEADER = "managed-agents-2026-04-01";

let _platformClient: Anthropic | null = null;

/**
 * Lazy singleton — only fails if a managed/shadow invocation is actually attempted.
 * This way the import doesn't break the server when ANTHROPIC_API_KEY is absent.
 */
export function getPlatformClient(): Anthropic {
  if (_platformClient) return _platformClient;
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new ManagedAgentsConfigError(
      "ANTHROPIC_API_KEY is not set — required for Managed Agents (Spec 008.6). " +
        "Configure it before enabling AGENT_RUNTIME_*=managed/shadow.",
    );
  }
  _platformClient = new Anthropic({ apiKey });
  return _platformClient;
}

export class ManagedAgentsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedAgentsConfigError";
  }
}

export class ManagedAgentsTimeoutError extends Error {
  constructor(public readonly sessionId: string, public readonly elapsedMs: number) {
    super(`Managed agent session ${sessionId} did not idle within ${elapsedMs}ms`);
    this.name = "ManagedAgentsTimeoutError";
  }
}

/**
 * MVP vault resolver: single shared vault from env. Multi-tenant vault
 * provisioning (1 vault per tenant) is a follow-up batch.
 *
 * Future: `providers.anthropicVaultId` column + admin UI to provision vault
 * automatically when tenant onboards Managed runtime.
 */
function resolveVaultId(_providerId: number): string | undefined {
  return process.env.ANTHROPIC_VAULT_ID_DEFAULT?.trim() || undefined;
}

function getEnvironmentId(): string {
  const id = process.env.ANTHROPIC_ENVIRONMENT_ID?.trim();
  if (!id) {
    throw new ManagedAgentsConfigError(
      "ANTHROPIC_ENVIRONMENT_ID is not set — required for Managed Agents sessions. " +
        "Create an environment in platform.claude.com/workspaces/{ws}/environments and paste its ID.",
    );
  }
  return id;
}

/**
 * Invoke a managed agent and wait for it to finish. The agent's tool-use loop
 * is fully handled by the platform; this function just streams events and
 * aggregates them into a ManagedAgentResult.
 *
 * Throws only on configuration errors (missing API key/env/agent ID). All
 * runtime issues (timeouts, agent errors, max turns) are returned as
 * `status: "error" | "max_turns"` so adapters can decide how to react.
 */
export async function invokeAgent(input: InvokeAgentInput): Promise<ManagedAgentResult> {
  const client = getPlatformClient();
  const started = Date.now();

  const agentId =
    input.agentIdOverride ?? envAgentId(input.agent);
  if (!agentId) {
    throw new ManagedAgentsConfigError(
      `AGENT_ID_${input.agent.toUpperCase()} is not set — paste the agt_xxx from platform.claude.com.`,
    );
  }

  const environmentId = getEnvironmentId();
  const vaultId = resolveVaultId(input.providerId);
  const maxTurns = input.maxTurns ?? 8;
  const timeoutMs = input.timeoutMs ?? 60_000;

  const correlationLogCtx = {
    agent: input.agent,
    providerId: input.providerId,
    correlationId: input.correlationId,
  };

  // 1. Create session
  let session;
  try {
    session = await client.beta.sessions.create(
      {
        agent: agentId,
        environment_id: environmentId,
        ...(vaultId ? { vault_ids: [vaultId] } : {}),
        title: `${input.agent} · provider ${input.providerId} · ${new Date().toISOString()}`,
        metadata: {
          provider_id: String(input.providerId),
          agent_name: input.agent,
          ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
        },
      },
      { headers: { "anthropic-beta": BETA_HEADER } },
    );
  } catch (err) {
    logger.error(
      { action: "managed_agent_create_session_failed", ...correlationLogCtx, err: (err as Error)?.message },
      "Failed to create managed agent session",
    );
    return errorResult(agentId, started, "error", (err as Error)?.message ?? "create_session_failed");
  }

  const sessionId = session.id;
  logger.info(
    { action: "managed_agent_session_created", sessionId, ...correlationLogCtx },
    "Managed agent session created",
  );

  // 2. Send user message
  try {
    await client.beta.sessions.events.send(
      sessionId,
      {
        events: [
          {
            type: "user.message",
            content: [{ type: "text", text: input.userMessage }],
          },
        ],
      },
      { headers: { "anthropic-beta": BETA_HEADER } },
    );
  } catch (err) {
    logger.error(
      { action: "managed_agent_send_event_failed", sessionId, ...correlationLogCtx, err: (err as Error)?.message },
      "Failed to send user.message to session",
    );
    return errorResult(agentId, started, "error", (err as Error)?.message ?? "send_event_failed", sessionId);
  }

  // 3. Stream events with timeout
  const toolCalls: AgentToolCall[] = [];
  const toolCallById = new Map<string, AgentToolCall>();
  let finalText = "";
  let turnsUsed = 0;
  let tokensInput = 0;
  let tokensOutput = 0;
  let status: ManagedAgentResult["status"] = "error";
  let errorMessage: string | undefined;

  const streamCtrl = new AbortController();
  const timeoutHandle = setTimeout(() => streamCtrl.abort(), timeoutMs);

  try {
    const stream = await client.beta.sessions.events.stream(
      sessionId,
      undefined,
      { headers: { "anthropic-beta": BETA_HEADER }, signal: streamCtrl.signal },
    );

    for await (const event of stream) {
      switch (event.type) {
        case "agent.message": {
          turnsUsed++;
          const textParts = (event.content ?? [])
            .filter((b) => b.type === "text")
            .map((b) => (b as { type: "text"; text: string }).text);
          if (textParts.length > 0) finalText = textParts.join("\n");
          if (turnsUsed > maxTurns) {
            status = "max_turns";
            errorMessage = `Exceeded maxTurns=${maxTurns}`;
            streamCtrl.abort();
          }
          break;
        }
        case "agent.tool_use":
        case "agent.custom_tool_use":
        case "agent.mcp_tool_use": {
          const ev = event as { id: string; name: string; input: Record<string, unknown> };
          const source = event.type === "agent.tool_use" ? "builtin" : event.type === "agent.custom_tool_use" ? "custom_http" : "mcp";
          const call: AgentToolCall = {
            toolName: ev.name,
            toolUseId: ev.id,
            input: ev.input ?? {},
            source,
            startedAt: new Date().toISOString(),
          };
          toolCalls.push(call);
          toolCallById.set(ev.id, call);
          break;
        }
        case "agent.tool_result": {
          const ev = event as { tool_use_id: string; content?: unknown; is_error?: boolean | null };
          const call = toolCallById.get(ev.tool_use_id);
          if (call) {
            call.output = ev.content;
            call.isError = ev.is_error ?? false;
            call.endedAt = new Date().toISOString();
          }
          break;
        }
        case "agent.mcp_tool_result": {
          const ev = event as { mcp_tool_use_id: string; content?: unknown; is_error?: boolean | null };
          const call = toolCallById.get(ev.mcp_tool_use_id);
          if (call) {
            call.output = ev.content;
            call.isError = ev.is_error ?? false;
            call.endedAt = new Date().toISOString();
          }
          break;
        }
        case "span.model_request_end": {
          const usage = (event as { model_usage?: { input_tokens?: number; output_tokens?: number } }).model_usage;
          if (usage) {
            tokensInput += usage.input_tokens ?? 0;
            tokensOutput += usage.output_tokens ?? 0;
          }
          break;
        }
        case "session.status_idle": {
          status = "idled";
          break;
        }
        case "session.status_terminated": {
          status = "error";
          errorMessage = "session.status_terminated";
          break;
        }
        case "session.error": {
          status = "error";
          const errPayload = (event as { error?: { message?: string; type?: string } }).error;
          errorMessage = errPayload?.message ?? errPayload?.type ?? "session.error";
          break;
        }
        default:
          // ignore other event types
          break;
      }

      if (status === "idled" || status === "max_turns" || (status === "error" && errorMessage)) {
        break;
      }
    }
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      status = status === "max_turns" ? "max_turns" : "error";
      errorMessage = errorMessage ?? `timeout after ${timeoutMs}ms`;
    } else {
      status = "error";
      errorMessage = (err as Error)?.message ?? "stream_failed";
    }
  } finally {
    clearTimeout(timeoutHandle);
  }

  const latencyMs = Date.now() - started;
  logger.info(
    {
      action: "managed_agent_invocation_done",
      sessionId,
      agentId,
      status,
      turnsUsed,
      toolCalls: toolCalls.length,
      tokensInput,
      tokensOutput,
      latencyMs,
      ...correlationLogCtx,
    },
    "Managed agent invocation finished",
  );

  return {
    anthropicSessionId: sessionId,
    anthropicAgentId: agentId,
    finalText,
    toolCalls,
    turnsUsed,
    latencyMs,
    tokensInput,
    tokensOutput,
    status,
    errorMessage,
  };
}

function envAgentId(agent: ManagedAgentName): string | undefined {
  const key = `AGENT_ID_${agent.toUpperCase()}`;
  return process.env[key]?.trim() || undefined;
}

function errorResult(
  agentId: string,
  started: number,
  status: "error" | "max_turns",
  errorMessage: string,
  sessionId = "",
): ManagedAgentResult {
  return {
    anthropicSessionId: sessionId,
    anthropicAgentId: agentId,
    finalText: "",
    toolCalls: [],
    turnsUsed: 0,
    latencyMs: Date.now() - started,
    tokensInput: 0,
    tokensOutput: 0,
    status,
    errorMessage,
  };
}
