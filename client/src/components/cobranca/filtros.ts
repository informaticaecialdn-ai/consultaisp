/**
 * Filtros da carteira — o estado da barra de pílulas e a sua tradução para a
 * query de `GET /api/cobranca/carteira`.
 *
 * Só existem aqui os parâmetros que a rota aceita (carteira, status, etapa,
 * quadrante, saude, divida, bairro, busca, pagina). Um filtro que o servidor
 * não recebe seria filtro só da página carregada — o total no rodapé mentiria.
 * Por isso "Situação" aqui é a situação do CASO (o `status` da rota) e a
 * situação do ERP aparece como selo no card, não como pílula.
 *
 * A URL carrega os filtros (`/cobranca?carteira=ex_cliente&quadrante=C3`) para
 * a régua e o DNA poderem apontar para um recorte da carteira.
 */
import {
  ETAPAS_PADRAO,
  QUADRANTES,
  ROTULO_STATUS_DE_CASO,
  ROTULO_TOM,
  ABORDAGEM_POR_QUADRANTE,
  STATUS_ABERTOS_DE_CASO,
  STATUS_FECHADOS_DE_CASO,
  type Carteira,
  type Quadrante,
} from "@shared/cobranca";

export interface FiltrosDaCarteira {
  carteira: Carteira;
  busca: string;
  status: string;
  etapa: string;
  quadrante: string;
  saude: string;
  divida: string;
  bairro: string;
  /** Realidade mensal (so no espaco de ativos): "AAAA-MM"; vazio = mes corrente. */
  mes: string;
  /** Qual grupo do mes filtra a lista: pago · inadimplente · a_vencer · sem_fatura; vazio = nenhum. */
  mesStatus: string;
  pagina: number;
}

export const GRUPOS_DO_MES = ["pago", "inadimplente", "a_vencer", "sem_fatura"] as const;
export type GrupoDoMes = (typeof GRUPOS_DO_MES)[number];

export const FILTROS_INICIAIS: FiltrosDaCarteira = {
  carteira: "ativo",
  busca: "",
  status: "",
  etapa: "",
  quadrante: "",
  saude: "",
  divida: "",
  bairro: "",
  mes: "",
  mesStatus: "",
  pagina: 1,
};

export interface OpcaoDeFiltro {
  valor: string;
  rotulo: string;
  /** Texto curto no chip quando selecionada; sem ele vale o rótulo. */
  chip?: string;
  /** O que a opção significa — vai no `title` dela (o motivo da faixa de atraso, por exemplo). */
  titulo?: string;
}

/** Grupo (A/B/C) e os nove quadrantes, com a abordagem no rótulo — como o Provedor.ai lista. */
export const OPCOES_QUADRANTE: OpcaoDeFiltro[] = [
  { valor: "A", rotulo: "Grupo A · em dia", chip: "A" },
  { valor: "B", rotulo: "Grupo B · oscila", chip: "B" },
  { valor: "C", rotulo: "Grupo C · crônico", chip: "C" },
  ...QUADRANTES.map(q => ({
    valor: q,
    rotulo: `${q} · ${ROTULO_TOM[ABORDAGEM_POR_QUADRANTE[q as Quadrante]].toLowerCase()}`,
    chip: q,
  })),
];

/** Faixas do `isp_score` (0–1000), os mesmos cortes de `--score-*` do DESIGN_SYSTEM. */
export const OPCOES_SAUDE: OpcaoDeFiltro[] = [
  { valor: "boa", rotulo: "Boa (701–1000)", chip: "boa" },
  { valor: "media", rotulo: "Média (501–700)", chip: "média" },
  { valor: "baixa", rotulo: "Baixa (301–500)", chip: "baixa" },
  { valor: "critica", rotulo: "Crítica (0–300)", chip: "crítica" },
];

export const OPCOES_ETAPA: OpcaoDeFiltro[] = ETAPAS_PADRAO.map(e => ({
  valor: e.id,
  rotulo: e.rotulo,
}));

/**
 * Situação do CASO — os vivos primeiro, os fechados depois. Sem filtro a rota
 * traz vivos + quem deve sem caso; `todos` inclui os fechados; `sem_caso` é só
 * quem deve e ainda não entrou.
 */
export const OPCOES_STATUS: OpcaoDeFiltro[] = [
  ...STATUS_ABERTOS_DE_CASO.map(s => ({ valor: s, rotulo: ROTULO_STATUS_DE_CASO[s] })),
  ...STATUS_FECHADOS_DE_CASO.map(s => ({ valor: s, rotulo: ROTULO_STATUS_DE_CASO[s] })),
  { valor: "sem_caso", rotulo: "Sem caso aberto", chip: "sem caso" },
  { valor: "todos", rotulo: "Todos, inclusive fechados", chip: "todos" },
];

/** As mesmas faixas de `FaixaDeDivida` do storage. */
export const OPCOES_DIVIDA: OpcaoDeFiltro[] = [
  { valor: "ate-100", rotulo: "Até R$ 100", chip: "até 100" },
  { valor: "100-300", rotulo: "R$ 100 a 300", chip: "100–300" },
  { valor: "300-1000", rotulo: "R$ 300 a 1.000", chip: "300–1.000" },
  { valor: "1000-mais", rotulo: "Acima de R$ 1.000", chip: "1.000+" },
];

const CHAVES_DE_FILTRO = ["status", "etapa", "quadrante", "saude", "divida", "bairro", "mesStatus"] as const;

/** Algum filtro além da carteira e da página está ligado. */
export function temFiltros(f: FiltrosDaCarteira): boolean {
  return f.busca.trim() !== "" || CHAVES_DE_FILTRO.some(k => f[k] !== "");
}

/** Mantém a carteira, limpa o resto — trocar de aba não deve carregar o filtro de bairro da outra. */
export function limparFiltros(f: FiltrosDaCarteira): FiltrosDaCarteira {
  return { ...FILTROS_INICIAIS, carteira: f.carteira };
}

/**
 * A query string, só com o que está ligado. `pagina` só a partir da 2 — a
 * primeira página é a URL limpa, que é a que se compartilha.
 */
export function queryDaCarteira(f: FiltrosDaCarteira): string {
  const p = new URLSearchParams();
  p.set("carteira", f.carteira);
  const busca = f.busca.trim();
  if (busca) p.set("busca", busca);
  for (const k of CHAVES_DE_FILTRO) if (f[k]) p.set(k, f[k]);
  // O mes so viaja quando ha um grupo do mes ligado ou quando nao e o corrente:
  // a URL limpa continua sendo a que se compartilha.
  if (f.mes) p.set("mes", f.mes);
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  return p.toString();
}

/** O inverso: a URL da tela vira estado. Valor desconhecido cai no padrão, nunca em erro. */
export function filtrosDaUrl(search: string): FiltrosDaCarteira {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const carteira = p.get("carteira");
  const pagina = Number(p.get("pagina") ?? "1");
  return {
    carteira: carteira === "ex_cliente" ? "ex_cliente" : "ativo",
    busca: p.get("busca") ?? "",
    status: p.get("status") ?? "",
    etapa: p.get("etapa") ?? "",
    quadrante: p.get("quadrante") ?? "",
    saude: p.get("saude") ?? "",
    divida: p.get("divida") ?? "",
    bairro: p.get("bairro") ?? "",
    mes: /^\d{4}-(0[1-9]|1[0-2])$/.test(p.get("mes") ?? "") ? (p.get("mes") as string) : "",
    mesStatus: (GRUPOS_DO_MES as readonly string[]).includes(p.get("mesStatus") ?? "") ? (p.get("mesStatus") as string) : "",
    pagina: Number.isInteger(pagina) && pagina > 1 ? pagina : 1,
  };
}

/**
 * Dois estados dizem o mesmo recorte? Comparados pela query, não campo a
 * campo: busca com espaço a mais ou página 1 explícita são o mesmo recorte.
 * É o que a carteira usa para saber se a URL mudou POR FORA (menu, link do
 * DNA, botão voltar) e precisa virar estado — sem isso a tela ficava presa
 * nos filtros da primeira montagem.
 */
export function mesmosFiltros(a: FiltrosDaCarteira, b: FiltrosDaCarteira): boolean {
  return queryDaCarteira(a) === queryDaCarteira(b);
}

export const POR_PAGINA = 50;

export function totalDePaginas(total: number, porPagina = POR_PAGINA): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / porPagina));
}

/* ── Visão cards/tabela ──────────────────────────────────────────────── */

export type VisaoDaCarteira = "cards" | "tabela";
export const CHAVE_VISAO = "cobranca:visao-carteira";

export function lerVisao(armazem: Pick<Storage, "getItem"> | null | undefined): VisaoDaCarteira {
  try {
    const v = armazem?.getItem(CHAVE_VISAO);
    return v === "tabela" ? "tabela" : "cards";
  } catch {
    return "cards";
  }
}
