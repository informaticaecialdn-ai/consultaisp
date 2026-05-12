/**
 * Spec 008.5 Batch 2 — Tool: erp_list_delinquents.
 *
 * Lista inadimplentes do ERP do tenant. Sempre retorna mascarado
 * (lista agregada não justifica unmasked PII em massa). Filtros
 * minValue/daysOverdue aplicados em memory por simplicidade.
 */

import { resolveErpForTenant, toolError, toolSuccess, type ToolResult } from "../tool-context";
import { maskCustomerPii } from "./pii-masking";
import type { McpAuthContext } from "../types";

interface DelinquentRow {
  cpfCnpj: string;
  name: string;
  totalOverdueAmount: number;
  maxDaysOverdue: number;
  overdueInvoicesCount?: number;
  hasUnreturnedEquipment?: boolean;
  city?: string;
  state?: string;
  erpSource: string;
}

export interface ListDelinquentsArgs {
  erpSource: string;
  minValue?: number;
  daysOverdue?: number;
  limit?: number;
  offset?: number;
}

export interface ListDelinquentsResult {
  total: number;
  customers: DelinquentRow[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export async function execListDelinquents(
  ctx: McpAuthContext,
  args: ListDelinquentsArgs,
): Promise<ToolResult<ListDelinquentsResult>> {
  const resolved = await resolveErpForTenant(ctx.providerId, args.erpSource);
  if (!resolved.ok) return toolError(resolved.message);

  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = args.offset ?? 0;

  let result;
  try {
    result = await resolved.connector.fetchDelinquents(resolved.config);
  } catch (err) {
    return toolError(`ERP "${args.erpSource}" falhou: ${(err as Error).message}`);
  }

  if (!result.ok) {
    return toolError(result.message || "ERP retornou erro");
  }

  // Filtros em memory — connectors retornam tudo, MCP filtra por args
  let filtered = result.customers;
  if (typeof args.minValue === "number") {
    filtered = filtered.filter((c) => c.totalOverdueAmount >= args.minValue!);
  }
  if (typeof args.daysOverdue === "number") {
    filtered = filtered.filter((c) => c.maxDaysOverdue >= args.daysOverdue!);
  }

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  // Sempre mascarado em listagens — agente não precisa de PII em massa
  const customers = page.map((c) => {
    const masked = maskCustomerPii(c);
    return {
      cpfCnpj: masked.cpfCnpj || "",
      name: masked.name || "",
      totalOverdueAmount: c.totalOverdueAmount,
      maxDaysOverdue: c.maxDaysOverdue,
      overdueInvoicesCount: c.overdueInvoicesCount,
      hasUnreturnedEquipment: c.hasUnreturnedEquipment,
      city: c.city || undefined,
      state: c.state || undefined,
      erpSource: c.erpSource,
    } satisfies DelinquentRow;
  });

  return toolSuccess(
    { total, customers },
    `${customers.length} de ${total} inadimplentes (mascarado)`,
  );
}

export const ERP_LIST_DELINQUENTS_SCHEMA = {
  name: "erp_list_delinquents",
  description:
    "Lista clientes INADIMPLENTES do ERP do provedor. Retorna nomes/CPFs MASCARADOS " +
    "(necessário para LGPD em listagens em massa). Para detalhe de UM cliente específico " +
    "com dados reais, use erp_get_customer com cpfCnpj e unmasked=true (requer scope read_pii). " +
    "Filtros minValue (R$) e daysOverdue são aplicados após o fetch — útil para focar em casos prioritários. " +
    "Sempre paginar com limit/offset (default limit=50, max=500).",
  inputSchema: {
    type: "object",
    properties: {
      erpSource: {
        type: "string",
        description: "Nome do ERP (use erp_list_supported para descobrir os ativos)",
      },
      minValue: {
        type: "number",
        description: "Filtra clientes com dívida total ≥ este valor (R$)",
      },
      daysOverdue: {
        type: "number",
        description: "Filtra clientes com atraso máximo ≥ este número de dias",
      },
      limit: {
        type: "integer",
        description: "Máximo de registros nesta página (default 50, max 500)",
      },
      offset: {
        type: "integer",
        description: "Pular N registros para paginar (default 0)",
      },
    },
    required: ["erpSource"],
  },
} as const;
