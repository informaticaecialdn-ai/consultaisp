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
  extra: Record<string, string>;
}

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
