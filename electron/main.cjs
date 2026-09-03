// module-board Electron 主进程：加载打包好的 dist，提供原生文件对话框。
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const JSON_FILTERS = [{ name: "module-board JSON", extensions: ["json"] }];

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "..", "dist", "module-board.html"));
}

ipcMain.handle("dlg-open", async () => {
  const r = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: JSON_FILTERS,
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p), path: p, text: fs.readFileSync(p, "utf8") };
});

ipcMain.handle("dlg-save-as", async (_e, defaultName, text) => {
  const r = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: JSON_FILTERS,
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, text, "utf8");
  return { name: path.basename(r.filePath), path: r.filePath };
});

ipcMain.handle("file-save", async (_e, filePath, text) => {
  try {
    fs.writeFileSync(filePath, text, "utf8");
    return true;
  } catch {
    return false;
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
