// Ajustes de CUALQUIER juego, sin perfil hecho a mano:
//  1. findConfigs: busca su archivo de configuración donde suelen guardarlo los juegos
//     (Documentos, AppData, Saved Games, carpeta de instalación, userdata de Steam...).
//  2. autoSettings: reconoce cada ajuste por su nombre (shadow, ssao, volumetric, texture...),
//     deduce qué niveles admite a partir de su valor actual y le pone el coste de su categoría.
import fs from "node:fs/promises";
import path from "node:path";
import { detectFormat, parse, write } from "./configparse.js";

/* ---------- Categorías: coste en % de gráfica (cost) y procesador (cpu) a calidad máxima ---------- */
// Costes medios de las guías y benchmarks usados en los perfiles (PC Gamer, Tier1Settings, CheckFPS, FrameCoach...).

const CATS = [
  { id: "motionblur", re: /motion.?blur/, label: "Desenfoque de movimiento", off: true },
  { id: "vsync", re: /v.?sync|vertical.?sync|waitforvertical/, label: "Sincronización vertical", off: true },
  { id: "grain", re: /film.?grain|\bgrain\b|chromatic|vignette|lens.?flare/, label: "Grano, viñeta y efectos de cámara", off: true },
  { id: "fpscap", re: /frame.?rate.?limit|max.?fps|fps.?(cap|limit)|framerate.?(cap|limit)|maxframerate|frame.?limit/, label: "Límite de FPS", cap: true },
  { id: "rt", re: /ray.?trac|raytrac|path.?trac|\brtx?(gi|ao|reflections?|shadows?)?\b/, label: "Trazado de rayos", cost: 35, visual: 1 },
  { id: "gi", re: /global.?illum|\bgi\b|lumen/, label: "Iluminación global", cost: 18, visual: 1 },
  { id: "ao", re: /ambient.?occ|ssao|hbao|gtao|\bao\b/, label: "Oclusión ambiental", cost: 12, visual: 1 },
  { id: "dof", re: /depth.?of.?field|\bdof\b/, label: "Profundidad de campo", cost: 2, visual: 0.5 },
  { id: "volumetric", re: /volumetric|\bfog\b|god.?ray|light.?shaft/, label: "Niebla y luz volumétrica", cost: 8, visual: 1 },
  { id: "shadows", re: /shadow/, label: "Sombras", cost: 15, cpu: 4, visual: 2 },
  { id: "reflections", re: /reflect|\bssr\b/, label: "Reflejos", cost: 8, visual: 1 },
  { id: "effects", re: /effect|particle|vfx|\bfx/, label: "Efectos y partículas", cost: 6, cpu: 3, visual: 2 },
  { id: "post", re: /post.?process|bloom/, label: "Postprocesado", cost: 6, visual: 1 },
  { id: "view", re: /view.?dist|draw.?dist|\blod\b|lod.?(bias|scale|level|quality)|visrange|object.?detail|model.?(detail|quality)|mesh.?quality|geometry/, label: "Distancia de visión y detalle", cost: 5, cpu: 9, visual: 2 },
  { id: "foliage", re: /foliage|grass|vegetation/, label: "Vegetación", cost: 5, cpu: 3, visual: 1 },
  { id: "aa", re: /anti.?alias|\baa\b|fxaa|\btaa\b|msaa|smaa/, label: "Antialiasing", cost: 4, visual: 2 },
  { id: "aniso", re: /aniso/, label: "Filtro anisotrópico", cost: 2, visual: 2 },
  { id: "textures", re: /texture|tex.?quality/, label: "Texturas", vram: true },
  { id: "shading", re: /shading|material|shader.?quality/, label: "Sombreado", cost: 6, visual: 2 },
  { id: "preset", re: /^(graphics|overall|quality|preset)$|quality.?level|graphics.?(quality|level|preset)|overall.?quality|quality.?preset/, label: "Calidad general", cost: 40, cpu: 10, visual: 3 },
];

// Nunca se tocan aunque contengan una palabra de arriba (pantalla, sonido, controles...).
const NEVER = /resolution(?!.?scale)|width|height|monitor|window|gamma|bright|volume|sound|audio|music|keybind|\bbind|mouse|sensitiv|language|subtit|\bfov\b|field.?of.?view|hud|crosshair|colou?r|controller|invert|version|last|timestamp|date|count|_id$|^id$|upscal|dlss|fsr|xess|render.?scale|resolution.?scale|screen.?percent/i;

// Rangos conocidos de ajustes concretos (comprobados) que no siguen la regla general.
const KNOWN_RANGES = { savedqualitylevel: [1, 10] };

const shortKey = (k) => k.split(/::|\./).pop();

function categoryOf(key) {
  const k = key.toLowerCase();
  const last = shortKey(k);
  if (NEVER.test(last)) return null;
  return CATS.find((c) => c.re.test(last)) ?? CATS.find((c) => c.id === "preset" && c.re.test(k.replace(/::/g, ".")));
}

/* ---------- Qué valores admite un ajuste, a partir de su valor actual ---------- */

const BOOLS = [["false", "true"], ["off", "on"], ["no", "yes"], ["disabled", "enabled"], ["0", "1"]];
const LADDER = ["low", "medium", "high", "ultra"];
const LADDER_TOP = { ultra: "ultra", epic: "epic", veryhigh: "veryhigh", max: "max", cinematic: "cinematic" };

const matchCase = (sample, word) => (sample === sample.toUpperCase() ? word.toUpperCase() : sample[0] === sample[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);

// Devuelve los niveles posibles, o null si no se puede saber.
// sure = false cuando son números sueltos: no se sabe si 0 es "bajo" o "máximo" (Terraria usa 0=Auto, 3=Bajo),
// así que esos solo se muestran y nunca se escriben solos.
function levelsFor(key, cat, raw) {
  const value = raw.replace(/^"|"$/g, "");
  const v = value.toLowerCase();
  const k = shortKey(key);
  const isToggleKey = /enable|use|toggle|^show|^hide|_on$/i.test(k) || /^b[A-Z]|^is[A-Z]/.test(k) || cat.off || cat.id === "dof";

  // Sí/no
  for (const [off, on] of BOOLS) {
    if ((v === off || v === on) && (off !== "0" || isToggleKey)) {
      // "Hide..." / "Disable..." al revés: activarlo quita el efecto.
      const inverted = /^hide|^disable/i.test(k);
      const lv = [{ value: matchCase(value, off), label: "Desactivado" }, { value: matchCase(value, on), label: "Activado" }];
      return { sure: true, levels: inverted ? [{ ...lv[1], label: "Oculto" }, { ...lv[0], label: "Visible" }] : lv };
    }
  }
  // Palabras: LOW / Medium / high / SQ_HIGH ...
  const w = value.match(/^([A-Za-z]+_)?(low|medium|med|high|ultra|epic|veryhigh|max|cinematic)$/i);
  if (w) {
    const prefix = w[1] ?? "";
    const word = w[2];
    const top = LADDER_TOP[word.toLowerCase()];
    const ladder = top ? [...LADDER.slice(0, 3), top] : LADDER.slice(0, 3);
    const names = { low: "Bajo", medium: "Medio", high: "Alto", ultra: "Ultra", epic: "Épico", veryhigh: "Muy alto", max: "Máximo", cinematic: "Cinemático" };
    return { sure: true, levels: ladder.map((l) => ({ value: prefix + matchCase(word, l), label: names[l] })) };
  }
  // Números
  if (!/^-?\d+$/.test(value)) return null; // decimales, textos raros: solo se muestran
  const n = Number(value);
  const known = KNOWN_RANGES[k.toLowerCase()];
  if (known) return n >= known[0] && n <= known[1] ? { sure: true, levels: range(known[0], known[1]) } : null;
  if (cat.id === "aniso" && [1, 2, 4, 8, 16].includes(n)) return { sure: true, levels: [1, 2, 4, 8, 16].map((x) => ({ value: String(x), label: x === 1 ? "Desactivado" : `${x}x` })) };
  if (cat.id === "shadows" && n >= 256 && (n & (n - 1)) === 0) { // tamaño del mapa de sombras: más grande = más calidad
    return { sure: true, levels: [512, 1024, 2048, 4096].filter((x) => x <= Math.max(n, 2048)).map((x) => ({ value: String(x), label: String(x) })) };
  }
  if (n >= 0 && n <= 4) return { sure: false, levels: range(0, Math.max(n, 3)) };
  return null;
}

function range(a, b) {
  const names = ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"];
  const out = [];
  for (let i = a; i <= b; i++) out.push({ value: String(i), label: b - a <= 4 ? names[Math.round(((i - a) / (b - a)) * 4)] : String(i) });
  return out;
}

/**
 * Convierte los ajustes leídos de un archivo en ajustes que entiende el cálculo.
 * Solo devuelve los "seguros" (se sabe qué valor es más calidad). Con { all: true } incluye también
 * los dudosos, marcados con sure: false, para enseñarlos sin escribirlos.
 */
export function autoSettings(entries, { all = false } = {}) {
  const out = [];
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.key)) continue;
    const cat = categoryOf(e.key);
    if (!cat) continue;
    if (cat.cap) {
      if (/^\d+(\.\d+)?$/.test(e.value) && Number(e.value) >= 30) {
        seen.add(e.key);
        out.push({ key: e.key, cat: cat.id, label: cat.label, auto: true, sure: true, why: "Igual a la frecuencia de tu pantalla: tiempos de fotograma más estables.", fixed: { fps: "{refresh}", equilibrado: "{refresh}", calidad: "{refresh}" }, levels: [] });
      }
      continue;
    }
    const found = levelsFor(e.key, cat, e.value);
    if (!found || found.levels.length < 2 || (!found.sure && !all)) continue;
    const { levels, sure } = found;
    seen.add(e.key);
    const n = levels.length - 1;
    const base = { key: e.key, cat: cat.id, label: cat.label, auto: true, sure, visual: cat.visual ?? 1 };
    if (cat.off) {
      out.push({ ...base, why: "Casi todo el mundo lo prefiere apagado; en algunos casos añade retraso.", levels, fixed: { fps: levels[0].value, equilibrado: levels[0].value, calidad: levels[0].value } });
    } else if (cat.vram) {
      const vramSteps = [0, 2, 4, 6, 8];
      out.push({ ...base, why: "No cuestan FPS mientras quepan en la memoria de tu gráfica.", levels: levels.map((l, i) => ({ ...l, cost: 0, vram: vramSteps[Math.round((i / n) * 4)] })) });
    } else {
      out.push({
        ...base,
        why: `Detectado automáticamente. Coste típico a calidad máxima: ~${cat.cost} % de gráfica${cat.cpu ? ` y ~${cat.cpu} % de procesador` : ""}.`,
        levels: levels.map((l, i) => ({ ...l, cost: (cat.cost * i) / n, cpu: ((cat.cpu ?? 0) * i) / n })),
      });
    }
  }
  return out;
}

/* ---------- Búsqueda del archivo ---------- */

const CONFIG_EXT = /\.(ini|cfg|txt|json|xml|scr|config|vcfg|conf)$/i;
const BAD_NAME = /log|crash|cache|shader|backup|\.bak|steam_api|unins|eula|licen|readme|credit|manifest|achiev|save|telemetry|analytics|localization|lang|font|input|keybind|controls|^(base|default)\w*\.ini$|android|ios|linux|mac|default|session.json$|steamnetworking|runtimeconfig|deps.json$|^[0-9a-f-]{16,}.json$/i;
// Carpetas con configuración interna del motor (no la del jugador): nunca se tocan.
const BAD_DIR = /[\\/](engine|platforms?|plugins|binaries|content|redist|_commonredist|directx|vcredist|crashes|httpcache|webcache|defaults?|versions|logs?)[\\/]/i;
const GOOD_NAME = /setting|config|option|video|graphic|display|pref|quality|user|engine|game\.|machine|profile/i;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function nameVariants(game) {
  const raw = [game.name, path.basename(game.path ?? "")].filter(Boolean);
  const v = new Set();
  for (const r of raw) {
    v.add(norm(r));
    v.add(norm(r.replace(/[:\-–].*$/, ""))); // "Juego: Subtítulo" → "Juego"
    const first = norm(r.split(/\s+/)[0]); // "Apex Legends" → "apex" (Saved Games\Respawn\Apex)
    if (first.length >= 4 && !/^(the|call|grand|super|world|star|dark|dead|final|total|real)$/.test(first)) v.add(first);
  }
  v.delete("");
  return [...v].filter((x) => x.length >= 3);
}

// Recorre carpetas (con tope) y llama a visit en cada una.
async function walk(dir, depth, visit, budget = { n: 3000 }) {
  if (depth < 0 || budget.n-- <= 0) return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  await visit(dir, entries);
  for (const e of entries) {
    if (e.isDirectory() && !/^(\.|node_modules|cache|logs?|crash|shadercache|temp)$/i.test(e.name)) {
      await walk(path.join(dir, e.name), depth - 1, visit, budget);
    }
  }
}

async function configFilesIn(dir, depth, strictNames) {
  const found = [];
  await walk(dir, depth, async (d, entries) => {
    for (const e of entries) {
      if (!e.isFile() || !CONFIG_EXT.test(e.name) || BAD_NAME.test(e.name)) continue;
      if (strictNames && !GOOD_NAME.test(e.name)) continue;
      const file = path.join(d, e.name);
      if (BAD_DIR.test(file.slice(dir.length))) continue;
      const st = await fs.stat(file).catch(() => null);
      if (st && st.size > 0 && st.size < 400 * 1024) found.push({ file, mtime: st.mtimeMs });
    }
  });
  return found;
}

/**
 * Busca archivos de configuración del juego y se queda con los que tienen ajustes gráficos reconocibles.
 * Devuelve [{ file, format, entries, tunable }] ordenados del mejor al peor.
 */
export async function findConfigs(game, { docs, steam }, { all = false } = {}) {
  const variants = nameVariants(game);
  const home = process.env.USERPROFILE ?? "";
  const roots = [
    [docs, 2], [path.join(docs ?? "", "My Games"), 1], [process.env.LOCALAPPDATA, 1], [process.env.APPDATA, 1],
    [path.join(home, "AppData", "LocalLow"), 2], [path.join(home, "Saved Games"), 2],
  ].filter(([r]) => r);

  // Carpetas cuyo nombre coincide con el del juego (también dentro de la del estudio: Documents\CAPCOM\RESIDENT EVIL 6).
  const dirs = new Set();
  for (const [root, depth] of roots) {
    await walk(root, depth, async (d, entries) => {
      for (const e of entries) {
        if (e.isDirectory() && variants.some((v) => norm(e.name) === v || (v.length >= 6 && norm(e.name).startsWith(v)))) dirs.add(path.join(d, e.name));
      }
    }, { n: 1500 });
  }

  const candidates = [];
  for (const d of dirs) candidates.push(...(await configFilesIn(d, 4, false)));
  if (game.path) candidates.push(...(await configFilesIn(game.path, 3, true)));
  const appId = game.id.startsWith("steam-") ? game.id.slice(6) : null;
  if (appId && steam) {
    for (const uid of await fs.readdir(path.join(steam, "userdata")).catch(() => [])) {
      candidates.push(...(await configFilesIn(path.join(steam, "userdata", uid, appId), 4, false)));
    }
  }

  const results = [];
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.file.toLowerCase())) continue;
    seen.add(c.file.toLowerCase());
    const text = await fs.readFile(c.file, "utf8").catch(() => null);
    // Binario o UTF-16 (lleno de bytes nulos): no se toca. Uno suelto al final (Apex) no importa.
    if (!text || (text.match(/\u0000/g)?.length ?? 0) > text.length / 50) continue;
    const format = detectFormat(text, c.file);
    if (!format) continue;
    let entries;
    try { entries = parse(text, format); } catch { continue; }
    const tunable = autoSettings(entries).length;
    // all: también archivos sin ajustes gráficos (controles, audio...) para poder verlos y editarlos a mano.
    if (tunable >= 2 || (all && entries.length >= 2)) results.push({ file: c.file, format, entries, tunable, mtime: c.mtime });
  }
  return results.sort((a, b) => b.tunable - a.tunable || b.mtime - a.mtime).slice(0, all ? 8 : 3);
}

// Adaptador para leer/escribir un ajuste en un archivo de formato detectado.
export function genericFormat(format) {
  return {
    read: (text, key) => parse(text, format).find((e) => e.key === key)?.value ?? null,
    write: (text, key, value) => write(text, format, key, value),
  };
}

export { detectFormat, parse };
