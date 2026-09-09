/** Somente fatura explicitamente paga COM data participa do comportamento histórico. */
export interface HistoricoDePagamentos {
  historicoInsuficiente: boolean;
  faturasPagas: number;
  faturasPagasComAtraso: number;
  /** Σ do valor PAGO das faturas confirmadas — a receita real da Economia. */
  recebido: number;
  taxaAtraso: number | null;
  ultimaConfirmacaoEm: Date | null;
  fonte: "pagamentos_com_data" | null;
}

export function resumirHistoricoDePagamentos(faturas: readonly {
  status: string; vencimento: Date; pagoEm: Date | null; valorPago?: number | null;
}[]): HistoricoDePagamentos {
  const validas = faturas.filter(f => f.status === "paid" && f.pagoEm &&
    Number.isFinite(f.pagoEm.getTime()) && Number.isFinite(f.vencimento.getTime()));
  const atrasadas = validas.filter(f => f.pagoEm!.toISOString().slice(0, 10) > f.vencimento.toISOString().slice(0, 10)).length;
  return {
    historicoInsuficiente: validas.length === 0,
    faturasPagas: validas.length,
    faturasPagasComAtraso: atrasadas,
    recebido: Math.round(validas.reduce((s, f) => s + (Number(f.valorPago) || 0), 0) * 100) / 100,
    taxaAtraso: validas.length ? atrasadas / validas.length : null,
    ultimaConfirmacaoEm: validas.length ? new Date(Math.max(...validas.map(f => f.pagoEm!.getTime()))) : null,
    fonte: validas.length ? "pagamentos_com_data" : null,
  };
}

/**
 * O historico como a Economia o consome: pagas, RECEBIDO e a pontualidade.
 * `null` quando nao ha fatura paga confirmada — e ai a Economia do cliente
 * vivo segue projetada e a do ex-cliente fica pendente, como sempre. E a
 * unica porta: o servidor nunca monta esse objeto na mao.
 */
export function historicoParaEconomia(h: HistoricoDePagamentos | null | undefined): { pagas: number; recebido: number; pct_em_dia: number } | null {
  if (!h || h.historicoInsuficiente || h.faturasPagas <= 0) return null;
  return {
    pagas: h.faturasPagas,
    recebido: h.recebido,
    pct_em_dia: h.taxaAtraso === null ? 100 : Math.round((1 - h.taxaAtraso) * 1000) / 10,
  };
}
