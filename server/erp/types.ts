/**
 * ERP Connector Engine — Type Definitions
 *
 * Contracts and interfaces for all ERP connectors.
 * Every connector (IXC, MK, SGP, Hubsoft, Voalle, RBX) implements ErpConnector.
 */

/** Configuration field descriptor for dynamic ERP setup forms */
export interface ErpConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  placeholder?: string;
}

/** Connection configuration passed to every connector method */
export interface ErpConnectionConfig {
  apiUrl: string;
  apiToken: string;
  apiUser?: string;
  clientId?: string;
  clientSecret?: string;
  mkContraSenha?: string;
  extra: Record<string, string>;
}

/** ERP config fields for dynamic frontend forms */
export const ERP_CONFIG_FIELDS: Record<string, {
  field: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  placeholder?: string;
  helpText?: string;
}[]> = {
  ixc: [
    { field: "apiUrl", label: "URL do Servidor IXC", type: "url", required: true, placeholder: "https://suainstancia.ixcsoft.com.br" },
    { field: "apiUser", label: "ID do Usuario (numerico)", type: "text", required: true, placeholder: "123" },
    { field: "apiToken", label: "Token do Usuario", type: "password", required: true, helpText: "Gerado em Configuracoes > Usuarios > campo Token" },
  ],
  mk: [
    { field: "apiUrl", label: "URL do Servidor MK", type: "url", required: true, placeholder: "http://192.168.1.100:8311" },
    { field: "apiToken", label: "Token do Usuario MK", type: "password", required: true, helpText: "Token cadastrado no usuario de integracao" },
    { field: "mkContraSenha", label: "Contra-Senha do Perfil Webservice", type: "password", required: true, helpText: "Criada em Integradores > Gerenciador de Webservices" },
  ],
  sgp: [
    { field: "apiUrl", label: "URL do Servidor SGP", type: "url", required: true, placeholder: "http://192.168.1.100" },
    { field: "apiToken", label: "Token SGP", type: "password", required: true, helpText: "Obtido com o suporte da SGP" },
    { field: "extra.sgpApp", label: "Nome do App", type: "text", required: true, placeholder: "consultaisp", helpText: "app_name configurado na integracao SGP" },
  ],
  hubsoft: [
    { field: "apiUrl", label: "URL da API Hubsoft", type: "url", required: true, placeholder: "https://api.seudominio.com.br" },
    { field: "clientId", label: "Client ID", type: "text", required: true, helpText: "Gerado no painel de integracoes Hubsoft" },
    { field: "clientSecret", label: "Client Secret", type: "password", required: true },
    { field: "apiUser", label: "Usuario (e-mail)", type: "text", required: true, placeholder: "api@seudominio.com.br" },
    { field: "apiToken", label: "Senha da conta de integracao", type: "password", required: true },
  ],
  voalle: [
    { field: "apiUrl", label: "URL do Voalle ERP", type: "url", required: true, placeholder: "https://erp.seudominio.com.br" },
    { field: "apiUser", label: "Usuario de Integracao", type: "text", required: true, helpText: "Usuario do tipo Integracao criado no Voalle" },
    { field: "apiToken", label: "Senha", type: "password", required: true },
    { field: "extra.voalleClientId", label: "Client ID (opcional)", type: "text", required: false, placeholder: "tger", helpText: "Deixe vazio para usar o padrao" },
  ],
  rbx: [
    { field: "apiUrl", label: "URL do RBX ISP", type: "url", required: true, placeholder: "https://erp.seudominio.com.br" },
    { field: "apiToken", label: "Chave de Integracao", type: "password", required: true, helpText: "Empresa > Parametros > Web Services no RBX" },
  ],
};

/** Result of a connection test */
export interface ErpTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

/** Normalized customer record — common shape across all ERPs */
export interface NormalizedErpCustomer {
  cpfCnpj: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  cep?: string;
  totalOverdueAmount: number;
  maxDaysOverdue: number;
  overdueInvoicesCount?: number;
  erpSource: string;
}

/** Result of fetching customers/delinquents from an ERP */
export interface ErpFetchResult {
  ok: boolean;
  message: string;
  customers: NormalizedErpCustomer[];
  totalRecords?: number;
}

/**
 * Core ERP Connector interface.
 *
 * Every ERP integration must implement this contract.
 * Connectors register themselves in the registry on import.
 */
export interface ErpConnector {
  readonly name: string;
  readonly label: string;
  readonly configFields: ErpConfigField[];

  /** Test connectivity to the ERP API */
  testConnection(config: ErpConnectionConfig): Promise<ErpTestResult>;

  /** Fetch only delinquent/overdue customers */
  fetchDelinquents(config: ErpConnectionConfig): Promise<ErpFetchResult>;

  /** Fetch all customers (including non-delinquent) */
  fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult>;
}
