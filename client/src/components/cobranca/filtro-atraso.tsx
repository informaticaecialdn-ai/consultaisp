/**
 * O filtro por FAIXA DE ATRASO do quadro — a pílula, o estado e a URL.
 *
 * Pedido do dono (06/09/2026), com as faixas escritas por ele: até 7 · 8 a 15
 * · 16 a 30 · 31 a 60 · 61 a 90 · mais de 90 dias, e a razão do último corte —
 * *"a partir de 90 dias dificilmente o cliente ainda está com o contrato
 * ativo"*. Vale nas DUAS carteiras: o quadro é o mesmo com a carteira trocada.
 *
 * A régua vive em `shared/cobranca/faixa-atraso.ts`, uma fonte só para a tela
 * e para o SQL. Aqui não se decide nada sobre dias: só se escolhe uma das seis
 * e se escreve o recorte na URL.
 *
 * **Por que na URL.** O recorte precisa ser compartilhável (o operador manda o
 * link "os de mais de 90 dias" para o colega) e, principalmente, precisa ser o
 * MESMO recorte que o servidor conta: a faixa vai em `atraso=` na URL e em
 * `atraso=` na query da API. Filtrar na tela a página já carregada deixaria o
 * total do rodapé mentindo — ele conta o recorte inteiro, não a página.
 *
 * **Contagem por faixa.** `contagens` é opcional e só é desenhada quando o
 * servidor manda o número. Sem ele a opção sai sem número — nunca zero, que
 * seria dizer "não há ninguém aqui" quando ninguém contou.
 */
// `jsx: preserve` no tsconfig: fora do Vite (o vitest, que renderiza a pílula
// em SSR) o esbuild compila JSX para `React.createElement`.
import * as React from "react";
import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import {
  FAIXAS_DE_ATRASO,
  LIMITES_DA_FAIXA_DE_ATRASO,
  faixaDeAtrasoValida,
  type Carteira,
  type FaixaDeAtraso,
} from "@shared/cobranca";
import { FiltroPilula } from "./ui";
import type { OpcaoDeFiltro } from "./filtros";

/** O nome do parâmetro, na URL da tela e na query da API — um só, os dois lados. */
export const PARAMETRO_ATRASO = "atraso";

/** A faixa escolhida; `""` = todas (sem recorte por atraso). */
export type AtrasoSelecionado = FaixaDeAtraso | "";

/** Texto curto no chip quando a faixa está ligada ("Atraso: 31–60d"). */
const CHIP_DA_FAIXA: Record<FaixaDeAtraso, string> = {
  "ate-7": "até 7d",
  "8-15": "8–15d",
  "16-30": "16–30d",
  "31-60": "31–60d",
  "61-90": "61–90d",
  "mais-90": "90+d",
};

/**
 * Na carteira de ex-clientes o atraso costuma ser de anos, e a última faixa
 * não tem teto: ela agrupa de 91 dias em diante. O `title` avisa — se vale
 * uma sétima faixa por ano é decisão de produto, não da tela.
 */
const COMPLEMENTO_EX_CLIENTE =
  " Em ex-clientes esta faixa não tem teto: agrupa de 91 dias em diante, inclusive atrasos de anos.";

/** O que o `title` da pílula diz quando nenhuma faixa está ligada. */
export const TITULO_DO_FILTRO =
  "Recorta o quadro pelos dias de atraso da fatura mais antiga, como veio do ERP na última varredura.";

/** O `title` de uma faixa: o motivo dela, e o aviso do teto quando a carteira é de ex-clientes. */
export function tituloDaFaixa(faixa: FaixaDeAtraso, carteira?: Carteira): string {
  const { motivo } = LIMITES_DA_FAIXA_DE_ATRASO[faixa];
  return faixa === "mais-90" && carteira === "ex_cliente" ? `${motivo}${COMPLEMENTO_EX_CLIENTE}` : motivo;
}

/** O `title` da pílula: o texto geral e, com faixa ligada, o motivo dela. */
export function tituloDoFiltro(valor: AtrasoSelecionado, carteira?: Carteira): string {
  if (!faixaDeAtrasoValida(valor)) return TITULO_DO_FILTRO;
  return `${TITULO_DO_FILTRO} ${tituloDaFaixa(valor, carteira)}`;
}

export interface ContagensPorFaixa {
  [faixa: string]: number | null | undefined;
}

/**
 * As seis opções, na ordem da régua. O rótulo e o motivo saem de
 * `LIMITES_DA_FAIXA_DE_ATRASO` — a tela não reescreve o vocabulário do dono.
 */
export function opcoesDeAtraso(
  { contagens, carteira }: { contagens?: ContagensPorFaixa | null; carteira?: Carteira } = {},
): OpcaoDeFiltro[] {
  return FAIXAS_DE_ATRASO.map(faixa => {
    const n = contagens?.[faixa];
    const contada = typeof n === "number" && Number.isFinite(n);
    return {
      valor: faixa,
      rotulo: contada ? `${LIMITES_DA_FAIXA_DE_ATRASO[faixa].rotulo} · ${n}` : LIMITES_DA_FAIXA_DE_ATRASO[faixa].rotulo,
      chip: CHIP_DA_FAIXA[faixa],
      titulo: tituloDaFaixa(faixa, carteira),
    };
  });
}

/* ── URL ─────────────────────────────────────────────────────────────── */

/** A faixa que está na URL. Valor que não é uma das seis é ignorado — a tela não cai por causa de um link torto. */
export function atrasoDaUrl(search: string): AtrasoSelecionado {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const v = p.get(PARAMETRO_ATRASO);
  return faixaDeAtrasoValida(v) ? v : "";
}

/**
 * A próxima URL com a faixa trocada, preservando os outros parâmetros.
 * `""` remove o parâmetro — a URL limpa é a que se compartilha. A página cai
 * junto: página 3 de outro recorte não quer dizer nada.
 */
export function urlComAtraso(caminho: string, search: string, faixa: AtrasoSelecionado): string {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (faixaDeAtrasoValida(faixa)) p.set(PARAMETRO_ATRASO, faixa);
  else p.delete(PARAMETRO_ATRASO);
  p.delete("pagina");
  const q = p.toString();
  return q ? `${caminho}?${q}` : caminho;
}

/**
 * O estado do filtro. A URL é a fonte da verdade — não há cópia em `useState`
 * que possa divergir dela —, e trocar de faixa é `replace`: cada pílula não
 * vira um passo no histórico (o mesmo que a carteira faz).
 */
export function useFiltroDeAtraso(): { atraso: AtrasoSelecionado; setAtraso: (valor: string) => void } {
  const [caminho, navegar] = useLocation();
  const search = useSearch();
  const atraso = atrasoDaUrl(search);
  const setAtraso = useCallback(
    (valor: string) => {
      const faixa: AtrasoSelecionado = faixaDeAtrasoValida(valor) ? valor : "";
      navegar(urlComAtraso(caminho, search, faixa), { replace: true });
    },
    [caminho, search, navegar],
  );
  return { atraso, setAtraso };
}

/* ── A pílula ────────────────────────────────────────────────────────── */

/**
 * A pílula do topo do quadro. Reaproveita `FiltroPilula` (chip com `<select>`
 * nativo dentro: teclado, leitor de tela e celular de graça).
 */
export function FiltroDeAtraso({ valor, onChange, contagens, carteira, testId = "filtro-atraso" }: {
  valor: string;
  onChange: (valor: string) => void;
  contagens?: ContagensPorFaixa | null;
  carteira?: Carteira;
  testId?: string;
}) {
  const selecionada: AtrasoSelecionado = faixaDeAtrasoValida(valor) ? valor : "";
  return (
    <FiltroPilula
      rotulo="Atraso"
      valor={selecionada}
      opcoes={opcoesDeAtraso({ contagens, carteira })}
      onChange={onChange}
      titulo={tituloDoFiltro(selecionada, carteira)}
      rotuloVazio="Todas as faixas"
      testId={testId}
    />
  );
}
