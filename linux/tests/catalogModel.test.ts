import { describe, expect, it } from "vitest";
import {
  addCategory,
  addLocalApiProvider,
  addWebsiteProvider,
  CatalogError,
  createDefaultCatalog,
  deleteCategory,
  deleteProvider,
  renameCategory,
  setProviderFavorite,
  updateProvider
} from "../src/catalog/catalogModel";

const id = (value: string) => () => value;

describe("catalog categories", () => {
  it("creates the default category set", () => {
    const catalog = createDefaultCatalog();
    expect(catalog.categories.map((category) => category.id)).toEqual([
      "ai", "local-ai", "dev", "community", "design", "email", "video"
    ]);
    expect(catalog.providers).toEqual([]);
  });

  it("adds a trimmed category", () => {
    const result = addCategory(createDefaultCatalog(), "  Research  ", id("research"));
    expect(result.categories.at(-1)).toEqual({ id: "research", name: "Research" });
  });

  it("rejects duplicate category names case-insensitively", () => {
    expect(() => addCategory(createDefaultCatalog(), "aI", id("new")))
      .toThrowError(CatalogError);
  });

  it("renames a category without changing its identifier", () => {
    const result = renameCategory(createDefaultCatalog(), "dev", "Development");
    expect(result.categories.find((item) => item.id === "dev")?.name).toBe("Development");
  });

  it("deletes a category without deleting its providers", () => {
    const base = addWebsiteProvider(createDefaultCatalog(), {
      name: "Example", url: "example.com", categoryIds: ["ai", "dev"]
    }, id("provider"));
    const result = deleteCategory(base, "dev");
    expect(result.categories.some((item) => item.id === "dev")).toBe(false);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].categoryIds).toEqual(["ai"]);
  });
});

describe("catalog providers", () => {
  it("adds a website with a normalized HTTPS URL", () => {
    const result = addWebsiteProvider(createDefaultCatalog(), {
      name: "Example", url: "example.com"
    }, id("website"));
    expect(result.providers[0]).toMatchObject({
      id: "website", name: "Example", type: "website",
      url: "https://example.com/", categoryIds: ["ai"], favorite: false, enabled: true,
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
    expect(result.providers[0]).toMatchObject({
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
      type: "website", name: "Example AI", url: "https://example.org", categoryIds: ["dev"]
    });
    expect(result.providers[0]).toMatchObject({
      id: "website", name: "Example AI", url: "https://example.org/",
      profileId: "website", categoryIds: ["dev"]
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
    expect(favorited.providers[0].favorite).toBe(true);
    expect(deleteProvider(favorited, "website").providers).toEqual([]);
  });
});
