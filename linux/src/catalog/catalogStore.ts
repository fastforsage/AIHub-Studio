import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertCatalogState,
  CatalogState,
  createDefaultCatalog
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
      // Upgrade only the untouched starter catalog. Never overwrite a user's custom entries.
      this.state = isUntouchedLegacyCatalog
        ? createDefaultCatalog()
        : structuredClone(parsed);
      if (isUntouchedLegacyCatalog) await this.write(this.state);
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
