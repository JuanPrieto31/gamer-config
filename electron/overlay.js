// Estadísticas en el juego: una ventana transparente encima de todo, a la que no se le puede hacer clic.
// No toca el juego (nada de inyectar código): es seguro con los antitrampas. Solo se ve en pantalla completa
// "sin bordes" o en ventana; en pantalla completa exclusiva Windows no deja pintar encima.
// Para gastar lo mínimo, solo se mide mientras las estadísticas están visibles.
import { app, BrowserWindow, globalShortcut, screen } from "electron";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { elevated, record } from "./windows.js";

const run = promisify(execFile);
const dir = path.dirname(fileURLToPath(import.meta.url));
// En el instalador, los .exe no pueden ejecutarse desde dentro del asar: van desempaquetados.
const PRESENTMON = path.join(dir, "../vendor/PresentMon.exe").replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const SESSION = "GamerConfigFPS";

/* ---------- Ajustes ---------- */

const METRICS = ["fps", "low1", "frametime", "gpu", "gpuTemp", "vram", "gpuClock", "gpuPower", "cpu", "ram"];
const HOTKEYS = ["Alt+Shift+O", "Ctrl+Shift+F10", "Alt+F12", "Ctrl+Alt+S"];
const DEFAULTS = {
  metrics: { fps: true, low1: true, frametime: false, gpu: true, gpuTemp: true, vram: true, gpuClock: false, gpuPower: false, cpu: true, ram: true },
  position: "tl", size: "m", opacity: 0.55, hotkey: HOTKEYS[0], background: true,
};
const file = () => path.join(app.getPath("userData"), "overlay.json");

let settings = null;
export function getSettings() {
  if (!settings) {
    try { settings = sanitize(JSON.parse(readFileSync(file(), "utf8"))); } catch { settings = structuredClone(DEFAULTS); }
  }
  return settings;
}

// Lo que llega de la interfaz se valida: solo valores conocidos.
function sanitize(s) {
  const out = structuredClone(DEFAULTS);
  for (const m of METRICS) if (typeof s?.metrics?.[m] === "boolean") out.metrics[m] = s.metrics[m];
  if (["tl", "tr", "bl", "br"].includes(s?.position)) out.position = s.position;
  if (["s", "m", "l"].includes(s?.size)) out.size = s.size;
  if (Number.isFinite(s?.opacity)) out.opacity = Math.min(0.9, Math.max(0, s.opacity));
  if (HOTKEYS.includes(s?.hotkey)) out.hotkey = s.hotkey;
  if (typeof s?.background === "boolean") out.background = s.background;
  return out;
}

export function setSettings(patch) {
  const prev = getSettings();
  settings = sanitize({ ...prev, ...patch, metrics: { ...prev.metrics, ...patch?.metrics } });
  writeFileSync(file(), JSON.stringify(settings));
  if (settings.hotkey !== prev.hotkey) registerHotkey();
  if (win) { stopSampling(); startSampling(); place(); paint(); }
  return settings;
}

/* ---------- Mediciones ---------- */

let stats = {};
const procs = [];
let cpuPrev = os.cpus();
let timer = null;

function cpuUsage() {
  const now = os.cpus();
  let idle = 0, total = 0;
  now.forEach((c, i) => {
    const p = cpuPrev[i]?.times ?? c.times;
    const t = c.times;
    idle += t.idle - p.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle - (p.user + p.nice + p.sys + p.irq + p.idle);
  });
  cpuPrev = now;
  return total > 0 ? Math.round(100 * (1 - idle / total)) : null;
}

// Lanza un programa que va escribiendo líneas y llama a onLine con cada una.
function stream(cmd, args, onLine) {
  const p = spawn(cmd, args, { windowsHide: true });
  let buf = "";
  p.stdout.on("data", (d) => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const l of lines) if (l) onLine(l);
  });
  p.on("error", () => {});
  procs.push(p);
  return p;
}

// Gráfica NVIDIA: nvidia-smi viene con el driver y da uso, temperatura, VRAM, reloj y consumo una vez por segundo.
function startNvidia(id) {
  const fallback = setTimeout(() => { if (id === session) { p.kill(); startWindowsGpu(); } }, 4000);
  const p = stream("nvidia-smi", ["--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,clocks.gr,power.draw", "--format=csv,noheader,nounits", "-i", "0", "-lms", "1000"], (l) => {
    const [gpu, temp, used, total, clock, power] = l.split(",").map((x) => Number.parseFloat(x));
    if (!Number.isFinite(gpu)) return;
    clearTimeout(fallback);
    Object.assign(stats, { gpu, gpuTemp: temp, vramUsed: used, vramTotal: total, gpuClock: clock, gpuPower: Number.isFinite(power) ? Math.round(power) : null, gpuSource: "nvidia" });
  });
}

// AMD/Intel: el uso de la gráfica sale del contador de Windows (la temperatura no la da Windows).
// ponytail: typeperf fija la lista de procesos al arrancar; si un juego se abre después, se reinicia al volver a mostrar.
function startWindowsGpu() {
  stream("typeperf", ["\\GPU Engine(*engtype_3D)\\Utilization Percentage", "-si", "1"], (l) => {
    if (!/^"\d/.test(l)) return;
    const sum = l.split(",").slice(1).reduce((n, v) => n + (Number.parseFloat(v.replace(/"/g, "")) || 0), 0);
    Object.assign(stats, { gpu: Math.min(100, Math.round(sum)), gpuSource: "windows" });
  });
}

// FPS con PresentMon (Intel, firmado): lee los eventos de Windows de cada fotograma presentado, sin tocar el juego.
let frames = new Map(); // app → tiempos entre fotogramas (ms) del último segundo
let history = [];       // del juego en primer plano, últimos ~10 s, para el 1 % más bajo
let current = null;
// ponytail: el juego es "quien más fotogramas dibuja"; para seguir solo la ventana activa haría falta leer la ventana en primer plano (Win32).
const IGNORE = /^(dwm|gamer config|electron|explorer|searchhost|textinputhost|shellexperiencehost|startmenuexperiencehost|chrome|msedge|firefox|opera|brave|discord|steamwebhelper|epicwebhelper|riotclientux|obs64|spotify)\.exe$/i;

function startFps() {
  if (!existsSync(PRESENTMON)) return;
  let col = null;
  stream(PRESENTMON, ["--output_stdout", "--v1_metrics", "--no_console_stats", "--no_track_input", "--stop_existing_session", "--session_name", SESSION], (l) => {
    const f = l.split(",");
    if (!col) { col = { app: f.indexOf("Application"), ms: f.indexOf("msBetweenPresents") }; return; }
    const name = f[col.app], ms = Number.parseFloat(f[col.ms]);
    if (!name || !Number.isFinite(ms) || ms <= 0 || IGNORE.test(name)) return;
    if (!frames.has(name)) frames.set(name, []);
    frames.get(name).push(ms);
  });
}

// Cada segundo: el programa con más fotogramas es el juego. FPS = fotogramas reales del último segundo.
// Partida en curso (para calibrar el cálculo con FPS reales): exe del juego y FPS de cada segundo.
let played = { exe: null, fps: [] };
let onSession = () => {};
export const setSessionHandler = (fn) => { onSession = fn; };
const CAPS = [30, 60, 72, 75, 90, 100, 120, 144, 165, 170, 180, 200, 240, 360];

// Al acabar una partida (o cambiar de juego, u ocultar el overlay): mediana de FPS si sirve para calibrar.
function flushPlayed() {
  const { exe, fps } = played;
  played = { exe: null, fps: [] };
  if (!exe || fps.length < 60) return; // menos de un minuto: no es representativo
  const sorted = [...fps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = fps.reduce((a, b) => a + b, 0) / fps.length;
  const cv = Math.sqrt(fps.reduce((a, b) => a + (b - mean) ** 2, 0) / fps.length) / mean;
  // FPS clavados en un tope (V-Sync o límite del juego): miden el tope, no lo que da el PC. No se usan.
  // Sin tope, los FPS de una partida varían bastante; casi fijos = tope, aunque sea uno raro (50, 58...).
  if (cv < 0.025 || (cv < 0.04 && CAPS.some((c) => Math.abs(median - c) / c < 0.03))) return;
  onSession(exe, median);
}

function tickFps() {
  let best = null;
  for (const [name, list] of frames) if (!best || list.length > best[1].length) best = [name, list];
  frames = new Map();
  if (!best || best[1].length < 2) { Object.assign(stats, { fps: null, low1: null, frametime: null, game: null }); return; }
  if (best[0] !== current) { flushPlayed(); current = best[0]; history = []; }
  if (played.exe !== current) played = { exe: current, fps: [] };
  played.fps.push(best[1].length); // fotogramas presentados en este segundo
  history.push(...best[1]);
  if (history.length > 5000) history = history.slice(-5000);
  const avg = best[1].reduce((a, b) => a + b, 0) / best[1].length;
  const sorted = [...history].sort((a, b) => b - a);
  const p99 = sorted[Math.floor(sorted.length * 0.01)] ?? sorted[0];
  Object.assign(stats, { fps: Math.round(1000 / avg), frametime: Math.round(avg * 10) / 10, low1: Math.round(1000 / p99), game: current.replace(/\.exe$/i, "") });
}

let session = 0; // cambia al parar: lo que llegue tarde de una sesión anterior se ignora

function startSampling() {
  const m = getSettings().metrics;
  const id = ++session;
  stats = {};
  cpuPrev = os.cpus();
  // Solo se arranca lo que hace falta para las estadísticas activadas.
  if (m.gpu || m.gpuTemp || m.vram || m.gpuClock || m.gpuPower) {
    run("nvidia-smi", ["-L"], { windowsHide: true }).then(() => id === session && startNvidia(id), () => id === session && startWindowsGpu());
  }
  if (fpsReady && (m.fps || m.low1 || m.frametime)) startFps();
  timer = setInterval(() => {
    tickFps();
    const total = os.totalmem();
    if (m.cpu) stats.cpu = cpuUsage();
    if (m.ram) Object.assign(stats, { ramUsed: (total - os.freemem()) / 1024 ** 3, ramTotal: total / 1024 ** 3 });
    paint();
  }, 1000);
}

function stopSampling() {
  flushPlayed();
  session++;
  clearInterval(timer);
  timer = null;
  for (const p of procs.splice(0)) p.kill();
  frames = new Map();
  history = [];
  current = null;
}

/* ---------- Permiso para medir FPS ---------- */

// PresentMon necesita ser administrador o estar en el grupo "Usuarios del registro de rendimiento" (S-1-5-32-559).
// Se añade una vez al usuario a ese grupo (pide permiso) y desde entonces mide sin avisos.
let fpsReady = false;
export async function checkFps() {
  const { stdout } = await run("whoami", ["/groups"], { windowsHide: true }).catch(() => ({ stdout: "" }));
  fpsReady = existsSync(PRESENTMON) && /S-1-5-32-559/.test(stdout);
  return fpsReady;
}

export async function enableFps() {
  const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  await elevated(`Add-LocalGroupMember -SID 'S-1-5-32-559' -Member '${user.replace(/'/g, "''")}' -ErrorAction SilentlyContinue; exit 0`);
  await record("Permiso para medir FPS (grupo Usuarios del registro de rendimiento)", { type: "group", sid: "S-1-5-32-559", user });
  return "Listo. Cierra sesión en Windows (o reinicia) una vez para que se active.";
}

/* ---------- Ventana ---------- */

let win = null;
const ROW = { s: 17, m: 21, l: 27 };
const WIDTH = { s: 150, m: 185, l: 235 };

function rows() {
  return METRICS.filter((m) => getSettings().metrics[m]).length + 1;
}

function place() {
  const s = getSettings();
  const { bounds } = screen.getPrimaryDisplay(); // bounds, no workArea: los juegos tapan la barra de tareas
  const w = WIDTH[s.size], h = rows() * ROW[s.size] + 12, m = 12;
  const x = s.position.endsWith("l") ? bounds.x + m : bounds.x + bounds.width - w - m;
  const y = s.position.startsWith("t") ? bounds.y + m : bounds.y + bounds.height - h - m;
  win.setBounds({ x, y, width: w, height: h });
}

function paint() {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`paint(${JSON.stringify({ s: getSettings(), d: stats, fpsReady })})`).catch(() => {});
}

export function isVisible() {
  return Boolean(win && !win.isDestroyed() && win.isVisible());
}

// Si se pulsa el atajo dos veces seguidas, no se abren dos ventanas (ni dos mediciones).
let opening = null;
export function show() {
  if (isVisible()) return Promise.resolve();
  opening ??= open().finally(() => { opening = null; });
  return opening;
}

async function open() {
  await checkFps();
  win = new BrowserWindow({
    width: 200, height: 100, show: false, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true);
  // Se cierre como se cierre, se dejan de medir cosas.
  const w = win;
  // Si se cierra por otra vía (no desde hide()), se deja de medir. hide() ya lo hace y quita la ventana antes:
  // así este aviso, que puede llegar tarde, no corta la medición en segundo plano que se reanuda después.
  win.on("closed", () => { if (win === w) { stopSampling(); win = null; if (measuring) startMeasure(); } });
  await win.loadFile(path.join(dir, "overlay.html"));
  place();
  win.showInactive();
  stopSampling(); // si se estaba midiendo en silencio, sigue la medición completa de la ventana
  startSampling();
}

export function hide() {
  if (opening) return void opening.then(hide);
  stopSampling();
  const w = win;
  win = null;
  if (w && !w.isDestroyed()) w.destroy();
  if (measuring) startMeasure();
}

/* ---------- Medición sin ventana (opción "Medir FPS de cada partida" del modo juego) ---------- */
// Solo FPS (PresentMon), sin pintar nada, para calibrar al acabar la partida. Apagada por defecto:
// sin esa opción, con el overlay oculto no se mide nada.
let measuring = false;

function startMeasure() {
  if (timer || !fpsReady) return;
  session++;
  startFps();
  timer = setInterval(tickFps, 1000);
}

export async function measure(on) {
  measuring = on;
  if (on) {
    await checkFps();
    if (measuring && !win) startMeasure();
  } else if (!win) stopSampling(); // stopSampling avisa con la mediana de la partida (setSessionHandler)
}

export function toggle() {
  return isVisible() ? (hide(), false) : show().then(() => true);
}

let registered = null;
export function registerHotkey() {
  if (registered) globalShortcut.unregister(registered);
  registered = getSettings().hotkey;
  if (!globalShortcut.register(registered, () => toggle())) registered = null;
  return Boolean(registered);
}
