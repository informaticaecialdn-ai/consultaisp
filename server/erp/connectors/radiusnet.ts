/**
 * RadiusNet — ERP Connector (Stub)
 *
 * Stub connector — real API integration not yet implemented.
 * Registered so RadiusNet appears in the connector list and config UI.
 */

import type {
  ErpConnector,
  ErpConfigField,
  ErpConnectionConfig,
  ErpTestResult,
  ErpFetchResult,
} from "../types.js";
import { registerConnector } from "../registry.js";

class RadiusnetConnector implements ErpConnector {
  readonly name = "radiusnet";
  readonly label = "RadiusNet";

  readonly configFields: ErpConfigField[] = [
    { key: "apiUrl", label: "URL da API RadiusNet", type: "url", required: true, placeholder: "https://seudominio.radiusnet.com.br" },
    { key: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ];

  async testConnection(_config: ErpConnectionConfig): Promise<ErpTestResult> {
    return { ok: false, message: "Conector RadiusNet ainda nao implementado" };
  }

  async fetchDelinquents(_config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector RadiusNet ainda nao implementado — fetchDelinquents indisponivel", customers: [] };
  }

  async fetchCustomers(_config: ErpConnectionConfig): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector RadiusNet ainda nao implementado — fetchCustomers indisponivel", customers: [] };
  }

  async fetchCustomerByCpf(_config: ErpConnectionConfig, _cpfCnpj: string): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector RadiusNet ainda nao implementado — fetchCustomerByCpf indisponivel", customers: [] };
  }
}

const radiusnetConnector = new RadiusnetConnector();
registerConnector(radiusnetConnector);

export { RadiusnetConnector };
export default radiusnetConnector;
