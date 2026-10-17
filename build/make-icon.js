// Genera build/icon.png, build/icon.ico y public/favicon.svg a partir del logo (src/logo.svg: monograma GG) sobre una placa negra metálica.
// Uso: npx electron build/make-icon.js
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.join(dir, "../src/logo.svg");
const INK = "#f2f2f2"; // el logo, en blanco como en la app

function svg(size) {
  const inner = fs.readFileSync(ICON, "utf8").match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];
  const r = size * 0.22;
  const pad = size * 0.1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3a3a"/><stop offset="0.6" stop-color="#121212"/><stop offset="1" stop-color="#050505"/></linearGradient></defs>
    <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
    <rect x="${size * 0.01}" y="${size * 0.01}" width="${size * 0.98}" height="${size * 0.98}" rx="${r * 0.95}" fill="none" stroke="#6a6a6a" stroke-width="${Math.max(1, size * 0.012)}"/>
    <g transform="translate(${pad} ${pad}) scale(${(size - pad * 2) / 256})" fill="${INK}" color="${INK}">${inner}</g>
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
  fs.mkdirSync(path.join(dir, "../public"), { recursive: true });
  fs.writeFileSync(path.join(dir, "../public/favicon.svg"), svg(64)); // icono de la pestaña: la misma placa en vectorial
  console.log("icon.png e icon.ico generados:", sizes.join(", "), "px");
  app.exit(0);
});
