import type { BrowserApi } from "../../shared/browserApi";
import type { CatalogApi } from "../../shared/catalogApi";
import type { LocalAiApi } from "../../shared/localAiApi";
import type { DiagnosticsApi } from "../../shared/diagnosticsApi";

export {};

declare global {
  interface Window {
    aihub?: {
      platform: string;
      version: string;
      catalog: CatalogApi;
      browser: BrowserApi;
      localAi: LocalAiApi;
      diagnostics: DiagnosticsApi;
    };
  }
}
