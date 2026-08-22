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

export type PontoRede = { lat: number; lng: number; count: number };

export type CidadeMapa = {
  cidade: string; clientes: number; inadimplentes: number;
  dividaTotal: number; lat: number | null; lon: number | null;
};

export type ModoMapa = 'carteira' | 'regionalizacao';

/** Escala de inadimplencia da cidade — mesma leitura semantica dos pontos. */
function corDaTaxa(pct: number): string {
  const token = pct >= 40 ? '--danger' : pct >= 20 ? '--gated' : '--ok';
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || '#6B6878';
}

export default function MapaCarteira({
  pontos, cidades = [], modo = 'carteira', rede, height = 520,
}: {
  pontos: PontoMapa[];
  cidades?: CidadeMapa[];
  modo?: ModoMapa;
  rede?: PontoRede[];
  height?: number;
}) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  const camadaRede = useRef<L.LayerGroup | null>(null);

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

    const plotaveis = modo === 'regionalizacao'
      ? cidades.filter(c => c.lat !== null && c.lon !== null)
      : pontos;
    // Sem ponto, mantem o enquadramento atual: geocodificar so para posicionar
    // um mapa vazio custaria uma volta de rede sem entregar nada.
    if (plotaveis.length === 0) return;

    if (modo === 'regionalizacao') {
      // Uma bolha por cidade, area proporcional a carteira. Area e nao raio:
      // o olho compara area, e escalar o raio exagera a cidade grande.
      const maior = Math.max(...cidades.map(c => c.clientes));
      for (const c of cidades) {
        if (c.lat === null || c.lon === null) continue;
        const taxa = c.clientes > 0 ? (c.inadimplentes / c.clientes) * 100 : 0;
        L.circleMarker([c.lat, c.lon], {
          radius: 7 + Math.sqrt(c.clientes / maior) * 17,
          weight: 1.5, color: "#fff",
          fillColor: corDaTaxa(taxa), fillOpacity: 0.75,
        })
          .bindPopup(
            `<b>${c.cidade}</b><br>${c.clientes} clientes · ${c.inadimplentes} inad. ` +
            `(${taxa.toFixed(1)}%)<br>${brl(c.dividaTotal)} em aberto`,
          )
          .bindTooltip(c.cidade, { direction: 'top', offset: [0, -6] })
          .addTo(camada.current!);
      }
    } else {
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
    }

    // Enquadra pelo que esta plotado: cidades-brasil.json nao tem coordenada.
    const bounds = L.latLngBounds(
      plotaveis.map(p => [p.lat as number, ('lon' in p ? p.lon : 0) as number] as [number, number]),
    );
    mapa.current.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
  }, [pontos, cidades, modo]);

  // Camada separada: liga e desliga sem redesenhar os pontos da carteira.
  useEffect(() => {
    if (!mapa.current) return;
    camadaRede.current?.remove();
    camadaRede.current = null;
    if (!rede?.length) return;

    camadaRede.current = L.layerGroup(
      rede.map(r => L.circle([r.lat, r.lng], {
        // Raio proporcional a concentracao, com teto para nao cobrir a cidade.
        radius: Math.min(4000, 400 + r.count * 40),
        weight: 0,
        fillColor: corDoEstado('suspenso'),
        fillOpacity: 0.14,
      })),
    ).addTo(mapa.current);
  }, [rede]);

  return (
    <div
      ref={div}
      style={{ height }}
      className="w-full rounded-lg overflow-hidden"
      data-testid="mapa-carteira"
    />
  );
}
