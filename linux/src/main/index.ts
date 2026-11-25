import { app, BrowserWindow } from "electron";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveAppPaths } from "../shared/appPaths";

const paths = resolveAppPaths(process.env, homedir());
const sessionDataPath = join(paths.data, "sessions");

for (const directory of [paths.config, paths.data, paths.state, sessionDataPath]) {
  mkdirSync(directory, { recursive: true });
}

app.setName("AIHub Studio");
app.setPath("userData", paths.config);
app.setPath("sessionData", sessionDataPath);

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 680,
    show: false,
    backgroundColor: "#111318",
    title: "AIHub Studio",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.once("ready-to-show", () => window.show());

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const loadResult = rendererUrl
    ? window.loadURL(rendererUrl)
    : window.loadFile(join(__dirname, "../renderer/index.html"));

  void loadResult.catch((error: unknown) => {
    console.error("Failed to load AIHub Studio renderer:", error);
  });

  return window;
}

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}).catch((error: unknown) => {
  console.error("AIHub Studio startup failed:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  app.quit();
});
