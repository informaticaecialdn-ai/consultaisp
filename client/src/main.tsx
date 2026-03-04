import "./lib/leaflet-patch";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

window.addEventListener("error", (e) => {
  if (e.message?.includes("_leaflet_pos")) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
});

window.addEventListener("unhandledrejection", (e) => {
  if (e.reason?.message?.includes("_leaflet_pos")) {
    e.preventDefault();
    e.stopPropagation();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
