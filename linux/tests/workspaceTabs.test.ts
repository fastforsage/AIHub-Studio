import { describe, expect, it } from "vitest";
import type { BrowserTabInfo } from "../src/browser/browserTypes";
import type { Provider } from "../src/catalog/catalogModel";
import { buildWorkspaceTabs } from "../src/shared/workspaceTabs";

const browserTab = (id: string, title: string): BrowserTabInfo => ({
  id, providerId: id, title, url: "https://" + id + ".example.com",
  loading: false, canGoBack: false, canGoForward: false, error: null
});
const localProvider = (id: string, name: string): Provider => ({
  id, name, type: "local-api", apiType: "openai", host: "localhost", port: 11434,
  categoryIds: ["local-ai"], favorite: false, enabled: true, models: []
});

describe("buildWorkspaceTabs", () => {
  it("contains only website and local AI tabs, with no catalogue tab", () => {
    const tabs = buildWorkspaceTabs(
      [browserTab("chatgpt", "ChatGPT"), browserTab("claude", "Claude")],
      [localProvider("ollama", "Ollama")], ["ollama"]
    );
    expect(tabs.map((tab) => tab.key)).toEqual(["website:chatgpt", "website:claude", "local:ollama"]);
  });
  it("preserves browser status and falls back to hostname when title is empty", () => {
    const tab = browserTab("openwebui", "");
    tab.loading = true;
    expect(buildWorkspaceTabs([tab], [], [])[0]).toMatchObject({
      kind: "website", key: "website:openwebui", title: "openwebui.example.com", loading: true
    });
  });
  it("removes stale local connections and deduplicates local chat tabs", () => {
    const tabs = buildWorkspaceTabs([], [localProvider("ollama", "Ollama")], [
      "ollama", "deleted-provider", "ollama"
    ]);
    expect(tabs.map((tab) => tab.key)).toEqual(["local:ollama"]);
  });
});
