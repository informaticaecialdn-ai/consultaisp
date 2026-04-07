import { useRef, useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapPin } from "lucide-react";

interface AddressMapMiniProps {
  cep: string;
  addressNumber?: string;
}

const geocodeCache = new Map<string, { lat: number; lon: number } | null>();

export default function AddressMapMini({ cep, addressNumber }: AddressMapMiniProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [geocodeFailed, setGeocodeFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !cep) return;

    const cleanCep = cep.replace(/\D/g, "");
    if (cleanCep.length !== 8) {
      setGeocodeFailed(true);
      return;
    }

    let cancelled = false;

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      dragging: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomControl: false,
      attributionControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([-15.8, -48.0], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
    mapRef.current = map;

    (async () => {
      try {
        const cacheKey = cleanCep;
        if (geocodeCache.has(cacheKey)) {
          const cached = geocodeCache.get(cacheKey);
          if (cancelled) return;
          if (cached) {
            map.setView([cached.lat, cached.lon], 15);
            const icon = L.divIcon({
              className: "",
              html: `<div style="width:12px;height:12px;background:#ef4444;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
              iconSize: [12, 12],
              iconAnchor: [6, 6],
            });
            const marker = L.marker([cached.lat, cached.lon], { icon }).addTo(map);
            if (addressNumber) marker.bindPopup(`CEP ${cleanCep}, nº ${addressNumber}`);
          } else {
            setGeocodeFailed(true);
          }
          return;
        }

        const viaCepRes = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        const viaCepData = await viaCepRes.json();
        if (cancelled || viaCepData.erro) { geocodeCache.set(cacheKey, null); if (!cancelled) setGeocodeFailed(true); return; }

        const { localidade, uf } = viaCepData;
        if (!localidade) { geocodeCache.set(cacheKey, null); if (!cancelled) setGeocodeFailed(true); return; }

        const q = encodeURIComponent(`${localidade}, ${uf}, Brasil`);
        const nomRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`, {
          headers: { "Accept-Language": "pt-BR" },
        });
        const nomData = await nomRes.json();
        if (cancelled) return;

        if (nomData?.[0]?.lat && nomData?.[0]?.lon) {
          const lat = parseFloat(nomData[0].lat);
          const lon = parseFloat(nomData[0].lon);
          geocodeCache.set(cacheKey, { lat, lon });
          map.setView([lat, lon], 15);

          const icon = L.divIcon({
            className: "",
            html: `<div style="width:12px;height:12px;background:#ef4444;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          });
          const marker = L.marker([lat, lon], { icon }).addTo(map);
          if (addressNumber) marker.bindPopup(`CEP ${cleanCep}, nº ${addressNumber}`);
        } else {
          geocodeCache.set(cacheKey, null);
          setGeocodeFailed(true);
        }
      } catch {
        if (!cancelled) setGeocodeFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        try {
          const m = mapRef.current as any;
          const pane = m._mapPane as HTMLElement | undefined;
          if (pane) { pane.style.transition = "none"; void pane.offsetWidth; }
          m._onZoomTransitionEnd = () => {};
          m._onZoomAnim = () => {};
          m.off();
          m.stop();
          m.remove();
        } catch {}
        mapRef.current = null;
      }
    };
  }, [cep]);

  if (geocodeFailed) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-2" style={{ height: "220px" }}>
        <MapPin className="w-8 h-8 text-slate-300" />
        <span className="text-sm text-slate-400 font-medium">Localização indisponível</span>
        {cep && <span className="text-xs text-slate-300 max-w-[200px] text-center truncate">CEP {cep}{addressNumber ? `, nº ${addressNumber}` : ""}</span>}
      </div>
    );
  }

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-200">
      <div ref={containerRef} style={{ height: "220px" }} className="w-full" />
    </div>
  );
}
