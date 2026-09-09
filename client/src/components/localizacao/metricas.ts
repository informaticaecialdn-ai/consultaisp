import { num, pct, TRACO } from "./ui";

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


/* ── A rede: o que GET /api/localizacao/rede devolve e o que a tela faz com isso ── */

/** Uma cidade da área declarada na régua da rede — contagem por município. */
export interface CidadeRede {
  cidade: string;
  /** Σ dos bairros visíveis (≥ piso) — o que as bolhas somam. */
  ocorrencias: number;
  /** Σ dos bairros abaixo do piso. */
  ocultas: number;
  /** Ocorrências do próprio observador, visíveis + ocultas. */
  doObservador: number;
  /** Bairros visíveis onde o observador não tem caso — o ponto cego. */
  bairrosSemObservador: number;
}
export interface ObservadorRede {
  foraDaArea: number;
  cidadesForaDaArea: Array<{ cidade: string; ocorrencias: number }>;
}
export interface RedeResumo {
  cidades: CidadeRede[];
  /** null só no ramo sem área declarada. */
  observador: ObservadorRede | null;
  semArea: boolean;
  minPorBairro: number;
}

export interface CardRede { rotulo: string; valor: string; sub: string; titulo: string }

/**
 * Os quatro cards do modo Rede — o que a fileira de KPIs mostra quando a
 * camada Rede está ligada, no lugar dos números da carteira própria.
 *
 * Cada um responde a algo que nem o mapa nem o painel lateral respondem, e
 * respeita a regra de 02/09/2026 ao pé da letra: o que entra é contagem por
 * cidade (o grão que a soma das bolhas já entregava) ou número do próprio
 * observador. Nada por ponto, nada por bairro nomeado, nenhum valor, nenhum
 * provedor.
 *
 * Os cards 1 e 2 seguem o chip de cidade; 3 e 4 são sempre da área inteira —
 * "em que parte da minha área a rede está calada" e "quanto da minha carteira
 * a rede não cobre" não fazem sentido recortados. Sem dado, TRAÇO: número
 * impossível não vira zero.
 */
export function kpisDaRede(rede: RedeResumo | undefined, cidade: string | null, bairrosNoMapa: number): CardRede[] {
  const todas = rede?.cidades ?? [];
  const recorte = cidade ? todas.filter(c => c.cidade === cidade) : todas;
  const total = recorte.reduce((s, c) => s + c.ocorrencias + c.ocultas, 0);
  const seus = recorte.reduce((s, c) => s + c.doObservador, 0);
  const cegos = recorte.reduce((s, c) => s + c.bairrosSemObservador, 0);
  const piso = rede?.minPorBairro ?? 3;

  const comCaso = todas.filter(c => c.ocorrencias + c.ocultas > 0);
  const soAbaixoDoPiso = todas.filter(c => c.ocorrencias === 0 && c.ocultas > 0).length;

  const obs = rede?.observador ?? null;
  const topo = obs?.cidadesForaDaArea[0];
  const restoFora = obs ? obs.foraDaArea - (topo?.ocorrencias ?? 0) : 0;
  const seusNaArea = todas.reduce((s, c) => s + c.doObservador, 0);

  return [
    {
      rotulo: "Casos de outros provedores",
      valor: !rede || total === 0 ? TRACO : num(total - seus),
      sub: !rede || total === 0
        ? "sem caso na rede neste recorte"
        : `${num(total)} na rede · ${num(seus)} seus · ${pct((seus / total) * 100)}`,
      titulo: "Cadastro com dívida em outro provedor, nas suas cidades atendidas. A mesma pessoa pode contar em dois provedores. Sem nome, valor ou provedor de origem. Só cadastro com bairro entra na rede — nos dois lados desta conta.",
    },
    {
      rotulo: "Bairros sem caso seu",
      valor: !rede || bairrosNoMapa === 0 ? TRACO : num(cegos),
      sub: !rede || bairrosNoMapa === 0
        ? "nenhum bairro no mapa"
        : `de ${num(bairrosNoMapa)} com ${piso}+ casos na rede`,
      titulo: `Bairros com ${piso} ou mais casos na rede onde você não tem ex-cliente com dívida — onde a sua base sozinha diria "sem histórico". Para ver quais, compare com o mapa da sua carteira.`,
    },
    {
      rotulo: "Cidades atendidas com caso na rede",
      valor: !rede || todas.length === 0 ? TRACO : `${num(comCaso.length)} de ${num(todas.length)}`,
      sub: !rede || todas.length === 0
        ? "configure as cidades atendidas"
        : `${num(todas.length - comCaso.length)} sem caso na rede${soAbaixoDoPiso > 0 ? ` · ${num(soAbaixoDoPiso)} só abaixo do piso` : ""}`,
      titulo: "Sem caso não quer dizer sem risco: pode não haver provedor participante na cidade. Sempre da área inteira, sem o recorte do chip.",
    },
    {
      rotulo: "Seus ex-clientes fora da área",
      valor: !obs ? TRACO : num(obs.foraDaArea),
      sub: !obs
        ? "sem área declarada"
        : obs.foraDaArea === 0
          ? "toda a sua carteira de ex-clientes com dívida está na área"
          : `${num(topo!.ocorrencias)} em ${topo!.cidade}${restoFora > 0 ? ` · ${num(restoFora)} noutras` : ""} · ${num(seusNaArea)} na área`,
      titulo: "Ex-clientes seus com dívida em cidades que não estão nas atendidas — a rede não cobre. Só cadastro com bairro entra, nos dois lados. Declarar a cidade na Regionalização passa a cobri-la.",
    },
  ];
}

/** Os chips do modo Rede: só cidade com bolha no mapa — chip que esvazia o mapa é defeito. */
export function chipsDaRede(rede: RedeResumo | undefined): CidadeRede[] {
  return (rede?.cidades ?? []).filter(c => c.ocorrencias > 0);
}

/**
 * A linha discreta sob os chips: onde a rede está calada dentro da área. É o
 * que substitui, no modo Rede, "N cidades atendidas ainda sem cliente" — que
 * é conceito da carteira própria.
 */
export function cidadesCaladasDaRede(rede: RedeResumo | undefined): { semCaso: string[]; soAbaixoDoPiso: string[] } {
  const todas = rede?.cidades ?? [];
  return {
    semCaso: todas.filter(c => c.ocorrencias + c.ocultas === 0).map(c => c.cidade),
    soAbaixoDoPiso: todas.filter(c => c.ocorrencias === 0 && c.ocultas > 0).map(c => c.cidade),
  };
}
