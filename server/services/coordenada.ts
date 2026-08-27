/**
 * Coordenada do cliente — validação e origem.
 *
 * A melhor coordenada é a que o ERP já tem. O MK Solutions guarda a latitude e
 * a longitude da instalação por cliente — é o ponto exato onde o técnico
 * montou o serviço, não uma aproximação de rua. O sync normalizava esses
 * campos e os descartava, geocodificando o endereço pela rede no lugar: mais
 * lento, menos preciso e sujeito a um geocoder de terceiro estar de pé.
 *
 * Ordem de preferência da origem, da melhor para a pior:
 *   1. ERP        — coordenada real da instalação, custo zero, instantânea
 *   2. endereço   — geocodificada por rua + cidade, com jitter de ±100m (LGPD)
 *   3. cidade     — centro do município com jitter de ±2km, só situa a região
 */

/** Brasil vai de ~5°N a ~34°S e de ~34°W a ~74°W, com folga nas bordas. */
export function dentroDoBrasil(lat: number, lng: number): boolean {
  return lat >= -34 && lat <= 6 && lng >= -74 && lng <= -34;
}

/**
 * Valida o par vindo do ERP. Recusa vazio, texto, fora de faixa e o (0,0) do
 * golfo da Guiné, que os ERPs gravam como "não informado" e vira um ponto no
 * meio do oceano quando alguém acredita nele.
 */
export function coordenadaValida(
  lat: string | number | null | undefined,
  lng: string | number | null | undefined,
): { lat: number; lng: number } | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;

  const sLat = String(lat).trim().replace(",", ".");
  const sLng = String(lng).trim().replace(",", ".");
  if (!sLat || !sLng) return null;
  if (!/^-?\d+(\.\d+)?$/.test(sLat) || !/^-?\d+(\.\d+)?$/.test(sLng)) return null;

  const nLat = Number(sLat);
  const nLng = Number(sLng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null;
  if (nLat === 0 && nLng === 0) return null;
  if (!dentroDoBrasil(nLat, nLng)) return null;

  return { lat: nLat, lng: nLng };
}
