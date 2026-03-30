export interface ScoreInput {
  maxDaysOverdue: number;
  totalOverdueAmount: number;
  unreturnedEquipmentCount: number;
  contractAgeDays: number;
  recentConsultationsCount: number;
  providersWithDebt: number;
  clientYears: number;
  neverLate: boolean;
  allEquipmentReturned: boolean;
}

export interface ScoreResult {
  score: number;
  penalties: { reason: string; points: number }[];
  bonuses: { reason: string; points: number }[];
}

export function calculateIspScore(params: ScoreInput): ScoreResult {
  let score = 100;
  const penalties: { reason: string; points: number }[] = [];
  const bonuses: { reason: string; points: number }[] = [];

  if (params.maxDaysOverdue > 90) {
    penalties.push({ reason: "Atraso superior a 90 dias", points: -40 });
    score -= 40;
  } else if (params.maxDaysOverdue > 60) {
    penalties.push({ reason: "Atraso de 61-90 dias", points: -30 });
    score -= 30;
  } else if (params.maxDaysOverdue > 30) {
    penalties.push({ reason: "Atraso de 31-60 dias", points: -20 });
    score -= 20;
  } else if (params.maxDaysOverdue > 0) {
    penalties.push({ reason: "Atraso de 1-30 dias", points: -10 });
    score -= 10;
  }

  const amountPenalty = Math.floor(params.totalOverdueAmount / 100) * 5;
  if (amountPenalty > 0) {
    penalties.push({ reason: `R$ ${params.totalOverdueAmount.toFixed(2)} em aberto (-5 a cada R$100)`, points: -amountPenalty });
    score -= amountPenalty;
  }

  if (params.unreturnedEquipmentCount > 0) {
    const eqPenalty = params.unreturnedEquipmentCount * 15;
    penalties.push({ reason: `${params.unreturnedEquipmentCount} equipamento(s) nao devolvido(s)`, points: -eqPenalty });
    score -= eqPenalty;
  }

  if (params.contractAgeDays < 90) {
    penalties.push({ reason: "Contrato com menos de 3 meses", points: -15 });
    score -= 15;
  } else if (params.contractAgeDays < 180) {
    penalties.push({ reason: "Contrato com menos de 6 meses", points: -10 });
    score -= 10;
  }

  if (params.recentConsultationsCount > 3) {
    penalties.push({ reason: `Consultado por ${params.recentConsultationsCount} provedores nos ultimos 30 dias`, points: -20 });
    score -= 20;
  }

  if (params.providersWithDebt > 1) {
    penalties.push({ reason: "Divida em multiplos provedores", points: -25 });
    score -= 25;
  }

  if (params.clientYears >= 2 && params.maxDaysOverdue === 0) {
    bonuses.push({ reason: "Cliente ha mais de 2 anos (em dia)", points: 10 });
    score += 10;
  }

  if (params.neverLate) {
    bonuses.push({ reason: "Nunca atrasou pagamento", points: 15 });
    score += 15;
  }

  if (params.allEquipmentReturned) {
    bonuses.push({ reason: "Equipamentos sempre devolvidos", points: 5 });
    score += 5;
  }

  return { score: Math.max(0, Math.min(100, score)), penalties, bonuses };
}

export function getRiskTier(score: number): { tier: string; label: string; recommendation: string } {
  if (score >= 80) return { tier: "low", label: "BAIXO RISCO", recommendation: "Aprovar" };
  if (score >= 50) return { tier: "medium", label: "MEDIO RISCO", recommendation: "Aprovar com cautela" };
  if (score >= 25) return { tier: "high", label: "ALTO RISCO", recommendation: "Exigir garantias" };
  return { tier: "critical", label: "CRITICO", recommendation: "Rejeitar" };
}

export function getDecisionReco(score: number): string {
  if (score >= 80) return "Accept";
  if (score >= 50) return "Review";
  return "Reject";
}
