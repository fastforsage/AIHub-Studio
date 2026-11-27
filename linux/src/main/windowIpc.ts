import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

export type WindowIpcTrustCheck = (event: IpcMainInvokeEvent) => boolean;

/**
 * Registers IPC handlers for the custom (frameless) window chrome:
 * minimize / toggle-maximize / close / is-maximized. The renderer draws its
 * own dark title bar and calls these instead of relying on OS decorations.
 */
export function registerWindowIpc(
  getWindow: () => BrowserWindow | null,
  isTrustedRenderer: WindowIpcTrustCheck
): void {
  ipcMain.handle("window:minimize", (event) => {
    if (!isTrustedRenderer(event)) return;
    getWindow()?.minimize();
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    if (!isTrustedRenderer(event)) return false;
    const window = getWindow();
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });

  ipcMain.handle("window:close", (event) => {
    if (!isTrustedRenderer(event)) return;
    getWindow()?.close();
  });

  ipcMain.handle("window:is-maximized", (event) => {
    if (!isTrustedRenderer(event)) return false;
    return getWindow()?.isMaximized() ?? false;
  });
}

/**
 * Forwards maximize/unmaximize transitions to the renderer so the custom
 * title bar can swap its maximize/restore glyph.
 */
export function forwardMaximizedState(window: BrowserWindow): void {
  const send = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send("window:maximized-changed", window.isMaximized());
    }
  };
  window.on("maximize", send);
  window.on("unmaximize", send);
}
