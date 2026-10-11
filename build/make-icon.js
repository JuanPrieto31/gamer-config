// Genera build/icon.png e build/icon.ico a partir del logo (Phosphor "game-controller" sobre el rojo de la marca).
// Uso: npx electron build/make-icon.js
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.join(dir, "../node_modules/@phosphor-icons/core/assets/fill/game-controller-fill.svg");
const BG = "#e0544a"; // --accent
const INK = "#2a0705"; // --accent-ink

function svg(size) {
  const inner = fs.readFileSync(ICON, "utf8").match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];
  const r = size * 0.22;
  const pad = size * 0.1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${r}" fill="${BG}"/>
    <g transform="translate(${pad} ${pad}) scale(${(size - pad * 2) / 256})" fill="${INK}">${inner}</g>
  </svg>`;
}

// Se dibuja el SVG en un <canvas> dentro de la página y se exporta como PNG (funciona con la ventana oculta).
async function render(win, size) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg(size)).toString("base64")}`;
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = ${size};
      c.getContext("2d").drawImage(img, 0, 0, ${size}, ${size});
      ok(c.toDataURL("image/png"));
    };
    img.onerror = () => fail(new Error("no se pudo dibujar el SVG"));
    img.src = ${JSON.stringify(src)};
  })`);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

// ICO con PNG dentro (válido desde Windows Vista): cabecera + una entrada por tamaño + los PNG.
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por píxel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL("about:blank");
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) pngs.push({ size, data: await render(win, size) });
  fs.writeFileSync(path.join(dir, "icon.png"), pngs.at(-1).data);
  fs.writeFileSync(path.join(dir, "icon.ico"), ico(pngs));
  console.log("icon.png e icon.ico generados:", sizes.join(", "), "px");
  app.exit(0);
});
