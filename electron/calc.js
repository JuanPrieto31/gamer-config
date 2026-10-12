// El cálculo: elige el nivel de cada ajuste para llegar a los FPS objetivo perdiendo la menor calidad posible.
//
// Los FPS los limita lo que vaya más lento de los dos:
//   FPS de la gráfica en ALTO   ≈ GPU_BASE × (tu gráfica / gráfica recomendada) × factor de resolución
//   FPS del procesador en ALTO  ≈ CPU_BASE × (tu procesador / procesador recomendado)
//   FPS reales                  ≈ el menor de los dos (el "cuello de botella")
// Los requisitos recomendados apuntan a calidad ALTA, no a Ultra: con todo al máximo se rinde menos,
// tanto como sumen los costes extra de los niveles por encima de "Alto".
// Cada nivel de cada ajuste cuesta un % de trabajo extra a la gráfica (cost) y/o al procesador (cpu),
// frente a su nivel más bajo (de los benchmarks de cada juego o del motor).
// Se parte de todo al máximo y se va bajando el paso que más FPS reales da por cada punto de calidad perdida,
// hasta llegar al objetivo. Bajar algo de la gráfica no sirve si limita el procesador, y al revés.

// Calibración: con el hardware recomendado, los juegos suelen ir a ~60 FPS en alto (lo limita la gráfica);
// los procesadores recomendados suelen ir sobrados y dar más. Ajustar si las estimaciones salen desviadas.
export const GPU_BASE = 60;
export const CPU_BASE = 75;
const BASE_PIXELS = 1920 * 1080;

export function targetFps(goal, refresh) {
  const hz = Math.min(Math.max(refresh || 60, 60), 240);
  if (goal === "fps") return hz;
  if (goal === "equilibrado") return Math.max(60, Math.round(hz * 0.65));
  return Math.min(60, hz);
}

/**
 * El resto de especificaciones: cada una puede restar rendimiento a la gráfica (gpu) o al procesador (cpu),
 * o solo avisar. Devuelve los multiplicadores y la lista para enseñarla.
 * hw: ver system.hardware(); demand: ver demand.demandFor(); ctx: { onBattery, plan, gameDrive }
 */
export function factors(hw, demand, ctx) {
  const list = [];
  let gpu = 1;
  let cpu = 1;
  const add = (label, value, effect, note, g = 1, c = 1) => {
    list.push({ label, value, effect, note }); // effect: "ok" | "info" | "penalty" | "warning"
    gpu *= g;
    cpu *= c;
  };
  const integrated = hw.score < 30 && hw.vendor !== "nvidia";

  // Resolución y pantalla
  const resLoss = Math.round((1 - Math.pow(BASE_PIXELS / (hw.pixels || BASE_PIXELS), 0.8)) * 100);
  add("Resolución", `${hw.resW ?? 1920}×${hw.resH ?? 1080}`, "info",
    resLoss > 2 ? `Más píxeles que 1080p: la gráfica rinde ~${resLoss} % menos` : resLoss < -2 ? `Menos píxeles que 1080p: la gráfica rinde ~${-resLoss} % más` : "La resolución de referencia del cálculo");
  add("Pantalla", `${hw.refresh} Hz`, "info", hw.screens > 1
    ? `Marca el objetivo de FPS. Tienes ${hw.screens} pantallas: se calcula para la principal, que es donde abren los juegos`
    : "Marca el objetivo de FPS");

  // Memoria RAM
  if (demand.ramGb) {
    const r = hw.ramGb / demand.ramGb;
    if (r >= 1) add("Memoria RAM", `${hw.ramGb} GB`, "ok", `El juego recomienda ${demand.ramGb} GB`);
    else if (r >= 0.75) add("Memoria RAM", `${hw.ramGb} GB`, "penalty", `Algo justa: el juego recomienda ${demand.ramGb} GB (−10 % procesador)`, 1, 0.9);
    else add("Memoria RAM", `${hw.ramGb} GB`, "penalty", `Se queda corta: el juego recomienda ${demand.ramGb} GB. Habrá tirones (−30 % procesador)`, 1, 0.7);
  } else {
    add("Memoria RAM", `${hw.ramGb} GB`, hw.ramGb >= 16 ? "ok" : "info", "El juego no indica cuánta recomienda");
  }
  if (hw.ramModules === 1) {
    add("Canales de RAM", "Un solo módulo", "penalty",
      integrated ? "Un solo canal: la gráfica integrada pierde mucho (−30 %) y el procesador algo (−15 %)" : "Un solo canal: el procesador rinde menos en juegos (−15 %). Añadir otro módulo igual lo arregla",
      integrated ? 0.7 : 1, 0.85);
  } else if (hw.ramModules > 1) {
    add("Canales de RAM", `${hw.ramModules} módulos`, "ok", "Doble canal");
  }
  if (hw.ramType === "DDR3") add("Velocidad de RAM", `DDR3 ${hw.ramMhz ?? ""} MHz`, "penalty", "Memoria antigua: frena al procesador (−15 %)", 1, 0.85);
  else if (hw.ramType === "DDR4" && hw.ramMhz && hw.ramMhz <= 2400) add("Velocidad de RAM", `DDR4 ${hw.ramMhz} MHz`, "penalty", "Memoria lenta: frena un poco al procesador (−7 %)", 1, 0.93);
  else if (hw.ramType) add("Velocidad de RAM", `${hw.ramType} ${hw.ramMhz ?? ""} MHz`.trim(), "ok", "Velocidad adecuada");

  // Memoria de la gráfica
  if (demand.vramGb && hw.vramGb && hw.vramGb < demand.vramGb) {
    add("Memoria de la gráfica", `${hw.vramGb} GB`, "penalty", `El juego pide ${demand.vramGb} GB: texturas más bajas y algo menos de rendimiento (−20 %)`, 0.8, 1);
  } else if (hw.vramGb) {
    add("Memoria de la gráfica", `${hw.vramGb} GB`, "ok", demand.vramGb ? `El juego pide ${demand.vramGb} GB` : "Decide la calidad de texturas");
  }

  // Procesador: hilos
  if (hw.threads && hw.threads <= 4) add("Hilos del procesador", `${hw.threads}`, "penalty", "Pocos hilos: los juegos actuales usan más (−25 %)", 1, 0.75);
  else if (hw.threads) add("Hilos del procesador", `${hw.threads}`, "ok", "Suficientes para juegos actuales");

  // Energía
  if (ctx.onBattery) add("Batería", "Sin cargador", "warning", "Con batería el portátil reduce mucho la potencia (−40 % gráfica, −30 % procesador). Conecta el cargador para jugar", 0.6, 0.7);
  else if (hw.laptop) add("Batería", "Con cargador", "ok", "Potencia completa");
  if (/ahorro|saver|silen|quiet/i.test(ctx.plan ?? "")) add("Plan de energía", ctx.plan, "penalty", "Modo de ahorro: el procesador va más lento (−15 %). Cámbialo en la pantalla Windows", 1, 0.85);
  else if (ctx.plan) add("Plan de energía", ctx.plan, "ok", "No limita el rendimiento");

  // Disco donde está el juego
  const disk = ctx.gameDrive ? hw.drives?.[ctx.gameDrive] : null;
  if (disk === "HDD") {
    add("Disco del juego", `${ctx.gameDrive}: (disco duro)`, "warning",
      demand.ssd ? "El juego pide SSD: en disco duro tendrá tirones y cargas largas. Muévelo a un SSD si puedes" : "No cambia los FPS medios, pero puede dar tirones al cargar zonas");
  } else if (disk) {
    add("Disco del juego", `${ctx.gameDrive}: (${disk})`, "ok", "Cargas rápidas y sin tirones por el disco");
  }

  if (hw.laptop) add("Portátil", "Sí", "info", "La gráfica y el procesador de portátil rinden menos que los de sobremesa (ya incluido)");

  return { gpu, cpu, list };
}

/**
 * settings: [{ key, levels:[{value,label,cost,cpu?,visual?,vram?}], visual?, fixed?, requires? }]
 * hw: { score, cpuScore, vendor, vramGb, refresh, pixels }
 * demand: { gpu, cpu } puntuaciones que pide el juego
 * mult: { gpu, cpu } multiplicadores del resto de especificaciones (ver factors)
 */
export function solve(settings, hw, demand, goal, mult = { gpu: 1, cpu: 1 }, opts = {}) {
  let target = targetFps(goal, hw.refresh);
  const res = Math.pow(BASE_PIXELS / (hw.pixels || BASE_PIXELS), 0.8);
  // FPS con los ajustes en "Alto" (a lo que apuntan los requisitos recomendados, no a Ultra).
  const gpuAtHigh = GPU_BASE * (hw.score / Math.max(demand.gpu, 1)) * res * mult.gpu;
  const cpuAtHigh = CPU_BASE * (hw.cpuScore / Math.max(demand.cpu, 1)) * mult.cpu;

  const picks = new Map();
  const tunable = [];
  for (const s of settings.filter((s) => !s.requires || s.requires === hw.vendor)) {
    if (s.fixed) {
      const v = String(s.fixed[goal]).replace("{refresh}", String(hw.refresh || 60));
      picks.set(s.key, s.levels?.find((l) => String(l.value) === v) ?? { value: v, label: v });
    } else if (s.levels.some((l) => l.vram != null)) {
      // Texturas: no cuestan FPS si caben en la memoria de la gráfica → la más alta que quepa.
      // vramScale > 1 en juegos exigentes: sus texturas altas piden más memoria que en uno antiguo.
      const scale = opts.vramScale ?? 1;
      const fit = s.levels.filter((l) => (l.vram ?? 0) * scale <= (hw.vramGb ?? 2));
      picks.set(s.key, fit.at(-1) ?? s.levels[0]);
    } else {
      tunable.push({ s, i: s.levels.length - 1 });
    }
  }

  let costScale = 1;
  const load = (field) => 1 + tunable.reduce((t, x) => t + (x.s.levels[x.i][field] ?? 0) / 100, 0) * (field === "cost" ? costScale : 1);
  const setAll = (pos) => tunable.forEach((x) => { x.i = Math.round((x.s.levels.length - 1) * pos); });
  const top = tunable.map((x) => x.i);
  // Calibración: en los benchmarks, pasar un juego de Alto a Bajo suele dar ×1,7 FPS (de ×1,5 a ×2,2).
  // Si los costes del perfil suman menos, se escalan todos por igual (mantienen su peso relativo entre ajustes);
  // si no, en PCs modestos todo acababa al mínimo sin llegar al objetivo.
  // ponytail: un solo factor global; si un juego concreto escala distinto, se ajusta en su perfil.
  const SPREAD = 1.7;
  setAll(0.67);
  const rawHigh = load("cost");
  if (rawHigh > 1 && rawHigh < SPREAD) costScale = (SPREAD - 1) / (rawHigh - 1);
  // Configuración "Alto" de referencia: cada ajuste a ~2/3 de su escala (Alto en Bajo/Medio/Alto/Ultra).
  const highGpu = load("cost");
  const highCpu = load("cpu");
  tunable.forEach((x, n) => { x.i = top[n]; });
  const now = () => {
    const g = gpuAtHigh * (highGpu / load("cost"));
    const c = cpuAtHigh * (highCpu / load("cpu"));
    return { g, c, fps: Math.min(g, c) };
  };
  const atMax = now();

  // FPS estimados con los ajustes que el juego tiene ahora (opts.current: clave → valor): sirven para comparar
  // con los FPS reales que mide el overlay y calibrar el cálculo de ese juego.
  let estCurrent = null;
  if (opts.current?.size) {
    tunable.forEach((x) => {
      const plain = (v) => String(v ?? "").replace(/\s+|"/g, "").toLowerCase();
      const i = x.s.levels.findIndex((l) => plain(l.value) === plain(opts.current.get(x.s.key)));
      if (i >= 0) x.i = i;
    });
    estCurrent = Math.round(now().fps);
    tunable.forEach((x, n) => { x.i = top[n]; });
  }

  // Si ni con todo al mínimo se llega, en Equilibrado y Calidad se apunta a algo alcanzable (45 / 30 estables,
  // o el 90 % de lo máximo si está por encima) en vez de dejarlo todo al mínimo para no llegar igualmente.
  // Si ni siquiera se llega a 45 / 30, se deja ese suelo a propósito: todo queda al mínimo para sacar los máximos
  // FPS (subir calidad a 18 FPS no tiene sentido) y el resultado marca que no se llega. En modo FPS, siempre el máximo.
  setAll(0);
  const atMin = now().fps;
  tunable.forEach((x, n) => { x.i = top[n]; });
  const floor = goal === "calidad" ? 30 : 45;
  if (goal !== "fps" && atMin < target && target > floor) target = Math.max(floor, Math.min(target, Math.floor(atMin * 0.9)));

  while (now().fps < target) {
    const before = now().fps;
    let best = null;
    for (const x of tunable) {
      if (x.i === 0) continue;
      x.i--;
      const gain = now().fps - before; // FPS reales que da bajar este paso
      x.i++;
      if (gain <= 0.01) continue;
      // Cada paso hacia abajo se nota más que el anterior (de Ultra a Alto apenas; de Bajo a nada, mucho):
      // así se reparten los recortes en vez de dejar un ajuste a cero y el resto en Ultra.
      const depth = (x.s.levels.length - 1 - x.i) / Math.max(x.s.levels.length - 1, 1);
      const loss = (x.s.levels[x.i].visual ?? x.s.visual ?? 1) * (1 + 1.5 * depth);
      if (!best || gain / loss > best.ratio) best = { x, ratio: gain / loss };
    }
    if (!best) break; // nada de lo que queda ayuda (todo al mínimo, o el límite no se arregla con ajustes)
    best.x.i--;
  }

  for (const x of tunable) picks.set(x.s.key, x.s.levels[x.i]);
  const end = now();
  return {
    picks,
    target,
    estMax: Math.round(atMax.fps),
    loweredNothing: tunable.every((x, n) => x.i === top[n]),
    estFinal: Math.round(end.fps),
    estCurrent,
    gpuFps: Math.round(end.g),
    cpuFps: Math.round(end.c),
    bottleneck: end.c < end.g ? "cpu" : "gpu",
    reached: end.fps >= target,
  };
}
