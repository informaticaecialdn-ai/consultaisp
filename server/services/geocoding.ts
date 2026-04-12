/**
 * Geocoding utilities — CEP, cidade, endereco completo, codigo IBGE.
 */

const _geoCache = new Map<string, [number, number] | null>();
const _ibgeCache = new Map<string, { city: string; state: string } | null>();

/** Geocodificar por endereco completo (rua + cidade + estado) — mais preciso */
export async function geocodeAddress(address: string, city: string, state: string): Promise<[number, number] | null> {
  const q = `${address}, ${city}, ${state}, Brasil`;
  const key = `addr:${q.toLowerCase()}`;
  if (_geoCache.has(key)) return _geoCache.get(key)!;
  try {
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
        if (lat >= -34 && lat <= 6 && lon >= -74 && lon <= -34) {
          const coords: [number, number] = [lat, lon];
          _geoCache.set(key, coords);
          return coords;
        }
      }
    }
  } catch {}
  _geoCache.set(key, null);
  return null;
}

/** Geocodificar por cidade + estado — fallback quando endereco nao resolve */
export async function geocodeCity(city: string, state: string): Promise<[number, number] | null> {
  const key = `city:${city.toLowerCase()},${state.toLowerCase()}`;
  if (_geoCache.has(key)) return _geoCache.get(key)!;
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
        if (lat >= -34 && lat <= 6 && lon >= -74 && lon <= -34) {
          const coords: [number, number] = [lat, lon];
          _geoCache.set(key, coords);
          return coords;
        }
        console.warn(`[Geocoding] Fora do Brasil: "${q}" → ${lat},${lon}`);
      }
    }
  } catch {}
  _geoCache.set(key, null);
  return null;
}

/** Geocodificar por CEP via Nominatim → lat/lng do bairro/regiao do CEP.
 * Cache por CEP unico (~100 CEPs unicos pra 6000 clientes → ~100 chamadas). */
export async function geocodeByCep(cep: string, city?: string, state?: string): Promise<[number, number] | null> {
  if (!cep) return null;
  const cleaned = cep.replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
  if (cleaned.length < 8) return null;
  const key = `cep:${cleaned}`;
  if (_geoCache.has(key)) return _geoCache.get(key)!;
  try {
    const q = city && state
      ? `${cleaned}, ${city}, ${state}, Brasil`
      : `${cleaned}, Brasil`;
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
        if (lat >= -34 && lat <= 6 && lon >= -74 && lon <= -34) {
          const coords: [number, number] = [lat, lon];
          _geoCache.set(key, coords);
          return coords;
        }
      }
    }
  } catch {}
  _geoCache.set(key, null);
  return null;
}

/** Resolver CEP → cidade + estado via ViaCEP */
export async function geocodeCep(cep: string): Promise<{ city: string; state: string; street?: string; neighborhood?: string } | null> {
  if (!cep || cep.length < 8) return null;
  try {
    const cleaned = cep.replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
    const r = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`, {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.localidade && data.uf) {
        return {
          city: data.localidade,
          state: data.uf,
          street: data.logradouro || undefined,
          neighborhood: data.bairro || undefined,
        };
      }
    }
  } catch {}
  return null;
}

/** Resolver codigo IBGE → nome da cidade + UF via API IBGE */
export async function resolveIbgeCode(code: string): Promise<{ city: string; state: string } | null> {
  if (!code || !/^\d+$/.test(code)) return null;
  if (_ibgeCache.has(code)) return _ibgeCache.get(code)!;
  try {
    const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${code}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.nome && data.microrregiao?.mesorregiao?.UF?.sigla) {
        const result = { city: data.nome, state: data.microrregiao.mesorregiao.UF.sigla };
        _ibgeCache.set(code, result);
        return result;
      }
    }
  } catch {}
  _ibgeCache.set(code, null);
  return null;
}
