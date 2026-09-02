/**
 * Território — loader das camadas fixas de fundo do mapa.
 *
 * O servidor devolve, por cidade e camada, um Float32Array intercalado
 * [lat0, lon0, lat1, lon1, ...] (8 bytes por ponto):
 *   • cnefe = todos os endereços-domicílio IBGE CNEFE 2022
 *   • aneel = UCs residenciais ativas ANEEL BDGD 2024
 *
 * O CNEFE tem duas origens, e não são o mesmo dado: o .bin do repositório é
 * só domicílio, um ponto por linha do censo; sem .bin o servidor monta a
 * camada da tabela do geocodificador, que inclui comércio e serviço e reduz
 * cada prédio a um ponto. O cabeçalho `X-Territorio-Origem` diz qual foi, e
 * a tela muda o rótulo — a contagem de uma não se compara com a da outra.
 *
 * Um fetch por ARQUIVO (cidade × camada), com cache HTTP e cache de módulo:
 * trocar a cidade em foco só recombina buffers já baixados. Cidade sem base
 * (404) vale como buffer vazio e fica em cache — é uma resposta, não uma
 * falha; a pill desabilita com o motivo. Erro de rede limpa a entrada, e
 * religar a camada tenta de novo.
 *
 * Sem Leaflet de propósito: a página importa daqui para o gate de WebGL e
 * para a contagem da legenda, sem puxar o mapa junto.
 */

export type CamadaTerritorio = 'cnefe' | 'aneel';

/** De onde o servidor tirou o arquivo: o .bin curado ou a tabela do geocodificador. */
export type OrigemTerritorio = 'bin' | 'banco';

export const CAMADA_META: Record<
  CamadaTerritorio,
  { label: string; cor: string; corRgb: [number, number, number]; fonte: string }
> = {
  // Hex fixo, não token: o WebGL não resolve var(), e o ponto tem de ser o
  // mesmo na legenda e no mapa em qualquer tema — os tiles não escurecem.
  // --cat-teal e --cat-violet do sistema: identidade, não estado.
  cnefe: {
    label: 'Endereços IBGE',
    cor: '#1F6F7A',
    corRgb: [31, 111, 122],
    fonte: 'IBGE CNEFE 2022',
  },
  aneel: {
    label: 'UCs ANEEL',
    cor: '#6A5C86',
    corRgb: [106, 92, 134],
    fonte: 'ANEEL BDGD 2024',
  },
};

/**
 * Rótulo e descrição honestos com a origem do CNEFE. Com pelo menos uma
 * cidade "de banco" no recorte, a camada não é mais "todos os domicílios":
 * é o índice de ruas e números do geocodificador, e o nome tem de dizer isso.
 */
export function rotuloTerritorio(
  camada: CamadaTerritorio,
  origem: OrigemTerritorio | 'misto' | null,
): { label: string; descricao: string } {
  const meta = CAMADA_META[camada];
  if (camada === 'cnefe' && (origem === 'banco' || origem === 'misto')) {
    return {
      label: 'Endereços IBGE (únicos por rua e número)',
      descricao: 'Endereços do censo, um por rua e número — inclui comércio e serviço, e um prédio inteiro vale um ponto',
    };
  }
  return {
    label: meta.label,
    descricao: camada === 'cnefe'
      ? 'Todos os endereços-domicílio do município'
      : 'Unidades consumidoras residenciais ativas',
  };
}

const VAZIO = new Float32Array(0);

interface ArquivoTerritorio {
  pontos: Float32Array;
  /** null quando a cidade não tem base (404). */
  origem: OrigemTerritorio | null;
}

const cache = new Map<string, Promise<ArquivoTerritorio>>();

function carregarArquivo(camada: CamadaTerritorio, cidade: string): Promise<ArquivoTerritorio> {
  const chave = `${camada}|${cidade}`;
  const cacheado = cache.get(chave);
  if (cacheado) return cacheado;

  const url = `/api/localizacao/territorio/${camada}/${encodeURIComponent(cidade)}`;
  const p = fetch(url, { cache: 'force-cache', credentials: 'include' }).then(async (r): Promise<ArquivoTerritorio> => {
    if (r.status === 404) return { pontos: VAZIO, origem: null };
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
    const origem: OrigemTerritorio = r.headers.get('X-Territorio-Origem') === 'banco' ? 'banco' : 'bin';
    return { pontos: new Float32Array(await r.arrayBuffer()), origem };
  });
  p.catch(() => {
    cache.delete(chave);
  });
  cache.set(chave, p);
  return p;
}

/**
 * Pontos da camada no recorte de cidades, concatenados, e de onde vieram.
 * Vazio = nenhuma das cidades tem base. `misto` = parte .bin, parte banco —
 * o rótulo cai para o mais fraco, porque a contagem já não é comparável.
 */
export function carregarTerritorio(
  camada: CamadaTerritorio,
  cidades: readonly string[],
): Promise<{ pontos: Float32Array; origem: OrigemTerritorio | 'misto' | null }> {
  if (cidades.length === 0) return Promise.resolve({ pontos: VAZIO, origem: null });
  return Promise.all(cidades.map(c => carregarArquivo(camada, c))).then(partes => {
    let origem: OrigemTerritorio | 'misto' | null = null;
    for (const a of partes) {
      if (a.origem === null) continue;
      if (origem === null) origem = a.origem;
      else if (origem !== a.origem) origem = 'misto';
    }
    if (partes.length === 1) return { pontos: partes[0].pontos, origem };
    const out = new Float32Array(partes.reduce((s, a) => s + a.pontos.length, 0));
    let off = 0;
    for (const a of partes) {
      out.set(a.pontos, off);
      off += a.pontos.length;
    }
    return { pontos: out, origem };
  });
}

/** Só os pontos — o que o mapa consome. */
export function carregarPontosTerritorio(
  camada: CamadaTerritorio,
  cidades: readonly string[],
): Promise<Float32Array> {
  return carregarTerritorio(camada, cidades).then(r => r.pontos);
}

let glOk: boolean | null = null;

/** WebGL disponível? Sondado uma vez; sem ele as pills ficam desabilitadas. */
export function webglDisponivel(): boolean {
  if (typeof document === 'undefined') return false;
  if (glOk === null) {
    try {
      const c = document.createElement('canvas');
      glOk = c.getContext('webgl') !== null || c.getContext('experimental-webgl') !== null;
    } catch {
      glOk = false;
    }
  }
  return glOk;
}
