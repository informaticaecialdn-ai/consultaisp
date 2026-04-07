/**
 * Gere — ERP Connector (Stub)
 *
 * Stub connector — real API integration not yet implemented.
 * Registered so Gere appears in the connector list and config UI.
 */

import type {
  ErpConnector,
  ErpConfigField,
  ErpConnectionConfig,
  ErpTestResult,
  ErpFetchResult,
} from "../types.js";
import { registerConnector } from "../registry.js";

class GereConnector implements ErpConnector {
  readonly name = "gere";
  readonly label = "Gere";

  readonly configFields: ErpConfigField[] = [
    { key: "apiUrl", label: "URL da API Gere", type: "url", required: true, placeholder: "https://seudominio.gere.com.br" },
    { key: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ];

  async testConnection(_config: ErpConnectionConfig): Promise<ErpTestResult> {
    return { ok: false, message: "Conector Gere ainda nao implementado" };
  }

  async fetchDelinquents(_config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector Gere ainda nao implementado — fetchDelinquents indisponivel", customers: [] };
  }

  async fetchCustomers(_config: ErpConnectionConfig): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector Gere ainda nao implementado — fetchCustomers indisponivel", customers: [] };
  }

  async fetchCustomerByCpf(_config: ErpConnectionConfig, _cpfCnpj: string): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector Gere ainda nao implementado — fetchCustomerByCpf indisponivel", customers: [] };
  }
}

const gereConnector = new GereConnector();
registerConnector(gereConnector);

export { GereConnector };
export default gereConnector;
