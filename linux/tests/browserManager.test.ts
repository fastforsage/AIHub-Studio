import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    views: [] as any[],
    partitions: [] as string[],
    sessions: new Map<string, any>(),
    parent: null as any
  };

  class FakeWebContents {
    destroyed = false;
    handlers = new Map<string, Array<(...args: any[]) => void>>();
    currentUrl = "";
    windowOpenHandler: ((details: { url: string }) => { action: "deny" | "allow" }) | null = null;
    navigationHistory = {
      canGoBack: vi.fn(() => false),
      goBack: vi.fn(),
      canGoForward: vi.fn(() => false),
      goForward: vi.fn()
    };

    on(event: string, handler: (...args: any[]) => void) {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    emit(event: string, ...args: any[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }

    setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" | "allow" }) {
      this.windowOpenHandler = handler;
    }

    loadURL = vi.fn(async (url: string) => {
      this.currentUrl = url;
      this.emit("did-navigate", {}, url);
    });

    reload = vi.fn();
    close = vi.fn(() => { this.destroyed = true; });
    isDestroyed = vi.fn(() => this.destroyed);
  }

  class FakeWebContentsView {
    options: any;
    visible = false;
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    webContents = new FakeWebContents();
    constructor(options: any) {
      this.options = options;
      state.views.push(this);
    }
    setBackgroundColor = vi.fn();
    setVisible = vi.fn((visible: boolean) => { this.visible = visible; });
    setBounds = vi.fn((bounds: any) => { this.bounds = bounds; });
  }

  class FakeBrowserWindow {
    destroyed = false;
    added: any[] = [];
    removed: any[] = [];
    contentView = {
      addChildView: (view: any) => this.added.push(view),
      removeChildView: (view: any) => this.removed.push(view)
    };
    isDestroyed = vi.fn(() => this.destroyed);
    getContentBounds = vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 900 }));
  }

  const session = {
    fromPartition: vi.fn((partition: string) => {
      state.partitions.push(partition);
      if (!state.sessions.has(partition)) {
        state.sessions.set(partition, {
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          setProxy: vi.fn(async () => undefined),
          closeAllConnections: vi.fn(async () => undefined)
        });
      }
      return state.sessions.get(partition);
    })
  };

  return { state, FakeWebContentsView, FakeBrowserWindow, session };
});

vi.mock("electron", () => ({
  BrowserWindow: mocks.FakeBrowserWindow,
  WebContentsView: mocks.FakeWebContentsView,
  session: mocks.session
}));

import { BrowserManager } from "../src/browser/browserManager";
import type { WebsiteProvider } from "../src/catalog/catalogModel";

function website(id: string, profileId = id): WebsiteProvider {
  return {
    id,
    profileId,
    name: "Site " + id,
    type: "website",
    url: "https://example.com/" + id,
    categoryIds: ["ai"],
    favorite: false,
    enabled: true
  };
}

describe("BrowserManager", () => {
  let parent: InstanceType<typeof mocks.FakeBrowserWindow>;
  let changes: any[];
  let manager: BrowserManager;

  beforeEach(() => {
    mocks.state.views.length = 0;
    mocks.state.partitions.length = 0;
    mocks.state.sessions.clear();
    parent = new mocks.FakeBrowserWindow();
    mocks.state.parent = parent;
    changes = [];
    manager = new BrowserManager(() => parent as any, (state) => changes.push(state));
  });

  it("opens a website inside a hardened Chromium view", async () => {
    const state = await manager.openWebsite(website("chatgpt"));
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].url).toBe("https://example.com/chatgpt");
    expect(parent.added).toHaveLength(1);

    const view = mocks.state.views[0];
    expect(view.options.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    });
    expect(view.webContents.loadURL).toHaveBeenCalledWith("https://example.com/chatgpt");
  });

  it("applies system proxy mode before loading a new profile", async () => {
    await manager.openWebsite(website("site-a"));
    const browserSession = [...mocks.state.sessions.values()][0];
    expect(browserSession.setProxy).toHaveBeenCalledWith({ mode: "system" });
    expect(browserSession.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(browserSession.setPermissionCheckHandler).toHaveBeenCalledOnce();
  });

  it("applies proxy changes to existing sessions and closes pooled connections", async () => {
    await manager.openWebsite(website("site-a"));
    const browserSession = [...mocks.state.sessions.values()][0];

    const configured = await manager.setProxyServer("127.0.0.1:8080");
    expect(configured).toBe("http://127.0.0.1:8080");
    expect(browserSession.setProxy).toHaveBeenLastCalledWith({
      mode: "fixed_servers",
      proxyRules: "http://127.0.0.1:8080"
    });
    expect(browserSession.closeAllConnections).toHaveBeenCalledOnce();

    await manager.setProxyServer("");
    expect(manager.getProxyServer()).toBeNull();
    expect(browserSession.setProxy).toHaveBeenLastCalledWith({ mode: "system" });
    expect(browserSession.closeAllConnections).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid proxy values without replacing the active proxy", async () => {
    await manager.setProxyServer("http://127.0.0.1:8080");
    await expect(manager.setProxyServer("http://user:secret@proxy:8080"))
      .rejects.toThrow("without credentials");
    expect(manager.getProxyServer()).toBe("http://127.0.0.1:8080");
  });

  it("uses a stable persistent session per profile", async () => {
    await manager.openWebsite(website("site-a", "shared-profile"));
    await manager.openWebsite(website("site-b", "shared-profile"));

    expect(mocks.state.partitions[0]).toMatch(/^persist:aihub-/);
    expect(mocks.state.partitions[0]).toBe(mocks.state.partitions[1]);
    expect(mocks.state.sessions.size).toBe(1);
  });

  it("shares one persistent browser session across website tabs", async () => {
    await manager.openWebsite(website("site-a", "legacy-profile-a"));
    await manager.openWebsite(website("site-b", "legacy-profile-b"));
    expect(mocks.state.partitions[0]).toMatch(/^persist:aihub-/);
    expect(mocks.state.partitions[0]).toBe(mocks.state.partitions[1]);
    expect(mocks.state.sessions.size).toBe(1);
  });

  it("reuses the existing tab when the same provider is opened twice", async () => {
    await manager.openWebsite(website("site-a"));
    const firstTabId = manager.getState().tabs[0].id;
    await manager.openWebsite(website("site-a"));

    expect(manager.getState().tabs).toHaveLength(1);
    expect(manager.getState().activeTabId).toBe(firstTabId);
    expect(mocks.state.views).toHaveLength(1);
  });

  it("reuses the existing tab and navigates it when a provider URL is edited", async () => {
    const first = await manager.openWebsite(website("site-a"));
    const firstTabId = first.tabs[0].id;
    const view = mocks.state.views[0];
    const updatedProvider = { ...website("site-a"), url: "https://updated.example.com/path" };

    const updated = await manager.openWebsite(updatedProvider);

    expect(updated.tabs).toHaveLength(1);
    expect(updated.activeTabId).toBe(firstTabId);
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith("https://updated.example.com/path");
    expect(mocks.state.views).toHaveLength(1);
  });

  it("prunes a stale WebContentsView whose webContents has disappeared", async () => {
    await manager.openWebsite(website("site-a"));
    const view = mocks.state.views[0];
    view.webContents = undefined;

    expect(() => manager.getState()).not.toThrow();
    expect(manager.getState()).toEqual({ tabs: [], activeTabId: null });
    expect(parent.removed).toContain(view);
  });

  it("recreates a provider tab if its previous Chromium contents were destroyed", async () => {
    await manager.openWebsite(website("site-a"));
    const staleView = mocks.state.views[0];
    staleView.webContents = undefined;

    const next = await manager.openWebsite(website("site-a"));

    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0].url).toBe("https://example.com/site-a");
    expect(mocks.state.views).toHaveLength(2);
    expect(parent.removed).toContain(staleView);
  });

  it("ignores stale tab activation and cleans up its detached Chromium view", async () => {
    await manager.openWebsite(website("site-a"));
    const tabId = manager.getState().tabs[0].id;
    const staleView = mocks.state.views[0];
    staleView.webContents = undefined;

    expect(() => manager.activate(tabId)).not.toThrow();
    expect(manager.getState()).toEqual({ tabs: [], activeTabId: null });
    expect(parent.removed).toContain(staleView);
  });

  it("keeps a tab hidden until a non-zero viewport is supplied", async () => {
    await manager.openWebsite(website("site-a"));
    const view = mocks.state.views[0];

    expect(view.visible).toBe(false);
    manager.setViewportBounds({ x: 20, y: 30, width: 500, height: 400 });

    expect(view.visible).toBe(true);
    expect(view.bounds).toEqual({ x: 20, y: 30, width: 500, height: 400 });

    manager.setViewportBounds({ x: 0, y: 0, width: 0, height: 0 });
    expect(view.visible).toBe(false);
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("switches active tabs and hides inactive views", async () => {
    await manager.openWebsite(website("site-a"));
    const firstId = manager.getState().tabs[0].id;
    await manager.openWebsite(website("site-b"));
    const secondId = manager.getState().tabs[1].id;
    manager.setViewportBounds({ x: 0, y: 0, width: 700, height: 500 });

    expect(mocks.state.views[0].visible).toBe(false);
    expect(mocks.state.views[1].visible).toBe(true);

    manager.activate(firstId);
    expect(manager.getState().activeTabId).toBe(firstId);
    expect(mocks.state.views[0].visible).toBe(true);
    expect(mocks.state.views[1].visible).toBe(false);
    expect(manager.getState().tabs.map((tab) => tab.id)).toContain(secondId);
  });

  it("closes a tab and activates the most recently opened remaining tab", async () => {
    await manager.openWebsite(website("site-a"));
    const firstId = manager.getState().tabs[0].id;
    await manager.openWebsite(website("site-b"));
    const secondId = manager.getState().tabs[1].id;

    const next = manager.close(secondId);
    expect(next.tabs).toHaveLength(1);
    expect(next.activeTabId).toBe(firstId);
    expect(parent.removed).toHaveLength(1);
    expect(mocks.state.views[1].webContents.close).toHaveBeenCalledOnce();
  });

  it("rejects unsafe navigation protocols", async () => {
    await manager.openWebsite(website("site-a"));
    const tabId = manager.getState().tabs[0].id;

    await expect(manager.navigate(tabId, "javascript:alert(1)"))
      .rejects.toThrow("Only HTTP and HTTPS");
    expect(mocks.state.views[0].webContents.loadURL).toHaveBeenCalledTimes(1);
  });

  it("navigates back and forward using Chromium navigation history", async () => {
    await manager.openWebsite(website("site-a"));
    const tabId = manager.getState().tabs[0].id;
    const contents = mocks.state.views[0].webContents;
    contents.navigationHistory.canGoBack.mockReturnValue(true);
    contents.navigationHistory.canGoForward.mockReturnValue(true);

    manager.back(tabId);
    manager.forward(tabId);

    expect(contents.navigationHistory.goBack).toHaveBeenCalledOnce();
    expect(contents.navigationHistory.goForward).toHaveBeenCalledOnce();
  });

  it("denies non-HTTP(S) popup URLs and redirects HTTP(S) popups into the same tab", async () => {
    await manager.openWebsite(website("site-a"));
    const tabId = manager.getState().tabs[0].id;
    const contents = mocks.state.views[0].webContents;

    expect(contents.windowOpenHandler?.({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(contents.windowOpenHandler?.({ url: "https://login.example.com/oauth" })).toEqual({ action: "deny" });
    await Promise.resolve();
    expect(contents.loadURL).toHaveBeenLastCalledWith("https://login.example.com/oauth");
    expect(manager.getState().activeTabId).toBe(tabId);
  });

  it("closes all tabs safely after the parent window has been destroyed", async () => {
    await manager.openWebsite(website("site-a"));
    await manager.openWebsite(website("site-b"));
    parent.destroyed = true;

    expect(() => manager.closeAll()).not.toThrow();
    expect(manager.getState()).toEqual({ tabs: [], activeTabId: null });
    expect(parent.removed).toHaveLength(0);
    expect(mocks.state.views.every((view) => view.webContents.close.mock.calls.length === 1)).toBe(true);
  });

  it("publishes updated tab state for renderer subscribers", async () => {
    await manager.openWebsite(website("site-a"));
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.at(-1).tabs).toHaveLength(1);
  });
});
