import { randomUUID } from "node:crypto";
import { BrowserWindow, WebContentsView, session } from "electron";
import type { WebsiteProvider } from "../catalog/catalogModel";
import { normalizeBrowserUrl, profilePartition, clampBrowserBounds } from "./browserUtils";
import { normalizeProxyServer, toElectronProxyConfig } from "./proxyConfig";
import type { BrowserBounds, BrowserManagerState, BrowserTabInfo } from "./browserTypes";

interface BrowserTabRecord {
  id: string;
  providerId: string;
  profileId: string;
  title: string;
  url: string;
  loading: boolean;
  error: string | null;
  view: WebContentsView;
}

type WindowAccessor = () => BrowserWindow | null;
type StateListener = (state: BrowserManagerState) => void;

const HIDDEN_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };

export class BrowserManager {
  private readonly tabs = new Map<string, BrowserTabRecord>();
  private readonly configuredPartitions = new Map<string, Promise<void>>();
  private readonly sessionsByPartition = new Map<string, Electron.Session>();
  private proxyServer: string | null = null;
  private activeTabId: string | null = null;
  private viewportBounds: BrowserBounds = HIDDEN_BOUNDS;

  constructor(
    private readonly getWindow: WindowAccessor,
    private readonly onChange: StateListener,
    private readonly log: (level: "info" | "warn" | "error", message: string, metadata?: unknown) => void = () => undefined
  ) {}

  getState(): BrowserManagerState {
    this.pruneUnavailableTabs();
    return {
      tabs: [...this.tabs.values()].map((tab) => this.toInfo(tab)),
      activeTabId: this.activeTabId
    };
  }

  async openWebsite(provider: WebsiteProvider): Promise<BrowserManagerState> {
    const url = normalizeBrowserUrl(provider.url);
    if (!url) throw new Error("Only valid HTTP or HTTPS website addresses can be opened");

    const existing = [...this.tabs.values()].find((tab) => tab.providerId === provider.id);
    if (existing) {
      if (this.getLiveContents(existing)) {
        existing.title = existing.title || provider.name;
        this.activate(existing.id);
        if (existing.url !== url) await this.navigate(existing.id, url);
        return this.getState();
      }
      this.discardTab(existing.id, existing);
    }

    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error("The application window is not available");

    const partition = profilePartition("shared-workspace");
    const browserSession = session.fromPartition(partition);
    await this.configureSession(partition, browserSession);

    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: true
      }
    });

    const tab: BrowserTabRecord = {
      id: randomUUID(),
      providerId: provider.id,
      profileId: provider.profileId,
      title: provider.name,
      url,
      loading: true,
      error: null,
      view
    };

    view.setBackgroundColor("#111318");
    view.setVisible(false);
    view.setBounds(HIDDEN_BOUNDS);
    window.contentView.addChildView(view);
    this.tabs.set(tab.id, tab);
    this.attachEvents(tab);
    this.activate(tab.id);
    this.publish();

    void view.webContents.loadURL(url).catch(() => {
      const current = this.tabs.get(tab.id);
      if (current) {
        current.loading = false;
        current.error = "Page could not be loaded. Check the address and network connection.";
        this.publish();
      }
    });

    return this.getState();
  }

  activate(tabId: string): BrowserManagerState {
    const tab = this.requireTab(tabId);
    if (!tab) return this.getState();
    this.activeTabId = tabId;
    this.updateViews();
    this.publish();
    return this.getState();
  }

  close(tabId: string): BrowserManagerState {
    const tab = this.tabs.get(tabId);
    if (!tab) return this.getState();

    this.discardTab(tabId, tab);
    this.updateViews();
    this.publish();
    return this.getState();
  }

  closeAll(): void {
    for (const [tabId, tab] of [...this.tabs.entries()]) {
      this.discardTab(tabId, tab);
    }
    this.tabs.clear();
    this.activeTabId = null;
    this.viewportBounds = HIDDEN_BOUNDS;
    this.publish();
  }

  async navigate(tabId: string, input: string): Promise<BrowserManagerState> {
    const tab = this.requireTab(tabId);
    if (!tab) return this.getState();
    const contents = this.getLiveContents(tab);
    if (!contents) return this.getState();
    const url = normalizeBrowserUrl(input);
    if (!url) throw new Error("Only HTTP and HTTPS addresses are allowed");

    tab.error = null;
    tab.loading = true;
    this.activeTabId = tabId;
    this.updateViews();
    this.publish();

    try {
      await contents.loadURL(url);
    } catch (reason) {
      const current = this.tabs.get(tabId);
      if (current) {
        current.loading = false;
        const reasonText = reason instanceof Error ? reason.message : "Network request failed";
        current.error = "Navigation failed: " + reasonText.slice(0, 160) + ". Check the address, proxy and network connection.";
        this.publish();
      }
      // A failed website navigation is tab state, not an IPC exception.
      return this.getState();
    }

    return this.getState();
  }

  back(tabId: string): BrowserManagerState {
    const tab = this.requireTab(tabId);
    if (!tab) return this.getState();
    const contents = this.getLiveContents(tab);
    if (contents?.navigationHistory.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    }
    this.publish();
    return this.getState();
  }

  forward(tabId: string): BrowserManagerState {
    const tab = this.requireTab(tabId);
    if (!tab) return this.getState();
    const contents = this.getLiveContents(tab);
    if (contents?.navigationHistory.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    }
    this.publish();
    return this.getState();
  }

  reload(tabId: string): BrowserManagerState {
    const tab = this.requireTab(tabId);
    if (!tab) return this.getState();
    this.getLiveContents(tab)?.reload();
    return this.getState();
  }

  setViewportBounds(requested: BrowserBounds): BrowserManagerState {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      this.viewportBounds = HIDDEN_BOUNDS;
      return this.getState();
    }

    const content = window.getContentBounds();
    this.viewportBounds = clampBrowserBounds(requested, content.width, content.height);
    this.updateViews();
    return this.getState();
  }

  async fetchForAvailability(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const partition = profilePartition("shared-workspace");
    const browserSession = session.fromPartition(partition);
    await this.configureSession(partition, browserSession);
    const url = input instanceof Request ? input.url : input.toString();
    const response = await browserSession.fetch(url, init);
    return response as unknown as Response;
  }


  async translatePage(
    tabId: string,
    translate: (texts: string[], sourceLanguage: string) => Promise<string[]>
  ): Promise<{ translatedNodes: number; sourceLanguage: string; targetLanguage: "ru" }> {
    const startedAt = Date.now();
    const tab = this.requireTab(tabId);
    if (!tab) throw new Error("The browser tab is no longer available");
    const contents = this.getLiveContents(tab);
    if (!contents) throw new Error("The browser tab is no longer available");

    this.log("info", "Page translation DOM scan started", {
      tabId,
      pageHost: (() => { try { return new URL(tab.url).host; } catch { return "unknown"; } })()
    });

    try {
      const snapshot = await contents.executeJavaScriptInIsolatedWorld(999, [{
        code: `(() => {
          const key = "__aihubBergamotTranslationState__";
          const previous = window[key];
          if (previous?.entries) for (const entry of previous.entries) {
            if (entry.node?.isConnected && entry.node.nodeValue === entry.translated) entry.node.nodeValue = entry.original;
          }

          const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
          const entries = [];
          let node;
          while ((node = walker.nextNode()) && entries.length < 500) {
            const parent = node.parentElement;
            if (!parent) continue;
            if (parent.closest("script,style,noscript,textarea,input,select,option,code,pre,kbd,samp,svg,math,canvas,button,[role=button],nav,header,footer,[contenteditable=true],[contenteditable=plaintext-only],[aria-hidden=true],[translate=no]")) continue;
            const style = getComputedStyle(parent);
            if (style.display === "none" || style.visibility === "hidden") continue;
            const original = node.nodeValue || "";
            const trimmed = original.trim();
            if (trimmed.length < 3 || trimmed.length > 1200 || !/[\\p{L}]{2}/u.test(trimmed)) continue;
            entries.push({ node, original, translated: null });
          }

          window[key] = { entries };
          const declared = (document.documentElement.lang || document.body?.getAttribute("lang") || "").trim().toLowerCase();
          const sample = entries.slice(0, 100).map(entry => entry.original).join(" ").slice(0, 12000);
          const count = (pattern) => (sample.match(pattern) || []).length;
          const han = count(/[\\u3400-\\u9fff]/g);
          const kana = count(/[\\u3040-\\u30ff]/g);
          const hangul = count(/[\\uac00-\\ud7af]/g);
          const cyrillic = count(/[\\u0400-\\u052f]/g);
          let detected = "";
          if (kana > 2) detected = "ja";
          else if (hangul > 2) detected = "ko";
          else if (han > 3) detected = "zh";
          else if (cyrillic > 3) detected = "ru";
          const declaredCode = declared.split("-")[0];
          const supportedDeclared = /^[a-z]{2,3}$/.test(declaredCode) ? declaredCode : "";
          const sourceLanguage = detected || supportedDeclared || "en";
          return {
            sourceLanguage,
            languageDetection: detected ? "text-script" : supportedDeclared ? "html-lang-fallback" : "default-en",
            declaredLanguage: declared || null,
            textScriptCounts: { han, kana, hangul, cyrillic },
            texts: entries.map(entry => entry.original)
          };
        })()`
      }]) as {
        sourceLanguage: string;
        languageDetection: string;
        declaredLanguage: string | null;
        textScriptCounts: { han: number; kana: number; hangul: number; cyrillic: number };
        texts: string[];
      };

      this.log("info", "Page translation DOM scan completed", {
        tabId,
        sourceLanguage: snapshot.sourceLanguage,
        languageDetection: snapshot.languageDetection,
        declaredLanguage: snapshot.declaredLanguage,
        textScriptCounts: snapshot.textScriptCounts,
        candidateTextNodes: snapshot.texts.length,
        durationMs: Date.now() - startedAt
      });

      if (!snapshot.texts.length) {
        this.log("warn", "Page translation found no eligible text nodes", { tabId, sourceLanguage: snapshot.sourceLanguage });
        return { translatedNodes: 0, sourceLanguage: snapshot.sourceLanguage, targetLanguage: "ru" };
      }

      const translateStartedAt = Date.now();
      const translated = await translate(snapshot.texts, snapshot.sourceLanguage);
      if (translated.length !== snapshot.texts.length) throw new Error("Bergamot returned an unexpected translation count");

      const encoded = JSON.stringify(translated);
      const applied = await contents.executeJavaScriptInIsolatedWorld(999, [{
        code: `(() => {
          const state = window["__aihubBergamotTranslationState__"];
          if (!state?.entries) return 0;
          const values = ${encoded};
          let count = 0;
          state.entries.forEach((entry, index) => {
            const value = values[index];
            if (entry.node?.isConnected && entry.node.nodeValue === entry.original && typeof value === "string" && value.trim()) {
              entry.node.nodeValue = value;
              entry.translated = value;
              count++;
            }
          });
          return count;
        })()`
      }]) as number;

      this.log("info", "Page translation applied", {
        tabId,
        sourceLanguage: snapshot.sourceLanguage,
        languageDetection: snapshot.languageDetection,
        candidateTextNodes: snapshot.texts.length,
        translatedNodes: applied,
        translateDurationMs: Date.now() - translateStartedAt,
        durationMs: Date.now() - startedAt
      });
      if (applied === 0) this.log("warn", "Translation completed but no DOM nodes were updated; page may have re-rendered", { tabId });
      return { translatedNodes: applied, sourceLanguage: snapshot.sourceLanguage, targetLanguage: "ru" };
    } catch (error) {
      this.log("error", "Page translation failed", {
        tabId,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
      });
      throw error;
    }
  }

  async restoreOriginalPage(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    const contents = tab ? this.getLiveContents(tab) : null;
    if (!contents) throw new Error("The browser tab is no longer available");
    await contents.executeJavaScriptInIsolatedWorld(999, [{
      code: `(() => {
        const state = window["__aihubBergamotTranslationState__"];
        if (!state?.entries) return;
        for (const entry of state.entries) {
          if (entry.node?.isConnected && entry.node.nodeValue === entry.translated) entry.node.nodeValue = entry.original;
        }
        delete window["__aihubBergamotTranslationState__"];
      })()`
    }]);
  }

  getProxyServer(): string | null {
    return this.proxyServer;
  }

  async setProxyServer(input: string): Promise<string | null> {
    const normalized = normalizeProxyServer(input);
    if (input.trim() && !normalized) {
      throw new Error("Proxy must be an HTTP, HTTPS, SOCKS4 or SOCKS5 address without credentials or a path");
    }

    const previous = this.proxyServer;
    this.proxyServer = normalized;
    try {
      for (const browserSession of this.sessionsByPartition.values()) {
        await browserSession.setProxy(toElectronProxyConfig(normalized));
        await browserSession.closeAllConnections();
      }
    } catch {
      this.proxyServer = previous;
      await Promise.allSettled([...this.sessionsByPartition.values()].map(async (browserSession) => {
        await browserSession.setProxy(toElectronProxyConfig(previous));
        await browserSession.closeAllConnections();
      }));
      throw new Error("The proxy could not be applied to all browser profiles");
    }

    return this.proxyServer;
  }

  private async configureSession(partition: string, browserSession: Electron.Session): Promise<void> {
    const existing = this.configuredPartitions.get(partition);
    if (existing) {
      await existing;
      return;
    }

    const configuration = (async () => {
      // Browser permissions are deny-by-default until an explicit permission UI is designed.
      browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      browserSession.setPermissionCheckHandler(() => false);
      this.sessionsByPartition.set(partition, browserSession);
      await browserSession.setProxy(toElectronProxyConfig(this.proxyServer));
    })();

    this.configuredPartitions.set(partition, configuration);
    try {
      await configuration;
    } catch (error) {
      this.configuredPartitions.delete(partition);
      this.sessionsByPartition.delete(partition);
      throw error;
    }
  }

  private attachEvents(tab: BrowserTabRecord): void {
    const contents = tab.view.webContents;

    contents.setWindowOpenHandler(({ url }) => {
      // Treat safe target=_blank links and OAuth redirects as navigation in the same tab.
      const safeUrl = normalizeBrowserUrl(url);
      if (safeUrl) {
        queueMicrotask(() => {
          if (this.tabs.has(tab.id)) {
            void this.navigate(tab.id, safeUrl).catch(() => undefined);
          }
        });
      }
      return { action: "deny" };
    });

    const guardNavigation = (event: Electron.Event, url: string) => {
      if (!normalizeBrowserUrl(url)) event.preventDefault();
    };
    contents.on("will-navigate", guardNavigation);
    contents.on("will-redirect", guardNavigation);

    contents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      tab.title = title.trim().slice(0, 200) || tab.title;
      this.publish();
    });

    contents.on("did-navigate", (_event, url) => {
      tab.url = normalizeBrowserUrl(url) ?? tab.url;
      tab.loading = false;
      tab.error = null;
      this.publish();
    });

    contents.on("did-navigate-in-page", (_event, url) => {
      tab.url = normalizeBrowserUrl(url) ?? tab.url;
      this.publish();
    });

    contents.on("did-start-loading", () => {
      tab.loading = true;
      this.publish();
    });

    contents.on("did-stop-loading", () => {
      tab.loading = false;
      this.publish();
    });

    contents.on("did-fail-load", (_event, errorCode, description, _validatedUrl, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        tab.loading = false;
        const detail = typeof description === "string" ? description.trim().slice(0, 140) : "";
        tab.error = "Page failed to load (" + errorCode + ")" +
          (detail ? ": " + detail : "") + ". Check the address, proxy and network connection.";
        this.publish();
      }
    });

    contents.on("render-process-gone", () => {
      tab.loading = false;
      tab.error = "The page process stopped unexpectedly. Reload this tab.";
      this.publish();
    });
  }

  private updateViews(): void {
    this.pruneUnavailableTabs();
    for (const [tabId, tab] of [...this.tabs.entries()]) {
      const active = tabId === this.activeTabId &&
        this.viewportBounds.width > 0 &&
        this.viewportBounds.height > 0;
      try {
        tab.view.setVisible(active);
        tab.view.setBounds(active ? this.viewportBounds : HIDDEN_BOUNDS);
      } catch {
        this.discardTab(tabId, tab);
      }
    }
    if (this.activeTabId && !this.tabs.has(this.activeTabId)) {
      this.activeTabId = [...this.tabs.keys()].at(-1) ?? null;
    }
  }

  private getLiveContents(tab: BrowserTabRecord): Electron.WebContents | null {
    try {
      const contents = tab.view?.webContents;
      if (!contents || contents.isDestroyed()) return null;
      return contents;
    } catch {
      return null;
    }
  }

  private discardTab(tabId: string, tab: BrowserTabRecord): void {
    this.tabs.delete(tabId);
    const window = this.getWindow();
    if (window && !window.isDestroyed()) {
      try {
        window.contentView.removeChildView(tab.view);
      } catch {
        // A stale view may already have been detached by Chromium.
      }
    }

    const contents = this.getLiveContents(tab);
    if (contents) {
      try {
        contents.close();
      } catch {
        // The web contents may have been torn down between the liveness check and close.
      }
    }

    if (this.activeTabId === tabId) {
      this.activeTabId = [...this.tabs.keys()].at(-1) ?? null;
    }
  }

  private pruneUnavailableTabs(): void {
    for (const [tabId, tab] of [...this.tabs.entries()]) {
      if (!this.getLiveContents(tab)) this.discardTab(tabId, tab);
    }
    if (this.activeTabId && !this.tabs.has(this.activeTabId)) {
      this.activeTabId = [...this.tabs.keys()].at(-1) ?? null;
    }
  }

  private requireTab(tabId: string): BrowserTabRecord | null {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;
    if (!this.getLiveContents(tab)) {
      this.discardTab(tabId, tab);
      this.updateViews();
      this.publish();
      return null;
    }
    return tab;
  }

  private toInfo(tab: BrowserTabRecord): BrowserTabInfo {
    const contents = this.getLiveContents(tab);
    if (!contents) {
      return {
        id: tab.id,
        providerId: tab.providerId,
        title: tab.title,
        url: tab.url,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: tab.error ?? "Browser tab is no longer available. Reopen it from the AI catalog."
      };
    }

    try {
      return {
        id: tab.id,
        providerId: tab.providerId,
        title: tab.title,
        url: tab.url,
        loading: tab.loading,
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        error: tab.error
      };
    } catch {
      return {
        id: tab.id,
        providerId: tab.providerId,
        title: tab.title,
        url: tab.url,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: "Browser tab state could not be read. Reopen it from the AI catalog."
      };
    }
  }

  private publish(): void {
    this.onChange(this.getState());
  }
}
