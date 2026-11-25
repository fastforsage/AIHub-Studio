import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertCatalogState,
  CatalogState,
  createDefaultCatalog
} from "./catalogModel";
import { POPULAR_PROVIDER_IDS } from "./catalogDefaults";

export class CatalogStore {
  private state: CatalogState | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<CatalogState> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.filePath), 0o700);

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsedRaw: unknown = JSON.parse(raw);
      const repaired = repairDuplicateProviderEntries(parsedRaw);
      const parsed = repaired.catalog;
      assertCatalogState(parsed);
      const legacyDefaultIds = new Set(["ai", "local-ai", "dev", "community", "design", "email", "video"]);
      const currentDefaults = createDefaultCatalog();
      const newProviderIds = new Set(["alice-ai", "gigachat"]);
      const previousProviderIds = new Set(currentDefaults.providers
        .filter((provider) => !newProviderIds.has(provider.id))
        .map((provider) => provider.id));
      const defaultCategoryIds = new Set(currentDefaults.categories.map((category) => category.id));
      const isLegacyStarterLayout = parsed.categories.length === legacyDefaultIds.size &&
        parsed.categories.every((category) => legacyDefaultIds.has(category.id));
      const previousTwentyProviderIds = new Set(currentDefaults.providers
        .filter((provider) => !newProviderIds.has(provider.id) && ![
          "nvidia-nim", "groqcloud", "cloudflare-workers-ai", "cohere",
          "cerebras-inference", "sambanova-cloud", "modelscope",
          "huggingface-inference", "opencode-zen", "kilo-ai-gateway"
        ].includes(provider.id))
        .map((provider) => provider.id));
      const previousElevenCategoryIds = new Set(currentDefaults.categories
        .filter((category) => category.id !== "api-providers")
        .map((category) => category.id));
      const isPreviousCuratedCatalog =
        (parsed.providers.length === previousProviderIds.size &&
          parsed.providers.every((provider) => previousProviderIds.has(provider.id)) &&
          parsed.categories.length === currentDefaults.categories.length &&
          parsed.categories.every((category) => defaultCategoryIds.has(category.id))) ||
        (parsed.providers.length === previousTwentyProviderIds.size &&
          parsed.providers.every((provider) => previousTwentyProviderIds.has(provider.id)) &&
          parsed.categories.length === previousElevenCategoryIds.size &&
          parsed.categories.every((category) => previousElevenCategoryIds.has(category.id)));

      if (isLegacyStarterLayout || isPreviousCuratedCatalog) {
        const legacyCategoryMap: Record<string, string> = {
          ai: "chatbot", "local-ai": "local-ai", dev: "many-in-one",
          community: "many-in-one", design: "image-generator",
          email: "writing-helper", video: "video-generator"
        };
        const previousCategories = new Map(parsed.categories.map((category) => [category.id, category]));
        const customCategories = parsed.categories.filter((category) =>
          !legacyDefaultIds.has(category.id) && !defaultCategoryIds.has(category.id)
        );
        const categories = currentDefaults.categories.map((category) =>
          previousCategories.get(category.id) ?? category
        ).concat(customCategories);
        const availableCategoryIds = new Set(categories.map((category) => category.id));
        const previousProviders = new Map(parsed.providers.map((provider) => [provider.id, provider]));
        const mergedDefaults = currentDefaults.providers.map((provider) => {
          const previous = previousProviders.get(provider.id);
          if (!previous) return provider;
          const mappedPreviousCategories = previous.categoryIds
            .map((id) => legacyCategoryMap[id] ?? id)
            .filter((id) => availableCategoryIds.has(id));
          return {
            ...provider,
            ...previous,
            categoryIds: [...new Set([...mappedPreviousCategories, ...provider.categoryIds])],
            enabled: previous.enabled
          };
        });
        const defaultProviderIds = new Set(currentDefaults.providers.map((provider) => provider.id));
        const mergedProviders = [...mergedDefaults];
        const normalizedName = (name: string) => name.trim().toLocaleLowerCase();
        for (const provider of parsed.providers) {
          if (defaultProviderIds.has(provider.id)) continue;
          const mappedCategoryIds = provider.categoryIds
            .map((id) => legacyCategoryMap[id] ?? id)
            .filter((id) => availableCategoryIds.has(id));
          const fallbackCategory = provider.type === "local-api" ? "local-ai" : "chatbot";
          const categoryIds = mappedCategoryIds.length
            ? [...new Set(mappedCategoryIds)]
            : [fallbackCategory];
          const sameName = mergedProviders.find((item) =>
            normalizedName(item.name) === normalizedName(provider.name)
          );
          if (sameName && sameName.type === provider.type) {
            // Keep the seeded provider's stable ID while preserving the user's settings
            // and browser profile from the legacy entry.
            sameName.categoryIds = [...new Set([...sameName.categoryIds, ...categoryIds])];
            sameName.favorite = sameName.favorite || provider.favorite;
            if (sameName.type === "website" && provider.type === "website") {
              sameName.profileId = provider.profileId || sameName.profileId;
            }
            continue;
          }

          let uniqueName = provider.name.trim();
          if (sameName) {
            const suffix = provider.type === "local-api" ? " (Local API)" : " (Website)";
            uniqueName += suffix;
            let counter = 2;
            while (mergedProviders.some((item) =>
              normalizedName(item.name) === normalizedName(uniqueName)
            )) {
              uniqueName = provider.name.trim() + suffix + " " + counter++;
            }
          }
          mergedProviders.push({ ...provider, name: uniqueName, categoryIds });
        }
        this.state = {
          version: 1,
          categories,
          providers: mergedProviders
        };
        assertCatalogState(this.state);
        await this.write(this.state);
      } else {
        this.state = structuredClone(parsed);
        if (repaired.changed) await this.write(this.state);
      }
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

function repairDuplicateProviderEntries(value: unknown): { catalog: unknown; changed: boolean } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { catalog: value, changed: false };
  }
  const document = value as Record<string, unknown>;
  if (!Array.isArray(document.providers) || !Array.isArray(document.categories)) {
    return { catalog: value, changed: false };
  }

  const categoryIds = new Set(document.categories.flatMap((item) =>
    typeof item === "object" && item !== null && !Array.isArray(item) &&
    typeof (item as Record<string, unknown>).id === "string"
      ? [(item as Record<string, unknown>).id as string]
      : []
  ));
  const providers: unknown[] = [];
  let changed = false;
  const normalize = (name: string) => name.trim().toLocaleLowerCase();

  for (const rawProvider of document.providers) {
    if (typeof rawProvider !== "object" || rawProvider === null || Array.isArray(rawProvider)) {
      providers.push(rawProvider);
      continue;
    }
    const provider = { ...(rawProvider as Record<string, unknown>) };
    if (typeof provider.id !== "string" || typeof provider.name !== "string") {
      providers.push(rawProvider);
      continue;
    }

    const duplicate = providers.find((candidate) =>
      typeof candidate === "object" && candidate !== null && !Array.isArray(candidate) &&
      normalize(String((candidate as Record<string, unknown>).name ?? "")) === normalize(provider.name as string)
    ) as Record<string, unknown> | undefined;

    if (duplicate && duplicate.type === provider.type) {
      const oldCategories = Array.isArray(duplicate.categoryIds) ? duplicate.categoryIds : [];
      const newCategories = Array.isArray(provider.categoryIds) ? provider.categoryIds : [];
      duplicate.categoryIds = [...new Set([...oldCategories, ...newCategories].filter((id) => typeof id === "string"))];
      duplicate.favorite = duplicate.favorite === true || provider.favorite === true;
      duplicate.enabled = duplicate.enabled === true || provider.enabled === true;
      changed = true;
      continue;
    }

    const idInUse = categoryIds.has(provider.id) || providers.some((candidate) =>
      typeof candidate === "object" && candidate !== null && !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).id === provider.id
    );
    if (idInUse) {
      provider.id = randomUUID();
      changed = true;
    }

    if (duplicate) {
      const baseName = provider.name.trim() + (provider.type === "local-api" ? " (Local API)" : " (Website)");
      let uniqueName = baseName;
      let suffix = 2;
      while (providers.some((candidate) =>
        typeof candidate === "object" && candidate !== null && !Array.isArray(candidate) &&
        normalize(String((candidate as Record<string, unknown>).name ?? "")) === normalize(uniqueName)
      )) {
        uniqueName = baseName + " " + suffix++;
      }
      provider.name = uniqueName;
      changed = true;
    }

    providers.push(provider);
  }

  return { catalog: changed ? { ...document, providers } : value, changed };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
