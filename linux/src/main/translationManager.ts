import { createProvider } from "@molecule/api-ai-translation-bergamot";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export class TranslationManager {
  private provider: ReturnType<typeof createProvider> | null = null;
  private initialization: Promise<ReturnType<typeof createProvider>> | null = null;

  constructor(private readonly cacheDirectory: string) {
    mkdirSync(this.cacheDirectory, { recursive: true, mode: 0o700 });
  }

  async translate(texts: string[], sourceLanguage: string): Promise<string[]> {
    if (texts.length === 0) return [];
    const provider = await this.getProvider();
    const translated: string[] = [];
    // The provider contract caps each batch at 50 strings.
    for (let offset = 0; offset < texts.length; offset += 50) {
      const batch = texts.slice(offset, offset + 50);
      const result = await provider.translate({
        text: batch,
        sourceLang: sourceLanguage || "en",
        targetLang: "ru"
      });
      translated.push(...result.translations.map((item) => item.text));
    }
    return translated;
  }

  private async getProvider(): Promise<ReturnType<typeof createProvider>> {
    if (this.provider) return this.provider;
    if (!this.initialization) {
      this.initialization = Promise.resolve(createProvider({
        cacheDir: join(this.cacheDirectory, "models"),
        workers: 1,
        maxLoadedPairs: 2
      }));
    }
    this.provider = await this.initialization;
    return this.provider;
  }
}
