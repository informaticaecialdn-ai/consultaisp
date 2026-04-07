/**
 * TopSApp — ERP Connector (Stub)
 *
 * Stub connector — real API integration not yet implemented.
 * Registered so TopSApp appears in the connector list and config UI.
 */

import type {
  ErpConnector,
  ErpConfigField,
  ErpConnectionConfig,
  ErpTestResult,
  ErpFetchResult,
} from "../types.js";
import { registerConnector } from "../registry.js";

class TopsappConnector implements ErpConnector {
  readonly name = "topsapp";
  readonly label = "TopSApp";

  readonly configFields: ErpConfigField[] = [
    { key: "apiUrl", label: "URL da API TopSApp", type: "url", required: true, placeholder: "https://seudominio.topsapp.com.br" },
    { key: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ];

  async testConnection(_config: ErpConnectionConfig): Promise<ErpTestResult> {
    return { ok: false, message: "Conector TopSApp ainda nao implementado" };
  }

  async fetchDelinquents(_config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector TopSApp ainda nao implementado — fetchDelinquents indisponivel", customers: [] };
  }

  async fetchCustomers(_config: ErpConnectionConfig): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector TopSApp ainda nao implementado — fetchCustomers indisponivel", customers: [] };
  }

  async fetchCustomerByCpf(_config: ErpConnectionConfig, _cpfCnpj: string): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector TopSApp ainda nao implementado — fetchCustomerByCpf indisponivel", customers: [] };
  }
}

const topsappConnector = new TopsappConnector();
registerConnector(topsappConnector);

export { TopsappConnector };
export default topsappConnector;
