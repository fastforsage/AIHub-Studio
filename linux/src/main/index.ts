import { app, BrowserWindow, IpcMainInvokeEvent } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveAppPaths } from "../shared/appPaths";
import { CatalogStore } from "../catalog/catalogStore";
import { registerCatalogIpc } from "./catalogIpc";

const paths = resolveAppPaths(process.env);
const sessionDataPath = join(paths.data, "sessions");

for (const directory of [paths.config, paths.data, paths.state, sessionDataPath]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

app.setName("AIHub Studio");
app.setPath("userData", paths.config);
app.setPath("sessionData", sessionDataPath);

let mainWindow: BrowserWindow | null = null;

function isTrustedRenderer(event: IpcMainInvokeEvent): boolean {
  return mainWindow !== null &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === event.sender.mainFrame;
}

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

  mainWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const loadResult = rendererUrl
    ? window.loadURL(rendererUrl)
    : window.loadFile(join(__dirname, "../renderer/index.html"));

  void loadResult.catch((error: unknown) => {
    console.error("Failed to load AIHub Studio renderer:", error);
  });

  return window;
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const catalogStore = new CatalogStore(join(paths.config, "catalog.json"));
  await catalogStore.initialize();
  registerCatalogIpc(catalogStore, isTrustedRenderer);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("AIHub Studio startup failed:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  app.quit();
});
