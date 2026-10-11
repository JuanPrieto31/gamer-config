// Rendimiento en juegos de un procesador, aproximado (Ryzen 5 3600 = 100), a partir de medias de benchmarks
// de juegos a 1080p (TechPowerUp, Tom's Hardware, Hardware Unboxed). En vez de una lista cerrada se calcula
// por familia + generación + gama + sufijo, así reconoce cualquier Core / Ryzen, también los futuros.

// Intel Core: generación → puntuación de un i5 de sobremesa.
const INTEL_GEN = { 2: 45, 3: 50, 4: 58, 5: 60, 6: 70, 7: 75, 8: 85, 9: 90, 10: 95, 11: 105, 12: 130, 13: 140, 14: 145 };
const INTEL_TIER = { 3: 0.75, 5: 1, 7: 1.15, 9: 1.25 };
// AMD Ryzen: primera cifra del modelo → puntuación de un Ryzen 5 de sobremesa.
const RYZEN_GEN = { 1: 70, 2: 78, 3: 100, 4: 90, 5: 125, 6: 110, 7: 145, 8: 140, 9: 165 };
const RYZEN_TIER = { 3: 0.75, 5: 1, 7: 1.1, 9: 1.15 };

// Sufijos de portátil: menos consumo, menos rendimiento sostenido.
function mobileFactor(suffix) {
  const s = (suffix ?? "").toLowerCase();
  if (/hx/.test(s)) return 0.95;
  if (/^(h|hs|hk|hq|h[0-9])/.test(s)) return 0.85;
  if (/^(u|p|y|m|v|g\d)/.test(s)) return 0.65;
  return 1;
}

const clean = (s) => String(s).toLowerCase().replace(/\((r|tm)\)|[®™]/g, "").replace(/\s+/g, " ");

// Puntúa un único nombre de procesador. Devuelve null si no lo reconoce.
function one(n) {
  let m;
  // Intel Core Ultra 5/7/9 (2023+)
  if ((m = n.match(/core\s*ultra\s*([579])\s*(\d)\d{2}([a-z]*)/))) {
    const base = m[2] === "2" ? 150 : 140;
    return Math.round(base * INTEL_TIER[m[1]] * mobileFactor(m[3]));
  }
  // Intel Core i3/i5/i7/i9-XXXX(X)
  if ((m = n.match(/i([3579])[\s-]*(\d{4,5})([a-z]*\d?)/))) {
    const num = m[2];
    // 5 cifras (12450) o 4 empezando por 1 (1115G4, 1035G1): la generación son las dos primeras.
    const gen = num.length === 5 || num[0] === "1" ? Number(num.slice(0, 2)) : Number(num[0]);
    const base = INTEL_GEN[gen] ?? (gen > 14 ? 150 : 45);
    const tier = gen < 8 && m[1] === "3" ? 0.65 : INTEL_TIER[m[1]]; // los i3 antiguos tenían 2 núcleos
    return Math.round(base * tier * mobileFactor(m[3]));
  }
  // Intel Core de 1.ª generación, modelo de 3 cifras (i7 860, i5 750, i3 530)
  if ((m = n.match(/i([3579])[\s-]*(\d{3})([a-z]*)\b/))) return Math.round(38 * (m[1] === "3" ? 0.65 : INTEL_TIER[m[1]]) * mobileFactor(m[3]));
  // Intel Core i5 sin modelo ("Intel Core i5 or equivalent")
  if ((m = n.match(/core\s*i([3579])\b/))) return Math.round(70 * INTEL_TIER[m[1]]);
  // AMD Ryzen 3/5/7/9 XXXX(X3D / H / U...)
  if ((m = n.match(/ryzen\s*([3579])\s*(?:pro\s*)?(\d)(\d{3})([a-z0-9]*)/))) {
    let base = RYZEN_GEN[m[2]] ?? 100;
    const suffix = m[4];
    if (m[2] === "7" && /^(h|hs|u)/.test(suffix) && Number(m[3][1]) < 4) base = 110; // 7x35 = Zen 3+
    if (/x3d/.test(suffix)) base *= 1.2;
    return Math.round(base * RYZEN_TIER[m[1]] * mobileFactor(suffix.replace(/^x3d|^x/, "")));
  }
  // Ryzen sin modelo ("Ryzen 5 CPU or equivalent")
  if ((m = n.match(/ryzen\s*([3579])\b/))) return Math.round(100 * RYZEN_TIER[m[1]]);
  if ((m = n.match(/ryzen\s*ai\s*([579])/))) return Math.round(150 * RYZEN_TIER[m[1]] * 0.85);
  // Antiguos y de entrada
  if (/fx[\s-]*(8|9)\d{3}/.test(n)) return 40;
  if (/fx[\s-]*\d{4}/.test(n)) return 32;
  if (/phenom/.test(n)) return 25;
  if (/athlon|a(6|8|10|12)[\s-]*\d{4}/.test(n)) return 22;
  if (/core\s*2\s*(quad|q\d)/.test(n)) return 20;
  if (/core\s*2|e\d{4}|dual[\s-]*core/.test(n)) return 14;
  if (/pentium\s*gold|pentium\s*g[5-9]/.test(n)) return 45;
  if (/pentium|celeron/.test(n)) return 22;
  if (/xeon/.test(n)) return 70;
  if (/quad[\s-]*core|4\s*cores/.test(n)) return 35;
  if (/(six|hexa)[\s-]*core|6\s*cores/.test(n)) return 70;
  if (/(eight|octa)[\s-]*core|8\s*cores/.test(n)) return 90;
  return null;
}

// Tu procesador.
export function cpuScoreOf(name) {
  return one(clean(name)) ?? 80; // desconocido: se asume uno de gama media
}

// Lo que pide un texto de requisitos ("Intel Core i5 3570K or AMD FX-8310"): media de los que se reconocen.
export function cpuDemandOf(text) {
  const parts = clean(text).split(/\s*(?:,|\/|\bor\b|\bo\b|\|)\s*/);
  const scores = parts.map(one).filter((x) => x != null);
  if (scores.length === 0) return null;
  return { score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) };
}
