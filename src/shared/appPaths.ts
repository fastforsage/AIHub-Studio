import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export interface AppPaths {
  config: string;
  data: string;
  state: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;
type Platform = "win32" | "linux" | "darwin";

export function resolveAppPaths(
  environment: Environment = process.env,
  homeDirectory = homedir(),
  platform: Platform = process.platform as Platform
): AppPaths {
  if (platform === "win32") {
    const path = win32;
    const roaming = environment.APPDATA && path.isAbsolute(environment.APPDATA)
      ? environment.APPDATA
      : path.join(homeDirectory, "AppData", "Roaming");
    const local = environment.LOCALAPPDATA && path.isAbsolute(environment.LOCALAPPDATA)
      ? environment.LOCALAPPDATA
      : path.join(homeDirectory, "AppData", "Local");
    const root = path.join(local, "AIHubStudio");
    return {
      config: path.join(roaming, "AIHubStudio"),
      data: path.join(root, "Data"),
      state: path.join(root, "Logs")
    };
  }

  const path = posix;
  const xdg = (value: string | undefined, fallback: string): string =>
    value && path.isAbsolute(value) ? path.normalize(value) : path.join(homeDirectory, fallback);
  return {
    config: path.join(xdg(environment.XDG_CONFIG_HOME, ".config"), "AIHubStudio"),
    data: path.join(xdg(environment.XDG_DATA_HOME, ".local/share"), "AIHubStudio"),
    state: path.join(xdg(environment.XDG_STATE_HOME, ".local/state"), "AIHubStudio")
  };
}
