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
    expect(initial.categories.map((category) => category.name)).toEqual([
      "chatbot", "music generator", "voice generator", "video generator",
      "writing helper", "research assistant", "translator", "presentation maker",
      "image generator", "many in one", "API providers and aggregators", "Local AI"
    ]);
    expect(initial.providers.map((provider) => provider.name)).toContain("ChatGPT");
    expect(initial.providers.map((provider) => provider.name)).toContain("Claude");
    expect(initial.providers).toHaveLength(32);
    expect(initial.providers.filter((provider) => provider.enabled)).toHaveLength(14);

    await store.transact((current) => addCategory(current, "Research", () => "research"));

    const reloaded = new CatalogStore(filePath);
    const loaded = await reloaded.initialize();
    expect(loaded.categories.at(-1)).toEqual({ id: "research", name: "Research" });
  });


  it("upgrades the previous curated catalog with API providers and the popular-only selection", async () => {
    const filePath = await createTemporaryCatalogPath();
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const { createDefaultCatalog } = await import("../src/catalog/catalogModel");
    const current = createDefaultCatalog();
    const previous = {
      ...current,
      categories: current.categories.filter((category) => category.id !== "api-providers"),
      providers: current.providers.filter((provider) => ![
        "nvidia-nim", "groqcloud", "cloudflare-workers-ai", "cohere",
        "cerebras-inference", "sambanova-cloud", "modelscope",
        "huggingface-inference", "opencode-zen", "kilo-ai-gateway", "alice-ai", "gigachat"
      ].includes(provider.id)).map((provider) => ({
        ...provider,
        categoryIds: provider.categoryIds.filter((id) => id !== "api-providers"),
      }))
    };
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(previous), "utf8");

    const store = new CatalogStore(filePath);
    const upgraded = await store.initialize();
    expect(upgraded.providers).toHaveLength(32);
    expect(upgraded.providers.filter((provider) => provider.enabled)).toHaveLength(14);
    expect(upgraded.categories.some((category) => category.id === "api-providers")).toBe(true);
    expect(upgraded.providers.find((provider) => provider.id === "mistral")?.categoryIds).toContain("api-providers");
  });

  it("migrates an untouched legacy starter catalog to the curated catalog", async () => {
    const filePath = await createTemporaryCatalogPath();
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({
      version: 1,
      categories: [
        { id: "ai", name: "AI" }, { id: "local-ai", name: "Local AI" },
        { id: "dev", name: "Dev" }, { id: "community", name: "Community" },
        { id: "design", name: "Design" }, { id: "email", name: "Email" },
        { id: "video", name: "Video" }
      ],
      providers: []
    }), "utf8");

    const store = new CatalogStore(filePath);
    const migrated = await store.initialize();
    expect(migrated.providers).toHaveLength(32);
    expect(migrated.categories.some((category) => category.id === "chatbot")).toBe(true);
    expect(migrated.categories.some((category) => category.id === "dev")).toBe(false);
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.providers).toHaveLength(32);
  });

  it("merges the installed legacy catalog with the full catalog and preserves existing connections", async () => {
    const filePath = await createTemporaryCatalogPath();
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({
      version: 1,
      categories: [
        { id: "ai", name: "AI" }, { id: "local-ai", name: "Local AI" },
        { id: "dev", name: "Dev" }, { id: "community", name: "Community" },
        { id: "design", name: "Design" }, { id: "email", name: "Email" },
        { id: "video", name: "Video" }
      ],
      providers: [
        { id: "gemma-local", name: "Gemma4-26B", type: "local-api", apiType: "openai", host: "localhost", port: 11434, models: ["Gemma4-26B"], selectedModel: "Gemma4-26B", categoryIds: ["local-ai"], favorite: false, enabled: true },
        { id: "duckai", name: "DuckAI", type: "website", url: "https://duck.ai/", profileId: "duckai", categoryIds: ["ai"], favorite: false, enabled: true },
        { id: "legacy-chatgpt", name: "ChatGPT", type: "website", url: "https://chatgpt.com/", profileId: "legacy-chatgpt", categoryIds: ["ai"], favorite: true, enabled: true }
      ]
    }), "utf8");

    const store = new CatalogStore(filePath);
    const migrated = await store.initialize();
    expect(migrated.providers).toHaveLength(34);
    expect(migrated.providers.find((provider) => provider.id === "duckai")?.categoryIds).toContain("chatbot");
    expect(migrated.providers.find((provider) => provider.id === "gemma-local")?.categoryIds).toContain("local-ai");
    expect(migrated.providers.find((provider) => provider.id === "chatgpt")?.enabled).toBe(true);
    expect(migrated.providers.filter((provider) => provider.name.toLocaleLowerCase() === "chatgpt")).toHaveLength(1);
    expect(migrated.providers.find((provider) => provider.id === "chatgpt")?.favorite).toBe(true);
    expect(migrated.providers.find((provider) => provider.id === "chatgpt")).toMatchObject({ type: "website", profileId: "legacy-chatgpt" });
    expect(migrated.categories.some((category) => category.id === "dev")).toBe(false);
    expect(migrated.providers.filter((provider) => provider.enabled).length).toBe(16);
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.providers).toHaveLength(34);
  });


  it("adds new built-in services to a 26-entry customized catalog exactly once", async () => {
    const filePath = await createTemporaryCatalogPath();
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const previousProviders: import("../src/catalog/catalogModel").Provider[] = [
      {
        id: "chatgpt",
        name: "ChatGPT",
        type: "website",
        url: "https://chatgpt.com/",
        profileId: "existing-chatgpt-profile",
        categoryIds: ["chatbot"],
        favorite: true,
        enabled: false
      },
      {
        id: "gemma-local",
        name: "Gemma4-26B",
        type: "local-api",
        apiType: "openai",
        host: "localhost",
        port: 11434,
        models: ["Gemma4-26B"],
        selectedModel: "Gemma4-26B",
        categoryIds: ["local-ai"],
        favorite: true,
        enabled: true
      }
    ];
    for (let index = 0; index < 24; index++) {
      previousProviders.push({
        id: "custom-site-" + index,
        name: "Custom AI " + index,
        type: "website",
        url: "https://custom-ai-" + index + ".example/",
        profileId: "custom-site-profile-" + index,
        categoryIds: ["chatbot"],
        favorite: index === 0,
        enabled: true
      });
    }
    const previous = {
      version: 1,
      catalogSeedVersion: 1,
      categories: [
        { id: "chatbot", name: "chatbot" },
        { id: "local-ai", name: "Local AI" }
      ],
      providers: previousProviders
    };
    expect(previous.providers).toHaveLength(26);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(previous), "utf8");

    const store = new CatalogStore(filePath);
    const upgraded = await store.initialize();
    expect(upgraded.providers).toHaveLength(38);
    expect(upgraded.categories.some((category) => category.id === "api-providers")).toBe(true);
    expect(upgraded.providers.find((provider) => provider.id === "alice-ai")).toMatchObject({
      enabled: true, categoryIds: ["chatbot"]
    });
    expect(upgraded.providers.find((provider) => provider.id === "gigachat")).toMatchObject({
      enabled: true, categoryIds: ["chatbot"]
    });
    expect(upgraded.providers.find((provider) => provider.id === "nvidia-nim")?.enabled).toBe(false);
    expect(upgraded.providers.find((provider) => provider.id === "chatgpt")).toMatchObject({
      favorite: true, enabled: false, profileId: "existing-chatgpt-profile"
    });
    expect(upgraded.providers.find((provider) => provider.id === "gemma-local")).toMatchObject({
      host: "localhost", port: 11434, selectedModel: "Gemma4-26B", favorite: true
    });

    await store.transact((current) => ({
      ...current,
      providers: current.providers.filter((provider) => provider.id !== "alice-ai")
    }));
    const reloaded = new CatalogStore(filePath);
    const afterUserDeletion = await reloaded.initialize();
    expect(afterUserDeletion.catalogSeedVersion).toBe(2);
    expect(afterUserDeletion.providers.some((provider) => provider.id === "alice-ai")).toBe(false);
    expect(afterUserDeletion.providers).toHaveLength(37);
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
      name: "Example", url: "example.com", categoryIds: ["chatbot"]
    }, () => "example"));

    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    expect(parsed.providers.find((provider: { id: string }) => provider.id === "example")).toMatchObject({
      id: "example", name: "Example", url: "https://example.com/"
    });
  });
});
