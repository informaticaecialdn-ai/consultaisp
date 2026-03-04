import L from "leaflet";

const DU = L.DomUtil as any;
if (!DU.__getPositionPatched) {
  const orig = DU.getPosition;
  DU.getPosition = function (el: any) {
    if (!el || !el._leaflet_pos) return new L.Point(0, 0);
    return orig.call(this, el);
  };
  DU.__getPositionPatched = true;
}
