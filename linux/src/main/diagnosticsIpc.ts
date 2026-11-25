import { app, dialog, ipcMain, IpcMainInvokeEvent, shell } from "electron";
import { join } from "node:path";
import type { LogLevel, LoggingSettings } from "../shared/diagnosticsApi";
import { DiagnosticsManager } from "./diagnosticsManager";

type TrustedSender = (event: IpcMainInvokeEvent) => boolean;

function guard(event: IpcMainInvokeEvent, isTrusted: TrustedSender): void {
  if (!isTrusted(event)) throw new Error("Untrusted renderer attempted to access diagnostics IPC");
}

function validateLevel(value: unknown): LogLevel | "all" {
  if (value === undefined || value === "all") return "all";
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  throw new Error("Invalid log level filter");
}

export function registerDiagnosticsIpc(
  manager: DiagnosticsManager,
  isTrusted: TrustedSender
): void {
  ipcMain.handle("diagnostics:status", (event) => {
    guard(event, isTrusted);
    return manager.getStatus();
  });
  ipcMain.handle("diagnostics:settings:get", (event) => {
    guard(event, isTrusted);
    return manager.getSettings();
  });
  ipcMain.handle("diagnostics:settings:update", (event, value: unknown) => {
    guard(event, isTrusted);
    return manager.updateSettings(value as LoggingSettings);
  });
  ipcMain.handle("diagnostics:logs:get", (event, limit: unknown, level: unknown) => {
    guard(event, isTrusted);
    if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit))) {
      throw new Error("Invalid log entry limit");
    }
    return manager.getRecentLogs(limit as number | undefined, validateLevel(level));
  });
  ipcMain.handle("diagnostics:logs:clear", async (event) => {
    guard(event, isTrusted);
    await manager.clearLogs();
  });
  ipcMain.handle("diagnostics:logs:export", async (event) => {
    guard(event, isTrusted);
    const result = await dialog.showSaveDialog({
      title: "Export AIHub Studio logs",
      defaultPath: join(app.getPath("downloads"), "aihub-studio-logs-" + new Date().toISOString().replace(/[:.]/g, "-") + ".log"),
      filters: [{ name: "Log files", extensions: ["log", "txt"] }]
    });
    if (result.canceled || !result.filePath) return null;
    return manager.exportLogs(result.filePath);
  });
  ipcMain.handle("diagnostics:report:collect", async (event) => {
    guard(event, isTrusted);
    const result = await dialog.showSaveDialog({
      title: "Save AIHub Studio diagnostic report",
      defaultPath: join(app.getPath("downloads"), "aihub-studio-diagnostics-" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt"),
      filters: [{ name: "Text reports", extensions: ["txt"] }]
    });
    if (result.canceled || !result.filePath) return null;
    return manager.createDiagnosticReport(result.filePath, {
      appVersion: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      operatingSystem: process.getSystemVersion?.() ?? null,
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      nodeVersion: process.versions.node
    });
  });
  ipcMain.handle("diagnostics:folder:open", async (event) => {
    guard(event, isTrusted);
    const status = await manager.getStatus();
    return shell.openPath(status.directory);
  });
}
