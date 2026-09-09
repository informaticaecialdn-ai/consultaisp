/** Somente fatura explicitamente paga COM data participa do comportamento histórico. */
export interface HistoricoDePagamentos {
  historicoInsuficiente: boolean;
  faturasPagas: number;
  faturasPagasComAtraso: number;
  taxaAtraso: number | null;
  ultimaConfirmacaoEm: Date | null;
  fonte: "pagamentos_com_data" | null;
}

export function resumirHistoricoDePagamentos(faturas: readonly {
  status: string; vencimento: Date; pagoEm: Date | null;
}[]): HistoricoDePagamentos {
  const validas = faturas.filter(f => f.status === "paid" && f.pagoEm &&
    Number.isFinite(f.pagoEm.getTime()) && Number.isFinite(f.vencimento.getTime()));
  const atrasadas = validas.filter(f => f.pagoEm!.toISOString().slice(0, 10) > f.vencimento.toISOString().slice(0, 10)).length;
  return {
    historicoInsuficiente: validas.length === 0,
    faturasPagas: validas.length,
    faturasPagasComAtraso: atrasadas,
    taxaAtraso: validas.length ? atrasadas / validas.length : null,
    ultimaConfirmacaoEm: validas.length ? new Date(Math.max(...validas.map(f => f.pagoEm!.getTime()))) : null,
    fonte: validas.length ? "pagamentos_com_data" : null,
  };
}
