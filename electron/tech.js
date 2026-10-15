// Tecnologías de imagen: configuración global (como el panel de la app de NVIDIA) que se aplica a todos los juegos.
// Escalado (DLSS / FSR / XeSS), su calidad, el tipo de DLSS, generación de fotogramas y baja latencia (Reflex).
// Por defecto todo es "auto": se decide por los componentes (gráfica y su generación, resolución y Hz de la
// pantalla, FPS que da el juego). Elegir a mano es opcional; si se elige algo que la gráfica no puede, se cae a
// lo mejor que sí tenga.
//
// En los perfiles, cada tecnología es un ajuste con:
//   upscaler: true + tech: "dlss" | "fsr" | "xess"; niveles con mode "rendimiento" | "equilibrado" | "calidad" | "nativo"
//     y off: true en el nivel que apaga el escalado.
//   framegen: true + tech: "dlss-fg" | "fsr-fg"; niveles con mode "off" | "2x" | "3x" | "4x".
//   latency: true; niveles con mode "off" | "on" | "boost".
//   dlssModel: true (tipo de DLSS); niveles con mode "cnn" | "transformer". Solo se usa si el escalado es DLSS.
import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OPTIONS = {
  upscaler: ["auto", "dlss", "fsr", "xess", "off"],
  quality: ["auto", "calidad", "equilibrado", "rendimiento", "nativo"],
  dlssModel: ["auto", "transformer", "cnn"],
  frameGen: ["auto", "off", "2x", "3x", "4x"],
  latency: ["auto", "off", "on", "boost"],
};
const DEFAULTS = { upscaler: "auto", quality: "auto", dlssModel: "auto", frameGen: "auto", latency: "auto" };
const file = () => path.join(app.getPath("userData"), "tecnologias.json");

let settings = null;
export function getSettings() {
  if (!settings) {
    try { settings = sanitize(JSON.parse(readFileSync(file(), "utf8"))); } catch { settings = { ...DEFAULTS }; }
  }
  return settings;
}

const sanitize = (s) => Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, OPTIONS[k].includes(s?.[k]) ? s[k] : d]));

export function setSettings(patch) {
  settings = sanitize({ ...getSettings(), ...patch });
  writeFileSync(file(), JSON.stringify(settings));
  return settings;
}

/**
 * Qué puede hacer la gráfica (hw de system.hardware()).
 * - DLSS (escalado): todas las RTX. Generación de fotogramas DLSS: RTX 40 y 50. Multi Frame Generation (3x/4x): RTX 50.
 * - FSR (escalado y generación de fotogramas FSR 3): cualquier gráfica actual, de cualquier marca.
 * - XeSS: cualquier gráfica actual (en Intel Arc va con sus núcleos de IA; en el resto, en modo compatible).
 * - Reflex: NVIDIA (GTX 900 en adelante).
 */
export function capabilities(hw) {
  const gen = Number(String(hw.gpu ?? "").match(/rtx\s*(\d)0[5-9]0/i)?.[1] ?? 0);
  const modern = hw.vendor !== "other";
  return {
    dlss: !!hw.rtx,
    dlssFg: !!hw.rtx && gen >= 4,
    dlssMfg: !!hw.rtx && gen >= 5,
    fsr: modern,
    fsrFg: modern,
    xess: modern,
    xessNative: hw.vendor === "intel" && /\barc\b/i.test(hw.gpu ?? ""),
    reflex: hw.vendor === "nvidia",
    fsr4: hw.vendor === "amd" && /rx\s*90\d0/i.test(hw.gpu ?? ""), // FSR 4 (con IA): Radeon RX 9000
    gen, // generación RTX (2 = serie 20 … 5 = serie 50); 0 si no es GeForce RTX
  };
}

const can = (caps, tech) => ({ dlss: caps.dlss, fsr: caps.fsr, xess: caps.xess, "dlss-fg": caps.dlssFg, "fsr-fg": caps.fsrFg })[tech] ?? false;
// Lo mejor que tenga la gráfica: DLSS en RTX, XeSS en Intel Arc, si no FSR.
const BEST = (caps) => [caps.dlss && "dlss", caps.xessNative && "xess", "fsr", "xess"].filter(Boolean);
const fix = (s, level) => (level ? { ...s, fixedLevel: level } : s);

/**
 * Generación de fotogramas automática, por componentes:
 * - no en el modo FPS (competitivo: añade retraso) ni si la gráfica no la admite;
 * - solo si el juego va a 50 FPS o más sin ella (por debajo se nota el retraso y los fallos de imagen). Son los FPS
 *   calculados, corregidos con los medidos por el overlay si los hay (optimize.js deja margen si no los hay);
 * - el multiplicador más alto cuyos FPS mostrados quepan en los Hz de la pantalla (si no caben, no sirve de nada).
 */
export function autoFrameGen(caps, hw, goal, baseFps) {
  if (goal === "fps" || !(caps.dlssFg || caps.fsrFg) || !(baseFps >= 50)) return "off";
  const hz = hw.refresh || 60;
  for (let m = caps.dlssMfg ? 4 : 2; m >= 2; m--) if (baseFps * m <= hz * 1.05) return `${m}x`;
  return "off";
}

// Escalado según la resolución: a 4K los modos Rendimiento y Equilibrado apenas se notan; a 1080p mucho
// (de menos píxeles reconstruye peor). Se abarata la pérdida visual de los niveles por debajo de nativa.
const resWeight = (hw) => ((hw.pixels ?? 0) >= 6e6 ? 0.5 : (hw.pixels ?? 0) >= 3.5e6 ? 0.75 : 1);
function byResolution(s, hw) {
  const k = resWeight(hw);
  return k === 1 ? s : { ...s, levels: s.levels.map((l) => (l.mode === "nativo" ? l : { ...l, visual: (l.visual ?? s.visual ?? 1) * k })) };
}

// Qué se ha detectado en el equipo y qué haría "Automático", para enseñarlo.
export function detected(hw) {
  const c = capabilities(hw);
  return {
    upscaler: c.dlss ? "DLSS" : c.xessNative ? "XeSS (con la IA de Intel Arc)" : c.fsr4 ? "FSR 4" : "FSR",
    dlssModel: c.dlss ? "Transformer (DLSS 4)" : "no aplica",
    frameGen: c.dlssMfg ? "DLSS hasta 4x" : c.dlssFg ? "DLSS 2x" : c.fsrFg ? "FSR 2x" : "no",
    latency: c.reflex ? "NVIDIA Reflex" : hw.vendor === "amd" ? "AMD Anti-Lag (se activa en AMD Software)" : "la del propio juego",
    screen: `${hw.resW ?? "?"}×${hw.resH ?? "?"} a ${hw.refresh ?? 60} Hz`,
  };
}

/**
 * Ajusta los ajustes de un perfil a las preferencias globales: deja un solo escalado (el elegido o el mejor
 * disponible) y fija los niveles que el usuario haya decidido. Devuelve { settings, notes }.
 */
export function applyTech(settings, hw, prefs = getSettings(), { goal, baseFps, measured } = {}) {
  const caps = capabilities(hw);
  const notes = [];
  const rest = settings.filter((s) => !s.upscaler && !s.framegen && !s.dlssModel);

  // Escalado: un solo ajuste.
  const ups = settings.filter((s) => s.upscaler && can(caps, s.tech));
  let up = null;
  if (ups.length) {
    if (prefs.upscaler === "off") {
      up = ups.find((s) => s.levels.some((l) => l.off)) ?? null;
      if (up) { up = fix(up, up.levels.find((l) => l.off)); notes.push("Escalado apagado (lo has elegido así): resolución nativa"); }
    } else {
      const wanted = prefs.upscaler !== "auto" ? ups.find((s) => s.tech === prefs.upscaler) : null;
      up = wanted ?? BEST(caps).map((t) => ups.find((s) => s.tech === t)).find(Boolean) ?? ups[0];
      if (prefs.quality === "auto") up = byResolution(up, hw);
      if (prefs.upscaler !== "auto" && !wanted) notes.push(`${prefs.upscaler.toUpperCase()} no está disponible en este juego o en tu gráfica: se usa ${up.tech.toUpperCase()}`);
      if (prefs.quality !== "auto") {
        const lv = up.levels.find((l) => l.mode === prefs.quality);
        if (lv) up = fix(up, lv);
      }
      notes.push(`Escalado: ${up.tech.toUpperCase()}${prefs.upscaler === "auto" ? " (el mejor que admite tu gráfica)" : ""}${up.fixedLevel ? `, ${up.fixedLevel.label}` : ", calidad según los FPS"}`);
    }
  }

  // Tipo de DLSS (solo con DLSS): "auto" = Transformer (DLSS 4), el que pone NVIDIA en sus ajustes óptimos en todas
  // las RTX; CNN es el modelo anterior, algo más ligero en las RTX 20 y 30.
  const models = up?.tech === "dlss" && !up.fixedLevel?.off ? settings.filter((s) => s.dlssModel) : [];
  const want = prefs.dlssModel === "auto" ? "transformer" : prefs.dlssModel;
  const modelOut = models.map((s) => fix(s, s.levels.find((l) => l.mode === want) ?? s.levels.at(-1)));
  if (models.length) notes.push(`Tipo de DLSS: ${want === "cnn" ? "CNN (el anterior, más ligero)" : "Transformer (DLSS 4, mejor imagen)"}${prefs.dlssModel === "auto" ? " (automático)" : ""}`);

  // Generación de fotogramas: se enciende solo la elegida (si la gráfica puede); el resto, apagadas.
  const fgs = settings.filter((s) => s.framegen);
  const off = (s) => fix(s, s.levels.find((l) => l.mode === "off"));
  let fgOut = fgs.map(off);
  const fgWant = prefs.frameGen === "auto" ? autoFrameGen(caps, hw, goal, baseFps) : prefs.frameGen;
  if (fgWant !== "off" && fgs.length) {
    const mult = fgWant === "2x" || caps.dlssMfg ? fgWant : "2x";
    const pick = fgs.find((s) => s.tech === "dlss-fg" && caps.dlssFg) ?? fgs.find((s) => s.tech === "fsr-fg" && caps.fsrFg);
    const lv = pick && (pick.levels.find((l) => l.mode === mult) ?? pick.levels.find((l) => l.mode === "2x"));
    if (lv) {
      fgOut = fgs.map((s) => (s === pick ? fix(s, lv) : off(s)));
      notes.push(`Generación de fotogramas ${pick.tech === "dlss-fg" ? "DLSS" : "FSR"} ${lv.label}${prefs.frameGen === "auto" ? ` (automática: el juego va con margen ${measured ? "según tus partidas medidas" : "según el cálculo"} y tu pantalla es de ${hw.refresh || 60} Hz)` : ""}: muestra más FPS, pero el cálculo usa los que da sin ella (añade algo de retraso)`);
    }
  }

  // Baja latencia (Reflex): "auto" deja lo que diga el perfil para cada modo.
  const out = rest.map((s) => {
    if (!s.latency || prefs.latency === "auto") return s;
    return fix(s, s.levels.find((l) => l.mode === prefs.latency) ?? (prefs.latency === "boost" ? s.levels.find((l) => l.mode === "on") : null));
  });

  return { settings: [...(up ? [up] : []), ...modelOut, ...fgOut, ...out], notes };
}
