export function getOverdueAmountRange(amount: number): string {
  if (amount === 0) return "Sem debito";
  if (amount <= 100) return "Ate R$ 100";
  if (amount <= 300) return "R$ 100 - R$ 300";
  if (amount <= 500) return "R$ 300 - R$ 500";
  if (amount <= 1000) return "R$ 500 - R$ 1.000";
  return "Acima de R$ 1.000";
}
