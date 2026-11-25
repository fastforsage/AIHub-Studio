import { describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/shared/appPaths";

describe("resolveAppPaths", () => {
  it("uses standard XDG defaults under the supplied home directory", () => {
    expect(resolveAppPaths({}, "/home/tester", "linux")).toEqual({
      config: "/home/tester/.config/AIHubStudio",
      data: "/home/tester/.local/share/AIHubStudio",
      state: "/home/tester/.local/state/AIHubStudio"
    });
  });

  it("honors absolute XDG overrides independently", () => {
    expect(resolveAppPaths({
      XDG_CONFIG_HOME: "/mnt/config",
      XDG_DATA_HOME: "/mnt/data",
      XDG_STATE_HOME: "/mnt/state"
    }, "/home/tester", "linux")).toEqual({
      config: "/mnt/config/AIHubStudio",
      data: "/mnt/data/AIHubStudio",
      state: "/mnt/state/AIHubStudio"
    });
  });

  it("ignores relative XDG values and falls back to defaults", () => {
    expect(resolveAppPaths({
      XDG_CONFIG_HOME: "relative/config",
      XDG_DATA_HOME: "../data",
      XDG_STATE_HOME: ""
    }, "/home/tester", "linux")).toEqual({
      config: "/home/tester/.config/AIHubStudio",
      data: "/home/tester/.local/share/AIHubStudio",
      state: "/home/tester/.local/state/AIHubStudio"
    });
  });

  it("uses roaming config and local data/log directories on Windows", () => {
    expect(resolveAppPaths({
      APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local"
    }, "C:\\Users\\tester", "win32")).toEqual({
      config: "C:\\Users\\tester\\AppData\\Roaming\\AIHubStudio",
      data: "C:\\Users\\tester\\AppData\\Local\\AIHubStudio\\Data",
      state: "C:\\Users\\tester\\AppData\\Local\\AIHubStudio\\Logs"
    });
  });

  it("falls back to the Windows profile when APPDATA variables are absent", () => {
    expect(resolveAppPaths({}, "C:\\Users\\tester", "win32")).toEqual({
      config: "C:\\Users\\tester\\AppData\\Roaming\\AIHubStudio",
      data: "C:\\Users\\tester\\AppData\\Local\\AIHubStudio\\Data",
      state: "C:\\Users\\tester\\AppData\\Local\\AIHubStudio\\Logs"
    });
  });
});
