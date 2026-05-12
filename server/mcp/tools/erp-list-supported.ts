/**
 * Spec 008.5 Batch 2 — Tool: erp_list_supported.
 *
 * Lista os erpSource ativos para o tenant autenticado. Sem PII —
 * apenas metadados de configuração.
 */

import { listEnabledErpSources, toolSuccess, type ToolResult } from "../tool-context";
import type { McpAuthContext } from "../types";

export interface ListSupportedResult {
  erpSources: string[];
}

export async function execListSupported(
  ctx: McpAuthContext,
): Promise<ToolResult<ListSupportedResult>> {
  const sources = await listEnabledErpSources(ctx.providerId);
  return toolSuccess(
    { erpSources: sources },
    `${sources.length} ERP(s) ativo(s) neste provedor`,
  );
}

export const ERP_LIST_SUPPORTED_SCHEMA = {
  name: "erp_list_supported",
  description:
    "Lista os ERPs (IXC, MK, SGP, Hubsoft, Voalle, RBX, etc.) ativos para o provedor autenticado. " +
    "Use ANTES de qualquer outra erp_* tool para confirmar quais sources estão disponíveis. " +
    "Não recebe parâmetros — o provedor é resolvido implicitamente do bearer token.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
} as const;
