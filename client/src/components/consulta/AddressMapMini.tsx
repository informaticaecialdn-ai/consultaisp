import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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
  }, [searchQuery, hasErpCoords, erpLat, erpLng]);

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

    new maplibregl.Marker({ color: "#ef4444" })
      .setLngLat(coords)
      .addTo(map);

    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, [coords]);

  if (!searchQuery) {
    return (
      <div className="relative rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col items-center justify-center gap-2" style={{ height: "220px" }}>
        <MapPin className="w-8 h-8 text-[var(--color-muted)]" />
        <span className="text-sm text-[var(--color-muted)] font-medium">Localizacao indisponivel</span>
        {cep && <span className="text-xs text-[var(--color-muted)]">CEP {cep}</span>}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="relative rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-center" style={{ height: "220px" }}>
        <div className="w-5 h-5 border-2 border-[var(--color-navy)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!coords) {
    return (
      <div className="relative rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col items-center justify-center gap-2" style={{ height: "220px" }}>
        <MapPin className="w-8 h-8 text-[var(--color-muted)]" />
        <span className="text-sm text-[var(--color-muted)] font-medium">Endereco nao encontrado</span>
        <span className="text-xs text-[var(--color-muted)]">{city && state ? `${city}, ${state}` : cep || ""}</span>
      </div>
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden border border-[var(--color-border)]">
      <div ref={containerRef} style={{ height: 220 }} />
      <div className="absolute bottom-2 left-2 bg-white/90 dark:bg-black/70 rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-300">
        {city && state ? `${city}, ${state}` : cep || ""}
      </div>
    </div>
  );
}
