import { contextBridge, ipcRenderer } from "electron";
import type { BrowserApi } from "../shared/browserApi";
import type { CatalogApi } from "../shared/catalogApi";
import type { LocalAiApi } from "../shared/localAiApi";

const catalog: CatalogApi = {
  get: () => ipcRenderer.invoke("catalog:get"),
  addCategory: (name) => ipcRenderer.invoke("catalog:category:add", { name }),
  renameCategory: (id, name) => ipcRenderer.invoke("catalog:category:rename", { id, name }),
  deleteCategory: (id) => ipcRenderer.invoke("catalog:category:delete", { id }),
  addWebsite: (input) => ipcRenderer.invoke("catalog:provider:add-website", input),
  addLocalApi: (input) => ipcRenderer.invoke("catalog:provider:add-local-api", input),
  updateProvider: (id, update) => ipcRenderer.invoke("catalog:provider:update", { id, update }),
  deleteProvider: (id) => ipcRenderer.invoke("catalog:provider:delete", { id }),
  setFavorite: (id, favorite) => ipcRenderer.invoke("catalog:provider:favorite", { id, favorite }),
  setEnabledProviders: (providerIds) => ipcRenderer.invoke("catalog:providers:enabled", { providerIds })
};

const browser: BrowserApi = {
  get: () => ipcRenderer.invoke("browser:get"),
  openWebsite: (providerId) => ipcRenderer.invoke("browser:open-website", { providerId }),
  activate: (tabId) => ipcRenderer.invoke("browser:activate", { tabId }),
  close: (tabId) => ipcRenderer.invoke("browser:close", { tabId }),
  navigate: (tabId, url) => ipcRenderer.invoke("browser:navigate", { tabId, url }),
  back: (tabId) => ipcRenderer.invoke("browser:back", { tabId }),
  forward: (tabId) => ipcRenderer.invoke("browser:forward", { tabId }),
  reload: (tabId) => ipcRenderer.invoke("browser:reload", { tabId }),
  setViewportBounds: (bounds) => ipcRenderer.invoke("browser:set-viewport", bounds),
  getProxyServer: () => ipcRenderer.invoke("browser:proxy:get"),
  setProxyServer: (proxyServer) => ipcRenderer.invoke("browser:proxy:set", { proxyServer }),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
    ipcRenderer.on("browser:changed", handler);
    return () => ipcRenderer.removeListener("browser:changed", handler);
  }
};

const localAi: LocalAiApi = {
  discoverModels: (providerId) => ipcRenderer.invoke("local-ai:discover-models", { providerId }),
  selectModel: (providerId, modelId) => ipcRenderer.invoke("local-ai:select-model", { providerId, modelId }),
  completeChat: (providerId, messages) => ipcRenderer.invoke("local-ai:complete-chat", { providerId, messages })
};

contextBridge.exposeInMainWorld("aihub", Object.freeze({
  platform: process.platform,
  version: "0.1.5",
  catalog: Object.freeze(catalog),
  browser: Object.freeze(browser),
  localAi: Object.freeze(localAi)
}));
