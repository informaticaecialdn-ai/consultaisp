import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { STALE_STATIC } from "@/lib/queryClient";
import { MapPin } from "lucide-react";

export type HeatPoint = {
  lat: number;
  lng: number;
  weight: number;
};

interface BingHeatMapProps {
  points: HeatPoint[];
  mode: "provider" | "regional";
  defaultCenter?: { lat: number; lng: number } | null;
  height?: number;
  preview?: boolean;
}

const BRAZIL_CENTER = { lat: -15.8, lng: -48.0 };

// Load Bing Maps SDK once
let _loadPromise: Promise<void> | null = null;
function loadBingMaps(apiKey: string): Promise<void> {
  if ((window as any).Microsoft?.Maps?.Map) return Promise.resolve();
  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise((resolve, reject) => {
    const callbackName = "__bingMapsCallback";
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve();
    };

    const script = document.createElement("script");
    script.src = `https://www.bing.com/api/maps/mapcontrol?callback=${callbackName}&key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Bing Maps"));
    document.head.appendChild(script);

    setTimeout(() => reject(new Error("Bing Maps timeout")), 15000);
  });

  return _loadPromise;
}

export default function BingHeatMap({
  points,
  mode,
  defaultCenter = null,
  height = 480,
  preview = false,
}: BingHeatMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const heatLayerRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const { data: keyData } = useQuery<{ key: string }>({
    queryKey: ["/api/config/bing-maps-key"],
    staleTime: STALE_STATIC,
  });
  const apiKey = keyData?.key ?? "";

  // Load Bing Maps + create map
  useEffect(() => {
    if (!apiKey || !containerRef.current) return;
    let cancelled = false;

    loadBingMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const Microsoft = (window as any).Microsoft;
        const center = defaultCenter || BRAZIL_CENTER;

        const map = new Microsoft.Maps.Map(containerRef.current, {
          center: new Microsoft.Maps.Location(center.lat, center.lng),
          zoom: defaultCenter ? 12 : 4,
          mapTypeId: Microsoft.Maps.MapTypeId.road,
          disableScrollWheelZoom: preview,
          disablePanning: preview,
          showMapTypeSelector: false,
          showLocateMeButton: false,
          showTermsLink: false,
        });

        mapRef.current = map;
        setStatus("ready");
      })
      .catch((err) => {
        console.error("[BingHeatMap] Erro:", err);
        if (!cancelled) setStatus("error");
      });

    return () => { cancelled = true; };
  }, [apiKey]);

  // Update center
  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !defaultCenter) return;
    const Microsoft = (window as any).Microsoft;
    mapRef.current.setView({
      center: new Microsoft.Maps.Location(defaultCenter.lat, defaultCenter.lng),
      zoom: 12,
    });
  }, [status, defaultCenter?.lat, defaultCenter?.lng]);

  // Update heatmap layer
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    const Microsoft = (window as any).Microsoft;

    // Remove old layer
    if (heatLayerRef.current) {
      mapRef.current.layers.remove(heatLayerRef.current);
      heatLayerRef.current = null;
    }

    if (points.length === 0) return;

    // Load heatmap module
    Microsoft.Maps.loadModule("Microsoft.Maps.HeatMap", () => {
      const locations = points.map(
        (p) => new Microsoft.Maps.Location(p.lat, p.lng)
      );

      const colorGradient = mode === "provider"
        ? { "0.2": "green", "0.4": "yellow", "0.6": "orange", "0.8": "red", "1.0": "darkred" }
        : { "0.2": "blue", "0.4": "purple", "0.6": "magenta", "0.8": "red", "1.0": "darkred" };

      heatLayerRef.current = new Microsoft.Maps.HeatMapLayer(locations, {
        radius: 30,
        intensity: 0.6,
        unit: "pixels",
        colorGradient: colorGradient,
      });

      mapRef.current.layers.insert(heatLayerRef.current);

      // Fit bounds
      if (points.length > 1) {
        const locs = points.map((p) => new Microsoft.Maps.Location(p.lat, p.lng));
        const bounds = Microsoft.Maps.LocationRect.fromLocations(locs);
        mapRef.current.setView({ bounds, padding: 40 });
      } else if (points.length === 1 && !defaultCenter) {
        mapRef.current.setView({
          center: new Microsoft.Maps.Location(points[0].lat, points[0].lng),
          zoom: 13,
        });
      }
    });
  }, [status, points, mode]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.dispose();
        mapRef.current = null;
        heatLayerRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{ height, minHeight: 200 }}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
        data-testid="bing-heatmap-container"
      />
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-bg)] rounded-lg gap-2">
          <div className="w-6 h-6 border-2 border-[var(--color-navy)] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-[var(--color-muted)]">Carregando Bing Maps...</span>
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
