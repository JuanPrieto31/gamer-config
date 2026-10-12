// Comprobación rápida, SOLO LECTURA (no escribe nada en los juegos): npm test
import { app } from "electron";
import * as system from "./system.js";
import * as optimize from "./optimize.js";
import * as win from "./windows.js";
import { solve } from "./calc.js";
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
  return ok && notUltra;
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

app.whenReady().then(async () => {
  let ok = checkCalc();
  try { ok = (await checkCleanup()) && ok; } catch (e) { ok = false; console.error("FALLO limpieza", e); }
  try {
    console.log("HW", JSON.stringify(await system.hardware()));
    const ws = await win.state(await system.hardware());
    console.log(`WIN ${ws.items.length} optimizaciones, ${ws.items.filter((i) => i.done).length} aplicadas`);
    const first = await optimize.dryRun((await system.games())[0], "equilibrado");
    for (const f of first.factors) console.log(`   [${f.effect}] ${f.label}: ${f.value} · ${f.note}`);
    for (const g of await system.games()) {
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
