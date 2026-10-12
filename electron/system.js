// Lectura del sistema. SOLO LECTURA: nada de este archivo modifica Windows.
import { screen } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { statfsSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scoreOf, isIntegrated } from "./gpus.js";
import { cpuScoreOf } from "./cpus.js";
import { windowsUpdateDrivers, nvidiaLatest, compareVersions, clearOnline } from "./online.js";
import { addCovers } from "./covers.js";

const run = promisify(execFile);

async function ps(script) {
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
      `$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;${script}`],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : null;
}

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const GB = 1024 ** 3;

/* ---------- Hardware (se lee una vez y se guarda) ---------- */

let rawCache = null;
function raw() {
  rawCache ??= ps(`
    $disk = Get-Partition -DriveLetter C | Get-Disk
    $vram = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' |
      Select-Object DriverDesc, @{n='Mem';e={[int64]$_.'HardwareInformation.qwMemorySize'}}
    $cv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
    [pscustomobject]@{
      cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors
      gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, @{n='DriverDate';e={$_.DriverDate.ToString('yyyy-MM-dd')}})
      vram = @($vram)
      ram  = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity, Speed, ConfiguredClockSpeed, SMBIOSMemoryType)
      disk = [pscustomobject]@{ Name = $disk.FriendlyName; Bus = [string]$disk.BusType; Size = $disk.Size }
      os   = [pscustomobject]@{ Name = (Get-CimInstance Win32_OperatingSystem).Caption; Version = $cv.DisplayVersion }
      plan = (powercfg /getactivescheme) -replace '^.*\\((.*)\\)\\s*$', '$1'
      hags = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers').HwSchMode
      gameMode = (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\GameBar').AutoGameModeEnabled
      laptop = [bool](Get-CimInstance Win32_Battery)
      refresh = (Get-CimInstance Win32_VideoController | Where-Object CurrentRefreshRate | Select-Object -First 1).CurrentRefreshRate
      res = (Get-CimInstance Win32_VideoController | Where-Object CurrentHorizontalResolution | Select-Object -First 1 | ForEach-Object { @($_.CurrentHorizontalResolution, $_.CurrentVerticalResolution) })
      gpuCount = @(Get-PnpDevice -Class Display -Status OK).Count
      docs = [Environment]::GetFolderPath('MyDocuments')
      drives = @(Get-Partition | Where-Object DriveLetter | ForEach-Object {
        $n = $_.DiskNumber; $pd = Get-PhysicalDisk | Where-Object { [string]$_.DeviceId -eq [string]$n }
        [pscustomobject]@{ L = [string]$_.DriveLetter; Media = [string]$pd.MediaType; Bus = [string]$pd.BusType } })
    } | ConvertTo-Json -Compress -Depth 4
  `).catch((e) => { rawCache = null; throw e; });
  return rawCache;
}

const RAM_TYPES = { 24: "DDR3", 26: "DDR4", 34: "DDR5" };

function mainGpu(r) {
  const gpus = arr(r.gpus);
  // La más potente: en portátiles con Ryzen la integrada "AMD Radeon Graphics" puede salir antes que la NVIDIA.
  return gpus.reduce((best, g) => (!best || scoreOf(g.Name, 4) > scoreOf(best.Name, 4) ? g : best), null) ?? { Name: "Desconocida" };
}

// NVIDIA: 32.0.16.1714 -> 617.14 (los 5 últimos dígitos de los dos últimos grupos)
function nvidiaVersion(v) {
  const p = (v ?? "").split(".");
  if (p.length < 4) return v;
  const d = (p[2] + p[3]).slice(-5);
  return `${d.slice(0, 3)}.${d.slice(3)}`;
}

const monthsSince = (date) => Math.floor((Date.now() - new Date(date).getTime()) / (30.44 * 864e5));

export async function specs() {
  const r = await raw();
  const gpu = mainGpu(r);
  const vram = arr(r.vram).find((v) => v.DriverDesc === gpu.Name)?.Mem;
  const ram = arr(r.ram);
  const ramGb = Math.round(ram.reduce((s, m) => s + Number(m.Capacity), 0) / GB);
  const ramType = RAM_TYPES[ram[0]?.SMBIOSMemoryType] ?? "";
  const ramMhz = ram[0]?.ConfiguredClockSpeed;
  const age = gpu.DriverDate ? monthsSince(gpu.DriverDate) : null;
  const isNv = /nvidia/i.test(gpu.Name);
  return {
    cpu: `${r.cpu.Name.replace(/\(R\)|\(TM\)|CPU|\d+(th|rd|nd|st) Gen/gi, "").replace(/\s+/g, " ").trim()} · ${r.cpu.NumberOfCores} núcleos`,
    gpu: `${gpu.Name.replace(/\s+/g, " ")}${vram && !/\d+\s?GB/i.test(gpu.Name) ? ` ${Math.round(vram / GB)} GB` : ""}`,
    ram: `${ramGb} GB ${ramType} a ${ramMhz} MHz`.replace(/\s+/g, " "),
    disk: `${r.disk.Name} ${Math.round(r.disk.Size / 1e9)} GB${r.disk.Bus === "NVMe" ? " (NVMe)" : ""}`,
    os: `${r.os.Name.replace("Microsoft ", "")} ${r.os.Version ?? ""}`.trim(),
    driver: `${isNv ? "GeForce " + nvidiaVersion(gpu.DriverVersion) : gpu.DriverVersion}${age === null ? "" : age < 1 ? " (este mes)" : ` (hace ${age} ${age === 1 ? "mes" : "meses"})`}`,
  };
}

/* ---------- Potencia de la gráfica ---------- */

// Tipo de disco de cada letra: "NVMe" | "SSD" | "HDD" | null.
function driveTypes(r) {
  const out = {};
  for (const d of arr(r.drives)) {
    out[d.L.toUpperCase()] = d.Bus === "NVMe" ? "NVMe" : d.Media === "SSD" ? "SSD" : d.Media === "HDD" ? "HDD" : null;
  }
  return out;
}

/** Olvida lo leído del hardware y los drivers (tras cambiar de monitor, actualizar un driver, enchufar una gráfica…). */
export function redetect() {
  rawCache = null;
  driversCache = null;
  wattsCache = null;
  hasNvidiaSmi = true;
  winGpu = null;
  clearOnline();
}

// Pantalla donde se juega: la principal (ahí abren los juegos), con su resolución real y sus Hz.
// Con un monitor externo de 144 Hz, Windows puede dar los datos de la pantalla del portátil; Electron da los de cada pantalla.
function gameScreen(r) {
  try {
    const all = screen.getAllDisplays();
    const d = screen.getPrimaryDisplay();
    const w = Math.round(d.bounds.width * d.scaleFactor), h = Math.round(d.bounds.height * d.scaleFactor);
    if (w > 0 && h > 0) return { refresh: Math.round(d.displayFrequency) || Number(r.refresh) || 60, resW: w, resH: h, pixels: w * h, screens: all.length };
  } catch { /* antes de que Electron esté listo: lo que diga Windows */ }
  const w = Number(arr(r.res)[0]) || 1920, h = Number(arr(r.res)[1]) || 1080;
  return { refresh: Number(r.refresh) || 60, resW: w, resH: h, pixels: w * h, screens: 1 };
}

// Potencia máxima de una gráfica NVIDIA de portátil (W): la misma RTX 4060 Laptop va de 45 W a 140 W según el modelo.
let wattsCache = null;
function nvidiaWatts() {
  wattsCache ??= run("nvidia-smi", ["--query-gpu=power.max_limit", "--format=csv,noheader,nounits", "-i", "0"], { windowsHide: true })
    .then(({ stdout }) => Number.parseFloat(stdout) || null, () => null);
  return wattsCache;
}

export async function hardware() {
  const r = await raw();
  const gpu = mainGpu(r);
  const laptop = Boolean(r.laptop);
  const ram = arr(r.ram);
  const ramGb = Math.round(ram.reduce((s, m) => s + Number(m.Capacity), 0) / GB);
  const vram = arr(r.vram).find((v) => v.DriverDesc === gpu.Name)?.Mem;
  let vramGb = vram ? Math.round(vram / GB) : null;
  // Integradas: usan la RAM del sistema; Windows les deja hasta la mitad, en la práctica ~1/4 sin tirones.
  if (isIntegrated(gpu.Name)) vramGb = Math.max(vramGb ?? 0, Math.min(Math.floor(ramGb / 4), 8)) || null;
  // Dedicada sin dato de memoria: el número del nombre ("RTX 3050 6GB") o 4 GB (lo más común).
  else if (!vramGb) vramGb = Number(gpu.Name.match(/(\d+)\s*GB/i)?.[1]) || 4;
  const watts = laptop && /nvidia/i.test(gpu.Name) ? await nvidiaWatts() : null;
  const threads = Number(r.cpu.NumberOfLogicalProcessors) || null;
  return {
    cpu: r.cpu.Name.replace(/\s+/g, " ").trim(),
    cpuScore: cpuScoreOf(r.cpu.Name, threads),
    threads,
    ramGb,
    ramType: RAM_TYPES[ram[0]?.SMBIOSMemoryType] ?? null,
    ramMhz: Number(ram[0]?.ConfiguredClockSpeed) || null,
    ramModules: ram.length,
    drives: driveTypes(r),
    gpu: gpu.Name,
    // Para elegir variante (RTX 3060 de 8 o 12 GB) solo vale la memoria medida, no la estimada.
    score: scoreOf(gpu.Name, vram ? Math.round(vram / GB) : null, { laptop, watts }),
    gpuWatts: watts,
    vendor: /nvidia/i.test(gpu.Name) ? "nvidia" : /amd|radeon/i.test(gpu.Name) ? "amd" : /intel/i.test(gpu.Name) ? "intel" : "other",
    vramGb,
    ...gameScreen(r),
    laptop,
    multiGpu: Number(r.gpuCount) > 1,
    docs: r.docs,
  };
}

// Estado de energía en este momento (cambia: se consulta al calcular, con caché corta).
let powerCache = null;
export async function powerNow() {
  if (powerCache && Date.now() - powerCache.at < 15000) return powerCache.value;
  const r = await ps(`[pscustomobject]@{
      battery = [int](Get-CimInstance Win32_Battery | Select-Object -First 1).BatteryStatus
      plan = (powercfg /getactivescheme) -replace '^.*\\((.*)\\)\\s*$', '$1'
    } | ConvertTo-Json -Compress`).catch(() => null);
  // BatteryStatus 1/4/5 = descargándose (sin cargador). 0 = no hay batería.
  const value = { onBattery: [1, 4, 5].includes(r?.battery), plan: r?.plan ?? "" };
  powerCache = { at: Date.now(), value };
  return value;
}

/* ---------- Uso en vivo (barato: sin PowerShell) ---------- */

const cpuTimes = () => os.cpus().reduce((a, c) => {
  const t = c.times;
  a.idle += t.idle;
  a.total += t.user + t.nice + t.sys + t.irq + t.idle;
  return a;
}, { idle: 0, total: 0 });

let prev = cpuTimes();
let hasNvidiaSmi = true;

// AMD/Intel: el uso sale del contador de Windows (tarda ~1 s): se lanza en segundo plano y se devuelve la última lectura.
let winGpu = null;
let winGpuBusy = false;
function windowsGpuUsage() {
  if (!winGpuBusy) {
    winGpuBusy = true;
    run("typeperf", ["\\GPU Engine(*engtype_3D)\\Utilization Percentage", "-sc", "1"], { windowsHide: true, timeout: 5000 })
      .then(({ stdout }) => {
        // Cabecera: una columna por proceso y motor, con el adaptador ("luid_0x..._0x...") en el nombre.
        // Se suma por adaptador y se toma el más cargado: en portátiles con dos gráficas no se mezclan.
        const lines = stdout.split(/\r?\n/);
        const head = lines.find((l) => l.startsWith('"(PDH'))?.split('","') ?? [];
        const row = lines.find((l) => /^"\d/.test(l))?.split('","') ?? [];
        const byAdapter = new Map();
        head.forEach((h, i) => {
          const luid = h.match(/luid_0x[0-9a-f]+_0x[0-9a-f]+/i)?.[0];
          if (luid) byAdapter.set(luid, (byAdapter.get(luid) ?? 0) + (Number.parseFloat(String(row[i]).replace(/"/g, "")) || 0));
        });
        if (byAdapter.size) winGpu = Math.min(100, Math.round(Math.max(...byAdapter.values())));
      }, () => {})
      .finally(() => { winGpuBusy = false; });
  }
  return winGpu;
}

async function gpuUsage() {
  if (!hasNvidiaSmi) return windowsGpuUsage();
  try {
    const { stdout } = await run("nvidia-smi", ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 3000 });
    return Number.parseInt(stdout, 10);
  } catch (e) {
    // Solo si nvidia-smi no existe se pasa al contador de Windows; un fallo puntual no cambia la fuente.
    if (e.code === "ENOENT") { hasNvidiaSmi = false; return windowsGpuUsage(); }
    return null;
  }
}

function diskUsedPct() {
  const s = statfsSync("C:\\");
  return Math.round((1 - s.bavail / s.blocks) * 100);
}

export async function usage() {
  const now = cpuTimes();
  const idle = now.idle - prev.idle;
  const total = now.total - prev.total;
  prev = now;
  return {
    cpu: total > 0 ? Math.round((1 - idle / total) * 100) : 0,
    ram: Math.round((1 - os.freemem() / os.totalmem()) * 100),
    gpu: await gpuUsage(),
    disk: diskUsedPct(),
  };
}

/* ---------- Programas de inicio ---------- */

// Cada programa de inicio tiene su interruptor en una clave "StartupApproved" (lo mismo que usa el Administrador de tareas).
const APPROVED = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved";
export const STARTUP_SOURCES = [
  { run: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", approved: `HKCU:\\${APPROVED}\\Run`, admin: false },
  { run: "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", approved: `HKLM:\\${APPROVED}\\Run`, admin: true },
  { run: "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run", approved: `HKLM:\\${APPROVED}\\Run32`, admin: true },
  { folder: "Startup", approved: `HKCU:\\${APPROVED}\\StartupFolder`, admin: false },
  { folder: "CommonStartup", approved: `HKLM:\\${APPROVED}\\StartupFolder`, admin: true },
];

export async function startupApps() {
  const sources = JSON.stringify(STARTUP_SOURCES).replace(/'/g, "''");
  const list = await ps(`
    function Exe($cmd) { if ($cmd -match '^"([^"]+)"') { $matches[1] } elseif ($cmd -match '^(.+?\\.exe)') { $matches[1] } else { $cmd } }
    $sh = New-Object -ComObject WScript.Shell
    $out = @()
    foreach ($s in ('${sources}' | ConvertFrom-Json)) {
      $ap = Get-ItemProperty $s.approved
      $items = @()
      if ($s.run) {
        $p = Get-ItemProperty $s.run
        if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
          $items += [pscustomobject]@{ key = $_.Name; exe = Exe ([Environment]::ExpandEnvironmentVariables([string]$_.Value)) } } }
      } else {
        Get-ChildItem ([Environment]::GetFolderPath($s.folder)) -Filter *.lnk | ForEach-Object {
          $items += [pscustomobject]@{ key = $_.Name; exe = $sh.CreateShortcut($_.FullName).TargetPath } }
      }
      foreach ($i in $items) {
        $vi = (Get-Item $i.exe).VersionInfo
        $state = $null; if ($ap) { $state = $ap.($i.key) }
        $out += [pscustomobject]@{
          id = $s.approved + '|' + $i.key
          name = $(if ($vi.FileDescription -and $vi.FileDescription -notmatch '^(update|updater|launcher|setup)$') { $vi.FileDescription } else { $i.key -replace '\\.lnk$','' -replace '^(electron\\.app\\.|com\\.\\w+\\.)','' })
          publisher = [string]$vi.CompanyName
          enabled = ($null -eq $state) -or ($state[0] % 2 -eq 0)
          scope = $(if ($s.admin) { 'machine' } else { 'user' })
        }
      }
    }
    ConvertTo-Json -Compress -InputObject @($out)
  `);
  return arr(list).sort((a, b) => Number(b.enabled) - Number(a.enabled));
}

/* ---------- Juegos instalados ---------- */

const NOT_GAMES = /redistributable|steamworks|proton|steam linux runtime|sdk|dedicated server|soundtrack|wallpaper engine/i;

export async function steamPath() {
  try {
    const { stdout } = await run("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { windowsHide: true });
    return stdout.match(/SteamPath\s+REG_SZ\s+(.+)/)?.[1].trim() ?? null;
  } catch {
    return existsSync("C:\\Program Files (x86)\\Steam") ? "C:\\Program Files (x86)\\Steam" : null;
  }
}

async function steamLibraries() {
  const root = await steamPath();
  if (!root) return [];
  const vdf = await fs.readFile(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8").catch(() => "");
  const libs = [...vdf.matchAll(/"path"\s+"(.+?)"/g)].map((m) => m[1].replace(/\\\\/g, "\\"));
  return (libs.length ? libs : [root]).map((l) => path.join(l, "steamapps"));
}

const EPIC_DIR = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";
const RIOT_DIR = "C:\\ProgramData\\Riot Games\\Metadata";

// Carpetas donde las tiendas apuntan cada juego instalado: si cambian, hay juegos nuevos o borrados.
export async function gameDirs() {
  const xbox = [..."CDEFGHIJ"].map((l) => `${l}:\\XboxGames`);
  return [...(await steamLibraries()), EPIC_DIR, RIOT_DIR, ...xbox].filter((d) => existsSync(d));
}

async function steamGames() {
  const games = [];
  for (const dir of await steamLibraries()) {
    const files = await fs.readdir(dir).catch(() => []);
    for (const f of files.filter((f) => /^appmanifest_\d+\.acf$/.test(f))) {
      const acf = await fs.readFile(path.join(dir, f), "utf8").catch(() => "");
      const get = (k) => acf.match(new RegExp(`"${k}"\\s+"(.*?)"`))?.[1];
      const id = get("appid");
      const name = get("name");
      // StateFlags & 4 = instalado del todo (mientras se descarga no aparece).
      if (!id || !name || id === "228980" || NOT_GAMES.test(name) || !(Number(get("StateFlags")) & 4)) continue;
      games.push({
        id: `steam-${id}`,
        name,
        store: "Steam",
        image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
        sizeGb: Math.round((Number(get("SizeOnDisk")) / GB) * 10) / 10,
        path: path.join(dir, "common", get("installdir") ?? ""),
      });
    }
  }
  return games;
}

async function epicGames() {
  const dir = EPIC_DIR;
  const files = await fs.readdir(dir).catch(() => []);
  const games = [];
  for (const f of files.filter((f) => f.endsWith(".item"))) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
      if (!j.AppCategories?.includes("games") || j.bIsIncompleteInstall) continue;
      games.push({
        id: `epic-${j.AppName}`,
        name: j.DisplayName,
        store: "Epic",
        image: "",
        catalogId: j.CatalogItemId, // para su portada en el catálogo local de Epic
        sizeGb: Math.round((j.InstallSize / GB) * 10) / 10,
        path: j.InstallLocation,
      });
    } catch { /* manifiesto dañado: se ignora */ }
  }
  return games;
}

const RIOT_NAMES = {
  "league_of_legends.live": "League of Legends",
  "league_of_legends.pbe": "League of Legends (PBE)",
  "teamfighttactics.live": "Teamfight Tactics",
  "valorant.live": "VALORANT",
  "lion.live": "2XKO",
};

async function riotGames() {
  const dir = RIOT_DIR;
  const products = await fs.readdir(dir).catch(() => []);
  const games = [];
  for (const p of products) {
    if (!RIOT_NAMES[p] || p.endsWith(".pbe")) continue;
    const yaml = await fs.readFile(path.join(dir, p, `${p}.product_settings.yaml`), "utf8").catch(() => "");
    const install = yaml.match(/product_install_full_path:\s*"(.+?)"/)?.[1];
    if (!install || !existsSync(install)) continue;
    // ponytail: sin tamaño; recorrer 20 GB de archivos es lento. Añadir si hace falta.
    games.push({ id: `riot-${p}`, name: RIOT_NAMES[p], store: "Riot", image: "", sizeGb: null, path: install });
  }
  return games;
}

// GOG, Ubisoft Connect, EA app, Battle.net y Rockstar: todos dejan rastro en el registro de Windows.
const LAUNCHER_PUBLISHERS = [
  [/electronic arts|ea swiss/i, "EA"],
  [/blizzard|activision/i, "Battle.net"],
  [/rockstar/i, "Rockstar"],
  [/ubisoft/i, "Ubisoft"],
];
const NOT_A_GAME = /launcher|\bapp\b|connect|social club|sdk|battle\.net|redistributable|anticheat|anti-cheat|easy ?anti|uninstall|origin$/i;

async function registryGames() {
  const rows = arr(await ps(`
    $out = @()
    Get-ChildItem 'HKLM:\\SOFTWARE\\WOW6432Node\\GOG.com\\Games' | ForEach-Object {
      $p = Get-ItemProperty $_.PSPath
      $out += [pscustomobject]@{ store = 'GOG'; id = [string]$p.gameID; name = [string]$p.gameName; path = [string]$p.path }
    }
    Get-ChildItem 'HKLM:\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs' | ForEach-Object {
      $p = Get-ItemProperty $_.PSPath
      if ($p.InstallDir) { $out += [pscustomobject]@{ store = 'Ubisoft'; id = $_.PSChildName; name = (Split-Path ([string]$p.InstallDir).TrimEnd('/','\\') -Leaf); path = [string]$p.InstallDir } }
    }
    Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' |
      Where-Object { $_.Publisher -match 'Electronic Arts|EA Swiss|Blizzard|Activision|Rockstar|Ubisoft' -and $_.InstallLocation -and $_.DisplayName } |
      ForEach-Object { $out += [pscustomobject]@{ store = 'uninstall'; id = $_.PSChildName; name = [string]$_.DisplayName; path = [string]$_.InstallLocation; publisher = [string]$_.Publisher } }
    ConvertTo-Json -Compress -InputObject @($out)
  `).catch(() => []));

  const games = [];
  for (const r of rows) {
    if (!r.path || !existsSync(r.path) || NOT_A_GAME.test(r.name)) continue;
    const store = r.store === "uninstall" ? LAUNCHER_PUBLISHERS.find(([re]) => re.test(r.publisher))?.[1] : r.store;
    if (!store) continue;
    games.push({ id: `${store.toLowerCase().replace(/\W/g, "")}-${r.id}`, name: r.name.trim(), store, image: "", sizeGb: null, path: r.path });
  }
  return games;
}

// Xbox / Game Pass: cada unidad puede tener su carpeta de juegos (la indica el archivo .GamingRoot; por defecto XboxGames).
async function xboxGames() {
  const games = [];
  for (const letter of "CDEFGHIJ") {
    const root = `${letter}:\\`;
    if (!existsSync(root)) continue;
    let folder = path.join(root, "XboxGames");
    const gr = await fs.readFile(path.join(root, ".GamingRoot")).catch(() => null);
    if (gr && gr.length > 8) {
      const name = gr.subarray(8).toString("utf16le").replace(/\0.*$/s, "");
      if (name) folder = path.join(root, name);
    }
    for (const d of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (!d.isDirectory()) continue;
      const cfg = await fs.readFile(path.join(folder, d.name, "Content", "MicrosoftGame.config"), "utf8").catch(() => null);
      if (!cfg) continue;
      const name = cfg.match(/DefaultDisplayName="([^"]+)"/)?.[1] ?? d.name;
      if (NOT_A_GAME.test(name) || name.startsWith("ms-resource")) continue;
      games.push({ id: `xbox-${d.name}`, name, store: "Xbox", image: "", sizeGb: null, path: path.join(folder, d.name, "Content") });
    }
  }
  return games;
}

// Roblox: no tiene tienda, pero sí ajustes de gráficos propios.
async function robloxGame() {
  const dir = path.join(process.env.LOCALAPPDATA ?? "", "Roblox");
  return existsSync(path.join(dir, "Versions")) ? [{ id: "roblox-player", name: "Roblox", store: "Roblox", image: "", sizeGb: null, path: dir }] : [];
}

const STORE_ORDER = ["Steam", "Epic", "Riot", "Xbox", "EA", "Ubisoft", "Battle.net", "GOG", "Rockstar", "Roblox"];

export async function games() {
  const all = (await Promise.all([steamGames(), epicGames(), riotGames(), registryGames(), xboxGames(), robloxGame()])).flat();
  // El mismo juego en dos tiendas (p. ej. Apex en Steam y en EA): se queda uno.
  const seen = new Set();
  const unique = all
    .sort((a, b) => STORE_ORDER.indexOf(a.store) - STORE_ORDER.indexOf(b.store))
    .filter((g) => {
      const k = g.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  await addCovers(unique).catch(() => {}); // portadas de los que no son de Steam
  return unique.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/* ---------- Drivers y BIOS (solo lectura) ---------- */

// Páginas oficiales de descarga. Nunca se descarga ni instala nada solo: se abre la página del fabricante.
const GPU_PAGES = {
  nvidia: "https://www.nvidia.com/es-es/geforce/drivers/",
  amd: "https://www.amd.com/es/support/download/drivers.html",
  intel: "https://www.intel.com/content/www/us/en/support/detect.html",
};
const OEM_PAGES = [
  [/lenovo/i, "https://pcsupport.lenovo.com/"],
  [/hewlett|^hp\b/i, "https://support.hp.com/drivers"],
  [/dell|alienware/i, "https://www.dell.com/support/home"],
  [/asus/i, "https://www.asus.com/support/download-center/"],
  [/acer/i, "https://www.acer.com/us-en/support/drivers-and-manuals"],
  [/micro-star|msi/i, "https://www.msi.com/support/download"],
  [/gigabyte|aorus/i, "https://www.gigabyte.com/Support"],
  [/asrock/i, "https://www.asrock.com/support/"],
  [/samsung/i, "https://www.samsung.com/support/"],
  [/razer/i, "https://mysupport.razer.com/"],
  [/microsoft/i, "https://support.microsoft.com/surface"],
];
export const WINDOWS_UPDATE = "ms-settings:windowsupdate-optionalupdates";

// Herramienta oficial de cada fabricante (app: cómo se llama en el menú Inicio; get: dónde conseguirla si no está).
const OEM_TOOLS = [
  { maker: /lenovo/i, name: "Lenovo Vantage", app: /vantage|legion space/i, get: "ms-windows-store://pdp/?productid=9WZDNCRFJ4MV" },
  { maker: /hewlett|^hp\b/i, name: "HP Support Assistant", app: /support assistant/i, get: "https://support.hp.com/us-en/help/hp-support-assistant" },
  { maker: /dell|alienware/i, name: "Dell SupportAssist", app: /supportassist|command \| update/i, get: "https://www.dell.com/en-us/lp/dt/supportassist-for-home-pcs" },
  { maker: /asus/i, name: "MyASUS", app: /myasus|armoury crate/i, get: "ms-windows-store://pdp/?productid=9N7R5S6B0ZZH" },
  { maker: /acer/i, name: "Acer Care Center", app: /care center/i, get: "https://www.acer.com/us-en/support/drivers-and-manuals" },
  { maker: /micro-star|msi/i, name: "MSI Center", app: /msi center|dragon center/i, get: "https://www.msi.com/Landing/MSI-Center" },
];

const GPU_TOOLS = [
  { vendor: /amd|radeon/i, app: /amd software|radeon software|adrenalin/i },
  { vendor: /intel/i, app: /intel.*(driver|graphics)|arc control/i },
];

// Abre una app del menú Inicio por su id (solo ids que salen de la propia lectura de Get-StartApps).
const openApp = (appId) => run("explorer.exe", [`shell:AppsFolder\\${appId}`], { windowsHide: true }).catch(() => {}); // explorer devuelve 1 aunque abra

/** Abre la herramienta del fabricante si está instalada; si no, su página de descarga. */
export async function openOemTool() {
  const t = (await localDrivers()).oemTool;
  if (!t) return null;
  if (t.installed && t.appId) {
    await openApp(t.appId);
    return `Se abrió ${t.name}.`;
  }
  return t.get;
}

/** Abre el programa del fabricante de la gráfica de esa fila (AMD Software, Intel DSA). false si no hay. */
export async function openGpuTool(itemId) {
  const it = (await localDrivers()).items.find((i) => i.id === itemId);
  if (!it?.toolAppId) return false;
  await openApp(it.toolAppId);
  return true;
}

// online: pregunta a Windows Update y a NVIDIA (tarda ~15 s). Sin él se usa lo ya consultado o, si no hay, la antigüedad.
export async function drivers({ online = false } = {}) {
  const base = await localDrivers();
  const nvGpus = base.items.filter((i) => i.group === "Gráfica" && /nvidia/i.test(i.name));
  const [wu, ...nv] = await Promise.all([windowsUpdateDrivers(!online), ...nvGpus.map((g) => nvidiaLatest(g.name, !online))]);
  return withOnline(base, wu, new Map(nvGpus.map((g, k) => [g.id, nv[k]])));
}

// Clase de driver de Windows Update → grupo de la lista.
const WU_GROUP = { display: ["Gráfica"], net: ["Wi-Fi", "Red cableada"], media: ["Audio"], bluetooth: ["Bluetooth"], system: ["Chipset"], firmware: ["BIOS"] };
const plainName = (s) => String(s).toLowerCase().replace(/(r)|(tm)|[^a-z0-9]+/g, " ").trim();

function withOnline(base, wu, nv) {
  const pending = [...(wu ?? [])];
  const items = base.items.map((i) => {
    const item = { ...i, latest: null, source: "antigüedad" };
    const latestNv = nv.get(i.id);
    if (latestNv) {
      // NVIDIA: se compara la versión instalada con la última publicada.
      item.latest = latestNv.version;
      item.source = "nvidia";
      item.outdated = compareVersions(i.version, latestNv.version) < 0;
      if (latestNv.url) item.page = latestNv.url;
    }
    if (wu) {
      const k = pending.findIndex((u) => WU_GROUP[u.cls.toLowerCase()]?.includes(i.group) &&
        // Nombre exacto: "RTX 3060" no debe emparejar con "RTX 3060 Ti". Lo que no encaje va a la fila «Windows Update».
        (["Chipset", "BIOS"].includes(i.group) || (plainName(u.model) !== "" && plainName(u.model) === plainName(i.name))));
      if (k >= 0) {
        const [u] = pending.splice(k, 1);
        // Manda Windows Update, salvo que NVIDIA ya tenga una versión más nueva (esa es la que conviene).
        if (!(item.source === "nvidia" && item.outdated)) Object.assign(item, { source: "windows-update", latest: u.title, page: WINDOWS_UPDATE });
        item.outdated = true;
      } else if (item.source === "antigüedad" && i.group !== "BIOS") {
        // Windows Update no tiene nada nuevo para este dispositivo. (La BIOS no siempre llega por ahí: se sigue estimando por antigüedad.)
        item.source = "windows-update";
        item.outdated = false;
      }
    }
    return item;
  });
  // Lo que Windows Update tiene pendiente y no encaja con ningún dispositivo de la lista.
  if (pending.length) {
    items.push({
      id: "wu-pending", group: "Windows Update", name: pending.map((u) => u.title).join(" · "),
      version: `${pending.length} ${pending.length === 1 ? "pendiente" : "pendientes"}`, date: null, ageMonths: null, outdated: true,
      page: WINDOWS_UPDATE, note: "Drivers que el fabricante publica por Windows Update. Se instalan desde «Actualizaciones opcionales».",
      latest: null, source: "windows-update",
    });
  }
  return { ...base, items, checked: { windowsUpdate: wu != null, nvidia: [...nv.values()].some(Boolean) } };
}

let driversCache = null;
async function localDrivers() {
  if (driversCache && Date.now() - driversCache.at < 10 * 60000) return driversCache.value;
  const r = await ps(`
    $b = Get-CimInstance Win32_BIOS; $c = Get-CimInstance Win32_ComputerSystem; $bb = Get-CimInstance Win32_BaseBoard; $cp = Get-CimInstance Win32_ComputerSystemProduct
    [pscustomobject]@{
      tools = @(Get-StartApps | Where-Object { $_.Name -match 'Vantage|Legion Space|Support Assistant|SupportAssist|Command \\| Update|MyASUS|Armoury Crate|Care Center|MSI Center|Dragon Center|AMD Software|Radeon Software|Adrenalin|Intel.*Driver.*Support|Intel.*Graphics|Arc Control' } | Select-Object Name, AppID)
      bios = [pscustomobject]@{ maker = [string]$b.Manufacturer; version = [string]$b.SMBIOSBIOSVersion; date = $b.ReleaseDate.ToString('yyyy-MM-dd') }
      pc = [pscustomobject]@{ maker = [string]$c.Manufacturer; model = [string]$c.Model; product = [string]$cp.Version; board = [string]$bb.Manufacturer; boardModel = [string]$bb.Product }
      drivers = @(Get-CimInstance Win32_PnPSignedDriver |
        Where-Object { $_.DeviceClass -in 'DISPLAY','NET','MEDIA','BLUETOOTH','SYSTEM' -and $_.DeviceName -and $_.DriverDate -and $_.DriverProviderName -ne 'Microsoft' } |
        Select-Object @{n='cls';e={$_.DeviceClass}}, @{n='name';e={$_.DeviceName}}, @{n='provider';e={$_.DriverProviderName}},
          @{n='version';e={$_.DriverVersion}}, @{n='date';e={$_.DriverDate.ToString('yyyy-MM-dd')}})
    } | ConvertTo-Json -Compress -Depth 4
  `);

  const pcMaker = r.pc.maker;
  // PC montado por piezas: Windows da un fabricante o un modelo genérico ("System Product Name" en placas ASUS).
  const generic = /to be filled|system manufacturer|system product name|default string|o\.e\.m|^$/i;
  const genericMaker = generic.test(pcMaker) || generic.test(r.pc.model);
  const oemSource = genericMaker ? r.pc.board : pcMaker; // PC montado por piezas: manda la placa base
  const oemPage = OEM_PAGES.find(([re]) => re.test(oemSource))?.[1] ?? WINDOWS_UPDATE;
  // Lenovo guarda el nombre comercial ("LOQ 15IRH8") en Version; el modelo es un código ("82XV").
  const model = /lenovo/i.test(pcMaker) && r.pc.product && !/^none$/i.test(r.pc.product) ? r.pc.product : r.pc.model;
  const oemName = genericMaker ? `${r.pc.board} ${r.pc.boardModel}`.trim() : `${pcMaker[0]}${pcMaker.slice(1).toLowerCase()} ${model}`.trim();
  // Portátiles y PCs de marca: la herramienta oficial del fabricante instala los drivers y la BIOS exactos de cada modelo.
  const tool = genericMaker ? null : OEM_TOOLS.find((t) => t.maker.test(pcMaker));
  const found = tool && arr(r.tools).find((a) => tool.app.test(a.Name));
  const oemTool = tool ? { name: found?.Name ?? tool.name, installed: Boolean(found), appId: found?.AppID ?? null, get: tool.get } : null;

  // Fechas que no son reales: Intel pone 1968 en sus INF de chipset y Windows 21/06/2006 en sus drivers de serie.
  const realDate = (d) => d && d >= "2008";
  const months = (d) => (realDate(d) ? monthsSince(d) : null);
  const list = arr(r.drivers);
  const items = [];
  const add = (id, group, name, version, date, page, limit, note) => {
    const age = months(date);
    items.push({ id, group, name, version, date: realDate(date) ? date : null, ageMonths: age, outdated: age != null && age > limit, page, note });
  };

  add("bios", "BIOS", `${r.bios.maker} ${r.bios.version}`.trim(), r.bios.version, r.bios.date, oemPage, 18,
    "Actualízala solo desde la página oficial y con el portátil enchufado. Gamer Config nunca la actualiza sola.");

  for (const g of list.filter((d) => d.cls === "DISPLAY")) {
    const vendor = /nvidia/i.test(g.name) ? "nvidia" : /amd|radeon/i.test(g.name) ? "amd" : /intel/i.test(g.name) ? "intel" : null;
    add(`gpu-${items.length}`, "Gráfica", g.name, /nvidia/i.test(g.name) ? nvidiaVersion(g.version) : g.version, g.date, GPU_PAGES[vendor] ?? oemPage, 4,
      "El driver de la gráfica es el que más influye en los juegos: conviene tenerlo al día.");
  }

  // Chipset: drivers de sistema de Intel/AMD con fecha real; se muestra el más antiguo como referencia.
  const chipset = list.filter((d) => d.cls === "SYSTEM" && /intel|amd|advanced micro/i.test(`${d.provider} ${d.name}`) && realDate(d.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (chipset.length) {
    const c = chipset[0];
    add("chipset", "Chipset", `${/amd|advanced micro/i.test(c.provider) ? "AMD" : "Intel"} (${chipset.length} drivers)`, c.version, c.date, oemPage, 24,
      "Controlan la placa base. Los del fabricante del portátil o la placa son los más seguros.");
  }

  for (const n of list.filter((d) => d.cls === "NET" && !/virtual|miniport|wan|bluetooth|vpn|tap|hyper-v|wi-?fi direct|kernel debug/i.test(d.name))) {
    add(`net-${items.length}`, /wi-?fi|wireless|802\.11|wlan/i.test(n.name) ? "Wi-Fi" : "Red cableada", n.name, n.version, n.date, oemPage, 24,
      "Influye en la estabilidad del ping y en las desconexiones.");
  }

  const audio = list.filter((d) => d.cls === "MEDIA" && !/virtual|nahimic|nvidia|amd high definition|intel.*display|bluetooth|mirroring|vad\b/i.test(d.name));
  for (const a of audio.slice(0, 2)) add(`audio-${items.length}`, "Audio", a.name, a.version, a.date, oemPage, 30, null);

  const bt = list.find((d) => d.cls === "BLUETOOTH" && !/enumerator|le |rfcomm|microsoft/i.test(d.name));
  if (bt) add("bt", "Bluetooth", bt.name, bt.version, bt.date, oemPage, 30, "Afecta a mandos y auriculares inalámbricos.");

  // Gráficas AMD e Intel: su programa oficial (AMD Software, Intel Driver & Support Assistant) busca e instala su driver.
  for (const it of items.filter((i) => i.group === "Gráfica")) {
    const t = GPU_TOOLS.find((x) => x.vendor.test(it.name));
    const a = t && arr(r.tools).find((x) => t.app.test(x.Name));
    if (a) Object.assign(it, { toolName: a.Name, toolAppId: a.AppID });
  }
  const value = { pc: oemName, oemPage, items, oemTool };
  driversCache = { at: Date.now(), value };
  return value;
}

/* ---------- Análisis ---------- */

async function folderSize(dir) {
  let total = 0;
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter((e) => e.isFile()).map(async (e) => {
    const s = await fs.stat(path.join(e.parentPath, e.name)).catch(() => null);
    if (s) total += s.size;
  }));
  return total;
}

const fmtGb = (b) => (b / GB).toLocaleString("es", { maximumFractionDigits: 1 });

export async function scan() {
  const [r, apps, temp] = await Promise.all([raw(), startupApps(), folderSize(os.tmpdir())]);
  const out = [];
  const gpu = mainGpu(r);
  const ram = arr(r.ram);
  const type = RAM_TYPES[ram[0]?.SMBIOSMemoryType];
  const mhz = Number(ram[0]?.ConfiguredClockSpeed);

  // Memoria a velocidad base de fábrica: típico cuando XMP/EXPO está desactivado. En portátiles no se puede cambiar.
  if (!r.laptop && ((type === "DDR4" && mhz <= 2666) || (type === "DDR5" && mhz <= 4800))) {
    out.push({
      id: "xmp", severity: "media", action: null,
      title: `La RAM va a ${mhz} MHz`,
      detail: `Es la velocidad base de ${type}. Si tu memoria admite más, activa XMP/EXPO en la BIOS: suele dar más FPS en juegos limitados por la CPU.`,
    });
  }

  if (ram.length === 1) {
    out.push({
      id: "single-channel", severity: "alta", action: null,
      title: "La RAM funciona en un solo canal",
      detail: "Tienes un único módulo de memoria. Añadir otro igual activa el doble canal, que suele dar bastantes más FPS en juegos limitados por la CPU.",
    });
  }

  if (/equilibrado|balanced|ahorro|saver/i.test(r.plan)) {
    out.push({
      id: "power", severity: "media", action: "Cambiar plan",
      title: `Plan de energía en «${r.plan}»`,
      detail: "Cambiarlo a «Alto rendimiento» evita que la CPU baje de frecuencia mientras juegas.",
    });
  }

  // Drivers y BIOS: la gráfica pesa más (afecta directamente a los juegos).
  const drv = await drivers({ online: true }).catch(() => ({ items: [] }));
  const oldGpu = drv.items.filter((i) => i.group === "Gráfica" && i.outdated);
  const oldOther = drv.items.filter((i) => i.group !== "Gráfica" && i.outdated);
  for (const g of oldGpu) {
    out.push({
      id: "driver", severity: g.ageMonths >= 8 ? "media" : "baja", action: "Revisar",
      title: "Driver de la gráfica desactualizado",
      detail: g.source === "nvidia" && g.latest
        ? `Tienes la ${g.version} y NVIDIA ya publicó la ${g.latest}. Los nuevos incluyen optimizaciones para juegos recientes.`
        : `El driver de tu ${g.name} tiene ${g.ageMonths} meses. Los nuevos incluyen optimizaciones para juegos recientes.`,
    });
  }
  if (oldOther.length) {
    out.push({
      id: "drivers", severity: "baja", action: "Revisar",
      title: `${oldOther.length === 1 ? "1 driver por actualizar" : `${oldOther.length} drivers por actualizar`}: ${oldOther.map((i) => i.group).join(", ")}`,
      detail: oldOther.some((i) => i.source === "windows-update")
        ? "Windows Update tiene actualizaciones de drivers para tu PC. Pueden corregir fallos de estabilidad, ping o sonido."
        : "Pueden corregir fallos de estabilidad, ping o sonido. Se actualizan desde la página oficial del fabricante.",
    });
  }

  const on = apps.filter((a) => a.enabled).length;
  if (on >= 5) {
    out.push({
      id: "startup", severity: on >= 10 ? "media" : "baja", action: "Revisar",
      title: `${on} programas se inician con Windows`,
      detail: "Consumen RAM y CPU en segundo plano desde que enciendes el PC. Desactiva los que no uses a diario.",
    });
  }

  const s = statfsSync("C:\\");
  const freePct = (s.bavail / s.blocks) * 100;
  if (freePct < 15 || temp > 2 * GB) {
    out.push({
      id: "temp", severity: freePct < 8 ? "alta" : "baja", action: "Limpiar",
      title: `Disco C: con ${fmtGb(s.bavail * s.bsize)} GB libres`,
      detail: `La carpeta de temporales ocupa ${fmtGb(temp)} GB y se puede vaciar sin riesgo.`,
    });
  }

  if (/nvidia|radeon/i.test(gpu.Name) && r.hags !== 2) {
    out.push({
      id: "hags", severity: "baja", action: "Activar",
      title: "Programación de GPU acelerada por hardware desactivada",
      detail: "Activarla puede reducir un poco la latencia en GPUs modernas. Requiere reiniciar.",
    });
  }

  if (r.gameMode === 0) {
    out.push({
      id: "gamemode", severity: "media", action: "Activar",
      title: "Modo de juego de Windows desactivado",
      detail: "Con el modo de juego, Windows da prioridad al juego y pausa actualizaciones mientras juegas.",
    });
  }

  const rank = { alta: 0, media: 1, baja: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
