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
  topsapp: [
    { field: "apiUrl", label: "URL da API TopSApp", type: "url", required: true, placeholder: "https://seudominio.topsapp.com.br" },
    { field: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ],
  radiusnet: [
    { field: "apiUrl", label: "URL da API RadiusNet", type: "url", required: true, placeholder: "https://seudominio.radiusnet.com.br" },
    { field: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ],
  gere: [
    { field: "apiUrl", label: "URL da API Gere", type: "url", required: true, placeholder: "https://seudominio.gere.com.br" },
    { field: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ],
  receitanet: [
    { field: "apiUrl", label: "URL da API ReceitaNet", type: "url", required: true, placeholder: "https://seudominio.receitanet.com.br" },
    { field: "apiToken", label: "Token de Integracao", type: "password", required: true },
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
  addressNumber?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  cep?: string;
  /** Latitude returned directly by ERP (if available) — e.g. MK Solutions */
  latitude?: string;
  /** Longitude returned directly by ERP (if available) */
  longitude?: string;
  totalOverdueAmount: number;
  maxDaysOverdue: number;
  overdueInvoicesCount?: number;
  hasUnreturnedEquipment?: boolean;
  unreturnedEquipmentCount?: number;
  equipmentDetails?: Array<{
    type: string;
    brand: string;
    model: string;
    serialNumber: string;
    value: string;
    inRecoveryProcess: boolean;
  }>;
  /** Status do contrato no ERP. "active" = tem contrato vigente, "cancelled" = ex-cliente (pode ter fatura rescisória/equipamento). Mapeado para customers.status no DB. */
  contractStatus?: "active" | "cancelled" | "suspended";
  /** Nome do plano contratado (se ativo) — ex "Combo 800MB + Deezer". */
  contractPlan?: string;
  erpSource: string;
}

/** Result of fetching customers/delinquents from an ERP */
export interface ErpFetchResult {
  ok: boolean;
  message: string;
  customers: NormalizedErpCustomer[];
  totalRecords?: number;
}

/* ────────────────────────────────────────────────────────────────────
 * Spec 012.0 — Estensão: status técnico do cliente em tempo real
 *
 * Permite que connectors expõem (opcionalmente) dados de rede:
 *   - ONU online/offline + lastSeen + sinal óptico
 *   - Consumo de banda + última atividade
 *
 * Pré-requisito de Specs 012 (Recup Proativa) e 013 (Detector Saída).
 *
 * Capability levels:
 *   - 'full': ERP expõe dados completos via API REST (ex: IXC com radusuarios + cliente_fibra_onu)
 *   - 'degraded': ERP só expõe proxy parcial (ex: MK só tem flag Bloqueada binário)
 *   - 'unavailable': ERP não expõe (default para connectors que não implementam)
 * ──────────────────────────────────────────────────────────────────── */

export interface OnuStatus {
  online: boolean;
  lastSeen?: Date;
  signalRxDbm?: number;
  signalTxDbm?: number;
  source: "radius" | "olt" | "inferred_bloqueado" | "unavailable";
}

export interface CustomerActivity {
  bandwidthMbAvg?: number;
  bandwidthDownloadMbTotal?: number;
  bandwidthUploadMbTotal?: number;
  lastActivityAt?: Date;
  source: "radius" | "olt" | "unavailable";
}

export interface ErpCapabilities {
  /** Status da ONU/conexão em tempo real */
  onuStatus: "full" | "degraded" | "unavailable";
  /** Consumo de banda / atividade do cliente */
  customerActivity: "full" | "degraded" | "unavailable";
}

/** Default capabilities — connectors sem extensão herdam `unavailable`. */
export const DEFAULT_ERP_CAPABILITIES: ErpCapabilities = {
  onuStatus: "unavailable",
  customerActivity: "unavailable",
};

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

  /**
   * Capabilities declaradas pelo connector.
   * Opcional para compatibilidade — connectors sem extensão herdam `unavailable`.
   * Spec 012.0 introduz; demais connectors atualizam conforme implementam.
   */
  readonly capabilities?: ErpCapabilities;

  /** Test connectivity to the ERP API */
  testConnection(config: ErpConnectionConfig): Promise<ErpTestResult>;

  /** Fetch only delinquent/overdue customers */
  fetchDelinquents(config: ErpConnectionConfig, lastDays?: number): Promise<ErpFetchResult>;

  /** Fetch all customers (including non-delinquent) */
  fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult>;

  /** Fetch a single customer by CPF/CNPJ with overdue data already aggregated (optional) */
  fetchCustomerByCpf?(config: ErpConnectionConfig, cpfCnpj: string): Promise<ErpFetchResult>;

  /** Fetch customers by CEP prefix with overdue data aggregated (optional) */
  fetchCustomersByCep?(config: ErpConnectionConfig, cep: string): Promise<ErpFetchResult>;

  /**
   * Spec 012.0 — Status técnico atual da ONU/conexão de UM cliente.
   * Opcional. Connectors sem implementação retornam `{ source: "unavailable" }`
   * via método utilitário (não throw).
   */
  getOnuStatus?(
    config: ErpConnectionConfig,
    customerErpId: string,
  ): Promise<OnuStatus>;

  /**
   * Spec 012.0 — Atividade do cliente nos últimos N dias (banda + lastSeen).
   * Opcional. Retorna `{ source: "unavailable" }` se ERP não expõe.
   */
  getCustomerActivity?(
    config: ErpConnectionConfig,
    customerErpId: string,
    sinceDays: number,
  ): Promise<CustomerActivity>;
}

/**
 * Helper para connectors que não implementam status técnico.
 * Retorna OnuStatus indicando indisponibilidade.
 */
export function unavailableOnuStatus(): OnuStatus {
  return { online: false, source: "unavailable" };
}

/**
 * Helper para connectors que não implementam atividade do cliente.
 */
export function unavailableCustomerActivity(): CustomerActivity {
  return { source: "unavailable" };
}
