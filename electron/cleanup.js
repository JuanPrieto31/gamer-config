// Limpieza de basura que dejan las actualizaciones de los juegos (versiones viejas, parches a medias).
//  - detectUpdates: compara la versión instalada de cada juego con la que se vio la última vez.
//  - scan: lista lo que se puede borrar de un juego y cuánto ocupa (no toca nada).
//  - clean: lo borra.
// Solo se borra lo que está en la lista de abajo (datos de descarga y versiones anteriores que el juego
// o su lanzador vuelven a bajar si hacen falta). Nunca partidas, ajustes, mods ni archivos del juego actual.
import { app } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const run = promisify(execFile);
const stateFile = () => path.join(app.getPath("userData"), "versiones.json");
const logFile = () => path.join(app.getPath("userData"), "limpieza.json");
const STALE_DAYS = 3; // archivos temporales: solo si llevan unos días sin tocarse

/* ---------- Versiones ---------- */

let versions = null;
async function loadVersions() {
  versions ??= JSON.parse(await fs.readFile(stateFile(), "utf8").catch(() => "{}"));
  return versions;
}

// _pending: juegos que se actualizaron y aún no se han podido limpiar (abiertos, Steam descargando...).
/**
 * Anota los juegos cuya versión cambió desde la última vez. La primera vez que se ve un juego solo se
 * anota (no hay con qué comparar); un juego sin versión conocida nunca se marca como actualizado.
 */
export const detectUpdates = (games) => serial(() => detectNow(games));
async function detectNow(games) {
  const v = await loadVersions();
  const pending = new Set(v._pending ?? []);
  for (const g of games) {
    if (!g.version) continue;
    if (v[g.id] && v[g.id] !== g.version) pending.add(g.id);
    v[g.id] = g.version;
  }
  v._pending = [...pending];
  await fs.writeFile(stateFile(), JSON.stringify(v)).catch(() => {});
}

/**
 * Limpia (o solo mide, si la limpieza automática está apagada) los juegos actualizados que estén listos.
 * Devuelve [{ id, name, freed, removed, available }]. Los que siguen bloqueados se reintentan la próxima vez.
 */
export const processUpdated = (games) => serial(() => processNow(games));
async function processNow(games) {
  const v = await loadVersions();
  const results = [];
  const still = [];
  for (const id of v._pending ?? []) {
    const g = games.find((x) => x.id === id);
    if (!g) continue; // desinstalado
    const { items, blocked } = await scan(g).catch(() => ({ items: [], blocked: "error" }));
    if (blocked) { still.push(id); continue; }
    const available = items.reduce((n, i) => n + i.bytes, 0);
    if (!items.length) continue;
    if (getSettings().auto) {
      const done = await cleanNow(g, items);
      if (!done.removed) { still.push(id); continue; } // en uso: se reintenta, sin avisar de algo que no pasó
      results.push({ id, name: g.name, ...done, available });
    } else results.push({ id, name: g.name, freed: 0, removed: 0, available });
  }
  v._pending = still;
  await fs.writeFile(stateFile(), JSON.stringify(v)).catch(() => {});
  return results;
}

/* ---------- Ajustes ---------- */

const settingsFile = () => path.join(app.getPath("userData"), "limpieza-ajustes.json");
let settings = null;
export function getSettings() {
  if (!settings) {
    try { settings = { auto: JSON.parse(readFileSync(settingsFile(), "utf8")).auto !== false }; } catch { settings = { auto: true }; }
  }
  return settings;
}
export function setSettings(patch) {
  settings = { auto: patch?.auto !== false };
  try { writeFileSync(settingsFile(), JSON.stringify(settings)); } catch { /* sin permiso: queda solo en memoria */ }
  return settings;
}

/* ---------- Qué se considera basura ---------- */

const TEMP_FILE = /\.(tmp|part|partial)$/i;
// Carpetas del jugador que la limpieza de temporales no recorre (partidas, mods, ajustes).
const USER_DIR = /^(saves?|savegames?|mods?|config|configs|userdata|profiles?|screenshots?|backups?|custom|workshop)$/i;
const exists = (p) => fs.lstat(p).then(() => true, () => false);

// Procesos en marcha dentro de la carpeta del juego: si está abierto, no se toca nada.
async function runningIn(dir) {
  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | ForEach-Object { $_.ExecutablePath }"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const root = dir.toLowerCase().replace(/[\\/]+$/, "") + "\\";
    return stdout.split(/\r?\n/).some((l) => l.trim().toLowerCase().startsWith(root));
  } catch { return true; } // sin poder comprobarlo, mejor no borrar
}

async function processRunning(exe) {
  try {
    const { stdout } = await run("tasklist", ["/FI", `IMAGENAME eq ${exe}`, "/NH"], { windowsHide: true, timeout: 15000 });
    return stdout.toLowerCase().includes(exe.toLowerCase());
  } catch { return true; }
}

// Tamaño de una carpeta o archivo (sin seguir enlaces). Con tope para no recorrer discos enteros.
async function sizeOf(p, budget = { n: 200000 }) {
  const st = await fs.lstat(p).catch(() => null);
  if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of await fs.readdir(p, { withFileTypes: true }).catch(() => [])) {
    if (budget.n-- <= 0) break;
    const f = path.join(p, e.name);
    total += e.isDirectory() && !e.isSymbolicLink() ? await sizeOf(f, budget) : (await fs.lstat(f).catch(() => null))?.size ?? 0;
  }
  return total;
}

// Archivos temporales sueltos (.tmp, .part...) con días sin tocarse, en la carpeta del juego (hasta 3 niveles).
async function staleTemps(root, depth = 3, out = [], budget = { n: 20000 }) {
  if (depth < 0) return out;
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (budget.n-- <= 0) break;
    const f = path.join(root, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!USER_DIR.test(e.name)) await staleTemps(f, depth - 1, out, budget); }
    else if (TEMP_FILE.test(e.name)) {
      const st = await fs.lstat(f).catch(() => null);
      if (st && Date.now() - st.mtimeMs > STALE_DAYS * 864e5) out.push(f);
    }
  }
  return out;
}

// Carpetas que nunca pueden ser "la carpeta de un juego": raíces de unidad y carpetas que agrupan muchos programas.
const SHARED_DIR = /^(common|steamapps|program files|program files \(x86\)|xboxgames|games|windows|users|programdata|appdata|local|roaming)$/i;
function genericPath(p) {
  const abs = path.resolve(p);
  return path.dirname(abs) === abs || SHARED_DIR.test(path.basename(abs)) || abs.split(path.sep).filter(Boolean).length < 2;
}

const newestMtime = async (dir) => {
  let newest = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const st = await fs.lstat(path.join(dir, e.name)).catch(() => null);
    if (st) newest = Math.max(newest, st.mtimeMs);
  }
  return newest;
};

// Por qué NO se puede limpiar ahora (null = se puede). Se usa antes de medir y otra vez antes de borrar.
async function blockedReason(game) {
  if (!game.path || genericPath(game.path)) return "La carpeta del juego no está clara: no se toca nada.";
  if (await runningIn(game.path)) return "El juego está abierto: ciérralo para limpiar.";
  if (game.store === "Steam" && game.library) {
    const id = game.id.replace(/^steam-/, "");
    const acf = await fs.readFile(path.join(game.library, `appmanifest_${id}.acf`), "utf8").catch(() => "");
    // StateFlags 4 = instalado del todo. Si es otra cosa, Steam está actualizando y esas carpetas se están usando.
    if (Number(acf.match(/"StateFlags"\s+"(\d+)"/)?.[1]) !== 4) return "Steam está actualizando este juego: se limpia cuando termine.";
    // Un parche encolado puede empezar justo ahora: si la descarga se tocó hace minutos, se espera.
    if (Date.now() - (await newestMtime(path.join(game.library, "downloading", id))) < 10 * 60 * 1000) return "Steam descargó algo hace poco: se limpia más tarde.";
  }
  // El lanzador puede estar bajando un parche de este juego; con él cerrado no hay riesgo.
  if (game.store === "Epic" && (await processRunning("EpicGamesLauncher.exe"))) return "Cierra el lanzador de Epic Games para limpiar sin riesgo.";
  if (game.store === "Riot" && ((await processRunning("RiotClientServices.exe")) || (await processRunning("RiotClientUx.exe")))) return "Cierra el cliente de Riot para limpiar sin riesgo.";
  return null;
}

// Una sola operación a la vez sobre los archivos de estado y los borrados (evita pisarse entre el vigilante y los botones).
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

// La ruta debe quedar DENTRO de la carpeta permitida (y no ser ella misma): ninguna regla puede salirse del juego.
function safe(p, root) {
  if (!p || !root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(p));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Lista lo que se puede borrar de un juego: [{ path, bytes, why }]. No borra nada.
 * Los archivos temporales sueltos (.tmp, .part...) solo se ofrecen en la limpieza manual, donde el usuario confirma.
 * Devuelve { items, blocked }: blocked explica por qué no se ofrece nada (juego abierto, actualizándose...).
 */
export async function scan(game, { manual = false } = {}) {
  if (!game.path || !(await exists(game.path))) return { items: [], blocked: null };
  const blocked = await blockedReason(game);
  if (blocked) return { items: [], blocked };

  const cand = []; // { path, why, root }
  const add = (p, why, root) => cand.push({ path: p, why, root });

  if (game.store === "Steam" && game.library) {
    const id = game.id.replace(/^steam-/, "");
    add(path.join(game.library, "downloading", id), "Descarga de actualización a medias", game.library);
    add(path.join(game.library, "temp", id), "Archivos temporales de actualización", game.library);
  }
  if (game.store === "Epic") {
    add(path.join(game.path, ".egstore", "bps"), "Parches ya aplicados (Epic)", game.path);
    add(path.join(game.path, ".egstore", "Pending"), "Actualización pendiente descartada (Epic)", game.path);
  }
  if (game.store === "Riot") add(path.join(game.path, "Logs"), "Registros antiguos", game.path);
  if (game.store === "Roblox" && game.version) {
    // Cada actualización del jugador deja la carpeta de la versión anterior en Versions\. Solo las que tienen
    // el ejecutable del jugador (las demás, como Roblox Studio, son otro programa) y siempre se conservan las dos
    // más recientes: así, aunque la "actual" se detectara mal, no se borra la que Roblox está usando.
    const dir = path.join(game.path, "Versions");
    const players = [];
    for (const v of await fs.readdir(dir).catch(() => [])) {
      const st = /^version-/i.test(v) ? await fs.stat(path.join(dir, v, "RobloxPlayerBeta.exe")).catch(() => null) : null;
      if (st) players.push({ v, mtime: st.mtimeMs });
    }
    for (const { v } of players.sort((a, b) => b.mtime - a.mtime).slice(2)) {
      if (v !== game.version) add(path.join(dir, v), "Versión anterior de Roblox", game.path);
    }
  }
  if (manual) for (const f of await staleTemps(game.path)) add(f, "Archivo temporal sin usar", game.path);

  const items = [];
  for (const c of cand) {
    if (!safe(c.path, c.root) || !(await exists(c.path))) continue;
    const bytes = await sizeOf(c.path);
    if (bytes > 0) items.push({ path: c.path, bytes, why: c.why, root: c.root });
  }
  return { items, blocked: null };
}

/**
 * Borra lo que devolvió scan(). Entre medir y borrar pasan segundos (el juego se pudo abrir, Steam pudo empezar un parche),
 * así que se repiten las comprobaciones de estado y la de cada ruta justo antes de borrarla.
 */
export const clean = (game, items) => serial(() => cleanNow(game, items));

async function cleanNow(game, items) {
  let freed = 0;
  let removed = 0;
  if (await blockedReason(game)) return { removed, freed };
  const realRoots = new Map();
  for (const it of items) {
    if (!safe(it.path, it.root)) continue;
    const st = await fs.lstat(it.path).catch(() => null);
    if (!st || st.isSymbolicLink()) continue; // enlaces: nunca (podrían apuntar fuera del juego)
    // Ninguna carpeta intermedia puede ser un enlace que lleve fuera de la raíz permitida.
    if (!realRoots.has(it.root)) realRoots.set(it.root, await fs.realpath(it.root).catch(() => null));
    const real = await fs.realpath(it.path).catch(() => null);
    if (!real || !realRoots.get(it.root) || !safe(real, realRoots.get(it.root))) continue;
    try {
      await fs.rm(it.path, { recursive: true, force: true });
      if (!(await exists(it.path))) { freed += it.bytes; removed++; }
    } catch { /* en uso: se queda para la próxima */ }
  }
  if (removed) await log({ at: Date.now(), game: game.name, removed, freed });
  return { removed, freed };
}

async function log(entry) {
  const list = JSON.parse(await fs.readFile(logFile(), "utf8").catch(() => "[]"));
  list.unshift(entry);
  await fs.writeFile(logFile(), JSON.stringify(list.slice(0, 100))).catch(() => {});
}

export const history = async () => JSON.parse(await fs.readFile(logFile(), "utf8").catch(() => "[]"));
