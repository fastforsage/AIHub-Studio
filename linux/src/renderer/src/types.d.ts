import type { CatalogApi } from "../../shared/catalogApi";

export {};

declare global {
  interface Window {
    aihub?: {
      platform: string;
      version: string;
      catalog: CatalogApi;
    };
  }
}
