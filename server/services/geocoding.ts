/**
 * Geocoding utilities — CEP, cidade, endereco completo, codigo IBGE.
 *
 * Duas respostas negativas que parecem iguais e nao sao:
 *
 * - **nao_encontrado** — o geocoder respondeu e nao conhece aquele endereco.
 *   Definitivo: vale cachear e vale desistir do cliente.
 * - **indisponivel** — chave recusada, quota estourada, timeout, egress
 *   bloqueado. Nao diz NADA sobre o endereco. Cachear isso como negativo
 *   envenena o cache ate o processo reiniciar, e tratar como "nao existe"
 *   fez o backfill marcar a base inteira como irresolvivel em producao.
 *
 * Por isso as funcoes internas devolvem GeoResposta, e so o desfecho
 * definitivo entra no cache. As funcoes publicas antigas (geocodeAddress,
 * geocodeCity) continuam devolvendo coords-ou-null para os chamadores que ja
 * existiam; quem precisa da distincao usa as versoes ...Detalhado.
 */
import { logger } from "../logger";

export type GeoFalha = "nao_encontrado" | "indisponivel";
export type GeoResposta =
  | { coords: [number, number]; falha?: undefined; motivo?: undefined }
  | { coords?: undefined; falha: GeoFalha; motivo?: string };

const _geoCache = new Map<string, [number, number] | null>();
const _ibgeCache = new Map<string, { city: string; state: string } | null>();

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const USE_GOOGLE = GOOGLE_API_KEY.length > 10;

/** Chamadas que realmente foram a rede. Quem controla ritmo (backfill) usa
 *  isto para so pausar quando pagou rede — resposta de cache nao merece espera. */
let _chamadasDeRede = 0;
export function chamadasDeRede(): number {
  return _chamadasDeRede;
}

/* ── Circuit breaker do Google ──────────────────────────────────────────
   Chave restrita por referrer, Geocoding API desabilitada no projeto ou
   quota estourada devolvem HTTP 200 com status de erro no corpo. Sem isto,
   cada cliente pagava uma chamada condenada antes de cair no Nominatim. */
const JANELA_GOOGLE_FORA_MS = 10 * 60 * 1000;
let falhasSeguidasGoogle = 0;
let googleForaAte = 0;

function googleDisponivel(): boolean {
  return USE_GOOGLE && Date.now() >= googleForaAte;
}

/** Qual provedor esta atendendo agora. Serve para log e diagnostico; o ritmo
 *  das chamadas nao e mais responsabilidade de quem chama (ver abaixo). */
export function usandoNominatim(): boolean {
  return !googleDisponivel();
}

/* ── Ritmo do Nominatim ─────────────────────────────────────────────────
   O Nominatim publico permite 1 req/s e bane quem passa disso. Deixar o
   ritmo por conta de quem chama nao funciona: o backfill pausava conforme a
   chave do Google existir, mas quando o Google falha a chamada cai aqui no
   Nominatim mesmo assim — e os outros chamadores (sync de ERP, heatmap) nunca
   pausaram nada. Serializar aqui dentro e o unico lugar onde a regra vale
   para todo mundo. */
// Quem hospeda a própria instância do Nominatim não tem esse limite e pode
// baixar o intervalo por ambiente.
const ESPACO_NOMINATIM_MS = Number(process.env.GEOCODE_INTERVALO_NOMINATIM_MS) || 1100;
let ultimaChamadaNominatim = 0;
let filaNominatim: Promise<void> = Promise.resolve();

function aguardarVezNoNominatim(): Promise<void> {
  filaNominatim = filaNominatim.then(async () => {
    const espera = ultimaChamadaNominatim + ESPACO_NOMINATIM_MS - Date.now();
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    ultimaChamadaNominatim = Date.now();
  });
  return filaNominatim;
}

/** Um aviso por motivo distinto. A causa (REQUEST_DENIED, timeout, 429) tem
 *  que aparecer no log — foi a falta dela que tornou a falha invisivel. */
const jaAvisado = new Set<string>();
function avisar(provedor: string, motivo: string | undefined) {
  const chave = `${provedor}:${motivo ?? "sem motivo"}`;
  if (jaAvisado.has(chave)) return;
  jaAvisado.add(chave);
  logger.warn({ provedor, motivo }, "Geocoder indisponivel");
}

function isInBrazil(lat: number, lng: number): boolean {
  return lat >= -34 && lat <= 6 && lng >= -74 && lng <= -34;
}

async function geocodeViaGoogle(query: string): Promise<GeoResposta> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:BR&key=${GOOGLE_API_KEY}`;
  let r: Response;
  _chamadasDeRede++;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch (err: any) {
    return { falha: "indisponivel", motivo: `rede: ${err?.name || err?.message || "erro"}` };
  }
  if (!r.ok) return { falha: "indisponivel", motivo: `http ${r.status}` };

  let data: any;
  try {
    data = await r.json();
  } catch {
    return { falha: "indisponivel", motivo: "resposta ilegivel" };
  }

  if (data.status === "OK" && data.results?.[0]) {
    const loc = data.results[0].geometry.location;
    if (isInBrazil(loc.lat, loc.lng)) return { coords: [loc.lat, loc.lng] };
    return { falha: "nao_encontrado", motivo: "resultado fora do Brasil" };
  }
  if (data.status === "ZERO_RESULTS") return { falha: "nao_encontrado" };
  // REQUEST_DENIED, OVER_QUERY_LIMIT, INVALID_REQUEST, UNKNOWN_ERROR
  return {
    falha: "indisponivel",
    motivo: data.error_message ? `${data.status}: ${data.error_message}` : String(data.status || "sem status"),
  };
}

async function geocodeViaNominatim(query: string): Promise<GeoResposta> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`;
  let r: Response;
  await aguardarVezNoNominatim();
  _chamadasDeRede++;
  try {
    r = await fetch(url, {
      headers: { "User-Agent": "ConsultaISP/1.0 heatmap@consultaisp.com.br" },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err: any) {
    return { falha: "indisponivel", motivo: `rede: ${err?.name || err?.message || "erro"}` };
  }
  if (!r.ok) return { falha: "indisponivel", motivo: `http ${r.status}` };

  let data: any[];
  try {
    data = await r.json();
  } catch {
    return { falha: "indisponivel", motivo: "resposta ilegivel" };
  }

  if (!Array.isArray(data) || data.length === 0) return { falha: "nao_encontrado" };
  const lat = parseFloat(data[0].lat);
  const lon = parseFloat(data[0].lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return { falha: "nao_encontrado" };
  if (!isInBrazil(lat, lon)) return { falha: "nao_encontrado", motivo: "resultado fora do Brasil" };
  return { coords: [lat, lon] };
}

/**
 * Google quando ha chave, com queda para o Nominatim quando ele nao responde.
 * A queda so acontece em `indisponivel`: se o Google respondeu "nao conheco",
 * perguntar de novo ao Nominatim seria pagar rede por uma resposta que ja veio.
 */
async function geocodeQuery(query: string): Promise<GeoResposta> {
  if (googleDisponivel()) {
    const r = await geocodeViaGoogle(query);
    if (r.coords) {
      falhasSeguidasGoogle = 0;
      return r;
    }
    if (r.falha === "nao_encontrado") {
      falhasSeguidasGoogle = 0;
      return r;
    }

    avisar("google", r.motivo);
    if (++falhasSeguidasGoogle >= 3) {
      googleForaAte = Date.now() + JANELA_GOOGLE_FORA_MS;
      falhasSeguidasGoogle = 0;
      logger.warn(
        { motivo: r.motivo, minutos: JANELA_GOOGLE_FORA_MS / 60000 },
        "Google Geocoding suspenso temporariamente — usando Nominatim",
      );
    }

    const alternativa = await geocodeViaNominatim(query);
    if (alternativa.falha === "indisponivel") {
      avisar("nominatim", alternativa.motivo);
      return { falha: "indisponivel", motivo: `google: ${r.motivo} | nominatim: ${alternativa.motivo}` };
    }
    return alternativa;
  }

  const r = await geocodeViaNominatim(query);
  if (r.falha === "indisponivel") avisar("nominatim", r.motivo);
  return r;
}

/** Cache apenas de desfecho definitivo. `indisponivel` nunca entra: e o
 *  envenenamento que fazia um unico timeout condenar a cidade inteira. */
function doCache(chave: string): GeoResposta | null {
  if (!_geoCache.has(chave)) return null;
  const v = _geoCache.get(chave)!;
  return v ? { coords: v } : { falha: "nao_encontrado" };
}
function guardar(chave: string, r: GeoResposta): GeoResposta {
  if (r.coords) _geoCache.set(chave, r.coords);
  else if (r.falha === "nao_encontrado") _geoCache.set(chave, null);
  return r;
}

/**
 * Geocodificar por endereco completo, com a distincao de falha preservada.
 * Prioridade: CEP+cidade (mais confiavel) → endereco+cidade.
 * Google Maps pode resolver nomes de rua para cidades homonimas
 * (ex: "Rua Moacyr Arcoverde" → Arcoverde-PE). CEP nunca mente.
 */
export async function geocodeAddressDetalhado(
  address: string, city: string, state: string, cep?: string,
): Promise<GeoResposta> {
  // 1. Por CEP + cidade
  if (cep) {
    const cleanCep = cep.replace(/\D/g, "");
    if (cleanCep.length >= 8) {
      const cepKey = `cep:${cleanCep},${city.toLowerCase()}`;
      const emCache = doCache(cepKey);
      const r = emCache ?? guardar(cepKey, await geocodeQuery(`${cleanCep}, ${city}, ${state}, Brasil`));
      if (r.coords) return r;
      if (r.falha === "indisponivel") return r;
    }
  }

  // 2. Por endereco + cidade
  const q = `${address}, ${city}, ${state}, Brasil`;
  const key = `addr:${q.toLowerCase()}`;
  const emCache = doCache(key);
  if (emCache) return emCache;

  const r = await geocodeQuery(q);
  if (r.falha === "indisponivel") return r; // nao cacheia, nao valida

  if (r.coords) {
    // Validar que o resultado esta perto da cidade esperada (nao em outro estado)
    const cidade = await geocodeCityDetalhado(city, state);
    if (cidade.coords) {
      const dist = Math.abs(r.coords[0] - cidade.coords[0]) + Math.abs(r.coords[1] - cidade.coords[1]);
      if (dist > 1.0) {
        // ~100km+ da cidade — resolveu para o lugar errado. O caller cai para a cidade.
        return guardar(key, { falha: "nao_encontrado", motivo: "resultado longe da cidade" });
      }
    }
  }
  return guardar(key, r);
}

/** Geocodificar por cidade + estado, com a distincao de falha preservada. */
export async function geocodeCityDetalhado(city: string, state: string): Promise<GeoResposta> {
  const key = `city:${city.toLowerCase()},${state.toLowerCase()}`;
  const emCache = doCache(key);
  if (emCache) return emCache;
  return guardar(key, await geocodeQuery(`${city}, ${state}, Brasil`));
}

/** Geocodificar por endereco completo — coords ou null (compatibilidade). */
export async function geocodeAddress(address: string, city: string, state: string, cep?: string): Promise<[number, number] | null> {
  const r = await geocodeAddressDetalhado(address, city, state, cep);
  return r.coords ?? null;
}

/** Geocodificar por cidade + estado — fallback quando endereco nao resolve. */
export async function geocodeCity(city: string, state: string): Promise<[number, number] | null> {
  const r = await geocodeCityDetalhado(city, state);
  return r.coords ?? null;
}

/** Geocodificar por CEP via Nominatim → lat/lng do bairro/regiao do CEP.
 * Cache por CEP unico (~100 CEPs unicos pra 6000 clientes → ~100 chamadas). */
export async function geocodeByCep(cep: string, city?: string, state?: string): Promise<[number, number] | null> {
  if (!cep) return null;
  const cleaned = cep.replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
  if (cleaned.length < 8) return null;
  const key = `cep:${cleaned}`;
  const emCache = doCache(key);
  if (emCache) return emCache.coords ?? null;

  const q = city && state
    ? `${cleaned}, ${city}, ${state}, Brasil`
    : `${cleaned}, Brasil`;
  const r = await geocodeViaNominatim(q);
  if (r.falha === "indisponivel") {
    avisar("nominatim", r.motivo);
    return null; // sem cache: a proxima passada tenta de novo
  }
  guardar(key, r);
  return r.coords ?? null;
}

export interface LocalDoCep { city: string; state: string; street?: string; neighborhood?: string }
export type CepResposta =
  | { local: LocalDoCep; falha?: undefined; motivo?: undefined }
  | { local?: undefined; falha: GeoFalha; motivo?: string };

/** Poucos CEPs distintos cobrem uma carteira inteira — sem cache, cada cliente
 *  pagava uma consulta ao ViaCEP e a espera que vem com ela. */
const _cepCache = new Map<string, LocalDoCep | null>();

/**
 * Resolver CEP → cidade + estado via ViaCEP, com a mesma distincao das demais:
 * "CEP nao existe" e definitivo, "ViaCEP fora do ar" nao. Fundir os dois fazia
 * o backfill contar um cliente perfeitamente geocodificavel como cadastro sem
 * endereco — e ainda zerava o contador de falhas de rede, mascarando a queda.
 */
export async function geocodeCepDetalhado(cep: string): Promise<CepResposta> {
  if (!cep || cep.replace(/\D/g, "").length < 8) return { falha: "nao_encontrado", motivo: "CEP incompleto" };
  const cleaned = cep.replace(/\D/g, "").slice(0, 8);

  if (_cepCache.has(cleaned)) {
    const v = _cepCache.get(cleaned)!;
    return v ? { local: v } : { falha: "nao_encontrado" };
  }

  let r: Response;
  _chamadasDeRede++;
  try {
    r = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`, { signal: AbortSignal.timeout(5000) });
  } catch (err: any) {
    return { falha: "indisponivel", motivo: `rede: ${err?.name || err?.message || "erro"}` };
  }
  if (!r.ok) return { falha: "indisponivel", motivo: `http ${r.status}` };

  let data: any;
  try {
    data = await r.json();
  } catch {
    return { falha: "indisponivel", motivo: "resposta ilegivel" };
  }

  if (data?.localidade && data?.uf) {
    const local: LocalDoCep = {
      city: data.localidade,
      state: data.uf,
      street: data.logradouro || undefined,
      neighborhood: data.bairro || undefined,
    };
    _cepCache.set(cleaned, local);
    return { local };
  }
  // ViaCEP responde 200 com { erro: true } para CEP inexistente — definitivo.
  _cepCache.set(cleaned, null);
  return { falha: "nao_encontrado" };
}

/** Resolver CEP → cidade + estado via ViaCEP (compatibilidade: local ou null). */
export async function geocodeCep(cep: string): Promise<LocalDoCep | null> {
  const r = await geocodeCepDetalhado(cep);
  return r.local ?? null;
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
