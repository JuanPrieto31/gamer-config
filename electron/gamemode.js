// Modo juego automático: al abrir un juego, plan de máximo rendimiento y se cierran los programas elegidos;
// al cerrarlo, todo vuelve a como estaba. Solo mira la lista de procesos cada 5 s (tasklist): no gasta nada.
import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setPerformancePlan, setPlan } from "./windows.js";

const run = promisify(execFile);
const opts = { windowsHide: true };

/* ---------- Ajustes ---------- */

// measure: medir los FPS de cada partida sin mostrar las estadísticas (para calibrar); autoTune: ajustar solo tras la partida.
// Las dos van aparte de "enabled": se puede medir sin cambiar el plan de energía ni cerrar programas.
const DEFAULTS = { enabled: false, power: true, closeApps: [], reopen: true, overlay: false, measure: false, autoTune: false };
// Nunca se cierran procesos de Windows ni la propia app, aunque lleguen en la lista.
const PROTECTED = /^(explorer|svchost|csrss|winlogon|wininit|services|lsass|smss|dwm|system|registry|fontdrvhost|sihost|ctfmon|taskhostw|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost|textinputhost|securityhealthsystray|taskmgr|conhost|audiodg|gamer config|electron|steam|steamwebhelper|epicwebhelper|epicgameslauncher|riotclientservices|riotclientux|nvidia overlay|nvcontainer|nvidia share|amdrsserv|radeonsoftware)\.exe$/i;
const file = () => path.join(app.getPath("userData"), "gamemode.json");

let settings = null;
export function getSettings() {
  if (!settings) {
    try { settings = sanitize(JSON.parse(readFileSync(file(), "utf8"))); } catch { settings = structuredClone(DEFAULTS); }
  }
  return settings;
}

function sanitize(s) {
  const out = structuredClone(DEFAULTS);
  for (const k of ["enabled", "power", "reopen", "overlay", "measure", "autoTune"]) if (typeof s?.[k] === "boolean") out[k] = s[k];
  if (!out.measure) out.autoTune = false; // "Ajustar solo" depende de medir: no se queda activado y escondido
  if (Array.isArray(s?.closeApps)) {
    out.closeApps = [...new Set(s.closeApps.filter((n) => typeof n === "string" && /^[\w .()&+-]{1,80}\.exe$/i.test(n) && !PROTECTED.test(n)).map((n) => n.toLowerCase()))].slice(0, 20);
  }
  return out;
}

export function setSettings(patch) {
  settings = sanitize({ ...getSettings(), ...patch });
  writeFileSync(file(), JSON.stringify(settings));
  restartWatch();
  // Cambios con una partida en curso: la medición sigue lo que diga el ajuste ya, y si se enciende el modo juego
  // cuando solo se estaba midiendo, se suelta la partida para que el siguiente vistazo la active entera (plan, programas).
  serial(async () => {
    if (!active) return;
    if (active.onlyMeasure && settings.enabled) { await deactivate(); return; } // se para la medición antes de soltarla
    onMeasure(settings.measure);
  });
  return settings;
}

/* ---------- Qué ejecutables son juegos ---------- */

// Ejecutables que no son el juego (instaladores, informes de fallos, lanzadores auxiliares...).
const NOT_GAME = /unins|crash|setup|redist|vc_?redist|dxsetup|helper|report|updater|install|cefprocess|easyanticheat|battleye|beservice|_be\.exe|launcher|prereq|dotnet|ue4prereq|benchmark|config|client|anticheat|vanguard|overlay/i;
export let index = new Map(); // exe en minúsculas → { name, dir } del juego

// ponytail: como mucho 300 carpetas por juego; los ejecutables del juego suelen estar en los primeros niveles.
async function exesIn(dir, depth = 3, out = [], seen = { n: 0 }) {
  if (!dir || depth < 0 || out.length > 200 || ++seen.n > 300) return out;
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isFile() && /\.exe$/i.test(e.name) && !NOT_GAME.test(e.name)) out.push(e.name.toLowerCase());
    else if (e.isDirectory() && !/^(redist|_commonredist|directx|support|installers?|__installer|engine)$/i.test(e.name)) await exesIn(path.join(dir, e.name), depth - 1, out, seen);
  }
  return out;
}

/** games: [{ name, path, processes? }] — se llama cada vez que cambia la lista de juegos. */
export async function setGames(games) {
  const next = new Map();
  for (const g of games) {
    const dir = g.path ? path.resolve(g.path).toLowerCase() : null;
    for (const exe of [...(g.processes ?? []).map((p) => p.toLowerCase()), ...(await exesIn(g.path))]) next.set(exe, { name: g.name, dir });
  }
  index = next;
}

/* ---------- Vigilancia ---------- */

let timer = null;
let active = null; // { game, exe, prevPlan, closed: [{ name, path }] }
let notify = () => {};
let onOverlay = () => {};
let onMeasure = () => {};
// Si la app se cierra de golpe (o se apaga el PC) a mitad de partida, al volver a abrirla se restaura lo que quedó cambiado.
const stateFile = () => path.join(app.getPath("userData"), "gamemode-activo.json");

// Activar y desactivar nunca se solapan: van en cola.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn).catch(() => {}));

export function init({ notify: n, overlay, measure }) {
  notify = n;
  onOverlay = overlay;
  onMeasure = measure ?? onMeasure;
  try {
    active = JSON.parse(readFileSync(stateFile(), "utf8"));
    serial(() => deactivate(true));
  } catch { /* no quedó nada pendiente */ }
  restartWatch();
}

function restartWatch() {
  clearInterval(timer);
  const { enabled, measure } = getSettings();
  timer = enabled || measure ? setInterval(tick, 5000) : null;
  // Al apagar el modo juego se restaura todo al momento; si se sigue midiendo, el siguiente vistazo retoma la partida solo para medir.
  if (!enabled && !(active?.onlyMeasure && measure)) serial(() => deactivate());
}

export const status = () => ({ active: active ? active.game : null });

async function running() {
  const { stdout } = await run("tasklist", ["/FO", "CSV", "/NH"], opts).catch(() => ({ stdout: "" }));
  return new Set([...stdout.matchAll(/^"([^"]+)"/gm)].map((m) => m[1].toLowerCase()));
}

const psName = (exe) => exe.replace(/\.exe$/i, "").replace(/'/g, "''");
async function pathOf(exe) {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `(Get-Process -Name '${psName(exe)}' -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1).Path`], opts).catch(() => ({ stdout: "" }));
  return stdout.trim() || null;
}

let busy = false;
function tick() {
  if (busy) return;
  busy = true;
  serial(async () => {
    const procs = await running();
    if (active) {
      if (!procs.has(active.exe)) await deactivate();
      return;
    }
    for (const exe of [...procs].filter((p) => index.has(p))) {
      // Un programa con el mismo nombre que un juego no cuenta: tiene que estar dentro de la carpeta del juego.
      const g = index.get(exe);
      const p = g.dir ? (await pathOf(exe))?.toLowerCase() : null;
      if (g.dir && !(p && p.startsWith(g.dir))) continue;
      await activate(g.name, exe, procs);
      return;
    }
  }).finally(() => { busy = false; });
}

async function activate(game, exe, procs) {
  const s = getSettings();
  const a = { game, exe, prevPlan: null, closed: [] };
  active = a;
  const done = [];
  if (s.measure) onMeasure(true);
  // Solo medir (modo juego apagado): no se toca nada más ni se avisa.
  if (!s.enabled) { a.onlyMeasure = true; writeFileSync(stateFile(), JSON.stringify(a)); return; }
  if (s.power) {
    const r = await setPerformancePlan().catch(() => null);
    if (r && r.prev?.guid !== r.target.guid) { a.prevPlan = r.prev?.guid ?? null; done.push(`plan «${r.target.name}»`); }
  }
  for (const name of s.closeApps.filter((n) => procs.has(n))) {
    // Se guarda la ruta antes de cerrarlo para poder volver a abrirlo al terminar.
    // ponytail: si hay dos programas distintos con el mismo nombre, se reabre solo uno.
    const p = await pathOf(name);
    await run("taskkill", ["/IM", name, "/T", "/F"], opts).catch(() => {});
    a.closed.push({ name, path: p });
  }
  writeFileSync(stateFile(), JSON.stringify(a));
  if (a.closed.length) done.push(`cerrados: ${a.closed.map((c) => c.name.replace(/\.exe$/i, "")).join(", ")}`);
  if (s.overlay) onOverlay(true);
  notify(`Modo juego: ${game}`, done.length ? `Activado (${done.join(" · ")}).` : "Activado.");
}

async function deactivate(recovered = false) {
  const a = active;
  active = null;
  if (!a) return;
  onMeasure(false); // fin de la partida: se calcula con lo medido
  if (a.onlyMeasure) { rmSync(stateFile(), { force: true }); return; } // no se cambió nada: nada que restaurar ni avisar
  if (a.prevPlan) await setPlan(a.prevPlan).catch(() => {});
  if (getSettings().reopen) {
    for (const c of a.closed.filter((c) => c.path)) spawn(c.path, [], { detached: true, stdio: "ignore", windowsHide: false }).on("error", () => {}).unref();
  }
  rmSync(stateFile(), { force: true });
  if (getSettings().overlay && !recovered) onOverlay(false);
  notify(`Modo juego: ${a.game}`, recovered ? "La última partida no se cerró bien: se restauró el plan de energía y los programas." : "Juego cerrado: todo vuelve a como estaba.");
}

/** Programas con ventana abiertos ahora (para elegir cuáles cerrar al jugar). */
export async function openApps() {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path } | Sort-Object Name -Unique | ForEach-Object { [pscustomobject]@{ exe = $_.Name + '.exe'; title = [string]$_.Description } }) | ConvertTo-Json -Compress"], opts).catch(() => ({ stdout: "[]" }));
  const list = JSON.parse(stdout.trim() || "[]");
  return (Array.isArray(list) ? list : [list]).filter((a) => !PROTECTED.test(a.exe) && !index.has(a.exe.toLowerCase()))
    .map((a) => ({ exe: a.exe.toLowerCase(), title: a.title || a.exe.replace(/\.exe$/i, "") }));
}

/** Al salir de la app con un juego abierto: se restaura todo antes de cerrar (main.js lo espera). */
export function shutdown() {
  clearInterval(timer);
  return serial(() => deactivate());
}
