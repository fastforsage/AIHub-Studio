import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => new Map<string, (event: any) => any>());
vi.mock("electron", () => ({ ipcMain: { handle: (name: string, handler: (event: any) => any) => handlers.set(name, handler) } }));
import { forwardMaximizedState, registerWindowIpc } from "../src/main/windowIpc";

describe("custom window controls", () => {
  let maximized: boolean;
  let window: any;
  beforeEach(() => {
    handlers.clear();
    maximized = false;
    window = {
      minimize: vi.fn(), close: vi.fn(),
      maximize: vi.fn(() => { maximized = true; }),
      unmaximize: vi.fn(() => { maximized = false; }),
      isMaximized: vi.fn(() => maximized), isDestroyed: vi.fn(() => false),
      on: vi.fn(), webContents: { send: vi.fn() }
    };
    registerWindowIpc(() => window, (event) => (event as unknown as { trusted: boolean }).trusted === true);
  });
  it("rejects window operations from untrusted renderers", () => {
    for (const handle of handlers.values()) handle({ trusted: false });
    expect(window.minimize).not.toHaveBeenCalled();
    expect(window.maximize).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });
  it("handles minimize, close, and toggles maximization", () => {
    const trusted = { trusted: true };
    handlers.get("window:minimize")!(trusted);
    expect(window.minimize).toHaveBeenCalledOnce();
    expect(handlers.get("window:toggle-maximize")!(trusted)).toBe(true);
    expect(handlers.get("window:is-maximized")!(trusted)).toBe(true);
    expect(handlers.get("window:toggle-maximize")!(trusted)).toBe(false);
    handlers.get("window:close")!(trusted);
    expect(window.close).toHaveBeenCalledOnce();
  });
  it("forwards maximize and restore events without sending to destroyed windows", () => {
    forwardMaximizedState(window);
    const onMaximize = window.on.mock.calls.find(([name]: [string]) => name === "maximize")[1];
    const onRestore = window.on.mock.calls.find(([name]: [string]) => name === "unmaximize")[1];
    maximized = true;
    onMaximize();
    expect(window.webContents.send).toHaveBeenLastCalledWith("window:maximized-changed", true);
    maximized = false;
    onRestore();
    expect(window.webContents.send).toHaveBeenLastCalledWith("window:maximized-changed", false);
    window.isDestroyed.mockReturnValue(true);
    onRestore();
    expect(window.webContents.send).toHaveBeenCalledTimes(2);
  });
});
