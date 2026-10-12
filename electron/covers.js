// Portadas de los juegos que no son de Steam. Todo gratis y sin claves:
//  - Epic: su lanzador guarda las portadas de cada juego en catcache.bin (en este PC).
//  - Riot: cada juego trae un icono de 256 px en sus datos locales.
//  - Xbox: cada juego trae sus logos en su carpeta (MicrosoftGame.config dice cuáles).
//  - El resto (EA, Ubisoft, Battle.net, GOG, Rockstar...): se busca el mismo nombre en la tienda de Steam.
//  - Si nada funciona: el icono del ejecutable (Roblox) o la inicial.
// Lo de internet se guarda en caché (portadas.json) para no volver a buscar en cada arranque.
import { app, nativeImage } from "electron";
import fs from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { steamIdByName } from "./demand.js";

const EPIC_CATALOG = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Catalog\\catcache.bin";
const RIOT_DIR = "C:\\ProgramData\\Riot Games\\Metadata";
const steamHeader = (id) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
const cacheFile = () => path.join(app.getPath("userData"), "portadas.json");

let epic = null; // catalogItemId → url de la portada ancha
function epicCover(catalogId) {
  if (!catalogId) return null;
  if (!epic) {
    epic = new Map();
    try {
      const items = JSON.parse(Buffer.from(readFileSync(EPIC_CATALOG, "utf8"), "base64").toString("utf8"));
      for (const it of items) {
        const img = it.keyImages?.find((k) => k.type === "DieselGameBox") ?? it.keyImages?.find((k) => k.type === "OfferImageWide") ?? it.keyImages?.[0];
        if (img?.url) epic.set(it.id, img.url);
      }
    } catch { /* sin lanzador de Epic */ }
  }
  return epic.get(catalogId) ?? null;
}

// Imagen local (ico/png) → data URL, para que la interfaz pueda mostrarla sin acceso a disco.
function localImage(file, size = 256) {
  if (!file || !existsSync(file)) return null;
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return null;
  return img.resize({ width: size, height: size, quality: "best" }).toDataURL();
}

async function xboxLogo(dir) {
  const cfg = await fs.readFile(path.join(dir, "MicrosoftGame.config"), "utf8").catch(() => null);
  const rel = cfg?.match(/Square480x480Logo="([^"]+)"/)?.[1] ?? cfg?.match(/Square150x150Logo="([^"]+)"/)?.[1] ?? cfg?.match(/StoreLogo="([^"]+)"/)?.[1];
  return rel ? localImage(path.join(dir, rel)) : null;
}

async function exeIcon(exe) {
  if (!exe || !existsSync(exe)) return null;
  const icon = await app.getFileIcon(exe, { size: "large" }).catch(() => null);
  return icon && !icon.isEmpty() ? icon.toDataURL() : null;
}

async function robloxExe(dir) {
  const versions = await fs.readdir(path.join(dir, "Versions")).catch(() => []);
  return versions.map((v) => path.join(dir, "Versions", v, "RobloxPlayerBeta.exe")).find((f) => existsSync(f)) ?? null;
}

let cache = null;
async function loadCache() {
  cache ??= JSON.parse(await fs.readFile(cacheFile(), "utf8").catch(() => "{}"));
  return cache;
}

/** Rellena `image` (y `imageFit: "icon"` cuando es un icono pequeño) en los juegos que no la tienen. */
export async function addCovers(games) {
  const c = await loadCache();
  let changed = false;
  await Promise.all(games.filter((g) => !g.image).map(async (g) => {
    if (g.store === "Epic") g.image = epicCover(g.catalogId) ?? "";
    if (!g.image && g.store === "Riot") {
      const p = g.id.replace(/^riot-/, "");
      g.image = localImage(path.join(RIOT_DIR, p, `${p}.ico`)) ?? "";
      if (g.image) g.imageFit = "icon";
    }
    if (!g.image && g.store === "Xbox") {
      g.image = (await xboxLogo(g.path)) ?? "";
      if (g.image) g.imageFit = "icon";
    }
    // Mismo juego en Steam (muchos de EA, Ubisoft, Rockstar o Battle.net también están allí).
    if (!g.image && g.store !== "Riot" && g.store !== "Roblox") {
      const hit = c[g.id];
      const fresh = hit && Date.now() - hit.at < (hit.id ? 365 : 30) * 864e5; // lo no encontrado se reintenta al mes
      if (!fresh) {
        const id = await steamIdByName(g.name).catch(() => undefined);
        if (id !== undefined) { c[g.id] = { id, at: Date.now() }; changed = true; }
      }
      if (c[g.id]?.id) g.image = steamHeader(c[g.id].id);
    }
    if (!g.image && g.store === "Roblox") {
      g.image = (await exeIcon(await robloxExe(g.path))) ?? "";
      if (g.image) g.imageFit = "icon";
    }
  }));
  if (changed) await fs.writeFile(cacheFile(), JSON.stringify(c)).catch(() => {});
  return games;
}
