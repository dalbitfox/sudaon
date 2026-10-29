const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
  ipcMain,
  shell,
  screen,
  dialog,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
let mainWindow,
  tray,
  runtime,
  quitting = false;
const displays = new Set();
let settings = {};
let origin = "";
const loadSettings = () => {
  try {
    settings = JSON.parse(
      fs.readFileSync(
        path.join(app.getPath("userData"), "display-settings.json"),
        "utf8",
      ),
    );
  } catch {}
};
const saveSettings = () =>
  fs.writeFileSync(
    path.join(app.getPath("userData"), "display-settings.json"),
    JSON.stringify(settings),
  );
const reveal = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  for (const win of displays) {
    win.showInactive();
    win.setAlwaysOnTop(win.sudaonTop);
  }
};
function protect(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (
        target.origin === origin ||
        (target.protocol === "https:" && target.hostname === "github.com")
      )
        shell.openExternal(url);
    } catch {}
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
}
function safeBounds(bounds) {
  if (!bounds) return {};
  const valid = screen
    .getAllDisplays()
    .some(
      (d) =>
        bounds.x < d.workArea.x + d.workArea.width &&
        bounds.x + bounds.width > d.workArea.x &&
        bounds.y < d.workArea.y + d.workArea.height &&
        bounds.y + bounds.height > d.workArea.y,
    );
  return valid ? bounds : {};
}
async function openDisplay(options) {
  if (!/^[A-Za-z0-9_-]{16}$/.test(options?.roomId || ""))
    throw new Error("Invalid room");
  for (const kind of options.layout === "split"
    ? ["chat", "keywords"]
    : ["combined"]) {
    const existing = [...displays].find(
      (w) => w.sudaonRoom === options.roomId && w.sudaonKind === kind,
    );
    if (existing) {
      existing.showInactive();
      continue;
    }
    const bounds = safeBounds(settings[kind]);
    const win = new BrowserWindow({
      width: 510,
      height: kind === "keywords" ? 410 : 690,
      minWidth: 340,
      minHeight: 260,
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: Boolean(options.top),
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.sudaonTop = Boolean(options.top);
    win.sudaonRoom = options.roomId;
    win.sudaonKind = kind;
    displays.add(win);
    protect(win);
    const query = new URLSearchParams({
      kind,
      opacity: String(
        Math.min(100, Math.max(20, Number(options.opacity) || 85)),
      ),
      font: String(Math.min(36, Math.max(16, Number(options.font) || 20))),
      top: String(Boolean(options.top)),
    });
    win.once("ready-to-show", () => win.showInactive());
    for (const event of ["moved", "resized"])
      win.on(event, () => {
        settings[kind] = win.getBounds();
        saveSettings();
      });
    win.on("closed", () => displays.delete(win));
    await win.loadURL(`${origin}/display/${options.roomId}?${query}`);
  }
}
app
  .whenReady()
  .then(async () => {
    loadSettings();
    if (process.env.SUDAON_APP_URL) {
      const target = new URL(process.env.SUDAON_APP_URL);
      if (target.protocol !== "https:")
        throw new Error("온라인 주소에는 HTTPS를 사용해 주세요.");
      origin = target.origin;
    } else {
      const { startLocal } = await import("../server/start.mjs");
      runtime = await startLocal({
        port: 0,
        filename: path.join(app.getPath("userData"), "sudaon.sqlite"),
      });
      origin = runtime.url;
    }
    mainWindow = new BrowserWindow({
      width: 1320,
      height: 920,
      minWidth: 760,
      minHeight: 600,
      backgroundColor: "#f6f7f3",
      title: "수다온 · 발표자",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    protect(mainWindow);
    mainWindow.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
    mainWindow.webContents.session.on("will-download", (event, item) =>
      item.setSaveDialogOptions({
        title: "수다온 발표 기록 저장",
        defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
      }),
    );
    await mainWindow.loadURL(origin);
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const inside =
          (x >= 4 && x <= 27 && y >= 5 && y <= 23) ||
          (x >= 6 && x <= 12 && y > 23 && y <= 28 - x + 6);
        if (inside) {
          const k = (y * 32 + x) * 4;
          pixels[k] = 136;
          pixels[k + 1] = 226;
          pixels[k + 2] = 188;
          pixels[k + 3] = 255;
        }
      }
    const image = nativeImage.createFromBitmap(pixels, {
      width: 32,
      height: 32,
      scaleFactor: 1,
    });
    tray = new Tray(image);
    tray.setToolTip("수다온 · 채팅 서버 실행 중");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "발표자 화면과 표시창 열기", click: reveal },
        {
          label: "표시창만 다시 열기",
          click: () => {
            for (const win of displays) {
              win.showInactive();
              win.setAlwaysOnTop(win.sudaonTop);
            }
          },
        },
        { type: "separator" },
        {
          label: "수다온 완전히 종료 (채팅 서버도 종료)",
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on("double-click", reveal);
    globalShortcut.register("CommandOrControl+Alt+Space", reveal);
    globalShortcut.register("CommandOrControl+Alt+H", () => {
      for (const win of displays) win.hide();
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "수다온",
          submenu: [
            {
              label: "온라인 수다온 열기",
              click: async () => {
                origin = "https://sudaon.vercel.app";
                for (const win of displays) win.close();
                await mainWindow.loadURL(origin);
                mainWindow.show();
              },
            },
            {
              label: "이 컴퓨터의 로컬 모드 열기",
              click: async () => {
                if (!runtime) {
                  const { startLocal } = await import("../server/start.mjs");
                  runtime = await startLocal({
                    port: 0,
                    filename: path.join(
                      app.getPath("userData"),
                      "sudaon.sqlite",
                    ),
                  });
                }
                origin = runtime.url;
                for (const win of displays) win.close();
                await mainWindow.loadURL(origin);
                mainWindow.show();
              },
            },
            { type: "separator" },
            { label: "발표자 화면", click: reveal },
            {
              label: "표시창 복구",
              accelerator: "CommandOrControl+Alt+Space",
              click: reveal,
            },
            { type: "separator" },
            {
              label: "완전히 종료",
              click: () => {
                quitting = true;
                app.quit();
              },
            },
          ],
        },
        {
          label: "보기",
          submenu: [
            { role: "reload" },
            { role: "toggleDevTools" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
          ],
        },
      ]),
    );
  })
  .catch((error) => {
    dialog.showErrorBox("수다온을 시작하지 못했습니다", error.message);
    quitting = true;
    app.quit();
  });
ipcMain.handle("display:open", (event, options) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWindow)
    throw new Error("Not permitted");
  return openDisplay(options);
});
ipcMain.handle("display:control", async (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!displays.has(win)) throw new Error("Not permitted");
  if (options.action === "pin") {
    win.sudaonTop = Boolean(options.value);
    win.setAlwaysOnTop(win.sudaonTop);
  }
  if (options.action === "hide") win.hide();
  if (options.action === "lower") {
    win.sudaonTop = false;
    win.setAlwaysOnTop(false);
    if (process.platform === "win32") {
      const buffer = win.getNativeWindowHandle();
      const handle =
        buffer.length === 8
          ? buffer.readBigUInt64LE().toString()
          : buffer.readUInt32LE().toString();
      await new Promise((resolve, reject) =>
        execFile(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            path.join(__dirname, "lower.ps1"),
            "-WindowHandle",
            handle,
          ],
          { windowsHide: true },
          (error) => (error ? reject(error) : resolve()),
        ),
      );
    } else win.blur();
  }
  return true;
});
app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  runtime?.close().catch(() => {});
});
app.on("window-all-closed", () => {});
app.on("activate", reveal);
