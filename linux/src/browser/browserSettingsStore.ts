import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizeProxyServer } from "./proxyConfig";

export interface BrowserSettings {
  version: 1;
  proxyServer: string | null;
}

export class BrowserSettingsStore {
  private settings: BrowserSettings | null = null;

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<BrowserSettings> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.filePath), 0o700);

    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      this.settings = validateBrowserSettings(parsed);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw new Error("Unable to load browser settings at " + this.filePath, { cause: error });
      }
      this.settings = { version: 1, proxyServer: null };
      await this.write(this.settings);
    }

    return this.get();
  }

  get(): BrowserSettings {
    if (!this.settings) throw new Error("BrowserSettingsStore has not been initialized");
    return { ...this.settings };
  }

  async setProxyServer(input: string): Promise<BrowserSettings> {
    if (!this.settings) throw new Error("BrowserSettingsStore has not been initialized");
    const proxyServer = normalizeProxyServer(input);
    if (input.trim() && !proxyServer) {
      throw new Error("Proxy must be an HTTP, HTTPS, SOCKS4 or SOCKS5 address without credentials or a path");
    }

    const next: BrowserSettings = { version: 1, proxyServer };
    await this.write(next);
    this.settings = next;
    return this.get();
  }

  private async write(settings: BrowserSettings): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = join(directory, ".browser-settings-" + randomUUID() + ".tmp");
    const handle = await open(temporaryPath, "wx", 0o600);

    try {
      await handle.writeFile(JSON.stringify(settings, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function validateBrowserSettings(value: unknown): BrowserSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Browser settings document is invalid");
  }

  const input = value as Record<string, unknown>;
  if (input.version !== 1 ||
      (input.proxyServer !== null && typeof input.proxyServer !== "string")) {
    throw new Error("Browser settings document has an unsupported version or structure");
  }

  const proxyServer = normalizeProxyServer(input.proxyServer as string | null);
  if (input.proxyServer && !proxyServer) {
    throw new Error("Browser settings contains an invalid proxy address");
  }

  return { version: 1, proxyServer };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
