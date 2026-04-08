import { useState, useEffect, useRef } from "react";
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

// Singleton loader to avoid re-loading Google Maps JS
let _loaderPromise: Promise<void> | null = null;
function ensureGoogleMaps(apiKey: string): Promise<void> {
  if (_loaderPromise) return _loaderPromise;
  const loader = new Loader({ apiKey, libraries: ["visualization"] });
  _loaderPromise = Promise.all([
    loader.importLibrary("maps"),
    loader.importLibrary("visualization"),
  ]).then(() => {});
  return _loaderPromise;
}

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
  const [mapReady, setMapReady] = useState(false);

  const { data: keyData } = useQuery<{ key: string }>({
    queryKey: ["/api/config/maps-key"],
    staleTime: STALE_STATIC,
  });
  const apiKey = keyData?.key ?? "";

  // Step 1: Load Google Maps API + create map (independent of points)
  useEffect(() => {
    if (!apiKey || !containerRef.current) return;
    let cancelled = false;

    ensureGoogleMaps(apiKey).then(() => {
      if (cancelled || !containerRef.current) return;

      // Determine initial center
      let center = BRAZIL_CENTER;
      if (defaultCenter) {
        center = defaultCenter;
      }

      mapRef.current = new google.maps.Map(containerRef.current, {
        center,
        zoom: defaultCenter ? 13 : 5,
        disableDefaultUI: preview,
        zoomControl: !preview,
        scrollwheel: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: preview ? "none" : "auto",
        keyboardShortcuts: !preview,
      });

      setMapReady(true);
    });

    return () => { cancelled = true; };
  }, [apiKey]); // only re-run if API key changes

  // Step 2: Update center when defaultCenter changes
  useEffect(() => {
    if (!mapReady || !mapRef.current || !defaultCenter) return;
    mapRef.current.setCenter(defaultCenter);
    mapRef.current.setZoom(13);
  }, [mapReady, defaultCenter?.lat, defaultCenter?.lng]);

  // Step 3: Update heatmap layer when points change (independent of map creation)
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    // Clear previous layer
    if (heatRef.current) {
      heatRef.current.setMap(null);
      heatRef.current = null;
    }

    if (points.length === 0) return;

    const maxW = Math.max(...points.map(p => p.weight), 1);
    const data = points.map(p => ({
      location: new google.maps.LatLng(p.lat, p.lng),
      weight: p.weight / maxW,
    } as google.maps.visualization.WeightedLocation));

    const gradient = mode === "provider" ? PROVIDER_GRADIENT : REGIONAL_GRADIENT;

    heatRef.current = new google.maps.visualization.HeatmapLayer({
      data,
      map: mapRef.current,
      radius: 35,
      opacity: 0.65,
    });
    heatRef.current.set("gradient", gradient);

    // Fit bounds to points
    if (points.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      points.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
      mapRef.current.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 });
    } else if (points.length === 1) {
      mapRef.current.setCenter({ lat: points[0].lat, lng: points[0].lng });
      mapRef.current.setZoom(13);
    }
  }, [mapReady, points, mode]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (heatRef.current) {
        heatRef.current.setMap(null);
        heatRef.current = null;
      }
      mapRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full rounded-lg border z-0"
        data-testid="google-heatmap-container"
      />
      {!mapReady && apiKey && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg)]/60 rounded-lg">
          <RefreshCw className="h-6 w-6 animate-spin text-[var(--color-muted)]" />
        </div>
      )}
    </div>
  );
}
