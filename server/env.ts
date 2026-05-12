import { logger } from "./logger";

const REQUIRED_VARS = ["DATABASE_URL", "SESSION_SECRET"] as const;

export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.fatal({ missing }, "Missing required environment variables");
    process.exit(1);
  }
  // LGPD compliance warnings
  if (!process.env.NETWORK_CPF_SALT) {
    logger.warn("NETWORK_CPF_SALT not set — CPF hashing disabled. Set a 32+ char salt for LGPD compliance.");
  }
  logger.info("Environment validated");
}

export function getAsaasWebhookToken(): string | undefined {
  return process.env.ASAAS_WEBHOOK_TOKEN?.trim() || undefined;
}

// ─── Spec 008.5 — MCP ERP wrapper config ──────────────────────────────
/**
 * Base URL público do MCP server. Em prod aponta pra `https://provedor.ai/mcp/erp`.
 * É o endpoint que o owner cadastra no Vault da Anthropic Platform.
 */
export function getMcpBaseUrl(): string {
  return process.env.MCP_BASE_URL?.trim() || "http://localhost:5000/mcp/erp";
}

/**
 * MCP server é sempre habilitado quando rodando (não depende de env var
 * adicional — auth é via bearer no DB). Pode ser desabilitado via
 * `MCP_DISABLED=1` se necessário em algum ambiente.
 */
export function isMcpEnabled(): boolean {
  return process.env.MCP_DISABLED?.trim() !== "1";
}

// ─── Spec 008.6 — Managed Agents config ──────────────────────────────

export type ManagedAgentName = "julia" | "bruno" | "helena" | "sofia";
export type AgentRuntime = "direct" | "shadow" | "managed";

/**
 * Anthropic API key — usada tanto pelo Direct API (createMessage) quanto
 * pelo Managed Agents SDK (client.beta.agents/sessions). Centralizada:
 * Provedor.ai paga, repassa custo via success fee.
 */
export function getAnthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

/**
 * Workspace ID na platform.claude.com (ex: ws_xxx). Cada workspace tem seu
 * próprio billing + vault namespace. Recomendado: 1 workspace dedicado
 * (`provedor-ai-prod`).
 */
export function getAnthropicWorkspaceId(): string | undefined {
  return process.env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined;
}

/**
 * Agent ID na plataforma Anthropic para um dos 4 agents Spec 008.6.
 * Owner cria o agent em platform.claude.com e cola o `agt_xxx` em .env.
 *
 * Mapeamento por env var:
 *   julia  → AGENT_ID_JULIA
 *   bruno  → AGENT_ID_BRUNO
 *   helena → AGENT_ID_HELENA
 *   sofia  → AGENT_ID_SOFIA
 */
export function getAgentId(agent: ManagedAgentName): string | undefined {
  const key = `AGENT_ID_${agent.toUpperCase()}`;
  return process.env[key]?.trim() || undefined;
}

/**
 * Runtime escolhido para cada agente. Default = "direct" (comportamento
 * atual com Direct API local). Cutover por agente sem deploy adicional.
 *
 * - `direct`: comportamento atual (server/agents/{name}.ts)
 * - `shadow`: roda direct + managed em paralelo, retorna direct, loga diff
 * - `managed`: roda apenas managed (Anthropic Platform)
 */
export function getAgentRuntime(agent: ManagedAgentName): AgentRuntime {
  const key = `AGENT_RUNTIME_${agent.toUpperCase()}`;
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === "shadow" || raw === "managed") return raw;
  return "direct";
}
