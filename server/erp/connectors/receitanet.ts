/**
 * Receita Net — Stub ERP Connector
 *
 * Receita Net does not have publicly documented API endpoints.
 * This stub ensures the platform recognizes Receita Net in the ERP catalog
 * while clearly communicating that integration requires API documentation
 * from the vendor.
 */

import type {
  ErpConnector,
  ErpConfigField,
  ErpConnectionConfig,
  ErpTestResult,
  ErpFetchResult,
} from "../types.js";

export class ReceitanetConnector implements ErpConnector {
  readonly name = "receitanet";
  readonly label = "Receita Net";

  readonly configFields: ErpConfigField[] = [];

  async testConnection(_config: ErpConnectionConfig): Promise<ErpTestResult> {
    return {
      ok: false,
      message:
        "API nao documentada. Contate o suporte do Receita Net para obter credenciais de integracao.",
    };
  }

  async fetchDelinquents(_config: ErpConnectionConfig): Promise<ErpFetchResult> {
    throw new Error("Conector Receita Net nao implementado: API nao documentada");
  }

  async fetchCustomers(_config: ErpConnectionConfig): Promise<ErpFetchResult> {
    throw new Error("Conector Receita Net nao implementado: API nao documentada");
  }
}
