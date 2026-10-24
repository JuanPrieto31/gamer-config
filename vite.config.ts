import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// La versión de package.json, para enseñarla en la interfaz (abajo del menú lateral).
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  base: "./", // Electron carga dist/index.html desde disco
  build: { target: "chrome130" },
  define: { __APP_VERSION__: JSON.stringify(version) },
});
