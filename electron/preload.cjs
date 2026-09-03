// preload：向渲染进程暴露受限的桌面桥（打开/另存为/写回同一文件）。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("moduleBoardDesktop", {
  open: () => ipcRenderer.invoke("dlg-open"),
  saveAs: (defaultName, text) => ipcRenderer.invoke("dlg-save-as", defaultName, text),
  save: (filePath, text) => ipcRenderer.invoke("file-save", filePath, text),
});
