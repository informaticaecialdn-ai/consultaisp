/**
 * TopSApp — Stub ERP Connector
 *
 * TopSApp does not have publicly documented API endpoints.
 * This stub ensures the platform recognizes TopSApp in the ERP catalog
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

export class TopsappConnector implements ErpConnector {
  readonly name = "topsapp";
  readonly label = "TopSApp";

  readonly configFields: ErpConfigField[] = [];

  async testConnection(_config: ErpConnectionConfig): Promise<ErpTestResult> {
    return {
      ok: false,
      message:
        "API nao documentada. Contate o suporte do TopSApp para obter credenciais de integracao.",
    };
  }

  async fetchDelinquents(_config: ErpConnectionConfig): Promise<ErpFetchResult> {
    throw new Error("Conector TopSApp nao implementado: API nao documentada");
  }

  async fetchCustomers(_config: ErpConnectionConfig): Promise<ErpFetchResult> {
    throw new Error("Conector TopSApp nao implementado: API nao documentada");
  }
}
