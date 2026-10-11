// Única puerta entre la interfaz y el sistema.
// Dentro de la app de escritorio usa datos reales (window.afina, ver electron/preload.cjs).
// En el navegador (npm run dev) usa datos de ejemplo para poder diseñar sin Electron.

export type Severity = "alta" | "media" | "baja";
export type Goal = "fps" | "equilibrado" | "calidad";

export interface Specs { cpu: string; gpu: string; ram: string; disk: string; os: string; driver: string }
export interface Usage { cpu: number; ram: number; gpu: number | null; disk: number }
export interface Finding { id: string; title: string; detail: string; severity: Severity; action: string | null }
export interface StartupApp { id: string; name: string; publisher: string; enabled: boolean; scope: "user" | "machine" }

export interface Game {
  id: string;
  name: string;
  store: "Steam" | "Epic" | "Riot";
  image: string; // "" = sin portada
  sizeGb: number | null;
  status: "optimizado" | "optimizable" | "guía";
}

// Una pieza del PC en el cálculo: la tuya, lo que pide el juego y los FPS que daría.
export interface Part {
  name: string;
  score: number;
  demand: { text: string; kind: string; source: string; score: number } | null;
  fps: number;
}

export interface GameFile {
  file: string;
  format: string;
  total: number;
  entries: { key: string; name: string; value: string; category: string | null; sure: boolean | null; options: { value: string; label: string }[] | null }[];
}

export interface GameDetail {
  kind: "perfil" | "auto" | "detectado" | "guia"; // perfil del juego / plantilla del motor / leído de su archivo / guía
  files: GameFile[]; // todos los archivos de configuración del juego, con todos sus ajustes
  note: string | null;
  sources: { name: string; url: string }[];
  gpu: Part;
  cpu: Part;
  factors: { label: string; value: string; effect: "ok" | "info" | "penalty" | "warning"; note: string }[];
  bottleneck: "gpu" | "cpu";
  estMax: number;
  estFinal: number;
  target: number;
  reached: boolean;
  loweredNothing: boolean; // con todo al máximo ya se llega al objetivo
  canApply: boolean;
  configFound: boolean;
  hasBackup: boolean;
  settings: { name: string; key: string | null; why: string; change: boolean; current: string | null; recommended: string }[];
}

export interface DriverItem {
  id: string;
  group: string;
  name: string;
  version: string;
  date: string | null;
  ageMonths: number | null;
  outdated: boolean;
  note: string | null;
}
export interface DriverInfo { pc: string; items: DriverItem[] }

export interface WinItem {
  id: string;
  group: "juego" | "ligero" | "espacio" | "seguridad";
  title: string;
  body: string;
  cta: string;
  admin: boolean;
  relogin: boolean;
  reboot: boolean;
  done: boolean;
  recommended: boolean; // false = tu PC no lo necesita
  manual?: boolean; // Windows no deja cambiarlo desde otro programa: se abre Configuración
}
export interface WinState { low: boolean; lowReasons: string[]; items: WinItem[] }
export interface ApplyResult { name: string; status: "ok" | "same" | "guia" | "skip" | "error"; msg: string }
// verified: true = Windows confirma el cambio; false = no lo muestra aplicado; null = no hay nada que comprobar.
export interface ActionResult { msg: string; verified: boolean | null }
export interface HistoryEntry { id: number; label: string; at: string; undo: unknown; undone: boolean }

interface Bridge {
  specs(): Promise<Specs>;
  usage(): Promise<Usage>;
  scan(): Promise<Finding[]>;
  startup(): Promise<StartupApp[]>;
  games(): Promise<Game[]>;
  gameDetail(id: string, goal: Goal): Promise<GameDetail>;
  applyGame(id: string, goal: Goal): Promise<string>;
  restoreGame(id: string): Promise<string>;
  copyReport(id: string, goal: Goal): Promise<boolean>;
  applyAll(goal: Goal): Promise<ApplyResult[]>;
  setValues(id: string, file: string, changes: { key: string; value: string }[]): Promise<string>;
  winState(): Promise<WinState>;
  winAction(id: string, arg?: unknown): Promise<ActionResult>;
  history(): Promise<HistoryEntry[]>;
  undo(id: number): Promise<string>;
  drivers(): Promise<DriverInfo>;
  openUpdate(id: string): Promise<void>;
  onGamesChanged(cb: (added: { name: string; status: Game["status"] }[]) => void): void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const steam = (id: number) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;

// Datos de ejemplo para el navegador.
const mock: Bridge = {
  async specs() {
    await wait(300);
    return { cpu: "Intel Core i5-12450H · 8 núcleos", gpu: "NVIDIA GeForce RTX 3050 6GB Laptop GPU", ram: "16 GB DDR5 a 4800 MHz", disk: "Micron 512 GB (NVMe)", os: "Windows 11 Home 24H2", driver: "GeForce 617.14 (este mes)" };
  },
  async usage() {
    const j = (v: number) => Math.max(1, Math.min(99, v + Math.round((Math.random() - 0.5) * 8)));
    return { cpu: j(18), ram: j(61), gpu: j(7), disk: 39 };
  },
  async scan() {
    await wait(1200);
    return [
      { id: "hags", title: "Programación de GPU acelerada por hardware desactivada", detail: "Activarla puede reducir un poco la latencia en GPUs modernas. Requiere reiniciar.", severity: "baja", action: "Activar" },
      { id: "temp", title: "Disco C: con 40 GB libres", detail: "La carpeta de temporales ocupa 3,1 GB y se puede vaciar sin riesgo.", severity: "baja", action: "Limpiar" },
    ];
  },
  async startup() {
    await wait(400);
    return [
      { id: "a", name: "Discord", publisher: "Discord Inc.", enabled: true, scope: "user" },
      { id: "b", name: "Steam", publisher: "Valve Corporation", enabled: false, scope: "user" },
      { id: "c", name: "Realtek HD Audio", publisher: "Realtek", enabled: true, scope: "machine" },
    ];
  },
  async games() {
    await wait(600);
    return [
      { id: "steam-1172470", name: "Apex Legends", store: "Steam", image: steam(1172470), sizeGb: 78, status: "optimizable" },
      { id: "riot-league_of_legends.live", name: "League of Legends", store: "Riot", image: "", sizeGb: null, status: "optimizado" },
      { id: "steam-105600", name: "Terraria", store: "Steam", image: steam(105600), sizeGb: 0.7, status: "guía" },
    ];
  },
  async gameDetail(id, goal) {
    await wait(500);
    const guide = id === "steam-105600";
    return {
      kind: guide ? "guia" : "perfil",
      note: guide ? "Pon estos valores en el menú de gráficos del juego." : "Quitar la oclusión ambiental da un 15 % más de FPS (PC Gamer).",
      sources: [{ name: "PC Gamer", url: "https://www.pcgamer.com/apex-legends-settings-performance/" }],
      gpu: { name: "NVIDIA GeForce RTX 3050 6GB Laptop GPU", score: 55, fps: 92, demand: { text: "AMD Radeon R9 290, NVIDIA GeForce GTX 970", kind: "recomendados", source: "Steam", score: 50 } },
      cpu: { name: "12th Gen Intel Core i5-12450H", score: 111, fps: 90, demand: { text: "Ryzen 5 CPU or Equivalent", kind: "recomendados", source: "Steam", score: 100 } },
      factors: [
        { label: "Memoria RAM", value: "16 GB", effect: "ok", note: "El juego recomienda 8 GB" },
        { label: "Canales de RAM", value: "2 módulos", effect: "ok", note: "Doble canal" },
        { label: "Disco del juego", value: "D: (HDD)", effect: "warning", note: "Puede dar tirones al cargar zonas" },
      ],
      bottleneck: "cpu",
      estMax: 66, loweredNothing: false, estFinal: goal === "calidad" ? 66 : 92, target: goal === "fps" ? 144 : goal === "equilibrado" ? 94 : 60, reached: goal !== "fps",
      canApply: !guide, configFound: !guide, hasBackup: false, files: [],
      settings: [
        { name: "Oclusión ambiental", key: null, why: "El ajuste más caro del juego.", change: true, current: guide ? null : "Alta", recommended: "Desactivada" },
        { name: "Antialiasing", key: null, why: "Cuesta poco.", change: false, current: guide ? null : "TSAA", recommended: "TSAA" },
      ],
    };
  },
  async applyGame() { await wait(800); return "Ajustes aplicados (ejemplo)."; },
  async restoreGame() { await wait(500); return "Configuración original restaurada (ejemplo)."; },
  async copyReport() { return true; },
  async setValues() { await wait(500); return "Ajustes guardados (ejemplo)."; },
  async applyAll() {
    await wait(1500);
    return [
      { name: "Apex Legends", status: "ok", msg: "4 ajustes aplicados en Apex Legends." },
      { name: "League of Legends", status: "same", msg: "Ya estaba optimizado para este objetivo." },
      { name: "Terraria", status: "guia", msg: "Solo guía." },
    ];
  },
  async winState() {
    await wait(400);
    const it = (id: string, group: WinItem["group"], title: string, done: boolean, recommended = true, admin = false): WinItem =>
      ({ id, group, title, body: "Descripción de ejemplo.", cta: "Aplicar", admin, relogin: false, reboot: false, done, recommended });
    return {
      low: false, lowReasons: [],
      items: [
        it("power", "juego", "Plan de energía", false),
        it("gamedvr", "juego", "Grabación en segundo plano de Xbox", false),
        it("animations", "ligero", "Animaciones y efectos visuales de Windows", false, false),
        it("temp", "espacio", "Archivos temporales", false),
        it("restore", "seguridad", "Punto de restauración", false, true, true),
      ],
    };
  },
  async winAction() { await wait(900); return { msg: "Hecho (ejemplo).", verified: true }; },
  async history() { return []; },
  async undo() { return "Deshecho (ejemplo)."; },
  async drivers() {
    await wait(500);
    return { pc: "Lenovo LOQ 15IRH8", items: [
      { id: "bios", group: "BIOS", name: "LENOVO LZCN45WW", version: "LZCN45WW", date: "2026-06-04", ageMonths: 4, outdated: false, note: "Actualízala solo desde la página oficial." },
      { id: "gpu-1", group: "Gráfica", name: "NVIDIA GeForce RTX 3050 6GB Laptop GPU", version: "617.14", date: "2026-09-16", ageMonths: 0, outdated: false, note: null },
      { id: "bt", group: "Bluetooth", name: "Realtek Bluetooth Adapter", version: "18.4032", date: "2023-10-09", ageMonths: 36, outdated: true, note: null },
    ] };
  },
  async openUpdate() {},
  onGamesChanged() {},
};

const bridge = (window as unknown as { afina?: Bridge }).afina;
export const isDesktop = bridge !== undefined;
export const api: Bridge = bridge ?? mock;

// Electron antepone "Error invoking remote method 'x': Error: " al mensaje: se quita.
export const errorText = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
