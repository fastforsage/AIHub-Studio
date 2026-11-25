import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserSettingsStore } from "../src/browser/browserSettingsStore";

const directories: string[] = [];

async function pathForSettings(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aihub-browser-settings-"));
  directories.push(dir);
  return join(dir, "config", "browser-settings.json");
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("BrowserSettingsStore", () => {
  it("creates system-proxy defaults", async () => {
    const store = new BrowserSettingsStore(await pathForSettings());
    expect(await store.initialize()).toEqual({ version: 1, proxyServer: null });
  });

  it("persists and reloads a configured proxy", async () => {
    const path = await pathForSettings();
    const store = new BrowserSettingsStore(path);
    await store.initialize();
    await store.setProxyServer("127.0.0.1:8080");

    const reloaded = new BrowserSettingsStore(path);
    expect(await reloaded.initialize()).toEqual({
      version: 1, proxyServer: "http://127.0.0.1:8080"
    });
  });

  it("clears the proxy and restores system mode", async () => {
    const store = new BrowserSettingsStore(await pathForSettings());
    await store.initialize();
    await store.setProxyServer("socks5://localhost:1080");
    expect(await store.setProxyServer("")).toEqual({ version: 1, proxyServer: null });
  });

  it("rejects unsafe proxy credentials and leaves the current value unchanged", async () => {
    const store = new BrowserSettingsStore(await pathForSettings());
    await store.initialize();
    await store.setProxyServer("http://127.0.0.1:8080");
    await expect(store.setProxyServer("http://user:pass@proxy:8080")).rejects.toThrow("without credentials");
    expect(store.get().proxyServer).toBe("http://127.0.0.1:8080");
  });

  it("uses owner-only permissions for the settings file", async () => {
    const path = await pathForSettings();
    const store = new BrowserSettingsStore(path);
    await store.initialize();
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("does not overwrite a malformed settings file", async () => {
    const path = await pathForSettings();
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{broken", "utf8");
    const store = new BrowserSettingsStore(path);
    await expect(store.initialize()).rejects.toThrow("Unable to load browser settings");
    expect(await readFile(path, "utf8")).toBe("{broken");
  });
});
