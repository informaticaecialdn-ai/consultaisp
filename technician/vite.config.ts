import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Frontend independente. A API usa proxy da mesma origem; cookies não atravessam domínios.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../client/src"), "@shared": path.resolve(import.meta.dirname, "../shared") } },
  build: { outDir: path.resolve(import.meta.dirname, "../dist-technician"), emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5001, strictPort: true, fs: { allow: [path.resolve(import.meta.dirname, "..")], deny: ["**/.*"] }, proxy: {
    "^/api/(auth/(login|logout|me)$|equipment/field/cases)": { target: process.env.TECHNICIAN_API_TARGET || "http://127.0.0.1:5000", changeOrigin: true },
  } },
});
