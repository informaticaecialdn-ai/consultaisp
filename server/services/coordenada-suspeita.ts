/**
 * Deteccao de coordenada incoerente com a cidade declarada.
 *
 * O ERP erra coordenada com frequencia: geocodificacao que cai no centroide de
 * outra cidade homonima, endereco da matriz gravado como padrao, lat/lon
 * trocados. Um unico ponto errado a 400km estica o enquadramento do mapa e a
 * tela abre numa regiao onde o provedor nao atende.
 *
 * A regra compara cada ponto com a mediana dos outros clientes da MESMA cidade.
 * A mediana e robusta: nao se desloca por causa de um ou dois pontos errados,
 * ao contrario da media. Cidade com poucos clientes nao tem massa para julgar,
 * entao fica de fora — melhor nao acusar do que acusar errado.
 */

/** Raio alem do qual o ponto nao e coerente com a cidade que ele declara. */
export const RAIO_MAX_KM = 50;

/** Abaixo disso a mediana da cidade nao e confiavel o bastante para julgar. */
export const MIN_PONTOS_CIDADE = 4;

export interface PontoGeo {
  lat: number;
  lon: number;
  cidade: string;
}

/** Haversine. Raio medio da Terra em km. */
export function distanciaKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Mediana simples; em lista par, media dos dois centrais. */
export function mediana(valores: number[]): number {
  if (valores.length === 0) return NaN;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Centro robusto de um conjunto de pontos: mediana de lat e de lon
 * independentemente. Nao e o centroide geometrico, e o suficiente aqui —
 * a carteira de uma cidade cabe em poucas dezenas de km.
 */
export function centroMediano(pontos: PontoGeo[]): { lat: number; lon: number } {
  return {
    lat: mediana(pontos.map(p => p.lat)),
    lon: mediana(pontos.map(p => p.lon)),
  };
}

/** Retangulo que envolve o municipio, vindo dos enderecos do IBGE. */
export interface CaixaCidade {
  latMin: number; latMax: number; lonMin: number; lonMax: number;
}

/**
 * Separa os pontos cuja coordenada nao bate com a cidade declarada.
 * Preserva a ordem de entrada nas duas listas.
 *
 * DUAS REGUAS, nesta ordem:
 *
 * 1. A CAIXA do municipio, quando o CNEFE do IBGE esta carregado para aquela
 *    cidade. E a regua boa: um ponto fora da caixa esta certamente fora do
 *    municipio. Dentro da caixa pode ainda estar fora da divisa (o canto do
 *    retangulo), e isso passa de proposito — so acusamos o que e certo.
 *
 * 2. O RAIO em volta da mediana, para cidade sem CNEFE. E grosseiro: no norte
 *    do Parana as cidades ficam a 30-45 km umas das outras, entao 50 km de raio
 *    deixa passar um cliente geocodificado na cidade vizinha. Foi assim que
 *    quatro pontos da carteira da NsLink apareceram fora do municipio deles —
 *    a 47 km, dentro do raio. Regua de reserva, nao regua principal.
 */
export function separarCoordenadasSuspeitas<T extends PontoGeo>(
  pontos: T[],
  raioKm: number = RAIO_MAX_KM,
  minPontosCidade: number = MIN_PONTOS_CIDADE,
  caixas?: Map<string, CaixaCidade>,
): { coerentes: T[]; suspeitos: T[] } {
  const porCidade = new Map<string, T[]>();
  for (const p of pontos) {
    const chave = (p.cidade || "").trim().toUpperCase();
    const lista = porCidade.get(chave);
    if (lista) lista.push(p);
    else porCidade.set(chave, [p]);
  }

  const centros = new Map<string, { lat: number; lon: number }>();
  for (const [chave, lista] of Array.from(porCidade.entries())) {
    if (lista.length >= minPontosCidade) centros.set(chave, centroMediano(lista));
  }

  const coerentes: T[] = [];
  const suspeitos: T[] = [];
  for (const p of pontos) {
    const chave = (p.cidade || "").trim().toUpperCase();

    const caixa = caixas?.get(chave);
    if (caixa) {
      const dentro =
        p.lat >= caixa.latMin && p.lat <= caixa.latMax &&
        p.lon >= caixa.lonMin && p.lon <= caixa.lonMax;
      (dentro ? coerentes : suspeitos).push(p);
      continue;
    }

    const centro = centros.get(chave);
    if (!centro) { coerentes.push(p); continue; }
    if (distanciaKm(p.lat, p.lon, centro.lat, centro.lon) > raioKm) suspeitos.push(p);
    else coerentes.push(p);
  }
  return { coerentes, suspeitos };
}
