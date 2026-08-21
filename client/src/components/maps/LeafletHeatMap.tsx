import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";

export type HeatPoint = {
  lat: number;
  lng: number;
  weight: number;
};

interface LeafletHeatMapProps {
  points: HeatPoint[];
  mode: "provider" | "regional";
  defaultCenter?: { lat: number; lng: number } | null;
  height?: number;
  preview?: boolean;
}

const BRAZIL_CENTER: [number, number] = [-15.8, -48.0];

export default function LeafletHeatMap({
  points,
  mode,
  defaultCenter = null,
  height = 480,
  preview = false,
}: LeafletHeatMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const heatRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const center: [number, number] = defaultCenter
      ? [defaultCenter.lat, defaultCenter.lng]
      : BRAZIL_CENTER;

    const map = L.map(containerRef.current, {
      center,
      zoom: defaultCenter ? 12 : 4,
      zoomControl: true,
      scrollWheelZoom: true,
      dragging: true,
      attributionControl: true,
    });

    // Proxy tiles pelo proprio servidor pra evitar bloqueio de Referer
    L.tileLayer("/api/tiles/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      heatRef.current = null;
    };
  }, []);

  // Update center
  useEffect(() => {
    if (!mapRef.current || !defaultCenter) return;
    mapRef.current.setView([defaultCenter.lat, defaultCenter.lng], 12);
  }, [defaultCenter?.lat, defaultCenter?.lng]);

  // Update heatmap
  useEffect(() => {
    if (!mapRef.current) return;

    if (heatRef.current) {
      mapRef.current.removeLayer(heatRef.current);
      heatRef.current = null;
    }

    if (points.length === 0) return;

    const maxW = Math.max(...points.map((p) => p.weight), 1);
    const heatData: [number, number, number][] = points.map((p) => [
      p.lat,
      p.lng,
      p.weight / maxW,
    ]);

    const gradient = mode === "provider"
      ? { 0.2: "#A3B370", 0.4: "#D4A72C", 0.6: "#E07040", 0.8: "#B53333", 1.0: "#7A2020" }
      : { 0.2: "#B0AEA5", 0.4: "#8A94C0", 0.6: "#7A4A63", 0.8: "#8B3A4A", 1.0: "#4A1F28" };

    heatRef.current = (L as any).heatLayer(heatData, {
      radius: 30,
      blur: 20,
      maxZoom: 17,
      max: 1.0,
      gradient,
    }).addTo(mapRef.current);

    // Fit bounds
    if (points.length > 1) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      mapRef.current.fitBounds(bounds, { padding: [30, 30] });
    } else if (points.length === 1 && !defaultCenter) {
      mapRef.current.setView([points[0].lat, points[0].lng], 13);
    }
  }, [points, mode]);

  return (
    <div
      ref={containerRef}
      style={{ height, minHeight: 200 }}
      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] z-0"
      data-testid="leaflet-heatmap-container"
    />
  );
}
