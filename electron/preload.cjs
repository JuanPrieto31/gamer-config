// Puente seguro: la interfaz solo puede llamar a estas funciones, nada más del sistema.
const { contextBridge, ipcRenderer } = require("electron");

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld("afina", {
  specs: call("specs"),
  usage: call("usage"),
  scan: call("scan"),
  startup: call("startup"),
  games: call("games"),
  gameDetail: call("game-detail"),
  applyGame: call("game-apply"),
  restoreGame: call("game-restore"),
  copyReport: call("copy-report"),
  applyAll: call("games-apply-all"),
  setValues: call("game-set"),
  winState: call("win-state"),
  winAction: call("win-action"),
  history: call("history"),
  undo: call("undo"),
  drivers: call("drivers"),
  overlayGet: call("overlay-get"),
  overlaySet: call("overlay-set"),
  overlayToggle: call("overlay-toggle"),
  overlayFps: call("overlay-fps"),
  gamemodeGet: call("gamemode-get"),
  gamemodeSet: call("gamemode-set"),
  gamemodeApps: call("gamemode-apps"),
  netTest: call("net-test"),
  updateStatus: call("update-status"),
  updateInstall: call("update-install"),
  onUpdateReady: (cb) => ipcRenderer.on("update-ready", (_e, v) => cb(v)),
  openUpdate: call("open-update"),
  onGamesChanged: (cb) => ipcRenderer.on("games-changed", (_e, added) => cb(added)),
});
