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
  extraConfig?: Record<string, string> | null;
}): ErpConnectionConfig {
  const extra: Record<string, string> = {};

  // Merge extraConfig jsonb field first (lower priority)
  if (intg.extraConfig && typeof intg.extraConfig === "object") {
    for (const [k, v] of Object.entries(intg.extraConfig)) {
      if (typeof v === "string") {
        extra[k] = v;
      }
    }
  }

  // OAuth fields for Hubsoft (higher priority — overwrite extraConfig if present)
  if (intg.clientId) {
    extra.clientId = intg.clientId;
  }
  if (intg.clientSecret) {
    extra.clientSecret = intg.clientSecret;
  }

  return {
    apiUrl: intg.apiUrl || "",
    apiToken: intg.apiToken || "",
    apiUser: intg.apiUser || "",
    extra,
  };
}
