// Re-export score-engine functions used by route modules
export { calculateIspScore, getRiskTier, getDecisionReco } from "../score-engine";

export function getOverdueAmountRange(amount: number): string {
  if (amount === 0) return "Sem debito";
  if (amount <= 100) return "Ate R$ 100";
  if (amount <= 300) return "R$ 100 - R$ 300";
  if (amount <= 500) return "R$ 300 - R$ 500";
  if (amount <= 1000) return "R$ 500 - R$ 1.000";
  return "Acima de R$ 1.000";
}

export function getRecommendedActions(score: number, hasUnreturnedEquipment: boolean): string[] {
  const actions: string[] = [];
  if (score < 25) {
    actions.push("Exigir pagamento antecipado (3-6 meses)");
    actions.push("Nao fornecer equipamento em comodato");
    actions.push("Contrato com multa de fidelidade");
    actions.push("Solicitar fiador/avalista");
  } else if (score < 50) {
    actions.push("Exigir pagamento antecipado (1-3 meses)");
    if (hasUnreturnedEquipment) actions.push("Nao fornecer equipamento em comodato");
    actions.push("Contrato com multa de fidelidade");
  } else if (score < 80) {
    actions.push("Monitorar pagamentos nos primeiros 3 meses");
    actions.push("Considerar contrato com fidelidade");
  }
  return actions;
}
