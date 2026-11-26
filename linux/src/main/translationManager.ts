import { createProvider } from "@molecule/api-ai-translation-bergamot";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type TranslationLogLevel = "info" | "warn" | "error";
export type TranslationLogger = (level: TranslationLogLevel, message: string, metadata?: unknown) => void;
export type TranslationFetch = typeof fetch;

export class TranslationManager {
  private provider: ReturnType<typeof createProvider> | null = null;
  private initialization: Promise<ReturnType<typeof createProvider>> | null = null;

  constructor(
    private readonly cacheDirectory: string,
    private readonly fetcher: TranslationFetch = globalThis.fetch.bind(globalThis),
    private readonly log: TranslationLogger = () => undefined
  ) {
    mkdirSync(this.cacheDirectory, { recursive: true, mode: 0o700 });
    this.log("info", "Translation manager created", { cacheDirectory: this.cacheDirectory, proxyAwareFetch: true });
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

  private async getProvider(): Promise<ReturnType<typeof createProvider>> {
    if (this.provider) return this.provider;
    if (!this.initialization) {
      this.log("info", "Bergamot provider initialization started", {
        cacheDirectory: join(this.cacheDirectory, "models"), workers: 1, maxLoadedPairs: 2,
        downloadsUseApplicationProxy: true
      });
      this.initialization = Promise.resolve().then(() => createProvider({
        cacheDir: join(this.cacheDirectory, "models"),
        workers: 1,
        maxLoadedPairs: 2,
        fetch: this.fetcher
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
