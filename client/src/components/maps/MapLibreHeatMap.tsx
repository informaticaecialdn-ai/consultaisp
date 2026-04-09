import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin } from "lucide-react";

export type HeatPoint = {
  lat: number;
  lng: number;
  weight: number;
};

interface MapLibreHeatMapProps {
  points: HeatPoint[];
  mode: "provider" | "regional";
  defaultCenter?: { lat: number; lng: number } | null;
  height?: number;
  preview?: boolean;
}

const BRAZIL_CENTER: [number, number] = [-48.0, -15.8]; // [lng, lat]

export default function MapLibreHeatMap({
  points,
  mode,
  defaultCenter = null,
  height = 480,
  preview = false,
}: MapLibreHeatMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Create map
  useEffect(() => {
    if (!containerRef.current) return;

    const center: [number, number] = defaultCenter
      ? [defaultCenter.lng, defaultCenter.lat]
      : BRAZIL_CENTER;

    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["/api/tiles/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            },
          },
          layers: [
            {
              id: "osm-tiles",
              type: "raster",
              source: "osm",
              minzoom: 0,
              maxzoom: 19,
            },
          ],
        },
        center,
        zoom: defaultCenter ? 11 : 3,
        interactive: !preview,
      });

      if (!preview) {
        map.addControl(new maplibregl.NavigationControl(), "top-left");
      }

      map.on("load", () => {
        mapRef.current = map;
        setStatus("ready");
      });

      map.on("error", (e) => {
        console.error("[MapLibre] Error:", e);
      });

      return () => {
        map.remove();
        mapRef.current = null;
      };
    } catch (err) {
      console.error("[MapLibre] Init error:", err);
      setStatus("error");
    }
  }, []);

  // Update center
  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !defaultCenter) return;
    mapRef.current.flyTo({
      center: [defaultCenter.lng, defaultCenter.lat],
      zoom: 11,
      duration: 1000,
    });
  }, [status, defaultCenter?.lat, defaultCenter?.lng]);

  // Update heatmap
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    const map = mapRef.current;

    // Remove existing
    if (map.getLayer("heatmap-layer")) map.removeLayer("heatmap-layer");
    if (map.getSource("heatmap-source")) map.removeSource("heatmap-source");

    if (points.length === 0) return;

    const maxW = Math.max(...points.map((p) => p.weight), 1);

    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: points.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: { weight: p.weight / maxW },
      })),
    };

    map.addSource("heatmap-source", { type: "geojson", data: geojson });

    const colors = mode === "provider"
      ? [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(34,197,94,0)",
          0.2, "#86efac",
          0.4, "#fde047",
          0.6, "#fb923c",
          0.8, "#ef4444",
          1.0, "#991b1b",
        ]
      : [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(59,130,246,0)",
          0.2, "#93c5fd",
          0.4, "#a78bfa",
          0.6, "#e879f9",
          0.8, "#f43f5e",
          1.0, "#881337",
        ];

    map.addLayer({
      id: "heatmap-layer",
      type: "heatmap",
      source: "heatmap-source",
      paint: {
        "heatmap-weight": ["get", "weight"],
        "heatmap-intensity": 1,
        "heatmap-radius": 30,
        "heatmap-opacity": 0.7,
        "heatmap-color": colors as any,
      },
    });

    // Fit bounds
    if (points.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      points.forEach((p) => bounds.extend([p.lng, p.lat]));
      map.fitBounds(bounds, { padding: 40, maxZoom: 14 });
    } else if (points.length === 1 && !defaultCenter) {
      map.flyTo({ center: [points[0].lng, points[0].lat], zoom: 13 });
    }
  }, [status, points, mode]);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{ height, minHeight: 200 }}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
        data-testid="maplibre-heatmap-container"
      />
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-bg)] rounded-lg gap-2">
          <div className="w-6 h-6 border-2 border-[var(--color-navy)] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-[var(--color-muted)]">Carregando mapa...</span>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-bg)] rounded-lg gap-2">
          <MapPin className="w-6 h-6 text-[var(--color-danger)]" />
          <span className="text-sm text-[var(--color-danger)]">Erro ao carregar mapa</span>
        </div>
      )}
    </div>
  );
}
