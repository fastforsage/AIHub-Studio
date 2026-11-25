import type { LocalChatMessage, LocalChatResult } from "../local-ai/localAiManager";
import type { CatalogState } from "../catalog/catalogModel";

export interface LocalAiApi {
  discoverModels(providerId: string): Promise<CatalogState>;
  selectModel(providerId: string, modelId: string): Promise<CatalogState>;
  completeChat(providerId: string, messages: LocalChatMessage[]): Promise<LocalChatResult>;
}
