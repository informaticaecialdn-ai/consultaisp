/**
 * Spec 008.5 Batch 2 — Tool: erp_get_invoices.
 *
 * Lista faturas de um cliente. Lê da tabela LOCAL `invoices` (não chama
 * o ERP em tempo real — usa cache sincronizado pelo erp-sync.service).
 *
 * Multi-tenant gate via providerId no WHERE.
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../../db";
import { invoices } from "@shared/schema";
import { toolSuccess, type ToolResult } from "../tool-context";
import type { McpAuthContext } from "../types";

export interface GetInvoicesArgs {
  customerId: number;
  status?: "pending" | "paid" | "overdue" | "cancelled";
  from?: string; // ISO date
  to?: string;
  limit?: number;
}

export interface InvoiceRow {
  id: number;
  value: number;
  dueDate: string;
  paidDate: string | null;
  status: string;
}

export interface GetInvoicesResult {
  customerId: number;
  total: number;
  invoices: InvoiceRow[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export async function execGetInvoices(
  ctx: McpAuthContext,
  args: GetInvoicesArgs,
): Promise<ToolResult<GetInvoicesResult>> {
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const conds = [
    eq(invoices.providerId, ctx.providerId), // multi-tenant gate
    eq(invoices.customerId, args.customerId),
  ];

  if (args.status) {
    conds.push(eq(invoices.status, args.status));
  }
  if (args.from) {
    conds.push(gte(invoices.dueDate, new Date(args.from)));
  }
  if (args.to) {
    conds.push(lte(invoices.dueDate, new Date(args.to)));
  }

  const rows = await db
    .select({
      id: invoices.id,
      value: invoices.value,
      dueDate: invoices.dueDate,
      paidDate: invoices.paidDate,
      status: invoices.status,
    })
    .from(invoices)
    .where(and(...conds))
    .orderBy(desc(invoices.dueDate))
    .limit(limit);

  const result: GetInvoicesResult = {
    customerId: args.customerId,
    total: rows.length,
    invoices: rows.map((r) => ({
      id: r.id,
      value: Number(r.value),
      dueDate: r.dueDate.toISOString(),
      paidDate: r.paidDate ? r.paidDate.toISOString() : null,
      status: r.status,
    })),
  };

  return toolSuccess(result, `${rows.length} faturas`);
}

export const ERP_GET_INVOICES_SCHEMA = {
  name: "erp_get_invoices",
  description:
    "Lista faturas de um cliente específico do provedor. Lê do CACHE LOCAL (sync com ERP em " +
    "background), não do ERP em tempo real — resposta rápida. Aceita filtro por status " +
    "(pending/paid/overdue/cancelled) e janela de datas (from/to ISO). " +
    "Use APÓS erp_get_customer para descobrir o customerId do cliente alvo.",
  inputSchema: {
    type: "object",
    properties: {
      customerId: {
        type: "integer",
        description: "ID local do cliente (retornado por erp_get_customer.id se exposto, ou inadimplentes)",
      },
      status: {
        type: "string",
        enum: ["pending", "paid", "overdue", "cancelled"],
        description: "Filtra por status da fatura",
      },
      from: {
        type: "string",
        description: "Data inicial ISO-8601 (ex: 2026-01-01)",
      },
      to: {
        type: "string",
        description: "Data final ISO-8601",
      },
      limit: {
        type: "integer",
        description: "Máximo de registros (default 50, max 500)",
      },
    },
    required: ["customerId"],
  },
} as const;
