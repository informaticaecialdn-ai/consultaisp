/**
 * Geocoding utilities — CEP, cidade, endereco completo, codigo IBGE.
 * Usa Google Maps Geocoding API quando GOOGLE_MAPS_API_KEY esta configurada.
 * Fallback pra Nominatim se Google nao disponivel.
 */

const _geoCache = new Map<string, [number, number] | null>();
const _ibgeCache = new Map<string, { city: string; state: string } | null>();

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const USE_GOOGLE = GOOGLE_API_KEY.length > 10;

function isInBrazil(lat: number, lng: number): boolean {
  return lat >= -34 && lat <= 6 && lng >= -74 && lng <= -34;
}

async function geocodeViaGoogle(query: string): Promise<[number, number] | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:BR&key=${GOOGLE_API_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.status === "OK" && data.results?.[0]) {
      const loc = data.results[0].geometry.location;
      if (isInBrazil(loc.lat, loc.lng)) {
        return [loc.lat, loc.lng];
      }
    }
  } catch {}
  return null;
}

async function geocodeViaNominatim(query: string): Promise<[number, number] | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`;
    const r = await fetch(url, {
      headers: { "User-Agent": "ConsultaISP/1.0 heatmap@consultaisp.com.br" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data: any[] = await r.json();
    if (data[0]) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      if (isInBrazil(lat, lon)) return [lat, lon];
    }
  } catch {}
  return null;
}

async function geocodeQuery(query: string): Promise<[number, number] | null> {
  if (USE_GOOGLE) return await geocodeViaGoogle(query);
  return await geocodeViaNominatim(query);
}

/** Geocodificar por endereco completo (rua + cidade + estado) — mais preciso */
export async function geocodeAddress(address: string, city: string, state: string): Promise<[number, number] | null> {
  const q = `${address}, ${city}, ${state}, Brasil`;
  const key = `addr:${q.toLowerCase()}`;
  if (_geoCache.has(key)) return _geoCache.get(key)!;
  const coords = await geocodeQuery(q);
  _geoCache.set(key, coords);
  return coords;
}

/** Geocodificar por cidade + estado — fallback quando endereco nao resolve */
export async function geocodeCity(city: string, state: string): Promise<[number, number] | null> {
  const key = `city:${city.toLowerCase()},${state.toLowerCase()}`;
  if (_geoCache.has(key)) return _geoCache.get(key)!;
  const q = `${city}, ${state}, Brasil`;
  const coords = await geocodeQuery(q);
  _geoCache.set(key, coords);
  return coords;
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
