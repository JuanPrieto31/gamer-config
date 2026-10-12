// Cuánto pide cada juego (gráfica y procesador), a partir de sus requisitos oficiales.
// Fuente: la API pública de la tienda de Steam (sirve para cualquier juego que esté en Steam).
// Se guarda en caché para no volver a preguntar.
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { demandOf } from "./gpus.js";
import { cpuDemandOf } from "./cpus.js";

const CACHE_VERSION = 3; // sube cuando cambia lo que se guarda (v1 sin procesador, v2 sin RAM/VRAM/SSD)
const cacheFile = () => path.join(app.getPath("userData"), "requisitos.json");
let cache = null;

async function load() {
  cache ??= JSON.parse(await fs.readFile(cacheFile(), "utf8").catch(() => "{}"));
  return cache;
}

async function save() {
  await fs.mkdir(path.dirname(cacheFile()), { recursive: true });
  await fs.writeFile(cacheFile(), JSON.stringify(cache));
}

const steamApi = (q) => fetch(`https://store.steampowered.com/api/${q}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
// Sin acentos ni símbolos, pero conservando letras de cualquier alfabeto (si no, dos títulos en japonés quedarían iguales: "").
const simple = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function line(html, re) {
  const text = String(html ?? "").replace(/<br\s*\/?>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "");
  return text.match(new RegExp(`(?:${re})\\s*:\\s*(.+)`, "i"))?.[1].trim() ?? null;
}
const gpuLine = (h) => line(h, "graphics|video card|video|gpu");
const cpuLine = (h) => line(h, "processor|cpu");

// Si los requisitos no nombran una gráfica pero sí su memoria ("128 MB Video Memory"), se estima con ella.
function byMemory(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(mb|gb)/i);
  if (!m) return null;
  const gb = Number(m[1]) / (m[2].toLowerCase() === "mb" ? 1024 : 1);
  return gb < 0.6 ? 3 : gb < 1.5 ? 10 : gb < 3 ? 25 : gb < 5 ? 45 : gb < 7 ? 60 : 90;
}

// Los mínimos suelen dar ~30 FPS en bajo: se escalan para compararlos con los recomendados.
const MIN_TO_REC = 1.6;

function gpuFrom(req) {
  const rec = gpuLine(req.recommended);
  const min = gpuLine(req.minimum);
  const r = rec && demandOf(rec);
  if (r) return { score: r.score, text: rec, kind: "recomendados" };
  const m = min && demandOf(min);
  if (m) return { score: Math.round(m.score * MIN_TO_REC), text: min, kind: "mínimos" };
  const mem = (rec && byMemory(rec)) ?? (min && byMemory(min) * MIN_TO_REC);
  if (mem) return { score: Math.round(mem), text: rec ?? min, kind: rec ? "recomendados" : "mínimos" };
  return null;
}

function cpuFrom(req) {
  const rec = cpuLine(req.recommended);
  const min = cpuLine(req.minimum);
  const r = rec && cpuDemandOf(rec);
  if (r) return { score: r.score, text: rec, kind: "recomendados" };
  const m = min && cpuDemandOf(min);
  if (m) return { score: Math.round(m.score * MIN_TO_REC), text: min, kind: "mínimos" };
  return null;
}

// "Memory: 16 GB RAM" → 16
function ramFrom(req) {
  const t = line(req.recommended, "memory|ram") ?? line(req.minimum, "memory|ram");
  const m = t?.match(/(\d+(?:\.\d+)?)\s*(gb|mb)/i);
  return m ? Number(m[1]) / (m[2].toLowerCase() === "mb" ? 1024 : 1) : null;
}

// "GTX 1060 (6GB VRAM)" / "4 GB video memory" → 6 / 4
function vramFrom(req) {
  const t = gpuLine(req.recommended) ?? gpuLine(req.minimum) ?? "";
  const m = t.match(/(\d+)\s*gb\s*(vram|video|of\s*vram|dedicated)?/i);
  return m && (m[2] || /vram|video memory/i.test(t)) ? Number(m[1]) : null;
}

// ¿Pide SSD? (en "Storage" o en notas adicionales)
const ssdFrom = (req) => /\bssd\b/i.test(`${req.recommended ?? ""} ${req.minimum ?? ""}`);

async function fromSteam(appId) {
  const j = await steamApi(`appdetails?appids=${appId}&filters=basic&l=english`);
  const req = j?.[appId]?.data?.pc_requirements;
  if (!req || Array.isArray(req)) return { gpu: null, cpu: null }; // Steam devuelve [] si no hay requisitos
  return { gpu: gpuFrom(req), cpu: cpuFrom(req), ramGb: ramFrom(req), vramGb: vramFrom(req), ssd: ssdFrom(req) };
}

// Juegos fuera de Steam: se busca en Steam por nombre exacto (muchos están en las dos tiendas).
async function steamIdByName(name) {
  const j = await steamApi(`storesearch/?term=${encodeURIComponent(name)}&cc=us&l=english`);
  return j?.items?.find((i) => simple(i.name) === simple(name))?.id ?? null;
}

// Juegos populares que no están en Steam: requisitos recomendados publicados por sus estudios
// (en Roblox y TFT, que no publican recomendados, una referencia aproximada).
const OUTSIDE_STEAM = {
  roblox: { gpu: "GT 1030", cpu: "Intel Core i3-6100", ram: 8 },
  fortnite: { gpu: "GTX 960 / R9 280", cpu: "Intel Core i5-7300U", ram: 16 },
  valorant: { gpu: "GTX 1050 Ti / Radeon R7 370", cpu: "Intel Core i3-4150 / Ryzen 3 1200", ram: 4 },
  teamfighttactics: { gpu: "GTX 1050", cpu: "Intel Core i5-3300 / Ryzen 3 1200", ram: 8 },
  minecraft: { gpu: "GTX 750 Ti", cpu: "Intel Core i5-4690 / AMD A10-7800", ram: 8 },
  minecraftlauncher: { gpu: "GTX 750 Ti", cpu: "Intel Core i5-4690 / AMD A10-7800", ram: 8 },
  genshinimpact: { gpu: "GTX 1060", cpu: "Intel Core i7-4770", ram: 16 },
};

/**
 * Devuelve { gpu: {score,text,kind,source} | null, cpu: {...} | null }.
 * profile.demandGpu / profile.demandCpu: respaldo escrito en el perfil para juegos sin datos en Steam (p. ej. LoL).
 */
export async function demandFor(game, profile = {}) {
  const known = OUTSIDE_STEAM[simple(game.name)];
  if (known) profile = { demandGpu: known.gpu, demandCpu: known.cpu, demandRamGb: known.ram, ...profile };
  const withFallback = (v) => {
    const out = {
      gpu: v?.gpu ? { ...v.gpu, source: "Steam" } : null,
      cpu: v?.cpu ? { ...v.cpu, source: "Steam" } : null,
      ramGb: v?.ramGb ?? profile.demandRamGb ?? null,
      vramGb: v?.vramGb ?? null,
      ssd: Boolean(v?.ssd),
    };
    const g = !out.gpu && profile.demandGpu && demandOf(profile.demandGpu);
    if (g) out.gpu = { score: g.score, text: profile.demandGpu, kind: "recomendados", source: "Perfil" };
    const c = !out.cpu && profile.demandCpu && cpuDemandOf(profile.demandCpu);
    if (c) out.cpu = { score: c.score, text: profile.demandCpu, kind: "recomendados", source: "Perfil" };
    return out;
  };

  const c = await load();
  const hit = c[game.id];
  if (hit?.v === CACHE_VERSION && Date.now() - hit.at < 30 * 864e5) return withFallback(hit.value); // cada 30 días

  try {
    const appId = game.id.startsWith("steam-") ? game.id.slice(6) : await steamIdByName(game.name);
    const value = appId ? await fromSteam(appId) : { gpu: null, cpu: null };
    c[game.id] = { v: CACHE_VERSION, at: Date.now(), value };
    await save().catch(() => {});
    return withFallback(value);
  } catch {
    // Sin internet: lo último que se supo (aunque sea antiguo) o el respaldo del perfil.
    return withFallback(hit?.value);
  }
}
