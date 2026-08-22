import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type PontoMapa = {
  id: number; lat: number; lon: number;
  estado: 'em_dia' | 'em_cobranca' | 'suspenso' | 'ex_divida';
  emAberto: number; atraso: number;
  bairro: string | null; cidade: string;
};

/** Le o token da pele em runtime — o mapa acompanha a troca de tema. */
function corDoEstado(estado: PontoMapa['estado']): string {
  const mapa: Record<PontoMapa['estado'], string> = {
    em_dia: '--ok', em_cobranca: '--gated', suspenso: '--brand', ex_divida: '--danger',
  };
  const v = getComputedStyle(document.documentElement).getPropertyValue(mapa[estado]).trim();
  return v || '#6B6878';
}

const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MapaCarteira({
  pontos, height = 520,
}: { pontos: PontoMapa[]; height?: number }) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!div.current || mapa.current) return;
    mapa.current = L.map(div.current, { zoomControl: true }).setView([-23.31, -50.16], 9);
    L.tileLayer("/api/tiles/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
    }).addTo(mapa.current);
    camada.current = L.layerGroup().addTo(mapa.current);
    return () => { mapa.current?.remove(); mapa.current = null; };
  }, []);

  useEffect(() => {
    if (!mapa.current || !camada.current) return;
    camada.current.clearLayers();
    // Sem ponto, mantem o enquadramento atual: geocodificar so para posicionar
    // um mapa vazio custaria uma volta de rede sem entregar nada.
    if (pontos.length === 0) return;

    for (const p of pontos) {
      L.circleMarker([p.lat, p.lon], {
        radius: 5, weight: 1, color: "#fff",
        fillColor: corDoEstado(p.estado), fillOpacity: 0.9,
      })
        .bindPopup(
          `<b>${p.bairro || "Sem bairro"}</b><br>${p.cidade}<br>` +
          (p.emAberto > 0
            ? `${brl(p.emAberto)} em aberto · ${p.atraso}d`
            : "sem dívida em aberto"),
        )
        .addTo(camada.current!);
    }

    // Enquadra pelos proprios pontos: cidades-brasil.json nao tem coordenada.
    const bounds = L.latLngBounds(pontos.map(p => [p.lat, p.lon] as [number, number]));
    mapa.current.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
  }, [pontos]);

  return (
    <div
      ref={div}
      style={{ height }}
      className="w-full rounded-lg overflow-hidden"
      data-testid="mapa-carteira"
    />
  );
}
