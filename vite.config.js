import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps asset and model URLs relative, so no hardcoded hosts.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { chunkSizeWarningLimit: 4000 }, // face-api bundles TensorFlow.js
});
