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
  openUpdate: call("open-update"),
  onGamesChanged: (cb) => ipcRenderer.on("games-changed", (_e, added) => cb(added)),
});
