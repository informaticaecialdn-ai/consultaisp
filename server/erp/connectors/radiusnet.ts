/**
 * RadiusNet — Stub ERP Connector
 *
 * RadiusNet does not have publicly documented API endpoints.
 * This stub ensures the platform recognizes RadiusNet in the ERP catalog
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

export class RadiusnetConnector implements ErpConnector {
  readonly name = "radiusnet";
  readonly label = "RadiusNet";

  readonly configFields: ErpConfigField[] = [];

  async testConnection(_config: ErpConnectionConfig): Promise<ErpTestResult> {
    return {
      ok: false,
      message:
        "API nao documentada. Contate o suporte do RadiusNet para obter credenciais de integracao.",
    };
  }

  async fetchDelinquents(_config: ErpConnectionConfig): Promise<ErpFetchResult> {
    throw new Error("Conector RadiusNet nao implementado: API nao documentada");
  }

  async fetchCustomers(_config: ErpConnectionConfig): Promise<ErpFetchResult> {
    throw new Error("Conector RadiusNet nao implementado: API nao documentada");
  }
}
