export type CarteiraMapa = "ativo" | "ex_cliente" | "todas";
export const ROTULO_CARTEIRA_MAPA: Record<CarteiraMapa, string> = {
  ativo: "Clientes ativos", ex_cliente: "Ex-clientes", todas: "Base completa",
};

/**
 * A carteira do mapa sai da URL — e SEM recorte pedido ela é a base completa.
 *
 * Mora aqui, e não dentro da página, para poder ser testada: o padrão "ativo"
 * apagou os 1.239 ex-clientes com dívida do mapa da NsLink em 08/09/2026 e
 * zerou a taxa dos bairros cuja única dívida era de ex-cliente — o numerador
 * saía e o denominador ficava. É o mesmo padrão da rota e do storage; os três
 * têm de dizer a mesma coisa.
 */
export function carteiraDaUrl(search: string): CarteiraMapa {
  const v = new URLSearchParams(search).get("carteira");
  return v === "ativo" || v === "ex_cliente" ? v : "todas";
}

export interface ResumoCidadeMapa {
  cidade: string; clientes: number; inadimplentes: number; dividaTotal: number;
  universo?: number; pctInadimplencia?: number; pontosNoMapa?: number; semCoordenada?: number;
  benchmarkPct?: number | null;
  benchmark?: { pct: number; provedores: number; clientes: number; inadimplentes: number } | null;
}

/** Soma as bases, nunca tira média dos percentuais das cidades. */
export function resumoDoRecorte(cidades: readonly ResumoCidadeMapa[]) {
  const clientes = cidades.reduce((s, c) => s + c.clientes, 0);
  const inadimplentes = cidades.reduce((s, c) => s + c.inadimplentes, 0);
  const dividaTotal = cidades.reduce((s, c) => s + c.dividaTotal, 0);
  return { clientes, inadimplentes, dividaTotal, taxa: clientes > 0 ? 100 * inadimplentes / clientes : null };
}
