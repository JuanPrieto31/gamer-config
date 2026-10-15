// Referencia de NVIDIA: si está instalada la app de NVIDIA, ya tiene descargados sus "ajustes óptimos" para
// este PC (probados en su laboratorio con tu gráfica, procesador y resolución). Se leen de su caché local,
// sin conectarse a nada, y se enseñan junto al cálculo para comparar.
//
// Cómo lo guarda la app de NVIDIA (%LOCALAPPDATA%\NVIDIA Corporation\NVIDIA App\NvBackend):
//  - ApplicationStorage.json: juegos detectados (ShortName + carpeta de instalación).
//  - Recommendations/<juego>/profiles_metadata.json → "ce": carpeta con la versión vigente.
//  - Recommendations/<juego>/<ce>/<variante>/metadata.json → "ops": [{ resolution, pops, belowMinSpec }] para ESTE PC,
//    donde pops es el paso elegido de una escalera de ajustes completos (pops.pub.tsv), del 1 (rendimiento)
//    al último (calidad máxima).
import fs from "node:fs/promises";
import path from "node:path";

const base = () => path.join(process.env.LOCALAPPDATA ?? "", "NVIDIA Corporation", "NVIDIA App", "NvBackend");
const readJson = async (...p) => JSON.parse(await fs.readFile(path.join(...p), "utf8"));
const dirOf = (p) => String(p ?? "").replace(/[\\/]+$/, "").toLowerCase();

export async function nvidiaReference(game, hw) {
  if (hw.vendor !== "nvidia" || !game.path || !hw.resW) return null;
  const apps = (await readJson(base(), "ApplicationStorage.json")).Applications ?? [];
  const dir = dirOf(game.path);
  const app = apps.map((a) => a.Application).find((a) => {
    const d = dirOf(a?.InstallDirectory);
    return d && (d === dir || d.startsWith(dir + "\\") || dir.startsWith(d + "\\"));
  });
  if (!app?.ShortName || !/^[\w.-]+$/.test(app.ShortName)) return null;
  const rec = path.join(base(), "Recommendations", app.ShortName);
  const { ce } = await readJson(rec, "profiles_metadata.json");
  if (!/^\w+$/.test(ce ?? "")) return null;
  const meta = await readJson(rec, ce, "metadata.json");
  const res = `${hw.resW}x${hw.resH}`;
  for (const [variant, v] of Object.entries(meta.metadata ?? meta)) {
    const op = v?.ops?.find((o) => o.resolution === res);
    if (!op || !/^\w+$/.test(variant)) continue;
    const steps = (await readJson(rec, ce, variant, "pops.pub.tsv").catch(() => null))?.pops?.length ?? null;
    if (op.belowMinSpec) {
      return { label: "Referencia de NVIDIA", value: "Por debajo del mínimo", effect: "warning",
        note: `En las pruebas de NVIDIA tu PC no llega al mínimo de ${app.DisplayName ?? "este juego"} a ${hw.resW}×${hw.resH}: baja la resolución o usa el escalado (DLSS/FSR)` };
    }
    const pos = steps > 1 ? (op.pops - 1) / (steps - 1) : null;
    const level = pos == null ? null : pos >= 0.9 ? "calidad máxima" : pos >= 0.6 ? "calidad alta" : pos >= 0.3 ? "calidad media" : "calidad baja";
    return { label: "Referencia de NVIDIA", value: steps ? `Paso ${op.pops} de ${steps}` : `Paso ${op.pops}`, effect: "info",
      note: `La app de NVIDIA, con sus pruebas para tu gráfica a ${hw.resW}×${hw.resH}, recomienda ${level ?? "este paso"} en este juego` };
  }
  return null;
}
