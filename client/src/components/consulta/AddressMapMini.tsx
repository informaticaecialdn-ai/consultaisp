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
}

export default function AddressMapMini({ cep, addressNumber, address, city, state, neighborhood }: AddressMapMiniProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [loading, setLoading] = useState(true);

  // Montar query de busca
  let searchQuery = "";
  if (address && city && state) {
    const parts = [address];
    if (addressNumber) parts[0] = `${address} ${addressNumber}`;
    if (neighborhood) parts.push(neighborhood);
    parts.push(city);
    parts.push(state);
    parts.push("Brasil");
    searchQuery = parts.join(", ");
  } else if (city && state) {
    searchQuery = `${city}, ${state}, Brasil`;
  } else if (cep) {
    const clean = cep.replace(/\D/g, "");
    if (clean.length === 8) {
      searchQuery = `CEP ${clean}, Brasil`;
    }
  }

  // Geocodificar via Nominatim
  useEffect(() => {
    if (!searchQuery) { setLoading(false); return; }
    setLoading(true);

    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1&countrycodes=br`, {
      headers: { "User-Agent": "ConsultaISP/1.0" },
    })
      .then(r => r.json())
      .then((data: any[]) => {
        if (data[0]) {
          setCoords([parseFloat(data[0].lon), parseFloat(data[0].lat)]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [searchQuery]);

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
