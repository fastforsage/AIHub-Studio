import { ipcMain, IpcMainInvokeEvent } from "electron";
import { CatalogStore } from "../catalog/catalogStore";
import { updateLocalModels, selectLocalModel } from "../catalog/catalogModel";
import type { LocalApiProvider } from "../catalog/catalogModel";
import { LocalAiManager } from "../local-ai/localAiManager";
import type { LocalChatMessage } from "../local-ai/localAiManager";

type TrustedSender = (event: IpcMainInvokeEvent) => boolean;

function assertTrusted(event: IpcMainInvokeEvent, isTrusted: TrustedSender): void {
  if (!isTrusted(event)) throw new Error("Untrusted renderer attempted to access Local AI IPC");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Local AI request payload");
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string" || !result.trim()) throw new Error("Invalid " + key);
  return result;
}

function parseMessages(value: unknown): LocalChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("Chat history must contain between 1 and 100 messages");
  }

  return value.map((item) => {
    const message = record(item);
    const role = stringField(message, "role");
    const content = stringField(message, "content");
    if (role !== "user" && role !== "assistant" && role !== "system") {
      throw new Error("Unsupported Local AI message role");
    }
    if (content.length > 200_000) throw new Error("Local AI message is too large");
    return { role, content };
  });
}

function findLocalProvider(catalog: CatalogStore, providerId: string): LocalApiProvider {
  const provider = catalog.get().providers.find((item) => item.id === providerId);
  if (!provider || provider.type !== "local-api") {
    throw new Error("A Local AI connection was not found in the catalog");
  }
  return provider;
}

export function registerLocalAiIpc(
  manager: LocalAiManager,
  catalog: CatalogStore,
  isTrusted: TrustedSender
): void {
  const guard = (event: IpcMainInvokeEvent) => assertTrusted(event, isTrusted);

  ipcMain.handle("local-ai:discover-models", async (event, payload: unknown) => {
    guard(event);
    const providerId = stringField(record(payload), "providerId");
    const provider = findLocalProvider(catalog, providerId);
    const models = await manager.discoverModels(provider);
    return catalog.transact((current) => updateLocalModels(current, providerId, models));
  });

  ipcMain.handle("local-ai:select-model", (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    const providerId = stringField(input, "providerId");
    const modelId = stringField(input, "modelId");
    return catalog.transact((current) => selectLocalModel(current, providerId, modelId));
  });

  ipcMain.handle("local-ai:complete-chat", async (event, payload: unknown) => {
    guard(event);
    const input = record(payload);
    const providerId = stringField(input, "providerId");
    const provider = findLocalProvider(catalog, providerId);
    const messages = parseMessages(input.messages);
    return manager.completeChat(provider, messages);
  });
}
