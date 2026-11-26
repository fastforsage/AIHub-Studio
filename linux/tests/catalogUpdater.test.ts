import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ session: { defaultSession: { fetch: vi.fn() } } }));
import { parseFreeApiJson, parseNoCostAiMarkdown } from "../src/main/catalogUpdater";

describe("GitHub catalog source parsers", () => {
  it("parses website entries from no-cost-ai markdown tables", () => {
    const markdown = `## No Signup Required

### Chat Interfaces
| Link | Free Models | Limits |
| --- | --- | --- |
| [Example Chat](https://example.ai/) | \`Model A\` | 20 messages/day |
| \`removed.example\` (removed: unreachable) | Old model | 5/day |

### Media Generation
| Link | Free Models | Limits |
| --- | --- | --- |
| [Image Lab](https://image.example/) | Image model | 10 credits/month |
`;
    const entries = parseNoCostAiMarkdown(markdown, "2026-11-26T00:00:00.000Z");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      name: "Example Chat",
      url: "https://example.ai/",
      categoryIds: ["chatbot"],
      limits: "20 messages/day",
      catalogSource: "github-no-cost-ai"
    });
    expect(entries[1].categoryIds).toContain("image-generator");
  });


  it("parses plain domains from the current upstream README tables", () => {
    const markdown = `## No Signup Required
### Chat Interfaces
Link | Free Models | Limits
--- | --- | ---
lmarena.ai | 40+ | \`Unlimited\`
g4f.dev | 200+ local models | \`Unlimited\`
### Media Generation
Link | Free Models | Limits
--- | --- | ---
runwayml.com | Gen-4 | Free tier; usage varies
### Voice & Music
Link | Free Models | Limits
--- | --- | ---
ttsmp3.com | Google/Microsoft TTS | Short clips, daily cap
## Signup Required
### Chat Interfaces
Link | Free Models | Limits
--- | --- | ---
meta.ai | Llama 4 | Unlimited/Unknown
`;
    const entries = parseNoCostAiMarkdown(markdown, "2026-11-26T00:00:00.000Z");
    expect(entries.map((entry) => new URL(entry.url).hostname)).toEqual([
      "lmarena.ai", "g4f.dev", "runwayml.com", "ttsmp3.com", "meta.ai"
    ]);
    expect(entries[0].limits).toBe("Unlimited");
    expect(entries[2].categoryIds).toContain("video-generator");
    expect(entries[3].categoryIds).toContain("voice-generator");
  });

  it("merges duplicate domains across upstream sections instead of duplicating services", () => {
    const markdown = `### Chat Interfaces
Link | Free Models | Limits
--- | --- | ---
pollinations.ai | Chat | Unlimited
### Media Generation
Link | Free Models | Limits
--- | --- | ---
pollinations.ai | Image generation | Unlimited
`;
    const entries = parseNoCostAiMarkdown(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0].categoryIds).toContain("chatbot");
    expect(entries[0].categoryIds).toContain("image-generator");
  });

  it("parses API providers and per-model limits from mnfst data.json", () => {
    const raw = JSON.stringify({
      lastUpdated: "2026-11-15",
      providers: [{
        name: "Example API",
        category: "provider_api",
        country: "US",
        url: "https://example.ai/keys",
        baseUrl: "https://api.example.ai/v1",
        description: "Free tier with restrictions.",
        models: [{
          id: "example/model-1",
          name: "Model One",
          context: "128K",
          maxOutput: "16K",
          modality: "Text + Image",
          rateLimit: "10 RPM"
        }]
      }]
    });
    const entries = parseFreeApiJson(raw, "2026-11-26T00:00:00.000Z");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "Example API",
      apiBaseUrl: "https://api.example.ai/v1",
      categoryIds: ["api-providers"],
      regionTag: "US",
      modelDetails: [{
        id: "example/model-1",
        name: "Model One",
        context: "128K",
        maxOutput: "16K",
        modality: "Text + Image",
        limits: "10 RPM"
      }]
    });
  });

  it("rejects unsupported API source schemas and unsafe URLs", () => {
    expect(() => parseFreeApiJson(JSON.stringify({ providers: "not-an-array" }))).toThrow();
    const markdown = `### Chat Interfaces
| Link | Models | Limits |
| --- | --- | --- |
| [Unsafe](javascript:alert(1)) | model | unlimited |
`;
    expect(parseNoCostAiMarkdown(markdown)).toHaveLength(0);
  });
});
