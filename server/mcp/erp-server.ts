/**
 * Spec 008.5 Batch 3 — Servidor MCP que expõe os connectors ERP como tools.
 *
 * Uma instância do MCP `Server` por request (stateless) — segura por design,
 * cada request tem seu próprio McpAuthContext propagado das tool calls.
 *
 * Fluxo:
 *   1. Client (Anthropic Platform) chama POST /mcp/erp com bearer
 *   2. Middleware `requireMcpAuth` valida e injeta req.mcpAuth
 *   3. Express handler cria Server+Transport, conecta, processa request
 *   4. Tool handlers usam ctx = req.mcpAuth pra resolver tenant
 *   5. Audit log entry para cada tool call
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpAuthContext, McpToolName } from "./types";
import { canUseTool } from "./types";
import { logMcpToolCall } from "./audit";

import {
  execListSupported,
  ERP_LIST_SUPPORTED_SCHEMA,
} from "./tools/erp-list-supported";
import {
  execTestConnection,
  ERP_TEST_CONNECTION_SCHEMA,
} from "./tools/erp-test-connection";
import {
  execListDelinquents,
  ERP_LIST_DELINQUENTS_SCHEMA,
} from "./tools/erp-list-delinquents";
import {
  execGetCustomer,
  ERP_GET_CUSTOMER_SCHEMA,
} from "./tools/erp-get-customer";
import {
  execGetInvoices,
  ERP_GET_INVOICES_SCHEMA,
} from "./tools/erp-get-invoices";

const ALL_TOOLS = [
  ERP_LIST_SUPPORTED_SCHEMA,
  ERP_TEST_CONNECTION_SCHEMA,
  ERP_LIST_DELINQUENTS_SCHEMA,
  ERP_GET_CUSTOMER_SCHEMA,
  ERP_GET_INVOICES_SCHEMA,
];

/**
 * Despacha tool call para o handler correto. Valida que o token tem
 * permissão pra essa tool (`allowedTools`). Retorna `{ ok: false }` se
 * tool desconhecida.
 */
async function dispatchTool(
  ctx: McpAuthContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // Tool permission check
  if (!canUseTool(ctx, toolName as McpToolName)) {
    return { ok: false, message: `Tool "${toolName}" não autorizada para este token` };
  }

  const start = Date.now();
  let result: { ok: boolean; message?: string; data?: unknown };
  let error: string | undefined;

  try {
    switch (toolName) {
      case "erp_list_supported":
        result = await execListSupported(ctx);
        break;
      case "erp_test_connection":
        result = await execTestConnection(ctx, args as { erpSource: string });
        break;
      case "erp_list_delinquents":
        result = await execListDelinquents(
          ctx,
          args as unknown as Parameters<typeof execListDelinquents>[1],
        );
        break;
      case "erp_get_customer":
        result = await execGetCustomer(
          ctx,
          args as unknown as Parameters<typeof execGetCustomer>[1],
        );
        break;
      case "erp_get_invoices":
        result = await execGetInvoices(
          ctx,
          args as unknown as Parameters<typeof execGetInvoices>[1],
        );
        break;
      default:
        result = { ok: false, message: `Tool desconhecida: ${toolName}` };
    }
  } catch (err) {
    error = (err as Error).message;
    result = { ok: false, message: "Erro interno na tool" };
  }

  // Audit log fire-and-forget — não bloqueia retorno
  void logMcpToolCall(ctx, {
    tool: toolName as McpToolName,
    args,
    result: {
      ok: result.ok,
      message: result.message,
      recordCount:
        Array.isArray((result.data as { customers?: unknown[] } | undefined)?.customers)
          ? (result.data as { customers: unknown[] }).customers.length
          : undefined,
    },
    masked: extractMaskedFlag(result.data),
    latencyMs: Date.now() - start,
    error,
  });

  return result;
}

function extractMaskedFlag(data: unknown): boolean | undefined {
  if (data && typeof data === "object" && "masked" in data) {
    const v = (data as { masked: unknown }).masked;
    return typeof v === "boolean" ? v : undefined;
  }
  return undefined;
}

/**
 * Cria uma nova instância do servidor MCP. Use 1 instância por request
 * — não compartilhar state entre tenants.
 */
export function createMcpErpServer(ctx: McpAuthContext): Server {
  const server = new Server(
    { name: "provedor-ai-erp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // tools/list
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};
    const result = await dispatchTool(ctx, toolName, args as Record<string, unknown>);

    // MCP retorna content[] de texto. Convertemos JSON pra string.
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result),
        },
      ],
      isError: !(result as { ok?: boolean }).ok,
    };
  });

  return server;
}
