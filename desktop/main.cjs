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
  quitting = false,
  appReady = false,
  pendingDeepLink = null;
const displays = new Set();
let settings = {};
let origin = "";

function isAllowedServerOrigin(rawOrigin) {
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.protocol === "https:") return parsed.origin;
    if (
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    ) {
      return parsed.origin;
    }
  } catch {}
  return "";
}

function parseDeepLink(input) {
  const raw = Array.isArray(input)
    ? input.find((arg) => typeof arg === "string" && arg.startsWith("sudaon://"))
    : typeof input === "string" && input.startsWith("sudaon://")
      ? input
      : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const action = url.hostname || url.pathname.replace(/^\/+/, "") || "display";
    const targetOrigin = isAllowedServerOrigin(
      url.searchParams.get("origin") || "",
    );
    const roomId = url.searchParams.get("roomId") || "";
    const layout =
      url.searchParams.get("layout") === "combined" ? "combined" : "split";
    const opacity = Math.min(
      100,
      Math.max(10, Number(url.searchParams.get("opacity")) || 85),
    );
    const font = Math.min(
      36,
      Math.max(16, Number(url.searchParams.get("font")) || 20),
    );
    const top = url.searchParams.get("top") !== "false";
    const topChat =
      url.searchParams.get("topChat") !== null
        ? url.searchParams.get("topChat") !== "false"
        : top;
    const topKeywords =
      url.searchParams.get("topKeywords") !== null
        ? url.searchParams.get("topKeywords") !== "false"
        : top;
    const dt = (url.searchParams.get("dt") || "").slice(0, 512);
    const launchId = (
      url.searchParams.get("lid") ||
      url.searchParams.get("launchId") ||
      ""
    )
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 64);

    return {
      action,
      targetOrigin,
      roomId: /^[A-Za-z0-9_-]{16}$/.test(roomId) ? roomId : "",
      layout,
      opacity,
      font,
      top,
      topChat,
      topKeywords,
      dt,
      launchId,
    };
  } catch {
    return null;
  }
}

function registerProtocolClient() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("sudaon", process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    } else {
      app.setAsDefaultProtocolClient("sudaon");
    }
  } catch {}

  // Ensure HKCU\Software\Classes\sudaon\shell\open\command points to the real
  // installed or portable .exe without requiring administrator UAC elevation.
  const winExeCandidate =
    process.platform === "win32"
      ? process.env.PORTABLE_EXECUTABLE_FILE ||
        (app.isPackaged ? process.execPath : "")
      : "";
  if (winExeCandidate && fs.existsSync(winExeCandidate)) {
    const regKey = "HKCU\\Software\\Classes\\sudaon";
    const cmdVal = `"${winExeCandidate}" "%1"`;
    execFile(
      "reg.exe",
      ["add", regKey, "/ve", "/d", "URL:SudaOn Protocol", "/f"],
      { windowsHide: true },
      () => {
        execFile(
          "reg.exe",
          ["add", regKey, "/v", "URL Protocol", "/d", "", "/f"],
          { windowsHide: true },
          () => {
            execFile(
              "reg.exe",
              [
                "add",
                `${regKey}\\shell\\open\\command`,
                "/ve",
                "/d",
                cmdVal,
                "/f",
              ],
              { windowsHide: true },
              () => {},
            );
          },
        );
      },
    );
  }
}

async function fetchPendingAutoInstallLaunch() {
  const candidates = [
    process.env.SUDAON_APP_URL,
    "https://sudaon.vercel.app",
    "http://127.0.0.1:4173",
  ]
    .map((u) => (u ? isAllowedServerOrigin(u) : ""))
    .filter((u, idx, arr) => u && arr.indexOf(u) === idx);

  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/api/desktop/pending-launch`, {
        headers: { "X-Sudaon-Desktop": "1" },
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) continue;
      const body = await res.json();
      const launch = body?.launch;
      if (
        launch &&
        /^[A-Za-z0-9_-]{16}$/.test(launch.roomId || "") &&
        isAllowedServerOrigin(launch.targetOrigin || base)
      ) {
        return {
          action: "display",
          targetOrigin: isAllowedServerOrigin(launch.targetOrigin || base),
          roomId: launch.roomId,
          layout: launch.layout === "combined" ? "combined" : "split",
          opacity: Math.min(100, Math.max(10, Number(launch.opacity) || 85)),
          font: Math.min(36, Math.max(16, Number(launch.font) || 20)),
          top: launch.top !== false,
          topChat: launch.topChat !== false,
          topKeywords: launch.topKeywords !== false,
          dt: String(launch.dt || "").slice(0, 512),
          launchId: String(launch.launchId || "")
            .replace(/[^A-Za-z0-9_-]/g, "")
            .slice(0, 64),
        };
      }
    } catch {}
  }
  return null;
}

const initialDeepLink = parseDeepLink(process.argv);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

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

const broadcastDisplayStates = () => {
  const snapshot = {};
  for (const win of displays) {
    if (!win.isDestroyed()) {
      const isTop = Boolean(win.sudaonTop);
      snapshot[win.sudaonKind] = {
        open: win.isVisible(),
        pinned: isTop,
        alwaysOnTop: isTop,
        roomId: win.sudaonRoom,
      };
      win.webContents.send("display:state", {
        kind: win.sudaonKind,
        pinned: isTop,
        alwaysOnTop: isTop,
      });
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("display:allStates", snapshot);
  }
  return snapshot;
};

const reveal = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  for (const win of displays) {
    if (!win.isDestroyed()) {
      win.showInactive();
      win.setAlwaysOnTop(Boolean(win.sudaonTop), "floating");
    }
  }
  broadcastDisplayStates();
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
    try {
      if (new URL(url).origin !== origin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
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
  const kinds =
    options.layout === "split" ? ["chat", "keywords"] : ["combined"];
  // Close windows of the opposite layout mode or different room/origin so modes don't collide
  for (const win of [...displays]) {
    if (
      !kinds.includes(win.sudaonKind) ||
      win.sudaonRoom !== options.roomId ||
      win.sudaonOrigin !== origin
    ) {
      win.close();
    }
  }
  settings.pins ||= {};
  for (const [idx, kind] of kinds.entries()) {
    const requestedPin =
      kind === "chat"
        ? (options.topChat ?? options.top ?? settings.pins.chat ?? true)
        : kind === "keywords"
          ? (options.topKeywords ?? options.top ?? settings.pins.keywords ?? true)
          : (options.top ?? settings.pins.combined ?? true);
    const pinBool = Boolean(requestedPin);
    settings.pins[kind] = pinBool;

    const query = new URLSearchParams({
      kind,
      opacity: String(
        Math.min(100, Math.max(10, Number(options.opacity) || 85)),
      ),
      font: String(Math.min(36, Math.max(16, Number(options.font) || 20))),
      top: String(pinBool),
      windowIndex: String(idx + 1),
    });
    if (options.dt) query.set("dt", String(options.dt));
    if (options.launchId) query.set("lid", String(options.launchId));
    const targetUrl = `${origin}/display/${options.roomId}?${query}`;

    const existing = [...displays].find(
      (w) =>
        w.sudaonRoom === options.roomId &&
        w.sudaonKind === kind &&
        w.sudaonOrigin === origin,
    );
    if (existing && !existing.isDestroyed()) {
      existing.sudaonTop = pinBool;
      existing.setAlwaysOnTop(pinBool, "floating");
      if (options.dt) {
        await existing.loadURL(targetUrl);
      }
      existing.showInactive();
      continue;
    }

    const saved = safeBounds(settings[kind]);
    const defaultOffset = idx === 1 ? { x: 560, y: 80 } : {};
    const win = new BrowserWindow({
      width: 510,
      height: kind === "keywords" ? 430 : 690,
      minWidth: 340,
      minHeight: 260,
      ...defaultOffset,
      ...saved,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: pinBool,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.sudaonTop = pinBool;
    win.sudaonRoom = options.roomId;
    win.sudaonKind = kind;
    win.sudaonOrigin = origin;
    win.setAlwaysOnTop(pinBool, "floating");
    displays.add(win);
    protect(win);

    win.once("ready-to-show", () => {
      win.setAlwaysOnTop(Boolean(win.sudaonTop), "floating");
      win.showInactive();
      broadcastDisplayStates();
    });
    for (const event of ["moved", "resized"])
      win.on(event, () => {
        settings[kind] = win.getBounds();
        win.setAlwaysOnTop(Boolean(win.sudaonTop), "floating");
        saveSettings();
      });
    win.on("closed", () => {
      displays.delete(win);
      broadcastDisplayStates();
    });
    await win.loadURL(targetUrl);
  }
  saveSettings();
  return broadcastDisplayStates();
}

async function handleDeepLink(parsed) {
  if (!parsed) return;
  if (!appReady) {
    pendingDeepLink = parsed;
    return;
  }
  if (parsed.targetOrigin && parsed.targetOrigin !== origin) {
    origin = parsed.targetOrigin;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(origin).catch(() => {});
    }
  }
  if (parsed.roomId) {
    await openDisplay(parsed);
  } else {
    reveal();
  }
}

app.on("second-instance", (_event, commandLine) => {
  const parsed = parseDeepLink(commandLine);
  if (parsed) {
    handleDeepLink(parsed).catch(() => {});
  } else {
    reveal();
  }
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  const parsed = parseDeepLink(url);
  if (parsed) handleDeepLink(parsed).catch(() => {});
});

if (hasSingleInstanceLock) {
  app
    .whenReady()
    .then(async () => {
      registerProtocolClient();
      loadSettings();

      let startupLink = pendingDeepLink || initialDeepLink;
      pendingDeepLink = null;
      if (!startupLink) {
        startupLink = await fetchPendingAutoInstallLaunch();
      }

      if (startupLink?.targetOrigin) {
        origin = startupLink.targetOrigin;
      } else if (process.env.SUDAON_APP_URL) {
        const valid = isAllowedServerOrigin(process.env.SUDAON_APP_URL);
        if (!valid)
          throw new Error("온라인 주소에는 HTTPS(또는 로컬호스트)를 사용해 주세요.");
        origin = valid;
      } else {
        const { startLocal } = await import("../server/start.mjs");
        runtime = await startLocal({
          port: 0,
          filename: path.join(app.getPath("userData"), "sudaon.sqlite"),
        });
        origin = runtime.url;
      }

      const startHiddenForOverlay = Boolean(startupLink?.roomId);

      mainWindow = new BrowserWindow({
        width: 1360,
        height: 920,
        minWidth: 760,
        minHeight: 600,
        show: !startHiddenForOverlay,
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
      tray.setToolTip("수다온 · 발표 오버레이 실행 중");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "발표자 대시보드와 표시창 열기", click: reveal },
          {
            label: "투명 표시창만 다시 띄우기",
            click: () => {
              for (const win of displays) {
                win.showInactive();
                win.setAlwaysOnTop(Boolean(win.sudaonTop), "floating");
              }
              broadcastDisplayStates();
            },
          },
          { type: "separator" },
          {
            label: "수다온 완전히 종료",
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
        broadcastDisplayStates();
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

      appReady = true;
      if (startupLink?.roomId) {
        await openDisplay(startupLink);
      }
    })
    .catch((error) => {
      dialog.showErrorBox("수다온을 시작하지 못했습니다", error.message);
      quitting = true;
      app.quit();
    });
}

ipcMain.handle("display:open", (event, options) => {
  if (BrowserWindow.fromWebContents(event.sender) !== mainWindow)
    throw new Error("Not permitted");
  return openDisplay(options);
});
ipcMain.handle("display:states", (event) => {
  const caller = BrowserWindow.fromWebContents(event.sender);
  if (caller !== mainWindow && !displays.has(caller))
    throw new Error("Not permitted");
  return broadcastDisplayStates();
});
ipcMain.handle("display:control", async (event, options = {}) => {
  const caller = BrowserWindow.fromWebContents(event.sender);
  const isMain = caller === mainWindow;
  if (!isMain && !displays.has(caller)) throw new Error("Not permitted");
  const targetWin = isMain
    ? [...displays].find((w) => w.sudaonKind === options.kind)
    : caller;
  if (!targetWin || targetWin.isDestroyed()) return broadcastDisplayStates();

  if (options.action === "pin") {
    targetWin.sudaonTop = Boolean(options.value);
    targetWin.setAlwaysOnTop(targetWin.sudaonTop, "floating");
    settings.pins ||= {};
    settings.pins[targetWin.sudaonKind] = targetWin.sudaonTop;
    saveSettings();
  }
  if (options.action === "hide") targetWin.hide();
  if (options.action === "lower") {
    targetWin.sudaonTop = false;
    targetWin.setAlwaysOnTop(false);
    settings.pins ||= {};
    settings.pins[targetWin.sudaonKind] = false;
    saveSettings();
    if (process.platform === "win32") {
      const buffer = targetWin.getNativeWindowHandle();
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
    } else targetWin.blur();
  }
  return broadcastDisplayStates();
});
app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  runtime?.close().catch(() => {});
});
app.on("window-all-closed", () => {});
app.on("activate", reveal);
