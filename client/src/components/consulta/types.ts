export interface ProviderDetail {
  providerName: string;
  isSameProvider: boolean;
  customerName: string;
  status: string;
  daysOverdue: number;
  overdueAmount?: number;
  overdueAmountRange?: string;
  overdueInvoicesCount: number;
  /* Terceiros nunca recebem o numero exato — a rota manda faixa (LGPD). Os
     campos existiam na resposta antes de existirem aqui. */
  daysOverdueRange?: string;
  overdueInvoicesCountRange?: string;
  contractStartDate: string;
  contractAgeDays: number;
  hasUnreturnedEquipment: boolean;
  unreturnedEquipmentCount: number;
  /** validated_pending = ocorrencia validada no bureau; operational_pending = pendencia so no ERP proprio; unknown = sem informacao (nunca exibir como "devolvido") */
  equipmentStatus?: "validated_pending" | "operational_pending" | "unknown";
  equipmentSignalValidated?: boolean;
  equipmentCategories?: string[];
  equipmentOccurrenceAgeRange?: string;
  equipmentValueRange?: string;
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
  /** Formato antigo (consultas gravadas antes do motor v2). */
  fatoresScore?: {
    f1_historicoPagamento: ScoreFator;
    f2_tempoSetor: ScoreFator;
    f3_inadimplenciaAtiva: ScoreFator;
    f4_padraoConsultas: ScoreFator;
    f5_riscoEndereco: ScoreFator;
    f6_consistenciaCadastral: ScoreFator;
  };
  /** Motor v2: a conta do score — base, deduções nomeadas, bônus e teto. */
  composicaoScore?: {
    base: number;
    deducoes: Array<{ pontos: number; motivo: string; detalhe?: string }>;
    bonus: Array<{ pontos: number; motivo: string; detalhe?: string }>;
    teto?: { valor: number; motivo: string };
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
  /** Rotulo do endereco cruzado — as vezes um CEP, as vezes "Rua X, 17 — Bairro". */
  addressUsed?: string | null;
  /**
   * O mesmo endereco em PARTES, para quem precisa dos campos e nao do rotulo.
   *
   * O mapa recebia `addressUsed` no lugar do CEP, extraia os digitos ("17") e
   * desistia de geocodificar; o cabecalho da secao escrevia "CEP Rua Amelia
   * Wiesel Rose, 17 — ...". Rotulo e dado nao sao a mesma coisa.
   */
  addressParts?: {
    logradouro?: string; numero?: string; bairro?: string;
    cidade?: string; uf?: string; cep?: string;
  } | null;
  autoAddressCrossRef?: boolean;
  isHistoryResult?: boolean;
  source?: string;
  erpLatencies?: { provider: string; erp: string; ok: boolean; ms: number; error?: string }[];
  score100?: number;
  baseLegal?: string;
  finalidadeConsulta?: string;
  controlador?: string;
  migratorAlert?: { detected: boolean; severity: string; message: string; riskFactors: string[] } | null;
  /** Outros documentos inadimplentes no MESMO imovel — sinal de troca de CPF. */
  addressRiskAlerts?: {
    type: string;
    message: string;
    matches: { cpfMasked: string; overdueRange: string; maxDaysOverdue: number; status: string }[];
  } | null;
  erpSummary?: { total: number; responded: number; failed: number; timedOut: number };
}

export interface CepData {
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
}
