import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  addCategory,
  addLocalApiProvider,
  addWebsiteProvider,
  deleteCategory,
  deleteProvider,
  renameCategory,
  setProviderFavorite,
  setEnabledProviders,
  updateProvider
} from "../catalog/catalogModel";
import { CatalogStore } from "../catalog/catalogStore";
import { CatalogUpdater } from "./catalogUpdater";
import type { AddLocalApiInput, AddWebsiteInput, ProviderUpdate } from "../catalog/catalogModel";

type TrustedSender = (event: IpcMainInvokeEvent) => boolean;

function assertTrusted(event: IpcMainInvokeEvent, isTrusted: TrustedSender): void {
  if (!isTrusted(event)) {
    throw new Error("Untrusted renderer attempted to access catalog IPC");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid catalog request payload");
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string") throw new Error("Invalid " + key);
  return result;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const result = value[key];
  if (result === undefined) return [];
  if (!Array.isArray(result) || result.some((item) => typeof item !== "string")) {
    throw new Error("Invalid " + key);
  }
  return result as string[];
}

export function registerCatalogIpc(store: CatalogStore, updater: CatalogUpdater, isTrusted: TrustedSender): void {
  const guard = (event: IpcMainInvokeEvent) => assertTrusted(event, isTrusted);

  ipcMain.handle("catalog:sync", async (event) => {
    guard(event);
    const report = await updater.sync();
    return { catalog: store.get(), report };
  });

  ipcMain.handle("catalog:get", (event) => {
    guard(event);
    return store.get();
  });

  ipcMain.handle("catalog:category:add", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    return store.transact((current) => addCategory(current, stringField(input, "name")));
  });

  ipcMain.handle("catalog:category:rename", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    return store.transact((current) =>
      renameCategory(current, stringField(input, "id"), stringField(input, "name"))
    );
  });

  ipcMain.handle("catalog:category:delete", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    return store.transact((current) => deleteCategory(current, stringField(input, "id")));
  });

  ipcMain.handle("catalog:provider:add-website", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    const website: AddWebsiteInput = {
      name: stringField(input, "name"),
      url: stringField(input, "url"),
      categoryIds: stringArrayField(input, "categoryIds")
    };
    return store.transact((current) => addWebsiteProvider(current, website));
  });

  ipcMain.handle("catalog:provider:add-local-api", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    const port = input.port;
    if (typeof port !== "number") throw new Error("Invalid port");
    const local: AddLocalApiInput = {
      name: stringField(input, "name"),
      apiType: "openai",
      host: stringField(input, "host"),
      port,
      categoryIds: stringArrayField(input, "categoryIds")
    };
    return store.transact((current) => addLocalApiProvider(current, local));
  });

  ipcMain.handle("catalog:provider:update", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    const id = stringField(input, "id");
    const update = record(input.update);
    const type = stringField(update, "type");

    let providerUpdate: ProviderUpdate;
    if (type === "website") {
      providerUpdate = {
        type: "website",
        name: stringField(update, "name"),
        url: stringField(update, "url"),
        categoryIds: stringArrayField(update, "categoryIds")
      };
    } else if (type === "local-api") {
      const port = update.port;
      if (typeof port !== "number") throw new Error("Invalid port");
      providerUpdate = {
        type: "local-api",
        name: stringField(update, "name"),
        host: stringField(update, "host"),
        port,
        categoryIds: stringArrayField(update, "categoryIds")
      };
    } else {
      throw new Error("Unknown provider type");
    }

    return store.transact((current) => updateProvider(current, id, providerUpdate));
  });

  ipcMain.handle("catalog:provider:delete", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    return store.transact((current) => deleteProvider(current, stringField(input, "id")));
  });

  ipcMain.handle("catalog:provider:favorite", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    if (typeof input.favorite !== "boolean") throw new Error("Invalid favorite flag");
    return store.transact((current) =>
      setProviderFavorite(current, stringField(input, "id"), input.favorite as boolean)
    );
  });

  ipcMain.handle("catalog:providers:enabled", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    return store.transact((current) => setEnabledProviders(current, stringArrayField(input, "providerIds")));
  });
}
