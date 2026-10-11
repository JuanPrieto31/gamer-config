import "./style.css";
import { icon } from "./icons";
import { friendlyName, describe, isVideoSetting } from "./names";
import { api, errorText } from "./api";
import type { ActionResult, ApplyResult, DriverInfo, GameFile, Finding, Game, GameDetail, Goal, HistoryEntry, Part, Specs, StartupApp, Usage, WinItem, WinState } from "./api";

type View = "panel" | "sistema" | "juegos";

const state = {
  view: "panel" as View,
  specs: null as Specs | null,
  usage: null as Usage | null,
  findings: null as Finding[] | null,
  scanning: false,
  working: null as string | null, // id de la acción en curso
  startup: null as StartupApp[] | null,
  win: null as WinState | null,
  drivers: null as DriverInfo | null,
  winTab: (safeGet("winTab") ?? "opts") as "opts" | "drivers" | "startup" | "history",
  gameTab: "rec" as GameTab,
  gameQuery: "",
  gameFilter: "todos" as "todos" | Game["status"],
  history: null as HistoryEntry[] | null,
  games: null as Game[] | null,
  game: null as Game | null,
  detail: null as GameDetail | null,
  goal: (safeGet("goal") as Goal | null) ?? "equilibrado",
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* ---------- Permiso para hacer cambios ---------- */

const permitted = () => safeGet("permiso") === "1";

/* ---------- Estructura ---------- */

const NAV: [View, string, string][] = [
  ["panel", "Resumen", icon.gauge],
  ["sistema", "Windows", icon.cpu],
  ["juegos", "Juegos", icon.game],
];

$("#app").innerHTML = `
  <aside class="side">
    <div class="brand"><span class="mark">${icon.logo}</span>Gamer Config</div>
    <nav>
      ${NAV.map(([v, label, ic]) => `<button class="nav" data-nav="${v}">${ic}<span>${label}</span></button>`).join("")}
    </nav>
  </aside>
  <main id="view" tabindex="-1"></main>
`;

function go(v: View) {
  state.view = v;
  if (v === "juegos") state.game = null;
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.nav === v)));
  render();
  $("#view").focus({ preventScroll: true });
  if (v === "sistema") loadWindows();
}

function render() {
  const el = $("#view");
  el.innerHTML = VIEWS[state.view]();
  el.scrollTop = 0;
  el.classList.remove("enter");
  void el.offsetWidth;
  el.classList.add("enter");
}

// Re-render sin animación de entrada (cambios de estado dentro de la misma vista).
function rerender() {
  $("#view").innerHTML = VIEWS[state.view]();
}

/* ---------- Vistas ---------- */

const VIEWS: Record<View, () => string> = {
  panel() {
    const s = state.specs;
    const u = state.usage;
    return `
      <header class="head">
        <div>
          <h1>Resumen</h1>
          <p class="sub">Estado de tu PC y lo que se puede mejorar.</p>
        </div>
        <button class="btn primary" data-act="scan" ${state.scanning ? "disabled" : ""}>
          ${icon.refresh}<span>${state.scanning ? "Analizando…" : state.findings ? "Volver a analizar" : "Analizar el PC"}</span>
        </button>
      </header>

      <section class="meters" aria-label="Uso en tiempo real">
        ${meter("cpu", "CPU", u?.cpu, icon.cpu)}
        ${meter("ram", "RAM", u?.ram, icon.memory)}
        ${meter("gpu", "GPU", u?.gpu, icon.gpu)}
        ${meter("disk", "Disco C:", u?.disk, icon.drive)}
      </section>

      <div class="split">
        <section class="block findings">
          <h2>Recomendaciones</h2>
          ${findingsList()}
        </section>
        <section class="block specs">
          <h2>Tu equipo</h2>
          ${s ? `<dl>
            ${spec("Procesador", s.cpu)}
            ${spec("Gráfica", s.gpu)}
            ${spec("Memoria", s.ram)}
            ${spec("Almacenamiento", s.disk)}
            ${spec("Sistema", s.os)}
            ${spec("Driver GPU", s.driver)}
          </dl>` : `<div class="sk-list">${skel(6)}</div>`}
        </section>
      </div>
    `;
  },

  sistema() {
    const w = state.win;
    const apps = state.startup;
    const can = permitted();
    return `
      <header class="head">
        <div>
          <h1>Windows</h1>
          <p class="sub">Ajustes del sistema para jugar mejor. Nada se cambia sin tu permiso.</p>
        </div>
      </header>

      ${can ? "" : `
        <section class="perm">
          <span class="perm-ic">${icon.shield}</span>
          <div class="row-main">
            <h2>Gamer Config necesita tu permiso para hacer cambios</h2>
            <p class="muted">Cada cambio te pedirá confirmación antes de hacerse. Los que tocan la configuración del sistema también mostrarán el aviso de administrador de Windows. Todo queda en el historial y casi todo se puede deshacer.</p>
          </div>
          <button class="btn primary" data-act="grant">${icon.check}<span>Dar permiso</span></button>
        </section>`}

      ${tabBar("win", [
        ["opts", "Optimizaciones", w ? `${w.items.filter((i) => i.done).length}/${w.items.length}` : ""],
        ["drivers", "Drivers y BIOS", state.drivers ? (state.drivers.items.some((i) => i.outdated) ? `${state.drivers.items.filter((i) => i.outdated).length} antiguos` : "al día") : ""],
        ["startup", "Inicio de Windows", apps ? `${apps.filter((a) => a.enabled).length}/${apps.length}` : ""],
        ["history", "Historial", state.history ? String(state.history.length) : ""],
      ], state.winTab)}

      <section class="block tab-panel">
        ${state.winTab === "drivers" ? `
          <div class="table-head">
            <h2>Drivers y BIOS</h2>
            ${state.drivers ? `<span class="muted">${esc(state.drivers.pc)}</span>` : ""}
          </div>
          ${driversList()}`
        : state.winTab === "startup" ? `
          <h2>Programas que se inician con Windows</h2>
          ${!apps ? `<div class="sk-list">${skel(5)}</div>`
            : apps.length === 0 ? `<p class="muted">Ningún programa se inicia con Windows.</p>`
            : `<p class="count">${apps.filter((a) => a.enabled).length} de ${apps.length} activados. Desactivar los que no uses hace que el PC arranque antes y deja más RAM libre.</p>
              <ul class="rows">
              ${apps.map((a, i) => `
                <li class="row">
                  <div class="row-main"><strong>${esc(a.name)}</strong><span class="muted">${esc(a.publisher || "Editor desconocido")}</span></div>
                  ${a.scope === "machine" ? `<span class="tag" title="Cambiarlo pide permiso de administrador">${icon.shield} Admin</span>` : ""}
                  <label class="switch" aria-label="Iniciar ${esc(a.name)} con Windows">
                    <input type="checkbox" role="switch" data-startup="${i}" ${a.enabled ? "checked" : ""} ${state.working ? "disabled" : ""} />
                    <span></span>
                  </label>
                </li>`).join("")}
            </ul>`}`
        : state.winTab === "history" ? `
          <h2>Historial de cambios</h2>
          ${historyList()}
          ${can ? `<button class="link" data-act="revoke">Retirar permiso</button>` : ""}`
        : w ? optsBlock(w) : `<div class="sk-list">${skel(5)}</div>`}
      </section>
    `;
  },

  juegos() {
    if (state.game) return gameDetail(state.game);
    const games = state.games;
    return `
      <header class="head">
        <div>
          <h1>Juegos</h1>
          <p class="sub">${games ? `${games.length} juegos instalados (Steam, Epic, Riot, Xbox, EA, Ubisoft, Battle.net, GOG, Rockstar y Roblox). Los nuevos aparecen solos.` : "Buscando juegos instalados…"}</p>
        </div>
      </header>
      ${games?.length === 0 ? `<div class="empty"><span class="empty-ic">${icon.game}</span><p>No se ha encontrado ningún juego de Steam, Epic o Riot en este PC.</p></div>` : ""}
      ${games?.length ? centralBlock(games) : ""}
      ${games?.length ? gamesToolbar(games) : ""}
      <div class="games">
        ${games
          ? visibleGames(games).map((g) => `
            <button class="game" data-game="${g.id}">
              ${cover(g)}
              <div class="game-meta">
                <strong>${esc(g.name)}</strong>
                <span class="muted">${gameMeta(g)}</span>
              </div>
              <span class="tag status-${g.status.replace(" ", "-")}">${g.status}</span>
            </button>`).join("")
          : Array.from({ length: 6 }, () => `<div class="game sk"><div class="cover"></div><div class="game-meta"><i></i><i></i></div></div>`).join("")}
      </div>
    `;
  },
};

/* ---------- Piezas ---------- */

const gb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toLocaleString("es", { maximumFractionDigits: 1 })} GB` : `${Math.round(b / 1024 ** 2)} MB`);

const meterVal = (v: number | null | undefined) => (v == null ? "–" : `${v}<small>%</small>`);
const meterLevel = (v: number | null | undefined) => (v == null ? "" : v >= 85 ? "hot" : v >= 70 ? "warm" : "");

function meter(k: keyof Usage, label: string, value: number | null | undefined, ic: string) {
  return `
    <div class="meter ${meterLevel(value)}" data-k="${k}">
      <div class="meter-top">${ic}<span>${label}</span></div>
      <div class="meter-val">${meterVal(value)}</div>
      <div class="bar"><i style="transform:scaleX(${(value ?? 0) / 100})"></i></div>
    </div>`;
}

const cover = (g: Game, big = false) =>
  `<div class="cover${big ? " big" : ""}">${g.image ? `<img src="${g.image}" alt="" loading="lazy" />` : ""}<span class="fallback">${esc(g.name[0])}</span></div>`;

const gameMeta = (g: Game) => (g.sizeGb == null ? g.store : `${g.store} · ${g.sizeGb.toLocaleString("es")} GB`);
const spec = (k: string, v: string) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
const skel = (n: number) => Array.from({ length: n }, () => `<div class="sk-row"><i></i><i></i></div>`).join("");

function findingsList() {
  if (state.scanning) return `<div class="sk-list">${skel(4)}</div>`;
  const f = state.findings;
  if (!f) {
    return `<div class="empty">
      <span class="empty-ic">${icon.shield}</span>
      <p>Aún no has analizado tu PC. El análisis solo lee información y no cambia nada.</p>
      <button class="btn" data-act="scan">${icon.arrow}<span>Empezar análisis</span></button>
    </div>`;
  }
  if (f.length === 0) {
    return `<div class="empty"><span class="empty-ic">${icon.check}</span><p>No hay nada que mejorar. Tu PC está a punto.</p></div>`;
  }
  return `
    <p class="count">${f.length} ${f.length === 1 ? "recomendación" : "recomendaciones"}</p>
    <ul class="rows">
      ${f.map((x) => `
        <li class="finding">
          <span class="sev sev-${x.severity}" title="Prioridad ${x.severity}">${x.severity === "alta" ? icon.warning : icon.info}</span>
          <div class="row-main">
            <strong>${esc(x.title)}</strong>
            <p class="muted">${esc(x.detail)}</p>
          </div>
          ${x.action
            ? `<button class="btn sm" data-fix="${x.id}" ${state.working ? "disabled" : ""}>${state.working === x.id ? "Aplicando…" : x.action}</button>`
            : `<span class="tag">Manual</span>`}
        </li>`).join("")}
    </ul>`;
}

const GROUPS: [WinItem["group"], string, string][] = [
  ["juego", "Para jugar", icon.game],
  ["ligero", "Aligerar Windows", icon.cpu],
  ["espacio", "Disco y espacio", icon.drive],
  ["seguridad", "Seguridad", icon.restore],
];

function optsBlock(w: WinState) {
  const groups = GROUPS.map(([g, label, ic]) => {
    const items = w.items.filter((i) => i.group === g);
    return items.length ? `<h3 class="opt-group">${ic}<span>${label}</span></h3><div class="opts">${items.map(opt).join("")}</div>` : "";
  }).join("");
  return `
    <div class="opts-head">
      <p class="count">${w.low ? `A tu equipo le viene bien aligerar Windows (${esc(w.lowReasons.join(", "))}), así que esas también se recomiendan.` : "Las marcadas como «Opcional» no le hacen falta a tu equipo ahora mismo, pero puedes usarlas igual."} «Listo» se lee directamente de Windows.</p>
      <button class="link inline" data-act="recheck" ${state.working ? "disabled" : ""}>${icon.refresh} Volver a comprobar en Windows</button>
    </div>
    ${groups}`;
}

function opt(i: WinItem) {
  const busy = state.working === i.id;
  const tags = [
    i.manual ? `<span class="tag" title="Windows no deja que otro programa lo cambie: se hace en Configuración">Manual</span>` : "",
    !i.recommended && !i.done ? `<span class="tag optional" title="Tu PC no lo necesita; puedes aplicarlo si quieres">Opcional</span>` : "",
    i.admin ? `<span class="tag" title="Pide permiso de administrador">${icon.shield} Admin</span>` : "",
    i.relogin ? `<span class="tag" title="Se aplica del todo al cerrar sesión">Cerrar sesión</span>` : "",
    i.reboot ? `<span class="tag" title="Se aplica al reiniciar">Reiniciar</span>` : "",
  ].join("");
  return `
    <div class="opt">
      <div class="row-main">
        <strong>${esc(i.title)}${tags}</strong>
        <span class="muted">${esc(i.body)}</span>
      </div>
      ${i.done ? `<span class="tag ok">${icon.check} Listo</span>`
        : `<button class="btn sm" data-win="${i.id}" ${state.working ? "disabled" : ""}>${busy ? "Trabajando…" : esc(i.cta)}</button>`}
    </div>`;
}

function historyList() {
  const h = state.history;
  if (!h) return `<div class="sk-list">${skel(3)}</div>`;
  if (h.length === 0) return `<p class="muted">Aún no has hecho ningún cambio.</p>`;
  return `<ul class="rows history">
    ${h.slice(0, 20).map((e) => `
      <li class="row">
        <div class="row-main">
          <strong class="${e.undone ? "undone" : ""}">${esc(e.label)}</strong>
          <span class="muted">${new Date(e.at).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}${e.undone ? " · deshecho" : ""}</span>
        </div>
        ${e.undo && !e.undone ? `<button class="btn sm" data-undo="${e.id}" ${state.working ? "disabled" : ""}>Deshacer</button>` : ""}
      </li>`).join("")}
  </ul>`;
}

type GameTab = "rec" | "all" | "calc";

function gameDetail(g: Game) {
  const d = state.detail;
  const editable = d ? d.canApply && d.configFound : false;
  const changes = editable ? d!.settings.filter((s) => s.change).length : 0;
  const KIND = { perfil: "Perfil del juego", auto: "Automático (Unreal Engine)", detectado: "Ajustes leídos de su archivo", guia: "Guía para el menú" };
  const totalSettings = d?.files.reduce((n, f) => n + f.entries.filter((e) => isVideoSetting(e.name, e.category)).length, 0) ?? 0;
  const tabs: [GameTab, string, string][] = [
    ["rec", "Recomendación", d ? (editable ? `${changes} ${changes === 1 ? "cambio" : "cambios"}` : "guía") : ""],
    ["all", "Ajustes de vídeo", d ? String(totalSettings) : ""],
    ["calc", "Cómo se calcula", d ? String(d.factors.length + 2) : ""],
  ];

  let panel: string;
  if (!d) panel = `<div class="sk-list">${skel(5)}</div>`;
  else if (state.gameTab === "all") panel = d.files.length ? allSettings(d.files) : `<div class="empty"><span class="empty-ic">${icon.info}</span><p>Todavía no se ha encontrado ningún archivo de configuración de ${esc(g.name)}. Abre el juego una vez, ciérralo y vuelve aquí.</p></div>`;
  else if (state.gameTab === "calc") panel = calcPanel(d);
  else panel = recPanel(g, d, editable);

  return `
    <button class="back" data-act="back">${icon.arrow}<span>Juegos</span></button>
    <header class="game-head">
      ${cover(g, true)}
      <div class="game-head-main">
        <h1>${esc(g.name)}</h1>
        <p class="sub">${gameMeta(g)}${d ? ` · ${KIND[d.kind]}` : ""}</p>
        ${d ? `<p class="fps-line"><strong>~${d.estFinal} FPS</strong> <span class="muted">estimados con estos ajustes · objetivo ${d.target} · limita ${d.bottleneck === "cpu" ? "el procesador" : "la gráfica"}</span></p>` : ""}
        <div class="game-actions">
          <fieldset class="seg" aria-label="Objetivo">
            ${GOALS.map(([v, l]) => `<label><input type="radio" name="goal" value="${v}" ${state.goal === v ? "checked" : ""} /><span>${l}</span></label>`).join("")}
          </fieldset>
          ${editable ? `
            <button class="btn primary" data-act="apply-game" ${changes === 0 || state.working ? "disabled" : ""}>
              ${icon.check}<span>${state.working === "game" ? "Aplicando…" : changes === 0 ? "Ya optimizado" : `Aplicar ${changes} ${changes === 1 ? "cambio" : "cambios"}`}</span>
            </button>` : d ? `<span class="tag">Solo guía: ponlo en el menú del juego</span>` : ""}
        </div>
      </div>
    </header>
    ${tabBar("game", tabs, state.gameTab)}
    <section class="block tab-panel">${panel}</section>
  `;
}

// Pestaña principal: el cálculo resumido, los avisos y la tabla de ajustes.
function recPanel(g: Game, d: GameDetail, editable: boolean) {
  const part = (title: string, p: Part, limits: boolean) => `
      <div class="${limits ? "limits" : ""}">
        <span class="muted">${title}${limits ? ` <span class="tag">Limita</span>` : ""}</span>
        <strong title="${esc(p.name)}">${esc(p.name.replace(/\(R\)|\(TM\)|®|™/g, "").replace(/^\d+th Gen /, ""))}</strong>
        <span class="muted">Potencia ${p.score} · ${p.demand ? `el juego pide ${p.demand.score}` : "sin requisitos publicados"}</span>
        <span class="muted">Daría ~${p.fps} FPS</span>
      </div>`;
  const alerts = d.factors.filter((f) => f.effect === "penalty" || f.effect === "warning");
  const guide = !editable;
  const rows = d.settings.map((s) => `
    <div class="settings-row ${guide ? "guide" : ""} ${!guide && !s.change ? "same" : ""}">
      <strong>${esc(s.name)}${s.key ? `<small class="key">${esc(s.key)}</small>` : ""}</strong>
      ${guide ? "" : `<span>${esc(s.current ?? "")}</span><span class="arrow">${s.change ? icon.arrow : ""}</span>`}
      <span class="rec">${guide || s.change ? esc(s.recommended) : "Sin cambios"}</span>
      <span class="muted">${esc(s.why)}</span>
    </div>`).join("");

  return `
    <div class="calc">
      ${part("Gráfica", d.gpu, d.bottleneck === "gpu")}
      ${part("Procesador", d.cpu, d.bottleneck === "cpu")}
      <div>
        <span class="muted">FPS estimados</span>
        <strong>~${d.estMax} al máximo → ~${d.estFinal}</strong>
        <span class="muted">Objetivo: ${d.target} FPS</span>
        <button class="link" data-tab="game:calc">Ver todo lo que se ha tenido en cuenta</button>
      </div>
    </div>
    ${alerts.map((f) => `<p class="notice">${icon.warning}<span><strong>${esc(f.label)}:</strong> ${esc(f.note)}</span></p>`).join("")}
    ${d.reached ? "" : `<p class="notice">${icon.warning}<span>${d.bottleneck === "cpu"
      ? `Tu procesador no llega a ${d.target} FPS en este juego aunque se bajen los ajustes que lo cargan. Cierra programas en segundo plano mientras juegas.`
      : `Ni bajando estos ajustes se llega a ${d.target} FPS. Prueba a activar DLSS o FSR en el juego, o a bajar la resolución.`}</span></p>`}
    ${d.reached && d.loweredNothing ? `<p class="notice">${icon.check}<span>Con todo al máximo tu PC ya llega a ~${d.estMax} FPS y el objetivo es ${d.target}: por eso no se baja nada. Si quieres más FPS, elige «Más FPS».</span></p>` : ""}
    ${d.canApply && !d.configFound ? `<p class="notice">${icon.info}<span>Abre ${esc(g.name)} una vez y ciérralo: así crea su archivo de configuración y Gamer Config podrá aplicar esto solo. Mientras, puedes ponerlo a mano en el menú.</span></p>` : ""}
    <div class="settings">
      <div class="settings-row th ${guide ? "guide" : ""}">
        <span>Ajuste</span>${guide ? "" : "<span>Ahora</span><span></span>"}<span>${guide ? "Ponlo en" : "Recomendado"}</span><span>Motivo</span>
      </div>
      ${rows}
    </div>
    ${editable ? `
      <div class="apply-info rec-foot">
        <p class="muted">${icon.restore} Se guarda una copia antes de cambiar nada.</p>
        ${d.hasBackup ? `<button class="link" data-act="restore-game">Restaurar configuración original</button>` : ""}
      </div>` : ""}`;
}

// Pestaña "Cómo se calcula": todos los factores, la nota del perfil, las fuentes y el informe.
function calcPanel(d: GameDetail) {
  return `
    ${d.note ? `<p class="notice">${icon.info}<span>${esc(d.note)}</span></p>` : ""}
    <ul class="factors-list">
      <li><span class="f-ok">${icon.check}</span><strong>Gráfica</strong><span>${esc(d.gpu.name)} · potencia ${d.gpu.score}</span><span class="muted">${d.gpu.demand ? `Pide: ${esc(shorten(d.gpu.demand.text))} (requisitos ${d.gpu.demand.kind}, ${d.gpu.demand.source})` : "El juego no publica requisitos: se asume exigencia media"}</span></li>
      <li><span class="f-ok">${icon.check}</span><strong>Procesador</strong><span>${esc(d.cpu.name)} · potencia ${d.cpu.score}</span><span class="muted">${d.cpu.demand ? `Pide: ${esc(shorten(d.cpu.demand.text))} (requisitos ${d.cpu.demand.kind}, ${d.cpu.demand.source})` : "El juego no publica requisitos: se asume exigencia media"}</span></li>
      ${d.factors.map((f) => `
        <li><span class="f-${f.effect}">${f.effect === "ok" ? icon.check : f.effect === "info" ? icon.info : icon.warning}</span><strong>${esc(f.label)}</strong><span>${esc(f.value)}</span><span class="muted">${esc(f.note)}</span></li>`).join("")}
    </ul>
    <p class="muted small calc-note">Las cifras son estimaciones: se calculan con la potencia de tu gráfica y tu procesador frente a lo que pide el juego, y con el coste típico de cada ajuste según las fuentes.</p>
    ${d.sources.length ? `<p class="sources">Fuentes: ${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(", ")}</p>` : ""}
    <button class="btn sm" data-act="copy-report">Copiar informe</button>
    <span class="muted small">Para enviarlo si algo no cuadra en tu PC o en el de otra persona.</span>`;
}

// Barra de pestañas reutilizable. scope: "game" | "win".
function tabBar(scope: string, tabs: [string, string, string][], active: string) {
  return `
    <nav class="tabs" role="tablist" aria-label="Secciones">
      ${tabs.map(([id, label, count]) => `
        <button class="tab" role="tab" aria-selected="${id === active}" data-tab="${scope}:${id}">
          <span>${label}</span>${count ? `<span class="tab-count">${esc(count)}</span>` : ""}
        </button>`).join("")}
    </nav>`;
}

// "AMD Radeon™ R9 290, NVIDIA GeForce® GTX 970 or equivalent" → "AMD Radeon R9 290, NVIDIA GeForce GTX 970"
const shorten = (t: string) => t.replace(/[®™]/g, "").replace(/\s*(or (better|equivalent|higher)|o equivalente).*$/i, "").slice(0, 70);

function driversList() {
  const d = state.drivers;
  if (!d) return `<div class="sk-list">${skel(4)}</div>`;
  const old = d.items.filter((i) => i.outdated).length;
  return `
    <p class="count">${old === 0 ? "Todo al día" : `${old} ${old === 1 ? "antiguo" : "antiguos"}`}</p>
    <ul class="rows">
      ${d.items.map((i) => `
        <li class="row">
          <div class="row-main">
            <strong>${esc(i.group)}</strong>
            <span class="muted" title="${esc(i.name)}">${esc(shorten(i.name))} · ${esc(i.version)}${i.date ? ` · ${new Date(i.date).toLocaleDateString("es", { month: "short", year: "numeric" })}` : ""}</span>
            ${i.outdated && i.note ? `<span class="muted small">${esc(i.note)}</span>` : ""}
          </div>
          <span class="tag ${i.outdated ? "warn" : "ok"}">${i.ageMonths == null ? "Sin fecha" : i.outdated ? `${i.ageMonths} meses` : "Al día"}</span>
          <button class="btn sm" data-update="${i.id}">${i.group === "BIOS" ? "Ver BIOS" : "Buscar"}</button>
        </li>`).join("")}
    </ul>
    <button class="link" data-update="windows-update">Buscar en Windows Update (actualizaciones opcionales)</button>`;
}

async function openUpdate(id: string) {
  try {
    await api.openUpdate(id);
    toast(id === "windows-update" ? "Se abrió Windows Update." : "Se abrió la página oficial de descarga.");
  } catch (e) {
    toast(errorText(e), true);
  }
}

// Cambios a mano pendientes de guardar: por archivo (índice) → por ajuste (índice) → valor nuevo.
const edits = new Map<number, Map<number, string>>();

function allSettings(files: GameFile[]) {
  if (!files.length) return "";
  return `
    <section class="all-settings-block">
      <h2>Ajustes de vídeo del juego</h2>
      <p class="muted small">Puedes cambiar cualquier valor a mano. Antes de guardar se hace una copia y el cambio queda en el historial para deshacerlo. Cambia solo lo que sepas qué hace: un valor inventado puede hacer que el juego reinicie sus ajustes.</p>
      ${files.map((f, fi) => fileBlock(f, fi)).join("")}
    </section>`;
}

function fileBlock(f: GameFile, fi: number) {
  const pending = edits.get(fi)?.size ?? 0;
  // Solo los de vídeo; primero los gráficos reconocidos. Lo demás (sonido, teclas, chat...) queda plegado aparte.
  const all = f.entries.map((e, i) => ({ e, i }));
  const video = all.filter(({ e }) => isVideoSetting(e.name, e.category)).sort((a, b) => Number(Boolean(b.e.category)) - Number(Boolean(a.e.category)));
  const other = all.filter(({ e }) => !isVideoSetting(e.name, e.category));
  const row = ({ e, i }: { e: GameFile["entries"][number]; i: number }) => {
    const v = edits.get(fi)?.get(i) ?? e.value;
    const changed = v !== e.value;
    const name = friendlyName(e.name);
    const desc = describe(e.name);
    const input = e.options
      ? `<select data-edit="${fi}:${i}" aria-label="${esc(name)}">${(e.options.some((o) => o.value === v) ? e.options : [{ value: v, label: v }, ...e.options]).map((o) => `<option value="${esc(o.value)}" ${o.value === v ? "selected" : ""}>${esc(o.label)}${o.label !== o.value ? ` (${esc(o.value)})` : ""}</option>`).join("")}</select>`
      : `<input type="text" data-edit="${fi}:${i}" value="${esc(v)}" spellcheck="false" aria-label="${esc(name)}" />`;
    return `
          <li class="kv editable ${changed ? "edited" : ""}" data-search="${esc(`${name} ${e.name} ${e.value} ${e.category ?? ""}`.toLowerCase())}">
            <span class="kname" title="${esc(e.key)}"><strong>${esc(name)}</strong>${desc ? `<span class="kdesc">${esc(desc)}</span>` : ""}<small class="mono">${esc(e.name)}</small></span>
            ${input}
            <span class="muted">${e.category ? `${esc(e.category)}${e.sure === false ? " · el número no dice si es más o menos calidad" : ""}` : ""}</span>
          </li>`;
  };
  return `
    <details class="factors all-settings" ${fi === 0 || pending ? "open" : ""}>
      <summary>${esc(f.file.split(/[\\/]/).pop() ?? f.file)} · ${video.length} ajustes de vídeo</summary>
      <p class="muted small path">${esc(f.file)}</p>
      <div class="file-tools">
        <input type="search" class="filter" data-filter="${fi}" placeholder="Buscar ajuste o valor…" aria-label="Buscar en ${esc(f.file)}" />
        <button class="btn sm primary" data-save="${fi}" ${pending && !state.working ? "" : "disabled"}>${pending ? `Guardar ${pending} ${pending === 1 ? "cambio" : "cambios"}` : "Sin cambios"}</button>
      </div>
      <ul data-list="${fi}">${video.map(row).join("")}</ul>
      ${other.length ? `
      <details class="other-settings">
        <summary class="muted small">Otros ${other.length} ajustes del archivo (sonido, controles, interfaz…)</summary>
        <ul data-list="${fi}">${other.map(row).join("")}</ul>
      </details>` : ""}
      ${f.total > f.entries.length ? `<p class="muted small">Se muestran los primeros ${f.entries.length}.</p>` : ""}
    </details>`;
}

async function saveEdits(fi: number) {
  const g = state.game;
  const f = state.detail?.files[fi];
  const pending = edits.get(fi);
  if (!g || !f || !pending?.size) return;
  const changes = [...pending].map(([i, value]) => ({ key: f.entries[i].key, value }));
  const list = changes.slice(0, 6).map((c) => `${c.key.replace(/^.*::/, "")} = ${c.value}`).join(", ") + (changes.length > 6 ? "…" : "");
  const ok = await change("edit", `Guardar ${changes.length} ${changes.length === 1 ? "cambio" : "cambios"} en ${g.name}`,
    `Archivo: ${f.file.split(/[\\/]/).pop()}. Cambios: ${list}. Cierra el juego antes de guardar.`, "Guardar",
    () => api.setValues(g.id, f.file, changes), { undoable: true });
  if (ok) {
    edits.clear();
    await refreshGames();
    loadDetail();
  }
}

/* ---------- Utilidades ---------- */

function safeGet(k: string) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string | null) {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ }
}

let toastTimer = 0;
function toast(text: string, error = false) {
  const t = $("#toast");
  t.classList.toggle("error", error);
  t.innerHTML = `${error ? icon.warning : icon.check}<span>${esc(text)}</span>`;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), error ? 5000 : 3500);
}

function confirmAction(title: string, body: string, cta: string, opts: { admin?: boolean; undoable?: boolean } = {}): Promise<boolean> {
  const d = $<HTMLDialogElement>("#confirm");
  d.innerHTML = `
    <form method="dialog">
      <h2>${esc(title)}</h2>
      <p class="muted">${esc(body)}</p>
      ${opts.admin ? `<p class="note">${icon.shield}<span>Windows te pedirá permiso de administrador.</span></p>` : ""}
      ${opts.undoable ? `<p class="note">${icon.restore}<span>Podrás deshacerlo desde el historial.</span></p>` : ""}
      <div class="dialog-actions">
        <button class="btn" value="no">Cancelar</button>
        <button class="btn primary" value="yes" autofocus>${esc(cta)}</button>
      </div>
    </form>`;
  d.showModal();
  return new Promise((res) => d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true }));
}

/* ---------- Cambios (siempre con permiso + confirmación) ---------- */

async function change(id: string, title: string, body: string, cta: string, run: () => Promise<string | ActionResult>, opts: { admin?: boolean; undoable?: boolean } = {}) {
  if (!permitted()) {
    toast("Primero da permiso a Gamer Config para hacer cambios.", true);
    go("sistema");
    return false;
  }
  if (state.working || !(await confirmAction(title, body, cta, opts))) return false;
  state.working = id;
  rerender();
  try {
    const r = await run();
    if (typeof r === "string") toast(r);
    else if (r.verified === false) toast(`${r.msg} Pero al comprobarlo, Windows no lo muestra aplicado: puede que una política o programa lo esté bloqueando.`, true);
    else toast(r.verified ? `${r.msg} Verificado en Windows.` : r.msg);
    return r === null || typeof r === "string" || r.verified !== false;
  } catch (e) {
    toast(errorText(e), true);
    return false;
  } finally {
    state.working = null;
    rerender();
  }
}

// Lo que no se puede deshacer (se borran archivos o se crea algo nuevo).
const NO_UNDO = new Set(["temp", "wucache", "recycle", "restore", "diskopt", "widgets"]);

async function winAction(id: string) {
  if (id === "driver") {
    const gpu = (await api.drivers().catch(() => null))?.items.find((i) => i.group === "Gráfica");
    return openUpdate(gpu?.id ?? "windows-update");
  }
  if (id === "startup" || id === "drivers") { state.winTab = id; return go("sistema"); }
  state.win ??= await api.winState().catch(() => null);
  const item = state.win?.items.find((i) => i.id === id);
  if (!item) return;
  if (item.manual) {
    // No cambia nada por sí mismo: abre la página de Configuración, sin pedir confirmación.
    toast((await api.winAction(id)).msg);
    return;
  }
  const extra = item.relogin ? " Se aplica del todo al cerrar sesión." : item.reboot ? " Tendrás que reiniciar el PC." : "";
  if (await change(id, item.title, item.body + extra, item.cta, () => api.winAction(id), { admin: item.admin, undoable: !NO_UNDO.has(id) })) {
    state.findings = state.findings?.filter((f) => f.id !== id) ?? null;
    await refreshWindows();
  }
}

async function toggleStartup(i: number, enabled: boolean) {
  const a = state.startup?.[i];
  if (!a) return;
  const ok = await change(
    "startup",
    `${enabled ? "Activar" : "Desactivar"} ${a.name}`,
    enabled ? `${a.name} se abrirá cada vez que enciendas el PC.` : `${a.name} ya no se abrirá al encender el PC. Podrás abrirlo igual cuando quieras.`,
    enabled ? "Activar" : "Desactivar",
    () => api.winAction("startup", { id: a.id, enabled, name: a.name }),
    { admin: a.scope === "machine", undoable: true },
  );
  if (ok) a.enabled = enabled;
  await refreshWindows();
}

async function undo(id: number) {
  if (state.working) return;
  state.working = "undo";
  rerender();
  try {
    toast(await api.undo(id));
  } catch (e) {
    toast(errorText(e), true);
  }
  state.working = null;
  await refreshWindows();
  api.games().then((g) => { state.games = g; });
}

async function refreshWindows() {
  const [w, h, s, d] = await Promise.all([api.winState(), api.history(), api.startup(), api.drivers()].map((p) => p.catch(() => null)));
  if (d) state.drivers = d as DriverInfo;
  if (w) state.win = w as WinState;
  if (h) state.history = h as HistoryEntry[];
  if (s) state.startup = s as StartupApp[];
  rerender();
}

function loadWindows() {
  if (!state.win || !state.history) refreshWindows();
}

/* ---------- Juegos ---------- */

async function openGame(id: string) {
  state.game = state.games?.find((g) => g.id === id) ?? null;
  edits.clear(); // los cambios a mano sin guardar son de otro juego
  state.gameTab = "rec";
  render();
  loadDetail();
}

async function loadDetail() {
  const g = state.game;
  if (!g) return;
  state.detail = null;
  rerender();
  try {
    const d = await api.gameDetail(g.id, state.goal);
    if (state.game === g) { state.detail = d; rerender(); }
  } catch (e) {
    toast(errorText(e), true);
  }
}

async function refreshGames() {
  state.games = await api.games();
  if (state.game) state.game = state.games.find((g) => g.id === state.game!.id) ?? null;
}

const GOALS: [Goal, string][] = [["fps", "Más FPS"], ["equilibrado", "Equilibrado"], ["calidad", "Calidad"]];

// Buscador y filtros de la lista de juegos.
const GAME_FILTERS: [typeof state.gameFilter, string][] = [["todos", "Todos"], ["optimizable", "Optimizables"], ["optimizado", "Optimizados"], ["guía", "Solo guía"]];

function visibleGames(games: Game[]) {
  const q = state.gameQuery.trim().toLowerCase();
  return games.filter((g) => (state.gameFilter === "todos" || g.status === state.gameFilter) && (!q || `${g.name} ${g.store}`.toLowerCase().includes(q)));
}

function gamesToolbar(games: Game[]) {
  const shown = visibleGames(games).length;
  return `
    <div class="games-toolbar">
      <input type="search" class="filter" data-game-query placeholder="Buscar juego o tienda…" value="${esc(state.gameQuery)}" aria-label="Buscar juego" />
      <div class="chips" role="group" aria-label="Filtrar juegos">
        ${GAME_FILTERS.map(([id, label]) => {
          const n = id === "todos" ? games.length : games.filter((g) => g.status === id).length;
          return `<button class="chip ${state.gameFilter === id ? "on" : ""}" data-filter-game="${id}" aria-pressed="${state.gameFilter === id}">${label}<span class="chip-count">${n}</span></button>`;
        }).join("")}
      </div>
    </div>
    ${shown === 0 ? `<p class="muted">Ningún juego coincide con la búsqueda.</p>` : ""}`;
}

// Configuración central: un modo para todos los juegos.
function centralBlock(games: Game[]) {
  const auto = games.filter((g) => g.status !== "guía").length;
  return `
    <section class="block central">
      <div class="row-main">
        <h2>Configuración para todos los juegos</h2>
        <span class="muted">Elige un modo y se aplica a cada juego con sus propios ajustes, calculados para tu gráfica, tu procesador y lo que pide ese juego. ${auto} de ${games.length} se pueden configurar solos; los demás tienen su guía.</span>
      </div>
      <div class="central-actions">
        <fieldset class="seg" aria-label="Modo para todos los juegos">
          ${GOALS.map(([v, l]) => `<label><input type="radio" name="goal" value="${v}" ${state.goal === v ? "checked" : ""} /><span>${l}</span></label>`).join("")}
        </fieldset>
        <button class="btn primary" data-act="apply-all" ${state.working || auto === 0 ? "disabled" : ""}>
          ${icon.check}<span>${state.working === "all" ? "Aplicando…" : "Aplicar a todos"}</span>
        </button>
      </div>
    </section>`;
}

async function applyAll() {
  const goalName = GOALS.find(([v]) => v === state.goal)![1];
  await change("all", `Aplicar «${goalName}» a todos los juegos`,
    "Se calcula y se aplica en cada juego que se puede configurar solo. Los que estén abiertos se saltan. Antes de tocar cada juego se guarda una copia, y cada uno se puede deshacer por separado desde el historial.",
    "Aplicar a todos",
    async () => {
      const res = await api.applyAll(state.goal);
      state.games = await api.games();
      showResults(res, goalName);
      const ok = res.filter((r) => r.status === "ok").length;
      return `«${goalName}» aplicado en ${ok} ${ok === 1 ? "juego" : "juegos"}.`;
    },
    { undoable: true });
}

function showResults(res: ApplyResult[], goalName: string) {
  const LABEL: Record<ApplyResult["status"], [string, string]> = {
    ok: ["Aplicado", "ok"], same: ["Ya estaba así", "ok"], guia: ["Solo guía", ""], skip: ["Saltado", "warn"], error: ["No se pudo", "warn"],
  };
  const d = $<HTMLDialogElement>("#confirm");
  d.innerHTML = `
    <form method="dialog" class="results">
      <h2>«${esc(goalName)}» en todos los juegos</h2>
      <ul class="rows">
        ${res.map((r) => `
          <li class="row">
            <div class="row-main"><strong>${esc(r.name)}</strong><span class="muted">${esc(r.msg)}</span></div>
            <span class="tag ${LABEL[r.status][1]}">${LABEL[r.status][0]}</span>
          </li>`).join("")}
      </ul>
      <div class="dialog-actions"><button class="btn primary" value="ok">Entendido</button></div>
    </form>`;
  d.showModal();
}

async function applyGame() {
  const g = state.game;
  if (!g) return;
  const goalName = { fps: "más FPS", equilibrado: "equilibrio", calidad: "calidad" }[state.goal];
  const ok = await change("game", `Optimizar ${g.name} para ${goalName}`,
    "Se modificará el archivo de configuración del juego. Cierra el juego antes de continuar.", "Aplicar",
    () => api.applyGame(g.id, state.goal), { undoable: true });
  if (ok) { await refreshGames(); loadDetail(); }
}

async function restoreGame() {
  const g = state.game;
  if (!g) return;
  const ok = await change("game", `Restaurar ${g.name}`, "Se volverá a la configuración que tenía el juego antes de usar Gamer Config.", "Restaurar",
    () => api.restoreGame(g.id));
  if (ok) { await refreshGames(); loadDetail(); }
}

/* ---------- Análisis ---------- */

async function runScan() {
  state.scanning = true;
  rerender();
  try {
    state.findings = await api.scan();
  } catch {
    toast("No se pudo analizar el sistema. Inténtalo de nuevo.", true);
  }
  state.scanning = false;
  if (state.view === "panel") rerender();
}

/* ---------- Eventos (delegados) ---------- */

document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-nav],[data-act],[data-fix],[data-win],[data-game],[data-undo],[data-update],[data-save],[data-tab],[data-filter-game]");
  if (!t) return;
  const d = t.dataset;
  if (d.nav) go(d.nav as View);
  else if (d.fix) winAction(d.fix);
  else if (d.win) winAction(d.win);
  else if (d.game) openGame(d.game);
  else if (d.undo) undo(Number(d.undo));
  else if (d.update) openUpdate(d.update);
  else if (d.tab) {
    const [scope, id] = d.tab.split(":");
    if (scope === "win") { state.winTab = id as typeof state.winTab; safeSet("winTab", id); }
    else state.gameTab = id as GameTab;
    rerender();
  }
  else if (d.filterGame) { state.gameFilter = d.filterGame as typeof state.gameFilter; rerender(); }
  else if (d.save != null) saveEdits(Number(d.save));
  else if (d.act === "scan") runScan();
  else if (d.act === "back") { state.game = null; render(); }
  else if (d.act === "apply-game") applyGame();
  else if (d.act === "restore-game") restoreGame();
  else if (d.act === "copy-report" && state.game) {
    api.copyReport(state.game.id, state.goal).then(
      () => toast("Informe copiado. Pégalo en un mensaje (Ctrl+V)."),
      (e) => toast(errorText(e), true),
    );
  }
  else if (d.act === "grant") { safeSet("permiso", "1"); toast("Permiso concedido. Cada cambio te seguirá pidiendo confirmación."); rerender(); }
  else if (d.act === "recheck") {
    state.win = null;
    rerender();
    refreshWindows().then(() => {
      const n = state.win?.items.filter((i) => i.done).length ?? 0;
      toast(`Comprobado en Windows: ${n} optimizaciones aplicadas de verdad.`);
    });
  }
  else if (d.act === "apply-all") applyAll();
  else if (d.act === "revoke") { safeSet("permiso", null); toast("Permiso retirado. Gamer Config solo analizará."); rerender(); }
});

// Buscar dentro de un archivo de ajustes: se ocultan filas sin volver a pintar (no se pierde lo escrito).
document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.gameQuery != null) {
    // Se filtra sin volver a pintar toda la vista para no perder el foco del buscador.
    state.gameQuery = t.value;
    const ids = new Set(visibleGames(state.games ?? []).map((g) => g.id));
    document.querySelectorAll<HTMLElement>(".games [data-game]").forEach((b) => { b.hidden = !ids.has(b.dataset.game!); });
    return;
  }
  if (t.dataset.filter == null) return;
  const q = t.value.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>(`[data-list="${t.dataset.filter}"] > li`).forEach((li) => {
    li.hidden = q !== "" && !(li.dataset.search ?? "").includes(q);
  });
});

// Valor cambiado a mano: se apunta y se actualiza el botón de guardar sin volver a pintar.
function noteEdit(t: HTMLInputElement | HTMLSelectElement) {
  const [fi, i] = t.dataset.edit!.split(":").map(Number);
  const original = state.detail?.files[fi]?.entries[i]?.value;
  if (original == null) return;
  if (!edits.has(fi)) edits.set(fi, new Map());
  const m = edits.get(fi)!;
  if (t.value === original) m.delete(i); else m.set(i, t.value);
  t.closest("li")?.classList.toggle("edited", t.value !== original);
  const btn = document.querySelector<HTMLButtonElement>(`[data-save="${fi}"]`);
  if (btn) {
    btn.disabled = m.size === 0 || Boolean(state.working);
    btn.textContent = m.size ? `Guardar ${m.size} ${m.size === 1 ? "cambio" : "cambios"}` : "Sin cambios";
  }
}

document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.edit) { noteEdit(t); return; }
  if (t.name === "goal") {
    state.goal = t.value as Goal;
    safeSet("goal", state.goal);
    loadDetail();
  } else if (t.dataset.startup) {
    const want = t.checked;
    t.checked = !want; // el interruptor solo cambia si el cambio se hace de verdad
    toggleStartup(Number(t.dataset.startup), want);
  }
});

// Al volver a la app (p. ej. después de cambiar algo en Configuración de Windows) se vuelve a comprobar.
window.addEventListener("focus", () => { if (state.view === "sistema" && !state.working) refreshWindows(); });

// Portadas que no cargan (sin internet, juego sin portada): se quitan y queda la inicial.
document.addEventListener("error", (e) => { if (e.target instanceof HTMLImageElement) e.target.remove(); }, true);

// Juego nuevo instalado (o desinstalado): la lista se actualiza sola.
api.onGamesChanged(async (added) => {
  await refreshGames().catch(() => {});
  for (const g of added) {
    toast(`Nuevo juego detectado: ${g.name}. Ya tiene sus ajustes calculados.`);
  }
  if (state.view === "juegos") rerender();
});

/* ---------- Arranque ---------- */

go("panel");

const failed = (what: string) => () => toast(`No se pudo leer ${what}.`, true);
api.specs().then((s) => { state.specs = s; if (state.view !== "juegos") rerender(); }, failed("el hardware"));
api.games().then((g) => { state.games = g; if (state.view === "juegos" && !state.game) rerender(); }, failed("los juegos"));

// Uso en vivo: solo se consulta mientras el Resumen está visible.
async function tick() {
  if (state.view === "panel" && document.visibilityState === "visible") {
    try {
      const u = await api.usage();
      state.usage = u;
      // Se actualizan los nodos existentes (no se re-renderiza) para que las barras animen suavemente.
      document.querySelectorAll<HTMLElement>(".meter").forEach((m) => {
        const v = u[m.dataset.k as keyof Usage];
        m.querySelector(".meter-val")!.innerHTML = meterVal(v);
        m.querySelector<HTMLElement>(".bar i")!.style.transform = `scaleX(${(v ?? 0) / 100})`;
        m.classList.remove("hot", "warm");
        if (meterLevel(v)) m.classList.add(meterLevel(v));
      });
    } catch { /* una lectura fallida no importa: la siguiente llega en 2 s */ }
  }
  setTimeout(tick, 2000);
}
tick();
