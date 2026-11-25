import { describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/shared/appPaths";

describe("resolveAppPaths", () => {
  it("uses standard XDG defaults under the supplied home directory", () => {
    expect(resolveAppPaths({}, "/home/tester")).toEqual({
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
    }, "/home/tester")).toEqual({
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
    }, "/home/tester")).toEqual({
      config: "/home/tester/.config/AIHubStudio",
      data: "/home/tester/.local/share/AIHubStudio",
      state: "/home/tester/.local/state/AIHubStudio"
    });
  });
});
