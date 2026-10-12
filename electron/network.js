// Prueba de conexión: ¿el lag es del PC/Wi-Fi o de internet?
// Router: ping. Internet y servidores: tiempo de abrir una conexión TCP (no depende del idioma de Windows
// y funciona aunque el servidor no responda a ping). Unos 10 s en total.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";

const run = promisify(execFile);
const opts = { windowsHide: true };

// Muchos juegos se alojan en AWS: sus regiones sirven de referencia para saber cuánto tardas a cada zona.
const TARGETS = [
  { id: "internet", name: "Internet (Cloudflare)", host: "1.1.1.1", port: 443 },
  { id: "na-east", name: "Norteamérica Este (Virginia)", host: "dynamodb.us-east-1.amazonaws.com", port: 443 },
  { id: "na-west", name: "Norteamérica Oeste (Oregón)", host: "dynamodb.us-west-2.amazonaws.com", port: 443 },
  { id: "sa", name: "Sudamérica (São Paulo)", host: "dynamodb.sa-east-1.amazonaws.com", port: 443 },
  { id: "eu", name: "Europa (Irlanda)", host: "dynamodb.eu-west-1.amazonaws.com", port: 443 },
];
const SAMPLES = 10;

function connectTime(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const t = process.hrtime.bigint();
    const s = net.connect({ host, port, timeout });
    const end = (ms) => { s.destroy(); resolve(ms); };
    s.once("connect", () => end(Number(process.hrtime.bigint() - t) / 1e6));
    s.once("timeout", () => end(null));
    s.once("error", () => end(null));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Media, variación entre medidas seguidas (jitter) y pérdidas.
function summarize(times) {
  const ok = times.filter((x) => x != null);
  const loss = Math.round((100 * (times.length - ok.length)) / times.length);
  if (!ok.length) return { avg: null, jitter: null, loss, min: null };
  const avg = ok.reduce((a, b) => a + b, 0) / ok.length;
  const jitter = ok.length > 1 ? ok.slice(1).reduce((a, x, i) => a + Math.abs(x - ok[i]), 0) / (ok.length - 1) : 0;
  return { avg: Math.round(avg), jitter: Math.round(jitter * 10) / 10, loss, min: Math.round(Math.min(...ok)) };
}

async function tcp(target) {
  await connectTime(target.host, target.port); // la primera incluye la búsqueda DNS: no cuenta
  const times = [];
  for (let i = 0; i < SAMPLES; i++) {
    times.push(await connectTime(target.host, target.port));
    await wait(250);
  }
  return { ...target, ...summarize(times) };
}

async function router() {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop"], opts).catch(() => ({ stdout: "" }));
  const gw = stdout.trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(gw)) return null;
  // Win32_PingStatus da números (no texto traducido): funciona igual con Windows en cualquier idioma. StatusCode 0 = respondió.
  const { stdout: out } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `1..${SAMPLES} | ForEach-Object { $p = Get-CimInstance Win32_PingStatus -Filter "Address='${gw}' AND Timeout=1000"; if ($p.StatusCode -eq 0) { $p.ResponseTime } else { -1 }; Start-Sleep -Milliseconds 200 }`], opts).catch(() => ({ stdout: "" }));
  const times = out.trim().split(/\s+/).filter(Boolean).map(Number).map((x) => (x >= 0 ? Math.max(x, 0.5) : null));
  if (!times.length) return null;
  return { id: "router", name: `Tu router (${gw})`, host: gw, ...summarize(times) };
}

async function adapter() {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $a = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Sort-Object { $_.PhysicalMediaType -match '802.11' } | Select-Object -First 1; if ($a) { [pscustomobject]@{ name = $a.InterfaceDescription; wifi = [bool]($a.PhysicalMediaType -match '802.11|Wireless'); speed = $a.LinkSpeed } | ConvertTo-Json -Compress }"], opts).catch(() => ({ stdout: "" }));
  const a = stdout.trim() ? JSON.parse(stdout) : null;
  if (a?.wifi) {
    const { stdout: w } = await run("netsh", ["wlan", "show", "interfaces"], opts).catch(() => ({ stdout: "" }));
    a.signal = Number(w.match(/(\d+)\s*%/)?.[1]) || null;
  }
  return a;
}

export async function test() {
  const [rt, ad, ...remote] = await Promise.all([router(), adapter(), ...TARGETS.map(tcp)]);
  const rows = [rt, ...remote].filter(Boolean);
  return { adapter: ad, rows, verdict: verdict(ad, rt, remote) };
}

// Conclusión en lenguaje normal.
function verdict(ad, rt, remote) {
  const out = [];
  // "Internet" = el mejor de los destinos que respondieron (si uno solo falla, puede ser un bloqueo de ese servidor).
  const answered = remote.filter((r) => r.avg != null);
  if (!answered.length) return [{ level: "bad", text: "Ningún servidor respondió: no hay conexión a internet o un cortafuegos bloquea las conexiones." }];
  const inet = remote.find((r) => r.id === "internet" && r.avg != null) ?? answered.sort((a, b) => a.avg - b.avg)[0];
  if (ad?.wifi && ((rt?.avg ?? 0) > 5 || (rt?.jitter ?? 0) > 5 || (rt?.loss ?? 0) > 0)) {
    out.push({ level: "bad", text: `Vas por Wi-Fi${ad.signal ? ` (señal ${ad.signal} %)` : ""} y ya hasta el router hay retraso o cortes: un cable de red mejoraría el ping y quitaría los picos.` });
  } else if (ad?.wifi) {
    out.push({ level: "warn", text: `Vas por Wi-Fi${ad.signal ? ` (señal ${ad.signal} %)` : ""}. Ahora va bien, pero el Wi-Fi da picos de lag con más facilidad que el cable.` });
  }
  if ((rt?.loss ?? 0) > 0) out.push({ level: "bad", text: `Se pierden paquetes entre el PC y el router (${rt.loss} %): revisa el cable o la señal.` });
  if (inet.loss > 0 && !(rt?.loss > 0)) out.push({ level: "bad", text: `Se pierden conexiones hacia internet (${inet.loss} %) pero no hasta el router: el problema probablemente está en tu proveedor de internet.` });
  if (inet.jitter > 15) out.push({ level: "warn", text: `La latencia varía mucho (±${inet.jitter} ms): en el juego se notará como tirones de red.` });
  const best = remote.filter((r) => r.id !== "internet" && r.avg != null).sort((a, b) => a.avg - b.avg)[0];
  if (best) out.push({ level: "ok", text: `La zona más cercana es ${best.name} (~${best.avg} ms). Elige servidores de esa región en tus juegos.` });
  if (!out.some((v) => v.level !== "ok")) out.unshift({ level: "ok", text: "Tu conexión está estable hasta el router y hacia internet. Si notas lag, lo más probable es que venga del servidor del juego o de la ruta hasta él." });
  return out;
}
