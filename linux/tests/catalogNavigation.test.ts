import { describe, expect, it } from "vitest";
import type { Category, Provider } from "../src/catalog/catalogModel";
import { getInitiallyExpandedCategories, toggleExpandedCategory } from "../src/shared/catalogNavigation";

const categories: Category[] = [
  { id: "ai", name: "AI" },
  { id: "local-ai", name: "Local AI" },
  { id: "dev", name: "Dev" }
];
const providers: Provider[] = [{
  id: "duck", name: "Duck", type: "website", url: "https://duck.ai",
  profileId: "duck", categoryIds: ["ai"], favorite: false, enabled: true
}, {
  id: "gemma", name: "Gemma", type: "local-api", apiType: "openai", host: "localhost",
  port: 11434, categoryIds: ["local-ai"], favorite: false, enabled: true, models: []
}];

describe("catalog sidebar navigation", () => {
  it("keeps categories collapsed by default on startup", () => {
    expect(getInitiallyExpandedCategories(categories, providers)).toEqual([]);
  });

  it("expands and collapses a category without changing other expanded categories", () => {
    expect(toggleExpandedCategory(["ai"], "local-ai")).toEqual(["ai", "local-ai"]);
    expect(toggleExpandedCategory(["ai", "local-ai"], "ai")).toEqual(["local-ai"]);
  });
});
