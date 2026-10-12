// Base de datos de gráficas: rendimiento relativo aproximado a 1080p (RTX 3060 de sobremesa = 100),
// a partir de medias de benchmarks públicos (TechPowerUp, Tom's Hardware, Notebookcheck).
// Sirve tanto para la gráfica del usuario como para las que piden los requisitos de los juegos.
// d = sobremesa, l = portátil (si falta, se usa el 80 % de la de sobremesa).
// El orden importa: las variantes (Ti, Super, XT...) van antes que el modelo base.

const GPUS = [
  // NVIDIA RTX 50 (las de portátil rinden bastante menos que las de sobremesa del mismo nombre)
  [/rtx\s*5090/, 400, 220], [/rtx\s*5080/, 300, 190], [/rtx\s*5070\s*ti/, 265, 150], [/rtx\s*5070/, 215, 120],
  [/rtx\s*5060\s*ti/, 165], [/rtx\s*5060/, 140, 105], [/rtx\s*5050/, 110, 85],
  // NVIDIA RTX 40
  [/rtx\s*4090/, 340, 210], [/rtx\s*4080\s*super/, 280], [/rtx\s*4080/, 270, 180], [/rtx\s*4070\s*ti\s*super/, 235],
  [/rtx\s*4070\s*ti/, 220], [/rtx\s*4070\s*super/, 200], [/rtx\s*4070/, 175, 115], [/rtx\s*4060\s*ti/, 135],
  [/rtx\s*4060/, 115, 100], [/rtx\s*4050/, 90, 85],
  // NVIDIA RTX 30
  [/rtx\s*3090\s*ti/, 210], [/rtx\s*3090/, 195], [/rtx\s*3080\s*ti/, 190, 135], [/rtx\s*3080/, 175, 120],
  [/rtx\s*3070\s*ti/, 150, 115], [/rtx\s*3070/, 140, 105], [/rtx\s*3060\s*ti/, 125],
  // Mismo nombre, distinta memoria: la RTX 3060 de 8 GB (2022) rinde ~15 % menos que la de 12 GB.
  [/rtx\s*3060/, 85, 75, 8], [/rtx\s*3060/, 100, 85],
  // La RTX 3050 de sobremesa de 6 GB (2024) es bastante más lenta que la de 8 GB.
  [/rtx\s*3050\s*ti/, 75, 60], [/rtx\s*3050\s*6\s*gb(?!.*(laptop|mobile|max-q))/, 58], [/rtx\s*3050/, 70, 55],
  // NVIDIA RTX 20 / GTX 16
  [/rtx\s*2080\s*ti/, 150], [/rtx\s*2080\s*super/, 130, 105], [/rtx\s*2080/, 125, 100], [/rtx\s*2070\s*super/, 115, 90],
  [/rtx\s*2070/, 100, 85], [/rtx\s*2060\s*super/, 95], [/rtx\s*2060/, 85, 70], [/rtx\s*2050/, 40, 40],
  [/gtx\s*1660\s*ti/, 68, 58], [/gtx\s*1660\s*super/, 66], [/gtx\s*1660/, 60], [/gtx\s*1650\s*ti/, 45, 42],
  [/gtx\s*1650\s*super/, 55], [/gtx\s*1650/, 42, 37], [/gtx\s*1630/, 25],
  // NVIDIA GTX 10
  [/gtx\s*1080\s*ti/, 110], [/gtx\s*1080/, 90, 80], [/gtx\s*1070\s*ti/, 82], [/gtx\s*1070/, 75, 68],
  [/gtx\s*1060\s*3\s*gb/, 50], [/gtx\s*1060/, 55, 48], [/gtx\s*1050\s*ti/, 33, 30], [/gtx\s*1050/, 27, 24], [/gt\s*1030/, 14],
  // NVIDIA GTX 900 / 700 / 600 / 500 / 400
  [/gtx\s*titan\s*x/, 74], [/gtx\s*980\s*ti/, 72], [/gtx\s*980m/, 38], [/gtx\s*980/, 58], [/gtx\s*970m/, 30], [/gtx\s*970/, 50],
  [/gtx\s*965m/, 22], [/gtx\s*960m/, 15], [/gtx\s*960/, 32], [/gtx\s*950m/, 13], [/gtx\s*950/, 27],
  [/gtx\s*780\s*ti/, 45], [/gtx\s*780/, 40], [/gtx\s*770/, 33], [/gtx\s*760/, 28], [/gtx\s*750\s*ti/, 20], [/gtx\s*750/, 17],
  [/gtx\s*690/, 40], [/gtx\s*680/, 32], [/gtx\s*670/, 29], [/gtx\s*660\s*ti/, 25], [/gtx\s*660/, 22], [/gtx\s*650\s*ti/, 15], [/gtx\s*650/, 10],
  [/gtx\s*590/, 30], [/gtx\s*580/, 22], [/gtx\s*570/, 19], [/gtx\s*560\s*ti/, 15], [/gtx\s*560/, 13], [/gtx\s*550\s*ti/, 9],
  [/gtx\s*480/, 18], [/gtx\s*470/, 15], [/gtx\s*460/, 11], [/gts\s*450/, 7], [/gt\s*740/, 8], [/gt\s*730/, 6], [/gt\s*7[12]0/, 4],
  [/gtx\s*2[68]0/, 8], [/9800\s*gtx?/, 6], [/8800\s*gt/, 5],
  // NVIDIA portátil de entrada
  [/mx\s*570/, 22], [/mx\s*550/, 18], [/mx\s*450/, 16], [/mx\s*350/, 11], [/mx\s*330/, 11], [/mx\s*250/, 10], [/mx\s*230/, 8], [/mx\s*150/, 9], [/mx\s*1[13]0/, 6],

  // AMD RX 9000 / 7000 / 6000
  [/rx\s*9070\s*xt/, 280], [/rx\s*9070\s*gre/, 210], [/rx\s*9070/, 250], [/rx\s*9060\s*xt/, 150], [/rx\s*9060/, 130],
  [/rx\s*7900\s*xtx/, 300], [/rx\s*7900\s*xt/, 260], [/rx\s*7900\s*gre/, 225], [/rx\s*7800\s*xt/, 200], [/rx\s*7700\s*xt/, 170], [/rx\s*7700s/, 120], [/rx\s*7700/, 150],
  [/rx\s*7650\s*gre/, 125], [/rx\s*7600m\s*xt/, 105], [/rx\s*7600m/, 95], [/rx\s*7600s/, 95], [/rx\s*7600\s*xt/, 120], [/rx\s*7600/, 115],
  [/rx\s*6950\s*xt/, 235], [/rx\s*6900\s*xt/, 225], [/rx\s*6850m/, 150], [/rx\s*6800m/, 140], [/rx\s*6800s/, 110], [/rx\s*6800\s*xt/, 210], [/rx\s*6800/, 185],
  [/rx\s*6750\s*xt/, 150], [/rx\s*6700m/, 110], [/rx\s*6700s/, 95], [/rx\s*6700\s*xt/, 140], [/rx\s*6700/, 125], [/rx\s*6650\s*xt/, 115], [/rx\s*6650m/, 100],
  [/rx\s*6600m/, 95], [/rx\s*6600s/, 80], [/rx\s*6600\s*xt/, 110], [/rx\s*6600/, 95], [/rx\s*6550m/, 50], [/rx\s*6500m/, 45], [/rx\s*6500\s*xt/, 50], [/rx\s*6400/, 38],
  // AMD RX 5000 / Vega / 500 / 400
  [/rx\s*5700\s*xt/, 105], [/rx\s*5700/, 95], [/rx\s*5600m/, 60], [/rx\s*5600\s*xt/, 85], [/rx\s*5600/, 75], [/rx\s*5500m/, 45], [/rx\s*5500/, 55],
  [/radeon\s*vii/, 95], [/vega\s*64/, 80], [/vega\s*56/, 72],
  [/rx\s*5300m/, 35], [/rx\s*590/, 58], [/rx\s*580/, 53], [/rx\s*570/, 46], [/rx\s*560/, 25], [/rx\s*550/, 15], [/rx\s*480/, 50], [/rx\s*470/, 44], [/rx\s*460/, 22],
  [/rx\s*640/, 11], [/rx\s*6[23]0/, 9], [/rx\s*540/, 8], [/r[57]\s*m\d{3}/, 6], // gráficas AMD de portátil de entrada (2017-2020)
  // AMD R9 / R7 / HD
  [/r9\s*fury\s*x/, 65], [/r9\s*(nano|fury)/, 60], [/r9\s*390x/, 52], [/r9\s*390/, 50], [/r9\s*290x/, 47], [/r9\s*290/, 44],
  [/r9\s*380x/, 36], [/r9\s*380/, 33], [/r9\s*285/, 30], [/r9\s*280x/, 32], [/r9\s*280/, 30], [/r9\s*270x/, 25], [/r9\s*270/, 23],
  [/r7\s*370/, 20], [/r7\s*265/, 20], [/r7\s*260x?/, 15], [/r7\s*250/, 9],
  [/hd\s*7970/, 32], [/hd\s*7950/, 27], [/hd\s*7870/, 22], [/hd\s*7850/, 18], [/hd\s*7790/, 15], [/hd\s*7770/, 11], [/hd\s*7750/, 8],
  [/hd\s*6970/, 17], [/hd\s*6950/, 16], [/hd\s*6870/, 14], [/hd\s*6850/, 12], [/hd\s*5870/, 13], [/hd\s*5850/, 11], [/hd\s*4870/, 6],
  // AMD integradas (las 8060S/8050S de los Ryzen AI Max rinden como una gráfica dedicada media)
  [/radeon\s*8060s/, 95], [/radeon\s*8050s/, 75], [/radeon\s*890m/, 45], [/radeon\s*880m/, 40], [/radeon\s*780m/, 38], [/radeon\s*760m/, 30], [/radeon\s*740m/, 20],
  [/radeon\s*680m/, 30], [/radeon\s*660m/, 20], [/radeon\s*610m/, 6], [/vega\s*11/, 10], [/vega\s*(8|10)/, 9], [/vega\s*[367]/, 7],

  // Intel
  [/arc\s*b580/, 120], [/arc\s*b570/, 105], [/arc\s*a770/, 110], [/arc\s*a750/, 100], [/arc\s*a580/, 85], [/arc\s*a380/, 40], [/arc\s*a310/, 25],
  [/arc\s*a7\d0m/, 70], [/arc\s*a5\d0m/, 50], [/arc\s*a3\d0m/, 25], [/arc\s*140[tv]/, 40], [/arc\s*130[tv]/, 32],
  [/intel.*arc\s*graphics/, 34], [/iris\s*xe/, 13], [/iris\s*plus/, 7], [/iris\s*pro/, 6], [/iris/, 5],
  [/uhd\s*(graphics\s*)?7[0-9]0/, 6], [/uhd\s*(graphics\s*)?6[0-9]0/, 5], [/uhd/, 4], [/hd\s*graphics\s*6[0-9]0/, 4], [/hd\s*graphics\s*5[0-9]0/, 4],
  [/hd\s*graphics\s*4000/, 2], [/hd\s*graphics\s*4[0-9]00/, 3], [/hd\s*graphics\s*[23]000/, 1],
  // maxVram (4.º valor): esa fila solo vale para las versiones con esa memoria o menos (p. ej. RTX 3060 de 8 GB).
].map(([re, d, l, maxVram]) => ({ re: new RegExp(re.source, "g"), d, l, maxVram }));

const clean = (s) => String(s).toLowerCase().replace(/\((r|tm|c)\)|[®™]/g, "").replace(/[()]/g, " ").replace(/\s+/g, " ");
const isLaptop = (s) => /laptop|mobile|max-q|notebook/.test(s);

// Integradas (comparten la RAM): no tienen versión de portátil distinta ni límite de potencia propio.
export const isIntegrated = (name) => /intel.*(uhd|hd\s*graphics|iris|arc\s*(1[34]0[tv]|graphics))|radeon\s*(\d{3}m|80[56]0s|graphics|vega)|vega\s*\d+\b/i.test(clean(name));
// Modelos que solo existen en portátil (RX 7700S, RX 6600M, MX 450, RTX 2050): su cifra ya es la de portátil.
const mobileOnly = (n) => /rx\s*\d{4}\s*(m|s)\b|mx\s*\d{3}|rtx\s*2050|\b\d{3,4}m\b/.test(n);

// Potencia (W) típica con la que se mide cada gama de portátil en la tabla; la tuya puede ser mayor o menor.
const refWatts = (laptopScore) => (laptopScore < 45 ? 50 : laptopScore < 65 ? 75 : laptopScore < 95 ? 90 : laptopScore < 130 ? 115 : 150);

// Puntuación de una gráfica concreta (la del usuario). vramGb sirve de respaldo si no está en la tabla.
// opts.laptop: el PC es portátil (Windows no siempre pone "Laptop" en el nombre: "GeForce GTX 1650" en portátil).
// opts.watts: potencia máxima de la gráfica (nvidia-smi). La misma RTX 4060 Laptop rinde muy distinto a 45 W que a 140 W.
export function scoreOf(name, vramGb = null, opts = {}) {
  const n = clean(name);
  const laptop = isLaptop(n) || (opts.laptop && !isIntegrated(name));
  for (const g of GPUS) {
    g.re.lastIndex = 0;
    if (!g.re.test(n)) continue;
    if (g.maxVram && !(vramGb && vramGb <= g.maxVram)) continue; // variante de otra memoria
    if (!laptop) return g.d;
    const l = g.l ?? (mobileOnly(n) ? g.d : Math.round(g.d * 0.8));
    // ponytail: corrección por potencia con una curva suave (raíz ~0,45); si no hay dato, la cifra típica.
    const w = opts.watts > 0 ? Math.min(Math.max((opts.watts / refWatts(l)) ** 0.45, 0.7), 1.12) : 1;
    return Math.round(l * w);
  }
  // Desconocida: integrada → muy baja; dedicada → estimación por su memoria.
  if (!vramGb || /intel|graphics$|radeon\s*graphics/.test(n)) return 8;
  const byVram = vramGb >= 16 ? 200 : vramGb >= 12 ? 140 : vramGb >= 8 ? 100 : vramGb >= 6 ? 70 : vramGb >= 4 ? 45 : 25;
  return isLaptop(n) ? Math.round(byVram * 0.8) : byVram;
}

// Todas las gráficas mencionadas en un texto de requisitos ("GTX 970 / R9 290 or equivalent").
export function findAll(text) {
  const n = clean(text);
  const used = [];
  const found = [];
  for (const g of GPUS) {
    if (g.maxVram) continue; // en los requisitos "RTX 3060" es la versión normal, no la de menos memoria
    g.re.lastIndex = 0;
    for (const m of n.matchAll(g.re)) {
      const [a, b] = [m.index, m.index + m[0].length];
      if (used.some(([x, y]) => a < y && b > x)) continue; // ya cubierto por una variante más concreta
      used.push([a, b]);
      found.push({ name: m[0], score: isLaptop(n.slice(b, b + 12)) ? (g.l ?? Math.round(g.d * 0.8)) : g.d, vendor: /rtx|gtx|gt\s|mx\s|titan|8800|9800/.test(m[0]) ? "nvidia" : "other" });
    }
  }
  return found;
}

// Puntuación que pide un texto de requisitos: se toma la de NVIDIA si aparece (suelen ser las más
// representativas); si no, la media de las que se mencionan.
export function demandOf(text) {
  const all = findAll(text);
  if (all.length === 0) return null;
  const nv = all.filter((g) => g.vendor === "nvidia");
  const pick = nv.length ? nv : all;
  return { score: Math.round(pick.reduce((s, g) => s + g.score, 0) / pick.length), names: all.map((g) => g.name) };
}
