import { createProvider } from "@molecule/api-ai-translation-bergamot";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type TranslationLogLevel = "info" | "warn" | "error";
export type TranslationLogger = (level: TranslationLogLevel, message: string, metadata?: unknown) => void;
export type TranslationFetch = typeof fetch;

const MAX_ERROR_BODY_CHARS = 2048;

function safeUrl(input: RequestInfo | URL): string {
  try {
    const raw = input instanceof Request ? input.url : input.toString();
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

export class TranslationManager {
  private provider: ReturnType<typeof createProvider> | null = null;
  private initialization: Promise<ReturnType<typeof createProvider>> | null = null;

  constructor(
    private readonly cacheDirectory: string,
    private readonly fetcher: TranslationFetch = globalThis.fetch.bind(globalThis),
    private readonly log: TranslationLogger = () => undefined
  ) {
    mkdirSync(this.cacheDirectory, { recursive: true, mode: 0o700 });
    this.log("info", "Translation manager created", {
      cacheDirectory: this.cacheDirectory,
      proxyAwareFetch: true,
      modelCacheManagedBy: "Bergamot provider"
    });
  }

  async translate(texts: string[], sourceLanguage: string): Promise<string[]> {
    if (texts.length === 0) {
      this.log("warn", "Translation skipped because no text nodes were supplied");
      return [];
    }

    const startedAt = Date.now();
    this.log("info", "Translation request started", {
      sourceLanguage: sourceLanguage || "en",
      targetLanguage: "ru",
      textCount: texts.length
    });

    try {
      const provider = await this.getProvider();
      const translated: string[] = [];
      const batchCount = Math.ceil(texts.length / 50);

      for (let offset = 0; offset < texts.length; offset += 50) {
        const batch = texts.slice(offset, offset + 50);
        const batchNumber = Math.floor(offset / 50) + 1;
        const batchStartedAt = Date.now();
        this.log("info", "Bergamot batch started", {
          batchNumber, batchCount, textCount: batch.length, sourceLanguage: sourceLanguage || "en"
        });

        try {
          const result = await provider.translate({
            text: batch,
            sourceLang: sourceLanguage || "en",
            targetLang: "ru"
          });
          const values = result.translations.map((item) => item.text);
          if (values.length !== batch.length) throw new Error("Bergamot returned an unexpected translation count");
          translated.push(...values);
          this.log("info", "Bergamot batch completed", {
            batchNumber, translatedCount: values.length, durationMs: Date.now() - batchStartedAt
          });
        } catch (error) {
          this.log("error", "Bergamot batch failed", {
            batchNumber, textCount: batch.length, durationMs: Date.now() - batchStartedAt,
            error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
          });
          throw error;
        }
      }

      this.log("info", "Translation request completed", {
        sourceLanguage: sourceLanguage || "en", translatedCount: translated.length, durationMs: Date.now() - startedAt
      });
      return translated;
    } catch (error) {
      this.log("error", "Translation request failed", {
        sourceLanguage: sourceLanguage || "en", textCount: texts.length, durationMs: Date.now() - startedAt,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
      });
      throw error;
    }
  }

  private async fetchModelResource(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = safeUrl(input);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    // Mozilla's attachment CDN negotiates the binary representation itself.
    // Requesting a narrowly constrained media type (or spoofing a partial UA)
    // can trigger HTTP 406 on some proxy/CDN paths. Accept any representation
    // and let Electron's session supply its normal User-Agent.
    headers.set("Accept", "*/*");
    headers.delete("User-Agent");

    const requestHeaders = Object.fromEntries(headers.entries());
    const startedAt = Date.now();
    this.log("info", "Bergamot resource download started", { url, requestHeaders });

    let response: Response;
    try {
      response = await this.fetcher(input, { ...init, headers });
    } catch (error) {
      this.log("error", "Bergamot resource network request failed", {
        url, requestHeaders, durationMs: Date.now() - startedAt,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
      });
      throw error;
    }

    const responseHeaders = Object.fromEntries(response.headers.entries());
    const metadata = {
      url,
      status: response.status,
      statusText: response.statusText,
      responseUrl: response.url || url,
      responseHeaders,
      durationMs: Date.now() - startedAt
    };

    if (!response.ok) {
      const body = (await response.clone().text().catch(() => "[unable to read response body]")).slice(0, MAX_ERROR_BODY_CHARS);
      this.log("error", "Bergamot resource download rejected", { ...metadata, responseBody: body });
      throw new Error(`Bergamot download failed (${response.status}): ${url}${body ? " — " + body : ""}`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 0) {
      const bytes = await response.clone().arrayBuffer();
      const sha256 = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
      if (bytes.byteLength !== contentLength) {
        this.log("error", "Bergamot resource size validation failed", {
          ...metadata, expectedBytes: contentLength, actualBytes: bytes.byteLength, sha256
        });
        throw new Error(`Bergamot resource size mismatch: expected ${contentLength}, received ${bytes.byteLength}`);
      }
      this.log("info", "Bergamot resource downloaded and size-checked", {
        ...metadata, bytes: bytes.byteLength, sha256,
        integrity: "size-checked; provider cache handles model reuse"
      });
    } else {
      this.log("info", "Bergamot resource response received", metadata);
    }

    return response;
  }

  private async getProvider(): Promise<ReturnType<typeof createProvider>> {
    if (this.provider) return this.provider;
    if (!this.initialization) {
      this.log("info", "Bergamot provider initialization started", {
        cacheDirectory: join(this.cacheDirectory, "models"), workers: 1, maxLoadedPairs: 2,
        downloadsUseApplicationProxy: true,
        modelCacheReuse: "delegated to Bergamot cacheDir"
      });
      this.initialization = Promise.resolve().then(() => createProvider({
        cacheDir: join(this.cacheDirectory, "models"),
        workers: 1,
        maxLoadedPairs: 2,
        fetch: (input, init) => this.fetchModelResource(input, init)
      })).then((provider) => {
        this.log("info", "Bergamot provider initialized");
        return provider;
      }).catch((error: unknown) => {
        this.initialization = null;
        this.log("error", "Bergamot provider initialization failed", {
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
        });
        throw error;
      });
    }
    this.provider = await this.initialization;
    return this.provider;
  }
}
