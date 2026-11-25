import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertCatalogState,
  CatalogState,
  createDefaultCatalog,
  POPULAR_PROVIDER_IDS
} from "./catalogModel";

export class CatalogStore {
  private state: CatalogState | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<CatalogState> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.filePath), 0o700);

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      assertCatalogState(parsed);
      const legacyDefaultIds = new Set(["ai", "local-ai", "dev", "community", "design", "email", "video"]);
      const isUntouchedLegacyCatalog = parsed.providers.length === 0 &&
        parsed.categories.length === legacyDefaultIds.size &&
        parsed.categories.every((category) => legacyDefaultIds.has(category.id));
      const currentDefaults = createDefaultCatalog();
      const previousDefaultIds = new Set(currentDefaults.providers
        .filter((provider) => ![
          "nvidia-nim", "groqcloud", "cloudflare-workers-ai", "cohere",
          "modelscope", "huggingface-inference", "opencode-zen", "kilo-ai-gateway"
        ].includes(provider.id))
        .map((provider) => provider.id));
      const previousCategoryIds = new Set(currentDefaults.categories
        .filter((category) => category.id !== "api-providers")
        .map((category) => category.id));
      const isPreviousCuratedCatalog = parsed.providers.length === previousDefaultIds.size &&
        parsed.providers.every((provider) => previousDefaultIds.has(provider.id)) &&
        parsed.categories.length === previousCategoryIds.size &&
        parsed.categories.every((category) => previousCategoryIds.has(category.id));

      // Upgrade known untouched catalogs while preserving provider edits and category names.
      if (isUntouchedLegacyCatalog) {
        this.state = currentDefaults;
      } else if (isPreviousCuratedCatalog) {
        const previousProviders = new Map(parsed.providers.map((provider) => [provider.id, provider]));
        const previousCategories = new Map(parsed.categories.map((category) => [category.id, category]));
        this.state = {
          ...currentDefaults,
          categories: currentDefaults.categories.map((category) => previousCategories.get(category.id) ?? category),
          providers: currentDefaults.providers.map((provider) => {
            const previous = previousProviders.get(provider.id);
            if (!previous) return provider;
            return {
              ...provider,
              ...previous,
              categoryIds: [...new Set([...previous.categoryIds, ...provider.categoryIds])],
              enabled: POPULAR_PROVIDER_IDS.includes(provider.id)
            };
          })
        };
      } else {
        this.state = structuredClone(parsed);
      }
      if (isUntouchedLegacyCatalog || isPreviousCuratedCatalog) await this.write(this.state);
    } catch (error) {
      if (isMissingFile(error)) {
        this.state = createDefaultCatalog();
        await this.write(this.state);
      } else {
        // Never replace a corrupt or unsupported user configuration with defaults.
        throw new Error("Unable to load catalog at " + this.filePath, { cause: error });
      }
    }

    return this.get();
  }

  get(): CatalogState {
    if (!this.state) throw new Error("CatalogStore has not been initialized");
    return structuredClone(this.state);
  }

  async transact(
    operation: (current: CatalogState) => CatalogState
  ): Promise<CatalogState> {
    const task = this.pending.then(async () => {
      const current = this.get();
      const next = operation(current);
      assertCatalogState(next);
      await this.write(next);
      this.state = structuredClone(next);
      return this.get();
    });

    this.pending = task.then(() => undefined, () => undefined);
    return task;
  }

  private async write(state: CatalogState): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = join(directory, ".catalog-" + randomUUID() + ".tmp");
    const handle = await open(temporaryPath, "wx", 0o600);

    try {
      await handle.writeFile(JSON.stringify(state, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
