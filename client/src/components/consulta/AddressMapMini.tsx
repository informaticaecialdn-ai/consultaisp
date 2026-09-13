import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAuth } from "@/lib/auth";

/**
 * Centro das quatro cidades da demonstração pública — os mesmos de
 * `server/demo/pessoas-ficticias.ts`, onde mora toda a carteira fictícia (o
 * teste trava as duas tabelas juntas).
 *
 * Na demonstração o Nominatim, um terceiro, não pode receber o endereço do
 * consultado. Sem coordenada do ERP, o marcador vai para o centro da cidade:
 * menos preciso, e honesto sobre isso — nunca um ponto de rua inventado.
 */
const CIDADES_DA_DEMONSTRACAO: ReadonlyArray<{ nome: string; cepPrefixo: string; latitude: number; longitude: number }> = [
  { nome: "Londrina", cepPrefixo: "86025", latitude: -23.31, longitude: -51.1628 },
  { nome: "Ibiporã", cepPrefixo: "86200", latitude: -23.2694, longitude: -51.0436 },
  { nome: "Cambé", cepPrefixo: "86180", latitude: -23.2758, longitude: -51.2778 },
  { nome: "Apucarana", cepPrefixo: "86800", latitude: -23.5508, longitude: -51.4608 },
];

const semAcento = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** [lng, lat] da cidade da demo pelo nome, ou pelo prefixo do CEP; null fora das quatro. */
function coordenadaDaDemonstracao(city?: string, cep?: string): [number, number] | null {
  const digitos = (cep ?? "").replace(/\D/g, "");
  const cidade = (city ? CIDADES_DA_DEMONSTRACAO.find(c => semAcento(c.nome) === semAcento(city)) : undefined)
    ?? CIDADES_DA_DEMONSTRACAO.find(c => digitos.startsWith(c.cepPrefixo));
  return cidade ? [cidade.longitude, cidade.latitude] : null;
}

interface AddressMapMiniProps {
  cep?: string;
  addressNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  latitude?: string;
  longitude?: string;
}

export default function AddressMapMini({ cep, addressNumber, address, city, state, neighborhood, latitude, longitude }: AddressMapMiniProps) {
  const { demoMode } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [loading, setLoading] = useState(true);

  // Se o ERP retornou lat/lng direto, usar imediatamente (sem geocoding)
  const erpLat = latitude ? parseFloat(latitude) : NaN;
  const erpLng = longitude ? parseFloat(longitude) : NaN;
  const hasErpCoords = !isNaN(erpLat) && !isNaN(erpLng) && erpLat !== 0 && erpLng !== 0;

  // Montar query de busca — tentar do mais especifico pro mais generico
  let searchQuery = "";
  if (address && addressNumber && city && state) {
    searchQuery = `${address} ${addressNumber}, ${neighborhood ? neighborhood + ", " : ""}${city}, ${state}, Brasil`;
  } else if (address && city && state) {
    searchQuery = `${address}, ${city}, ${state}, Brasil`;
  } else if (cep) {
    const clean = cep.replace(/\D/g, "");
    if (clean.length >= 5) {
      // Buscar pelo CEP formatado — Nominatim entende CEP brasileiro
      searchQuery = `${clean}, Brasil`;
    }
  } else if (city && state) {
    searchQuery = `${city}, ${state}, Brasil`;
  }

  // Geocodificar via Nominatim (tenta endereco completo, fallback CEP)
  useEffect(() => {
    // Se o ERP ja deu lat/lng, usar direto
    if (hasErpCoords) {
      setCoords([erpLng, erpLat]);
      setLoading(false);
      return;
    }
    if (!searchQuery) { setLoading(false); return; }
    // Na demonstração, nunca o Nominatim: a coordenada fixa da cidade da demo.
    if (demoMode) {
      setCoords(coordenadaDaDemonstracao(city, cep));
      setLoading(false);
      return;
    }
    setLoading(true);

    const tryGeocode = async () => {
      // Tentar query principal
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1&countrycodes=br`, {
          headers: { "User-Agent": "ConsultaISP/1.0" },
        });
        const data: any[] = await r.json();
        if (data[0]) {
          setCoords([parseFloat(data[0].lon), parseFloat(data[0].lat)]);
          setLoading(false);
          return;
        }
      } catch {}

      // Fallback: tentar so pelo CEP se query principal falhou
      if (cep) {
        try {
          const clean = cep.replace(/\D/g, "");
          const r2 = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean + ", Brasil")}&format=json&limit=1&countrycodes=br`, {
            headers: { "User-Agent": "ConsultaISP/1.0" },
          });
          const data2: any[] = await r2.json();
          if (data2[0]) {
            setCoords([parseFloat(data2[0].lon), parseFloat(data2[0].lat)]);
            setLoading(false);
            return;
          }
        } catch {}
      }

      // Fallback: tentar cidade + estado
      if (city && state) {
        try {
          const r3 = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${city}, ${state}, Brasil`)}&format=json&limit=1&countrycodes=br`, {
            headers: { "User-Agent": "ConsultaISP/1.0" },
          });
          const data3: any[] = await r3.json();
          if (data3[0]) {
            setCoords([parseFloat(data3[0].lon), parseFloat(data3[0].lat)]);
          }
        } catch {}
      }

      setLoading(false);
    };

    tryGeocode();
  }, [searchQuery, hasErpCoords, erpLat, erpLng, demoMode]);

  // Criar mapa quando coords resolvem
  useEffect(() => {
    if (!containerRef.current || !coords) return;
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: { osm: { type: "raster", tiles: ["/api/tiles/{z}/{x}/{y}.png"], tileSize: 256, attribution: "&copy; OpenStreetMap" } },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: coords,
      zoom: 15,
      interactive: false,
    });

    // O maplibre exige uma cor real, nao var(). Lemos o token computado para o
    // marcador acompanhar o tema em vez de carregar um hex do palette antigo.
    const corMarcador = getComputedStyle(document.documentElement)
      .getPropertyValue("--danger").trim() || "#B3261E";
    new maplibregl.Marker({ color: corMarcador })
      .setLngLat(coords)
      .addTo(map);

    mapRef.current = map;

    // O container e medido no momento da criacao. Dentro do relatorio ele ainda
    // esta assentando (fonte carregando, secao acima crescendo), entao o mapa
    // nascia com altura quase zero e pintava so uma tira de tiles no topo.
    // O observer devolve o tamanho real assim que ele existe.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    map.once("load", () => map.resize());

    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, [coords]);

  if (!searchQuery) {
    return (
      <div style={{ height: 230, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <MapPin size={26} style={{ color: "var(--text-faint)" }} />
        <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>Localização indisponível</span>
        {cep && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-faint)" }}>CEP {cep}</span>}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ height: 230, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 14, height: 14, borderRadius: 999, boxSizing: "border-box", border: "2px solid var(--action)", borderTopColor: "transparent", animation: "ci-spin .7s linear infinite" }} />
      </div>
    );
  }

  if (!coords) {
    return (
      <div style={{ height: 230, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <MapPin size={26} style={{ color: "var(--text-faint)" }} />
        <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>Endereço não encontrado</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-faint)" }}>{city && state ? `${city}, ${state}` : cep || ""}</span>
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden"
      style={{ borderRadius: 10, border: "1px solid var(--border)" }}
    >
      <div ref={containerRef} style={{ height: 230 }} />
    </div>
  );
}
