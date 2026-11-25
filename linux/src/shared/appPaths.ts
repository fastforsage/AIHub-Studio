import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

export interface AppPaths {
  config: string;
  data: string;
  state: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;

function xdgDirectory(
  value: string | undefined,
  homeDirectory: string,
  fallbackName: string
): string {
  if (value && isAbsolute(value)) {
    return normalize(value);
  }

  return join(homeDirectory, fallbackName);
}

export function resolveAppPaths(
  environment: Environment = process.env,
  homeDirectory = homedir()
): AppPaths {
  const configHome = xdgDirectory(environment.XDG_CONFIG_HOME, homeDirectory, ".config");
  const dataHome = xdgDirectory(environment.XDG_DATA_HOME, homeDirectory, ".local/share");
  const stateHome = xdgDirectory(environment.XDG_STATE_HOME, homeDirectory, ".local/state");

  return {
    config: join(configHome, "AIHubStudio"),
    data: join(dataHome, "AIHubStudio"),
    state: join(stateHome, "AIHubStudio")
  };
}
