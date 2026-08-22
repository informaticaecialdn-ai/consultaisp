/**
 * Estado visual do cliente no mapa.
 *
 * Derivado do VALOR da divida, nunca de payment_status: aquela coluna tem dois
 * vocabularios — 'current'/'overdue' escritos por upsertFromErp e faixas
 * '31-60'/'61-90'/'90+' escritas pelo seed. Filtrar por string quebra para
 * metade das linhas; o valor e verdade unica.
 */

export type EstadoPonto = 'em_dia' | 'em_cobranca' | 'suspenso' | 'ex_divida';

const INATIVOS = ['inactive', 'cancelled'];

export function estadoDoPonto(c: {
  status?: string | null;
  totalOverdueAmount?: string | number | null;
}): EstadoPonto {
  const divida = Number(c.totalOverdueAmount || 0);
  const temDivida = !Number.isNaN(divida) && divida > 0;
  const st = (c.status || "").toLowerCase();

  if (INATIVOS.includes(st) && temDivida) return 'ex_divida';
  if (st === 'suspended') return 'suspenso';
  return temDivida ? 'em_cobranca' : 'em_dia';
}

/** Rotulo e token de cor. Alto contraste entre si — a referencia alerta que
    tons quentes proximos viram o mesmo borrao no mapa. */
export const ESTADO_META: Record<EstadoPonto, { label: string; token: string }> = {
  em_dia:      { label: 'Ativo em dia',          token: '--ok' },
  em_cobranca: { label: 'Em cobrança',           token: '--gated' },
  suspenso:    { label: 'Suspenso',              token: '--brand' },
  ex_divida:   { label: 'Ex-cliente com dívida', token: '--danger' },
};

export const ESTADO_ORDEM: EstadoPonto[] = ['em_dia', 'em_cobranca', 'suspenso', 'ex_divida'];
