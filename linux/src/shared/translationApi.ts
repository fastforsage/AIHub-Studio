export interface TranslationReport {
  translatedNodes: number;
  sourceLanguage: string;
  targetLanguage: "ru";
}

export interface TranslationApi {
  translatePage(tabId: string, sourceLanguage?: string): Promise<TranslationReport>;
  restoreOriginalPage(tabId: string): Promise<void>;
}
