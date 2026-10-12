// Lector/escritor genérico de archivos de configuración de juegos.
// Detecta el formato solo y devuelve todos los ajustes como { key, value }.
// Al escribir solo se cambia el valor en su sitio: el resto del archivo queda igual (comentarios, orden, espacios).

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function detectFormat(text, file = "") {
  const t = text.replace(/^﻿/, "").trimStart();
  if (/\.json$/i.test(file) || /^[[{]/.test(t)) {
    try { JSON.parse(t); return "json"; } catch { /* no es JSON */ }
  }
  if (t.startsWith("<")) return "xml";
  if ((t.match(/^\s*"[^"\n]+"\s+"[^"\n]*"\s*$/gm) ?? []).length >= 3) return "kv";
  if ((t.match(/^\w+\(.*\)\s*$/gm) ?? []).length >= 3) return "scr";
  if ((t.match(/^\s*[^#;/\s=][^=\n]*=.*$/gm) ?? []).length >= 2) return "ini";
  if ((t.match(/^\s*[a-z_][\w.]*\s+"?[^\s"]+"?\s*$/gim) ?? []).length >= 3) return "space"; // cl_algo "1"
  return null;
}

/* ---------- Lectura ---------- */

function parseIni(text) {
  const out = [];
  let sec = "";
  for (const line of text.split(/\r?\n/)) {
    const s = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (s) { sec = s[1]; continue; }
    const kv = line.match(/^\s*([^#;=\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (kv) out.push({ key: sec ? `${sec}::${kv[1]}` : kv[1], value: kv[2] });
  }
  return out;
}

function flattenJson(obj, prefix = "", out = []) {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) flattenJson(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.push({ key: prefix, value: String(obj) });
  }
  return out;
}

const XML_NAMED = /<(\w+)\s+name="([^"]+)"[^>]*>([^<]*)<\/\1>/g; // <int name="Quality">5</int> (Roblox, etc.)
const XML_LEAF = /<(\w+)>([^<>]*)<\/\1>/g; //                      <ShadowQuality>2</ShadowQuality>
const XML_ATTR = /<\w+\s+(?:name|key|id)="([^"]+)"\s+value="([^"]*)"/g; // <Setting name="x" value="y"/>

function parseXml(text) {
  const out = [];
  for (const m of text.matchAll(XML_NAMED)) out.push({ key: m[2], value: m[3].trim() });
  for (const m of text.matchAll(XML_ATTR)) out.push({ key: m[1], value: m[2] });
  if (out.length === 0) for (const m of text.matchAll(XML_LEAF)) out.push({ key: m[1], value: m[2].trim() });
  return out;
}

export function parse(text, format) {
  const t = text.replace(/^﻿/, "");
  switch (format) {
    case "ini": return parseIni(t);
    case "json": return flattenJson(JSON.parse(t));
    case "xml": return parseXml(t);
    case "kv": return [...t.matchAll(/^\s*"([^"\n]+)"\s+"([^"\n]*)"\s*$/gm)].map((m) => ({ key: m[1], value: m[2] }));
    case "scr": return [...t.matchAll(/^(\w+)\((.*)\)\s*$/gm)].map((m) => ({ key: m[1], value: m[2].trim() }));
    case "space": return [...t.matchAll(/^\s*([a-z_][\w.]*)\s+"?([^\s"]+)"?\s*$/gim)].map((m) => ({ key: m[1], value: m[2] }));
    default: return [];
  }
}

/* ---------- Escritura (cambia un valor y devuelve el texto nuevo, o null si no lo encuentra) ---------- */

function writeIni(text, key, value) {
  const [sec, k] = key.includes("::") ? key.split("::") : [null, key];
  let start = 0;
  let end = text.length;
  if (sec) {
    const s = text.search(new RegExp(`^\\[${esc(sec)}\\][ \\t]*$`, "m"));
    if (s === -1) return null;
    start = s;
    const next = text.slice(s + 1).search(/^\[/m);
    if (next !== -1) end = s + 1 + next;
  }
  const re = new RegExp(`^(\\s*${esc(k)}\\s*=\\s*)(.*?)(\\s*)$`, "m");
  const block = text.slice(start, end);
  if (!re.test(block)) return null;
  return text.slice(0, start) + block.replace(re, (_, a, __, c) => `${a}${value}${c}`) + text.slice(end);
}

function writeJson(text, key, value) {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const obj = JSON.parse(text.replace(/^﻿/, ""));
  const parts = key.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) { if (o?.[p] === undefined) return null; o = o[p]; }
  const last = parts.at(-1);
  if (!(last in o)) return null;
  const old = o[last];
  if (typeof old === "number" && !Number.isFinite(Number(value))) return null; // un texto en un número se guardaría como null
  o[last] = typeof old === "number" ? Number(value) : typeof old === "boolean" ? value === "true" : value;
  const indent = text.match(/\n([ \t]+)"/)?.[1] ?? (text.includes("\n") ? 2 : 0);
  return bom + JSON.stringify(obj, null, indent) + (text.endsWith("\n") ? "\n" : "");
}

function writeXml(text, key, raw) {
  // Caracteres reservados escapados (sin tocar entidades que ya lo estén), para que el XML siga siendo válido.
  const value = String(raw).replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const named = new RegExp(`(<(\\w+)\\s+name="${esc(key)}"[^>]*>)([^<]*)(<\\/\\2>)`);
  if (named.test(text)) return text.replace(named, (_, a, __, ___, d) => `${a}${value}${d}`);
  const attr = new RegExp(`(<\\w+\\s+(?:name|key|id)="${esc(key)}"\\s+value=")([^"]*)(")`);
  if (attr.test(text)) return text.replace(attr, (_, a, __, c) => `${a}${value}${c}`);
  const leaf = new RegExp(`(<${esc(key)}>)([^<>]*)(<\\/${esc(key)}>)`);
  if (leaf.test(text)) return text.replace(leaf, (_, a, __, c) => `${a}${value}${c}`);
  return null;
}

function replaceLine(text, re, make) {
  return re.test(text) ? text.replace(re, make) : null;
}

export function write(text, format, key, value) {
  switch (format) {
    case "ini": return writeIni(text, key, value);
    case "json": return writeJson(text, key, value);
    case "xml": return writeXml(text, key, value);
    case "kv": return replaceLine(text, new RegExp(`^(\\s*"${esc(key)}"\\s+")([^"\\n]*)(")`, "m"), (_, a, __, c) => `${a}${value}${c}`);
    case "scr": return replaceLine(text, new RegExp(`^(${esc(key)}\\()(.*)(\\)\\s*)$`, "m"), (_, a, __, c) => `${a}${value}${c}`);
    case "space": return replaceLine(text, new RegExp(`^(\\s*${esc(key)}\\s+"?)([^\\s"]+)("?\\s*)$`, "mi"), (_, a, __, c) => `${a}${value}${c}`);
    default: return null;
  }
}

// Comprobación mínima de ida y vuelta para cada formato (node electron/configparse.js).
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  const cases = {
    ini: ["[Graphics]\r\nShadows=2\r\nAA=1\r\n[Audio]\r\nShadows=9\r\n", "Graphics::Shadows", "0"],
    json: ['{\n  "video": { "shadows": 3, "vsync": true }\n}\n', "video.shadows", "1"],
    xml: ['<Settings><int name="Quality">5</int><ShadowQuality>2</ShadowQuality></Settings>', "Quality", "3"],
    kv: ['"cfg"\n{\n\t"setting.a"\t\t"1"\n\t"setting.b"\t\t"2"\n\t"setting.c"\t\t"3"\n}', "setting.b", "0"],
    scr: ["A(1)\nB(2, 2)\nC(\"High\")\n", "B", "1, 1"],
    space: ['cl_a "1"\ncl_b "2"\ncl_c "3"\n', "cl_b", "5"],
  };
  for (const [fmt, [text, key, val]] of Object.entries(cases)) {
    const f = detectFormat(text);
    const out = write(text, fmt, key, val);
    const back = parse(out ?? "", fmt).find((e) => e.key === key)?.value;
    const untouched = fmt !== "ini" || parse(out, "ini").find((e) => e.key === "Audio::Shadows")?.value === "9";
    console.log(f === fmt && back === val && untouched ? "ok" : "X ", fmt, "detectado:", f, "→", back);
  }
}
