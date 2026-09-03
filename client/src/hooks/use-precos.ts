import { useQuery } from "@tanstack/react-query";
import { STALE_SETTINGS } from "@/lib/queryClient";
import type { TabelaDePrecos } from "@/lib/precos";

/**
 * PRECO VEM DO SERVIDOR. O CLIENT NAO TEM TABELA.
 *
 * Cada tela mantinha a propria copia: `painel-provedor` anunciava planos de
 * R$ 199/399/799 que a fatura nunca cobrou, `admin-creditos` mandava comprar
 * pacotes com id que o servidor ja nao reconhecia (a compra respondia "Pacote
 * invalido"), e `invoice-view`, `admin-financeiro` e `FinanceiroTab` guardavam
 * cada um a sua copia dos creditos inclusos no plano. Cada mudanca de preco
 * exigia lembrar de cinco arquivos, e ninguem lembrava.
 *
 * Com o white label a copia deixa de ser so desatualizada e passa a ser
 * ERRADA: o preco depende da marca que o provedor veste, e o client nao tem
 * como saber disso. Ha um teste-guarda que falha se algum arquivo de
 * `client/src` voltar a importar a tabela de `@shared/*`.
 *
 * A FORMA e as derivacoes moram em `@/lib/precos`, sem React, para poderem ser
 * testadas — foi na borda delas que as telas erraram: tabela ausente virava
 * `?? 0`, e `?? 0` em preco nao e "ainda nao sei", e "de graca".
 */

export type {
  PacoteDeCredito,
  PrecoDePlano,
  TabelaDePrecos,
  CamposDaFatura,
} from "@/lib/precos";
export {
  precoCurto,
  planoPorChave,
  camposDaFatura,
  pedidoDeCreditoPronto,
  precoDoCreditoUnico,
  fraseDoCredito,
  linhaDeCreditosDoPlano,
} from "@/lib/precos";

/**
 * `retry: 1` contra o `retry: false` global.
 *
 * Preco e a unica leitura cuja falha muda o que a tela AFIRMA — sem ele a
 * landing anuncia um retangulo cinza no lugar do valor e o formulario de
 * fatura fica sem plano nenhum. Uma segunda tentativa cobre a queda de rede de
 * um segundo; para o resto, cada tela trata `isError` explicitamente.
 */
const TENTATIVAS = 1;

/** Tabela de quem esta logado — provedor ou superadmin. */
export function usePrecos() {
  return useQuery<TabelaDePrecos>({
    queryKey: ["/api/credits/packages"],
    staleTime: STALE_SETTINGS,
    retry: TENTATIVAS,
  });
}

/** Tabela da marca do host, para quem ainda nao tem sessao (landing, fatura publica). */
export function usePrecosPublicos() {
  return useQuery<TabelaDePrecos>({
    queryKey: ["/api/public/precos"],
    staleTime: STALE_SETTINGS,
    retry: TENTATIVAS,
  });
}
