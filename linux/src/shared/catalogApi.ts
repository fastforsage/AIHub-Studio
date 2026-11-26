import type {
  AddLocalApiInput,
  AddWebsiteInput,
  CatalogState,
  ProviderUpdate
} from "../catalog/catalogModel";

export interface CatalogSyncReport {
  startedAt: string;
  completedAt: string;
  added: number;
  updated: number;
  unchanged: number;
  skipped: number;
  sourceErrors: string[];
  sources: Array<{ id: string; label: string; entries: number; ok: boolean }>;
  totalProviders: number;
}

export interface CatalogApi {
  sync(): Promise<CatalogState & { syncReport?: CatalogSyncReport }>;
  get(): Promise<CatalogState>;
  addCategory(name: string): Promise<CatalogState>;
  renameCategory(id: string, name: string): Promise<CatalogState>;
  deleteCategory(id: string): Promise<CatalogState>;
  addWebsite(input: AddWebsiteInput): Promise<CatalogState>;
  addLocalApi(input: AddLocalApiInput): Promise<CatalogState>;
  updateProvider(id: string, update: ProviderUpdate): Promise<CatalogState>;
  deleteProvider(id: string): Promise<CatalogState>;
  setFavorite(id: string, favorite: boolean): Promise<CatalogState>;
  setEnabledProviders(providerIds: string[]): Promise<CatalogState>;
}
