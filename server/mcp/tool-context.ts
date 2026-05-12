/**
 * Spec 008.5 Batch 2 — Helpers compartilhados pelas tools MCP.
 *
 * Centraliza:
 *  1. Lookup de erpIntegrations por (providerId, erpSource)
 *  2. Construção de ErpConnectionConfig usando o helper canônico
 *     server/erp/config.ts
 *  3. Tipo ToolResult uniforme (sucesso/erro graceful — não throw)
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { erpIntegrations } from "@shared/schema";
import { buildConnectorConfig } from "../erp";
import type { ErpConnectionConfig } from "../erp/types";
import { getConnector } from "../erp/registry";
import type { ErpConnector } from "../erp/types";

/**
 * Resultado uniforme das tools MCP. Erros são representados como
 * `{ ok: false }` — não throw. Anthropic recebe a resposta e o agente
 * decide o que fazer.
 */
export interface ToolResult<T> {
  ok: boolean;
  message?: string;
  data?: T;
}

export function toolError(message: string): ToolResult<never> {
  return { ok: false, message };
}

export function toolSuccess<T>(data: T, message?: string): ToolResult<T> {
  return { ok: true, message, data };
}

/**
 * Resolve connector + config ERP do tenant. Centraliza o boilerplate.
 *
 * Retorna `{ ok: false, message }` se:
 *  - tenant não tem entry em erpIntegrations para esse erpSource
 *  - integração está desabilitada
 *  - connector não está registrado (typo no erpSource)
 *  - credenciais ausentes (apiUrl ou apiToken)
 */
export async function resolveErpForTenant(
  providerId: number,
  erpSource: string,
): Promise<
  | { ok: true; connector: ErpConnector; config: ErpConnectionConfig }
  | { ok: false; message: string }
> {
  const rows = await db
    .select()
    .from(erpIntegrations)
    .where(
      and(
        eq(erpIntegrations.providerId, providerId),
        eq(erpIntegrations.erpSource, erpSource),
      ),
    )
    .limit(1);

  const intg = rows[0];
  if (!intg) {
    return { ok: false, message: `ERP "${erpSource}" não configurado neste provedor` };
  }
  if (!intg.isEnabled) {
    return { ok: false, message: `ERP "${erpSource}" está desabilitado` };
  }
  if (!intg.apiUrl || !intg.apiToken) {
    return { ok: false, message: `ERP "${erpSource}" sem credenciais (apiUrl/apiToken)` };
  }

  const connector = getConnector(erpSource);
  if (!connector) {
    return { ok: false, message: `Connector "${erpSource}" não registrado` };
  }

  // buildConnectorConfig já existe em server/erp/config.ts — reusa
  const config = buildConnectorConfig({
    apiUrl: intg.apiUrl,
    apiToken: intg.apiToken,
    apiUser: intg.apiUser,
    clientId: (intg as any).clientId ?? null,
    clientSecret: (intg as any).clientSecret ?? null,
    mkContraSenha: (intg as any).mkContraSenha ?? null,
    sgpApp: (intg as any).sgpApp ?? null,
    voalleClientId: (intg as any).voalleClientId ?? null,
    extraConfig: (intg as any).extraConfig ?? null,
  });

  return { ok: true, connector, config };
}

/**
 * Lista os erpSource ativos para o tenant. Usado por erp_list_supported.
 */
export async function listEnabledErpSources(providerId: number): Promise<string[]> {
  const rows = await db
    .select({ erpSource: erpIntegrations.erpSource })
    .from(erpIntegrations)
    .where(
      and(
        eq(erpIntegrations.providerId, providerId),
        eq(erpIntegrations.isEnabled, true),
      ),
    );
  return rows.map((r) => r.erpSource).filter((s): s is string => !!s);
}
