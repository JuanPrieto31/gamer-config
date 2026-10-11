// Comprobación rápida, SOLO LECTURA (no escribe nada en los juegos): npm test
import { app } from "electron";
import * as system from "./system.js";
import * as optimize from "./optimize.js";
import * as win from "./windows.js";
import { solve } from "./calc.js";

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

app.whenReady().then(async () => {
  let ok = checkCalc();
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
