import { app, BrowserWindow, Menu, clipboard, ipcMain, nativeTheme, shell } from "electron";
import { fileURLToPath } from "node:url";
import { watch, statfsSync, existsSync, cpSync } from "node:fs";
import path from "node:path";
import * as system from "./system.js";
import * as win from "./windows.js";
import * as optimize from "./optimize.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Una sola instancia: si ya está abierta, se enfoca la existente.
// Nombre y carpeta de datos de la app. Se llamó "afina" y luego "ConfiGGameR": la primera vez se copian
// los datos del nombre anterior más reciente (historial, copias de seguridad de juegos, permiso). No se borra nada.
app.setName("Gamer Config");
const dataDir = path.join(app.getPath("appData"), "Gamer Config");
if (!existsSync(dataDir)) {
  const old = ["ConfiGGameR", "afina"].map((n) => path.join(app.getPath("appData"), n)).find((d) => existsSync(d));
  if (old) {
    try { cpSync(old, dataDir, { recursive: true }); } catch { /* si falla, se empieza de cero */ }
  }
}
// --pruebas: carpeta de datos aparte, para probar la versión en desarrollo mientras la instalada está abierta.
app.setPath("userData", process.argv.includes("--pruebas") ? `${dataDir} (pruebas)` : dataDir);

if (!app.requestSingleInstanceLock()) app.quit();

Menu.setApplicationMenu(null);

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "Gamer Config",
    icon: path.join(dir, "../build/icon.png"),
    show: false, // se muestra cuando ya está pintada: sin parpadeo blanco
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f1012" : "#f3f4f2",
    webPreferences: {
      preload: path.join(dir, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Los enlaces externos se abren en el navegador, nunca dentro de la app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());

  mainWindow.loadFile(path.join(dir, "../dist/index.html"));
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

/* ---------- Juegos ---------- */

let knownGames = [];

async function listGames() {
  const games = await system.games();
  const withStatus = await Promise.all(games.map(async (g) => ({ ...g, status: await optimize.status(g).catch(() => "sin perfil") })));
  knownGames = withStatus;
  return withStatus;
}

const gameById = (id) => {
  const g = knownGames.find((x) => x.id === id);
  if (!g) throw new Error("Juego no encontrado.");
  return g;
};

// Vigila las carpetas de Steam, Epic, Riot y Xbox: cuando termina una instalación, la lista se actualiza sola.
// EA, Ubisoft, GOG y Battle.net apuntan sus juegos en el registro (no se puede vigilar): se revisa cada 5 minutos.
async function watchGames() {
  let timer = null;
  setInterval(() => onChange(), 5 * 60 * 1000);
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const before = new Set(knownGames.map((g) => g.id));
      await optimize.updateProfiles().catch(() => {}); // por si ya hay perfil para el juego nuevo
      const now = await listGames().catch(() => null);
      if (!now) return;
      const added = now.filter((g) => !before.has(g.id)).map((g) => ({ name: g.name, status: g.status }));
      mainWindow?.webContents.send("games-changed", added);
    }, 3000); // las tiendas escriben varias veces seguidas: se espera a que terminen
  };
  for (const d of await system.gameDirs()) {
    try { watch(d, onChange); } catch { /* carpeta sin acceso: se ignora */ }
  }
}

/* ---------- IPC ---------- */

const handlers = {
  specs: () => system.specs(),
  usage: () => system.usage(),
  scan: () => system.scan(),
  startup: () => system.startupApps(),
  games: () => listGames(),
  "game-detail": (id, goal) => optimize.detail(gameById(id), goal),
  "game-apply": async (id, goal) => {
    const msg = await optimize.apply(gameById(id), goal);
    await listGames();
    return msg;
  },
  // Configuración central: el mismo modo para todos los juegos de una vez.
  // Cada juego se calcula con SUS requisitos y TU equipo (no se copian los mismos valores a todos).
  "games-apply-all": async (goal) => {
    const results = [];
    for (const g of knownGames) {
      try {
        const d = await optimize.detail(g, goal);
        if (!d.canApply) { results.push({ name: g.name, status: "guia", msg: "Solo guía: los valores están en su ficha para ponerlos en el menú del juego." }); continue; }
        if (!d.configFound) { results.push({ name: g.name, status: "skip", msg: "Aún no tiene archivo de configuración: ábrelo una vez y vuelve a aplicar." }); continue; }
        const msg = await optimize.apply(g, goal);
        results.push({ name: g.name, status: /Ya estaba/.test(msg) ? "same" : "ok", msg });
      } catch (e) {
        results.push({ name: g.name, status: "error", msg: e.message });
      }
    }
    await listGames();
    return results;
  },
  "game-set": async (id, file, changes) => {
    const msg = await optimize.setValues(gameById(id), file, changes);
    await listGames();
    return msg;
  },
  // Informe de texto con todo lo detectado y calculado para un juego, para compartirlo si algo sale raro.
  "copy-report": async (id, goal) => {
    const g = gameById(id);
    const [hw, d] = await Promise.all([system.hardware(), optimize.detail(g, goal)]);
    const dem = (x) => (x ? `${x.text} (potencia ${x.score}, requisitos ${x.kind}, ${x.source})` : "sin datos (se asume exigencia media)");
    const lines = [
      `Gamer Config ${app.getVersion()} · informe de ${g.name} (${g.store}) · objetivo: ${goal}`,
      "",
      "EQUIPO",
      `Gráfica: ${hw.gpu} · potencia ${hw.score} · ${hw.vramGb ?? "?"} GB VRAM · ${hw.vendor}`,
      `Procesador: ${hw.cpu} · potencia ${hw.cpuScore} · ${hw.threads ?? "?"} hilos`,
      `RAM: ${hw.ramGb} GB ${hw.ramType ?? ""} ${hw.ramMhz ?? ""} MHz · ${hw.ramModules} módulos`,
      `Pantalla: ${hw.resW}×${hw.resH} a ${hw.refresh} Hz · ${hw.laptop ? "portátil" : "sobremesa"} · discos: ${JSON.stringify(hw.drives)}`,
      "",
      "JUEGO",
      `Tipo: ${d.kind} · archivos: ${d.files.map((f) => f.file).join(" | ") || "no encontrados"}`,
      `Pide gráfica: ${dem(d.gpu.demand)}`,
      `Pide procesador: ${dem(d.cpu.demand)}`,
      "",
      "CÁLCULO",
      `FPS gráfica ~${d.gpu.fps} · FPS procesador ~${d.cpu.fps} · limita: ${d.bottleneck === "cpu" ? "procesador" : "gráfica"}`,
      `Al máximo ~${d.estMax} → con los ajustes ~${d.estFinal} · objetivo ${d.target} · ${d.reached ? "se llega" : "no se llega"}`,
      ...d.factors.map((f) => `[${f.effect}] ${f.label}: ${f.value} · ${f.note}`),
      "",
      "AJUSTES",
      ...d.settings.map((s) => `${s.name}${s.key ? ` (${s.key})` : ""}: ${s.current ?? "-"} → ${s.recommended}${s.change ? "" : " (sin cambio)"}`),
    ];
    clipboard.writeText(lines.join("\n"));
    return true;
  },
  "game-restore": async (id) => {
    const msg = await optimize.restoreOriginal(gameById(id));
    await listGames();
    return msg;
  },
  // El estado depende del PC: hay optimizaciones que solo se recomiendan si al equipo le viene bien aligerar Windows o le falta disco.
  "win-state": async () => {
    const hw = await system.hardware().catch(() => ({}));
    const c = statfsSync("C:\\");
    return win.state({ ...hw, freeGbC: (c.bavail * c.bsize) / 1024 ** 3 });
  },
  // Tras cada cambio se vuelve a leer Windows para comprobar que está aplicado de verdad.
  // verified: true (confirmado), false (Windows no lo muestra aplicado), null (no hay nada que comprobar: borrar archivos, etc.).
  "win-action": async (id, arg) => {
    const msg = await win.action(id, arg);
    let verified = null;
    if (id === "startup") {
      const app = (await system.startupApps().catch(() => [])).find((a) => a.id === arg.id);
      verified = app ? app.enabled === arg.enabled : null;
    } else if (!["temp", "wucache", "recycle", "restore", "diskopt", "widgets"].includes(id)) {
      const hw = await system.hardware().catch(() => ({}));
      const item = (await win.state(hw)).items.find((i) => i.id === id);
      verified = item ? item.done : null;
    }
    return { msg, verified };
  },
  history: () => win.history(),
  undo: (id) => win.undo(id),
  drivers: () => system.drivers(),
  // Solo abre páginas que salen de la lista de drivers (nunca una dirección que mande la interfaz).
  "open-update": async (id) => {
    const d = await system.drivers();
    const page = id === "windows-update" ? system.WINDOWS_UPDATE : d.items.find((i) => i.id === id)?.page ?? d.oemPage;
    await shell.openExternal(page);
  },
};

for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, (_e, ...args) => fn(...args));

app.whenReady().then(() => {
  system.specs().catch(() => {}); // precarga: la consulta de hardware tarda ~2 s
  optimize.updateProfiles().catch(() => {});
  createWindow();
  listGames().then(watchGames).catch(() => {});
});
app.on("window-all-closed", () => app.quit());
