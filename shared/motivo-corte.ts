/**
 * Por que o contrato do cliente foi suspenso ou cancelado.
 *
 * O ERP sabe disso e nos jogavamos fora. Medido em 04/09/2026 no SGP da
 * Amplinet (provedor 6): `/api/ura/listacontrato/` devolve `motivo_status` em
 * cada contrato, e a distribuicao era
 *
 *     Suspenso · Financeiro       225 contratos · 222 clientes
 *     Cancelado · Administrativo  214 · 206
 *     Ativo · Financeiro           76 ·  76
 *     Cancelado · Financeiro       65 ·  65
 *     Suspenso · Administrativo    31 ·  30
 *     Cancelado · Financeiro-SPC    1 ·   1
 *
 * 222 suspensos + 66 cancelados por Financeiro = 288 clientes cortados por
 * falta de pagamento — dito pelo proprio ERP do provedor, sem inferencia
 * nossa. E o "mais de 300 inadimplentes cancelados" que o dono cobrava e que a
 * nossa base mostrava como 27.
 *
 * As duas familias sao coisas opostas para o score:
 *
 *   financeiro     — o provedor cortou por calote. Sinal de risco.
 *   administrativo — o cliente pediu para sair, mudou de endereco, encerrou.
 *                    Nao pesa contra ninguem.
 *
 * O texto cru fica gravado em `customers.motivo_corte` (migracao 0019, coluna
 * de texto livre sem CHECK): cada ERP escreve com a redacao dele, e "Financeiro
 * - SPC" ja e um valor que ninguem tinha previsto. A normalizacao para as duas
 * familias mora aqui, em shared/, porque conector, score e tela precisam
 * concordar sobre o que "financeiro" quer dizer — duas copias da mesma regra
 * divergem com o tempo.
 */

/** As duas familias que importam para a decisao. `null` = nao reconhecido. */
export type MotivoCorte = "financeiro" | "administrativo";

export const MOTIVO_CORTE_ROTULO: Record<MotivoCorte, string> = {
  financeiro: "cortado por falta de pagamento",
  administrativo: "encerrado a pedido do cliente",
};

/** Tira acento e caixa para comparar redacoes que so diferem em grafia. */
function achatar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Texto cru do ERP -> familia, ou `null` quando nao da para afirmar.
 *
 * `null` NAO e "administrativo". Chutar o motivo do corte para o lado benigno
 * esconde inadimplencia real do bureau (o produto inteiro existe para nao
 * esconder isso); chutar para o maligno acusa de calote quem so pediu para
 * sair. Um motivo que ninguem reconheceu e ausencia de informacao, e ausencia
 * de informacao nao vira dado — a mesma regra que faz um titulo cancelado
 * antes de vencer nao virar divida.
 *
 * O casamento e por PREFIXO da familia, nao por igualdade: "Financeiro - SPC",
 * "Financeiro/Cobranca" e "Financeiro" sao todos corte por dinheiro, e exigir
 * a string exata deixaria de fora justamente as variacoes que os provedores
 * escrevem a mao. Prefixo tambem evita o falso positivo de buscar a palavra em
 * qualquer posicao: "Administrativo - erro do financeiro" e administrativo.
 */
export function normalizarMotivoCorte(bruto: string | null | undefined): MotivoCorte | null {
  if (!bruto) return null;
  const t = achatar(bruto);
  if (!t) return null;

  // A familia e a primeira palavra do motivo em todos os valores medidos; o
  // resto ("- SPC", "/Cobranca") e detalhe interno do provedor.
  if (/^financeir[oa]\b/.test(t)) return "financeiro";
  if (/^administrativ[oa]\b/.test(t)) return "administrativo";

  return null;
}

/**
 * O contrato acabou por falta de pagamento?
 *
 * Envolve `normalizarMotivoCorte` para que quem consulta o score nao precise
 * lembrar que `null` e desconhecido e nao "nao foi financeiro" — a comparacao
 * ingenua `motivo !== "administrativo"` transformaria todo motivo novo de ERP
 * em acusacao de calote.
 */
export function corteFinanceiro(bruto: string | null | undefined): boolean {
  return normalizarMotivoCorte(bruto) === "financeiro";
}
