// Cambios en Windows. Todo cambio queda en el historial con lo necesario para deshacerlo.
import { app } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);
const opts = { windowsHide: true };

/* ---------- Registro ---------- */

async function regRead(key, name) {
  try {
    const { stdout } = await run("reg", ["query", key, "/v", name], opts);
    const m = stdout.match(/\s(REG_\w+)\s+(.*)/);
    return m ? { kind: m[1], data: m[2].trim() } : null;
  } catch {
    return null; // no existe
  }
}

// Ejecuta un script de PowerShell como administrador: Windows muestra su aviso de permiso (UAC).
export async function elevated(script) {
  const encoded = Buffer.from(`$ErrorActionPreference='Stop';${script}`, "utf16le").toString("base64");
  const outer = `try { $p = Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'; exit $p.ExitCode } catch { exit 1223 }`;
  try {
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", outer], opts);
  } catch (e) {
    throw new Error(e.code === 1223 ? "No diste permiso de administrador. No se cambió nada." : "Windows no permitió el cambio.");
  }
}

const regArgs = ({ key, name, kind, data }) =>
  data == null ? ["delete", key, "/v", name, "/f"] : ["add", key, "/v", name, "/t", kind, "/d", String(data), "/f"];

async function regWrite(w) {
  if (w.admin) {
    const args = regArgs(w).map((a) => `'${String(a).replace(/'/g, "''")}'`).join(",");
    await elevated(`& reg.exe @(${args}) | Out-Null; exit $LASTEXITCODE`);
  } else {
    await run("reg", regArgs(w), opts);
  }
}

// El valor anterior para poder volver atrás (null = no existía).
async function regSnapshot(w) {
  const prev = await regRead(w.key, w.name);
  return { ...w, kind: prev?.kind ?? w.kind, data: prev ? (prev.kind === "REG_DWORD" ? Number.parseInt(prev.data, 16) : prev.data) : null };
}

/* ---------- Historial ---------- */

const historyFile = () => path.join(app.getPath("userData"), "history.json");

export async function history() {
  try {
    return JSON.parse(await fs.readFile(historyFile(), "utf8"));
  } catch {
    return [];
  }
}

async function saveHistory(list) {
  await fs.mkdir(path.dirname(historyFile()), { recursive: true });
  await fs.writeFile(historyFile(), JSON.stringify(list.slice(0, 100), null, 1));
}

export async function record(label, undo) {
  const list = await history();
  list.unshift({ id: Date.now(), label, at: new Date().toISOString(), undo, undone: false });
  await saveHistory(list);
}

export async function undo(id) {
  const list = await history();
  const entry = list.find((e) => e.id === id);
  if (!entry?.undo || entry.undone) throw new Error("Este cambio no se puede deshacer.");
  const u = entry.undo;
  if (u.type === "reg") await regWrite(u);
  else if (u.type === "multi") await regWriteMany(u.writes);
  else if (u.type === "service") await setService(u.name, u.start);
  else if (u.type === "hibernate") await elevated("powercfg /hibernate on; exit $LASTEXITCODE");
  else if (u.type === "power") await run("powercfg", ["/setactive", u.guid], opts);
  else if (u.type === "file") await fs.copyFile(u.backup, u.path);
  else if (u.type === "group") await elevated(`Remove-LocalGroupMember -SID '${u.sid}' -Member '${String(u.user).replace(/'/g, "''")}' -ErrorAction SilentlyContinue; exit 0`);
  entry.undone = true;
  await saveHistory(list);
  return `Deshecho: ${entry.label}`;
}

/* ---------- Varias escrituras de golpe (un solo aviso de administrador) ---------- */

async function regWriteMany(writes) {
  const admin = writes.filter((w) => w.admin);
  for (const w of writes.filter((w) => !w.admin)) {
    // Borrar un valor que no existe no es un error.
    await run("reg", regArgs(w), opts).catch((e) => { if (w.data != null) throw e; });
  }
  if (admin.length) {
    const lines = admin.map((w) => {
      const args = regArgs(w).map((a) => `'${String(a).replace(/'/g, "''")}'`).join(",");
      return `& reg.exe @(${args}) | Out-Null; if ($LASTEXITCODE -and ${w.data == null ? "$false" : "$true"}) { $fail = 1 }`;
    });
    await elevated(`$fail = 0; ${lines.join("; ")}; exit $fail`);
  }
}

const snapshotMany = (writes) => Promise.all(writes.map(regSnapshot));
const dword = (r) => (r ? Number.parseInt(r.data, 16) : null);

/* ---------- Servicios ---------- */

async function serviceState(name) {
  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$s = Get-Service -Name '${name}' -ErrorAction Stop; "$($s.StartType)|$($s.Status)"`], opts);
    const [start, status] = stdout.trim().split("|");
    return { start, status };
  } catch {
    return null; // no existe en este Windows
  }
}

async function setService(name, start) {
  const stop = start === "Disabled" ? `Stop-Service -Name '${name}' -Force -ErrorAction SilentlyContinue;` : "";
  const go = start !== "Disabled" ? `Start-Service -Name '${name}' -ErrorAction SilentlyContinue;` : "";
  await elevated(`${stop} Set-Service -Name '${name}' -StartupType ${start}; ${go} exit 0`);
}

// Modo real de "Optimización de distribución" (compartir actualizaciones), según Windows. null si no se puede saber.
async function deliveryMode() {
  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-DOConfig -ErrorAction Stop).DownloadMode"], opts);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/* ---------- Estado actual ---------- */

const GAMEBAR = "HKCU\\Software\\Microsoft\\GameBar";
const GFX = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers";
const HIGH_PERF = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"; // plan "Alto rendimiento" de Windows
const ADV = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
const CDM = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager";
const DX_KEY = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
const DX_NAME = "DirectXUserGlobalSettings"; // "Clave=valor;" con varias opciones de gráficos de Windows juntas
const WU_CACHE =path.join(process.env.SystemRoot ?? "C:\\Windows", "SoftwareDistribution", "Download");

async function powerPlans() {
  const { stdout } = await run("powercfg", ["/list"], opts);
  return [...stdout.matchAll(/([0-9a-f-]{36})\s+\((.+?)\)(\s*\*)?/gi)].map((m) => ({ guid: m[1], name: m[2], active: Boolean(m[3]) }));
}

const isPerfPlan = (name) => /rendimiento|performance|ultimate|gaming|turbo/i.test(name) && !/equilibrad|balanced|ahorro|saver|quiet|silen/i.test(name);

async function folderSize(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(entries.filter((e) => e.isFile()).map((e) => fs.stat(path.join(e.parentPath, e.name)).then((s) => s.size, () => 0)));
  return sizes.reduce((a, b) => a + b, 0);
}

const gb = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toLocaleString("es", { maximumFractionDigits: 1 })} GB` : `${Math.round(b / 1024 ** 2)} MB`);

/*
 * Lista de optimizaciones. Cada una:
 *   group     "juego" | "ligero" (aligerar Windows) | "espacio" | "seguridad"
 *   writes    valores de registro que pone (se guardan los anteriores para deshacer)
 *   done      cómo saber si ya está aplicada (con los valores leídos)
 *   forLow    true = solo se recomienda cuando al equipo le viene bien aligerar Windows
 *   admin / relogin / reboot: lo que implica
 */
const REG_OPTS = [
  {
    id: "gamedvr", group: "juego", title: "Grabación en segundo plano de Xbox",
    body: "Windows graba los últimos minutos de juego en segundo plano por si quieres guardar un clip. Gasta GPU y disco: quitarla da FPS, sobre todo cuando la gráfica va al límite.",
    cta: "Desactivar",
    writes: [
      { key: "HKCU\\System\\GameConfigStore", name: "GameDVR_Enabled", kind: "REG_DWORD", data: 0 },
      { key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR", name: "AppCaptureEnabled", kind: "REG_DWORD", data: 0 },
    ],
    done: (v) => v[0] === 0 && v[1] === 0,
  },
  {
    id: "mouseaccel", group: "juego", title: "Aceleración del ratón",
    body: "Con «Mejorar precisión del puntero» el cursor no se mueve siempre lo mismo para el mismo gesto. Quitarla da una puntería más constante. Se nota al cerrar sesión.",
    cta: "Desactivar", relogin: true,
    writes: [
      { key: "HKCU\\Control Panel\\Mouse", name: "MouseSpeed", kind: "REG_SZ", data: "0" },
      { key: "HKCU\\Control Panel\\Mouse", name: "MouseThreshold1", kind: "REG_SZ", data: "0" },
      { key: "HKCU\\Control Panel\\Mouse", name: "MouseThreshold2", kind: "REG_SZ", data: "0" },
    ],
    done: (v) => v.every((x) => x === "0"),
  },
  {
    id: "animations", group: "ligero", forLow: true, title: "Animaciones y efectos visuales de Windows",
    body: "Quita animaciones de ventanas, menús y barra de tareas, sombras y vistas previas. Windows va más fluido, sobre todo con poca RAM o gráfica integrada. Se aplica al cerrar sesión.",
    cta: "Quitar", relogin: true,
    writes: [
      { key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects", name: "VisualFXSetting", kind: "REG_DWORD", data: 2 },
      { key: "HKCU\\Control Panel\\Desktop", name: "UserPreferencesMask", kind: "REG_BINARY", data: "9012038010000000" },
      { key: "HKCU\\Control Panel\\Desktop\\WindowMetrics", name: "MinAnimate", kind: "REG_SZ", data: "0" },
      { key: ADV, name: "TaskbarAnimations", kind: "REG_DWORD", data: 0 },
      { key: ADV, name: "ListviewShadow", kind: "REG_DWORD", data: 0 },
      { key: "HKCU\\Software\\Microsoft\\Windows\\DWM", name: "EnableAeroPeek", kind: "REG_DWORD", data: 0 },
    ],
    done: (v) => v[0] === 2,
  },
  {
    id: "transparency", group: "ligero", forLow: true, title: "Transparencias",
    body: "Las ventanas y la barra de tareas dejan de ser translúcidas. Ahorra trabajo a gráficas integradas.",
    cta: "Desactivar",
    writes: [{ key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", name: "EnableTransparency", kind: "REG_DWORD", data: 0 }],
    done: (v) => v[0] === 0,
  },
  {
    id: "bgapps", group: "ligero", forLow: true, title: "Apps en segundo plano",
    body: "Las apps de la Tienda dejan de funcionar cuando no las usas (actualizar el tiempo, notificaciones...). Libera RAM y CPU.",
    cta: "Desactivar",
    writes: [
      { key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications", name: "GlobalUserDisabled", kind: "REG_DWORD", data: 1 },
      { key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search", name: "BackgroundAppGlobalToggle", kind: "REG_DWORD", data: 0 },
    ],
    done: (v) => v[0] === 1,
  },
  {
    id: "edgebg", group: "ligero", forLow: true, title: "Edge abierto en segundo plano",
    body: "Edge se queda cargado aunque lo cierres para abrir más rápido. Desactivarlo libera varios cientos de MB de RAM.",
    cta: "Desactivar", admin: true,
    writes: [
      { key: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge", name: "StartupBoostEnabled", kind: "REG_DWORD", data: 0, admin: true },
      { key: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge", name: "BackgroundModeEnabled", kind: "REG_DWORD", data: 0, admin: true },
    ],
    done: (v) => v[0] === 0 && v[1] === 0,
  },
  {
    id: "tips", group: "ligero", title: "Sugerencias y anuncios de Windows",
    body: "Quita consejos, apps sugeridas en el menú Inicio y anuncios en la pantalla de bloqueo. Menos procesos descargando contenido.",
    cta: "Desactivar",
    writes: [
      { key: CDM, name: "SystemPaneSuggestionsEnabled", kind: "REG_DWORD", data: 0 },
      { key: CDM, name: "SoftLandingEnabled", kind: "REG_DWORD", data: 0 },
      { key: CDM, name: "SubscribedContent-338388Enabled", kind: "REG_DWORD", data: 0 },
      { key: CDM, name: "SubscribedContent-338389Enabled", kind: "REG_DWORD", data: 0 },
      { key: CDM, name: "SubscribedContent-310093Enabled", kind: "REG_DWORD", data: 0 },
      { key: CDM, name: "RotatingLockScreenOverlayEnabled", kind: "REG_DWORD", data: 0 },
    ],
    done: (v) => v.every((x) => x === 0),
  },
  {
    id: "delivery", group: "ligero", title: "Compartir actualizaciones con otros PCs",
    body: "Windows sube trozos de actualizaciones a otros equipos por internet. Desactivarlo deja tu subida libre (mejor ping al jugar).",
    cta: "Desactivar", admin: true,
    writes: [{ key: "HKU\\S-1-5-20\\Software\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization\\Settings", name: "DownloadMode", kind: "REG_DWORD", data: 0, admin: true }],
    done: (v) => v[0] === 0,
  },
  {
    id: "menudelay", group: "ligero", title: "Retardo de los menús",
    body: "Windows espera 0,4 segundos antes de abrir los submenús. Bajarlo a 0,1 hace que todo se sienta más ágil. Se aplica al cerrar sesión.",
    cta: "Acelerar", relogin: true,
    writes: [{ key: "HKCU\\Control Panel\\Desktop", name: "MenuShowDelay", kind: "REG_SZ", data: "100" }],
    done: (v) => v[0] != null && Number(v[0]) <= 100,
  },
  {
    id: "startupdelay", group: "ligero", forLow: true, title: "Espera de los programas de inicio",
    body: "Al encender, Windows retrasa unos segundos los programas que se inician solos. Quitar la espera hace que estén listos antes.",
    cta: "Quitar espera",
    writes: [{ key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize", name: "StartupDelayInMSec", kind: "REG_DWORD", data: 0 }],
    done: (v) => v[0] === 0,
  },
];

// Cuándo le viene bien aligerar Windows a un equipo: cualquiera de estas condiciones.
function lowEndReasons(hw) {
  const r = [];
  if (hw.ramGb && hw.ramGb <= 8) r.push(`${hw.ramGb} GB de RAM`);
  if (hw.cpuScore && hw.cpuScore < 60) r.push("procesador de pocos núcleos o antiguo");
  if (hw.score && hw.score < 30) r.push("gráfica integrada o básica");
  if (hw.drives?.C === "HDD") r.push("Windows en disco duro");
  return r;
}

export async function state(hw = {}) {
  const lowReasons = lowEndReasons(hw);
  const low = lowReasons.length > 0;
  const hdd = hw.drives?.C === "HDD";
  const [plans, gm, hags, temp, wuCache, hib, search, sysmain, diag, dx, doMode, widgetsBtn, ...regs] = await Promise.all([
    powerPlans(), regRead(GAMEBAR, "AutoGameModeEnabled"), regRead(GFX, "HwSchMode"), folderSize(os.tmpdir()),
    folderSize(WU_CACHE), regRead("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power", "HibernateEnabled"),
    serviceState("WSearch"), serviceState("SysMain"), serviceState("DiagTrack"), regRead(DX_KEY, DX_NAME),
    deliveryMode(), regRead(ADV, "TaskbarDa"),
    ...REG_OPTS.map((o) => Promise.all(o.writes.map((w) => regRead(w.key, w.name)))),
  ]);
  const current = plans.find((p) => p.active);
  const best = plans.find((p) => /máximo|ultimate/i.test(p.name)) ?? plans.find((p) => p.guid === HIGH_PERF) ?? plans.find((p) => isPerfPlan(p.name));
  const planOk = current ? isPerfPlan(current.name) : false;
  const ramGb = hw.ramGb ?? 16;

  const items = [
    { id: "power", group: "juego", title: "Plan de energía", body: `Ahora: ${current?.name ?? "desconocido"}. En alto rendimiento la CPU y la gráfica no bajan de frecuencia mientras juegas.`, cta: planOk ? "Listo" : `Cambiar a ${best?.name ?? "Alto rendimiento"}`, done: planOk },
    { id: "gamemode", group: "juego", title: "Modo de juego de Windows", body: "Prioriza el juego y pausa actualizaciones mientras juegas.", cta: "Activar", done: gm ? Number.parseInt(gm.data, 16) !== 0 : true },
    { id: "hags", group: "juego", title: "Programación de GPU acelerada por hardware", body: "Menos latencia en gráficas modernas.", cta: "Activar", admin: true, reboot: true, done: hags ? Number.parseInt(hags.data, 16) === 2 : false },
    ...REG_OPTS.map((o, i) => {
      const v = regs[i].map((r) => (r ? (r.kind === "REG_DWORD" ? dword(r) : r.data) : null));
      // "Compartir actualizaciones" vive en una parte del registro que solo lee un administrador:
      // se comprueba con el comando oficial de Windows (Get-DOConfig), que dice el modo que se usa de verdad.
      const done = o.id === "delivery" && doMode ? /cdnonly|httponly|bypass/i.test(doMode) : o.done(v);
      return { id: o.id, group: o.group, title: o.title, body: o.body, cta: o.cta, admin: Boolean(o.admin), relogin: Boolean(o.relogin), done, recommended: o.forLow ? low : true };
    }),
    ...(search ? [{ id: "search", group: "ligero", title: "Indexación de búsqueda", body: "Windows lee tus archivos en segundo plano para que la búsqueda sea instantánea. En discos lentos o con poca RAM provoca tirones. La búsqueda seguirá funcionando, solo más lenta.", cta: "Desactivar", admin: true, done: search.start === "Disabled", recommended: hdd || ramGb <= 8 }] : []),
    ...(sysmain ? [{ id: "sysmain", group: "ligero", title: "SysMain (precarga de programas)", body: "Carga en RAM los programas que más usas. En discos duros mecánicos suele dejar el disco al 100 %; en SSD no hace falta tocarlo.", cta: "Desactivar", admin: true, done: sysmain.start === "Disabled", recommended: hdd }] : []),
    // Windows protege este ajuste: ni con permiso de administrador deja que otro programa lo cambie
    // ("Acceso denegado"). Se abre la página exacta de Configuración y se comprueba si se ha quitado.
    { id: "widgets", group: "ligero", manual: true, title: "Widgets de la barra de tareas", body: "El panel de noticias y tiempo mantiene procesos web en segundo plano. Windows no deja que ningún programa lo cambie por ti: el botón abre la página de Configuración y ahí desactivas «Widgets».", cta: "Abrir Configuración", done: widgetsBtn ? dword(widgetsBtn) === 0 : false, recommended: low },
    { id: "windowed", group: "juego", title: "Optimizaciones para juegos en ventana", body: "Hace que los juegos en ventana o en pantalla completa sin bordes vayan con la misma latencia que en pantalla completa. Es una opción oficial de Windows 11.", cta: "Activar", done: /SwapEffectUpgradeEnable=1/.test(dx?.data ?? "") },
    ...(diag ? [{ id: "telemetry", group: "ligero", title: "Telemetría de Windows", body: "El servicio que envía datos de uso a Microsoft trabaja en segundo plano (CPU, disco y red). Desactivarlo no afecta a las actualizaciones.", cta: "Desactivar", admin: true, done: diag.start === "Disabled", recommended: low }] : []),
    { id: "diskopt", group: "espacio", title: "Optimizar el disco del sistema", body: hdd ? "Desfragmenta el disco duro de Windows: los archivos quedan juntos y se cargan más rápido. Puede tardar un buen rato." : "Envía TRIM al SSD para que mantenga su velocidad de escritura. Windows ya lo hace cada semana; esto lo hace ahora.", cta: hdd ? "Desfragmentar" : "Optimizar", admin: true, done: false, recommended: hdd },
    { id: "temp", group: "espacio", title: "Archivos temporales", body: `Ocupan ${gb(temp)}. Se pueden borrar sin riesgo.`, cta: "Limpiar", done: temp < 50 * 1024 ** 2 },
    { id: "wucache", group: "espacio", title: "Caché de Windows Update", body: wuCache ? `Ocupa ${gb(wuCache)}. Son instaladores de actualizaciones ya instaladas.` : "Instaladores de actualizaciones ya instaladas.", cta: "Limpiar", admin: true, done: wuCache > 0 && wuCache < 100 * 1024 ** 2 },
    { id: "hibernate", group: "espacio", title: "Hibernación", body: `Reserva en el disco C: tanto espacio como RAM tienes (~${ramGb} GB). Si no usas «Hibernar», se puede liberar. La suspensión normal sigue funcionando.`, cta: "Desactivar", admin: true, done: hib ? dword(hib) === 0 : false, recommended: (hw.freeGbC ?? 999) < 30 },
    { id: "recycle", group: "espacio", title: "Papelera de reciclaje", body: "Vacía la papelera de todas las unidades. No se puede deshacer.", cta: "Vaciar", done: false },
    { id: "restore", group: "seguridad", title: "Punto de restauración", body: "Copia del estado de Windows por si algo sale mal. Conviene crear uno antes de hacer muchos cambios.", cta: "Crear", admin: true, done: false },
  ].map((x) => ({ admin: false, relogin: false, reboot: false, recommended: true, ...x }));

  return { low, lowReasons, items };
}

/* ---------- Plan de energía (también lo usa el modo juego) ---------- */

export async function setPerformancePlan() {
  const plans = await powerPlans();
  const prev = plans.find((p) => p.active);
  let target = plans.find((p) => /máximo|ultimate/i.test(p.name)) ?? plans.find((p) => p.guid === HIGH_PERF) ?? plans.find((p) => isPerfPlan(p.name));
  if (!target) {
    // El plan existe en todos los Windows aunque esté oculto: se crea una copia visible.
    const { stdout } = await run("powercfg", ["-duplicatescheme", HIGH_PERF], opts);
    target = { guid: stdout.match(/[0-9a-f-]{36}/i)[0], name: "Alto rendimiento" };
  }
  await run("powercfg", ["/setactive", target.guid], opts);
  return { prev, target };
}

export const setPlan = (guid) => run("powercfg", ["/setactive", guid], opts);

/* ---------- Acciones ---------- */

export async function action(id, arg) {
  const reg = REG_OPTS.find((o) => o.id === id);
  if (reg) {
    const writes = reg.writes.map((w) => ({ type: "reg", admin: false, ...w }));
    const prev = await snapshotMany(writes);
    await regWriteMany(writes);
    await record(`${reg.title}: ${reg.cta.toLowerCase()}`, { type: "multi", writes: prev });
    return `${reg.title}: hecho.${reg.relogin ? " Cierra sesión para que se aplique del todo." : ""}`;
  }

  switch (id) {
    case "power": {
      const { prev, target } = await setPerformancePlan();
      await record(`Plan de energía: ${prev?.name ?? "?"} → ${target.name}`, prev && { type: "power", guid: prev.guid });
      return `Plan de energía cambiado a «${target.name}».`;
    }
    case "gamemode": {
      const w = { type: "reg", key: GAMEBAR, name: "AutoGameModeEnabled", kind: "REG_DWORD", data: 1, admin: false };
      const prev = await regSnapshot(w);
      await regWrite(w);
      await record("Modo de juego activado", prev);
      return "Modo de juego activado.";
    }
    case "hags": {
      const w = { type: "reg", key: GFX, name: "HwSchMode", kind: "REG_DWORD", data: 2, admin: true };
      const prev = await regSnapshot(w);
      await regWrite(w);
      await record("Programación de GPU acelerada por hardware activada", prev);
      return "Activado. Reinicia el PC para que tenga efecto.";
    }
    case "widgets": {
      await run("cmd.exe", ["/c", "start", "", "ms-settings:taskbar"], opts);
      return "Se abrió Configuración → Personalización → Barra de tareas. Desactiva «Widgets» y vuelve aquí: se comprobará solo.";
    }
    case "windowed": {
      // El valor guarda varias opciones juntas: se cambia solo la nuestra y se respeta el resto.
      const prev = await regSnapshot({ type: "reg", key: DX_KEY, name: DX_NAME, kind: "REG_SZ", admin: false });
      const parts = String(prev.data ?? "").split(";").filter((x) => x && !x.startsWith("SwapEffectUpgradeEnable="));
      await regWrite({ key: DX_KEY, name: DX_NAME, kind: "REG_SZ", data: [...parts, "SwapEffectUpgradeEnable=1"].join(";") + ";", admin: false });
      await record("Optimizaciones para juegos en ventana activadas", prev);
      return "Activado. Se aplica la próxima vez que abras cada juego.";
    }
    case "telemetry": {
      const before = await serviceState("DiagTrack");
      await setService("DiagTrack", "Disabled");
      await record("Telemetría de Windows desactivada", before && { type: "service", name: "DiagTrack", start: before.start });
      return "Telemetría de Windows desactivada.";
    }
    case "diskopt": {
      // Optimize-Volume elige solo: TRIM en SSD, desfragmentar en disco duro.
      await elevated("Optimize-Volume -DriveLetter ($env:SystemDrive[0]) -Verbose:$false; exit 0");
      await record("Disco del sistema optimizado", null);
      return "Disco del sistema optimizado.";
    }
    case "search":
    case "sysmain": {
      const name = id === "search" ? "WSearch" : "SysMain";
      const before = await serviceState(name);
      await setService(name, "Disabled");
      await record(`${id === "search" ? "Indexación de búsqueda" : "SysMain"} desactivado`, before && { type: "service", name, start: before.start });
      return `${id === "search" ? "Indexación de búsqueda" : "SysMain"} desactivado.`;
    }
    case "hibernate": {
      await elevated("powercfg /hibernate off; exit $LASTEXITCODE");
      await record("Hibernación desactivada", { type: "hibernate" });
      return "Hibernación desactivada: el espacio se libera al momento.";
    }
    case "temp": {
      const dir = os.tmpdir();
      const before = await folderSize(dir);
      const entries = await fs.readdir(dir).catch(() => []);
      // Solo lo de hace más de un día: lo reciente puede ser de un instalador o programa abierto ahora mismo.
      // Lo que está en uso no se puede borrar y se salta: es lo esperado.
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      await Promise.all(entries.map(async (e) => {
        const p = path.join(dir, e);
        const st = await fs.stat(p).catch(() => null);
        if (st && st.mtimeMs < dayAgo) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
      }));
      const freed = Math.max(0, before - (await folderSize(dir)));
      await record(`Temporales borrados (${gb(freed)})`, null);
      return `Se liberaron ${gb(freed)}.`;
    }
    case "wucache": {
      const before = await folderSize(WU_CACHE);
      await elevated(`Stop-Service wuauserv -Force -ErrorAction SilentlyContinue; Remove-Item '${WU_CACHE}\\*' -Recurse -Force -ErrorAction SilentlyContinue; Start-Service wuauserv -ErrorAction SilentlyContinue; exit 0`);
      const freed = Math.max(0, before - (await folderSize(WU_CACHE)));
      await record(`Caché de Windows Update borrada${freed ? ` (${gb(freed)})` : ""}`, null);
      return freed ? `Se liberaron ${gb(freed)}.` : "Caché de Windows Update vaciada.";
    }
    case "recycle": {
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Clear-RecycleBin -Force -ErrorAction SilentlyContinue; exit 0"], opts);
      await record("Papelera vaciada", null);
      return "Papelera vaciada.";
    }
    case "startup": {
      // arg = { id: "HKCU:\\...\\StartupApproved\\Run|Nombre", enabled, name }
      const [approved, name] = arg.id.split("|");
      const w = {
        type: "reg", key: approved.replace(":", ""), name, kind: "REG_BINARY",
        data: arg.enabled ? "020000000000000000000000" : "030000000000000000000000", admin: approved.startsWith("HKLM"),
      };
      const prev = await regSnapshot(w);
      await regWrite(w);
      await record(`${arg.name}: ${arg.enabled ? "se inicia" : "ya no se inicia"} con Windows`, prev);
      return `${arg.name} ${arg.enabled ? "se iniciará" : "ya no se iniciará"} con Windows.`;
    }
    case "restore": {
      await elevated("Enable-ComputerRestore -Drive \"$env:SystemDrive\\\"; Checkpoint-Computer -Description 'Gamer Config' -RestorePointType MODIFY_SETTINGS");
      await record("Punto de restauración creado", null);
      return "Punto de restauración creado. Windows solo permite uno cada 24 horas: si ya había uno reciente, se usa ese.";
    }
    default:
      throw new Error(`Acción desconocida: ${id}`);
  }
}
