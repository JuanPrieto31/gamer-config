// Comprobación de drivers contra internet: Windows Update (todos los drivers) y NVIDIA (la gráfica).
// Si algo falla (sin internet, servicio caído), devuelve null y la app vuelve a estimar por antigüedad.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const TTL = 6 * 3600 * 1000; // no se vuelve a preguntar en 6 horas
const cache = new Map();
const pending = new Map();

// onlyCache: devuelve lo ya consultado sin salir a internet (para no frenar el análisis del panel).
async function cached(key, fn, onlyCache = false) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  if (onlyCache) return null;
  // Si ya hay una consulta en marcha (p. ej. la de arranque), se espera a esa en vez de lanzar otra.
  if (!pending.has(key)) {
    pending.set(key, fn().catch(() => null).then((value) => {
      if (value != null) cache.set(key, { at: Date.now(), value });
      pending.delete(key);
      return value;
    }));
  }
  return pending.get(key);
}

/** Drivers que Windows Update tiene pendientes para este PC (los publica el fabricante). null si no se pudo consultar. */
export function windowsUpdateDrivers(onlyCache = false) {
  return cached("wu", async () => {
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
      $q = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher(); $q.Online = $true
      $r = $q.Search("IsInstalled=0 and Type='Driver'")
      @($r.Updates | ForEach-Object { [pscustomobject]@{ title = $_.Title; cls = [string]$_.DriverClass; model = [string]$_.DriverModel; mfr = [string]$_.DriverManufacturer; date = $_.DriverVerDate.ToString('yyyy-MM-dd') } }) | ConvertTo-Json -Compress -Depth 3`;
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 60000 });
    const out = stdout.trim() ? JSON.parse(stdout) : [];
    return Array.isArray(out) ? out : [out];
  }, onlyCache);
}

const NV = "https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php";
const getText = (url) => fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))));
// "NVIDIA GeForce RTX 3050 6GB Laptop GPU" y "GeForce RTX 3050 Laptop GPU" → "rtx 3050 laptop"
const nvKey = (s) => s.toLowerCase().replace(/nvidia|geforce|\bgpu\b|\d+\s*gb/g, " ").replace(/\s+/g, " ").trim();

/** Último driver Game Ready de NVIDIA para esa gráfica: { version, date, url }. null si no se encuentra. */
export function nvidiaLatest(gpuName, onlyCache = false) {
  return cached(`nv:${gpuName}`, async () => {
    const xml = await cached("nv-catalog", () => getText("https://www.nvidia.com/Download/API/lookupValueSearch.aspx?TypeID=3"));
    if (!xml) return null;
    const want = nvKey(gpuName);
    const p = [...xml.matchAll(/ParentID="(\d+)">\s*<Name>([^<]*)<\/Name>\s*<Value>(\d+)/g)].find((m) => nvKey(m[2]) === want);
    if (!p) return null;
    const j = JSON.parse(await getText(`${NV}?func=DriverManualLookup&psid=${p[1]}&pfid=${p[3]}&osID=57&languageCode=1033&isWHQL=1&dch=1&sort1=0&numberOfResults=1`));
    const d = j?.IDS?.[0]?.downloadInfo;
    if (!d?.Version) return null;
    const date = new Date(d.ReleaseDateTime);
    return { version: d.Version, date: Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10), url: decodeURIComponent(d.DetailsURL ?? "") || null };
  }, onlyCache);
}

/** -1 si a es más antigua que b, 0 si igual, 1 si más nueva ("617.14" vs "617.42"). */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
