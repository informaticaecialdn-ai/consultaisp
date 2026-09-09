/**
 * O período da carteira — mês, trimestre, semestre ou ano — como TEXTO que
 * viaja na URL e na query, e a aritmética em cima dele.
 *
 * Nasceu em 09/09/2026 com o card "Prejuízo acumulado" das carteiras de
 * cobrança (pedido do dono: "filtro por seleção de mês, acumulado por
 * trimestre, semestre e anual"). A faixa do mês já tinha `mesAtual`,
 * `deslocarMes` e `rotuloDoMes` presos na tela; este módulo generaliza para as
 * quatro granularidades sem duplicar a do mês.
 *
 * Formato canônico, sempre ano na frente para ordenar como texto:
 *   mês        "2026-09"      rótulo "set/26"
 *   trimestre  "2026-T3"      rótulo "T3/26"   (como o Pulso do Provedor.ai)
 *   semestre   "2026-S2"      rótulo "S2/26"
 *   ano        "2026"         rótulo "2026"
 *
 * A janela é [de, ate) — `ate` é o PRIMEIRO instante do período seguinte.
 *
 * DUAS FORMAS DA JANELA, de propósito:
 *   - `janelaDoPeriodoEmDias` devolve DIA EM TEXTO ('AAAA-MM-DD'), o mesmo
 *     contrato de `janelaDoMes` no storage de faturas. É a ÚNICA forma que
 *     pode ir para o SQL: `due_date` é gravado como meia-noite UTC e comparado
 *     por `'dia'::timestamp`; um Date local do servidor deslocaria a fronteira
 *     pelo fuso (em America/Sao_Paulo, a fatura de 01/09 cairia em agosto).
 *   - `janelaDoPeriodo`, `periodoDaData` e `dentroDoPeriodo` trabalham com Date
 *     no fuso local e servem ao CALENDÁRIO DA TELA (seletor, rótulo, ‹ ›).
 *     Nunca compare `due_date` com elas.
 *
 * Módulo puro: sem banco, sem React, sem I/O.
 */

export const GRANULARIDADES = ["mes", "trimestre", "semestre", "ano"] as const;
export type Granularidade = (typeof GRANULARIDADES)[number];

export const ROTULO_GRANULARIDADE: Record<Granularidade, string> = {
  mes: "Mês", trimestre: "Trimestre", semestre: "Semestre", ano: "Ano",
};

/** Quantos meses cabem em um período de cada granularidade. */
const MESES_POR: Record<Granularidade, number> = { mes: 1, trimestre: 3, semestre: 6, ano: 12 };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export interface Periodo {
  granularidade: Granularidade;
  ano: number;
  /** 1-based: mês 1–12, trimestre 1–4, semestre 1–2, ano sempre 1. */
  indice: number;
}

const RE = /^(\d{4})(?:-(?:(0[1-9]|1[0-2])|T([1-4])|S([12])))?$/;

/** Lê o texto canônico; `null` para qualquer coisa fora do formato. */
export function parsePeriodo(texto: string | null | undefined): Periodo | null {
  const m = RE.exec((texto ?? "").trim());
  if (!m) return null;
  const ano = Number(m[1]);
  if (m[2]) return { granularidade: "mes", ano, indice: Number(m[2]) };
  if (m[3]) return { granularidade: "trimestre", ano, indice: Number(m[3]) };
  if (m[4]) return { granularidade: "semestre", ano, indice: Number(m[4]) };
  return { granularidade: "ano", ano, indice: 1 };
}

export function formatarPeriodo(p: Periodo): string {
  switch (p.granularidade) {
    case "mes": return `${p.ano}-${String(p.indice).padStart(2, "0")}`;
    case "trimestre": return `${p.ano}-T${p.indice}`;
    case "semestre": return `${p.ano}-S${p.indice}`;
    case "ano": return String(p.ano);
  }
}

/** "set/26" · "T3/26" · "S2/26" · "2026". */
export function rotuloDoPeriodo(p: Periodo): string {
  const aa = String(p.ano).slice(2);
  switch (p.granularidade) {
    case "mes": return `${MESES[p.indice - 1]}/${aa}`;
    case "trimestre": return `T${p.indice}/${aa}`;
    case "semestre": return `S${p.indice}/${aa}`;
    case "ano": return String(p.ano);
  }
}

/** O período que contém a data, na granularidade pedida. */
export function periodoDaData(d: Date, granularidade: Granularidade): Periodo {
  const mes0 = d.getMonth();
  return { granularidade, ano: d.getFullYear(), indice: Math.floor(mes0 / MESES_POR[granularidade]) + 1 };
}

/** O mesmo período, N passos à frente (ou atrás, com N negativo). */
export function deslocarPeriodo(p: Periodo, delta: number): Periodo {
  const inicio = janelaDoPeriodo(p).de;
  const d = new Date(inicio.getFullYear(), inicio.getMonth() + delta * MESES_POR[p.granularidade], 1);
  return periodoDaData(d, p.granularidade);
}

/** [de, ate): do primeiro dia do período ao primeiro dia do seguinte, no fuso local. */
export function janelaDoPeriodo(p: Periodo): { de: Date; ate: Date } {
  const meses = MESES_POR[p.granularidade];
  const mes0 = (p.indice - 1) * meses;
  return { de: new Date(p.ano, mes0, 1), ate: new Date(p.ano, mes0 + meses, 1) };
}

/**
 * [de, ate) como 'AAAA-MM-DD', por aritmética de ano/índice — sem Date, sem
 * fuso. É o que o storage compara com `due_date` via `ts()`.
 */
export function janelaDoPeriodoEmDias(p: Periodo): { de: string; ate: string } {
  const meses = MESES_POR[p.granularidade];
  const mes0 = (p.indice - 1) * meses;            // 0-based, primeiro mês do período
  const fim0 = mes0 + meses;                       // 0-based, primeiro mês do seguinte
  const dia = (ano: number, m0: number) => `${ano + Math.floor(m0 / 12)}-${String((m0 % 12) + 1).padStart(2, "0")}-01`;
  return { de: dia(p.ano, mes0), ate: dia(p.ano, fim0) };
}

/** 'AAAA-MM' de um dia 'AAAA-MM-DD' — só texto, nenhum Date no caminho. */
export function mesDoDia(dia: string): string {
  return dia.slice(0, 7);
}

/** Os meses 'AAAA-MM' que o período cobre, em ordem — a série do card. */
export function mesesDoPeriodo(p: Periodo): string[] {
  const meses = MESES_POR[p.granularidade];
  const mes0 = (p.indice - 1) * meses;
  return Array.from({ length: meses }, (_, i) => `${p.ano}-${String(mes0 + i + 1).padStart(2, "0")}`);
}

/** O período de `granularidade` que contém o mês 'AAAA-MM' — só texto. */
export function periodoDoMes(mes: string, granularidade: Granularidade): Periodo | null {
  const p = parsePeriodo(mes);
  if (!p || p.granularidade !== "mes") return null;
  return { granularidade, ano: p.ano, indice: Math.floor((p.indice - 1) / MESES_POR[granularidade]) + 1 };
}

/**
 * Troca a granularidade preservando o instante: o mês set/26 vira T3/26,
 * S2/26 ou 2026 — o período que o contém.
 */
export function reenquadrar(p: Periodo, granularidade: Granularidade): Periodo {
  return periodoDaData(janelaDoPeriodo(p).de, granularidade);
}

/** true quando a data cai dentro de [de, ate). */
export function dentroDoPeriodo(d: Date, p: Periodo): boolean {
  const { de, ate } = janelaDoPeriodo(p);
  return d >= de && d < ate;
}
