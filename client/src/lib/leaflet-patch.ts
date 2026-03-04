import L from "leaflet";

const DU = L.DomUtil as any;
if (!DU.__getPositionPatched) {
  const origGet = DU.getPosition;
  DU.getPosition = function (el: any) {
    try {
      if (!el || typeof el._leaflet_pos === "undefined") {
        return new L.Point(0, 0);
      }
      return origGet.call(this, el);
    } catch {
      return new L.Point(0, 0);
    }
  };

  const origSet = DU.setPosition;
  DU.setPosition = function (el: any, point: any, disable3D?: boolean) {
    try {
      if (!el) return;
      return origSet.call(this, el, point, disable3D);
    } catch {}
  };

  const origRemove = DU.remove;
  DU.remove = function (el: any) {
    try {
      if (!el) return;
      return origRemove.call(this, el);
    } catch {}
  };

  DU.__getPositionPatched = true;
}
