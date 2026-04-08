import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { STALE_STATIC } from "@/lib/queryClient";
import { Loader } from "@googlemaps/js-api-loader";
import { RefreshCw } from "lucide-react";

export type HeatPoint = {
  lat: number;
  lng: number;
  weight: number;
};

interface GoogleHeatMapProps {
  points: HeatPoint[];
  mode: "provider" | "regional";
  defaultCenter?: { lat: number; lng: number } | null;
  height?: number;
  preview?: boolean;
}

const PROVIDER_GRADIENT = [
  "rgba(34,197,94,0)",
  "#86efac",
  "#fde047",
  "#fb923c",
  "#ef4444",
  "#991b1b",
];

const REGIONAL_GRADIENT = [
  "rgba(59,130,246,0)",
  "#93c5fd",
  "#a78bfa",
  "#e879f9",
  "#f43f5e",
  "#881337",
];

const BRAZIL_CENTER = { lat: -15.8, lng: -48.0 };

export default function GoogleHeatMap({
  points,
  mode,
  defaultCenter = null,
  height = 480,
  preview = false,
}: GoogleHeatMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const heatRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
  const [ready, setReady] = useState(false);

  const { data: keyData } = useQuery<{ key: string }>({
    queryKey: ["/api/config/maps-key"],
    staleTime: STALE_STATIC,
  });

  const apiKey = keyData?.key ?? "";

  // Load Google Maps JS API
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    const loader = new Loader({
      apiKey,
      libraries: ["visualization"],
    });

    Promise.all([
      loader.importLibrary("maps"),
      loader.importLibrary("visualization"),
    ]).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  // Build the heatmap layer
  const buildHeatLayer = useCallback(() => {
    if (!mapRef.current || points.length === 0) return;

    // Remove previous layer
    if (heatRef.current) {
      heatRef.current.setMap(null);
      heatRef.current = null;
    }

    const maxW = Math.max(...points.map((p) => p.weight), 1);
    const data = points.map(
      (p) =>
        ({
          location: new google.maps.LatLng(p.lat, p.lng),
          weight: p.weight / maxW,
        }) as google.maps.visualization.WeightedLocation,
    );

    const gradient = mode === "provider" ? PROVIDER_GRADIENT : REGIONAL_GRADIENT;

    heatRef.current = new google.maps.visualization.HeatmapLayer({
      data,
      map: mapRef.current,
      radius: 35,
      opacity: 0.65,
    });
    heatRef.current.set("gradient", gradient);

    // Fit bounds when multiple points and no explicit center
    if (points.length > 1 && !defaultCenter) {
      const bounds = new google.maps.LatLngBounds();
      points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
      mapRef.current.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 });
    }
  }, [points, mode, defaultCenter]);

  // Initialize map once ready
  const initMap = useCallback(() => {
    if (!ready || !containerRef.current) return;

    // Calculate center
    let center = BRAZIL_CENTER;
    if (defaultCenter) {
      center = defaultCenter;
    } else if (points.length > 0) {
      const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
      const avgLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
      center = { lat: avgLat, lng: avgLng };
    }

    // Calculate zoom
    const zoom = defaultCenter ? 13 : points.length > 0 ? 7 : 5;

    mapRef.current = new google.maps.Map(containerRef.current, {
      center,
      zoom,
      disableDefaultUI: preview,
      zoomControl: !preview,
      scrollwheel: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: preview ? "none" : "auto",
      keyboardShortcuts: !preview,
    });

    buildHeatLayer();
  }, [ready, points, defaultCenter, buildHeatLayer, preview]);

  // Init map when ready
  useEffect(() => {
    initMap();
  }, [initMap]);

  // React to points/mode changes
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    buildHeatLayer();
  }, [points, mode, ready, buildHeatLayer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (heatRef.current) {
        heatRef.current.setMap(null);
        heatRef.current = null;
      }
      mapRef.current = null;
    };
  }, []);

  const isLoading = !ready || !apiKey;

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full rounded-lg border z-0"
        data-testid="google-heatmap-container"
      />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/60 rounded-lg">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
