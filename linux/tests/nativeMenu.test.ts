import { describe, expect, it, vi } from "vitest";
import { removeNativeApplicationMenu } from "../src/main/nativeMenu";

describe("removeNativeApplicationMenu", () => {
  it("clears the application menu and removes the window menu bar", () => {
    const calls: string[] = [];
    const applicationMenu = {
      setApplicationMenu: vi.fn((menu: null) => {
        expect(menu).toBeNull();
        calls.push("application");
      })
    };
    const window = {
      removeMenu: vi.fn(() => calls.push("window"))
    };

    removeNativeApplicationMenu(applicationMenu, window);

    expect(applicationMenu.setApplicationMenu).toHaveBeenCalledOnce();
    expect(window.removeMenu).toHaveBeenCalledOnce();
    expect(calls).toEqual(["application", "window"]);
  });
});
