import { app, BrowserWindow, IpcMainInvokeEvent, Menu } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BrowserManager } from "../browser/browserManager";
import { BrowserSettingsStore } from "../browser/browserSettingsStore";
import { LocalAiManager } from "../local-ai/localAiManager";
import { CatalogStore } from "../catalog/catalogStore";
import { resolveAppPaths } from "../shared/appPaths";
import { registerBrowserIpc } from "./browserIpc";
import { registerCatalogIpc } from "./catalogIpc";
import { registerLocalAiIpc } from "./localAiIpc";
import { removeNativeApplicationMenu } from "./nativeMenu";
import { DiagnosticsManager } from "./diagnosticsManager";
import { registerDiagnosticsIpc } from "./diagnosticsIpc";
import { ServiceAvailabilityManager } from "./serviceAvailabilityManager";
import { registerServiceAvailabilityIpc } from "./serviceAvailabilityIpc";

const isLinuxWayland =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE?.toLocaleLowerCase() === "wayland" || Boolean(process.env.WAYLAND_DISPLAY));

if (isLinuxWayland) {
  // Some KDE/KWin Wayland compositors do not expose the color-management
  // protocol features expected by this Chromium build.
  app.commandLine.appendSwitch("disable-features", "WaylandWpColorManagerV1");
  // Keep Chromium's compositor/GTK debug noise out of the user's terminal.
  // App-level failures remain available in AIHub Studio's Diagnostics viewer.
  app.commandLine.appendSwitch("log-level", "3");
}

const paths = resolveAppPaths(process.env);
const sessionDataPath = join(paths.data, "sessions");

for (const directory of [paths.config, paths.data, paths.state, sessionDataPath]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

app.setName("AIHub Studio");
app.setPath("userData", paths.config);
app.setPath("sessionData", sessionDataPath);

let mainWindow: BrowserWindow | null = null;
let browserManager: BrowserManager | null = null;
let diagnosticsManager: DiagnosticsManager | null = null;

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
    title: `AIHub Studio v${app.getVersion()}`,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  removeNativeApplicationMenu(Menu, window);
  mainWindow = window;
  window.webContents.on("render-process-gone", (_event, details) => {
    diagnosticsManager?.log("error", "renderer", "Renderer process terminated", {
      reason: details.reason,
      exitCode: details.exitCode
    });
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      diagnosticsManager?.log("error", "renderer", "Main frame failed to load", {
        errorCode,
        errorDescription,
        url: validatedURL
      });
    }
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    browserManager?.closeAll();
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

  diagnosticsManager = new DiagnosticsManager(
    join(paths.state, "logs"),
    join(paths.config, "logging-settings.json")
  );
  await diagnosticsManager.initialize();
  diagnosticsManager.installConsoleCapture();
  diagnosticsManager.log("info", "app", "Application startup", {
    version: app.getVersion(),
    platform: process.platform,
    architecture: process.arch
  });

  const catalogStore = new CatalogStore(join(paths.config, "catalog.json"));
  const browserSettings = new BrowserSettingsStore(join(paths.config, "browser-settings.json"));
  await catalogStore.initialize();
  const initialBrowserSettings = await browserSettings.initialize();

  browserManager = new BrowserManager(
    () => mainWindow,
    (state) => {
      const target = mainWindow;
      if (target && !target.isDestroyed()) target.webContents.send("browser:changed", state);
    }
  );

  await browserManager.setProxyServer(initialBrowserSettings.proxyServer ?? "");

  registerCatalogIpc(catalogStore, isTrustedRenderer);
  registerBrowserIpc(browserManager, catalogStore, browserSettings, isTrustedRenderer);
  registerLocalAiIpc(new LocalAiManager(), catalogStore, isTrustedRenderer);
  registerDiagnosticsIpc(diagnosticsManager, isTrustedRenderer);
  registerServiceAvailabilityIpc(new ServiceAvailabilityManager(() => catalogStore.get().providers, (input, init) => browserManager!.fetchForAvailability(input, init)), isTrustedRenderer);
  createMainWindow();
}

void bootstrap().catch((error: unknown) => {
  diagnosticsManager?.log("error", "app", "Application startup failed", error);
  console.error("AIHub Studio startup failed:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  app.quit();
});
