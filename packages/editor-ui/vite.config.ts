import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // A single .env at the repo root, not one per package — see .env.example.
  envDir: path.resolve(import.meta.dirname, "../.."),
  server: {
    port: 5173,
  },
});
