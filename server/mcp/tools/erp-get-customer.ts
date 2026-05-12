/**
 * Spec 008.5 Batch 2 — Tool: erp_get_customer.
 *
 * Recupera UM cliente por CPF/CNPJ com PII condicional. Padrão é mascarado;
 * `unmasked: true` requer scope `read_pii` no token (caso contrário, ignora
 * o flag e retorna mascarado igual).
 *
 * Multi-tenant gate: usa fetchCustomerByCpf do connector que já é scoped
 * por providerId via config. Se o ERP retornar cliente, ele DEVE ser do
 * tenant — porque connector.config tem credenciais do tenant.
 */

import {
  resolveErpForTenant,
  toolError,
  toolSuccess,
  type ToolResult,
} from "../tool-context";
import { maskCustomerPii } from "./pii-masking";
import { hasScope, type McpAuthContext } from "../types";

export interface GetCustomerArgs {
  erpSource: string;
  cpfCnpj: string;
  unmasked?: boolean;
}

export interface GetCustomerResult {
  cpfCnpj: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string;
  state?: string;
  cep?: string | null;
  totalOverdueAmount: number;
  maxDaysOverdue: number;
  overdueInvoicesCount?: number;
  hasUnreturnedEquipment?: boolean;
  unreturnedEquipmentCount?: number;
  erpSource: string;
  /** True quando os campos PII foram mascarados (vide LGPD §6º). */
  masked: boolean;
}

function normalizeCpfCnpj(raw: string): string {
  return raw.replace(/\D/g, "");
}

export async function execGetCustomer(
  ctx: McpAuthContext,
  args: GetCustomerArgs,
): Promise<ToolResult<GetCustomerResult>> {
  const cleaned = normalizeCpfCnpj(args.cpfCnpj);
  if (cleaned.length !== 11 && cleaned.length !== 14) {
    return toolError("cpfCnpj precisa ter 11 (CPF) ou 14 (CNPJ) dígitos");
  }

  const resolved = await resolveErpForTenant(ctx.providerId, args.erpSource);
  if (!resolved.ok) return toolError(resolved.message);

  if (!resolved.connector.fetchCustomerByCpf) {
    return toolError(
      `Connector "${args.erpSource}" não suporta busca por CPF (use erp_list_delinquents e filtre)`,
    );
  }

  let result;
  try {
    result = await resolved.connector.fetchCustomerByCpf(resolved.config, cleaned);
  } catch (err) {
    return toolError(`ERP "${args.erpSource}" falhou: ${(err as Error).message}`);
  }

  if (!result.ok || result.customers.length === 0) {
    // Não vaza existência — agnostic message
    return toolError("Cliente não encontrado neste provedor");
  }

  const customer = result.customers[0];

  // Decisão de masking:
  //  - Default: mascarado
  //  - Se token tem scope read_pii E caller pediu unmasked=true: retorna PII real
  const wantsUnmasked = args.unmasked === true;
  const allowedUnmasked = hasScope(ctx, "read_pii");
  const shouldMask = !(wantsUnmasked && allowedUnmasked);

  const dataRaw = {
    cpfCnpj: customer.cpfCnpj,
    name: customer.name,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    address: customer.address ?? null,
    city: customer.city,
    state: customer.state,
    cep: customer.cep ?? null,
    totalOverdueAmount: customer.totalOverdueAmount,
    maxDaysOverdue: customer.maxDaysOverdue,
    overdueInvoicesCount: customer.overdueInvoicesCount,
    hasUnreturnedEquipment: customer.hasUnreturnedEquipment,
    unreturnedEquipmentCount: customer.unreturnedEquipmentCount,
    erpSource: customer.erpSource,
  };

  const data: GetCustomerResult = shouldMask
    ? { ...maskCustomerPii(dataRaw), masked: true } as GetCustomerResult
    : { ...dataRaw, masked: false };

  return toolSuccess(
    data,
    shouldMask ? "Cliente encontrado (PII mascarada)" : "Cliente encontrado (PII completa)",
  );
}

export const ERP_GET_CUSTOMER_SCHEMA = {
  name: "erp_get_customer",
  description:
    "Recupera UM cliente do ERP por CPF/CNPJ. Use APÓS erp_list_delinquents quando precisar " +
    "de detalhe de um cliente específico (ex: para gerar PIX, abordar via WhatsApp). " +
    "PII (CPF, nome, telefone, endereço) é MASCARADA por padrão. " +
    "Para receber PII real, passe unmasked=true E o token MCP precisa ter scope 'read_pii'. " +
    "O campo `masked` no retorno indica se a resposta veio mascarada. " +
    "NÃO use em loop (1 chamada por cliente) — para listagens, use erp_list_delinquents.",
  inputSchema: {
    type: "object",
    properties: {
      erpSource: {
        type: "string",
        description: "Nome do ERP (use erp_list_supported para descobrir)",
      },
      cpfCnpj: {
        type: "string",
        description:
          "CPF (11 dígitos) ou CNPJ (14 dígitos). Aceita formatado (xxx.xxx.xxx-xx) ou só dígitos",
      },
      unmasked: {
        type: "boolean",
        description:
          "Se true E o token tem scope 'read_pii', retorna PII real. Default false (mascarado).",
      },
    },
    required: ["erpSource", "cpfCnpj"],
  },
} as const;
