import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { STALE_STATIC } from "@/lib/queryClient";
import { MapPin } from "lucide-react";

export type HeatPoint = {
  lat: number;
  lng: number;
  weight: number;
};

interface AzureHeatMapProps {
  points: HeatPoint[];
  mode: "provider" | "regional";
  defaultCenter?: { lat: number; lng: number } | null;
  height?: number;
  preview?: boolean;
}

const BRAZIL_CENTER = { lat: -15.8, lng: -48.0 };

// Load Azure Maps SDK once
let _loadPromise: Promise<void> | null = null;
function loadAzureMaps(): Promise<void> {
  if ((window as any).atlas?.Map) return Promise.resolve();
  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise((resolve, reject) => {
    // CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.css";
    document.head.appendChild(link);

    // JS
    const script = document.createElement("script");
    script.src = "https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.js";
    script.async = true;
    script.onload = () => {
      const check = setInterval(() => {
        if ((window as any).atlas?.Map) { clearInterval(check); resolve(); }
      }, 50);
      setTimeout(() => { clearInterval(check); reject(new Error("Azure Maps timeout")); }, 15000);
    };
    script.onerror = () => reject(new Error("Failed to load Azure Maps"));
    document.head.appendChild(script);
  });

  return _loadPromise;
}

export default function AzureHeatMap({
  points,
  mode,
  defaultCenter = null,
  height = 480,
  preview = false,
}: AzureHeatMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const sourceRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const { data: keyData } = useQuery<{ key: string }>({
    queryKey: ["/api/config/azure-maps-key"],
    staleTime: STALE_STATIC,
  });
  const apiKey = keyData?.key ?? "";

  // Load Azure Maps + create map
  useEffect(() => {
    if (!apiKey || !containerRef.current) return;
    let cancelled = false;

    loadAzureMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const atlas = (window as any).atlas;
        const center = defaultCenter || BRAZIL_CENTER;

        const map = new atlas.Map(containerRef.current, {
          center: [center.lng, center.lat],
          zoom: defaultCenter ? 11 : 3,
          language: "pt-BR",
          authOptions: {
            authType: "subscriptionKey",
            subscriptionKey: apiKey,
          },
          interactive: !preview,
          showFeedbackLink: false,
          showLogo: false,
        });

        map.events.add("ready", () => {
          if (cancelled) return;
          mapRef.current = map;
          setStatus("ready");
        });
      })
      .catch((err) => {
        console.error("[AzureHeatMap] Erro:", err);
        if (!cancelled) setStatus("error");
      });

    return () => { cancelled = true; };
  }, [apiKey]);

  // Update center
  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !defaultCenter) return;
    mapRef.current.setCamera({
      center: [defaultCenter.lng, defaultCenter.lat],
      zoom: 11,
    });
  }, [status, defaultCenter?.lat, defaultCenter?.lng]);

  // Update heatmap layer
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    const atlas = (window as any).atlas;

    // Remove old
    if (layerRef.current) {
      mapRef.current.layers.remove(layerRef.current);
      layerRef.current = null;
    }
    if (sourceRef.current) {
      mapRef.current.sources.remove(sourceRef.current);
      sourceRef.current = null;
    }

    if (points.length === 0) return;

    const source = new atlas.source.DataSource();
    mapRef.current.sources.add(source);
    sourceRef.current = source;

    const maxW = Math.max(...points.map(p => p.weight), 1);
    for (const p of points) {
      const feature = new atlas.data.Feature(
        new atlas.data.Point([p.lng, p.lat]),
        { weight: p.weight / maxW }
      );
      source.add(feature);
    }

    const colors = mode === "provider"
      ? ["interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(34,197,94,0)",
          0.2, "#86efac",
          0.4, "#fde047",
          0.6, "#fb923c",
          0.8, "#ef4444",
          1.0, "#991b1b",
        ]
      : ["interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(59,130,246,0)",
          0.2, "#93c5fd",
          0.4, "#a78bfa",
          0.6, "#e879f9",
          0.8, "#f43f5e",
          1.0, "#881337",
        ];

    const layer = new atlas.layer.HeatMapLayer(source, null, {
      radius: 30,
      opacity: 0.7,
      weight: ["get", "weight"],
      color: colors,
    });

    mapRef.current.layers.add(layer);
    layerRef.current = layer;

    // Fit bounds
    if (points.length > 1) {
      const positions = points.map(p => [p.lng, p.lat]);
      const bbox = atlas.data.BoundingBox.fromPositions(positions);
      mapRef.current.setCamera({ bounds: bbox, padding: 40 });
    } else if (points.length === 1 && !defaultCenter) {
      mapRef.current.setCamera({
        center: [points[0].lng, points[0].lat],
        zoom: 13,
      });
    }
  }, [status, points, mode]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.dispose();
        mapRef.current = null;
        sourceRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{ height, minHeight: 200 }}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
        data-testid="azure-heatmap-container"
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
