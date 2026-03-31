/**
 * ERP Connector Engine — Config Builder
 *
 * Builds an ErpConnectionConfig from a database ErpIntegration record.
 * Handles OAuth fields (clientId, clientSecret) and extraConfig (jsonb).
 */

import type { ErpConnectionConfig } from "./types.js";

/**
 * Build an ErpConnectionConfig from an ERP integration database record.
 *
 * @param intg - Integration record from the database (erpIntegrations table)
 * @returns ErpConnectionConfig ready to pass to connector methods
 */
export function buildConnectorConfig(intg: {
  apiUrl: string | null;
  apiToken: string | null;
  apiUser?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  mkContraSenha?: string | null;
  sgpApp?: string | null;
  voalleClientId?: string | null;
  extraConfig?: unknown;
}): ErpConnectionConfig {
  const extra: Record<string, string> = {};

  // Merge extraConfig jsonb field first (lower priority)
  if (intg.extraConfig && typeof intg.extraConfig === "object") {
    for (const [k, v] of Object.entries(intg.extraConfig as Record<string, unknown>)) {
      if (typeof v === "string") {
        extra[k] = v;
      }
    }
  }

  // ERP-specific fields into extra (higher priority)
  if (intg.sgpApp) extra.sgpApp = intg.sgpApp;
  if (intg.voalleClientId) extra.voalleClientId = intg.voalleClientId;

  return {
    apiUrl: intg.apiUrl || "",
    apiToken: intg.apiToken || "",
    apiUser: intg.apiUser || "",
    clientId: intg.clientId || undefined,
    clientSecret: intg.clientSecret || undefined,
    mkContraSenha: intg.mkContraSenha || undefined,
    extra,
  };
}
