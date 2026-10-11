// Nombres legibles en español para los ajustes de vídeo de los juegos.
// 1) Diccionario de claves conocidas (juegos con perfil y motores comunes), con una línea de qué hace cada una.
// 2) Para lo que no está en el diccionario, traducción palabra a palabra como respaldo.
// La clave original se sigue enseñando debajo, por si se quiere buscar en internet.

const PREFIXES = /^(setting\.|graphics\.|sg\.|r_citadel_|citadel_|r_|cl_|mat_|snd_|m_|fx_|gfx_|game\.|video\.|display\.|user\.|options?\.)/i;

function strip(raw: string) {
  let s = raw.replace(/^.*::/, "");
  for (let i = 0; i < 3; i++) s = s.replace(PREFIXES, "");
  return s.replace(/^b(?=[A-Z])/, "");
}

// Clave normalizada: sin sección, sin prefijos técnicos, en minúsculas y sin separadores.
export function normKey(raw: string) {
  return strip(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// tech = valor interno o personal que no tiene sentido tocar (se oculta).
type Info = { name: string; desc?: string; tech?: boolean };
const K = (name: string, desc?: string): Info => ({ name, desc });
const TECH: Info = { name: "", tech: true };
const VSYNC = "Evita cortes en la imagen pero añade retraso; mejor desactivada en juegos competitivos.";
const AO = "Sombreado en esquinas y rincones; cuesta bastante y se nota poco en movimiento.";
const BLUR = "Emborrona la imagen al moverte; casi todo el mundo lo quita.";
const FPSCAP = "Igualarlo a los Hz de tu pantalla da una imagen más estable.";
const SCREEN = "Pantalla completa, ventana o ventana sin bordes.";

const KNOWN: Record<string, Info> = {
  // Resolución y pantalla
  resolution: K("Resolución"), defaultres: K("Resolución (ancho)"), defaultresheight: K("Resolución (alto)"),
  width: K("Resolución (ancho)"), height: K("Resolución (alto)"), displaywidth: K("Resolución (ancho)"), displayheight: K("Resolución (alto)"),
  fullscreensizex: K("Resolución (ancho)"), fullscreensizey: K("Resolución (alto)"),
  fullscreen: K("Pantalla completa", "Activado: el juego ocupa toda la pantalla y suele tener menos retraso."),
  nowindowborder: K("Ventana sin bordes", "Ventana a pantalla completa: cambiar a otras ventanas es más rápido."),
  windowborderless: K("Ventana sin bordes"), windowmaximized: K("Ventana maximizada"),
  windowmode: K("Modo de pantalla", SCREEN), fullscreenmode: K("Modo de pantalla", SCREEN),
  monitor: K("Monitor", "En qué pantalla se abre el juego."), display: K("Monitor"), displayscreen: K("Monitor"),
  aspect: K("Relación de aspecto"),
  refreshrate: K("Frecuencia de la pantalla (Hz)", "Pon la de tu monitor."),
  refreshratenumerator: K("Frecuencia de la pantalla (Hz)", "0 = la que use Windows."),
  refreshratedenominator: K("Frecuencia de la pantalla (divisor)", "0 = la que use Windows."),
  highdpi: K("Escalado para pantallas de alta densidad (DPI)"),
  fullscreenminonfocusloss: K("Minimizar al cambiar de ventana", "En pantalla completa, se minimiza al hacer Alt+Tab."),
  coopfullscreen: K("Pantalla completa compartida"), usersetresolution: K("Resolución elegida a mano"),
  gamma: K("Brillo (gamma)"), gammafloat: K("Brillo (gamma)"), fullscreengamma: K("Brillo en pantalla completa (gamma)"),
  brightness: K("Brillo"), contrast: K("Contraste"), hdr: K("HDR", "Más rango de luz y color; solo con monitor HDR."),
  support4k: K("Permitir resolución 4K"), support8k: K("Permitir resolución 8K"),
  // FPS, sincronización y retraso
  vsync: K("Sincronización vertical (V-Sync)", VSYNC), vsyncmode: K("Sincronización vertical (V-Sync)", VSYNC),
  waitforverticalsync: K("Sincronización vertical (V-Sync)", VSYNC), usevsync: K("Sincronización vertical (V-Sync)", VSYNC),
  maxfps: K("Límite de FPS", FPSCAP), maxframerate: K("Límite de FPS", FPSCAP), framerate: K("Límite de FPS", FPSCAP),
  frameratecap: K("Límite de FPS", "-1 = sin límite."), framecaptype: K("Límite de FPS", FPSCAP),
  frameskipmode: K("Saltar fotogramas", "Qué hace el juego cuando no llega a los FPS (Terraria)."),
  backbuffercount: K("Búferes de imagen", "1 = menos retraso; más = imagen más fluida pero responde más tarde."),
  lowlatency: K("NVIDIA Reflex (baja latencia)", "Reduce el retraso entre el ratón y la pantalla."),
  disabledwm: K("Desactivar composición de Windows", "Puede reducir el retraso en pantalla completa."),
  throttlewheninactive: K("Bajar FPS en segundo plano", "Gasta menos cuando el juego no está en primer plano."),
  // Escalado
  upscaling: K("Reescalado (FSR/DLSS)", "Dibuja a menos resolución y la reconstruye: más FPS con poca pérdida."),
  upscalemethod: K("Método de reescalado", "DLSS, FSR, XeSS o ninguno."),
  upscalequality: K("Calidad del reescalado", "Calidad = más nítido; Rendimiento = más FPS."),
  dlsssettingsmode: K("Modo de DLSS", "Calidad = más nítido; Rendimiento = más FPS."), dlsspreset: K("Versión del modelo DLSS"),
  fsrrcassharpness: K("Nitidez de FSR 1"), fsr2sharpness: K("Nitidez de FSR 2"),
  viewportscale: K("Escala de renderizado", "Porcentaje de la resolución con el que se dibuja (1 = 100 %)."),
  dvsenable: K("Resolución adaptativa", "Baja la resolución sola para mantener los FPS; la imagen se ve más borrosa."),
  dvsgpuframetimemin: K("Resolución adaptativa: tiempo mínimo por fotograma", "En microsegundos. Por debajo, sube la resolución."),
  dvsgpuframetimemax: K("Resolución adaptativa: tiempo máximo por fotograma", "En microsegundos. Por encima, baja la resolución."),
  // Texturas
  texturequality: K("Calidad de texturas", "Apenas cuesta FPS mientras quepa en la memoria de tu gráfica."),
  texturedetail: K("Calidad de texturas", "Apenas cuesta FPS mientras quepa en la memoria de tu gráfica."),
  picmip: K("Calidad de texturas", "0 = máxima; números más altos = texturas más bajas."),
  texturestreammipbias: K("Nitidez de texturas", "0 = normal; más alto = texturas más borrosas y menos memoria."),
  texturemiplimite: K("Límite de detalle de texturas"),
  streammemory: K("Memoria para texturas", "Memoria de vídeo reservada para texturas (0 = sin límite)."),
  dynamicstreamingbudget: K("Memoria para texturas automática", "Ajusta sola la memoria para texturas según tu gráfica."),
  forceaniso: K("Filtro anisotrópico", "Nitidez de las texturas vistas en ángulo (suelo, paredes). Cuesta muy poco."),
  anisotropicfiltering: K("Filtro anisotrópico", "Nitidez de las texturas vistas en ángulo. Cuesta muy poco."),
  miplinear: K("Filtrado trilineal", "Suaviza el paso entre niveles de detalle de las texturas."),
  trilinearfiltering: K("Filtrado trilineal", "Suaviza el paso entre niveles de detalle de las texturas."),
  // Antialiasing
  antialiasing: K("Antialiasing", "Suaviza los bordes dentados."), antialiasmode: K("Antialiasing", "Suaviza los bordes dentados."),
  antialias: K("Antialiasing", "Suaviza los bordes dentados."), altantialias: K("Antialiasing ligero (FXAA)"),
  enablefxaa: K("Antialiasing (FXAA)", "Suaviza bordes casi sin coste, pero emborrona un poco."),
  // Sombras
  shadowquality: K("Calidad de sombras", "Suele ser de lo que más FPS cuesta."), shadowsquality: K("Calidad de sombras", "Suele ser de lo que más FPS cuesta."),
  shadowenable: K("Sombras de las luces", "Sombras de focos y lámparas del escenario."),
  shadowmaxdynamic: K("Luces con sombra a la vez", "Cuántas luces proyectan sombra al mismo tiempo."),
  shadowdepthdimenmin: K("Resolución mínima de sombras"), shadowdepthupresfactormax: K("Detalle de sombras cercanas"),
  newshadowsettings: K("Sistema de sombras nuevo"), csmenabled: K("Sombras del sol"),
  csmcoverage: K("Distancia de sombras del sol", "Hasta dónde se dibujan; alto pesa en mapas abiertos."),
  csmcascaderes: K("Detalle de sombras del sol", "Más alto = sombras más nítidas y más caras."),
  shadowmapsize: K("Calidad de sombras", "Resolución de las sombras del sol."),
  spotshadowmapsize: K("Calidad de sombras de linternas y focos"),
  enablecontactshadows: K("Sombras de contacto", "Pequeñas sombras donde se tocan los objetos."),
  // Iluminación y efectos
  ssaoquality: K("Oclusión ambiental", AO), ssaomode: K("Oclusión ambiental", AO), ambientocclusion: K("Oclusión ambiental", AO),
  volumetriclighting: K("Iluminación volumétrica", "Rayos de luz en el aire; cuesta FPS y a veces dificulta ver."),
  enablevolumetriclighting: K("Iluminación volumétrica", "Rayos de luz en el aire; cuesta FPS y a veces dificulta ver."),
  volumetricfog: K("Niebla volumétrica", "Niebla con volumen; cuesta FPS."), fogquality: K("Calidad de la niebla"),
  showgodray: K("Rayos de luz"), deferredlightinglight: K("Calidad de la iluminación"),
  arealights: K("Luces de área", "Iluminación más realista con coste apreciable."),
  effectsbloom: K("Brillo de efectos (bloom)"), postbloom: K("Resplandor (bloom)", "Halo alrededor de las luces."),
  effectsquality: K("Calidad de efectos", "Habilidades, explosiones, humo…"),
  particlesysquality: K("Calidad de partículas", "Baja los FPS cuando hay mucha acción en pantalla."),
  particlefallbackbase: K("Cantidad de partículas", "Cuántas partículas se dibujan; menos = más FPS en peleas."),
  particlefallbackmultiplier: K("Multiplicador de partículas", "Escala la cantidad de partículas."),
  particlecpulevel: K("Partículas calculadas por el procesador"),
  particledepthfeathering: K("Suavizado de partículas", "Mejora cómo se ve el humo; cuesta algo en gráficas modestas."),
  nvidiaeffects: K("Efectos NVIDIA", "Tres valores: oclusión HBAO+, desenfoque de profundidad y sombras PCSS (0 = apagado, 1 = encendido)."),
  shaderquality: K("Calidad de sombreado", "Detalle de materiales y superficies."), screenquality: K("Calidad de postprocesado"),
  usestormeffect: K("Efecto de tormenta"), useheatdistortion: K("Distorsión por calor"),
  foregroundsunlighteffects: K("Rayos de sol en primer plano"), wavequality: K("Calidad del agua (olas)"),
  waterfalldrawlimit: K("Límite de cascadas dibujadas"), flashyeffectsworld: K("Destellos en el mundo"),
  flashyeffectsinterface: K("Destellos en la interfaz"), disableintensevisualeffects: K("Reducir efectos intensos"),
  lightsensitivitymode: K("Modo para fotosensibilidad", "Reduce destellos fuertes."),
  lightingmode: K("Modo de iluminación", "En Terraria: 0 = color, 1 = blanco, 2 = retro, 3 = psicodélico."),
  // Desenfoques y efectos de cámara
  motionblur: K("Desenfoque de movimiento", BLUR), motionblurenabled: K("Desenfoque de movimiento", BLUR),
  enablemotionblur: K("Desenfoque de movimiento", BLUR),
  depthoffield: K("Profundidad de campo", "Desenfoca el fondo; no ayuda a jugar."), enablegrain: K("Grano de película"),
  vignetteenabled: K("Viñeta (bordes oscuros)"), vignetteenabledcustomoption: K("Viñeta (opción personalizada)"),
  reducedmotion: K("Reducir movimiento"),
  // Detalle y distancia
  visrange: K("Distancia de visión", "En este juego carga sobre todo el procesador."),
  tinyobjectsrange: K("Distancia de objetos pequeños"),
  lodswitchscale: K("Detalle de modelos a distancia", "A qué distancia los modelos pasan a versiones más simples."),
  geometrydetail: K("Detalle de geometría"), mapdetaillevel: K("Detalle del mapa"),
  fadedistscale: K("Distancia de desvanecido", "A qué distancia desaparecen los objetos pequeños."),
  grassquality: K("Calidad de la hierba"), environmentquality: K("Calidad del entorno"), characterquality: K("Calidad de personajes"),
  decals: K("Marcas de impacto", "Cuántos impactos de bala quedan en las paredes."),
  createmodeldecals: K("Marcas en personajes", "Impactos sobre los modelos."), decalbuffer: K("Marcas de impacto"),
  backgroundenabled: K("Fondo"), backgroundparallax: K("Profundidad del fondo (parallax)"),
  hideeyecandy: K("Ocultar decoración del mapa", "Quita adornos del escenario que no aportan al juego."),
  // Física
  ragdollmaxcount: K("Cuerpos con física", "Cuántos cuerpos caen con física a la vez; carga el procesador."),
  ragdollselfcollision: K("Colisión de cuerpos con física"),
  giballow: K("Desmembramiento", "Muestra restos al eliminar enemigos."), gorevisualsallowed: K("Sangre y restos"),
  // Ajustes generales de calidad
  graphicsquality: K("Calidad gráfica", "En Terraria: 0 = automática, 1 = alta, 2 = media, 3 = baja."),
  savedqualitylevel: K("Calidad gráfica (1-10)", "La barra de calidad del menú de Roblox."),
  graphicsqualitylevel: K("Calidad gráfica interna"), graphicsoptimizationmode: K("Modo de optimización de gráficos"),
  maxqualityenabled: K("Calidad máxima"), qualityresetlevel: TECH,
  autoperformancesettings: K("Ajustes de rendimiento automáticos"), autodetectgraphicssettings: K("Detectar ajustes automáticamente"),
  enablehudanimations: K("Animaciones de la interfaz"), useadvanced: K("Usar ajustes avanzados"),
  dashboardrenderquality: K("Calidad del menú principal"),
  // RE6
  sli: K("SLI (dos gráficas NVIDIA)"), stereo: K("3D estereoscópico"),
  renderingthread: K("Hilo de renderizado aparte", "Reparte el trabajo en más núcleos del procesador."),
  jobthread: K("Hilos del procesador"),
  // Detectado por el propio juego (se puede ver, mejor no tocar)
  cpulevel: K("Nivel del procesador (detectado por el juego)"), memlevel: K("Nivel de memoria RAM (detectado por el juego)"),
  gpumemlevel: K("Nivel de memoria de vídeo (detectado por el juego)"), gpulevel: K("Nivel de gráfica (detectado por el juego)"),
  // Valores internos o personales: se ocultan
  version: TECH, vendorid: TECH, deviceid: TECH, knowndevice: TECH, configversion: TECH, cfgversion: TECH, recommendedheight: TECH,
  lastdisplaywidth: TECH, lastdisplayheight: TECH, "3dtvsettings": TECH, lastlaunchedversion: TECH, email: TECH, clientemail: TECH,
  mainx: TECH, mainy: TECH, gaid: TECH, videoquality: TECH, videoframerate: TECH, scalevideo: TECH, rccprofilerrecordframerate: TECH,
  rccprofilerrecordtimeframe: TECH, statsvisible: TECH, performancestatsvisible: TECH, filterlimit: TECH, filterprioritythreshold: TECH,
  enablelightfx: TECH,
};

// Lo que no es vídeo (sonido, controles, interfaz, cuentas...).
const NOT_VIDEO = /volume|sound|audio|music|voice|mute|mouse|cursor|key|bind|chat|hud|tooltip|camera|minimap|scoreboard|spell|notification|tft|summoner|emote|replay|language|offset|shop|controller|gamepad|touch|^vr|haptic|player|profiler|gui|^ui|nameplate|mod|razer|corsair|logitech|steelseries|rgb|color|password|email|tutorial|zoom|aim|smart|chest|craft|world|invasion|item|boss|news|github|imgur|update|team/i;
const VIDEO = /resolution|fullscreen|window|vsync|fps|frame|refresh|gamma|bright|contrast|hdr|quality|shadow|texture|aniso|alias|bloom|blur|lod|detail|effect|particle|light|fog|reflect|upscal|dlss|fsr|sharp|render|viewport|graphic|grain|vignette|occlusion|ssao|decal|grass|foliage|dof|latency|mip|godray/i;

/** ¿Es un ajuste de vídeo que tenga sentido enseñar? (los que el programa reconoce como gráficos siempre cuentan) */
export function isVideoSetting(raw: string, category?: string | null) {
  const known = KNOWN[normKey(raw)];
  if (known) return !known.tech;
  if (category) return true;
  const plain = strip(raw);
  return VIDEO.test(plain) && !NOT_VIDEO.test(plain);
}

/** Qué hace el ajuste, si se conoce. */
export function describe(raw: string): string | null {
  return KNOWN[normKey(raw)]?.desc ?? null;
}

// ---------- Respaldo: traducción palabra a palabra ----------

const PHRASES: [RegExp, string][] = [
  [/motion blur/g, "desenfoque de movimiento"], [/ambient occlusion/g, "oclusión ambiental"], [/anti ?alias(ing)?/g, "antialiasing"],
  [/field of view/g, "campo de visión"], [/depth of field/g, "profundidad de campo"], [/frame ?rate/g, "FPS"],
  [/v ?sync/g, "sincronización vertical"], [/full ?screen/g, "pantalla completa"], [/view distance/g, "distancia de visión"],
  [/draw distance/g, "distancia de dibujado"], [/render scale/g, "escala de renderizado"], [/ray ?tracing/g, "trazado de rayos"],
  [/global illumination/g, "iluminación global"], [/god ?rays?/g, "rayos de luz"], [/post ?process(ing)?/g, "postprocesado"],
  [/low latency/g, "baja latencia"], [/back ?buffer/g, "búfer de imagen"], [/window border/g, "bordes de ventana"],
];

const WORDS: Record<string, string> = {
  shadow: "sombras", shadows: "sombras", quality: "calidad", texture: "texturas", textures: "texturas", resolution: "resolución",
  width: "ancho", height: "alto", window: "ventana", windowed: "en ventana", borderless: "sin bordes", fps: "FPS", max: "máximo",
  min: "mínimo", limit: "límite", cap: "límite", enable: "activar", enabled: "activado", disable: "desactivar", disabled: "desactivado",
  use: "usar", show: "mostrar", hide: "ocultar", effects: "efectos", effect: "efectos", particle: "partículas", particles: "partículas",
  foliage: "vegetación", grass: "hierba", reflections: "reflejos", reflection: "reflejos", bloom: "resplandor", lighting: "iluminación",
  light: "luz", lights: "luces", volumetric: "volumétrica", fog: "niebla", distance: "distancia", view: "visión", detail: "detalle",
  model: "modelos", models: "modelos", geometry: "geometría", lod: "nivel de detalle", filtering: "filtrado", filter: "filtro",
  sharpness: "nitidez", scale: "escala", mode: "modo", level: "nivel", size: "tamaño", count: "cantidad", type: "tipo",
  preset: "preajuste", graphics: "gráficos", brightness: "brillo", contrast: "contraste", gamma: "brillo (gamma)", display: "pantalla",
  refresh: "frecuencia", rate: "frecuencia", latency: "latencia", blur: "desenfoque", grain: "grano", vignette: "viñeta",
  water: "agua", terrain: "terreno", character: "personajes", environment: "entorno", sky: "cielo", clouds: "nubes", sun: "sol",
  dynamic: "dinámicas", render: "renderizado", rendering: "renderizado", buffer: "búfer", memory: "memoria", map: "mapa",
  ssao: "oclusión ambiental", ao: "oclusión ambiental", dof: "profundidad de campo", aa: "antialiasing", fxaa: "FXAA", taa: "TAA",
  upscaling: "reescalado", upscale: "reescalado", settings: "ajustes", setting: "ajuste", background: "fondo", screen: "pantalla",
  default: "predeterminado", budget: "presupuesto", streaming: "carga de texturas", maximized: "maximizada", method: "método",
};
const HEADS = new Set(["calidad", "nivel", "detalle", "modo", "tamaño", "escala", "límite", "cantidad", "tipo", "resolución", "distancia", "método"]);

function translate(raw: string) {
  const s0 = strip(raw)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_.\-]+/g, " ").toLowerCase().trim();
  let s = s0;
  for (const [re, es] of PHRASES) s = s.replace(re, es);
  const words = s.split(/\s+/).filter(Boolean).map((w) => WORDS[w] ?? w);
  if (words.length > 1 && words[words.length - 2] !== "de" && HEADS.has(words[words.length - 1])) words.unshift(`${words.pop()} de`);
  const out = words.join(" ").trim();
  return out ? out[0].toUpperCase() + out.slice(1) : raw;
}

/** Nombre legible del ajuste. */
export function friendlyName(raw: string): string {
  return KNOWN[normKey(raw)]?.name || translate(raw);
}
