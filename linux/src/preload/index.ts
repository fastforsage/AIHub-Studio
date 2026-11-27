import { contextBridge, ipcRenderer } from "electron";
import type { BrowserApi } from "../shared/browserApi";
import type { CatalogApi } from "../shared/catalogApi";
import type { LocalAiApi } from "../shared/localAiApi";
import type { DiagnosticsApi } from "../shared/diagnosticsApi";
import type { ServiceAvailabilityApi } from "../shared/availabilityApi";
import type { WindowApi } from "../shared/windowApi";

const catalog: CatalogApi = {
  sync: async () => ipcRenderer.invoke("catalog:sync"),
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

const diagnostics: DiagnosticsApi = {
  writeLog: (level, scope, message) => ipcRenderer.invoke("diagnostics:log:write", { level, scope, message }),
  getStatus: () => ipcRenderer.invoke("diagnostics:status"),
  getSettings: () => ipcRenderer.invoke("diagnostics:settings:get"),
  updateSettings: (settings) => ipcRenderer.invoke("diagnostics:settings:update", settings),
  getRecentLogs: (limit, level) => ipcRenderer.invoke("diagnostics:logs:get", limit, level),
  clearLogs: () => ipcRenderer.invoke("diagnostics:logs:clear"),
  exportLogs: () => ipcRenderer.invoke("diagnostics:logs:export"),
  collectReport: () => ipcRenderer.invoke("diagnostics:report:collect"),
  openLogDirectory: () => ipcRenderer.invoke("diagnostics:folder:open")
};

const availability: ServiceAvailabilityApi = {
  checkCatalog: () => ipcRenderer.invoke("availability:check-catalog")
};

const windowControls: WindowApi = {
  minimize: async () => { await ipcRenderer.invoke("window:minimize"); },
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  close: async () => { await ipcRenderer.invoke("window:close"); },
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizedChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => listener(isMaximized);
    ipcRenderer.on("window:maximized-changed", handler);
    return () => ipcRenderer.removeListener("window:maximized-changed", handler);
  }
};

contextBridge.exposeInMainWorld("aihub", Object.freeze({
  platform: process.platform,
  version: "0.1.12",
  catalog: Object.freeze(catalog),
  browser: Object.freeze(browser),
  localAi: Object.freeze(localAi),
  diagnostics: Object.freeze(diagnostics),
  availability: Object.freeze(availability),
  windowControls: Object.freeze(windowControls)
}));
