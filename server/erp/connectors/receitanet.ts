/**
 * ReceitaNet — ERP Connector (Stub)
 *
 * Stub connector — real API integration not yet implemented.
 * Registered so ReceitaNet appears in the connector list and config UI.
 */

import type {
  ErpConnector,
  ErpConfigField,
  ErpConnectionConfig,
  ErpTestResult,
  ErpFetchResult,
} from "../types.js";
import { registerConnector } from "../registry.js";

class ReceitanetConnector implements ErpConnector {
  readonly name = "receitanet";
  readonly label = "ReceitaNet";

  readonly configFields: ErpConfigField[] = [
    { key: "apiUrl", label: "URL da API ReceitaNet", type: "url", required: true, placeholder: "https://seudominio.receitanet.com.br" },
    { key: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ];

  async testConnection(_config: ErpConnectionConfig): Promise<ErpTestResult> {
    return { ok: false, message: "Conector ReceitaNet ainda nao implementado" };
  }

  async fetchDelinquents(_config: ErpConnectionConfig, _lastDays?: number): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector ReceitaNet ainda nao implementado — fetchDelinquents indisponivel", customers: [] };
  }

  async fetchCustomers(_config: ErpConnectionConfig): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector ReceitaNet ainda nao implementado — fetchCustomers indisponivel", customers: [] };
  }

  async fetchCustomerByCpf(_config: ErpConnectionConfig, _cpfCnpj: string): Promise<ErpFetchResult> {
    return { ok: false, message: "Conector ReceitaNet ainda nao implementado — fetchCustomerByCpf indisponivel", customers: [] };
  }
}

const receitanetConnector = new ReceitanetConnector();
registerConnector(receitanetConnector);

export { ReceitanetConnector };
export default receitanetConnector;
