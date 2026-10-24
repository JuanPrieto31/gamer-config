// Comprobación rápida, SOLO LECTURA (no escribe nada en los juegos): npm test
import { app } from "electron";
import * as system from "./system.js";
import * as optimize from "./optimize.js";
import * as win from "./windows.js";
import { solve, supports } from "./calc.js";
import { applyTech, capabilities } from "./tech.js";
import * as cleanup from "./cleanup.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// El cálculo, con datos inventados: una gráfica justa debe recortar y una sobrada no.
function checkCalc() {
  const settings = [
    { key: "a", visual: 1, levels: [{ value: "0", cost: 0 }, { value: "1", cost: 15 }] },
    { key: "b", visual: 2, levels: [{ value: "0", cost: 0 }, { value: "1", cost: 10 }] },
    { key: "t", levels: [{ value: "lo", cost: 0, vram: 0 }, { value: "hi", cost: 0, vram: 6 }] },
  ];
  const need = { gpu: 50, cpu: 70 };
  const weak = solve(settings, { score: 50, cpuScore: 200, refresh: 144, pixels: 1920 * 1080, vramGb: 4 }, need, "fps");
  const strong = solve(settings, { score: 300, cpuScore: 200, refresh: 144, pixels: 1920 * 1080, vramGb: 8 }, need, "fps");
  // Procesador débil y gráfica sobrada: debe bajar lo que carga al procesador ("v") y dejar lo de gráfica ("a").
  const cpuSettings = [
    { key: "a", visual: 1, levels: [{ value: "0", cost: 0 }, { value: "1", cost: 15 }] },
    { key: "v", visual: 2, levels: [{ value: "0", cost: 0, cpu: 0 }, { value: "1", cost: 1, cpu: 40 }] },
  ];
  const cpuBound = solve(cpuSettings, { score: 300, cpuScore: 60, refresh: 144, pixels: 1920 * 1080, vramGb: 8 }, need, "equilibrado");
  const ok = weak.picks.get("a").value === "0" && weak.picks.get("t").value === "lo"
    && strong.picks.get("a").value === "1" && strong.picks.get("b").value === "1" && strong.picks.get("t").value === "hi"
    && cpuBound.picks.get("v").value === "0" && cpuBound.picks.get("a").value === "1" && cpuBound.bottleneck === "cpu";
  console.log(ok ? "ok cálculo" : "X  cálculo", JSON.stringify({ weak: weak.estFinal, strong: strong.estFinal, cpuBound: [cpuBound.estFinal, cpuBound.bottleneck] }));

  // Caso real: una RTX 3050 (8 GB) en un juego exigente no debe salir con todo en Ultra (los requisitos apuntan a "Alto").
  const generic = [
    { key: "shadows", visual: 2, levels: [0, 5, 10, 15].map((c, i) => ({ value: String(i), cost: c })) },
    { key: "gi", visual: 2, levels: [0, 8, 16, 24].map((c, i) => ({ value: String(i), cost: c })) },
    { key: "tex", levels: [0, 3, 5, 8].map((v, i) => ({ value: String(i), cost: 0, vram: v })) },
  ];
  const rtx3050 = solve(generic, { score: 70, cpuScore: 110, refresh: 144, pixels: 1920 * 1080, vramGb: 8 }, { gpu: 100, cpu: 100 }, "equilibrado", { gpu: 1, cpu: 1 }, { vramScale: Math.sqrt(2) });
  const notUltra = rtx3050.picks.get("shadows").value !== "3" && rtx3050.picks.get("gi").value !== "3" && rtx3050.picks.get("tex").value !== "3";
  console.log(notUltra ? "ok RTX 3050 en juego exigente: no todo en Ultra" : "X  RTX 3050 sale con Ultra", JSON.stringify([...rtx3050.picks].map(([k, v]) => `${k}=${v.value}`)));

  // Escalado: una gráfica justa activa DLSS antes de hundir las sombras; una sobrada se queda en nativa.
  // Y la referencia "Alto" se mide en nativa: el escalado no cambia lo estimado al máximo.
  // (Qué escalado según la marca lo decide tech.js: ver checkTech.)
  // Como en los perfiles: bajar de DLSS Calidad a Equilibrado o Rendimiento se nota mucho más (visual 3 y 4).
  const up = [
    { key: "dlss", tech: "dlss", upscaler: true, visual: 1, levels: [0, 10, 21, 70].map((c, i) => ({ value: String(i), cost: c, visual: [1, 4, 3, 1][i] })) },
    { key: "shadows", visual: 2, levels: [0, 8, 17].map((c, i) => ({ value: String(i), cost: c })) },
    { key: "gi", visual: 2, levels: [0, 10, 20, 30].map((c, i) => ({ value: String(i), cost: c })) },
  ];
  const hwUp = (score, rtx) => ({ score, cpuScore: 300, refresh: 144, pixels: 1920 * 1080, vramGb: 8, vendor: "nvidia", rtx });
  const justa = solve(up, hwUp(130, true), { gpu: 100, cpu: 100 }, "equilibrado");
  const sobrada = solve(up, hwUp(400, true), { gpu: 100, cpu: 100 }, "calidad");
  const sinUp = solve(up.slice(1), hwUp(130, true), { gpu: 100, cpu: 100 }, "equilibrado");
  const upOk = justa.picks.get("dlss").value === "2" && justa.picks.get("gi").value !== "0" && justa.reached
    && sobrada.picks.get("dlss").value === "3" && justa.estMax === sinUp.estMax;
  console.log(upOk ? "ok escalado (DLSS)" : "X  escalado (DLSS)", JSON.stringify({ justa: [...justa.picks].map(([k, v]) => `${k}=${v.value}`), fps: justa.estFinal, sobrada: sobrada.picks.get("dlss").value }));
  return ok && notUltra && upOk;
}

// Tecnologías con todas las marcas, sobre el perfil real de Marvel Rivals (DLSS, FSR, XeSS, generación de fotogramas, Reflex).
async function checkTech() {
  const raw = JSON.parse(await fs.readFile(new URL("../profiles/marvelrivals.json", import.meta.url), "utf8"));
  const settings = raw.settings.map((s) => ({ ...s, levels: s.levels.map((l) => ({ value: String(l[0]), label: l[1], cost: l[2] ?? 0, ...(l[3] ?? {}) })) }));
  const pc = (gpu, vendor, score) => ({ gpu, vendor, rtx: /nvidia.*\brtx\b/i.test(gpu), score, cpuScore: 150, refresh: 144, pixels: 1920 * 1080, vramGb: 8 });
  const prefs = (p) => ({ upscaler: "auto", quality: "auto", dlssModel: "auto", frameGen: "off", latency: "auto", ...p });
  const run = (hw, p) => {
    const { settings: s } = applyTech(settings.filter((x) => supports(x, hw)), hw, prefs(p));
    const r = solve(s, hw, { gpu: 100, cpu: 100 }, "equilibrado");
    const up = s.find((x) => x.upscaler);
    const fg = s.filter((x) => x.framegen).map((x) => `${x.tech}=${r.picks.get(x.key)?.mode}`).join(",");
    return { up: up?.tech, upLevel: r.picks.get(up?.key)?.mode, fg, reflex: r.picks.has("bNvidiaReflex"), fps: r.estFinal };
  };
  const cases = [
    ["RTX 3050 portátil, auto", pc("NVIDIA GeForce RTX 3050 6GB Laptop GPU", "nvidia", 60), {}, (r) => r.up === "dlss" && r.reflex],
    ["RTX 3050, FG 2x → FSR (DLSS FG necesita RTX 40)", pc("NVIDIA GeForce RTX 3050 6GB Laptop GPU", "nvidia", 60), { frameGen: "2x" }, (r) => r.fg.includes("fsr-fg=2x") && r.fg.includes("dlss-fg=off")],
    ["RTX 4070, FG 4x → DLSS 2x", pc("NVIDIA GeForce RTX 4070", "nvidia", 150), { frameGen: "4x" }, (r) => r.fg.includes("dlss-fg=2x") && r.fg.includes("fsr-fg=off")],
    ["RTX 5070, FG 4x → DLSS 4x", pc("NVIDIA GeForce RTX 5070", "nvidia", 200), { frameGen: "4x" }, (r) => r.fg.includes("dlss-fg=4x")],
    ["GTX 1650, pide DLSS → FSR", pc("NVIDIA GeForce GTX 1650", "nvidia", 35), { upscaler: "dlss" }, (r) => r.up === "fsr" && r.reflex],
    ["RX 6600, auto → FSR sin Reflex", pc("AMD Radeon RX 6600", "amd", 95), {}, (r) => r.up === "fsr" && !r.reflex],
    ["RX 9070, XeSS elegido", pc("AMD Radeon RX 9070", "amd", 230), { upscaler: "xess" }, (r) => r.up === "xess"],
    ["Intel Arc A750, auto → XeSS", pc("Intel(R) Arc(TM) A750 Graphics", "intel", 90), {}, (r) => r.up === "xess" && !r.reflex],
    ["Intel Iris Xe, auto → FSR", pc("Intel(R) Iris(R) Xe Graphics", "intel", 13), {}, (r) => r.up === "fsr"],
    ["RTX 3050, escalado apagado → nativa sin escalado", pc("NVIDIA GeForce RTX 3050 6GB Laptop GPU", "nvidia", 60), { upscaler: "off" }, (r) => r.up === "fsr" && r.upLevel === "nativo"],
    ["RTX 3050, calidad fija → DLSS Calidad", pc("NVIDIA GeForce RTX 3050 6GB Laptop GPU", "nvidia", 30), { quality: "calidad" }, (r) => r.up === "dlss" && r.upLevel === "calidad"],
  ];
  let ok = true;
  for (const [name, hw, p, check] of cases) {
    const r = run(hw, p);
    const good = check(r);
    ok = ok && good;
    console.log(good ? "ok" : "X ", "tecnologías:", name, JSON.stringify(r));
  }
  const caps = capabilities(pc("NVIDIA GeForce RTX 5090 Laptop GPU", "nvidia", 200));
  if (!(caps.dlssMfg && caps.dlssFg)) { ok = false; console.log("X  tecnologías: RTX 5090 portátil sin MFG", JSON.stringify(caps)); }

  // Automático por componentes: generación de fotogramas según FPS reales, Hz y modo; peso visual por resolución.
  const auto = prefs({ frameGen: "auto" });
  const fgOf = (hw, goal, baseFps) => applyTech(settings.filter((x) => supports(x, hw)), hw, auto, { goal, baseFps }).settings
    .filter((x) => x.framegen && x.fixedLevel?.mode !== "off").map((x) => `${x.tech}=${x.fixedLevel.mode}`).join(",") || "off";
  const hz = (hw, refresh) => ({ ...hw, refresh });
  const rtx4070 = pc("NVIDIA GeForce RTX 4070", "nvidia", 150);
  const autoCases = [
    ["FG auto: RTX 4070, 70 FPS, 144 Hz → DLSS 2x", fgOf(rtx4070, "equilibrado", 70), "dlss-fg=2x"],
    ["FG auto: RTX 5070, 70 FPS, 240 Hz → DLSS 3x", fgOf(hz(pc("NVIDIA GeForce RTX 5070", "nvidia", 200), 240), "calidad", 70), "dlss-fg=3x"],
    ["FG auto: modo FPS → apagada", fgOf(rtx4070, "fps", 70), "off"],
    ["FG auto: 40 FPS → apagada", fgOf(rtx4070, "equilibrado", 40), "off"],
    ["FG auto: 100 FPS en 144 Hz → apagada (no caben)", fgOf(rtx4070, "equilibrado", 100), "off"],
    ["FG auto: RTX 3050, 70 FPS → FSR 2x", fgOf(pc("NVIDIA GeForce RTX 3050 6GB Laptop GPU", "nvidia", 60), "equilibrado", 70), "fsr-fg=2x"],
    ["FG auto: RX 6600, 65 FPS → FSR 2x", fgOf(pc("AMD Radeon RX 6600", "amd", 95), "calidad", 65), "fsr-fg=2x"],
  ];
  for (const [name, got, want] of autoCases) {
    ok = ok && got === want;
    console.log(got === want ? "ok" : "X ", "tecnologías:", name, got);
  }
  const at4k = applyTech(settings, { ...rtx4070, pixels: 3840 * 2160 }, prefs({})).settings.find((x) => x.upscaler);
  const at1080 = applyTech(settings, rtx4070, prefs({})).settings.find((x) => x.upscaler);
  const resOk = at4k.levels[1].visual < at1080.levels[1].visual && at4k.levels.at(-1).visual === at1080.levels.at(-1).visual;
  ok = ok && resOk;
  console.log(resOk ? "ok" : "X ", "tecnologías: a 4K bajar el escalado pesa menos que a 1080p", at4k.levels[1].visual, at1080.levels[1].visual);

  // Tipo de DLSS (perfil real de Deadlock): Transformer en automático, CNN si se elige, y nada si el escalado no es DLSS.
  const dl = JSON.parse(await fs.readFile(new URL("../profiles/deadlock.json", import.meta.url), "utf8"));
  const dset = dl.settings.map((s) => ({ ...s, levels: s.levels.map((l) => ({ value: String(l[0]), label: l[1], cost: l[2] ?? 0, ...(l[3] ?? {}) })) }));
  const model = (hw, p) => applyTech(dset.filter((x) => supports(x, hw)), hw, prefs(p)).settings.find((x) => x.dlssModel)?.fixedLevel?.value ?? "ninguno";
  const rtx3050 = pc("NVIDIA GeForce RTX 3050 6GB Laptop GPU", "nvidia", 60);
  const models = [["auto", model(rtx3050, {}), "10"], ["CNN", model(rtx3050, { dlssModel: "cnn" }), "5"], ["con FSR", model(rtx3050, { upscaler: "fsr" }), "ninguno"], ["AMD", model(pc("AMD Radeon RX 6600", "amd", 95), {}), "ninguno"]];
  for (const [name, got, want] of models) {
    ok = ok && got === want;
    console.log(got === want ? "ok" : "X ", "tecnologías: tipo de DLSS", name, got);
  }
  return ok;
}

// Limpieza de basura de actualizaciones, en una carpeta temporal falsa (no toca ningún juego real).
async function checkCleanup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gc-clean-"));
  const lib = path.join(root, "steamapps");
  const game = { id: "steam-111", name: "Prueba", store: "Steam", library: lib, path: path.join(lib, "common", "Prueba") };
  const put = (f, text = "x".repeat(1000)) => fs.mkdir(path.dirname(f), { recursive: true }).then(() => fs.writeFile(f, text));
  const manifest = (flags) => put(path.join(lib, "appmanifest_111.acf"), `"AppState"
{
	"StateFlags"		"${flags}"
}`);
  try {
    await manifest(4);
    await put(path.join(game.path, "juego.exe"));
    await put(path.join(game.path, "saves", "partida.sav"));
    await put(path.join(game.path, "viejo.tmp")); // reciente: no se toca
    await put(path.join(lib, "downloading", "111", "parche.bin"), "y".repeat(5000));
    await put(path.join(lib, "temp", "111", "a.tmp"));
    await put(path.join(lib, "downloading", "222", "otro-juego.bin")); // de otro juego: no se toca
    const old = new Date(Date.now() - 10 * 864e5);
    for (const f of ["downloading/111/parche.bin", "downloading/111", "temp/111/a.tmp"]) await fs.utimes(path.join(lib, f), old, old); // descarga parada hace días
    await put(path.join(game.path, "data", "descarga.part"));
    await fs.utimes(path.join(game.path, "data", "descarga.part"), old, old);

    const r = await cleanup.scan(game, { manual: true });
    const paths = r.items.map((i) => path.relative(root, i.path).split(path.sep).join("/")).sort();
    const scanOk = !r.blocked && paths.join() === "steamapps/common/Prueba/data/descarga.part,steamapps/downloading/111,steamapps/temp/111";
    console.log(scanOk ? "ok limpieza: detecta solo la basura de este juego" : "X  limpieza detecta mal", JSON.stringify(paths));

    await manifest(1026); // Steam actualizando: no se ofrece nada
    const busy = await cleanup.scan(game);
    const busyOk = busy.blocked && busy.items.length === 0;
    console.log(busyOk ? "ok limpieza: no toca un juego que se está actualizando" : "X  limpieza toca un juego en actualización");
    await manifest(4);

    const done = await cleanup.clean(game, r.items);
    const exists = (f) => fs.access(f).then(() => true, () => false);
    const kept = (await exists(path.join(game.path, "juego.exe"))) && (await exists(path.join(game.path, "saves", "partida.sav")))
      && (await exists(path.join(game.path, "viejo.tmp"))) && (await exists(path.join(lib, "downloading", "222", "otro-juego.bin")));
    const gone = !(await exists(path.join(lib, "downloading", "111"))) && !(await exists(path.join(lib, "temp", "111")));
    const delOk = kept && gone && done.removed === 3 && done.freed >= 6000;
    console.log(delOk ? "ok limpieza: borra la basura y respeta el juego, las partidas y otros juegos" : "X  limpieza borra mal", JSON.stringify(done));

    // Una ruta fuera de su carpeta permitida nunca se borra (aunque la regla se equivocara).
    const outside = path.join(root, "fuera.txt");
    await put(outside);
    await cleanup.clean(game, [{ path: outside, bytes: 1, root: lib }, { path: lib, bytes: 1, root: lib }]);
    const guardOk = (await exists(outside)) && (await exists(lib));
    console.log(guardOk ? "ok limpieza: rechaza rutas fuera de la carpeta permitida" : "X  limpieza borró fuera de su carpeta");
    // Roblox: solo se borran versiones antiguas del jugador; la actual y Roblox Studio se quedan.
    const rb = path.join(root, "Roblox");
    await put(path.join(rb, "Versions", "version-nueva", "RobloxPlayerBeta.exe"));
    await put(path.join(rb, "Versions", "version-vieja", "RobloxPlayerBeta.exe"));
    await put(path.join(rb, "Versions", "version-antigua", "RobloxPlayerBeta.exe"));
    const older = new Date(Date.now() - 30 * 864e5);
    await fs.utimes(path.join(rb, "Versions", "version-antigua", "RobloxPlayerBeta.exe"), older, older); // las 2 más recientes se conservan
    await put(path.join(rb, "Versions", "version-studio", "RobloxStudioBeta.exe"));
    const rr = await cleanup.scan({ id: "roblox-player", name: "Roblox", store: "Roblox", path: rb, version: "version-nueva" });
    const rbOk = rr.items.length === 1 && path.basename(rr.items[0].path) === "version-antigua";
    console.log(rbOk ? "ok limpieza: Roblox borra solo versiones viejas del jugador (no Studio)" : "X  limpieza de Roblox mal", JSON.stringify(rr.items.map((i) => path.basename(i.path))));
    return scanOk && busyOk && delOk && guardOk && rbOk;
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

// Perfiles: lo que la app no comprueba al descargarlos de main (claves, niveles, versiones) y una escritura de prueba
// sobre un archivo real de cada juego (test/fixtures/<id>.*, sin datos personales). Así sirve también sin juegos instalados.
async function checkProfiles() {
  const dir = path.join(import.meta.dirname, "..", "profiles");
  const fixtures = path.join(import.meta.dirname, "..", "test", "fixtures");
  const index = JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8")).profiles;
  // Perfiles de juegos y de motores (engines/: Unreal y genérico, sin ruta propia); todos llegan en vivo desde main.
  const files = [
    ...(await fs.readdir(dir)).filter((f) => f.endsWith(".json") && f !== "index.json"),
    ...(await fs.readdir(path.join(dir, "engines"))).filter((f) => f.endsWith(".json")).map((f) => `engines/${f}`),
  ];
  const samples = await fs.readdir(fixtures).catch(() => []);
  let ok = true;
  for (const e of index.filter((x) => !files.includes(x.file))) { ok = false; console.log(`X  index.json apunta a ${e.file}, que no existe`); }
  for (const f of files) {
    const p = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
    const engine = f.startsWith("engines/");
    const entry = index.find((e) => e.file === f);
    const errs = [];
    if (!entry) errs.push("no está en index.json");
    else if (entry.id !== p.id || entry.version !== p.version) errs.push(`index.json dice ${entry.id} v${entry.version}, el perfil ${p.id} v${p.version}`);
    if (!engine && !Array.isArray(p.games) && !Array.isArray(p.names)) errs.push("sin games ni names");
    if (!engine && (!p.config?.path || !optimize.FORMATS[p.config.format])) errs.push(`formato o ruta no válidos (${p.config?.format})`);
    if (!Array.isArray(p.settings) || p.settings.length === 0) errs.push("sin ajustes");
    for (const s of p.settings ?? []) {
      if (typeof s.key !== "string" || !s.key) errs.push("ajuste sin clave");
      else if (!s.fixed && !(Array.isArray(s.levels) && s.levels.length > 0
        && s.levels.every((l) => Array.isArray(l) && typeof l[0] === "string" && typeof l[1] === "string" && typeof l[2] === "number"))) {
        errs.push(`${s.key}: niveles mal formados`);
      }
    }
    const sample = engine ? null : samples.find((x) => x.startsWith(`${p.id}.`));
    if (sample && errs.length === 0) {
      const text = await fs.readFile(path.join(fixtures, sample), "utf8");
      const game = { id: p.games?.[0] ?? `prueba-${p.id}`, name: p.names?.[0] ?? p.name, store: "Prueba", path: null };
      for (const goal of ["fps", "equilibrado", "calidad"]) {
        const r = await optimize.dryRun(game, goal, text);
        if (r.kind !== "perfil") errs.push(`[${goal}] no usa su perfil (${r.kind})`);
        if (r.failed.length) errs.push(`[${goal}] no se releen: ${r.failed.join(", ")}`);
        if (r.linesAfter !== r.linesBefore) errs.push(`[${goal}] cambia el número de líneas (${r.linesBefore} → ${r.linesAfter})`);
        if (goal === "equilibrado" && r.missing?.length) console.log(`   ${p.id}: claves que no están en el archivo de ejemplo: ${r.missing.join(", ")}`);
      }
    }
    // Perfil compartido: exportar y volver a importar no cambia nada; claves y valores desconocidos se ignoran.
    if (sample && errs.length === 0) {
      const text = await fs.readFile(path.join(fixtures, sample), "utf8");
      const game = { id: p.games?.[0] ?? `prueba-${p.id}`, name: p.names?.[0] ?? p.name, store: "Prueba", path: null };
      const shared = await optimize.exportShared(game, text);
      const same = await optimize.previewShared(game, shared, text);
      const [k] = Object.keys(shared.valores);
      const evil = { ...shared, valores: { ...shared.valores, [k]: "9999", "Ruta.Rara": "C:\\malo" } };
      const bad = await optimize.previewShared(game, evil, text);
      const other = await optimize.previewShared(game, { ...shared, perfil: "otro" }, text).then(() => true, () => false);
      if (!Object.keys(shared.valores).length) errs.push("compartir: no exporta ningún valor");
      if (same.changes.length || same.rejected) errs.push(`compartir: reimportar cambia ${same.changes.length} y rechaza ${same.rejected}`);
      if (bad.rejected !== 2 || bad.changes.length) errs.push(`compartir: debería rechazar 2 valores y no cambiar nada (${bad.rejected}, ${bad.changes.length})`);
      if (other) errs.push("compartir: acepta un perfil de otro juego");
    }
    if (errs.length) ok = false;
    console.log(`${errs.length ? "X " : "ok"} perfil ${p.id}${sample ? ` (probado con ${sample})` : " (sin archivo de ejemplo)"}${errs.length ? ": " + errs.join(" · ") : ""}`);
  }
  return ok;
}

app.whenReady().then(async () => {
  let ok = checkCalc();
  try { ok = (await checkProfiles()) && ok; } catch (e) { ok = false; console.error("FALLO perfiles", e); }
  try { ok = (await checkTech()) && ok; } catch (e) { ok = false; console.error("FALLO tecnologías", e); }
  try { ok = (await checkCleanup()) && ok; } catch (e) { ok = false; console.error("FALLO limpieza", e); }
  try {
    console.log("HW", JSON.stringify(await system.hardware()));
    const ws = await win.state(await system.hardware());
    console.log(`WIN ${ws.items.length} optimizaciones, ${ws.items.filter((i) => i.done).length} aplicadas`);
    const games = await system.games();
    if (games.length) {
      const first = await optimize.dryRun(games[0], "equilibrado");
      for (const f of first.factors) console.log(`   [${f.effect}] ${f.label}: ${f.value} · ${f.note}`);
    } else console.log("   (no hay juegos instalados: solo se prueban los perfiles con sus archivos de ejemplo)");
    for (const g of games) {
      for (const goal of ["fps", "equilibrado", "calidad"]) {
        const r = await optimize.dryRun(g, goal);
        const bad = r.failed.length > 0 || r.linesAfter !== r.linesBefore;
        if (bad) ok = false;
        const d = `GPU ${r.demand.gpu?.score ?? "?"} / CPU ${r.demand.cpu?.score ?? "?"} / RAM ${r.demand.ramGb ?? "?"}`;
        console.log(`${bad ? "X " : "ok"} ${g.name} [${goal}] ${r.kind} · pide ${d} · ~${r.estMax} → ~${r.estFinal} (objetivo ${r.target}, limita ${r.bottleneck})`
          + (r.noFile ? " · sin archivo" : ` · ${r.changed} cambios`) + (r.failed.length ? " FALLAN: " + r.failed.join(", ") : ""));
      }
    }
  } catch (e) {
    ok = false;
    console.error("FALLO", e);
  }
  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  app.exit(ok ? 0 : 1);
});
