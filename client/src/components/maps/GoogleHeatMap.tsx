import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { STALE_STATIC } from "@/lib/queryClient";
import { MapPin } from "lucide-react";

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

const BRAZIL_CENTER = { lat: -15.8, lng: -48.0 };

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

// Load Google Maps via script tag (no external library needed)
let _loadPromise: Promise<void> | null = null;
function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existing) {
      // Script already in DOM, wait for it
      const check = setInterval(() => {
        if (window.google?.maps?.Map) { clearInterval(check); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(check); reject(new Error("Google Maps timeout")); }, 15000);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=visualization`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const check = setInterval(() => {
        if (window.google?.maps?.Map) { clearInterval(check); resolve(); }
      }, 50);
      setTimeout(() => { clearInterval(check); reject(new Error("Google Maps init timeout")); }, 10000);
    };
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });

  return _loadPromise;
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
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const { data: keyData } = useQuery<{ key: string }>({
    queryKey: ["/api/config/maps-key"],
    staleTime: STALE_STATIC,
  });
  const apiKey = keyData?.key ?? "";

  // Step 1: Load Google Maps + create map
  useEffect(() => {
    if (!apiKey || !containerRef.current) return;

    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return;

        const center = defaultCenter || BRAZIL_CENTER;

        mapRef.current = new google.maps.Map(containerRef.current, {
          center,
          zoom: defaultCenter ? 12 : 4,
          disableDefaultUI: preview,
          zoomControl: !preview,
          scrollwheel: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: !preview,
          gestureHandling: preview ? "none" : "cooperative",
        });

        setStatus("ready");
      })
      .catch((err) => {
        console.error("[GoogleHeatMap] Erro ao carregar Google Maps:", err);
        if (!cancelled) setStatus("error");
      });

    return () => { cancelled = true; };
  }, [apiKey]);

  // Step 2: Update center
  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !defaultCenter) return;
    mapRef.current.setCenter(defaultCenter);
    mapRef.current.setZoom(12);
  }, [status, defaultCenter?.lat, defaultCenter?.lng]);

  // Step 3: Update heatmap layer
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;

    // Clear previous
    if (heatRef.current) {
      heatRef.current.setMap(null);
      heatRef.current = null;
    }

    if (points.length === 0) return;

    const maxW = Math.max(...points.map(p => p.weight), 1);
    const data = points.map(p => ({
      location: new google.maps.LatLng(p.lat, p.lng),
      weight: p.weight / maxW,
    }));

    const gradient = mode === "provider" ? PROVIDER_GRADIENT : REGIONAL_GRADIENT;

    heatRef.current = new google.maps.visualization.HeatmapLayer({
      data,
      map: mapRef.current,
      radius: 35,
      opacity: 0.65,
    });
    heatRef.current.set("gradient", gradient);

    // Fit bounds
    if (points.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      points.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
      mapRef.current.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 });
    } else if (points.length === 1 && !defaultCenter) {
      mapRef.current.setCenter({ lat: points[0].lat, lng: points[0].lng });
      mapRef.current.setZoom(13);
    }
  }, [status, points, mode]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (heatRef.current) { heatRef.current.setMap(null); heatRef.current = null; }
      mapRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{ height, minHeight: 200 }}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
        data-testid="google-heatmap-container"
      />
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-bg)] rounded-lg gap-2">
          <div className="w-6 h-6 border-2 border-[var(--color-navy)] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-[var(--color-muted)]">Carregando Google Maps...</span>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-bg)] rounded-lg gap-2">
          <MapPin className="w-6 h-6 text-[var(--color-danger)]" />
          <span className="text-sm text-[var(--color-danger)]">Erro ao carregar Google Maps</span>
          <span className="text-xs text-[var(--color-muted)]">Verifique a chave da API</span>
        </div>
      )}
    </div>
  );
}
