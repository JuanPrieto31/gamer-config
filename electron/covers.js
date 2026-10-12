// Portadas de los juegos que no son de Steam. Todo gratis y sin claves:
//  - Epic: su lanzador guarda las portadas de cada juego en catcache.bin (en este PC).
//  - Riot: cada juego trae un icono de 256 px en sus datos locales.
//  - Xbox: cada juego trae sus logos en su carpeta (MicrosoftGame.config dice cuáles).
//  - El resto (EA, Ubisoft, Battle.net, GOG, Rockstar...): se busca el mismo nombre en la tienda de Steam
//    y en el catálogo local de Epic (que guarda también las portadas de juegos que no instalaste desde Epic).
//  - Juegos que no están en ninguna tienda (League of Legends, Roblox, Minecraft...): su logo oficial en Wikipedia.
//  - Si nada funciona: el icono del juego/ejecutable o la inicial.
// Lo de internet se guarda en caché (portadas.json) para no volver a buscar en cada arranque.
import { app, nativeImage } from "electron";
import fs from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const UA = { "User-Agent": "GamerConfig (https://github.com/JuanPrieto31/gamer-config)" };
// null = no existe (404); un error de red o del servidor (429, 500...) lanza, para reintentarlo más tarde en vez de darlo por inexistente.
const getJson = async (url) => {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
// Sin acentos, ™/®, ni palabras de edición: "Apex Legends™ Deluxe Edition" ≈ "apexlegends".
const EDITION = /\b(standard|deluxe|ultimate|definitive|remastered|goty|game of the year|anniversary|edition|bundle)\b/gi;
const key = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[™®©]/g, "").replace(EDITION, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const EPIC_CATALOG = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Catalog\\catcache.bin";
const RIOT_DIR = "C:\\ProgramData\\Riot Games\\Metadata";
const steamHeader = (id) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
const cacheFile = () => path.join(app.getPath("userData"), "portadas.json");

let epic = null; // catalogItemId → url de la portada ancha
let epicByTitle = null; // título normalizado → url
function epicCover(catalogId) {
  loadEpic();
  return catalogId ? epic.get(catalogId) ?? null : null;
}
function epicCoverByTitle(name) {
  loadEpic();
  return epicByTitle.get(key(name)) ?? null;
}
function loadEpic() {
  if (!epic) {
    epic = new Map();
    epicByTitle = new Map();
    try {
      const items = JSON.parse(Buffer.from(readFileSync(EPIC_CATALOG, "utf8"), "base64").toString("utf8"));
      for (const it of items) {
        const img = it.keyImages?.find((k) => k.type === "DieselGameBox") ?? it.keyImages?.find((k) => k.type === "OfferImageWide") ?? it.keyImages?.[0];
        if (!img?.url) continue;
        epic.set(it.id, img.url);
        if (it.title && key(it.title) && !epicByTitle.has(key(it.title))) epicByTitle.set(key(it.title), img.url);
      }
    } catch { /* sin lanzador de Epic */ }
  }
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

const NOT_THE_GAME = /(soundtrack|dlc|demo|beta|playtest|dedicated server|sdk|artbook)|pack$/i;

// Mismo juego en la tienda de Steam, aceptando diferencias de edición ("Deluxe Edition", ™...), pero nunca
// otro juego que empiece igual (Minecraft ≠ Minecraft Dungeons).
async function steamCoverId(name) {
  const j = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name.replace(/[™®]/g, ""))}&cc=us&l=english`);
  if (!j) return null;
  const want = key(name);
  return want ? j.items?.find((i) => i.type === "app" && !NOT_THE_GAME.test(i.name) && key(i.name) === want)?.id ?? null : null;
}

// Solo se guardan imágenes que de verdad vienen de Wikimedia (https): la caché no puede acabar apuntando a otro sitio.
const wikimedia = (u) => { try { const x = new URL(u); return x.protocol === "https:" && /^(upload|thumb)\.wikimedia\.org$/.test(x.hostname); } catch { return false; } };

// Logo del juego en Wikipedia/Wikidata (para los que no están en ninguna tienda). Solo si la página es de un videojuego.
// Devuelve la url, null si no hay, o undefined si falló la red (se reintenta).
async function wikiLogo(name) {
  for (const title of [`${name} (video game)`, name]) {
    const j = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`);
    if (j?.type !== "standard" || !/video ?game|online game|sandbox|mmo|moba|platform/i.test(j.description ?? "")) continue;
    if (j.thumbnail?.source && wikimedia(j.thumbnail.source)) return j.thumbnail.source;
    // La página no tiene imagen: se usa el logo (propiedad P154) de su ficha en Wikidata.
    if (!j.wikibase_item) continue;
    const claims = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${j.wikibase_item}&property=P154&format=json`);
    const file = claims?.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
    if (!file) continue;
    const info = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(`File:${file}`)}&prop=imageinfo&iiprop=url&iiurlwidth=600&format=json`);
    const page = Object.values(info?.query?.pages ?? {})[0];
    const url = page?.imageinfo?.[0]?.thumburl;
    if (url && wikimedia(url)) return url;
  }
  return null;
}

// Versión del formato de la caché: al subirla se descartan los aciertos de versiones anteriores (que aceptaban coincidencias más flojas).
const CACHE_VERSION = 2;
let cache = null;
async function loadCache() {
  if (!cache) {
    const raw = JSON.parse(await fs.readFile(cacheFile(), "utf8").catch(() => "{}"));
    cache = raw._v === CACHE_VERSION ? raw : { _v: CACHE_VERSION };
  }
  return cache;
}

const fresh = (hit, found) => hit && Date.now() - hit.at < (found ? 365 : 30) * 864e5; // lo no encontrado se reintenta al mes

// Icono que trae el propio juego (Riot, Roblox, Xbox): el último recurso si no hay portada ni logo.
async function localIcon(g) {
  if (g.store === "Riot") {
    const p = g.id.replace(/^riot-/, "");
    return localImage(path.join(RIOT_DIR, p, `${p}.ico`));
  }
  if (g.store === "Roblox") return exeIcon(await robloxExe(g.path));
  if (g.store === "Xbox") return xboxLogo(g.path);
  return null;
}

/** Rellena `image` (y `imageFit: "icon"` cuando es un icono pequeño) en los juegos que no la tienen. */
export async function addCovers(games) {
  const c = await loadCache();
  let changed = false;
  // 1) Portadas de tienda y logos del propio juego, en paralelo.
  await Promise.all(games.filter((g) => !g.image).map(async (g) => {
    if (g.store === "Epic") g.image = epicCover(g.catalogId) ?? "";
    // Otras tiendas: el mismo juego en el catálogo de Epic (local) o en Steam (muchos de EA, Ubisoft, Rockstar o Battle.net también están allí).
    if (!g.image && g.store !== "Epic") g.image = epicCoverByTitle(g.name) ?? "";
    if (!g.image && g.store !== "Steam") {
      if (!fresh(c[g.id], c[g.id]?.id)) {
        const id = await steamCoverId(g.name).catch(() => undefined); // undefined = sin red: no se anota, se reintenta
        if (id !== undefined) { c[g.id] = { ...c[g.id], id, at: Date.now() }; changed = true; }
      }
      if (c[g.id]?.id) g.image = steamHeader(c[g.id].id);
    }
  }));
  // 2) Ni Steam ni Epic lo tienen (LoL, Roblox, Minecraft...): su logo en Wikipedia. Uno a uno, para no saturarla,
  //    y guardado en la caché para no volver a pedirlo.
  for (const g of games.filter((g) => !g.image)) {
    const hit = c[g.id]?.wiki;
    if (!fresh(hit, hit?.url)) {
      const url = await wikiLogo(g.name).catch(() => undefined); // undefined = sin red o límite de Wikipedia: se reintenta
      if (url !== undefined) { c[g.id] = { ...c[g.id], wiki: { url, at: Date.now() } }; changed = true; }
    }
    const url = c[g.id]?.wiki?.url;
    if (url) { g.image = url; g.imageFit = "icon"; }
  }
  // 3) Último recurso: el icono del juego.
  await Promise.all(games.filter((g) => !g.image).map(async (g) => {
    g.image = (await localIcon(g)) ?? "";
    if (g.image) g.imageFit = "icon";
  }));
  if (changed) await fs.writeFile(cacheFile(), JSON.stringify(c)).catch(() => {});
  return games;
}
