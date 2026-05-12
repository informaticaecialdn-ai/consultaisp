/**
 * Spec 008.5 Batch 2 — Tool: erp_test_connection.
 *
 * Wraps `connector.testConnection(config)` para o tenant atual. Útil
 * para o agente diagnosticar antes de tentar listar dados.
 */

import { resolveErpForTenant, toolError, toolSuccess, type ToolResult } from "../tool-context";
import type { McpAuthContext } from "../types";

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export async function execTestConnection(
  ctx: McpAuthContext,
  args: { erpSource: string },
): Promise<ToolResult<TestConnectionResult>> {
  const resolved = await resolveErpForTenant(ctx.providerId, args.erpSource);
  if (!resolved.ok) return toolError(resolved.message);

  const start = Date.now();
  try {
    const result = await resolved.connector.testConnection(resolved.config);
    return toolSuccess(
      { ok: result.ok, message: result.message, latencyMs: result.latencyMs ?? Date.now() - start },
      result.ok ? "ERP respondeu" : "ERP indisponível",
    );
  } catch (err) {
    return toolError(`Falha ao testar ERP: ${(err as Error).message}`);
  }
}

export const ERP_TEST_CONNECTION_SCHEMA = {
  name: "erp_test_connection",
  description:
    "Valida conectividade com um ERP específico (IXC, MK, etc.). " +
    "Use quando uma erp_list_delinquents ou erp_get_customer falhar para diagnosticar " +
    "se o problema é credencial inválida, ERP fora do ar ou tenant sem integração.",
  inputSchema: {
    type: "object",
    properties: {
      erpSource: {
        type: "string",
        description: "Nome do ERP a testar (ex: 'ixc', 'mk', 'sgp', 'hubsoft', 'voalle', 'rbx')",
      },
    },
    required: ["erpSource"],
  },
} as const;
