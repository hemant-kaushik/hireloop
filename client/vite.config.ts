import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = process.env.API_PORT ?? "3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // UI calls /api/... on its own origin; Vite forwards to Express. No CORS needed.
      "/api": `http://localhost:${API_PORT}`,
    },
  },
});
