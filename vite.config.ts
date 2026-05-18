import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
    preserveSymlinks: false,
  },
  server: {
    host: true,
    port: 5180,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  assetsInclude: ["**/*.ttf"],
});
