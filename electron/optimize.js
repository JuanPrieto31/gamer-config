// Optimización de juegos por cálculo.
//
// Para cada juego se decide:
//  - QUÉ ajustes hay y cuánto cuesta cada nivel → perfil del juego (profiles/*.json), plantilla del motor
//    (profiles/engines/unreal.json, se detecta sola) o guía general (profiles/engines/generic.json).
//  - CUÁNTO pide el juego → requisitos oficiales (demand.js, API de Steam).
//  - CUÁNTO da tu PC → tu gráfica, su memoria, tu resolución y tu pantalla (system.js + gpus.js).
//  - El cálculo (calc.js) elige los niveles para llegar a los FPS del objetivo perdiendo la menor calidad.
import { app } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hardware, steamPath, powerNow } from "./system.js";
import { record } from "./windows.js";
import { demandFor } from "./demand.js";
import { solve, factors } from "./calc.js";
import { findConfigs, autoSettings, genericFormat, detectFormat, parse as parseConfig } from "./autodetect.js";
import { write as writeConfig } from "./configparse.js";

const run = promisify(execFile);
const BUNDLED = path.join(path.dirname(fileURLToPath(import.meta.url)), "../profiles");

// Dirección desde la que se descargan perfiles nuevos o actualizados (index.json + archivos).
// Vacía = solo se usan los perfiles incluidos en la app. Al subir el proyecto a GitHub, poner aquí:
// https://raw.githubusercontent.com/<usuario>/<repo>/main/profiles
export const PROFILES_URL = "https://raw.githubusercontent.com/JuanPrieto31/gamer-config/main/profiles";

// Juegos que no se tocan aunque se detecte su motor (configuración sincronizada con el servidor o antitrampas).
const NEVER_AUTO = new Set(["riot-valorant.live"]);

// Si un juego no tiene requisitos en ningún sitio, se asume uno de exigencia media
// (gráfica tipo GTX 970 / RX 570, procesador tipo Core i5 de 6.ª generación / Ryzen 5 1600).
const DEFAULT_GPU = 75; // ~RTX 2060 / RX 5600 XT: lo típico que piden los juegos actuales
const DEFAULT_CPU = 85; // ~Core i5 de 8.ª-10.ª generación / Ryzen 5 2600

const userDir = (...p) => path.join(app.getPath("userData"), ...p);

/* ---------- Perfiles ---------- */

// Niveles compactos ["valor", "etiqueta", coste, { visual, vram }] → objetos.
const normalize = (p) => ({
  ...p,
  settings: p.settings.map((s) => ({
    ...s,
    levels: (s.levels ?? []).map((l) => (Array.isArray(l) ? { value: String(l[0]), label: l[1], cost: l[2] ?? 0, ...(l[3] ?? {}) } : l)),
  })),
});

async function readDir(dir) {
  const files = await fs.readdir(dir).catch(() => []);
  const out = [];
  for (const f of files.filter((f) => f.endsWith(".json") && f !== "index.json")) {
    try { out.push(normalize(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")))); } catch { /* perfil roto: se ignora */ }
  }
  return out;
}

// Los descargados sustituyen a los incluidos si tienen una versión más nueva.
const newest = (lists) => {
  const map = new Map();
  for (const p of lists.flat()) if ((map.get(p.id)?.version ?? -1) < p.version) map.set(p.id, p);
  return map;
};

let cache = null;
async function library() {
  cache ??= {
    games: [...newest([await readDir(BUNDLED), await readDir(userDir("profiles"))]).values()],
    engines: newest([await readDir(path.join(BUNDLED, "engines")), await readDir(userDir("profiles", "engines"))]),
  };
  return cache;
}

export async function updateProfiles() {
  if (!PROFILES_URL) return { updated: 0, enabled: false };
  const get = (f) => fetch(`${PROFILES_URL}/${f}`, { signal: AbortSignal.timeout(8000) });
  const index = await (await get("index.json")).json();
  const lib = await library();
  const local = new Map([...lib.games.map((p) => [p.id, p.version]), ...[...lib.engines.values()].map((p) => [p.id, p.version])]);
  let updated = 0;
  for (const { file, id, version } of index.profiles ?? []) {
    if (!/^(engines\/)?[a-z0-9-]+\.json$/.test(file) || (local.get(id) ?? -1) >= version) continue;
    const body = await (await get(file)).text();
    const p = JSON.parse(body); // si no es JSON válido, no se guarda
    if (p.id !== id || !Array.isArray(p.settings)) continue;
    await fs.mkdir(path.dirname(userDir("profiles", file)), { recursive: true });
    await fs.writeFile(userDir("profiles", file), body);
    updated++;
  }
  cache = null;
  return { updated, enabled: true };
}

/* ---------- Rutas ---------- */

async function resolvePath(pattern, game, hw) {
  const tokens = {
    install: game.path,
    docs: hw.docs,
    userprofile: process.env.USERPROFILE,
    localappdata: process.env.LOCALAPPDATA,
    appdata: process.env.APPDATA,
    steam: (await steamPath()) ?? "",
  };
  const full = pattern.replace(/\{(\w+)\}/g, (_, k) => tokens[k] ?? "");
  const parts = full.split(/[\\/]/);
  // Un "*" en la ruta (carpeta de usuario de Steam, "Windows"/"WindowsClient" en Unreal...):
  // se elige la coincidencia modificada más recientemente.
  const star = parts.indexOf("*");
  if (star === -1) return path.normalize(full);
  const base = parts.slice(0, star).join("/");
  const rest = parts.slice(star + 1).join("/");
  let best = null;
  for (const d of await fs.readdir(base).catch(() => [])) {
    const p = path.normalize(path.join(base, d, rest));
    const st = await fs.stat(p).catch(() => null);
    if (st && (!best || st.mtimeMs > best.mtime)) best = { p, mtime: st.mtimeMs };
  }
  return best?.p ?? null;
}

/* ---------- Detección de Unreal Engine ---------- */

// Un juego de Unreal trae una carpeta "Engine" y otra de proyecto con Binaries/Win64.
// Su configuración está en %LOCALAPPDATA%\<Proyecto>\Saved\Config\<Plataforma>\GameUserSettings.ini.
async function unrealInfo(game, hw) {
  if (!game.path || NEVER_AUTO.has(game.id)) return null;
  const subdirs = async (d) => (await fs.readdir(d, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name));
  const levels = [game.path, ...(await subdirs(game.path))];
  if (!levels.some((d) => existsSync(path.join(d, "Engine", "Binaries")))) return null;

  const projects = [];
  for (const d of levels) {
    for (const p of await subdirs(d)) {
      if (path.basename(p) !== "Engine" && existsSync(path.join(p, "Binaries", "Win64"))) projects.push(p);
    }
  }
  if (projects.length === 0) return null;

  const processes = [];
  for (const p of projects) {
    for (const f of await fs.readdir(path.join(p, "Binaries", "Win64")).catch(() => [])) if (f.toLowerCase().endsWith(".exe")) processes.push(f);
  }
  const names = [...new Set([...projects.map((p) => path.basename(p)), game.name.replace(/[^a-z0-9]/gi, "")])];
  for (const n of names) {
    for (const base of ["{localappdata}", "{docs}/My Games"]) {
      const file = await resolvePath(`${base}/${n}/Saved/Config/*/GameUserSettings.ini`, game, hw);
      if (file) return { processes, file };
    }
  }
  return { processes, file: null };
}

/* ---------- Qué perfil le toca a cada juego ---------- */

const findCache = new Map();

async function findProfile(game, hw) {
  const lib = await library();
  const own = lib.games.find((p) => p.games.includes(game.id));
  if (own) return { kind: "perfil", profile: own, file: await resolvePath(own.config.path, game, hw), format: own.config.format, processes: own.processes };

  const key = `${game.id}|${game.path}`;
  if (!findCache.has(key)) findCache.set(key, await unrealInfo(game, hw).catch(() => null));
  const ue = findCache.get(key);
  if (ue && lib.engines.has("unreal")) {
    // Se vuelve a buscar el archivo por si el juego se abrió por primera vez desde la última vez.
    if (!ue.file) Object.assign(ue, (await unrealInfo(game, hw).catch(() => null)) ?? {});
    if (ue.file) return { kind: "auto", profile: lib.engines.get("unreal"), file: ue.file, format: "flat", processes: ue.processes };
  }

  // Sin perfil: se busca su archivo de configuración y se entienden sus ajustes solos.
  const found = await detected(game, hw);
  if (found) {
    return {
      kind: "detectado",
      profile: {
        ...lib.engines.get("generic"),
        note: "Gamer Config ha encontrado el archivo de configuración de este juego y ha reconocido estos ajustes por su nombre. Solo cambia los que sabe interpretar con seguridad; el resto se muestra abajo para que lo veas.",
        settings: autoSettings(found.entries),
      },
      file: found.file,
      fmt: genericFormat(found.format),
      processes: found.processes,
    };
  }
  if (ue) return { kind: "auto", profile: lib.engines.get("unreal"), file: null, format: "flat", processes: ue.processes };
  return { kind: "guia", profile: lib.engines.get("generic"), file: null, format: null, processes: [] };
}

const detectCache = new Map();
async function detected(game, hw) {
  const hit = detectCache.get(game.id);
  if (hit && Date.now() - hit.at < 60000) return hit.value; // el archivo puede cambiar al jugar: caché corta
  const best = (await findConfigs(game, { docs: hw.docs, steam: await steamPath() }).catch(() => []))[0];
  let value = null;
  if (best) {
    // Ejecutables del juego, para no escribir mientras está abierto.
    const processes = [];
    const walkExe = async (d, depth) => {
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.isFile() && e.name.toLowerCase().endsWith(".exe")) processes.push(e.name);
        else if (e.isDirectory() && depth > 0) await walkExe(path.join(d, e.name), depth - 1);
      }
    };
    if (game.path) await walkExe(game.path, 2);
    value = { ...best, processes };
  }
  detectCache.set(game.id, { at: Date.now(), value });
  return value;
}

// Todos los ajustes del archivo del juego, para enseñarlos tal cual (también los que Gamer Config no toca).
const MAX_ENTRIES = 3000; // archivos enormes (motores) se cortan aquí para no colgar la interfaz

async function readEntries(file) {
  const text = await fs.readFile(file, "utf8").catch(() => null);
  if (text == null) return null;
  const format = detectFormat(text, file);
  if (!format) return null;
  try { return { text, format, entries: parseConfig(text, format) }; } catch { return null; }
}

// Un archivo con todos sus ajustes: clave completa (para escribir), nombre corto (para leer),
// valor, categoría gráfica si se reconoce y opciones posibles si se conocen (sí/no, Bajo/Medio/Alto...).
// Ajuste del perfil (o plantilla) que corresponde a una clave del archivo. El perfil escribe "Seccion.Clave"
// y el lector genérico "Seccion::Clave"; en archivos con secciones que no importan (Warframe) basta el final.
function profileSettingFor(profileSettings, key) {
  if (!profileSettings) return null;
  const dotted = key.replace("::", ".");
  return profileSettings.find((s) => s.key === key || s.key === dotted || key.endsWith(`::${s.key}`)) ?? null;
}

async function fileSettings(file, profileSettings = null) {
  const r = await readEntries(file);
  if (!r) return null;
  const known = new Map(autoSettings(r.entries, { all: true }).map((s) => [s.key, s]));
  const seen = new Set();
  const entries = [];
  for (const e of r.entries) {
    if (seen.has(e.key)) continue; // claves repetidas: se edita la primera, como hace el juego
    seen.add(e.key);
    // El perfil del juego sabe qué significa cada número (p. ej. en LoL, sombras 4 = "Muy altas"): manda sobre lo deducido.
    const ps = profileSettingFor(profileSettings, e.key);
    const k = known.get(e.key);
    const levels = ps?.levels?.length ? ps.levels : k?.sure ? k.levels : null;
    entries.push({
      key: e.key, name: e.key.replace(/^.*::/, ""), value: e.value,
      category: ps?.label ?? k?.label ?? null, sure: ps ? true : k?.sure ?? null,
      options: levels?.length ? levels.map((l) => ({ value: String(l.value), label: l.label ?? String(l.value) })) : null,
    });
  }
  return { file, format: r.format, total: entries.length, entries: entries.slice(0, MAX_ENTRIES) };
}

// Archivos de configuración de vídeo de un juego: el que usa su perfil o plantilla y los que encuentra la búsqueda.
const filesCache = new Map();
async function gameFiles(game, mainFile, hw) {
  const hit = filesCache.get(game.id);
  let list = hit && Date.now() - hit.at < 60000 ? hit.files : null;
  if (!list) {
    // Solo archivos de vídeo/gráficos (los que tienen ajustes gráficos reconocibles): fuera audio, controles, mods...
    const found = await findConfigs(game, { docs: hw.docs, steam: await steamPath() }).catch(() => []);
    list = found.map((f) => f.file);
    filesCache.set(game.id, { at: Date.now(), files: list });
  }
  const all = [mainFile, ...list].filter(Boolean);
  return [...new Map(all.map((f) => [path.normalize(f).toLowerCase(), f])).values()];
}

async function allSettings(game, mainFile, hw, profileSettings) {
  const files = await gameFiles(game, mainFile, hw);
  const main = mainFile && path.normalize(mainFile).toLowerCase();
  return (await Promise.all(files.map((f) => fileSettings(f, path.normalize(f).toLowerCase() === main ? profileSettings : null)))).filter(Boolean);
}

/**
 * Cambios a mano desde la app: [{ key, value }] en uno de los archivos del juego.
 * Igual de seguro que el resto: solo archivos del propio juego, con el juego cerrado y copia antes de escribir.
 */
export async function setValues(game, file, changes) {
  const hw = await hardware();
  const found = await findProfile(game, hw);
  const allowed = await gameFiles(game, found.file, hw);
  if (!allowed.some((f) => path.normalize(f).toLowerCase() === path.normalize(file).toLowerCase())) {
    throw new Error("Ese archivo no es de este juego.");
  }
  if (!Array.isArray(changes) || changes.length === 0) return "No había cambios.";
  if (changes.some((c) => typeof c.key !== "string" || typeof c.value !== "string" || /[\r\n]/.test(c.value))) {
    throw new Error("Algún valor no es válido (no puede tener saltos de línea).");
  }
  const procs = await runningProcesses();
  if (found.processes.some((x) => procs.has(x.toLowerCase()))) throw new Error(`Cierra ${game.name} antes de guardar los cambios.`);

  const r = await readEntries(file);
  if (!r) throw new Error("No se pudo leer el archivo.");
  let text = r.text;
  const failed = [];
  for (const c of changes) {
    const next = writeConfig(text, r.format, c.key, c.value);
    if (next == null) failed.push(c.key); else text = next;
  }
  if (failed.length === changes.length) throw new Error("No se pudo escribir ningún cambio.");

  await fs.mkdir(userDir("backups"), { recursive: true });
  const ext = path.extname(file);
  const base = `${safeId(game.id)}-${safeId(path.basename(file, ext))}`;
  const original = userDir("backups", `${base}-original${ext}`);
  if (!existsSync(original)) await fs.writeFile(original, r.text);
  const backup = userDir("backups", `${base}-${Date.now()}${ext}`);
  await fs.writeFile(backup, r.text);
  await fs.writeFile(file, text);

  // Comprobación: se relee el archivo y se mira que cada valor quedó como se pidió.
  const after = await readEntries(file);
  const bad = changes.filter((c) => !failed.includes(c.key) && after?.entries.find((e) => e.key === c.key)?.value !== c.value);
  const ok = changes.length - failed.length - bad.length;
  await record(`${game.name}: ${ok} ${ok === 1 ? "ajuste cambiado" : "ajustes cambiados"} a mano (${path.basename(file)})`, { type: "file", path: file, backup });
  cache = null;
  if (failed.length || bad.length) return `Guardados ${ok} de ${changes.length}. No se pudieron cambiar: ${[...failed, ...bad.map((b) => b.key)].join(", ")}.`;
  return `${ok} ${ok === 1 ? "ajuste guardado" : "ajustes guardados"} en ${path.basename(file)} y comprobado${ok === 1 ? "" : "s"}.`;
}

/* ---------- Formatos de archivo ---------- */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Cada formato sabe leer un valor y escribirlo devolviendo el texto nuevo (null = no se pudo).
const FORMATS = {
  // [Seccion] Clave=Valor  (clave en el perfil: "Seccion.Clave")
  ini: {
    find(text, key) {
      const [sec, k] = [key.slice(0, key.indexOf(".")), key.slice(key.indexOf(".") + 1)];
      const s = text.search(new RegExp(`^\\[${esc(sec)}\\][ \\t]*$`, "mi"));
      if (s === -1) return { sec, k, s: -1 };
      const next = text.slice(s + 1).search(/^\[/m);
      const end = next === -1 ? text.length : s + 1 + next;
      const m = new RegExp(`^${esc(k)}=(.*)$`, "m").exec(text.slice(s, end));
      return { sec, k, s, end, m, at: m ? s + m.index : -1 };
    },
    read(text, key) {
      return this.find(text, key).m?.[1].trim() ?? null;
    },
    write(text, key, value, nl) {
      const f = this.find(text, key);
      if (f.m) return text.slice(0, f.at) + `${f.k}=${value}` + text.slice(f.at + f.m[0].length);
      if (f.s !== -1) {
        const lineEnd = text.indexOf("\n", f.s) + 1 || text.length;
        return text.slice(0, lineEnd) + `${f.k}=${value}${nl}` + text.slice(lineEnd);
      }
      return `${text.trimEnd()}${nl}${nl}[${f.sec}]${nl}${f.k}=${value}${nl}`;
    },
  },
  // Clave=Valor sin secciones que importen (Warframe, Unreal). Si falta, no se añade.
  flat: {
    read: (text, key) => new RegExp(`^${esc(key)}=(.*)$`, "m").exec(text)?.[1].trim() ?? null,
    write: (text, key, value) => {
      const re = new RegExp(`^${esc(key)}=.*$`, "m");
      return re.test(text) ? text.replace(re, `${key}=${value}`) : null;
    },
  },
  // "clave"   "valor"  (formato KeyValues de Valve/Source)
  kv: {
    read: (text, key) => new RegExp(`"${esc(key)}"\\s+"(.*?)"`).exec(text)?.[1] ?? null,
    write: (text, key, value, nl) => {
      const re = new RegExp(`("${esc(key)}"\\s+")(.*?)(")`);
      if (re.test(text)) return text.replace(re, (_, a, __, c) => `${a}${value}${c}`);
      const close = text.lastIndexOf("}");
      return close === -1 ? null : `${text.slice(0, close)}\t"${key}"\t\t"${value}"${nl}${text.slice(close)}`;
    },
  },
  // Nombre(valor)  (Chrome Engine / Dying Light). Las líneas con "!" son comentarios.
  scr: {
    read: (text, key) => new RegExp(`^${esc(key)}\\((.*)\\)[ \\t]*$`, "m").exec(text)?.[1].trim() ?? null,
    write: (text, key, value, nl) => {
      const re = new RegExp(`^${esc(key)}\\(.*\\)[ \\t]*$`, "m");
      if (re.test(text)) return text.replace(re, `${key}(${value})`);
      const v = text.search(/^Version\(/m);
      return v === -1 ? `${text.trimEnd()}${nl}${key}(${value})${nl}` : `${text.slice(0, v)}${key}(${value})${nl}${text.slice(v)}`;
    },
  },
};

const norm = (v) => String(v ?? "").replace(/\s+/g, "").replace(/^"|"$/g, "").toLowerCase();
function same(a, b) {
  const [x, y] = [norm(a), norm(b)];
  if (x === y) return true;
  const [nx, ny] = [Number(x), Number(y)];
  return x !== "" && y !== "" && !Number.isNaN(nx) && !Number.isNaN(ny) && Math.abs(nx - ny) < 0.5;
}
const labelOf = (s, v) => (v == null ? "No definido" : s.levels.find((l) => same(l.value, v))?.label ?? String(v).replace(/^"|"$/g, ""));

/* ---------- Plan: cálculo + lo que hay ahora en el archivo ---------- */

async function plan(game, goal) {
  const hw = await hardware();
  const found = await findProfile(game, hw);
  const { profile } = found;
  const [demand, power] = await Promise.all([
    demandFor(game, profile).catch(() => ({ gpu: null, cpu: null })),
    powerNow(),
  ]);
  const ctx = { onBattery: power.onBattery, plan: power.plan, gameDrive: game.path?.match(/^([a-z]):/i)?.[1].toUpperCase() ?? null };
  const f = factors(hw, demand, ctx);
  // Sin gráfica en los requisitos pero sí procesador: un juego que pide un procesador antiguo no pide una gráfica actual.
  const gpuFromCpu = demand.cpu ? Math.min(Math.max(Math.round(demand.cpu.score * 0.6), 5), DEFAULT_GPU) : null;
  const scores = { gpu: demand.gpu?.score ?? gpuFromCpu ?? DEFAULT_GPU, cpu: demand.cpu?.score ?? DEFAULT_CPU };
  // Texturas en juegos sin perfil propio: cuanto más exigente es el juego, más memoria piden sus texturas altas.
  // (Los perfiles ya traen la memoria exacta que necesita cada nivel.)
  const vramScale = found.kind === "perfil" ? 1
    : Math.max(Math.min(Math.sqrt(scores.gpu / 50), 2), 0.8, demand.vramGb ? demand.vramGb / 5 : 0);
  const result = solve(profile.settings, hw, scores, goal, f, { vramScale });
  result.factors = f.list;

  const text = found.file ? await fs.readFile(found.file, "utf8").catch(() => null) : null;
  const fmt = found.fmt ?? (found.format ? FORMATS[found.format] : null);
  const settings = profile.settings
    .filter((s) => result.picks.has(s.key))
    .map((s) => {
      const rec = result.picks.get(s.key);
      const current = text != null && fmt ? fmt.read(text, s.key) : null;
      return { s, recommended: rec.value, recLabel: rec.label, current, change: current != null && !same(current, rec.value) };
    })
    // En perfiles automáticos solo se muestran los ajustes que el juego tiene de verdad.
    .filter((x) => (found.kind !== "auto" && found.kind !== "detectado") || text == null || x.current != null);

  return { ...found, hw, demand, result, text, fmt, settings };
}

/* ---------- Estado, detalle y aplicar ---------- */

const appliedFile = () => userDir("applied.json");
const readApplied = async () => JSON.parse(await fs.readFile(appliedFile(), "utf8").catch(() => "{}"));

// Para la lista de juegos (rápido: sin consultar requisitos).
export async function status(game) {
  const hw = await hardware();
  const found = await findProfile(game, hw);
  if (found.kind === "guia") return "guía";
  const goal = (await readApplied())[game.id];
  if (!goal) return "optimizable";
  const p = await plan(game, goal);
  return p.text != null && p.settings.every((x) => !x.change) ? "optimizado" : "optimizable";
}

export async function detail(game, goal) {
  const p = await plan(game, goal);
  const backups = await fs.readdir(userDir("backups")).catch(() => []);
  return {
    kind: p.kind, // "perfil" | "auto" | "detectado" | "guia"
    files: await allSettings(game, p.file, p.hw, p.kind === "perfil" || p.kind === "auto" ? p.profile.settings : null),
    note: p.profile.note ?? null,
    sources: p.profile.sources ?? [],
    gpu: { name: p.hw.gpu, score: p.hw.score, demand: p.demand.gpu, fps: p.result.gpuFps },
    cpu: { name: p.hw.cpu, score: p.hw.cpuScore, demand: p.demand.cpu, fps: p.result.cpuFps },
    factors: p.result.factors,
    bottleneck: p.result.bottleneck,
    estMax: p.result.estMax,
    estFinal: p.result.estFinal,
    target: p.result.target,
    reached: p.result.reached,
    loweredNothing: p.result.loweredNothing,
    canApply: p.kind !== "guia",
    configFound: p.text != null,
    hasBackup: backups.some((b) => b.startsWith(`${safeId(game.id)}-original`)),
    settings: p.settings.map((x) => ({
      name: x.s.label, key: x.s.auto ? x.s.key.replace(/^.*::/, "") : null, why: x.s.why, change: x.change,
      current: p.kind === "guia" ? null : labelOf(x.s, x.current), recommended: x.recLabel,
    })),
  };
}

const safeId = (id) => id.replace(/[^a-z0-9._-]/gi, "_");

async function runningProcesses() {
  const { stdout } = await run("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true });
  return new Set([...stdout.matchAll(/^"([^"]+)"/gm)].map((m) => m[1].toLowerCase()));
}

function rewrite(p) {
  const nl = p.text.includes("\r\n") ? "\r\n" : "\n";
  let text = p.text;
  let changed = 0;
  for (const x of p.settings.filter((x) => x.change)) {
    const next = p.fmt.write(text, x.s.key, x.recommended, nl);
    if (next != null) { text = next; changed++; }
  }
  return { text, changed };
}

export async function apply(game, goal) {
  const p = await plan(game, goal);
  if (p.kind === "guia") throw new Error("Este juego no se puede configurar automáticamente: sigue la guía en su menú de gráficos.");
  if (p.text == null) throw new Error("No se encontró el archivo de configuración. Abre el juego una vez, ciérralo y vuelve a intentarlo.");
  const procs = await runningProcesses();
  if (p.processes.some((x) => procs.has(x.toLowerCase()))) throw new Error(`Cierra ${game.name} antes de aplicar los cambios.`);

  const { text, changed } = rewrite(p);
  if (changed === 0) return "Ya estaba optimizado para este objetivo.";

  // Copia de seguridad: la primera vez se guarda la original y no se pisa nunca; además una por cada cambio.
  await fs.mkdir(userDir("backups"), { recursive: true });
  const ext = path.extname(p.file);
  const original = userDir("backups", `${safeId(game.id)}-original${ext}`);
  if (!existsSync(original)) await fs.writeFile(original, p.text);
  const backup = userDir("backups", `${safeId(game.id)}-${Date.now()}${ext}`);
  await fs.writeFile(backup, p.text);

  await fs.writeFile(p.file, text);
  const applied = await readApplied();
  applied[game.id] = goal;
  await fs.writeFile(appliedFile(), JSON.stringify(applied));
  const goalName = { fps: "más FPS", equilibrado: "equilibrado", calidad: "calidad" }[goal];
  await record(`${game.name}: ${changed} ajustes (${goalName})`, { type: "file", path: p.file, backup });
  return `${changed} ajustes aplicados en ${game.name}.`;
}

export async function restoreOriginal(game) {
  const p = await plan(game, "equilibrado");
  const files = await fs.readdir(userDir("backups")).catch(() => []);
  const orig = files.find((f) => f.startsWith(`${safeId(game.id)}-original`));
  if (!orig || !p.file) throw new Error("No hay copia original de este juego.");
  await fs.copyFile(userDir("backups", orig), p.file);
  const applied = await readApplied();
  delete applied[game.id];
  await fs.writeFile(appliedFile(), JSON.stringify(applied));
  await record(`${game.name}: configuración original restaurada`, null);
  return `Se restauró la configuración original de ${game.name}.`;
}

// Para la comprobación (npm test): calcula y aplica en memoria, sin escribir nada, y relee cada valor.
export async function dryRun(game, goal) {
  const p = await plan(game, goal);
  const base = { kind: p.kind, estMax: p.result.estMax, estFinal: p.result.estFinal, target: p.result.target, demand: p.demand, bottleneck: p.result.bottleneck, factors: p.result.factors };
  if (p.kind === "guia" || p.text == null) return { ...base, changed: 0, failed: [], linesBefore: 0, linesAfter: 0, noFile: true };
  const { text, changed } = rewrite(p);
  const failed = p.settings.filter((x) => x.current != null && !same(p.fmt.read(text, x.s.key), x.recommended)).map((x) => x.s.key);
  return { ...base, changed, failed, linesBefore: p.text.split(/\r?\n/).length, linesAfter: text.split(/\r?\n/).length };
}
