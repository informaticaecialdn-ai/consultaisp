export interface ProviderDetail {
  providerName: string;
  isSameProvider: boolean;
  customerName: string;
  status: string;
  daysOverdue: number;
  overdueAmount?: number;
  overdueAmountRange?: string;
  overdueInvoicesCount: number;
  contractStartDate: string;
  contractAgeDays: number;
  hasUnreturnedEquipment: boolean;
  unreturnedEquipmentCount: number;
  equipmentDetails?: { type: string; brand: string; model: string; value: string; inRecoveryProcess: boolean }[];
  equipmentPendingSummary?: string;
  cancelledDate?: string;
  contractStatus?: string;
  address?: string;
  addressNumber?: string;
  neighborhood?: string;
  cep?: string;
  addressCity?: string;
  addressState?: string;
  latitude?: string;
  longitude?: string;
}

export interface AddressMatch {
  customerName: string;
  cpfCnpj: string;
  address: string;
  city: string;
  state?: string;
  providerName: string;
  isSameProvider: boolean;
  status: string;
  daysOverdue?: number;
  daysOverdueRange?: string;
  totalOverdue?: number;
  totalOverdueRange?: string;
  hasDebt: boolean;
}

export interface ScoreFator {
  pontos: number;
  maximo: number;
  peso: string;
  descricao: string;
}

export interface ConsultaResult {
  cpfCnpj: string;
  searchType: string;
  notFound: boolean;
  score: number;
  faixa?: string;
  nivelRisco?: string;
  corIndicador?: string;
  sugestaoIA?: string;
  fatoresScore?: {
    f1_historicoPagamento: ScoreFator;
    f2_tempoSetor: ScoreFator;
    f3_inadimplenciaAtiva: ScoreFator;
    f4_padraoConsultas: ScoreFator;
    f5_riscoEndereco: ScoreFator;
    f6_consistenciaCadastral: ScoreFator;
  };
  riskTier: string;
  riskLabel: string;
  recommendation: string;
  decisionReco: string;
  providersFound: number;
  providerDetails: ProviderDetail[];
  alerts: string[];
  recommendedActions: string[];
  creditsCost: number;
  isOwnCustomer: boolean;
  addressMatches?: AddressMatch[];
  addressSearch?: any;
  addressSource?: "own" | "network" | null;
  addressUsed?: string | null;
  autoAddressCrossRef?: boolean;
  isHistoryResult?: boolean;
  source?: string;
  erpLatencies?: { provider: string; erp: string; ok: boolean; ms: number; error?: string }[];
  score100?: number;
  baseLegal?: string;
  finalidadeConsulta?: string;
  controlador?: string;
  migratorAlert?: { detected: boolean; severity: string; message: string; riskFactors: string[] } | null;
  erpSummary?: { total: number; responded: number; failed: number; timedOut: number };
}

export interface CepData {
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
}
