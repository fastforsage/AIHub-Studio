import { describe, expect, it } from "vitest";
import {
  addCategory,
  addLocalApiProvider,
  addWebsiteProvider,
  CatalogError,
  createDefaultCatalog,
  setEnabledProviders,
  deleteCategory,
  deleteProvider,
  renameCategory,
  setProviderFavorite,
  updateProvider,
  updateLocalModels,
  selectLocalModel
} from "../src/catalog/catalogModel";

const id = (value: string) => () => value;

describe("catalog categories", () => {
  it("creates the default category set", () => {
    const catalog = createDefaultCatalog();
    expect(catalog.categories.map((category) => category.name)).toEqual([
      "chatbot", "music generator", "voice generator", "video generator",
      "writing helper", "research assistant", "translator", "presentation maker",
      "image generator", "many in one", "API providers and aggregators", "RU & CN Direct (Без VPN)", "Local AI"
    ]);
    expect(catalog.providers.map((provider) => provider.name)).toContain("ChatGPT");
    expect(catalog.providers.map((provider) => provider.name)).toContain("Claude");
    expect(catalog.providers).toHaveLength(47);
    expect(catalog.providers.filter((provider) => provider.enabled).map((provider) => provider.id)).toEqual([
      "chatgpt", "alice-ai", "gigachat", "claude", "gemini", "grok",
      "deepseek", "perplexity", "copilot", "mistral", "openrouter", "kimi",
      "qwen", "google-ai-studio"
    ]);
  });

  it("changes the visible service selection without deleting catalog entries", () => {
    const initial = createDefaultCatalog();
    const selected = setEnabledProviders(initial, ["chatgpt", "groqcloud"]);
    expect(selected.providers.filter((provider) => provider.enabled).map((provider) => provider.id)).toEqual(["chatgpt", "groqcloud"]);
    expect(selected.providers).toHaveLength(initial.providers.length);
    expect(() => setEnabledProviders(initial, ["missing-provider"])).toThrowError(CatalogError);
  });

  it("adds a trimmed category", () => {
    const result = addCategory(createDefaultCatalog(), "  Research  ", id("research"));
    expect(result.categories.at(-1)).toEqual({ id: "research", name: "Research" });
  });

  it("rejects duplicate category names case-insensitively", () => {
    expect(() => addCategory(createDefaultCatalog(), "CHATBOT", id("new")))
      .toThrowError(CatalogError);
  });

  it("renames a category without changing its identifier", () => {
    const result = renameCategory(createDefaultCatalog(), "music-generator", "Development");
    expect(result.categories.find((item) => item.id === "music-generator")?.name).toBe("Development");
  });

  it("deletes a category without deleting its providers", () => {
    const base = addWebsiteProvider(createDefaultCatalog(), {
      name: "Example", url: "example.com", categoryIds: ["chatbot", "music-generator"]
    }, id("provider"));
    const result = deleteCategory(base, "music-generator");
    expect(result.categories.some((item) => item.id === "music-generator")).toBe(false);
    expect(result.providers.find((provider) => provider.id === "provider")?.categoryIds).toEqual(["chatbot"]);
  });
});

describe("catalog providers", () => {
  it("adds a website with a normalized HTTPS URL", () => {
    const result = addWebsiteProvider(createDefaultCatalog(), {
      name: "Example", url: "example.com"
    }, id("website"));
    expect(result.providers.find((provider) => provider.id === "website")).toMatchObject({
      id: "website", name: "Example", type: "website",
      url: "https://example.com/", categoryIds: ["chatbot"], favorite: false, enabled: true,
      profileId: "website"
    });
  });

  it("rejects unsafe website protocols", () => {
    expect(() => addWebsiteProvider(createDefaultCatalog(), {
      name: "Unsafe", url: "javascript:alert(1)"
    })).toThrowError(CatalogError);
  });

  it("adds Local LLM using the agreed defaults", () => {
    const result = addLocalApiProvider(createDefaultCatalog(), {
      name: "Local LLM", apiType: "openai", host: "localhost", port: 11434
    }, id("local"));
    expect(result.providers.find((provider) => provider.id === "local")).toMatchObject({
      id: "local", name: "Local LLM", type: "local-api", apiType: "openai",
      host: "localhost", port: 11434, categoryIds: ["local-ai"],
      favorite: false, enabled: true, models: []
    });
  });

  it.each([0, -1, 65536, 1.5, Number.NaN])("rejects invalid port %s", (port) => {
    expect(() => addLocalApiProvider(createDefaultCatalog(), {
      name: "Local", host: "localhost", port
    })).toThrowError(CatalogError);
  });

  it.each(["", "http://localhost", "host/path", "bad host", "host@local"])(
    "rejects invalid host %s",
    (host) => {
      expect(() => addLocalApiProvider(createDefaultCatalog(), {
        name: "Local", host, port: 11434
      })).toThrowError(CatalogError);
    }
  );

  it("rejects an unsupported API type", () => {
    expect(() => addLocalApiProvider(createDefaultCatalog(), {
      name: "Local", apiType: "other" as "openai", host: "localhost", port: 11434
    })).toThrowError(CatalogError);
  });

  it("rejects duplicate provider names", () => {
    const first = addWebsiteProvider(createDefaultCatalog(), {
      name: "Example", url: "example.com"
    }, id("one"));
    expect(() => addLocalApiProvider(first, {
      name: "example", host: "localhost", port: 11434
    })).toThrowError(CatalogError);
  });

  it("updates provider settings without changing its type or profile", () => {
    const first = addWebsiteProvider(createDefaultCatalog(), {
      name: "Example", url: "example.com"
    }, id("website"));
    const result = updateProvider(first, "website", {
      type: "website", name: "Example AI", url: "https://example.org", categoryIds: ["music-generator"]
    });
    expect(result.providers.find((provider) => provider.id === "website")).toMatchObject({
      id: "website", name: "Example AI", url: "https://example.org/",
      profileId: "website", categoryIds: ["music-generator"]
    });
  });

  it("rejects changing connection type during edit", () => {
    const first = addWebsiteProvider(createDefaultCatalog(), {
      name: "Example", url: "example.com"
    }, id("website"));
    expect(() => updateProvider(first, "website", {
      type: "local-api", name: "Example", host: "localhost", port: 11434, categoryIds: ["local-ai"]
    })).toThrowError(CatalogError);
  });

  it("toggles favorites and deletes providers", () => {
    const first = addWebsiteProvider(createDefaultCatalog(), {
      name: "Example", url: "example.com"
    }, id("website"));
    const favorited = setProviderFavorite(first, "website", true);
    expect(favorited.providers.find((provider) => provider.id === "website")?.favorite).toBe(true);
    expect(deleteProvider(favorited, "website").providers.some((provider) => provider.id === "website")).toBe(false);
  });
});


describe("Local AI model catalog state", () => {
  function localCatalog() {
    return addLocalApiProvider(createDefaultCatalog(), {
      name: "Local LLM", host: "localhost", port: 11434
    }, id("local"));
  }

  it("stores discovered models and selects the first available model", () => {
    const result = updateLocalModels(localCatalog(), "local", ["qwen3:8b", "llama3.2"]);
    expect(result.providers.find((provider) => provider.id === "local")).toMatchObject({
      models: ["qwen3:8b", "llama3.2"],
      selectedModel: "qwen3:8b"
    });
  });

  it("preserves the current selection while it remains available", () => {
    const first = updateLocalModels(localCatalog(), "local", ["qwen3:8b", "llama3.2"]);
    const selected = selectLocalModel(first, "local", "llama3.2");
    const refreshed = updateLocalModels(selected, "local", ["llama3.2", "deepseek-r1"]);
    expect(refreshed.providers.find((provider) => provider.id === "local")).toMatchObject({
      models: ["llama3.2", "deepseek-r1"],
      selectedModel: "llama3.2"
    });
  });

  it("chooses the first new model when the previous selection disappears", () => {
    const first = updateLocalModels(localCatalog(), "local", ["qwen3:8b", "llama3.2"]);
    const selected = selectLocalModel(first, "local", "llama3.2");
    const refreshed = updateLocalModels(selected, "local", ["deepseek-r1", "qwen3:8b"]);
    expect(refreshed.providers.find((provider) => provider.id === "local")).toMatchObject({
      selectedModel: "deepseek-r1"
    });
  });

  it("clears selected model when the server reports no models", () => {
    const first = updateLocalModels(localCatalog(), "local", ["qwen3:8b"]);
    const refreshed = updateLocalModels(first, "local", []);
    expect(refreshed.providers.find((provider) => provider.id === "local")).toMatchObject({
      models: [],
      selectedModel: undefined
    });
  });

  it("rejects selecting an undiscovered model", () => {
    expect(() => selectLocalModel(localCatalog(), "local", "missing"))
      .toThrowError(CatalogError);
  });

  it("rejects model discovery updates on a website provider", () => {
    const site = addWebsiteProvider(createDefaultCatalog(), {
      name: "Example", url: "example.com"
    }, id("site"));
    expect(() => updateLocalModels(site, "site", ["qwen"]))
      .toThrowError(CatalogError);
  });

  it("deduplicates discovered identifiers and rejects invalid values", () => {
    const result = updateLocalModels(localCatalog(), "local", ["qwen3:8b", "qwen3:8b"]);
    expect(result.providers.find((provider) => provider.id === "local")).toMatchObject({ models: ["qwen3:8b"] });
    expect(() => updateLocalModels(localCatalog(), "local", [" "]))
      .toThrowError(CatalogError);
  });
});
