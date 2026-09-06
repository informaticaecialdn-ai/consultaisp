/**
 * As faixas de atraso da cobrança — o filtro por período de vencimento.
 *
 * Pedido do dono (06/09/2026), com as faixas escritas por ele: até 7 dias,
 * 8 a 15, 16 a 30, 31 a 60, 61 a 90, e mais de 90. E a razão, que é o que
 * dá sentido ao corte: *"a partir de 90 dias dificilmente o cliente ainda
 * está com o contrato ativo"*. Por isso a última faixa tem nome próprio na
 * carteira de ativos — quem está lá é, quase sempre, alguém que o ERP já
 * deveria ter cortado, e o operador precisa enxergar isso separado.
 *
 * Uma fonte só, usada pelo SQL do quadro e pelas pílulas da tela: faixa que
 * o servidor não conhece é faixa que mentiria o total do rodapé.
 *
 * Não confundir com `faixaDoAtraso` (client/src/components/cobranca/
 * formatacao.ts), que é a COR do selo D+N — quatro tons, outra régua, outro
 * propósito. Estas seis são recorte de trabalho.
 */

export const FAIXAS_DE_ATRASO = [
  "ate-7",
  "8-15",
  "16-30",
  "31-60",
  "61-90",
  "mais-90",
] as const;

export type FaixaDeAtraso = (typeof FAIXAS_DE_ATRASO)[number];

export interface LimitesDaFaixa {
  /** Mínimo de dias, inclusive. */
  min: number;
  /** Máximo de dias, inclusive. `null` = sem teto. */
  max: number | null;
  /** Como aparece na pílula do filtro. */
  rotulo: string;
  /** O que a faixa significa para quem cobra — vai no `title`. */
  motivo: string;
}

export const LIMITES_DA_FAIXA_DE_ATRASO: Record<FaixaDeAtraso, LimitesDaFaixa> = {
  "ate-7": {
    min: 1,
    max: 7,
    rotulo: "Até 7 dias",
    motivo: "Esquecimento na maioria das vezes: segunda via ou PIX costuma resolver.",
  },
  "8-15": {
    min: 8,
    max: 15,
    rotulo: "8 a 15 dias",
    motivo: "Ainda quente. É onde o lembrete tem mais retorno.",
  },
  "16-30": {
    min: 16,
    max: 30,
    rotulo: "16 a 30 dias",
    motivo: "Perto do aviso de suspensão: o contato precisa ser falado, não só enviado.",
  },
  "31-60": {
    min: 31,
    max: 60,
    rotulo: "31 a 60 dias",
    motivo: "Negociação: quanto mais tempo passa, menos se recupera do valor cheio.",
  },
  "61-90": {
    min: 61,
    max: 90,
    rotulo: "61 a 90 dias",
    motivo: "Última janela antes de o contrato normalmente ser encerrado.",
  },
  "mais-90": {
    min: 91,
    max: null,
    rotulo: "Mais de 90 dias",
    motivo: "Acima de 90 dias o cliente dificilmente ainda tem contrato ativo — confira a situação no ERP antes de cobrar como ativo.",
  },
};

/** A faixa de um atraso em dias. `null` quando não há atraso (D0 ou negativo). */
export function faixaDeAtrasoDe(dias: number): FaixaDeAtraso | null {
  if (!Number.isFinite(dias) || dias <= 0) return null;
  for (const faixa of FAIXAS_DE_ATRASO) {
    const { min, max } = LIMITES_DA_FAIXA_DE_ATRASO[faixa];
    if (dias >= min && (max === null || dias <= max)) return faixa;
  }
  return null;
}

/** `true` quando o texto é uma das seis faixas. Serve de guarda na query e na URL. */
export function faixaDeAtrasoValida(valor: string | null | undefined): valor is FaixaDeAtraso {
  return typeof valor === "string" && (FAIXAS_DE_ATRASO as readonly string[]).includes(valor);
}

/**
 * As faixas cobrem 1..∞ sem buraco e sem sobreposição — se alguém editar os
 * limites, é isto que quebra primeiro (há teste).
 */
export function faixasEmSequencia(): boolean {
  let esperado = 1;
  for (const faixa of FAIXAS_DE_ATRASO) {
    const { min, max } = LIMITES_DA_FAIXA_DE_ATRASO[faixa];
    if (min !== esperado) return false;
    if (max === null) return faixa === FAIXAS_DE_ATRASO[FAIXAS_DE_ATRASO.length - 1];
    if (max < min) return false;
    esperado = max + 1;
  }
  return false;
}
