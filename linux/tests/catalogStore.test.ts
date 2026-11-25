import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogStore } from "../src/catalog/catalogStore";
import { addCategory, addWebsiteProvider } from "../src/catalog/catalogModel";

const temporaryDirectories: string[] = [];

async function createTemporaryCatalogPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aihub-catalog-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "config", "catalog.json");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("CatalogStore", () => {
  it("creates default catalog on first launch and persists updates", async () => {
    const filePath = await createTemporaryCatalogPath();
    const store = new CatalogStore(filePath);
    const initial = await store.initialize();
    expect(initial.categories.some((category) => category.id === "local-ai")).toBe(true);

    await store.transact((current) => addCategory(current, "Research", () => "research"));

    const reloaded = new CatalogStore(filePath);
    const loaded = await reloaded.initialize();
    expect(loaded.categories.at(-1)).toEqual({ id: "research", name: "Research" });
  });

  it("writes config with owner-only permissions", async () => {
    const filePath = await createTemporaryCatalogPath();
    const store = new CatalogStore(filePath);
    await store.initialize();
    const info = await stat(filePath);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("serializes concurrent updates without losing either change", async () => {
    const filePath = await createTemporaryCatalogPath();
    const store = new CatalogStore(filePath);
    await store.initialize();

    await Promise.all([
      store.transact((current) => addCategory(current, "Alpha", () => "alpha")),
      store.transact((current) => addCategory(current, "Beta", () => "beta"))
    ]);

    expect(store.get().categories.map((category) => category.id)).toContain("alpha");
    expect(store.get().categories.map((category) => category.id)).toContain("beta");
  });

  it("does not overwrite a corrupt catalog", async () => {
    const filePath = await createTemporaryCatalogPath();
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{broken json", "utf8");

    const store = new CatalogStore(filePath);
    await expect(store.initialize()).rejects.toThrow("Unable to load catalog");
    expect(await readFile(filePath, "utf8")).toBe("{broken json");
  });

  it("persists website provider fields", async () => {
    const filePath = await createTemporaryCatalogPath();
    const store = new CatalogStore(filePath);
    await store.initialize();
    await store.transact((current) => addWebsiteProvider(current, {
      name: "Example", url: "example.com"
    }, () => "example"));

    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    expect(parsed.providers[0]).toMatchObject({
      id: "example", name: "Example", url: "https://example.com/"
    });
  });
});
