import "leaflet";

declare module "leaflet" {
  function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: {
      radius?: number;
      blur?: number;
      maxZoom?: number;
      max?: number;
      gradient?: Record<number, string>;
      minOpacity?: number;
    }
  ): L.Layer;
}

declare module "leaflet.heat" {}
