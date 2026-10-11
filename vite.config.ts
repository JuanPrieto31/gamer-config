import { defineConfig } from "vite";

export default defineConfig({
  base: "./", // Electron carga dist/index.html desde disco
  build: { target: "chrome130" },
});
