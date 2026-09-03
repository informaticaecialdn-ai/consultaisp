import { useQuery } from "@tanstack/react-query";
import { STALE_SETTINGS } from "@/lib/queryClient";

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
 */

export interface PacoteDeCredito {
  id: string;
  nome: string;
  creditos: number;
  precoCentavos: number;
  precoReais: number;
  precoLabel: string;
  precoUnitarioCentavos: number;
  precoUnitarioLabel: string;
  popular: boolean;
}

export interface PrecoDePlano {
  chave: string;
  rotulo: string;
  precoCentavos: number;
  precoReais: number;
  precoLabel: string;
  creditosInclusos: { isp: number; spc: number };
  naVitrine: boolean;
}

export interface TabelaDePrecos {
  origem: "plataforma" | "marca";
  marcaId: number | null;
  pacotes: PacoteDeCredito[];
  planos: PrecoDePlano[];
  custoEmCreditos: Record<string, number>;
}

/** Tabela de quem esta logado — provedor ou superadmin. */
export function usePrecos() {
  return useQuery<TabelaDePrecos>({
    queryKey: ["/api/credits/packages"],
    staleTime: STALE_SETTINGS,
  });
}

/** Tabela da marca do host, para quem ainda nao tem sessao (landing, fatura publica). */
export function usePrecosPublicos() {
  return useQuery<TabelaDePrecos>({
    queryKey: ["/api/public/precos"],
    staleTime: STALE_SETTINGS,
  });
}

/**
 * "R$ 99" quando o valor e redondo, "R$ 99,90" quando nao e.
 *
 * So para vitrine. Em fatura e extrato o centavo aparece sempre — usar
 * `precoLabel`.
 */
export function precoCurto(preco: { precoCentavos: number; precoLabel: string }): string {
  if (preco.precoCentavos % 100 !== 0) return preco.precoLabel;
  return `R$ ${(preco.precoCentavos / 100).toLocaleString("pt-BR")}`;
}

/** Acha um plano pela chave (`free`, `pro`…) sem espalhar `.find` por cinco telas. */
export function planoPorChave(
  tabela: TabelaDePrecos | undefined,
  chave: string | null | undefined,
): PrecoDePlano | undefined {
  if (!tabela || !chave) return undefined;
  return tabela.planos.find((p) => p.chave === chave);
}
