import { describe, expect, it, vi } from "vitest";
import {
  LocalAiError,
  LocalAiManager,
  localApiBaseUrl
} from "../src/local-ai/localAiManager";
import type { LocalApiProvider } from "../src/catalog/catalogModel";

function provider(overrides: Partial<LocalApiProvider> = {}): LocalApiProvider {
  return {
    id: "local-1",
    name: "Local LLM",
    type: "local-api",
    apiType: "openai",
    host: "localhost",
    port: 11434,
    categoryIds: ["local-ai"],
    favorite: false,
    enabled: true,
    models: ["qwen3:8b"],
    selectedModel: "qwen3:8b",
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

describe("localApiBaseUrl", () => {
  it("builds the agreed localhost OpenAI-compatible API base URL", () => {
    expect(localApiBaseUrl(provider())).toBe("http://localhost:11434/v1");
  });

  it("formats IPv6 hosts safely", () => {
    expect(localApiBaseUrl(provider({ host: "::1", port: 9000 })))
      .toBe("http://[::1]:9000/v1");
  });
});

describe("LocalAiManager.discoverModels", () => {
  it("discovers and de-duplicates model identifiers", async () => {
    const fetch = vi.fn(async () => jsonResponse({
      object: "list",
      data: [
        { id: "qwen3:8b" },
        { id: "deepseek-r1:7b" },
        { id: "qwen3:8b" },
        { name: "invalid-item" },
        { id: "  " }
      ]
    }));
    const manager = new LocalAiManager(fetch);

    await expect(manager.discoverModels(provider())).resolves.toEqual([
      "qwen3:8b", "deepseek-r1:7b"
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("returns an empty list when the server reports no models", async () => {
    const manager = new LocalAiManager(async () => jsonResponse({ data: [] }));
    await expect(manager.discoverModels(provider())).resolves.toEqual([]);
  });

  it("reports non-success HTTP status without exposing response bodies", async () => {
    const manager = new LocalAiManager(async () => jsonResponse({ error: "private details" }, 404));
    await expect(manager.discoverModels(provider())).rejects.toMatchObject({
      code: "HTTP_ERROR",
      message: "Local AI server returned HTTP 404 for model discovery"
    });
  });

  it("rejects an invalid model list structure", async () => {
    const manager = new LocalAiManager(async () => jsonResponse({ models: ["qwen"] }));
    await expect(manager.discoverModels(provider())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("handles malformed JSON", async () => {
    const manager = new LocalAiManager(async () => ({
      ok: true, status: 200, json: async () => { throw new Error("bad json"); }
    } as unknown as Response));
    await expect(manager.discoverModels(provider())).rejects.toMatchObject({ code: "INVALID_JSON" });
  });

  it("maps connection and timeout failures to safe errors", async () => {
    const connection = new LocalAiManager(async () => { throw new TypeError("socket details"); });
    await expect(connection.discoverModels(provider())).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      message: "Could not connect to the configured Local AI server"
    });

    const timeout = new LocalAiManager(async (_url, init) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
      return jsonResponse({ data: [] });
    }, 100);
    await expect(timeout.discoverModels(provider())).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("LocalAiManager.completeChat", () => {
  it("sends OpenAI-compatible chat completion payload and returns assistant text", async () => {
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "qwen3:8b",
        messages: [{ role: "user", content: "Hello" }],
        stream: false
      });
      return jsonResponse({
        model: "qwen3:8b",
        choices: [{ message: { role: "assistant", content: "Hello from local model" } }]
      });
    });
    const manager = new LocalAiManager(fetch);
    await expect(manager.completeChat(provider(), [
      { role: "user", content: "Hello" }
    ])).resolves.toEqual({
      model: "qwen3:8b",
      content: "Hello from local model"
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("requires a selected model from the discovered model list", async () => {
    const fetch = vi.fn();
    const manager = new LocalAiManager(fetch);
    await expect(manager.completeChat(provider({ selectedModel: undefined }), [
      { role: "user", content: "Hello" }
    ])).rejects.toMatchObject({ code: "MODEL_NOT_SELECTED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects empty or malformed chat histories before making a request", async () => {
    const fetch = vi.fn();
    const manager = new LocalAiManager(fetch);
    await expect(manager.completeChat(provider(), [])).rejects.toMatchObject({ code: "INVALID_MESSAGES" });
    await expect(manager.completeChat(provider(), [
      { role: "user", content: " " }
    ])).rejects.toMatchObject({ code: "INVALID_MESSAGES" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports invalid response structures", async () => {
    const manager = new LocalAiManager(async () => jsonResponse({ choices: [] }));
    await expect(manager.completeChat(provider(), [
      { role: "user", content: "Hello" }
    ])).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("does not expose server error bodies in HTTP errors", async () => {
    const manager = new LocalAiManager(async () => jsonResponse({
      error: { message: "sensitive server details" }
    }, 500));
    await expect(manager.completeChat(provider(), [
      { role: "user", content: "Hello" }
    ])).rejects.toMatchObject({
      code: "HTTP_ERROR",
      message: "Local AI server returned HTTP 500 for chat completion"
    });
  });

  it("validates the configured request timeout", () => {
    expect(() => new LocalAiManager(fetch, 0)).toThrow("between 100 and 120000");
  });
});
