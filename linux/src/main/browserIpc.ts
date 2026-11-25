import { ipcMain, IpcMainInvokeEvent } from "electron";
import { BrowserManager } from "../browser/browserManager";
import type { BrowserBounds } from "../browser/browserTypes";
import { BrowserSettingsStore } from "../browser/browserSettingsStore";
import { CatalogStore } from "../catalog/catalogStore";
import type { WebsiteProvider } from "../catalog/catalogModel";

type TrustedSender = (event: IpcMainInvokeEvent) => boolean;

function assertTrusted(event: IpcMainInvokeEvent, isTrusted: TrustedSender): void {
  if (!isTrusted(event)) throw new Error("Untrusted renderer attempted to access browser IPC");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid browser request payload");
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string" || !result.trim()) throw new Error("Invalid " + key);
  return result;
}

function stringFieldAllowEmpty(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string") throw new Error("Invalid " + key);
  return result;
}

function boundsField(value: Record<string, unknown>): BrowserBounds {
  const fields = ["x", "y", "width", "height"] as const;
  const bounds = {} as BrowserBounds;
  for (const field of fields) {
    const item = value[field];
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error("Invalid browser viewport bounds");
    }
    bounds[field] = item;
  }
  return bounds;
}

export function registerBrowserIpc(
  manager: BrowserManager,
  catalog: CatalogStore,
  settings: BrowserSettingsStore,
  isTrusted: TrustedSender
): void {
  const guard = (event: IpcMainInvokeEvent) => assertTrusted(event, isTrusted);

  ipcMain.handle("browser:get", (event) => {
    guard(event);
    return manager.getState();
  });

  ipcMain.handle("browser:open-website", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    const providerId = stringField(input, "providerId");
    const provider = catalog.get().providers.find((item) => item.id === providerId);
    if (!provider || provider.type !== "website") {
      throw new Error("A website connection was not found in the catalog");
    }
    return manager.openWebsite(provider as WebsiteProvider);
  });

  ipcMain.handle("browser:activate", (event, payload: unknown) => {
    guard(event);
    return manager.activate(stringField(record(payload), "tabId"));
  });

  ipcMain.handle("browser:close", (event, payload: unknown) => {
    guard(event);
    return manager.close(stringField(record(payload), "tabId"));
  });

  ipcMain.handle("browser:navigate", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    return manager.navigate(stringField(input, "tabId"), stringField(input, "url"));
  });

  ipcMain.handle("browser:back", (event, payload: unknown) => {
    guard(event);
    return manager.back(stringField(record(payload), "tabId"));
  });

  ipcMain.handle("browser:forward", (event, payload: unknown) => {
    guard(event);
    return manager.forward(stringField(record(payload), "tabId"));
  });

  ipcMain.handle("browser:reload", (event, payload: unknown) => {
    guard(event);
    return manager.reload(stringField(record(payload), "tabId"));
  });

  ipcMain.handle("browser:set-viewport", (event, payload: unknown) => {
    guard(event);
    return manager.setViewportBounds(boundsField(record(payload)));
  });

  ipcMain.handle("browser:proxy:get", (event) => {
    guard(event);
    return settings.get().proxyServer;
  });

  ipcMain.handle("browser:proxy:set", async (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    const proxyServer = stringFieldAllowEmpty(input, "proxyServer");
    const previous = settings.get().proxyServer;

    await manager.setProxyServer(proxyServer);
    try {
      const next = await settings.setProxyServer(proxyServer);
      return next.proxyServer;
    } catch (error) {
      await manager.setProxyServer(previous ?? "");
      throw error;
    }
  });
}
