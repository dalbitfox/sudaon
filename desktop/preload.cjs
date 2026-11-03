const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "sudaon",
  Object.freeze({
    openDisplay: (options) => ipcRenderer.invoke("display:open", options),
    control: (options) => ipcRenderer.invoke("display:control", options),
    getStates: () => ipcRenderer.invoke("display:states"),
    onStateChange: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("display:state", handler);
      ipcRenderer.on("display:allStates", handler);
      return () => {
        ipcRenderer.removeListener("display:state", handler);
        ipcRenderer.removeListener("display:allStates", handler);
      };
    },
  }),
);
