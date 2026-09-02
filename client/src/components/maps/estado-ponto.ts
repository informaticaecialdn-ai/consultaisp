/**
 * Estado do ponto no mapa — rótulo e cor.
 *
 * A cor é HEX FIXO, não token, de propósito. Dois motivos, os mesmos da
 * referência (Provedor.ai · Cobrança · Localização):
 *
 * 1. O canvas do Leaflet não resolve `var()`, e a legenda tem de retratar o
 *    mapa em QUALQUER tema — no escuro os tokens semânticos clareiam, e o
 *    marcador ficaria de uma cor e a legenda de outra.
 * 2. Os tokens da pele (âmbar `--gated`, berinjela `--brand`, vinho `--danger`)
 *    são tons próximos, e sobre o tile do OpenStreetMap viram o mesmo borrão
 *    quente — foi o feedback do dono na referência. Aqui os matizes são máximos
 *    entre si: âmbar vivo · azul · vermelho.
 *
 * Espelha `server/services/estado-ponto.ts`, que é quem decide o estado.
 */
export type EstadoPonto = 'em_dia' | 'em_cobranca' | 'suspenso' | 'ex_divida';

export const ESTADO_META: Record<EstadoPonto, { label: string; curto: string; cor: string }> = {
  em_dia:      { label: 'Ativo em dia',          curto: 'Em dia',        cor: '#2F8F60' },
  em_cobranca: { label: 'Em cobrança',           curto: 'Em cobrança',   cor: '#F2A50C' },
  suspenso:    { label: 'Suspenso',              curto: 'Suspenso',      cor: '#4A6FAF' },
  ex_divida:   { label: 'Ex-cliente com dívida', curto: 'Ex com dívida', cor: '#C42B2B' },
};

/**
 * Só quem pode estar no mapa. O mapa é de bureau: mostra quem deve, não a base
 * saudável do provedor — `em_dia` nunca é plotado (o corte é no servidor) e
 * por isso não entra na legenda nem nos filtros.
 */
export const ESTADOS_NO_MAPA: EstadoPonto[] = ['em_cobranca', 'suspenso', 'ex_divida'];
