/**
 * CEP and city geocoding utilities.
 * Extracted from heatmap-cache.ts for reuse across modules.
 */

const _cityGeo = new Map<string, [number, number] | null>();

export async function geocodeCity(city: string, state: string): Promise<[number, number] | null> {
  const key = `${city.toLowerCase()},${state.toLowerCase()}`;
  if (_cityGeo.has(key)) return _cityGeo.get(key)!;
  try {
    const q = `${city}, ${state}, Brasil`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=br`;
    const r = await fetch(url, {
      headers: { "User-Agent": "ConsultaISP/1.0 heatmap@consultaisp.com.br" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const data: any[] = await r.json();
      if (data[0]) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        // Validar que coordenadas estao dentro do Brasil (-34 a 5 lat, -74 a -35 lng)
        if (lat >= -34 && lat <= 6 && lon >= -74 && lon <= -34) {
          const coords: [number, number] = [lat, lon];
          _cityGeo.set(key, coords);
          return coords;
        }
        console.warn(`[Geocoding] Coordenadas fora do Brasil para "${q}": ${lat},${lon} — ignorando`);
      }
    }
  } catch {
    // Geocoding failure is non-critical; cache null to avoid repeated requests
  }
  _cityGeo.set(key, null);
  return null;
}

export async function geocodeCep(cep: string): Promise<{ city: string; state: string } | null> {
  if (!cep || cep.length < 8) return null;
  try {
    const cleaned = cep.replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
    const r = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`, {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.localidade && data.uf) return { city: data.localidade, state: data.uf };
    }
  } catch {
    // CEP lookup failure is non-critical
  }
  return null;
}
