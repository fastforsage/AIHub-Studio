import { contextBridge, ipcRenderer } from "electron";
import type { CatalogApi } from "../shared/catalogApi";

const catalog: CatalogApi = {
  get: () => ipcRenderer.invoke("catalog:get"),
  addCategory: (name) => ipcRenderer.invoke("catalog:category:add", { name }),
  renameCategory: (id, name) => ipcRenderer.invoke("catalog:category:rename", { id, name }),
  deleteCategory: (id) => ipcRenderer.invoke("catalog:category:delete", { id }),
  addWebsite: (input) => ipcRenderer.invoke("catalog:provider:add-website", input),
  addLocalApi: (input) => ipcRenderer.invoke("catalog:provider:add-local-api", input),
  updateProvider: (id, update) => ipcRenderer.invoke("catalog:provider:update", { id, update }),
  deleteProvider: (id) => ipcRenderer.invoke("catalog:provider:delete", { id }),
  setFavorite: (id, favorite) => ipcRenderer.invoke("catalog:provider:favorite", { id, favorite })
};

contextBridge.exposeInMainWorld("aihub", Object.freeze({
  platform: process.platform,
  version: "0.1.0",
  catalog: Object.freeze(catalog)
}));
