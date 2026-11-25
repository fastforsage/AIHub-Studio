import type { LocalApiProvider } from "../catalog/catalogModel";

export type LocalMessageRole = "user" | "assistant" | "system";

export interface LocalChatMessage {
  role: LocalMessageRole;
  content: string;
}

export interface LocalChatResult {
  model: string;
  content: string;
}

export class LocalAiError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "LocalAiError";
  }
}

export type FetchImplementation = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

const MAX_MESSAGES = 100;
const MAX_MESSAGE_LENGTH = 200_000;

export function localApiBaseUrl(provider: Pick<LocalApiProvider, "host" | "port">): string {
  const host = provider.host.includes(":") && !provider.host.startsWith("[")
    ? "[" + provider.host + "]"
    : provider.host;
  return "http://" + host + ":" + provider.port + "/v1";
}

export class LocalAiManager {
  constructor(
    private readonly fetchImpl: FetchImplementation = fetch,
    private readonly timeoutMs = 15_000
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw new Error("Local AI request timeout must be between 100 and 120000 ms");
    }
  }

  async discoverModels(provider: LocalApiProvider): Promise<string[]> {
    const url = localApiBaseUrl(provider) + "/models";
    const response = await this.request(url, {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new LocalAiError("HTTP_ERROR", "Local AI server returned HTTP " + response.status + " for model discovery");
    }

    const body: unknown = await this.readJson(response);
    if (!isRecord(body) || !Array.isArray(body.data)) {
      throw new LocalAiError("INVALID_RESPONSE", "Local AI server returned an invalid model list");
    }

    const models: string[] = [];
    const seen = new Set<string>();
    for (const item of body.data) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) continue;
      const id = item.id.trim();
      if (!seen.has(id)) {
        seen.add(id);
        models.push(id);
      }
    }

    return models;
  }

  async completeChat(
    provider: LocalApiProvider,
    messages: LocalChatMessage[]
  ): Promise<LocalChatResult> {
    const model = provider.selectedModel;
    if (!model || !provider.models.includes(model)) {
      throw new LocalAiError("MODEL_NOT_SELECTED", "Select an available local model before sending a message");
    }

    validateMessages(messages);

    const url = localApiBaseUrl(provider) + "/chat/completions";
    const response = await this.request(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false
      })
    });

    if (!response.ok) {
      throw new LocalAiError("HTTP_ERROR", "Local AI server returned HTTP " + response.status + " for chat completion");
    }

    const body: unknown = await this.readJson(response);
    if (!isRecord(body) || !Array.isArray(body.choices) || !isRecord(body.choices[0])) {
      throw new LocalAiError("INVALID_RESPONSE", "Local AI server returned an invalid chat completion");
    }

    const message = body.choices[0].message;
    if (!isRecord(message) || typeof message.content !== "string") {
      throw new LocalAiError("INVALID_RESPONSE", "Local AI server returned no assistant text");
    }

    return {
      model: typeof body.model === "string" && body.model.trim() ? body.model : model,
      content: message.content
    };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (isAbortError(error)) {
        throw new LocalAiError("TIMEOUT", "Local AI request timed out");
      }
      throw new LocalAiError("CONNECTION_FAILED", "Could not connect to the configured Local AI server");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new LocalAiError("INVALID_JSON", "Local AI server returned invalid JSON");
    }
  }
}

function validateMessages(messages: LocalChatMessage[]): void {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new LocalAiError("INVALID_MESSAGES", "Chat history must contain between 1 and 100 messages");
  }

  for (const message of messages) {
    if (!message || !["user", "assistant", "system"].includes(message.role) ||
        typeof message.content !== "string" || !message.content.trim() ||
        message.content.length > MAX_MESSAGE_LENGTH) {
      throw new LocalAiError("INVALID_MESSAGES", "Chat history contains an invalid or oversized message");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "name" in error && (error as { name?: unknown }).name === "AbortError";
}
