const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "sudaon",
  Object.freeze({
    openDisplay: (options) => ipcRenderer.invoke("display:open", options),
    control: (options) => ipcRenderer.invoke("display:control", options),
  }),
);
